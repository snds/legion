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
import { gameTimeToEt } from './time';

// ── Zoom Step Definitions ────────────────────────────────────────

export interface ZoomStep {
  label: string;
  val: number;       // position on 0–1 scale
}

// Nine named zoom tiers — refined from the prototype's six.
// The middle four ('low-orbit', 'orbit', 'inner-system', 'outer-system')
// split the old monolithic 'system' tier so the player can frame:
//   surface       — top-down high-altitude over a single planet
//   low-orbit     — satellite POV, atmosphere visible between camera and surface
//   orbit         — out past the first natural satellite; ship/station workspace
//   inner-system  — star + primary rocky planets, their full orbits
//   outer-system  — outer planets, comets, Oort cloud
//   heliopause    — system bubble + the 2-3 nearest navigable systems
//   sector        — local-arm patch, ~10-12 navigable neighbors
//   arm           — full extent of the Orion Spur / local galactic arm
//   galaxy        — the whole Milky Way at the bounds of the image
export const ZOOM_STEPS: ZoomStep[] = [
  { label: 'SURFACE',       val: 0.03  },
  { label: 'LOW ORBIT',     val: 0.085 },
  { label: 'ORBIT',         val: 0.155 },
  { label: 'INNER SYSTEM',  val: 0.260 },
  { label: 'OUTER SYSTEM',  val: 0.390 },
  { label: 'HELIOPAUSE',    val: 0.530 },
  { label: 'SECTOR',        val: 0.670 },
  { label: 'ARM',           val: 0.810 },
  { label: 'GALAXY',        val: 0.940 },
];

// ── Time Speed Definitions ───────────────────────────────────────
// Index 0 = PAUSED. Speeds 1–7 map to TIME_SPEEDS[1]–[7].
// tc is in seconds of game-time per real second.

export interface TimeSpeed {
  label: string;
  tc: number;        // time compression (seconds per real second)
  orbit: number;     // orbit animation speed multiplier
}

// Two speed tables: local and galactic. The active table is selected by zoom
// domain. Because every celestial body is propagated on-rails (analytic Kepler,
// stable at any compression — see docs §4), the system-view table now reaches
// the same generous range as the galactic one: real orbital periods mean you
// warp up to DAY/S–YR/S to watch planets move. The two tables are kept separate
// so future warp-gating (the integrating-vessel case, doc §4.5) can diverge them.

export const LOCAL_TIME_SPEEDS: TimeSpeed[] = [
  { label: 'PAUSED', tc: 0,             orbit: 0 },
  { label: '1×',     tc: 1,             orbit: 1 },
  { label: '60×',    tc: 60,            orbit: 8 },
  { label: 'HR/S',   tc: 3600,          orbit: 30 },
  { label: 'DAY/S',  tc: 86400,         orbit: 80 },
  { label: 'WK/S',   tc: 86400 * 7,     orbit: 150 },
  { label: 'MO/S',   tc: 86400 * 30,    orbit: 300 },
  { label: 'YR/S',   tc: 86400 * 365,   orbit: 600 },
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
  const d = Game.data.zoomDomain;
  // Wide-area views (arm, galaxy) unlock the full galactic compression table
  // so the player can fast-forward through interstellar transits.
  return (d === 'galaxy' || d === 'arm') ? GALACTIC_TIME_SPEEDS : LOCAL_TIME_SPEEDS;
}

// Legacy alias — some modules still import TIME_SPEEDS directly
export const TIME_SPEEDS = GALACTIC_TIME_SPEEDS;

// ── Domain Detection ─────────────────────────────────────────────
// Derives domain name from zoom level (0–1).

export type DomainName =
  | 'surface'
  | 'low-orbit'
  | 'orbit'
  | 'inner-system'
  | 'outer-system'
  | 'heliopause'
  | 'sector'
  | 'arm'
  | 'galaxy';

// Tier breakpoints on the 0..1 zoom axis. Picked so each named tier
// occupies a comfortable slice of the wheel and the hotkey snaps in
// ZOOM_STEPS land roughly in the middle of each tier.
const T_SURFACE   = 0.06;
export const T_LOW_ORBIT = 0.11;
export const T_ORBIT     = 0.21;
const T_INNER_SYS = 0.32;
const T_OUTER_SYS = 0.46;
const T_HELIO     = 0.60;
const T_SECTOR    = 0.74;
const T_ARM       = 0.88;

export function getZoomDomain(z: number): DomainName {
  if (z < T_SURFACE)   return 'surface';
  if (z < T_LOW_ORBIT) return 'low-orbit';
  if (z < T_ORBIT)     return 'orbit';
  if (z < T_INNER_SYS) return 'inner-system';
  if (z < T_OUTER_SYS) return 'outer-system';
  if (z < T_HELIO)     return 'heliopause';
  if (z < T_SECTOR)    return 'sector';
  if (z < T_ARM)       return 'arm';
  return 'galaxy';
}

/**
 * Piecewise camera distance curve in world units.
 * Distances are chosen so an Earth-analog planet (radius ~0.3 WU,
 * first moon at ~1.9 WU) sits naturally framed in each tier with FOV 32–72.
 *
 *   surface       0.6 →  2.5   high-altitude top-down on a planet
 *   low-orbit     2.5 →  6     satellite altitude, clouds in foreground
 *   orbit         6   →  25    parent + first moon(s) + stations/ships
 *   inner-system  25  →  120   star + inner rocky planets, full orbits
 *   outer-system  120 → 1000   outer planets, comets, Oort cloud
 *   heliopause    1000→ 2800   system bubble + 2-3 nearest neighbors
 *   sector        2800→ 5500   local-arm patch with sensor-bubble visual
 *   arm           5500→ 9500   immersed inside the Orion Spur particles
 *   galaxy        9500→ 16000  full Milky Way disc edge-to-edge in viewport
 *
 * Each segment is linear in z; the curve is C0-continuous at every
 * breakpoint, which keeps the zoom feel smooth across tier boundaries.
 */
export function getCamDist(z: number): number {
  // Helper: linear interp between (z0,d0)→(z1,d1)
  const lerpDist = (z0: number, z1: number, d0: number, d1: number): number =>
    d0 + (z - z0) / (z1 - z0) * (d1 - d0);

  if (z < T_SURFACE)   return lerpDist(0,             T_SURFACE,    0.6,    2.5);
  if (z < T_LOW_ORBIT) return lerpDist(T_SURFACE,     T_LOW_ORBIT,  2.5,    6.0);
  if (z < T_ORBIT)     return lerpDist(T_LOW_ORBIT,   T_ORBIT,      6.0,    25);
  if (z < T_INNER_SYS) return lerpDist(T_ORBIT,       T_INNER_SYS,  25,     120);
  if (z < T_OUTER_SYS) return lerpDist(T_INNER_SYS,   T_OUTER_SYS,  120,    1000);
  if (z < T_HELIO)     return lerpDist(T_OUTER_SYS,   T_HELIO,      1000,   2800);
  // Phase 2c-1: the neighbourhood→galaxy span crosses ~4 orders of magnitude
  // (2800 WU home bubble → 3.6e7 WU full galaxy frame, the disc now a unified
  // 1.5e7-WU radius), so a GEOMETRIC (log-uniform) curve — a constant camDist
  // RATIO per wheel tick — is what makes the continuous-zoom dive-in smooth.
  // 2800 at z=T_HELIO is C0-continuous with the linear segment above; 3.6e7 at
  // z=1.0 frames the disc edge-to-edge from outside. Sector ≈ 7.7e4, arm ≈ 2.1e6
  // fall on this curve. Phase 3 may retune endpoints; the geometric shape is the
  // point (linear segments across 4 orders felt like jump-cuts).
  const GAL_NEAR = 2800;  // z = T_HELIO  (home bubble + nearest neighbours)
  const GAL_FAR = 3.6e7;  // z = 1.0      (full Milky Way disc framed from outside)
  const tg = (z - T_HELIO) / (1.0 - T_HELIO);
  return GAL_NEAR * Math.pow(GAL_FAR / GAL_NEAR, tg);
}

// ── State Shape ──────────────────────────────────────────────────

export interface GameData {
  // Time
  gameTime: number;          // elapsed game-time in SECONDS since GAME_EPOCH (et = epoch + gameTime)
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
    timeSpeedIndex: 1,       // default: 1× (real-time)
    paused: false,
    _lastSpeed: 1,

    zoomLevel: 0.26,
    targetZoom: 0.26,
    camDist: getCamDist(0.26),
    zoomDomain: 'inner-system',
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

  /** Ephemeris time (TDB seconds past J2000) for the current game-time. */
  currentEt(): number {
    return gameTimeToEt(this.data.gameTime);
  }

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

      // Clamp time speed when switching between galactic and non-galactic.
      // "Galactic" now includes arm view (matches getActiveTimeSpeeds).
      const wasGalactic = prevDomain === 'galaxy' || prevDomain === 'arm';
      const isGalactic = domain === 'galaxy' || domain === 'arm';
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
