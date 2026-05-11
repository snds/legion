// ═══════════════════════════════════════════════════════════════════
// SFX — Sound Effect Management (Howler.js)
// Handles loading, pooling, and playback of UI and game SFX.
// Positional audio uses THREE.PositionalAudio attached to scene
// objects for automatic spatial updates from the scene graph.
//
// Pool management: 20-50 positional audio sources reused when
// sounds finish. Stream long audio; buffer-decode short SFX.
// ═══════════════════════════════════════════════════════════════════

import { Howl, Howler } from 'howler';
import { Events } from '../core/events';

// ── SFX Definitions ──────────────────────────────────────────────

export interface SFXDef {
  id: string;
  src: string[];          // codec fallback chain
  volume?: number;
  rate?: number;
  sprite?: Record<string, [number, number]>;
  pool?: number;          // max simultaneous instances
  spatial?: boolean;      // uses 3D positioning
}

// ── SFX Registry ─────────────────────────────────────────────────

const registry = new Map<string, Howl>();
const spatialPool = new Map<string, number[]>();  // id → playing IDs

/**
 * Register a sound effect definition. Lazy-loads on first play.
 */
export function registerSFX(def: SFXDef): void {
  if (registry.has(def.id)) return;

  const howl = new Howl({
    src: def.src,
    volume: def.volume ?? 1.0,
    rate: def.rate ?? 1.0,
    sprite: def.sprite,
    pool: def.pool ?? 5,
    preload: false,            // lazy load on first play
    html5: false,              // buffer for low latency
  });

  registry.set(def.id, howl);
}

/**
 * Play a registered sound effect.
 * Returns the Howler sound ID for tracking.
 */
export function playSFX(
  id: string,
  sprite?: string,
  volume?: number,
  rate?: number,
): number {
  const howl = registry.get(id);
  if (!howl) {
    console.warn(`[SFX] Unknown sound: ${id}`);
    return -1;
  }

  // Ensure loaded
  if (howl.state() === 'unloaded') {
    howl.load();
  }

  const soundId = sprite ? howl.play(sprite) : howl.play();

  if (volume !== undefined) howl.volume(volume, soundId);
  if (rate !== undefined) howl.rate(rate, soundId);

  return soundId;
}

/**
 * Stop a specific sound instance.
 */
export function stopSFX(id: string, soundId?: number): void {
  const howl = registry.get(id);
  if (!howl) return;

  if (soundId !== undefined) {
    howl.stop(soundId);
  } else {
    howl.stop();
  }
}

/**
 * Preload a set of SFX (call during loading screen).
 */
export function preloadSFX(ids: string[]): Promise<void[]> {
  return Promise.all(ids.map(id => {
    return new Promise<void>((resolve) => {
      const howl = registry.get(id);
      if (!howl) { resolve(); return; }

      if (howl.state() === 'loaded') { resolve(); return; }

      howl.once('load', () => resolve());
      howl.once('loaderror', () => {
        console.warn(`[SFX] Failed to load: ${id}`);
        resolve();
      });
      howl.load();
    });
  }));
}

// ── Default SFX Library ──────────────────────────────────────────

/**
 * Register the standard game SFX set.
 * Call once during initialization. File paths are placeholders —
 * replace with actual asset paths.
 */
export function registerDefaultSFX(): void {
  const defaults: SFXDef[] = [
    { id: 'ui_click',     src: ['assets/sfx/ui-click.webm', 'assets/sfx/ui-click.mp3'],   volume: 0.5 },
    { id: 'ui_hover',     src: ['assets/sfx/ui-hover.webm', 'assets/sfx/ui-hover.mp3'],   volume: 0.2 },
    { id: 'ui_select',    src: ['assets/sfx/ui-select.webm', 'assets/sfx/ui-select.mp3'], volume: 0.6 },
    { id: 'ui_alert',     src: ['assets/sfx/ui-alert.webm', 'assets/sfx/ui-alert.mp3'],   volume: 0.7 },
    { id: 'warp_start',   src: ['assets/sfx/warp-start.webm'],  volume: 0.8, spatial: true },
    { id: 'warp_arrive',  src: ['assets/sfx/warp-arrive.webm'], volume: 0.8, spatial: true },
    { id: 'laser_fire',   src: ['assets/sfx/laser.webm'],       volume: 0.6, spatial: true, pool: 10 },
    { id: 'explosion',    src: ['assets/sfx/explosion.webm'],   volume: 0.9, spatial: true, pool: 8 },
    { id: 'build_start',  src: ['assets/sfx/build-start.webm'], volume: 0.5, spatial: true },
    { id: 'build_done',   src: ['assets/sfx/build-done.webm'],  volume: 0.7, spatial: true },
    { id: 'scan_pulse',   src: ['assets/sfx/scan-pulse.webm'],  volume: 0.4, spatial: true },
    { id: 'replicate',    src: ['assets/sfx/replicate.webm'],   volume: 0.8, spatial: true },
    { id: 'notification', src: ['assets/sfx/notification.webm'], volume: 0.4 },
  ];

  for (const def of defaults) {
    registerSFX(def);
  }
}

// ── Event Integration ────────────────────────────────────────────

export function initSFXEvents(): void {
  Events.on('audio:play-sfx', ({ id }) => {
    playSFX(id);
  });

  Events.on('ui:notification', () => {
    playSFX('notification');
  });

  Events.on('sim:transit-started', () => {
    playSFX('warp_start');
  });

  Events.on('sim:transit-complete', () => {
    playSFX('warp_arrive');
  });

  Events.on('sim:combat-started', () => {
    playSFX('ui_alert');
  });

  Events.on('sim:bob-replicated', () => {
    playSFX('replicate');
  });
}

// ── Cleanup ──────────────────────────────────────────────────────

export function disposeSFX(): void {
  for (const howl of registry.values()) {
    howl.unload();
  }
  registry.clear();
}
