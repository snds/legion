// ═══════════════════════════════════════════════════════════════════
// AUDIO MANAGER — Master Bus Architecture
// Three libraries, each handling what it does best, sharing a
// single AudioContext:
//
//   Music Bus   → Tone.js (adaptive, BPM-synced)
//   SFX Bus     → Howler.js + THREE.PositionalAudio (spatial)
//   Ambient Bus → Howler.js (layered soundscapes)
//   Master Bus  → Raw Web Audio (GainNode → DynamicsCompressor)
//
// Dynamic mixing adjusts bus levels based on game state:
//   Combat → ducks music 30%, ambient 20%, boosts SFX
//   Galaxy view → emphasizes music
//   Planet view → emphasizes SFX
// ═══════════════════════════════════════════════════════════════════

import { Events } from '../core/events';

// ── Bus Configuration ────────────────────────────────────────────

export interface BusConfig {
  musicVolume: number;     // 0-1
  sfxVolume: number;
  ambientVolume: number;
  masterVolume: number;
}

const DEFAULT_VOLUMES: BusConfig = {
  musicVolume: 0.6,
  sfxVolume: 0.8,
  ambientVolume: 0.4,
  masterVolume: 0.85,
};

// ── Mix Profiles ─────────────────────────────────────────────────

export enum MixProfile {
  Default   = 'default',
  Combat    = 'combat',
  Galaxy    = 'galaxy',
  System    = 'system',
  Surface   = 'surface',
  Menu      = 'menu',
}

const MIX_PROFILES: Record<MixProfile, BusConfig> = {
  [MixProfile.Default]: { musicVolume: 0.6, sfxVolume: 0.8, ambientVolume: 0.4, masterVolume: 0.85 },
  [MixProfile.Combat]:  { musicVolume: 0.3, sfxVolume: 1.0, ambientVolume: 0.2, masterVolume: 0.9 },
  [MixProfile.Galaxy]:  { musicVolume: 0.8, sfxVolume: 0.3, ambientVolume: 0.6, masterVolume: 0.85 },
  [MixProfile.System]:  { musicVolume: 0.6, sfxVolume: 0.6, ambientVolume: 0.5, masterVolume: 0.85 },
  [MixProfile.Surface]: { musicVolume: 0.4, sfxVolume: 1.0, ambientVolume: 0.3, masterVolume: 0.85 },
  [MixProfile.Menu]:    { musicVolume: 0.7, sfxVolume: 0.5, ambientVolume: 0.2, masterVolume: 0.8 },
};

// ── Audio Manager ────────────────────────────────────────────────

class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;

  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;

  private currentProfile: MixProfile = MixProfile.Default;
  private targetVolumes: BusConfig = { ...DEFAULT_VOLUMES };
  private currentVolumes: BusConfig = { ...DEFAULT_VOLUMES };
  private userVolumes: BusConfig = { ...DEFAULT_VOLUMES };

  private initialized = false;
  private muted = false;

  // ── Initialization ──

  /**
   * Initialize the audio context. Must be called after a user gesture
   * (click/key) due to browser autoplay policies.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      this.ctx = new AudioContext();

      // Master compressor → destination
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -24;
      this.compressor.knee.value = 30;
      this.compressor.ratio.value = 12;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.25;
      this.compressor.connect(this.ctx.destination);

      // Master gain → compressor
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = DEFAULT_VOLUMES.masterVolume;
      this.masterGain.connect(this.compressor);

      // Bus gains → master
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = DEFAULT_VOLUMES.musicVolume;
      this.musicGain.connect(this.masterGain);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = DEFAULT_VOLUMES.sfxVolume;
      this.sfxGain.connect(this.masterGain);

      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.value = DEFAULT_VOLUMES.ambientVolume;
      this.ambientGain.connect(this.masterGain);

      this.initialized = true;
      this.subscribeToEvents();

      console.info('[Audio] Initialized: AudioContext ready');
    } catch (err) {
      console.warn('[Audio] Failed to initialize AudioContext:', err);
    }
  }

  /** Resume the audio context (call on user interaction) */
  async resume(): Promise<void> {
    if (this.ctx?.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  // ── Bus Getters ──

  get audioContext(): AudioContext | null { return this.ctx; }
  get musicBus(): GainNode | null { return this.musicGain; }
  get sfxBus(): GainNode | null { return this.sfxGain; }
  get ambientBus(): GainNode | null { return this.ambientGain; }

  // ── Mix Profile ──

  /**
   * Switch to a mix profile. Volumes ease smoothly to new targets.
   */
  setProfile(profile: MixProfile): void {
    if (profile === this.currentProfile) return;
    this.currentProfile = profile;
    this.targetVolumes = {
      ...MIX_PROFILES[profile],
      // Apply user volume overrides
      masterVolume: this.userVolumes.masterVolume,
    };
  }

  /**
   * Update mix volumes each frame (smooth easing).
   * Call from the game loop.
   */
  updateMix(dt: number): void {
    if (!this.initialized || this.muted) return;

    const ease = 1 - Math.pow(0.01, dt); // ~60ms to 90%

    this.currentVolumes.musicVolume = lerp(this.currentVolumes.musicVolume, this.targetVolumes.musicVolume, ease);
    this.currentVolumes.sfxVolume = lerp(this.currentVolumes.sfxVolume, this.targetVolumes.sfxVolume, ease);
    this.currentVolumes.ambientVolume = lerp(this.currentVolumes.ambientVolume, this.targetVolumes.ambientVolume, ease);
    this.currentVolumes.masterVolume = lerp(this.currentVolumes.masterVolume, this.targetVolumes.masterVolume, ease);

    // Apply to gain nodes
    if (this.musicGain) this.musicGain.gain.value = this.currentVolumes.musicVolume;
    if (this.sfxGain) this.sfxGain.gain.value = this.currentVolumes.sfxVolume;
    if (this.ambientGain) this.ambientGain.gain.value = this.currentVolumes.ambientVolume;
    if (this.masterGain) this.masterGain.gain.value = this.currentVolumes.masterVolume;
  }

  // ── User Volume Controls ──

  setMasterVolume(v: number): void {
    this.userVolumes.masterVolume = Math.max(0, Math.min(1, v));
    this.targetVolumes.masterVolume = this.userVolumes.masterVolume;
  }

  setMusicVolume(v: number): void {
    this.userVolumes.musicVolume = Math.max(0, Math.min(1, v));
    this.targetVolumes.musicVolume = this.userVolumes.musicVolume;
  }

  setSfxVolume(v: number): void {
    this.userVolumes.sfxVolume = Math.max(0, Math.min(1, v));
    this.targetVolumes.sfxVolume = this.userVolumes.sfxVolume;
  }

  setAmbientVolume(v: number): void {
    this.userVolumes.ambientVolume = Math.max(0, Math.min(1, v));
    this.targetVolumes.ambientVolume = this.userVolumes.ambientVolume;
  }

  // ── Mute ──

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : this.currentVolumes.masterVolume;
    }
  }

  get isMuted(): boolean { return this.muted; }

  // ── Event Subscriptions ──

  private subscribeToEvents(): void {
    Events.on('camera:zoom-changed', ({ domain }) => {
      switch (domain) {
        case 'GALACTIC':
        case 'REGIONAL':
          this.setProfile(MixProfile.Galaxy);
          break;
        case 'DEEP':
        case 'SYSTEM':
          this.setProfile(MixProfile.System);
          break;
        case 'ORBITAL':
        case 'SURFACE':
          this.setProfile(MixProfile.Surface);
          break;
      }
    });

    Events.on('sim:combat-started', () => {
      this.setProfile(MixProfile.Combat);
    });

    Events.on('sim:combat-ended', () => {
      this.setProfile(MixProfile.Default);
    });
  }

  // ── Serialization ──

  serialize(): Record<string, unknown> {
    return {
      userVolumes: { ...this.userVolumes },
      muted: this.muted,
    };
  }

  deserialize(data: Record<string, unknown>): void {
    if (data.userVolumes) {
      this.userVolumes = data.userVolumes as BusConfig;
    }
    if (typeof data.muted === 'boolean') {
      this.muted = data.muted;
    }
  }

  // ── Cleanup ──

  dispose(): void {
    this.ctx?.close();
    this.initialized = false;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Singleton
export const Audio = new AudioManager();
