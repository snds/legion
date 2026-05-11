// ═══════════════════════════════════════════════════════════════════
// AMBIENCE — Layered Soundscape System (Howler.js)
// Multiple concurrent ambient loops with independent volume control.
// Layers crossfade based on zoom domain and environment context.
//
// Each layer is a looping Howl instance with smooth volume ramping.
// Total ambient mix stays within the ambient bus budget set by
// the Audio Manager's mix profile.
// ═══════════════════════════════════════════════════════════════════

import { Howl } from 'howler';
import { Events } from '../core/events';

// ── Layer Definition ─────────────────────────────────────────────

export interface AmbienceLayer {
  id: string;
  src: string[];
  baseVolume: number;
  loop: boolean;
  fadeTime: number;        // seconds for volume transitions
}

// ── Layer State ──────────────────────────────────────────────────

interface ActiveLayer {
  howl: Howl;
  soundId: number;
  targetVolume: number;
  currentVolume: number;
  fadeTime: number;
}

// ── Ambience Manager ─────────────────────────────────────────────

class AmbienceManager {
  private layers = new Map<string, ActiveLayer>();
  private definitions = new Map<string, AmbienceLayer>();
  private initialized = false;

  /**
   * Register an ambient layer definition. Does not start playback.
   */
  register(def: AmbienceLayer): void {
    this.definitions.set(def.id, def);
  }

  /**
   * Register the default ambient layer set.
   * Replace URLs with actual ambient assets.
   */
  registerDefaults(): void {
    const defaults: AmbienceLayer[] = [
      { id: 'deep_space',    src: ['assets/amb/deep-space.webm'],    baseVolume: 0.3, loop: true, fadeTime: 3 },
      { id: 'stellar_wind',  src: ['assets/amb/stellar-wind.webm'],  baseVolume: 0.2, loop: true, fadeTime: 4 },
      { id: 'system_hum',    src: ['assets/amb/system-hum.webm'],    baseVolume: 0.25, loop: true, fadeTime: 2 },
      { id: 'planetary',     src: ['assets/amb/planetary.webm'],     baseVolume: 0.35, loop: true, fadeTime: 2 },
      { id: 'machinery',     src: ['assets/amb/machinery.webm'],     baseVolume: 0.15, loop: true, fadeTime: 1.5 },
      { id: 'tension_drone', src: ['assets/amb/tension-drone.webm'], baseVolume: 0.2, loop: true, fadeTime: 2 },
    ];

    for (const def of defaults) {
      this.register(def);
    }
  }

  /**
   * Start or resume a layer at its base volume.
   */
  startLayer(id: string, volume?: number): void {
    const def = this.definitions.get(id);
    if (!def) return;

    let active = this.layers.get(id);
    if (active) {
      // Already playing — just adjust volume
      active.targetVolume = volume ?? def.baseVolume;
      return;
    }

    const howl = new Howl({
      src: def.src,
      loop: def.loop,
      volume: 0, // start silent, fade in
      html5: true, // stream for memory efficiency
    });

    const soundId = howl.play();
    active = {
      howl,
      soundId,
      targetVolume: volume ?? def.baseVolume,
      currentVolume: 0,
      fadeTime: def.fadeTime,
    };

    this.layers.set(id, active);
  }

  /**
   * Fade a layer to a specific volume (0 = mute but keep loaded).
   */
  setLayerVolume(id: string, volume: number): void {
    const active = this.layers.get(id);
    if (active) {
      active.targetVolume = Math.max(0, Math.min(1, volume));
    }
  }

  /**
   * Stop and unload a layer entirely.
   */
  stopLayer(id: string): void {
    const active = this.layers.get(id);
    if (!active) return;

    active.howl.fade(active.currentVolume, 0, active.fadeTime * 1000);
    active.howl.once('fade', () => {
      active.howl.stop();
      active.howl.unload();
    });
    this.layers.delete(id);
  }

  /**
   * Update volume easing for all active layers.
   * Call once per frame from the game loop.
   */
  update(dt: number): void {
    for (const [id, layer] of this.layers) {
      if (Math.abs(layer.currentVolume - layer.targetVolume) < 0.001) continue;

      const rate = dt / Math.max(0.1, layer.fadeTime);
      const ease = Math.min(1, rate);

      layer.currentVolume += (layer.targetVolume - layer.currentVolume) * ease;
      layer.howl.volume(layer.currentVolume, layer.soundId);
    }
  }

  /**
   * Switch ambient mix to match a zoom domain.
   */
  setZoomDomain(domain: string): void {
    // Define which layers are active at each zoom level
    const profiles: Record<string, Record<string, number>> = {
      GALACTIC:  { deep_space: 0.4, stellar_wind: 0.3, system_hum: 0, planetary: 0, machinery: 0 },
      REGIONAL:  { deep_space: 0.3, stellar_wind: 0.2, system_hum: 0.1, planetary: 0, machinery: 0 },
      DEEP:      { deep_space: 0.2, stellar_wind: 0.1, system_hum: 0.25, planetary: 0, machinery: 0 },
      SYSTEM:    { deep_space: 0.1, stellar_wind: 0, system_hum: 0.3, planetary: 0.1, machinery: 0.1 },
      ORBITAL:   { deep_space: 0.05, stellar_wind: 0, system_hum: 0.15, planetary: 0.35, machinery: 0.15 },
      SURFACE:   { deep_space: 0, stellar_wind: 0, system_hum: 0, planetary: 0.4, machinery: 0.3 },
    };

    const profile = profiles[domain];
    if (!profile) return;

    for (const [layerId, volume] of Object.entries(profile)) {
      if (volume > 0) {
        this.startLayer(layerId);
        this.setLayerVolume(layerId, volume);
      } else {
        this.setLayerVolume(layerId, 0);
      }
    }
  }

  /**
   * Initialize event subscriptions.
   */
  initEvents(): void {
    if (this.initialized) return;
    this.initialized = true;

    Events.on('camera:zoom-changed', ({ domain }) => {
      this.setZoomDomain(domain);
    });

    Events.on('audio:set-ambience', ({ layer, volume }) => {
      this.startLayer(layer);
      this.setLayerVolume(layer, volume);
    });
  }

  /**
   * Stop all layers and release resources.
   */
  dispose(): void {
    for (const [id] of this.layers) {
      this.stopLayer(id);
    }
    this.layers.clear();
  }
}

// Singleton
export const Ambience = new AmbienceManager();
