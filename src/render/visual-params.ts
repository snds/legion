// ═══════════════════════════════════════════════════════════════════
// VISUAL PARAMS — Centralized reactive parameter store
// ADMIN VISUAL EDITOR — TEMPORARY
// All shader/material/lighting parameters live here.
// The admin visual editor reads/writes this store.
// Shader update loops read from it each frame.
//
// REMOVAL: Delete this file and hardcode final values into each
// shader/material system once the aesthetic is finalized.
// ═══════════════════════════════════════════════════════════════════

export interface VisualParams {
  // ── Lighting ──
  starLightIntensity: number;
  starLightColor: string;
  ambientIntensity: number;
  ambientColor: string;
  toneMappingExposure: number;

  // ── Post-Processing ──
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  vignetteIntensity: number;
  vignetteDropoff: number;
  smaaEnabled: boolean;
  chromaticAberration: number;  // corner RGB-split offset; 0 = off
  filmGrainIntensity: number;   // 0 = off
  backdropIntensity: number;    // Milky Way cube backdrop multiplier; 0 = off

  // ── Sun ──
  sunPerlinRes: number;
  sunFresnelPower: number;
  sunFresnelInfluence: number;
  sunTint: number;
  sunBrightness: number;
  sunBrightnessOffset: number;
  sunGlowExpand: number;
  sunGlowInner: number;
  sunGlowOuter: number;
  sunGlowIntensity: number;
  sunRayCount: number;
  sunRayWidth: number;
  sunRayLength: number;
  sunRayOpacity: number;
  sunNoiseFrequency: number;
  sunNoiseAmplitude: number;
  sunNoiseSpatialFreq: number;
  sunNoiseTemporalFreq: number;

  // ── Planets ──
  planetSegments: number;
  planetTerminatorSoftness: number;
  planetLimbK: number;
  planetLimbCe: number;
  planetOblatenessScale: number;
  planetTerminatorOffset: number;
  planetSpecularPower: number;
  planetSpecularOffset: number;
  atmosFresnelPower: number;
  atmosCenterFalloff: number;
  atmosEdgeThreshold: number;
  atmosEdgeSoftness: number;
  atmosTwilightBias: number;
  atmosScale: number;
  ringShadowAmbient: number;
  ringShadowSoftnessFactor: number;
  ringShadowStrength: number;

  // ── Asteroid Belt ──
  asteroidCount: number;
  dustCount: number;
  asteroidLightIntensity: number;
  dustLightIntensity: number;
  asteroidDetail: number;
  asteroidNoiseMagnitude: number;
  asteroidCraterProbability: number;
  asteroidMinHue: number;
  asteroidMaxHue: number;
  asteroidMinSat: number;
  asteroidMaxSat: number;

  // ── Scale & Zoom ──
  visualScale: number;
  transitionZoneInner: number;
  transitionZoneOuter: number;

  // ── Lens Flare ──
  lensFlareEnabled: boolean;
  lensFlareOpacity: number;
  lensFlareStarPoints: number;
  lensFlareGlareSize: number;
  lensFlareFlareSize: number;
  lensFlareFlareSpeed: number;
  lensFlareHaloScale: number;
  lensFlareColorR: number;
  lensFlareColorG: number;
  lensFlareColorB: number;

  // ── Particles ──
  bgStarCount: number;
  bgStarSize: number;
  bgStarOpacity: number;
  milkyWayCount: number;
  milkyWaySize: number;
  milkyWayOpacity: number;

}

const DEFAULTS: VisualParams = {
  // Lighting
  starLightIntensity: 1.2,
  starLightColor: '#ffeedd',
  ambientIntensity: 0.15,
  ambientColor: '#000000',
  toneMappingExposure: 0.85,

  // Post-Processing
  bloomStrength: 0.08,   // Karis bloom composite mix factor (threshold-free)
  bloomRadius: 0.6,      // → upsample tent radius ×0.01 in UV
  bloomThreshold: 1.2,   // unused (Karis bloom is threshold-free); kept for VP schema compat
  vignetteIntensity: 0.4,
  vignetteDropoff: 0.25,
  smaaEnabled: true,
  chromaticAberration: 0.0025,
  filmGrainIntensity: 0.035,
  backdropIntensity: 1.0,

  // Sun
  sunPerlinRes: 512,
  sunFresnelPower: 1.5,
  sunFresnelInfluence: 0.25,
  sunTint: 0.55,
  sunBrightness: 1.6,
  sunBrightnessOffset: 0.4,
  sunGlowExpand: 0.08,
  sunGlowInner: 0.35,
  sunGlowOuter: 0.92,
  sunGlowIntensity: 0.4,
  sunRayCount: 2048,
  sunRayWidth: 0.08,
  sunRayLength: 0.02,
  sunRayOpacity: 0.003,
  sunNoiseFrequency: 8,
  sunNoiseAmplitude: 0.4,
  sunNoiseSpatialFreq: 6,
  sunNoiseTemporalFreq: 0.03,

  // Planets
  planetSegments: 64,
  planetTerminatorSoftness: 0.75, // atmospheric bodies; airless are fixed at 0.15
  planetLimbK: 0.85,              // Jónsson limb-darkening incidence exponent
  planetLimbCe: 0.75,             // Jónsson emission-angle threshold
  planetOblatenessScale: 1.0,     // master multiplier on per-class flattening
  planetTerminatorOffset: -0.25,
  planetSpecularPower: 32,
  planetSpecularOffset: 0.2,
  atmosFresnelPower: 8,
  atmosCenterFalloff: 1.0,
  atmosEdgeThreshold: 0.4,
  atmosEdgeSoftness: 0.2,
  atmosTwilightBias: 1.6,
  atmosScale: 1.08,
  ringShadowAmbient: 0.28,
  ringShadowSoftnessFactor: 0.15,
  ringShadowStrength: 0.85,

  // Asteroid Belt
  asteroidCount: 2000,
  dustCount: 1000,
  // Full-strength Lambert: rock form comes from lit/shadow facet contrast
  // (the old 0.2/0.27 + 0.08 ambient rendered the belt as flat blobs).
  asteroidLightIntensity: 1.0,
  dustLightIntensity: 1.0,
  asteroidDetail: 2,
  asteroidNoiseMagnitude: 0.3,
  asteroidCraterProbability: 0.5,
  asteroidMinHue: 0.06,
  asteroidMaxHue: 0.08,
  asteroidMinSat: 0.18,
  asteroidMaxSat: 0.40,

  // Scale & Zoom
  visualScale: 1.5,
  transitionZoneInner: 100,
  transitionZoneOuter: 140,

  // Lens Flare
  lensFlareEnabled: true,
  lensFlareOpacity: 0.04,
  lensFlareStarPoints: 5,
  lensFlareGlareSize: 0.45,
  lensFlareFlareSize: 0.004,
  lensFlareFlareSpeed: 0.4,
  lensFlareHaloScale: 0.5,
  lensFlareColorR: 95,
  lensFlareColorG: 12,
  lensFlareColorB: 10,

  // Particles
  bgStarCount: 8000,
  bgStarSize: 100,
  bgStarOpacity: 0.85,
  milkyWayCount: 25000,
  milkyWaySize: 150,
  milkyWayOpacity: 0.25,

};

type Listener = (key: keyof VisualParams, value: number | string | boolean) => void;

// User-facing graphics settings persisted across reloads (the Settings panel
// writes these). Only this allowlist is saved — the rest of VP is dev-only
// admin tuning and must always start from DEFAULTS so code changes take effect.
const PERSIST_KEYS: (keyof VisualParams)[] = [
  'chromaticAberration', 'filmGrainIntensity', 'backdropIntensity',
  'bloomStrength', 'vignetteIntensity', 'smaaEnabled', 'visualScale',
];
const STORAGE_KEY = 'legion-graphics-settings';

class VisualParamsStore {
  private data: VisualParams;
  private listeners: Listener[] = [];

  constructor() {
    this.data = { ...DEFAULTS };
    // Restore persisted user graphics settings over the defaults.
    try {
      const raw = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<VisualParams>;
        for (const k of PERSIST_KEYS) {
          if (saved[k] !== undefined) (this.data[k] as unknown) = saved[k];
        }
      }
    } catch { /* ignore corrupt storage */ }
  }

  private persist(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const out: Partial<VisualParams> = {};
      for (const k of PERSIST_KEYS) (out[k] as unknown) = this.data[k];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch { /* storage full / denied — non-fatal */ }
  }

  get<K extends keyof VisualParams>(key: K): VisualParams[K] {
    return this.data[key];
  }

  set<K extends keyof VisualParams>(key: K, value: VisualParams[K]): void {
    if (this.data[key] === value) return;
    this.data[key] = value;
    for (const fn of this.listeners) {
      fn(key, value as number | string | boolean);
    }
    if (PERSIST_KEYS.includes(key)) this.persist();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      const idx = this.listeners.indexOf(fn);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  reset(): void {
    const keys = Object.keys(DEFAULTS) as (keyof VisualParams)[];
    for (const k of keys) {
      this.set(k, DEFAULTS[k]);
    }
  }

  exportJSON(): string {
    return JSON.stringify(this.data, null, 2);
  }

  importJSON(json: string): void {
    try {
      const obj = JSON.parse(json) as Partial<VisualParams>;
      const keys = Object.keys(DEFAULTS) as (keyof VisualParams)[];
      for (const k of keys) {
        if (k in obj) {
          this.set(k, obj[k] as VisualParams[typeof k]);
        }
      }
    } catch (e) {
      console.error('[VisualParams] Failed to import JSON:', e);
    }
  }

  getAll(): Readonly<VisualParams> {
    return this.data;
  }

  getDefaults(): Readonly<VisualParams> {
    return DEFAULTS;
  }
}

export const VP = new VisualParamsStore();

// Debug: expose VP on window for console access
(globalThis as Record<string, unknown>).__VP = VP;
