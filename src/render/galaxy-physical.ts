// ═══════════════════════════════════════════════════════════════════
// GALAXY PHYSICAL — the galaxy as ONE globally-sampled star set drawn from the physical model (no sectors,
// no grid). The realism pass makes it read as a real galaxy rather than a clean pinwheel:
//   • radial   : exponential disc Σ ∝ exp(−R/Rd) (stars ∝ R·exp(−R/Rd)) + a concentrated central bulge,
//   • spiral   : an m-armed logarithmic DENSITY WAVE the disc stars pile into, its phase WARPED by smooth
//                value-noise FBM so arms bend, branch and feather (flocculent, not a perfect spiral),
//   • bar      : an elongated central bar at the bar angle (Sean's MW bar),
//   • clumps   : compact star-forming KNOTS seeded onto the arms (OB associations — the bright beads),
//   • vertical : a sech²(z/h) thin disc; the bulge a rounder spheroid,
//   • colour   : young BLUE stars on the ridges, old red between arms + bulge/bar, with a tunable arm tint.
// Everything is a knob in PhysicalGalaxyConfig so the look is hand-tunable; deterministic for a seed.
// ═══════════════════════════════════════════════════════════════════

import {
  AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, NormalBlending, Points, ShaderMaterial,
  Vector3,
} from 'three';
import { WU_PER_PC } from '../core/metrics';
import { galacticStarsVertexShader, galacticStarsFragmentShader } from './shaders/galactic-stars';
import { MW, angularSpeed_radPerMyr, KMS_PER_KPC_TO_RAD_PER_MYR } from './mw-model';
import { mulberry32 } from '../data/system-gen';
import { sampleArmStar } from './stellar-population';
import { armDebugUniform, SECTOR_STAR_SIZE_SCALE } from './sector/sector-stars';

const DEG2RAD = Math.PI / 180;
const KPC_TO_WU = 1000 * WU_PER_PC; // 1 kpc = 1000 pc · WU_PER_PC
const SGRA_SIZE = 140; // sprite size of the Sgr A* central pinpoint (large — the depth-LOD floors it to ~0.2× at galaxy range)

export interface PhysicalGalaxyData {
  readonly positions: Float32Array; // galactocentric WU: disc in x–z, y vertical, centre at origin
  readonly colors: Float32Array;
  readonly sizes: Float32Array;
  readonly crests: Float32Array; // 0 inter-arm … 1 arm ridge
  /** Per-star circular-orbit elements for animation (Phase 1): (R0_kpc, phi0_rad, y0_kpc, omega_radPerMyr).
   *  The vertex shader animates azimuth as phi0 + omega·uTime; at uTime=0 it reproduces `positions` exactly.
   *  Disc/arm stars get Ω(R) (differential rotation); bar+bulge get the rigid bar pattern speed (no shear). */
  readonly orbits: Float32Array; // n·4
  readonly count: number;
}

export interface PhysicalGalaxyConfig {
  count: number;
  rMax_kpc: number;
  discScaleLength_kpc: number;
  thinScaleHeight_pc: number;
  // bulge
  bulgeFraction: number;
  bulgeScaleLength_kpc: number;
  // arms
  armCount: number;     // m: 2 = grand-design, 4 = multi-arm
  armPitch_deg: number;
  armContrast: number;  // 0 = smooth disc → 1 = stars strongly piled into arms
  armWidth: number;     // arm tightness: 1 = broad arms, lower = stars hug the ridge/spurs tighter
  armNoise: number;     // 0 = clean spiral → ~1 = flocculent (phase warp amplitude)
  armNoiseScale: number; // spatial frequency of the warp (per kpc)
  armBlue: number;      // 0 = no tint → 1 = strong blue arm tint
  // stellar prominence — a per-star luminosity draw (skewed faint, like a real luminosity function) that
  // scales BOTH apparent brightness and sprite size, so you can raise `count` for a volumetric haze while a
  // sparse set of luminous stars carry the eye. 0/0 reproduces the flat IMF look exactly.
  starProminence: number; // 0 = uniform → 1 = strong few-bright-many-faint (size + brightness spread)
  starFaintDim: number;   // 0 = none → 1 = faint majority dimmed toward the floor
  // spurs / feathers — a steeper-pitch secondary log-spiral added onto the arm ridge (one shared field)
  armSpurAmp: number;      // master spur strength (0 = today's galaxy exactly)
  armSpurOpen: number;     // how much MORE open spurs are than the arm (cot2 = cot/this)
  armSpurDensity: number;  // secondary harmonic + arc-length spacing (keep NON-integer × armCount)
  armSpurSharp: number;    // tooth power: low = broad branch-arms, high = thin wispy feathers
  armSpurWarp: number;     // domain-warp on the spur phase (Y-branches); the one new noise tap
  armSpurInterArm: number; // inter-arm fill: faint minor spurs in the gaps (0 = empty gaps)
  armSpurFlank: number;    // trailing-flank gate softness (spurs sit opposite the dust lane)
  armSpurReach: number;    // half-interarm length clamp for on-arm spurs (fraction of the gap)
  // disc rim
  rimFeather: number;   // 0 = sharp truncation → 1 = ragged, wispy edge with arm streamers past rMax
  // star-forming knots / clusters
  clumpFraction: number; // share of disc stars gathered into knots
  clumpScale_pc: number; // knot/cluster radius
  clusterArm: number;    // 0 = round clusters → 1 = clusters elongate along the local arm direction
  // bar
  barFraction: number;
  barLength_kpc: number;
  barAxisRatio: number; // width / length
  barAngle_deg: number;
}

export const DEFAULT_PHYSICAL_CONFIG: PhysicalGalaxyConfig = {
  count: 500_000,
  rMax_kpc: 16,
  discScaleLength_kpc: 3.2,
  thinScaleHeight_pc: MW.thinScaleHeight_pc,
  bulgeFraction: 0.24,
  bulgeScaleLength_kpc: 0.9,
  armCount: 4,
  armPitch_deg: 20,
  armContrast: 0.68,
  armWidth: 0.85,
  armNoise: 0.45,
  armNoiseScale: 0.55,
  armBlue: 0.85,
  starProminence: 0.45,
  starFaintDim: 0.4,
  armSpurAmp: 1.1,
  armSpurOpen: 2.0,
  armSpurDensity: 5.0,
  armSpurSharp: 3.0,
  armSpurWarp: 0.35,
  armSpurInterArm: 0.5,
  armSpurFlank: 0.4,
  armSpurReach: 0.55,
  rimFeather: 0.72,
  clumpFraction: 0.20,
  clumpScale_pc: 220,
  clusterArm: 0.5,
  barFraction: 0.42,
  barLength_kpc: 5.6,
  barAxisRatio: 0.26,
  barAngle_deg: MW.barAngle_deg,
};

// ── Smooth value-noise FBM (deterministic) for warping the arms ──
function hash2(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h >>> 8) / 16777216; // [0,1)
}
function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const top = a + (b - a) * sx;
  const bot = c + (d - c) * sx;
  return (top + (bot - top) * sz) * 2 - 1; // [-1,1]
}
function fbm(x: number, z: number, seed: number): number {
  return 0.6 * valueNoise(x, z, seed)
    + 0.3 * valueNoise(x * 2.13, z * 2.13, seed + 7)
    + 0.1 * valueNoise(x * 4.31, z * 4.31, seed + 19);
}

/** Shared spur/feather field ∈ [0,∞) ADDED onto the arm ridge (one new fbm tap). A steeper-pitch
 *  (cot2 = cot/open) secondary log-spiral, gated to the trailing/convex flank (sin ψ > 0, opposite the
 *  dust lane), arc-length-quasiperiodic in L=ln(R/R0) so spur COUNT rises with R, with a half-interarm
 *  length clamp on the on-arm spurs and a faint inter-arm minor-spur copy. `flankSign`/`openMul` let the
 *  dust feathers reuse this on the LEADING flank at a shallower pitch. amp ≤ 0 ⇒ exact back-compat. */
function spurField(
  Rkpc: number, phi: number, psi: number, warp: number, cot: number, L: number,
  cfg: PhysicalGalaxyConfig, noiseSeed: number, flankSign = 1, openMul = 1, clampReach = true,
): number {
  const amp = cfg.armSpurAmp;
  if (amp <= 0) return 0;
  // bar inner-fade (identical gate to the star/dust bar cutoff) so spurs never scribble the bulge
  const inner = (cfg.barLength_kpc > 0.05 && cfg.barFraction > 0.001)
    ? smoothstep(cfg.barLength_kpc * 0.55, cfg.barLength_kpc * 1.1, Rkpc) : 1;
  if (inner <= 0) return 0;
  const cot2 = cot / (cfg.armSpurOpen * openMul); // smaller cot ⇒ more open/radial than the arm
  const m2 = cfg.armCount * cfg.armSpurDensity;   // non-integer × m ⇒ no phase-lock into extra main arms
  const ns2 = cfg.armNoiseScale * 1.7;
  const w2 = cfg.armSpurWarp * Math.PI * fbm(Rkpc * Math.cos(phi) * ns2, Rkpc * Math.sin(phi) * ns2, noiseSeed + 1013);
  const psi2 = m2 * (phi - cot2 * L) + cfg.armSpurDensity * warp + w2; // shear: tip lags rotation (trails)
  const tooth = Math.pow(Math.max(0, Math.cos(psi2)), cfg.armSpurSharp); // thin trailing filament / comb
  const c = Math.cos(psi); // == base ridge (reused)
  const onArm = smoothstep(-0.2, 0.6, c);
  const gap = 1 - smoothstep(-0.6, 0.2, c);
  const u = flankSign * Math.sin(psi); // +u = the spur flank (trailing for stars, leading for dust)
  const trail = smoothstep(0, cfg.armSpurFlank, u);
  const reach = clampReach ? 1 - smoothstep(cfg.armSpurReach, Math.min(0.97, cfg.armSpurReach + 0.45), u) : 1;
  const onArmTerm = onArm * tooth * trail * reach;
  const gapTerm = cfg.armSpurInterArm * gap * tooth; // faint cross-gap feathers (no flank/reach clamp)
  return amp * (onArmTerm + gapTerm) * inner;
}

/** Warped m-arm density-wave value at galactocentric (R kpc, φ): +1 on an arm ridge, −1 between, with
 *  spur/feather offshoots added (clamped to ≤ +1 so the rejection acceptance stays in [0,1]). */
function armWave(Rkpc: number, phi: number, cfg: PhysicalGalaxyConfig, noiseSeed: number): number {
  const cot = 1 / Math.tan(cfg.armPitch_deg * DEG2RAD);
  const L = Math.log(Math.max(Rkpc, 0.05) / MW.R0_kpc);
  // Rotate the whole arm+spur field so a ridge sits at the BAR ANGLE where R ≈ the bar length — the inner arms
  // then emanate from the two bar ends (coalesce into the bar) instead of floating at an arbitrary offset.
  const Lbar = Math.log(Math.max(cfg.barLength_kpc, 0.05) / MW.R0_kpc);
  const p = phi - (cfg.barAngle_deg * DEG2RAD - cot * Lbar);
  const x = Rkpc * Math.cos(p) * cfg.armNoiseScale;
  const z = Rkpc * Math.sin(p) * cfg.armNoiseScale;
  const warp = cfg.armNoise * Math.PI * fbm(x, z, noiseSeed);
  const psi = cfg.armCount * (p - cot * L) + warp;
  const base = Math.cos(psi) + spurField(Rkpc, p, psi, warp, cot, L, cfg, noiseSeed);
  return Math.max(-1, Math.min(1, base));
}

/** Dust feathers: the same spur field on the LEADING/dust flank (−sin gate) at a shallower pitch, no reach
 *  clamp (kept short by the high tooth power). Returns ≥ 0; used as a multiplicative opacity boost. */
function dustFeatherField(
  Rkpc: number, phiWave: number, cfg: PhysicalGalaxyConfig, noiseSeed: number,
): number {
  if (cfg.armSpurAmp <= 0) return 0;
  const cot = 1 / Math.tan(cfg.armPitch_deg * DEG2RAD);
  const L = Math.log(Math.max(Rkpc, 0.05) / MW.R0_kpc);
  const warp = cfg.armNoise * Math.PI * fbm(Rkpc * Math.cos(phiWave) * cfg.armNoiseScale, Rkpc * Math.sin(phiWave) * cfg.armNoiseScale, noiseSeed);
  const psi = cfg.armCount * (phiWave - cot * L) + warp;
  return spurField(Rkpc, phiWave, psi, warp, cot, L, cfg, noiseSeed, -1, 0.65, false) / Math.max(0.01, cfg.armSpurAmp);
}

/** gamma(shape 2, scale s): the R·exp(−R/s) radial law of an exponential disc. */
function gamma2(rng: () => number, s: number): number {
  return -s * (Math.log(1 - rng()) + Math.log(1 - rng()));
}

interface Star { gx: number; gz: number; gy: number; crest: number } // galactocentric kpc + arm proximity

/** Smoothstep ∈ [0,1]: 0 below a, 1 above b, Hermite in between. */
function smoothstep(a: number, b: number, x: number): number {
  if (b <= a) return x >= b ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const RIM_FREQ = 4.3;       // azimuthal frequency of the ragged rim (how many streamers/gaps round the edge)
export const RIM_MAX = 1.4; // hard outer bound = rMax · this (streamers feather out to here at most)

/** Rim acceptance ∈ [0,1]: a soft, azimuthally noise-modulated disc edge. The truncation radius itself
 *  wiggles with φ (fbm) so the rim is RAGGED — arms feather out as streamers in some directions, pull in
 *  as gaps in others — and the falloff widens with rimFeather (0 ≈ sharp, 1 = very wispy). */
function rimGate(Rkpc: number, phi: number, cfg: PhysicalGalaxyConfig, noiseSeed: number): number {
  const fe = Math.max(0, Math.min(1, cfg.rimFeather));
  const mod = fe * 0.32 * fbm(Math.cos(phi) * RIM_FREQ, Math.sin(phi) * RIM_FREQ, noiseSeed + 5077);
  const mid = cfg.rMax_kpc * (1 + mod);
  const w = 0.05 + 0.28 * fe; // transition half-width: tight when sharp, broad/wispy when feathered
  return 1 - smoothstep(mid * (1 - w), mid * (1 + w * 0.6), Rkpc);
}

/** Draw one disc star: exponential R, φ rejection-sampled into the warped arm wave AND beyond the bar —
 *  the bar TRUNCATES the inner spiral (a longer bar carves a larger hole and pushes the arms out, so bar
 *  length changes spiral density rather than overlaying particles); sech² height. */
function sampleDiscStar(rng: () => number, cfg: PhysicalGalaxyConfig, noiseSeed: number): Star {
  const denom = 1 + cfg.armContrast;
  // Arm tightness: raise the acceptance to 1/armWidth ⇒ stars cluster on the ridge/spurs, inter-arm empties
  // (the diffuse gas then fills the softer area). armWidth=1 ⇒ exponent 1 ⇒ today's broad arms.
  const armExp = 1 / Math.max(0.2, cfg.armWidth);
  // Inner spiral fades in across [0.55·Lbar, 1.1·Lbar]: disc stars don't form where the bar dominates.
  const cutLo = cfg.barLength_kpc * 0.55;
  const cutHi = cfg.barLength_kpc * 1.1;
  const barred = cfg.barLength_kpc > 0.05 && cfg.barFraction > 0.001;
  let Rkpc = gamma2(rng, cfg.discScaleLength_kpc);
  let phi = rng() * Math.PI * 2;
  for (let t = 0; t < 10; t++) {
    const armP = Math.pow((1 + cfg.armContrast * armWave(Rkpc, phi, cfg, noiseSeed)) / denom, armExp);
    const barP = barred ? smoothstep(cutLo, cutHi, Rkpc) : 1;
    const rimP = rimGate(Rkpc, phi, cfg, noiseSeed); // feathered, ragged disc edge (no hard truncation)
    if (rng() <= armP * barP * rimP) break;
    Rkpc = gamma2(rng, cfg.discScaleLength_kpc);
    phi = rng() * Math.PI * 2;
  }
  if (Rkpc > cfg.rMax_kpc * RIM_MAX) Rkpc = cfg.rMax_kpc * RIM_MAX; // hard spatial bound for the array
  const hz = cfg.thinScaleHeight_pc / 1000;
  const u = Math.min(0.9995, Math.max(0.0005, rng()));
  return {
    gx: Rkpc * Math.cos(phi),
    gz: Rkpc * Math.sin(phi),
    gy: hz * Math.atanh(2 * u - 1),
    crest: Math.max(0, armWave(Rkpc, phi, cfg, noiseSeed)),
  };
}

/** Sample the whole galaxy as one global star set from the physical model. Deterministic for `seed`. */
export function samplePhysicalGalaxy(
  cfg: PhysicalGalaxyConfig = DEFAULT_PHYSICAL_CONFIG, seed = 1,
): PhysicalGalaxyData {
  const rng = mulberry32(seed);
  const noiseSeed = (seed * 2654435761) >>> 0;
  const n = cfg.count;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const crests = new Float32Array(n);
  const orbits = new Float32Array(n * 4); // (R0_kpc, phi0, y0_kpc, omega) — Phase-1 circular-streaming elements

  // Pre-seed star-forming knot centres ON the arms (drawn from the disc+arm distribution).
  const NC = 420;
  const clumps: Star[] = [];
  for (let k = 0; k < NC; k++) clumps.push(sampleDiscStar(rng, cfg, noiseSeed));
  const clumpSigma = cfg.clumpScale_pc / 1000; // kpc
  const hz = cfg.thinScaleHeight_pc / 1000;
  const barAng = cfg.barAngle_deg * DEG2RAD;
  // The bar+bulge are a rigid rotating figure — they orbit together at the (faster) bar pattern speed rather
  // than differential Ω(R), or the elongated bar would shear apart. Disc/arm stars stream at Ω(R), floored at
  // R_INNER so the (unmodelled) rising inner rotation curve doesn't spin the very centre unboundedly fast.
  const barOmega = MW.barPatternSpeed_kms_kpc * KMS_PER_KPC_TO_RAD_PER_MYR;
  const R_INNER = 2.0;

  for (let i = 0; i < n; i++) {
    const roll = rng();
    let s: Star;
    if (roll < cfg.barFraction) {
      // Central bar: elongated along barAngle, thin perpendicular + vertical, intermediate-age pop.
      // Triangular (sum of two uniforms) ⇒ dense at the centre, tapering to SOFT ends (no hard rectangular edge).
      const along = ((rng() + rng()) - 1) * cfg.barLength_kpc;
      const perp = ((rng() + rng() + rng() - 1.5) / 1.5) * cfg.barLength_kpc * cfg.barAxisRatio;
      const u = Math.min(0.9995, Math.max(0.0005, rng()));
      s = {
        gx: along * Math.cos(barAng) - perp * Math.sin(barAng),
        gz: along * Math.sin(barAng) + perp * Math.cos(barAng),
        gy: hz * 1.4 * Math.atanh(2 * u - 1),
        crest: 0.15,
      };
    } else if (roll < cfg.barFraction + cfg.bulgeFraction) {
      // Central bulge: concentrated rounded spheroid, old/red. Cap the gamma tail at 6 scale lengths so
      // a rare draw can't fling a "bulge" star to the disc edge (unphysical, and it broke the radial cutoff).
      const Rb = Math.min(gamma2(rng, cfg.bulgeScaleLength_kpc), cfg.bulgeScaleLength_kpc * 6);
      const ph = rng() * Math.PI * 2;
      s = {
        gx: Rb * Math.cos(ph),
        gz: Rb * Math.sin(ph),
        gy: ((rng() + rng() + rng() - 1.5)) * cfg.bulgeScaleLength_kpc * 0.9,
        crest: 0,
      };
    } else if (rng() < cfg.clumpFraction) {
      // Star-forming knot/cluster: scatter around a clump centre on an arm (bright, blue). The scatter is
      // anisotropic — stretched ALONG the local arm tangent by clusterArm — so clusters elongate down the
      // arm instead of sitting as round blobs. Two Box-Muller normals (same rng count as the old r,a pair,
      // so determinism + clusterArm=0 ≡ the old isotropic Gaussian).
      const c = clumps[(Math.floor(rng() * NC)) % NC]!;
      const u1 = Math.min(0.9999, Math.max(1e-6, rng()));
      const u2 = rng();
      const mag = Math.sqrt(-2 * Math.log(u1));
      const g1 = mag * Math.cos(2 * Math.PI * u2);
      const g2 = mag * Math.sin(2 * Math.PI * u2);
      const phiC = Math.atan2(c.gz, c.gx);
      const ca = Math.cos(phiC), sa = Math.sin(phiC);
      const pitchR = cfg.armPitch_deg * DEG2RAD;
      const tx = -sa * Math.cos(pitchR) + ca * Math.sin(pitchR); // local arm tangent (azimuthal tilted by pitch)
      const tz = ca * Math.cos(pitchR) + sa * Math.sin(pitchR);
      const along = clumpSigma * (1 + cfg.clusterArm * 2.2) * g1;
      const perp = clumpSigma * (1 - cfg.clusterArm * 0.45) * g2;
      const u = Math.min(0.9995, Math.max(0.0005, rng()));
      let kx = c.gx + along * tx + perp * (-tz);
      let kz = c.gz + along * tz + perp * tx;
      const kR = Math.hypot(kx, kz); // a knot scattered past the feathered rim is pulled back to the bound
      if (kR > cfg.rMax_kpc * RIM_MAX) { const f = (cfg.rMax_kpc * RIM_MAX) / kR; kx *= f; kz *= f; }
      s = {
        gx: kx,
        gz: kz,
        gy: hz * 0.7 * Math.atanh(2 * u - 1),
        crest: Math.max(c.crest, 0.8), // knots are young/blue
      };
    } else {
      s = sampleDiscStar(rng, cfg, noiseSeed);
    }

    const [r, g, b, sz] = sampleArmStar(rng, s.crest);
    const t = Math.min(1, cfg.armBlue * s.crest); // pull arm stars toward young blue
    // Stellar prominence: a faint-skewed luminosity draw (power-law) scales BOTH apparent brightness and
    // sprite size, layered on the IMF base. 0/0 ⇒ identity (bright=1, sizeMul=1).
    const lum = Math.pow(rng(), 1 + cfg.starProminence * 4); // 0..1, more faint-skewed as prominence rises
    const bright = 1 - cfg.starFaintDim * (1 - lum);          // faint majority dimmed toward (1−faintDim)
    const sizeMul = 1 + cfg.starProminence * (2.0 * lum - 0.7); // bright stars bloom bigger, faint shrink
    const i3 = i * 3;
    positions[i3] = s.gx * KPC_TO_WU;
    positions[i3 + 1] = s.gy * KPC_TO_WU;
    positions[i3 + 2] = s.gz * KPC_TO_WU;
    colors[i3] = (r * (1 - t) + 0.45 * t) * bright;
    colors[i3 + 1] = (g * (1 - t) + 0.66 * t) * bright;
    colors[i3 + 2] = (b * (1 - t) + 1.0 * t) * bright;
    sizes[i] = sz * Math.max(0.15, sizeMul);
    crests[i] = s.crest;
    // Circular-orbit elements: azimuth animates as phi0 + omega·t. bar+bulge (roll below their combined
    // fraction) ride the rigid bar figure; everyone else streams differentially at Ω(R).
    const R0 = Math.hypot(s.gx, s.gz);
    const isCentral = roll < cfg.barFraction + cfg.bulgeFraction;
    const o4 = i * 4;
    orbits[o4] = R0;
    orbits[o4 + 1] = Math.atan2(s.gz, s.gx);
    orbits[o4 + 2] = s.gy;
    // NEGATIVE ⇒ the disc rotates in the sense that makes the arms TRAIL (sweep backward), matching the reference.
    orbits[o4 + 3] = -(isCentral ? barOmega : angularSpeed_radPerMyr(Math.max(R0, R_INNER)));
  }
  // Sgr A* — a single luminous pinpoint at the exact galactic centre (the SMBH's bright central cluster/glow).
  // Stationary (R0=0 ⇒ no orbital drift) and over-bright so it blooms white-blue against the warm amber bar.
  positions[0] = 0; positions[1] = 0; positions[2] = 0;
  colors[0] = 2.6; colors[1] = 2.5; colors[2] = 3.0; // over-bright blue-white so it blooms past the amber bar
  sizes[0] = SGRA_SIZE;
  crests[0] = 0;
  orbits[0] = 0; orbits[1] = 0; orbits[2] = 0; orbits[3] = 0;
  return { positions, colors, sizes, crests, orbits, count: n };
}

/** Build the renderable Points (additive star sprites) for a sampled galaxy. Positions are absolute
 *  galactocentric WU with the centre at the scene origin (float32 ULP at ±16 kpc ≈ sub-pc). */
export function buildPhysicalGalaxyPoints(data: PhysicalGalaxyData): { points: Points; material: ShaderMaterial } {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(data.colors, 3));
  geo.setAttribute('aSize', new Float32BufferAttribute(data.sizes, 1));
  geo.setAttribute('aCrest', new Float32BufferAttribute(data.crests, 1));
  geo.setAttribute('aOrbit', new Float32BufferAttribute(data.orbits, 4));
  const material = new ShaderMaterial({
    vertexShader: galacticStarsVertexShader,
    fragmentShader: galacticStarsFragmentShader,
    uniforms: {
      uTime: { value: 0 }, // Myr; galaxy-sim advances it via the time-warp slider
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

// ── DUST EXTINCTION ─────────────────────────────────────────────────────────────────────────────────
// Real absorption, not fog. Dust is a thin midplane layer concentrated on the arms' leading edge (where
// the gas shocks). It renders as dark soft sprites with NORMAL (alpha) blending AFTER the additive stars:
// a near-black sprite of alpha a multiplies the framebuffer by (1−a), so overlapping dust genuinely DARKENS
// (self-shadows) the starlight behind it — the dark dust lanes face-on and the dark band edge-on. The dust
// is slightly warm so what light leaks through is reddened. (View-exact front/back occlusion via a
// depth-aware pass is a later refinement; a thin dark midplane already reads as the lane from any angle.)

export interface DustConfig {
  dustCount: number;
  dustOpacity: number;        // per-particle base alpha (optical depth)
  dustScaleHeight_pc: number; // thinner than the stars ⇒ a crisp midplane lane
  dustLeadDeg: number;        // phase lead: dust sits on the inner/leading edge of the arms
  dustThickness: number;      // 0 = razor-thin wispy lane … 1 = broad lane (drives ridge sharpness + sprite)
  dustSegment: number;        // 0 = continuous lane … 1 = heavily broken into segments (gap fraction)
  dustSegmentScale: number;   // segment frequency along the arm (per kpc) — smaller = longer segments/gaps
  dustFilament: number;       // 0 = smooth … 1 = spindly cross-lane tendrils that detach + recoalesce
  dustFilamentScale: number;  // spatial frequency of the tendrils (per kpc)
  dustFeather: number;        // 0 = none … darkens leading-edge dust feathers off the arms (needs armSpurAmp)
  // Cross-segment styles (all 0 = off; tunable so the look can be judged in the render, not the math):
  dustCrossRung: number;      // 0…1 occasional perpendicular RUNGS spanning the lane, sheared to trail rotation
  dustVertWisp: number;       // 0…1 out-of-plane vertical WISPS rising along the lanes, leaning with rotation
  dustPerpSpur: number;       // 0…1 short perpendicular SPURS/combs branching off the lane edge, swept back
}

export const DEFAULT_DUST_CONFIG: DustConfig = {
  dustCount: 700_000, dustOpacity: 0.16, dustScaleHeight_pc: 90, dustLeadDeg: 18,
  dustThickness: 0.16, dustSegment: 0.55, dustSegmentScale: 3.0, dustFilament: 0.7, dustFilamentScale: 2.1,
  dustFeather: 0.6, dustCrossRung: 0, dustVertWisp: 0, dustPerpSpur: 0,
};

/** Ridged value-noise FBM ∈ [0,1]: thin bright RIDGES at the FBM zero-crossings — the threads/tendrils
 *  that break and rejoin. `sharp` thins them; multiple octaves make them detach and recoalesce. */
function ridge(x: number, z: number, seed: number, sharp: number): number {
  const r = 1 - Math.abs(fbm(x, z, seed));
  return Math.pow(Math.max(0, r), sharp);
}

export interface DustData {
  readonly positions: Float32Array; // galactocentric WU
  readonly sizes: Float32Array;
  readonly opacities: Float32Array;
  readonly orbits: Float32Array;     // n·4 (R0_kpc, phi0, y0_kpc, omega) — same circular streaming as the stars
  readonly count: number;
}

/** Sample the dust as a thin, arm-leading-edge layer using the SAME density-wave as the stars. */
export function sampleDust(
  cfg: PhysicalGalaxyConfig, dust: DustConfig = DEFAULT_DUST_CONFIG, seed = 1,
): DustData {
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const noiseSeed = ((seed * 2654435761) >>> 0) + 1;
  const n = dust.dustCount;
  const positions = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const opacities = new Float32Array(n);
  const orbits = new Float32Array(n * 4); // circular-streaming elements so dust moves WITH the arm stars
  const R_INNER = 2.0;                    // inner Ω floor (matches the star sampler)
  const hz = dust.dustScaleHeight_pc / 1000;
  const lead = (dust.dustLeadDeg * DEG2RAD) / Math.max(1, cfg.armCount);
  const m = Math.max(1, cfg.armCount);
  const ns = cfg.armNoiseScale;
  const warpAmp = cfg.armNoise * Math.PI;
  const fil = Math.max(0, Math.min(1, dust.dustFilament));
  const fScale = dust.dustFilamentScale;
  const fSeed = noiseSeed + 1013;
  // Lane WIDTH from a thin arm ridge cos(ψ)^k: razor-thin (low dustThickness ⇒ high k). We IMPORTANCE-SAMPLE
  // the ridge — place each grain ON a warped lane with a narrow perpendicular jitter ∝ 1/√k — rather than
  // reject-sample, so thin lanes stay DENSE instead of starving to a few specks.
  const laneSharp = 2 + (1 - Math.max(0, Math.min(1, dust.dustThickness))) * 38;
  const jitterSigma = 1 / Math.sqrt(laneSharp);
  // SEGMENTATION: a value-noise gate along the arm (per-arm offset). Noise ⇒ the gaps are irregularly
  // spaced (not periodic); dustSegment raises the cutoff ⇒ more/longer gaps.
  const seg = Math.max(0, Math.min(1, dust.dustSegment));
  const segScale = dust.dustSegmentScale;
  const segSeed = noiseSeed + 2027;
  const cot = 1 / Math.tan(cfg.armPitch_deg * DEG2RAD);
  // BAR: the dust avoids the bar-dominated centre exactly like the stars (same radial fade-in gate).
  const barred = cfg.barLength_kpc > 0.05 && cfg.barFraction > 0.001;
  const cutLo = cfg.barLength_kpc * 0.55;
  const cutHi = cfg.barLength_kpc * 1.1;
  const spr = 2 + dust.dustThickness * 9; // finer sprites for thinner lanes
  const feath = Math.max(0, Math.min(1, dust.dustFeather));
  const crossRung = Math.max(0, dust.dustCrossRung);
  const vertWisp = Math.max(0, dust.dustVertWisp);
  const perpSpur = Math.max(0, dust.dustPerpSpur);
  for (let i = 0; i < n; i++) {
    let Rkpc = gamma2(rng, cfg.discScaleLength_kpc * 1.05);
    if (Rkpc > cfg.rMax_kpc * RIM_MAX) Rkpc = cfg.rMax_kpc * RIM_MAX;
    // Place on the k-th arm's WARPED ridge (φ′ where armWave(R, φ′)=1), one warp-correction iteration.
    const lnTerm = cot * Math.log(Math.max(Rkpc, 0.05) / MW.R0_kpc);
    const k = Math.floor(rng() * m) % m;
    let phiP = lnTerm + (2 * Math.PI * k) / m;
    const g0 = warpAmp * fbm(Rkpc * Math.cos(phiP) * ns, Rkpc * Math.sin(phiP) * ns, noiseSeed);
    phiP = lnTerm + (2 * Math.PI * k - g0) / m;
    const gj = (rng() + rng() + rng() - 1.5) * 2; // ≈ N(0,1)
    phiP += (gj * jitterSigma) / m;               // narrow perpendicular spread = the lane thickness
    // DUST FEATHERS: a dustFeather-weighted share excursions off the lane onto the leading-flank feather
    // teeth (dark filaments branching off the dust edge), kept only where a feather actually lives.
    if (feath > 0 && cfg.armSpurAmp > 0 && rng() < 0.5 * feath) {
      const phiTry = phiP - (0.15 + 0.85 * rng()) * (Math.PI / m); // excursion toward the leading flank
      if (rng() < dustFeatherField(Rkpc, phiTry, cfg, noiseSeed)) phiP = phiTry; // landed on a feather
    }
    // Vertical height, computed up-front so the optional cross-segment features can shear it before finalising φ.
    const u = Math.min(0.9995, Math.max(0.0005, rng()));
    let y0 = hz * Math.atanh(2 * u - 1);
    // ── OPTIONAL DUST CROSS-SEGMENTS (all default 0 = off; deterministic gates reuse the existing draws, so
    //    at 0 the base lane is unchanged). Each is an independent tunable style to judge in the render. ──
    if (crossRung > 0) {
      // (a) RUNGS: in occasional along-arm bands, grains spread WIDE across the lane (azimuthal) and shear in
      //     radius, so the band reads as a perpendicular rung tilted to trail the rotation.
      const band = 0.5 + 0.5 * valueNoise(Rkpc * 1.1, k * 9.0, noiseSeed + 4400);
      const w = crossRung * smoothstep(0.72, 0.9, band);
      phiP += (gj * jitterSigma * 8 * w) / m; // reuse gj → wide azimuthal spread across the lane
      Rkpc += gj * 0.16 * w;                   // radial shear ⇒ the rung tilts with the rotation
    }
    if (vertWisp > 0) {
      // (b) WISPS: in occasional bands, grains rise OUT of the disc plane (taller y0) and lean in φ with the
      //     rotation — reads at oblique angles as vertical filaments along the lanes.
      const wband = 0.5 + 0.5 * valueNoise(Rkpc * 0.9, k * 13.0, noiseSeed + 5500);
      const w = vertWisp * smoothstep(0.72, 0.92, wband);
      y0 *= 1 + 5 * w;
      phiP += ((y0 / Math.max(Rkpc, 0.1)) * 0.5 * w) / m;
    }
    if (perpSpur > 0) {
      // (c) SPURS: high-freq along-arm teeth push grains perpendicular off the lane edge, swept back (trailing).
      const comb = ridge(Rkpc * 3.3, k * 17.0, noiseSeed + 6600, 3.0);
      const w = perpSpur * comb;
      phiP += (gj >= 0 ? 1 : -1) * (0.9 + jitterSigma * 3) * w / m; // excursion off the lane edge
      Rkpc -= 0.14 * w;                                             // swept back with the rotation
    }
    const phi = phiP - lead;                       // dust azimuth (wave is evaluated at φ′ = phi + lead)
    // Carve the placed lane: feathered rim, bar cutoff, noise-randomised segmentation, tendrils (all cull).
    let ok = true;
    if (rng() > rimGate(Rkpc, phi, cfg, noiseSeed)) ok = false; // dust lanes feather out at the rim too
    if (ok && barred && rng() > smoothstep(cutLo, cutHi, Rkpc)) ok = false;
    if (ok && seg > 0) {
      const s01 = 0.5 + 0.5 * valueNoise(Rkpc * segScale, k * 5.0, segSeed); // along-arm gaps, per arm
      if (rng() > smoothstep(seg * 0.65, seg * 0.65 + 0.3, s01)) ok = false;
    }
    if (ok && fil > 0) {
      const fx = Rkpc * Math.cos(phi) * fScale;
      const fz = Rkpc * Math.sin(phi) * fScale;
      if (rng() > (1 - fil) + fil * ridge(fx, fz, fSeed, 2.4)) ok = false;
    }
    const i3 = i * 3;
    positions[i3] = Rkpc * Math.cos(phi) * KPC_TO_WU;
    positions[i3 + 1] = y0 * KPC_TO_WU;
    positions[i3 + 2] = Rkpc * Math.sin(phi) * KPC_TO_WU;
    const o4 = i * 4; // stream on the SAME reversed differential Ω(R) as the arm stars → lanes stay inline
    orbits[o4] = Rkpc; orbits[o4 + 1] = phi; orbits[o4 + 2] = y0;
    orbits[o4 + 3] = -angularSpeed_radPerMyr(Math.max(Rkpc, R_INNER));
    sizes[i] = spr * (0.4 + 0.6 * rng());
    opacities[i] = ok ? dust.dustOpacity * (0.45 + 0.55 * rng()) : 0; // cull carved-out grains ⇒ clean gaps
  }
  return { positions, sizes, opacities, orbits, count: n };
}

const dustVertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aOpacity;
  attribute vec4 aOrbit;    // (R0_kpc, phi0, y0_kpc, omega) — identical circular streaming to the stars
  uniform float uPixelRatio;
  uniform float uOpacityScale;
  uniform float uTime;      // Myr (0 = frozen)
  varying float vOpacity;
  void main() {
    vOpacity = aOpacity * uOpacityScale;
    // Stream with the arm stars (same math) so the dust lanes stay pinned to the arms as the galaxy turns.
    const float KPC_TO_WU = 1000000.0;
    float phi = aOrbit.y + aOrbit.w * uTime;
    vec3 orbitPos = vec3(aOrbit.x * cos(phi), aOrbit.z, aOrbit.x * sin(phi)) * KPC_TO_WU;
    vec4 mv = modelViewMatrix * vec4(orbitPos, 1.0);
    float depth = max(-mv.z, 0.001);
    float lod = clamp(80000.0 / depth, 0.2, 1.0);
    gl_PointSize = aSize * uPixelRatio * lod;
    gl_Position = projectionMatrix * mv;
  }
`;
const dustFragmentShader = /* glsl */ `
  uniform vec3 uDustColor;
  varying float vOpacity;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0) discard;
    float a = pow(1.0 - d, 1.5) * vOpacity; // soft edge × optical depth
    gl_FragColor = vec4(uDustColor, a);     // NormalBlending: near-black ⇒ multiplies the stars down
  }
`;

/** Build the dust Points: dark soft sprites, NORMAL-blended over the additive stars to occlude them. */
export function buildDustPoints(data: DustData): { points: Points; material: ShaderMaterial } {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
  geo.setAttribute('aSize', new Float32BufferAttribute(data.sizes, 1));
  geo.setAttribute('aOpacity', new Float32BufferAttribute(data.opacities, 1));
  geo.setAttribute('aOrbit', new Float32BufferAttribute(data.orbits, 4));
  const material = new ShaderMaterial({
    vertexShader: dustVertexShader,
    fragmentShader: dustFragmentShader,
    uniforms: {
      uPixelRatio: { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1 },
      uOpacityScale: { value: 1.0 },
      uTime: { value: 0 },
      uDustColor: { value: new Color(0.05, 0.03, 0.02) }, // very dark, faintly warm (reddened transmission)
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: NormalBlending,
  });
  const points = new Points(geo, material);
  points.name = 'galaxy-dust';
  points.renderOrder = 10; // after the stars (which are renderOrder 0) so it darkens them
  points.frustumCulled = false;
  return { points, material };
}

// ═══════════════════════════════════════════════════════════════════
// GAS as VOLUMETRIC PARTICLES (replaces the baked-3D-texture raymarch). Soft additive sprites placed through
// the arm volume — genuine 3D particulates, so it fills the galaxy and flies-through cleanly (no boxed-texture
// layers to clip). Reuses the SAME warped-ridge field as the stars/dust, importance-sampled. Each particle
// carries its CROSS-SECTION position ρ (0 on the dense spine → 1 at the feathered edge): colour goes warm/bright
// white at the core (gravity-piled) → cool white at the skin (rotation-flung), and brightness rises toward the
// galactic core (the central light). All per-particle, computed at spawn — no per-frame transport.
// ═══════════════════════════════════════════════════════════════════
export interface StarGasData { positions: Float32Array; colors: Float32Array; sizes: Float32Array; orbits: Float32Array; count: number }

/** Star-DERIVED gas: re-sample the physical galaxy at a FRACTION of the star count (decorrelated seed), then
 *  re-skin those star positions as big soft WORLD-SPACE puffs. The star sampler already carries the bar/arm/
 *  spur/cluster STRUCTURE the user liked — we keep it verbatim and only change (a) how it's RENDERED (a soft
 *  additive haze instead of crisp points) and (b) its COLOUR IDENTITY: the removed gas's warm-amber nucleus
 *  (by radius) ↔ cool-blue arms (by the sampler's own crest), NOT the stars' speckled per-star hues (which
 *  would accumulate as a tinted STARFIELD, not painterly gas). Absolute exposure lives in the shader uBright;
 *  the star distribution's own arm-contrast + bar concentration + rim feather supply the density modulation. */
export function sampleStarGas(
  cfg: PhysicalGalaxyConfig, seed = 1,
  opts: { countFraction?: number; puffKpc?: number; intensity?: number; coreGas?: number } = {},
): StarGasData {
  const frac = opts.countFraction ?? 0.25;      // "1/4 the volume" — a quarter of the star count
  const puffKpc = opts.puffKpc ?? 0.6;          // puff DIAMETER (kpc) — big enough that sparse puffs overlap into mist
  const intensity = opts.intensity ?? 1;        // baked brightness knob (folded into the per-puff colour)
  const coreGas = opts.coreGas ?? 1;            // independent nucleus-gas multiplier (0 = no core gas … >1 = denser core)
  const gasCount = Math.max(1, Math.round(cfg.count * frac));
  // Duplicate the STAR layer at a distinct seed so puffs are decorrelated from actual stars (else each puff sits
  // exactly on a star → reads as fat stars, not haze). Gas lives in the DISC/ARMS, not the old-star bulge, so
  // re-weight the duplicate AWAY from the centre (much lower bulge, softened bar): physically right AND it tames
  // the additive core blow-out — the stellar bulge/bar are so dense they saturate to a white blob that drowns the
  // amber bar and the faint arms. The arm/spur/cluster STRUCTURE is preserved.
  // Also thin the star CLUSTERS (they'd read as loud discrete knots, not smooth gas) — gas wants a continuous field.
  const gasCfg = {
    ...cfg, count: gasCount,
    bulgeFraction: cfg.bulgeFraction * 0.5, barFraction: cfg.barFraction * 0.85, clumpFraction: cfg.clumpFraction * 0.3,
  };
  const src = samplePhysicalGalaxy(gasCfg, (seed ^ 0x5a17_9b21) >>> 0);
  const positions = src.positions;              // ALREADY galactocentric WU — reuse by reference (do NOT re-scale)
  const orbits = src.orbits;                    // the gas's OWN decorrelated orbit elements → puffs stream WITH their stars
  const colors = new Float32Array(gasCount * 3);
  const sizes = new Float32Array(gasCount);
  const jitter = mulberry32((seed ^ 0x715a) >>> 0); // SEPARATE rng stream — never interleave the sampler's own draws
  const puffDiam = puffKpc * KPC_TO_WU;
  const barR = Math.max(2.0, cfg.barLength_kpc); // amber nucleus/bar radius — spans the ACTUAL bar, not just the bulge
  const whiteLo = 0.84;                          // high threshold ⇒ arms stay blue; only the densest ridge whitens
  for (let i = 0; i < gasCount; i++) {
    const i3 = i * 3;
    const x = positions[i3], z = positions[i3 + 2];
    const R = Math.hypot(x, z) / KPC_TO_WU;      // kpc — recovered from the WU position (positions already scaled)
    const crest = src.crests[i];                 // 0 inter-arm … 1 arm ridge (the sampler's own cross-section signal)
    // ARM colour — cool blue ↔ HII-pink by ridge proximity, lifted to a cool blue-white on the very ridge.
    const chi = smoothstep(0.5, 1.0, crest);
    const bgr = 0.26 * (1 - chi) + 0.95 * chi, bgg = 0.42 * (1 - chi) + 0.50 * chi, bgb = 0.85 * (1 - chi) + 0.72 * chi;
    const wMix = smoothstep(whiteLo, 0.92, crest);
    const ar = bgr * (1 - wMix) + 0.78 * wMix, ag = bgg * (1 - wMix) + 0.87 * wMix, ab = bgb * (1 - wMix) + 1.0 * wMix;
    // NUCLEUS/BAR colour — warm amber (LOW blue). BOTH the warmth (wm) and the amber region (nucT) span the whole
    // BAR length, so the elongated bar reads amber end-to-end instead of only its tiny centre.
    const wm = Math.exp(-R / (barR * 0.6));
    const nr = 0.76 + 0.24 * wm, ng = 0.86 - 0.06 * wm, nb = 1.0 - 0.55 * wm;
    const nucT = 1 - smoothstep(barR * 0.35, barR * 1.1, R); // amber across the bar … 0 out in the disc
    const cr = ar * (1 - nucT) + nr * nucT, cg = ag * (1 - nucT) + ng * nucT, cb = ab * (1 - nucT) + nb * nucT;
    const b = intensity * (0.8 + 0.45 * nucT) * (1 + (coreGas - 1) * nucT); // core gas scales ONLY the nucleus (nucT→1)
    colors[i3] = cr * b; colors[i3 + 1] = cg * b; colors[i3 + 2] = cb * b;
    sizes[i] = puffDiam * (0.55 + 0.9 * jitter());
  }
  return { positions, colors, sizes, orbits, count: gasCount };
}

/** PROMINENT STARS — an independent, sparse set of big, bright, HIGHLY-varied standout stars that follow the
 *  same structure + orbital motion as the galaxy (sampled from samplePhysicalGalaxy, so they inherit the arm/bar
 *  distribution AND the per-star orbit elements). Rendered by buildPhysicalGalaxyPoints (crisp star sprites,
 *  orbit-animated) on a dedicated layer that composites OVER the gas so they actually stand out. `variance`
 *  drives a heavy-tailed size+brightness spread (0 = uniform, 1 = a few giants among many small). */
export function sampleProminentStars(
  cfg: PhysicalGalaxyConfig, seed = 1,
  opts: { count?: number; sizeMul?: number; brightMul?: number; variance?: number } = {},
): PhysicalGalaxyData {
  const count = Math.max(1, Math.round(opts.count ?? 4000));
  const sizeMul = opts.sizeMul ?? 6;
  const brightMul = opts.brightMul ?? 3;
  const variance = Math.max(0, Math.min(1, opts.variance ?? 0.7));
  const src = samplePhysicalGalaxy({ ...cfg, count }, (seed ^ 0x9b3c_1177) >>> 0); // structure + orbits
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const jitter = mulberry32((seed ^ 0x2f19_a3d1) >>> 0); // SEPARATE rng stream (never interleave the sampler's)
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const v = Math.pow(jitter(), 1 + variance * 8);      // heavy-tailed toward 0 as variance rises
    const f = (1 - variance) + variance * (0.3 + 5 * v); // 1 at variance 0 … 0.3–5.3 (few giants) at variance 1
    sizes[i] = Math.max(0.5, src.sizes[i] * sizeMul * f);
    const b = brightMul * f;                             // size↔brightness correlated: big stars are bright
    colors[i3] = src.colors[i3] * b; colors[i3 + 1] = src.colors[i3 + 1] * b; colors[i3 + 2] = src.colors[i3 + 2] * b;
  }
  return { positions: src.positions, colors, sizes, crests: src.crests, orbits: src.orbits, count };
}

const starGasVertexShader = /* glsl */ `
  attribute float aSize;   // puff DIAMETER in world units (perspective-projected → scales with zoom)
  attribute vec3 aColor;
  attribute vec4 aOrbit;    // (R0_kpc, phi0, y0_kpc, omega) — matches the star layer so gas streams with its stars
  uniform float uViewportH; // framebuffer height in px (perspective point-size conversion)
  uniform float uSizeK;     // live puff-size multiplier
  uniform float uMaxPx;     // clamp so a close puff can't fill the screen
  uniform float uTime;      // Myr (0 = frozen)
  varying vec3 vCol;
  void main() {
    vCol = aColor;
    // Same Phase-1 circular streaming as the stars (identical math ⇒ puffs stay locked to their stars).
    const float KPC_TO_WU = 1000000.0;
    float phi = aOrbit.y + aOrbit.w * uTime;
    vec3 orbitPos = vec3(aOrbit.x * cos(phi), aOrbit.z, aOrbit.x * sin(phi)) * KPC_TO_WU;
    vec4 mv = modelViewMatrix * vec4(orbitPos, 1.0);
    float depth = max(-mv.z, 1.0);
    gl_Position = projectionMatrix * mv;
    // world length → screen px: L · projMat[1][1] · (H/2) / depth. Sizing in WORLD units (not screen px) is
    // what makes the puffs OVERLAP consistently at every zoom — the key to a coherent volume vs discrete dots.
    float px = aSize * uSizeK * projectionMatrix[1][1] * uViewportH / (2.0 * depth);
    gl_PointSize = clamp(px, 1.5, uMaxPx);
  }
`;
const starGasFragmentShader = /* glsl */ `
  precision highp float;
  uniform float uBright;    // live absolute-brightness multiplier
  varying vec3 vCol;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r2 = dot(p, p) * 4.0;
    if (r2 > 1.0) discard;
    float a = exp(-r2 * 1.7);            // wide, soft gaussian — faint per puff so MANY overlap into mist
    gl_FragColor = vec4(vCol * (a * uBright), a);  // AdditiveBlending: the accumulation is the volume
  }
`;

/** Build the star-gas Points — big, soft, FAINT world-sized sprites; the accumulation of many overlapping puffs
 *  reads as a coherent cloudy mist. renderOrder 5: after stars (0), before dust (10). Name/order/uniforms are
 *  preserved from the old gas so the blur compositor + disposal paths keep working unchanged. */
export function buildStarGasPoints(data: StarGasData): { points: Points; material: ShaderMaterial } {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
  geo.setAttribute('aColor', new Float32BufferAttribute(data.colors, 3));
  geo.setAttribute('aSize', new Float32BufferAttribute(data.sizes, 1));
  geo.setAttribute('aOrbit', new Float32BufferAttribute(data.orbits, 4));
  const material = new ShaderMaterial({
    vertexShader: starGasVertexShader,
    fragmentShader: starGasFragmentShader,
    uniforms: {
      uViewportH: { value: typeof window !== 'undefined' ? window.innerHeight * Math.min(window.devicePixelRatio, 2) : 1080 },
      uTime: { value: 0 },
      uSizeK: { value: 1.0 },
      uBright: { value: 0.019 }, // faint per-puff so overlap builds the mist without instant blow-out
      uMaxPx: { value: 240.0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geo, material);
  points.name = 'galaxy-gas';
  points.renderOrder = 5;
  points.frustumCulled = false;
  return { points, material };
}
