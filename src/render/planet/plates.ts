// ═══════════════════════════════════════════════════════════════════
// TECTONICS — the macro structure of a world (Phase 2, v2 plan §Subsystems 1)
//
// Guide star: World Orogen (orogen.studio). Two DECOUPLED layers, exactly as the
// reference separates them:
//   • CONTINENTS — a few big landmasses (Orogen "Continents: 4") set by a small
//     set of continent seeds and a target LAND COVERAGE. This is the base
//     land/ocean shape.
//   • PLATES — many tectonic cells (Orogen "Plates: 80") whose BOUNDARIES make
//     mountain ranges: convergent boundaries push up ranges that spread inland,
//     divergent ones open rifts. Plates are independent of continents, so ranges
//     run through continental interiors and along coasts, not around cells.
// Strong domain warp + fBm/ridged detail (glsl.ts) then dissolve every edge so
// the world reads as natural rather than computed.
//
// This is the ANALYTIC MASTER: pure, deterministic from `planet.seed`, unit-
// tested. `macroHeight()` is the CPU reference; `GLSL_PLATES` (glsl.ts) mirrors
// it. The Phase-3 bake caches macroHeight then runs erosion on the grid (the fine
// hydraulic/glacial detail is a grid sim, not an analytic term) — so the two MUST
// stay in lockstep. Parameters are live-editable (MACRO) and rebuilt on demand.
// ═══════════════════════════════════════════════════════════════════

import type { PlanetVisualType } from '../../data/system-gen';
import { channel, range } from './rng';

export type Vec3 = readonly [number, number, number];

/** Fixed uniform-array caps — MUST match MAX_PLATES / MAX_CONTINENTS in GLSL. */
export const MAX_PLATES = 48;
export const MAX_CONTINENTS = 8;

/** Orogen-style macro controls, live-editable in the lab (rebuild on change). */
export interface MacroParams {
  plateCount: number;     // tectonic plates — boundaries become ranges (Orogen "Plates")
  continents: number;     // major landmasses (Orogen "Continents")
  landCoverage: number;   // 0..1 target land fraction (Orogen "Land Coverage")
  sizeVariety: number;    // 0..1 continent size variance (Orogen "Continent Size Variety")
  uplift: number;         // convergent-boundary range height
  rangeWidth: number;     // how far ranges spread inland from a boundary (dot-space)
  detailScale: number;    // fBm/ridged detail frequency multiplier (fine vs lumpy)
  normalStrength: number; // relief-normal (bump) depth — shading only, not geometry
  coastAmp: number;       // coastline-fracture amplitude (radians the shoreline meanders)
  coastFreq: number;      // coastline-fracture frequency (bay/peninsula scale)
  rangeVar: number;       // along-boundary uplift variation (0 = uniform wall, 1 = broken peaks)
  // ── optional surface ephemera (Mercury/Mars/Venus reference) ──
  craters: number;        // impact-crater coverage 0..1 (0 = off)
  craterFreq: number;     // crater density / size scale
  craterDepth: number;    // crater bowl depth / rim height
  canyons: number;        // rift-canyon coverage 0..1 (0 = off)
  canyonFreq: number;     // rift-system scale (higher = more, smaller systems)
  canyonDepth: number;    // trough depth
}

/** Editable macro defaults per archetype. The lab mutates these and rebuilds; the
 *  Copy-JSON action snapshots them alongside the presets. Ocean worlds are ~30%
 *  land with a few continents; desert/rocky are land-dominant; lava is broken up
 *  into many plates (vigorous tectonics). Giants never call terrainHeight. */
export const MACRO: Record<PlanetVisualType, MacroParams> = {
  rocky:  { plateCount: 22, continents: 5, landCoverage: 0.82, sizeVariety: 0.4, uplift: 0.30, rangeWidth: 0.05, detailScale: 3.0, normalStrength: 0.22, coastAmp: 0.35, coastFreq: 2.2, rangeVar: 0.6, craters: 0.5, craterFreq: 16, craterDepth: 0.09 , canyons: 0.3, canyonFreq: 2.6, canyonDepth: 0.10 },
  ocean:  { plateCount: 26, continents: 4, landCoverage: 0.30, sizeVariety: 0.35, uplift: 0.26, rangeWidth: 0.055, detailScale: 3.0, normalStrength: 0.20, coastAmp: 0.40, coastFreq: 2.4, rangeVar: 0.55, craters: 0.15, craterFreq: 20, craterDepth: 0.05 , canyons: 0.15, canyonFreq: 2.6, canyonDepth: 0.08 },
  desert: { plateCount: 18, continents: 3, landCoverage: 0.92, sizeVariety: 0.5, uplift: 0.32, rangeWidth: 0.05, detailScale: 3.2, normalStrength: 0.24, coastAmp: 0.30, coastFreq: 2.0, rangeVar: 0.65, craters: 0.55, craterFreq: 14, craterDepth: 0.08 , canyons: 0.45, canyonFreq: 2.4, canyonDepth: 0.12 },
  lava:   { plateCount: 30, continents: 6, landCoverage: 0.68, sizeVariety: 0.45, uplift: 0.36, rangeWidth: 0.045, detailScale: 3.5, normalStrength: 0.26, coastAmp: 0.38, coastFreq: 2.6, rangeVar: 0.7, craters: 0.25, craterFreq: 18, craterDepth: 0.05 , canyons: 0.3, canyonFreq: 3.0, canyonDepth: 0.08 },
  ice:    { plateCount: 8, continents: 3, landCoverage: 0.5, sizeVariety: 0.3, uplift: 0.2, rangeWidth: 0.06, detailScale: 3.0, normalStrength: 0.2, coastAmp: 0.32, coastFreq: 2.2, rangeVar: 0.5, craters: 0, craterFreq: 16, craterDepth: 0.06 , canyons: 0.2, canyonFreq: 2.8, canyonDepth: 0.06 },
  gas:    { plateCount: 8, continents: 3, landCoverage: 0.5, sizeVariety: 0.3, uplift: 0.2, rangeWidth: 0.06, detailScale: 3.0, normalStrength: 0.2, coastAmp: 0, coastFreq: 2.2, rangeVar: 0, craters: 0, craterFreq: 16, craterDepth: 0.06 , canyons: 0, canyonFreq: 2.6, canyonDepth: 0 },
};

/** Base elevations (normalised) the continent field ramps between. Ranges rise
 *  above `LAND` up toward 1; the per-type sea level slider sets the waterline. */
const OCEAN_FLOOR = 0.20;
const LAND_HEIGHT = 0.68;

export function macroParams(type: PlanetVisualType): MacroParams {
  return MACRO[type] ?? MACRO.rocky;
}

/** A world's tectonics — a few continents + many plates, deterministic from seed. */
export interface PlateField {
  // continents (base land/ocean shape)
  continentCount: number;
  contSeeds: Vec3[];      // unit continent-centre directions
  contSize: number[];     // per-continent angular cap radius (radians)
  // plates (boundaries → ranges)
  plateCount: number;
  plateSeeds: Vec3[];     // unit plate-centre directions
  plateMotion: Vec3[];    // per-plate tangent drift
  // shared scalars mirrored into the shader
  uplift: number;
  rangeWidth: number;
  coastAmp: number;
  coastFreq: number;
  rangeVar: number;
}

// ── vector helpers (plain arrays; no Three.js so the module stays pure) ──
function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

/** A unit vector tangent to the sphere at `n`, rotated by `a` in the tangent frame. */
function tangent(n: Vec3, a: number): Vec3 {
  const up: Vec3 = Math.abs(n[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const t = norm([up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]]);
  const b: Vec3 = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
  return norm([t[0] * Math.cos(a) + b[0] * Math.sin(a), t[1] * Math.cos(a) + b[1] * Math.sin(a), t[2] * Math.cos(a) + b[2] * Math.sin(a)]);
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.39996 rad

/** Scatter `n` seeds on the unit sphere (Fibonacci lattice + seeded jitter). */
function scatter(n: number, rng: () => number): Vec3[] {
  const out: Vec3[] = [];
  const jit = 0.9 / Math.sqrt(Math.max(1, n));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * GOLDEN_ANGLE;
    out.push(norm([
      r * Math.cos(th) + range(rng, -jit, jit),
      y + range(rng, -jit, jit),
      r * Math.sin(th) + range(rng, -jit, jit),
    ]));
  }
  return out;
}

/**
 * Build a world's tectonics, deterministic from `seed` + archetype macro tuning.
 * Continents and plates are separate seed-split channels: continents set the base
 * land shape; plates only supply boundaries (ranges). Continent cap radii come
 * from the target land coverage (a cap of area 2π(1−cos r); C caps ≈ coverage·4π),
 * jittered by size variety.
 */
export function generatePlates(seed: number, type: PlanetVisualType): PlateField {
  const mp = macroParams(type);
  const nCont = Math.min(MAX_CONTINENTS, Math.max(1, Math.round(mp.continents)));
  const nPlate = Math.min(MAX_PLATES, Math.max(3, Math.round(mp.plateCount)));

  const cPlace = channel(seed >>> 0, 'cont-place');
  const cSize = channel(seed >>> 0, 'cont-size');
  const pPlace = channel(seed >>> 0, 'plate-place');
  const pMove = channel(seed >>> 0, 'plate-move');

  const contSeeds = scatter(nCont, cPlace);
  // Mean cap radius so the caps cover ≈ landCoverage of the sphere.
  const cov = Math.min(0.98, Math.max(0.02, mp.landCoverage));
  const meanCos = Math.max(-0.999, 1 - (2 * cov) / nCont);
  const meanR = Math.acos(meanCos);
  const contSize = contSeeds.map(() => meanR * (1 + mp.sizeVariety * range(cSize, -1, 1) * 0.6));

  const plateSeeds = scatter(nPlate, pPlace);
  const plateMotion = plateSeeds.map((p) => {
    const dir = tangent(p, range(pMove, 0, Math.PI * 2));
    const speed = range(pMove, 0.4, 1.0);
    return [dir[0] * speed, dir[1] * speed, dir[2] * speed] as Vec3;
  });

  return {
    continentCount: nCont, contSeeds, contSize,
    plateCount: nPlate, plateSeeds, plateMotion,
    uplift: mp.uplift, rangeWidth: mp.rangeWidth,
    coastAmp: mp.coastAmp, coastFreq: mp.coastFreq, rangeVar: mp.rangeVar,
  };
}

// ── Coastline-fracture value-noise ──────────────────────────────────
// Shared with GLSL_COAST (glsl.ts) — the SAME integer-hash value noise both
// sides run, so a baked coast and a live coast agree (to float precision; the
// GPU is float32, this is float64, which differs by <<1 texel — imperceptible,
// and far smaller than the pre-existing baked/warp gap). All hashing is done in
// unsigned 32-bit (Math.imul + >>>0) to mirror GLSL uint wraparound exactly.
// This is a MACRO term (a function of direction, continuous across cube faces),
// NOT fine detail — it decides WHERE the shoreline is, so it must be shared.
function uhash(X: number, Y: number, Z: number): number {
  let h = (Math.imul(X | 0, 374761393) + Math.imul(Y | 0, 668265263) + Math.imul(Z | 0, 1274126177)) >>> 0;
  h = Math.imul((h ^ (h >>> 13)) >>> 0, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}
function coastNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number): number => uhash(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}
/** 4-octave fBm of the shared coast noise, centred to ~[-0.5,0.5]. */
function coastFbm(dir: Vec3, freq: number): number {
  let f = 0, amp = 0.5, fr = freq;
  for (let i = 0; i < 4; i++) {
    f += amp * coastNoise(dir[0] * fr + 19.1, dir[1] * fr + 47.7, dir[2] * fr + 83.3);
    fr *= 2; amp *= 0.5;
  }
  return f - 0.47; // fBm sum mean ≈ 0.47 → roughly zero-centred
}

/**
 * Analytic macro elevation for a unit direction — the CPU reference that
 * `GLSL_PLATES.plateMacro` mirrors. Continents set a base land/ocean height;
 * plate boundaries add convergent ranges / divergent rifts on top. Returns a
 * normalised height in [0,1]. (High-frequency ridged detail is layered in the
 * shader / bake, not here — this is the smooth master.)
 */
export function macroHeight(f: PlateField, dir: Vec3): number {
  // NB: the live shader passes an isotropic-simplex-warped `dir`; the bake passes
  // it unwarped (the known baked/unbaked parity gap — fixed later with a CPU
  // simplex port, NOT the value-noise warp that faceted the plate boundaries).
  // ── continents: base land/ocean shape ──
  // The cap edge is FRACTURED by a shared multi-octave value-noise so the
  // shoreline is an iso-contour of a fractal field (bays/peninsulas/near-shore
  // islands) rather than a smooth radial disc. Without this, a cap is a circle
  // and warp only wobbles it — the "glob" failure mode (ledger P-01/P-02/P-03).
  const cn = coastFbm(dir, f.coastFreq) * f.coastAmp; // radians the coast meanders
  let base = OCEAN_FLOOR;
  for (let i = 0; i < f.continentCount; i++) {
    const d = Math.acos(Math.min(1, Math.max(-1, dot(dir, f.contSeeds[i]))));
    const land = smoothstep(f.contSize[i], f.contSize[i] * 0.5, d + cn); // fractal shoreline
    base = Math.max(base, OCEAN_FLOOR + (LAND_HEIGHT - OCEAN_FLOOR) * land);
  }

  // ── plates: nearest two → boundary landform ──
  let d1 = -Infinity, d2 = -Infinity, i1 = 0, i2 = 0;
  for (let i = 0; i < f.plateCount; i++) {
    const dp = dot(dir, f.plateSeeds[i]);
    if (dp > d1) { d2 = d1; i2 = i1; d1 = dp; i1 = i; }
    else if (dp > d2) { d2 = dp; i2 = i; }
  }
  const range01 = Math.exp(-(d1 - d2) / f.rangeWidth); // 1 at boundary → 0 inland
  const axis = norm(sub(f.plateSeeds[i2], f.plateSeeds[i1]));
  const conv = dot(f.plateMotion[i1], axis) - dot(f.plateMotion[i2], axis); // >0 converging
  // P-04: vary uplift ALONG the boundary (higher-freq shared noise) so ranges
  // break into peaks and rise/fall along their length instead of a uniform wall.
  // Mean-preserving (rv≈1 on average) so archetype uplift stays calibrated.
  const rv = Math.min(2, Math.max(0.1, 1 + f.rangeVar * (2 * coastFbm(dir, 5.5))));
  // convergent → mountains (full uplift); divergent → shallower rift
  base += range01 * conv * f.uplift * (conv > 0 ? 1 : 0.5) * rv;

  return Math.min(1, Math.max(0, base));
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
}

// ── uniform packing (fixed-size arrays for the shader) ──
function packVecs(vs: Vec3[], max: number): Float32Array {
  const a = new Float32Array(max * 3);
  for (let i = 0; i < vs.length; i++) { a[i * 3] = vs[i][0]; a[i * 3 + 1] = vs[i][1]; a[i * 3 + 2] = vs[i][2]; }
  return a;
}
function packFloats(xs: number[], max: number): Float32Array {
  const a = new Float32Array(max);
  for (let i = 0; i < xs.length; i++) a[i] = xs[i];
  return a;
}

export function packContSeeds(f: PlateField): Float32Array { return packVecs(f.contSeeds, MAX_CONTINENTS); }
export function packContSize(f: PlateField): Float32Array { return packFloats(f.contSize, MAX_CONTINENTS); }
export function packPlateSeeds(f: PlateField): Float32Array { return packVecs(f.plateSeeds, MAX_PLATES); }
export function packPlateMotion(f: PlateField): Float32Array { return packVecs(f.plateMotion, MAX_PLATES); }
