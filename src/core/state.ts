// ═══════════════════════════════════════════════════════════════════
// GAME STATE — Centralized Mutable State
// Single source of truth for camera, time, zoom, and selection.
// All UI and systems read from here; mutations go through methods
// that emit events for subscriber notification.
//
// Zoom model: 0.0–1.0 continuous float with 6 named tiers.
// Time model: index 0 = paused, 1–7 = increasing speed.
// Camera distance derived from zoom via piecewise curve.
// ═══════════════════════════════════════════════════════════════════

import { Events } from './events';

// ── Zoom Step Definitions ────────────────────────────────────────

export interface ZoomStep {
  label: string;
  val: number;       // position on 0–1 scale
}

export const ZOOM_STEPS: ZoomStep[] = [
  { label: 'SURFACE',    val: 0.03 },
  { label: 'SYSTEM',     val: 0.15 },
  { label: 'HELIOPAUSE', val: 0.33 },
  { label: 'SECTOR',     val: 0.52 },
  { label: 'ARM',        val: 0.75 },
  { label: 'GALAXY',     val: 0.95 },
];

// ── Time Speed Definitions ───────────────────────────────────────
// Index 0 = PAUSED. Speeds 1–7 map to TIME_SPEEDS[1]–[7].
// tc is in seconds of game-time per real second.

export interface TimeSpeed {
  label: string;
  tc: number;        // time compression (seconds per real second)
  orbit: number;     // orbit animation speed multiplier
}

// Two speed tables: local (capped at 25×) and galactic (full range).
// The active table is selected based on zoom domain.

export const LOCAL_TIME_SPEEDS: TimeSpeed[] = [
  { label: 'PAUSED', tc: 0,      orbit: 0 },
  { label: '1×',     tc: 1,      orbit: 1 },
  { label: '2×',     tc: 2,      orbit: 2 },
  { label: '5×',     tc: 5,      orbit: 4 },
  { label: '10×',    tc: 10,     orbit: 6 },
  { label: '25×',    tc: 25,     orbit: 10 },
];

export const GALACTIC_TIME_SPEEDS: TimeSpeed[] = [
  { label: 'PAUSED', tc: 0,             orbit: 0 },
  { label: '1×',     tc: 1,             orbit: 1 },
  { label: '60×',    tc: 60,            orbit: 8 },
  { label: 'HR/S',   tc: 3600,          orbit: 30 },
  { label: 'DAY/S',  tc: 86400,         orbit: 80 },
  { label: 'WK/S',   tc: 86400 * 7,     orbit: 150 },
  { label: 'MO/S',   tc: 86400 * 30,    orbit: 300 },
  { label: 'YR/S',   tc: 86400 * 365,   orbit: 600 },
];

/** Returns the active time speed table based on current zoom domain. */
export function getActiveTimeSpeeds(): TimeSpeed[] {
  return Game.data.zoomDomain === 'galaxy' ? GALACTIC_TIME_SPEEDS : LOCAL_TIME_SPEEDS;
}

// Legacy alias — some modules still import TIME_SPEEDS directly
export const TIME_SPEEDS = GALACTIC_TIME_SPEEDS;

// ── Domain Detection ─────────────────────────────────────────────
// Derives domain name from zoom level (0–1).

export type DomainName = 'surface' | 'system' | 'heliopause' | 'sector' | 'arm' | 'galaxy';

export function getZoomDomain(z: number): DomainName {
  if (z < 0.08) return 'surface';
  if (z < 0.22) return 'system';
  if (z < 0.40) return 'heliopause';
  if (z < 0.60) return 'sector';
  if (z < 0.82) return 'arm';
  return 'galaxy';
}

/**
 * Piecewise camera distance curve.
 * Each tier has its own distance range for natural zoom feel.
 */
export function getCamDist(z: number): number {
  if (z < 0.08) return 5 + z * 150;             // surface: 5–17
  if (z < 0.22) return 17 + (z - 0.08) * 2800;  // system: 17–409
  if (z < 0.40) return 409 + (z - 0.22) * 5500;  // heliopause: 409–1399
  if (z < 0.60) return 1399 + (z - 0.40) * 9000;  // sector: 1399–3199
  if (z < 0.82) return 3199 + (z - 0.60) * 18000; // arm: 3199–7159
  return 7159 + (z - 0.82) * 30000;               // galaxy: 7159–12559
}

// ── State Shape ──────────────────────────────────────────────────

export interface GameData {
  // Time
  gameTime: number;          // in-game time (seconds elapsed)
  timeSpeedIndex: number;    // index into TIME_SPEEDS (0 = paused)
  paused: boolean;
  _lastSpeed: number;        // speed before pause (for toggle restore)

  // Camera / Zoom
  zoomLevel: number;         // current interpolated zoom (0.0–1.0)
  targetZoom: number;        // zoom easing target
  camDist: number;           // derived camera distance
  zoomDomain: DomainName;    // current domain name
  camFocusTarget: { x: number; y: number; z: number } | null;

  // Selection
  selectedEntity: number | null;
  selectedData: Record<string, unknown> | null;

  // Orbit angles (set by input, smoothed by camera)
  targetTheta: number;       // target azimuth angle
  targetPhi: number;         // target polar angle

  // Input state
  dragMoved: boolean;
  dragButton: number;        // which mouse button started the drag (-1 = none)
  overlayMode: boolean;      // strategic overlay (G key)
  destMode: boolean;         // destination selection mode
  destBobIdx: number;        // bob index for dest mode

  // Performance
  fps: number;
}

// ── Game State Controller ────────────────────────────────────────

class GameState {
  data: GameData = {
    gameTime: 0,
    timeSpeedIndex: 4,       // default: DAY/S
    paused: false,
    _lastSpeed: 4,

    zoomLevel: 0.25,
    targetZoom: 0.25,
    camDist: getCamDist(0.25),
    zoomDomain: 'system',
    camFocusTarget: null,

    selectedEntity: null,
    selectedData: null,

    targetTheta: 0.4,
    targetPhi: 1.4,

    dragMoved: false,
    dragButton: -1,
    overlayMode: false,
    destMode: false,
    destBobIdx: -1,

    fps: 0,
  };

  // ── Time ──

  getTimeSpeed(): TimeSpeed {
    const speeds = getActiveTimeSpeeds();
    return speeds[Math.min(this.data.timeSpeedIndex, speeds.length - 1)];
  }

  setTimeSpeed(index: number): void {
    const speeds = getActiveTimeSpeeds();
    const clamped = Math.max(0, Math.min(speeds.length - 1, index));
    this.data.timeSpeedIndex = clamped;
    this.data.paused = clamped === 0;
    if (clamped > 0) this.data._lastSpeed = clamped;

    const speed = speeds[clamped];
    Events.emit('ui:time-speed-changed', {
      index: clamped,
      label: speed.label,
      tc: speed.tc,
    });
  }

  faster(): void {
    this.setTimeSpeed(this.data.timeSpeedIndex + 1);
  }

  slower(): void {
    this.setTimeSpeed(this.data.timeSpeedIndex - 1);
  }

  /** Clamp speed index when switching domains (e.g. entering non-galactic). */
  clampSpeedForDomain(): void {
    const speeds = getActiveTimeSpeeds();
    if (this.data.timeSpeedIndex >= speeds.length) {
      this.setTimeSpeed(speeds.length - 1);
    }
  }

  togglePause(): void {
    if (this.data.paused) {
      this.setTimeSpeed(this.data._lastSpeed || 4);
    } else {
      this.data._lastSpeed = this.data.timeSpeedIndex;
      this.setTimeSpeed(0);
    }
  }

  // ── Zoom Domain ──

  updateZoomDomain(): void {
    const domain = getZoomDomain(this.data.zoomLevel);
    if (this.data.zoomDomain !== domain) {
      const prevDomain = this.data.zoomDomain;
      this.data.zoomDomain = domain;

      // Clamp time speed when switching between galactic and non-galactic
      const wasGalactic = prevDomain === 'galaxy';
      const isGalactic = domain === 'galaxy';
      if (wasGalactic !== isGalactic) {
        this.clampSpeedForDomain();
      }

      Events.emit('camera:zoom-changed', {
        level: this.data.zoomLevel,
        domain,
        distance: this.data.camDist,
      });
    }
  }

  // ── Selection ──

  selectEntity(eid: number, entityData: Record<string, unknown>): void {
    this.data.selectedEntity = eid;
    this.data.selectedData = entityData;
    Events.emit('select:entity', { eid, type: (entityData.type as number) ?? 0 });
  }

  deselectEntity(): void {
    this.data.selectedEntity = null;
    this.data.selectedData = null;
    this.data.camFocusTarget = { x: 0, y: 0, z: 0 };
    Events.emit('select:clear', {} as Record<string, never>);
  }

  // ── Serialization ──

  serialize(): Record<string, unknown> {
    return {
      gameTime: this.data.gameTime,
      timeSpeedIndex: this.data.timeSpeedIndex,
      paused: this.data.paused,
      zoomLevel: this.data.zoomLevel,
    };
  }

  deserialize(saved: Record<string, unknown>): void {
    if (typeof saved.gameTime === 'number') this.data.gameTime = saved.gameTime;
    if (typeof saved.timeSpeedIndex === 'number') this.data.timeSpeedIndex = saved.timeSpeedIndex;
    if (typeof saved.paused === 'boolean') this.data.paused = saved.paused;
    if (typeof saved.zoomLevel === 'number') {
      this.data.zoomLevel = saved.zoomLevel;
      this.data.targetZoom = saved.zoomLevel;
    }
  }
}

// Singleton
export const Game = new GameState();
