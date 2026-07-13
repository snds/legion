// ═══════════════════════════════════════════════════════════════════
// TECTONIC PLATES — the macro structure of a world (Phase 2, v2 plan §Subsystems 1)
//
// Guide star: World Orogen. Continents, coastlines and mountain ranges come from
// a spherical Voronoi tessellation of the sphere into PLATES, not from raw noise:
//   • plate seeds are scattered evenly (Fibonacci lattice) then jittered,
//   • each plate is continental (high) or oceanic (low) with a base elevation,
//   • each plate drifts along a tangent MOTION vector,
//   • at a plate boundary the relative motion decides the landform — convergent
//     plates PUSH UP ranges, divergent plates OPEN rifts.
// fBm/ridged detail (glsl.ts) is layered on top and warps the boundary so the
// cells never read as polygons — that blend is `terrainHeight()`.
//
// This module is the ANALYTIC MASTER: pure, deterministic from `planet.seed`, and
// unit-tested. `macroHeight()` is the CPU reference; `GLSL_PLATES` (glsl.ts) is a
// line-for-line mirror the surface shader evaluates directly. The future 8K bake
// (Phase 3) is just a cache over `macroHeight` — so the two MUST stay in lockstep.
// ═══════════════════════════════════════════════════════════════════

import type { PlanetVisualType } from '../../data/system-gen';
import { channel, range } from './rng';

export type Vec3 = readonly [number, number, number];

/** A deterministic tessellation of the unit sphere into drifting plates. Arrays
 *  are parallel (index = plate id); `seed[i]` is a unit direction on the sphere. */
export interface PlateField {
  count: number;
  seeds: Vec3[];      // unit plate-centre directions
  elev: number[];     // per-plate base elevation, normalised [0,1]
  motion: Vec3[];     // per-plate drift (tangent to the sphere at `seeds[i]`)
  boundaryWidth: number; // dot-space half-width of the boundary band
  uplift: number;     // range-height gain applied to convergent boundaries
}

/** Per-archetype macro tuning. Ocean/rocky worlds are mostly water with a few
 *  continents; desert/lava are near-solid land with little "sea". Defaults are
 *  chosen so the SAME seed reads as a plausible member of the type. */
export interface MacroParams {
  plateCount: number;        // number of plates (more ⇒ smaller continents)
  continentalFraction: number; // share of plates that are land
  contElev: readonly [number, number]; // continental base-elevation range
  oceanElev: readonly [number, number]; // oceanic base-elevation range
  drift: number;             // plate drift speed (scales uplift contrast)
  uplift: number;            // convergent-boundary range height
  boundaryWidth: number;     // dot-space width of the coastal/boundary band
}

const MACRO: Record<PlanetVisualType, MacroParams> = {
  rocky: { plateCount: 14, continentalFraction: 0.55, contElev: [0.58, 0.82], oceanElev: [0.30, 0.46], drift: 1.0, uplift: 0.28, boundaryWidth: 0.05 },
  ocean: { plateCount: 12, continentalFraction: 0.34, contElev: [0.60, 0.80], oceanElev: [0.12, 0.34], drift: 1.0, uplift: 0.24, boundaryWidth: 0.06 },
  desert: { plateCount: 10, continentalFraction: 0.78, contElev: [0.50, 0.78], oceanElev: [0.34, 0.46], drift: 0.9, uplift: 0.30, boundaryWidth: 0.05 },
  lava: { plateCount: 16, continentalFraction: 0.62, contElev: [0.46, 0.80], oceanElev: [0.24, 0.40], drift: 1.3, uplift: 0.34, boundaryWidth: 0.04 },
  // Giants never call terrainHeight (banded-cloud material); kept for completeness.
  ice: { plateCount: 8, continentalFraction: 0.5, contElev: [0.5, 0.7], oceanElev: [0.3, 0.45], drift: 1.0, uplift: 0.2, boundaryWidth: 0.06 },
  gas: { plateCount: 8, continentalFraction: 0.5, contElev: [0.5, 0.7], oceanElev: [0.3, 0.45], drift: 1.0, uplift: 0.2, boundaryWidth: 0.06 },
};

/** Hard cap that must match `MAX_PLATES` in GLSL_PLATES — the uniform arrays are
 *  fixed-size, so `generatePlates` never returns more than this many plates. */
export const MAX_PLATES = 24;

/** Macro tuning for a visual type (rocky fallback for anything unmapped). */
export function macroParams(type: PlanetVisualType): MacroParams {
  return MACRO[type] ?? MACRO.rocky;
}

// ── vector helpers (plain arrays; no Three.js so the module stays pure) ──
function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

/** A unit vector tangent to the sphere at `n`, rotated by angle `a` in the local
 *  tangent frame — used to give each plate a drift direction. */
function tangent(n: Vec3, a: number): Vec3 {
  const up: Vec3 = Math.abs(n[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const t = norm([up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]]);
  const b: Vec3 = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
  return norm([t[0] * Math.cos(a) + b[0] * Math.sin(a), t[1] * Math.cos(a) + b[1] * Math.sin(a), t[2] * Math.cos(a) + b[2] * Math.sin(a)]);
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.39996 rad

/**
 * Build a world's plate field, deterministic from `seed` + archetype tuning.
 * Seeds start on a Fibonacci lattice (even coverage, no clumping) then take a
 * seeded jitter so no two worlds tessellate alike. Land/ocean assignment and
 * drift are seed-split channels so they don't correlate.
 */
export function generatePlates(seed: number, type: PlanetVisualType): PlateField {
  const mp = macroParams(type);
  const n = Math.min(MAX_PLATES, Math.max(3, mp.plateCount));
  const place = channel(seed >>> 0, 'plate-place');
  const kind = channel(seed >>> 0, 'plate-kind');
  const move = channel(seed >>> 0, 'plate-move');

  const seeds: Vec3[] = [];
  const elev: number[] = [];
  const motion: Vec3[] = [];
  // Jitter magnitude ~ a third of the mean inter-seed spacing (∝ 1/√n).
  const jit = 0.9 / Math.sqrt(n);

  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;         // −1 … 1
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * GOLDEN_ANGLE;
    let p: Vec3 = [r * Math.cos(th), y, r * Math.sin(th)];
    // seeded jitter, then re-project to the sphere
    p = norm([
      p[0] + range(place, -jit, jit),
      p[1] + range(place, -jit, jit),
      p[2] + range(place, -jit, jit),
    ]);
    seeds.push(p);

    const continental = kind() < mp.continentalFraction;
    const e = continental ? range(kind, mp.contElev[0], mp.contElev[1]) : range(kind, mp.oceanElev[0], mp.oceanElev[1]);
    elev.push(e);

    const speed = mp.drift * range(move, 0.4, 1.0);
    motion.push(tangent(p, range(move, 0, Math.PI * 2)).map((c) => c * speed) as unknown as Vec3);
  }

  return { count: n, seeds, elev, motion, boundaryWidth: mp.boundaryWidth, uplift: mp.uplift };
}

/**
 * Analytic macro elevation for a unit direction — the CPU reference that
 * `GLSL_PLATES.plateMacro` mirrors exactly. Finds the nearest two plates, blends
 * their base elevation across the shared boundary (a smooth coast, not a cliff),
 * then adds a range/rift term from the plates' RELATIVE motion across it.
 * Returns a normalised height in [0,1].
 */
export function macroHeight(f: PlateField, dir: Vec3): number {
  let d1 = -Infinity, d2 = -Infinity, i1 = 0, i2 = 0;
  for (let i = 0; i < f.count; i++) {
    const dp = dot(dir, f.seeds[i]);
    if (dp > d1) { d2 = d1; i2 = i1; d1 = dp; i1 = i; }
    else if (dp > d2) { d2 = dp; i2 = i; }
  }
  const bw = f.boundaryWidth;
  // Blend base elevation across the boundary: t=1 deep inside plate i1, t=0.5 on
  // the exact boundary (equidistant), so coastlines are a ramp not a step.
  const t = smoothstep(0, bw, d1 - d2);
  let h = f.elev[i2] + (f.elev[i1] - f.elev[i2]) * t;

  // Boundary landform: convergence pushes up, divergence rifts down. `axis` runs
  // from plate i1's centre toward i2's; positive relative motion along it = the
  // two plates closing on the boundary.
  const axis = norm(sub(f.seeds[i2], f.seeds[i1]));
  const conv = dot(f.motion[i1], axis) - dot(f.motion[i2], axis);
  const band = 1 - smoothstep(0, bw, d1 - d2); // 1 at boundary → 0 inside
  h += band * conv * f.uplift;

  return Math.min(1, Math.max(0, h));
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
}

// ── uniform packing (fixed MAX_PLATES arrays for the shader) ──
/** Flat [x,y,z]×MAX_PLATES of plate-seed directions (zero-padded past `count`). */
export function packSeeds(f: PlateField): Float32Array {
  const a = new Float32Array(MAX_PLATES * 3);
  for (let i = 0; i < f.count; i++) { a[i * 3] = f.seeds[i][0]; a[i * 3 + 1] = f.seeds[i][1]; a[i * 3 + 2] = f.seeds[i][2]; }
  return a;
}
/** Flat per-plate base elevation (zero-padded past `count`). */
export function packElev(f: PlateField): Float32Array {
  const a = new Float32Array(MAX_PLATES);
  for (let i = 0; i < f.count; i++) a[i] = f.elev[i];
  return a;
}
/** Flat [x,y,z]×MAX_PLATES of plate drift vectors (zero-padded past `count`). */
export function packMotion(f: PlateField): Float32Array {
  const a = new Float32Array(MAX_PLATES * 3);
  for (let i = 0; i < f.count; i++) { a[i * 3] = f.motion[i][0]; a[i * 3 + 1] = f.motion[i][1]; a[i * 3 + 2] = f.motion[i][2]; }
  return a;
}
