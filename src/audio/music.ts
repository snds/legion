// ═══════════════════════════════════════════════════════════════════
// ADAPTIVE MUSIC — Tone.js Layered Music Engine
// Horizontal re-sequencing (different track sets per zoom domain)
// combined with vertical remixing (stem layering by engagement).
//
// Transport provides BPM-synced scheduling. CrossFade enables
// smooth transitions between zoom-level track sets at beat
// boundaries for musically coherent transitions.
// ═══════════════════════════════════════════════════════════════════

import * as Tone from 'tone';
import { Events } from '../core/events';

// ── Music State ──────────────────────────────────────────────────

export enum MusicState {
  Idle      = 'idle',
  Exploring = 'exploring',
  Building  = 'building',
  Combat    = 'combat',
  Discovery = 'discovery',
  Tension   = 'tension',
}

export enum ZoomLayer {
  Galaxy  = 'galaxy',
  System  = 'system',
  Planet  = 'planet',
  Surface = 'surface',
}

// ── Track Set Definition ─────────────────────────────────────────

export interface MusicStem {
  name: string;
  url: string;
  baseVolume: number;    // 0-1
}

export interface TrackSet {
  zoomLayer: ZoomLayer;
  bpm: number;
  stems: MusicStem[];
}

// ── Music Engine ─────────────────────────────────────────────────

class MusicEngine {
  private players = new Map<string, Tone.Player>();
  private gains = new Map<string, Tone.Gain>();
  private crossFade: Tone.CrossFade | null = null;
  private masterGain: Tone.Gain | null = null;

  private currentLayer = ZoomLayer.System;
  private currentState = MusicState.Idle;
  private trackSets = new Map<ZoomLayer, TrackSet>();
  private activeLayer: 'A' | 'B' = 'A';

  private initialized = false;

  // ── Initialization ──

  /**
   * Initialize the music system. Call after user gesture.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await Tone.start();

    this.masterGain = new Tone.Gain(0.6).toDestination();
    this.crossFade = new Tone.CrossFade(0).connect(this.masterGain);

    this.initialized = true;
    this.subscribeToEvents();

    console.info('[Music] Tone.js initialized');
  }

  // ── Track Set Registration ──

  /**
   * Register a track set for a zoom layer.
   * Track sets contain multiple stems that can be independently mixed.
   */
  registerTrackSet(set: TrackSet): void {
    this.trackSets.set(set.zoomLayer, set);
  }

  /**
   * Register default placeholder track sets.
   * Replace URLs with actual music assets.
   */
  registerDefaultTrackSets(): void {
    const defaults: TrackSet[] = [
      {
        zoomLayer: ZoomLayer.Galaxy,
        bpm: 60,
        stems: [
          { name: 'pad',    url: 'assets/music/galaxy-pad.webm',    baseVolume: 0.8 },
          { name: 'melody', url: 'assets/music/galaxy-melody.webm', baseVolume: 0.4 },
          { name: 'pulse',  url: 'assets/music/galaxy-pulse.webm',  baseVolume: 0.3 },
        ],
      },
      {
        zoomLayer: ZoomLayer.System,
        bpm: 80,
        stems: [
          { name: 'pad',    url: 'assets/music/system-pad.webm',    baseVolume: 0.7 },
          { name: 'rhythm', url: 'assets/music/system-rhythm.webm', baseVolume: 0.5 },
          { name: 'lead',   url: 'assets/music/system-lead.webm',   baseVolume: 0.3 },
        ],
      },
      {
        zoomLayer: ZoomLayer.Planet,
        bpm: 90,
        stems: [
          { name: 'atmosphere', url: 'assets/music/planet-atmos.webm',  baseVolume: 0.6 },
          { name: 'texture',    url: 'assets/music/planet-tex.webm',    baseVolume: 0.5 },
          { name: 'percussion', url: 'assets/music/planet-perc.webm',   baseVolume: 0.4 },
        ],
      },
      {
        zoomLayer: ZoomLayer.Surface,
        bpm: 100,
        stems: [
          { name: 'base',    url: 'assets/music/surface-base.webm',    baseVolume: 0.7 },
          { name: 'detail',  url: 'assets/music/surface-detail.webm',  baseVolume: 0.5 },
          { name: 'tension', url: 'assets/music/surface-tension.webm', baseVolume: 0.2 },
        ],
      },
    ];

    for (const set of defaults) {
      this.registerTrackSet(set);
    }
  }

  // ── Playback ──

  /**
   * Transition to a new zoom layer. Crossfades at the next beat boundary.
   */
  setZoomLayer(layer: ZoomLayer): void {
    if (layer === this.currentLayer || !this.initialized) return;
    this.currentLayer = layer;
    this.scheduleCrossfade(layer);
  }

  /**
   * Set the engagement state. Adjusts stem volumes for vertical remixing.
   */
  setState(state: MusicState): void {
    if (state === this.currentState) return;
    this.currentState = state;
    this.updateStemMix();
  }

  // ── Internal ──

  private scheduleCrossfade(toLayer: ZoomLayer): void {
    if (!this.crossFade) return;

    const trackSet = this.trackSets.get(toLayer);
    if (!trackSet) return;

    // Schedule transition at next beat boundary
    const nextBeat = Tone.Transport.nextSubdivision('1m');

    Tone.Transport.schedule(() => {
      // Fade crossfade position
      const targetFade = this.activeLayer === 'A' ? 1 : 0;
      this.crossFade!.fade.rampTo(targetFade, 2);
      this.activeLayer = this.activeLayer === 'A' ? 'B' : 'A';

      // Update BPM
      Tone.Transport.bpm.rampTo(trackSet.bpm, 4);
    }, nextBeat);
  }

  private updateStemMix(): void {
    // Adjust stem volumes based on engagement state
    const stateMultipliers: Record<MusicState, Record<string, number>> = {
      [MusicState.Idle]:      { pad: 1.0, melody: 0.3, rhythm: 0.2, percussion: 0.1, tension: 0.0 },
      [MusicState.Exploring]: { pad: 0.8, melody: 0.7, rhythm: 0.4, percussion: 0.3, tension: 0.0 },
      [MusicState.Building]:  { pad: 0.6, melody: 0.4, rhythm: 0.8, percussion: 0.6, tension: 0.0 },
      [MusicState.Combat]:    { pad: 0.3, melody: 0.2, rhythm: 1.0, percussion: 1.0, tension: 0.9 },
      [MusicState.Discovery]: { pad: 0.9, melody: 1.0, rhythm: 0.3, percussion: 0.2, tension: 0.0 },
      [MusicState.Tension]:   { pad: 0.5, melody: 0.3, rhythm: 0.6, percussion: 0.5, tension: 1.0 },
    };

    const multipliers = stateMultipliers[this.currentState];

    for (const [key, gain] of this.gains) {
      // Find matching multiplier by stem name keywords
      let mult = 0.5; // default
      for (const [keyword, value] of Object.entries(multipliers)) {
        if (key.includes(keyword)) {
          mult = value;
          break;
        }
      }
      gain.gain.rampTo(mult, 1);
    }
  }

  // ── Event Subscriptions ──

  private subscribeToEvents(): void {
    Events.on('camera:zoom-changed', ({ domain }) => {
      switch (domain) {
        case 'GALACTIC':
        case 'REGIONAL':
          this.setZoomLayer(ZoomLayer.Galaxy);
          break;
        case 'DEEP':
        case 'SYSTEM':
          this.setZoomLayer(ZoomLayer.System);
          break;
        case 'ORBITAL':
          this.setZoomLayer(ZoomLayer.Planet);
          break;
        case 'SURFACE':
          this.setZoomLayer(ZoomLayer.Surface);
          break;
      }
    });

    Events.on('audio:set-music-state', ({ state }) => {
      this.setState(state as MusicState);
    });

    Events.on('sim:combat-started', () => this.setState(MusicState.Combat));
    Events.on('sim:combat-ended', () => this.setState(MusicState.Exploring));
    Events.on('sim:system-explored', () => this.setState(MusicState.Discovery));
  }

  // ── Cleanup ──

  dispose(): void {
    for (const player of this.players.values()) {
      player.dispose();
    }
    this.players.clear();
    this.gains.clear();
    this.crossFade?.dispose();
    this.masterGain?.dispose();
    this.initialized = false;
  }
}

// Singleton
export const Music = new MusicEngine();
