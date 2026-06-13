// ═══════════════════════════════════════════════════════════════════
// GALAXY LAB — live tuning surface for the galaxy visuals (TEMPORARY)
//
// A dev control surface for nudging the galaxy look on the fly at the
// galaxy tier, where headless verification times out and only live eyes
// can judge the result. Every knob defaults to the value baked into the
// shared density model (galaxy-density.ts) or the material, so with the
// panel untouched the galaxy renders EXACTLY as the committed model —
// the panel only OVERRIDES at runtime.
//
// Two classes of knob:
//   • VOLUME uniforms — promoted from constants in galaxy-density.glsl.ts
//     to material uniforms (defaults = the constants). Written directly
//     by applyGalaxyTune(); take effect on the next frame at galaxy tier.
//   • LOD-driven knobs (particle size, nebula opacity) — the per-frame
//     LOD updater overwrites these, so it MULTIPLIES in the tune value.
//   • Nebula SIZE — set once at sprite creation; resized directly here.
//
// Values persist to localStorage so iterative tuning survives reloads.
//
// REMOVAL: delete this file + galaxy-lab-panel.ts, drop the
// galaxyLabVolumeUniforms() spread + register* calls in galaxy.ts, and
// re-bake the chosen values into the galaxy-density.ts constants.
// ═══════════════════════════════════════════════════════════════════

import type { ShaderMaterial, Sprite } from 'three';
import {
  A_STARS, ARM_SHARP, ARM_FBM_FLOOR, ARM_FBM_SCALE,
} from './galaxy-density';

export interface GalaxyTune {
  // ── Arms (volume) ──
  armContrast: number;   // uArmContrast — arm brightness vs inter-arm (A_STARS)
  armSharp: number;      // uArmSharp — higher = thinner, more defined arms
  armFloor: number;      // uArmFloor — FBM darkening floor (lower = wispier)
  armScale: number;      // uArmScale — FBM clump size in WU
  // ── Disc (volume) ──
  discWidth: number;     // uDiscWidth — vertical scale-height multiplier (flatness)
  bulgeAmp: number;      // uBulgeAmp — central bulge brightness (de-blob)
  dustStrength: number;  // uDustStrength — dust extinction × (inter-arm gaps)
  emission: number;      // uEmissionScale — overall volume brightness
  // ── Features ──
  hiiAmp: number;        // uHiiAmp — in-model HII knot glow
  nebulaOpacity: number; // billboard nebula sprite opacity ×
  nebulaSize: number;    // billboard nebula sprite size ×
  particleSize: number;  // galaxy star particle size ×
}

export const GALAXY_TUNE_DEFAULTS: GalaxyTune = {
  armContrast: A_STARS,        // 1.15
  armSharp: ARM_SHARP,         // 2.3
  armFloor: ARM_FBM_FLOOR,     // 0.32
  armScale: ARM_FBM_SCALE,     // 620
  discWidth: 1.0,
  bulgeAmp: 1.0,
  dustStrength: 1.0,
  emission: 0.002,             // matches discVolumeMat uEmissionScale default
  hiiAmp: 1.0,
  nebulaOpacity: 1.0,
  nebulaSize: 1.0,
  particleSize: 1.0,
};

const STORAGE_KEY = 'legion-galaxy-lab';

function load(): GalaxyTune {
  const t = { ...GALAXY_TUNE_DEFAULTS };
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<GalaxyTune>;
      for (const k of Object.keys(t) as (keyof GalaxyTune)[]) {
        if (typeof saved[k] === 'number') t[k] = saved[k] as number;
      }
    }
  } catch { /* ignore corrupt storage */ }
  return t;
}

export const GALAXY_TUNE: GalaxyTune = load();

export function persistGalaxyTune(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(GALAXY_TUNE));
    }
  } catch { /* storage full / denied — non-fatal */ }
}

// ── Registered live targets (set by galaxy.ts on createGalaxy) ──
let volumeMat: ShaderMaterial | null = null;
const nebulae: { sprite: Sprite; baseSize: number }[] = [];

/** Uniform entries to SPREAD into the disc-volume material. Names match the
 *  `uniform float u…` declarations in galaxy-density.glsl.ts; values default
 *  to the model constants so the untouched panel reproduces the model. */
export function galaxyLabVolumeUniforms(): Record<string, { value: number }> {
  return {
    uArmContrast:  { value: GALAXY_TUNE.armContrast },
    uArmSharp:     { value: GALAXY_TUNE.armSharp },
    uArmFloor:     { value: GALAXY_TUNE.armFloor },
    uArmScale:     { value: GALAXY_TUNE.armScale },
    uDiscWidth:    { value: GALAXY_TUNE.discWidth },
    uBulgeAmp:     { value: GALAXY_TUNE.bulgeAmp },
    uDustStrength: { value: GALAXY_TUNE.dustStrength },
    uHiiAmp:       { value: GALAXY_TUNE.hiiAmp },
  };
}

export function registerVolumeMat(m: ShaderMaterial): void {
  volumeMat = m;
}

export function registerNebula(sprite: Sprite, baseSize: number): void {
  nebulae.push({ sprite, baseSize });
}

export function clearGalaxyLabTargets(): void {
  volumeMat = null;
  nebulae.length = 0;
}

/** Push current GALAXY_TUNE into the volume uniforms + nebula sizes. (Particle
 *  size and nebula opacity are applied per-frame by the LOD updater, which
 *  reads GALAXY_TUNE directly.) Call on every knob change. */
export function applyGalaxyTune(): void {
  if (volumeMat) {
    const u = volumeMat.uniforms;
    if (u.uArmContrast)  u.uArmContrast.value  = GALAXY_TUNE.armContrast;
    if (u.uArmSharp)     u.uArmSharp.value     = GALAXY_TUNE.armSharp;
    if (u.uArmFloor)     u.uArmFloor.value     = GALAXY_TUNE.armFloor;
    if (u.uArmScale)     u.uArmScale.value     = GALAXY_TUNE.armScale;
    if (u.uDiscWidth)    u.uDiscWidth.value    = GALAXY_TUNE.discWidth;
    if (u.uBulgeAmp)     u.uBulgeAmp.value     = GALAXY_TUNE.bulgeAmp;
    if (u.uDustStrength) u.uDustStrength.value = GALAXY_TUNE.dustStrength;
    if (u.uHiiAmp)       u.uHiiAmp.value       = GALAXY_TUNE.hiiAmp;
    if (u.uEmissionScale) u.uEmissionScale.value = GALAXY_TUNE.emission;
  }
  for (const { sprite, baseSize } of nebulae) {
    const s = baseSize * GALAXY_TUNE.nebulaSize;
    sprite.scale.set(s, s, 1);
  }
}
