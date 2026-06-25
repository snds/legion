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
  armNoise: number;     // 0 = clean spiral → ~1 = flocculent (phase warp amplitude)
  armNoiseScale: number; // spatial frequency of the warp (per kpc)
  armBlue: number;      // 0 = no tint → 1 = strong blue arm tint
  // star-forming knots
  clumpFraction: number; // share of disc stars gathered into knots
  clumpScale_pc: number; // knot radius
  // bar
  barFraction: number;
  barLength_kpc: number;
  barAxisRatio: number; // width / length
  barAngle_deg: number;
}

export const DEFAULT_PHYSICAL_CONFIG: PhysicalGalaxyConfig = {
  count: 2_400_000,
  rMax_kpc: 16,
  discScaleLength_kpc: MW.thinScaleLength_kpc,
  thinScaleHeight_pc: MW.thinScaleHeight_pc,
  bulgeFraction: 0.18,
  bulgeScaleLength_kpc: 0.7,
  armCount: 2,
  armPitch_deg: 14,
  armContrast: 0.85,
  armNoise: 0.4,
  armNoiseScale: 0.55,
  armBlue: 0.7,
  clumpFraction: 0.13,
  clumpScale_pc: 220,
  barFraction: 0.08,
  barLength_kpc: 4.2,
  barAxisRatio: 0.32,
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

/** Warped m-arm density-wave value at galactocentric (R kpc, φ): +1 on an arm ridge, −1 between. The
 *  phase is bent by FBM so arms branch/feather instead of forming a perfect logarithmic spiral. */
function armWave(Rkpc: number, phi: number, cfg: PhysicalGalaxyConfig, noiseSeed: number): number {
  const cot = 1 / Math.tan(cfg.armPitch_deg * DEG2RAD);
  const x = Rkpc * Math.cos(phi) * cfg.armNoiseScale;
  const z = Rkpc * Math.sin(phi) * cfg.armNoiseScale;
  const warp = cfg.armNoise * Math.PI * fbm(x, z, noiseSeed);
  const psi = cfg.armCount * (phi - cot * Math.log(Math.max(Rkpc, 0.05) / MW.R0_kpc)) + warp;
  return Math.cos(psi);
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

/** Draw one disc star: exponential R, φ rejection-sampled into the warped arm wave AND beyond the bar —
 *  the bar TRUNCATES the inner spiral (a longer bar carves a larger hole and pushes the arms out, so bar
 *  length changes spiral density rather than overlaying particles); sech² height. */
function sampleDiscStar(rng: () => number, cfg: PhysicalGalaxyConfig, noiseSeed: number): Star {
  const denom = 1 + cfg.armContrast;
  // Inner spiral fades in across [0.55·Lbar, 1.1·Lbar]: disc stars don't form where the bar dominates.
  const cutLo = cfg.barLength_kpc * 0.55;
  const cutHi = cfg.barLength_kpc * 1.1;
  const barred = cfg.barLength_kpc > 0.05 && cfg.barFraction > 0.001;
  let Rkpc = gamma2(rng, cfg.discScaleLength_kpc);
  let phi = rng() * Math.PI * 2;
  for (let t = 0; t < 6; t++) {
    const armP = (1 + cfg.armContrast * armWave(Rkpc, phi, cfg, noiseSeed)) / denom;
    const barP = barred ? smoothstep(cutLo, cutHi, Rkpc) : 1;
    if (rng() <= armP * barP) break;
    Rkpc = gamma2(rng, cfg.discScaleLength_kpc);
    phi = rng() * Math.PI * 2;
  }
  if (Rkpc > cfg.rMax_kpc) Rkpc = cfg.rMax_kpc * Math.sqrt(rng());
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

  // Pre-seed star-forming knot centres ON the arms (drawn from the disc+arm distribution).
  const NC = 420;
  const clumps: Star[] = [];
  for (let k = 0; k < NC; k++) clumps.push(sampleDiscStar(rng, cfg, noiseSeed));
  const clumpSigma = cfg.clumpScale_pc / 1000; // kpc
  const hz = cfg.thinScaleHeight_pc / 1000;
  const barAng = cfg.barAngle_deg * DEG2RAD;

  for (let i = 0; i < n; i++) {
    const roll = rng();
    let s: Star;
    if (roll < cfg.barFraction) {
      // Central bar: elongated along barAngle, thin perpendicular + vertical, intermediate-age pop.
      const along = (rng() * 2 - 1) * cfg.barLength_kpc;
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
      // Star-forming knot: scatter around a clump centre on an arm (bright, blue).
      const c = clumps[(Math.floor(rng() * NC)) % NC]!;
      const r = clumpSigma * Math.sqrt(-2 * Math.log(1 - rng()));
      const a = rng() * Math.PI * 2;
      const u = Math.min(0.9995, Math.max(0.0005, rng()));
      let kx = c.gx + r * Math.cos(a);
      let kz = c.gz + r * Math.sin(a);
      const kR = Math.hypot(kx, kz); // a knot scattered past the rim is pulled back to the cutoff
      if (kR > cfg.rMax_kpc) { const f = cfg.rMax_kpc / kR; kx *= f; kz *= f; }
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
    const i3 = i * 3;
    positions[i3] = s.gx * KPC_TO_WU;
    positions[i3 + 1] = s.gy * KPC_TO_WU;
    positions[i3 + 2] = s.gz * KPC_TO_WU;
    colors[i3] = r * (1 - t) + 0.45 * t;
    colors[i3 + 1] = g * (1 - t) + 0.66 * t;
    colors[i3 + 2] = b * (1 - t) + 1.0 * t;
    sizes[i] = sz;
    crests[i] = s.crest;
  }
  return { positions, colors, sizes, crests, count: n };
}

/** Build the renderable Points (additive star sprites) for a sampled galaxy. Positions are absolute
 *  galactocentric WU with the centre at the scene origin (float32 ULP at ±16 kpc ≈ sub-pc). */
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
  dustContrast: number;       // how tightly dust hugs the arms
  dustFilament: number;       // 0 = smooth lane … 1 = spindly tendrils that detach + recoalesce
  dustFilamentScale: number;  // spatial frequency of the tendrils (per kpc)
}

export const DEFAULT_DUST_CONFIG: DustConfig = {
  dustCount: 700_000, dustOpacity: 0.16, dustScaleHeight_pc: 120, dustLeadDeg: 18, dustContrast: 0.92,
  dustFilament: 0.7, dustFilamentScale: 2.1,
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
  const hz = dust.dustScaleHeight_pc / 1000;
  const lead = (dust.dustLeadDeg * DEG2RAD) / Math.max(1, cfg.armCount);
  const denom = 1 + dust.dustContrast;
  const fil = Math.max(0, Math.min(1, dust.dustFilament));
  const fScale = dust.dustFilamentScale;
  const fSeed = noiseSeed + 1013;
  for (let i = 0; i < n; i++) {
    let Rkpc = gamma2(rng, cfg.discScaleLength_kpc * 1.05);
    let phi = rng() * Math.PI * 2;
    // Accept onto the arm leading-edge wave AND onto a high-frequency ridged-noise filament field, so the
    // dust breaks into spindly tendrils that detach and recoalesce along the arm instead of a smooth lane.
    for (let t = 0; t < 7; t++) {
      const armP = (1 + dust.dustContrast * armWave(Rkpc, phi + lead, cfg, noiseSeed)) / denom;
      let filP = 1;
      if (fil > 0) {
        const fx = Rkpc * Math.cos(phi) * fScale;
        const fz = Rkpc * Math.sin(phi) * fScale;
        filP = (1 - fil) + fil * ridge(fx, fz, fSeed, 2.4);
      }
      if (rng() <= armP * filP) break;
      Rkpc = gamma2(rng, cfg.discScaleLength_kpc * 1.05);
      phi = rng() * Math.PI * 2;
    }
    if (Rkpc > cfg.rMax_kpc) Rkpc = cfg.rMax_kpc * Math.sqrt(rng());
    const u = Math.min(0.9995, Math.max(0.0005, rng()));
    const i3 = i * 3;
    positions[i3] = Rkpc * Math.cos(phi) * KPC_TO_WU;
    positions[i3 + 1] = hz * Math.atanh(2 * u - 1) * KPC_TO_WU;
    positions[i3 + 2] = Rkpc * Math.sin(phi) * KPC_TO_WU;
    sizes[i] = 6 + rng() * 12;                           // finer dust so tendrils read as threads, not blobs
    opacities[i] = dust.dustOpacity * (0.45 + 0.55 * rng());
  }
  return { positions, sizes, opacities, count: n };
}

const dustVertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aOpacity;
  uniform float uPixelRatio;
  uniform float uOpacityScale;
  varying float vOpacity;
  void main() {
    vOpacity = aOpacity * uOpacityScale;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
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
  const material = new ShaderMaterial({
    vertexShader: dustVertexShader,
    fragmentShader: dustFragmentShader,
    uniforms: {
      uPixelRatio: { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1 },
      uOpacityScale: { value: 1.0 },
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
