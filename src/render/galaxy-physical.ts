// ═══════════════════════════════════════════════════════════════════
// GALAXY PHYSICAL — the galaxy as ONE globally-sampled star set drawn from the physical model, NOT a
// per-sector density field. This is the "new generation" that supersedes the sector build-out for the
// galaxy's look:
//   • radial: an exponential disc Σ(R) ∝ exp(−R/Rd) (so stars ∝ R·exp(−R/Rd)) + a concentrated central bulge,
//   • spiral: the m=4 logarithmic-spiral DENSITY WAVE — stars are rejection-sampled INTO the arm ridges,
//     so the structure EMERGES from the wave (a dynamical construct), it isn't a painted field,
//   • vertical: a sech²(z/h) thin disc; the bulge is a rounder spheroid,
//   • populations: blue young stars on the arm ridges, red old stars between arms and in the bulge.
// No 250 pc grid exists because there are no cells — placement is continuous everywhere. Each star will
// carry an epicyclic orbit (next step) so the whole disc rotates and the arms persist as a pattern.
// Tunable via PhysicalGalaxyConfig; deterministic for a seed.
// ═══════════════════════════════════════════════════════════════════

import {
  AdditiveBlending, BufferGeometry, Float32BufferAttribute, Points, ShaderMaterial, Vector3,
} from 'three';
import { WU_PER_PC } from '../core/metrics';
import { galacticStarsVertexShader, galacticStarsFragmentShader } from './shaders/galactic-stars';
import { MW } from './mw-model';
import { mulberry32 } from '../data/system-gen';
import { sampleArmStar } from './stellar-population';
import { armDebugUniform, SECTOR_STAR_SIZE_SCALE } from './sector/sector-stars';

const DEG2RAD = Math.PI / 180;
const KPC_TO_WU = 1000 * WU_PER_PC; // 1 kpc = 1000 pc · WU_PER_PC

export interface PhysicalGalaxyData {
  readonly positions: Float32Array; // galactocentric WU: disc in x–z, y vertical, centre at origin
  readonly colors: Float32Array;
  readonly sizes: Float32Array;
  readonly crests: Float32Array; // 0 inter-arm … 1 arm ridge
  readonly count: number;
}

export interface PhysicalGalaxyConfig {
  count: number;
  /** Share of stars in the central bulge. */
  bulgeFraction: number;
  /** 0 = smooth disc, →1 = stars strongly piled into the arms. */
  armContrast: number;
  discScaleLength_kpc: number;
  bulgeScaleLength_kpc: number;
  thinScaleHeight_pc: number;
  rMax_kpc: number;
}

export const DEFAULT_PHYSICAL_CONFIG: PhysicalGalaxyConfig = {
  count: 2_400_000,
  bulgeFraction: 0.22,
  armContrast: 0.85,
  discScaleLength_kpc: MW.thinScaleLength_kpc,
  bulgeScaleLength_kpc: 0.7,
  thinScaleHeight_pc: MW.thinScaleHeight_pc,
  rMax_kpc: 16,
};

/** The m=4 logarithmic-spiral density-wave: cos(armPhase) = +1 on an arm ridge, −1 between arms. */
function armCos(Rkpc: number, phi: number): number {
  const cot = 1 / Math.tan(MW.armPitch_deg * DEG2RAD);
  const psi = MW.armCount * (phi - cot * Math.log(Math.max(Rkpc, 0.05) / MW.R0_kpc));
  return Math.cos(psi);
}

/** gamma(shape 2, scale s): the R·exp(−R/s) radial law of an exponential disc's enclosed-mass sampling. */
function gamma2(rng: () => number, s: number): number {
  return -s * (Math.log(1 - rng()) + Math.log(1 - rng()));
}

/** Sample the whole galaxy as one global star set from the physical model. Deterministic for `seed`. */
export function samplePhysicalGalaxy(
  cfg: PhysicalGalaxyConfig = DEFAULT_PHYSICAL_CONFIG, seed = 1,
): PhysicalGalaxyData {
  const rng = mulberry32(seed);
  const n = cfg.count;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const crests = new Float32Array(n);
  const hz = cfg.thinScaleHeight_pc / 1000; // kpc
  const accept = (Rkpc: number, phi: number): boolean =>
    rng() <= (1 + cfg.armContrast * armCos(Rkpc, phi)) / (1 + cfg.armContrast);

  for (let i = 0; i < n; i++) {
    let Rkpc: number;
    let phi: number;
    let zkpc: number;
    let crest: number;
    if (rng() < cfg.bulgeFraction) {
      // Central bulge: concentrated, rounded spheroid, old/red, no arms.
      Rkpc = gamma2(rng, cfg.bulgeScaleLength_kpc);
      phi = rng() * Math.PI * 2;
      zkpc = (rng() + rng() + rng() - 1.5) * cfg.bulgeScaleLength_kpc * 0.9; // ~gaussian round bulge
      crest = 0;
    } else {
      // Exponential disc; arms emerge by rejection-sampling φ into the density-wave ridges.
      Rkpc = gamma2(rng, cfg.discScaleLength_kpc);
      phi = rng() * Math.PI * 2;
      for (let t = 0; t < 5 && !accept(Rkpc, phi); t++) {
        Rkpc = gamma2(rng, cfg.discScaleLength_kpc);
        phi = rng() * Math.PI * 2;
      }
      const u = Math.min(0.9995, Math.max(0.0005, rng()));
      zkpc = hz * Math.atanh(2 * u - 1); // sech² thin disc
      crest = Math.max(0, armCos(Rkpc, phi)); // arm proximity → blue young stars
    }
    if (Rkpc > cfg.rMax_kpc) Rkpc = cfg.rMax_kpc * Math.sqrt(rng()); // fold the rare tail back in

    const [r, g, b, sz] = sampleArmStar(rng, crest);
    const i3 = i * 3;
    positions[i3] = Rkpc * Math.cos(phi) * KPC_TO_WU;
    positions[i3 + 1] = zkpc * KPC_TO_WU;
    positions[i3 + 2] = Rkpc * Math.sin(phi) * KPC_TO_WU;
    colors[i3] = r;
    colors[i3 + 1] = g;
    colors[i3 + 2] = b;
    sizes[i] = sz;
    crests[i] = crest;
  }
  return { positions, colors, sizes, crests, count: n };
}

/** Build the renderable Points (additive star sprites) for a sampled galaxy. Positions are absolute
 *  galactocentric WU with the centre at the scene origin (float32 ULP at ±16 kpc ≈ 1 WU ≈ sub-pc). */
export function buildPhysicalGalaxyPoints(data: PhysicalGalaxyData): { points: Points; material: ShaderMaterial } {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(data.colors, 3));
  geo.setAttribute('aSize', new Float32BufferAttribute(data.sizes, 1));
  geo.setAttribute('aCrest', new Float32BufferAttribute(data.crests, 1));
  const material = new ShaderMaterial({
    vertexShader: galacticStarsVertexShader,
    fragmentShader: galacticStarsFragmentShader,
    uniforms: {
      uSizeScale: { value: SECTOR_STAR_SIZE_SCALE },
      uPixelRatio: { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1 },
      uCamVelocity: { value: new Vector3() },
      uStreakStrength: { value: 0.0 },
      uMaxStretch: { value: 0.4 },
      uDensityDim: { value: 1.0 },
      uArmDebug: armDebugUniform,
      uDepthLODRef: { value: 80_000 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geo, material);
  points.name = 'galaxy-physical';
  points.frustumCulled = false;
  return { points, material };
}
