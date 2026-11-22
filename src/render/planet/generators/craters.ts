// Lague crater-stamping for Rocky-airless bodies (Mercury/Vulcan-class).
// docs/planet-visual-realism.md §2.4(a) — exact formula, MIT reference impl:
// https://github.com/SebLague/Solar-System (Craters.cginc).
//
// Craters are generated once per body (pure function of `seed` — same seed,
// same craters, forever, per the project's determinism discipline) and
// stamped in 3D unit-sphere direction space, never UV, so there is no
// equirect wrap-seam or pole-pinch artifact (the acceptance bar this task
// must clear). A coarse cube-lattice bucket keeps per-sample lookup cheap
// (O(few), not O(craterCount)) so the bake stays inside the existing
// chunk-build time budget even at the high end of the 50-300 crater range.

import type { Vec3 } from '../cube-sphere';
import { channel, range } from '../rng';

export interface Crater {
  readonly center: Vec3;
  readonly radius: number;
  readonly rimWidth: number;
  readonly rimSteepness: number;
  readonly floorHeight: number;
  readonly smoothing: number;
}

export interface CraterField {
  readonly craters: readonly Crater[];
  readonly cellsPerAxis: number;
  readonly buckets: ReadonlyMap<number, readonly number[]>;
}

const MIN_CRATERS = 50;
const MAX_CRATERS = 300;
const MIN_RADIUS = 0.012;
const MAX_RADIUS = 0.16;

/** Real lunar/Mercurian size-frequency statistics: cumulative N(>D) ~ D^-2
 *  (https://www.lpi.usra.edu/lunar/tools/lunarcratercalc/theory.pdf), i.e. a
 *  differential density ~ D^-3. CDF inversion for p(r) ~ r^-3 on [rMin,rMax]:
 *  many small craters, a few large ones. */
function powerLawRadius(u: number, rMin: number, rMax: number): number {
  const a = rMin ** -2;
  const b = rMax ** -2;
  return (u * (b - a) + a) ** -0.5;
}

/** Uniform-random point on the unit sphere from a seeded RNG stream. */
function randomUnitVec(rng: () => number): Vec3 {
  const z = range(rng, -1, 1);
  const phi = range(rng, 0, Math.PI * 2);
  const s = Math.sqrt(Math.max(0, 1 - z * z));
  return [s * Math.cos(phi), s * Math.sin(phi), z];
}

function cellIndex(v: number, cellsPerAxis: number): number {
  return Math.max(0, Math.min(cellsPerAxis - 1, Math.floor((v * 0.5 + 0.5) * cellsPerAxis)));
}

function bucketKey(cx: number, cy: number, cz: number, cellsPerAxis: number): number {
  return (cx * cellsPerAxis + cy) * cellsPerAxis + cz;
}

/** How far (chord distance) a crater's `shape` term still meaningfully
 *  differs from 0 — beyond this, skip it entirely. */
function craterReach(c: Pick<Crater, 'radius' | 'rimWidth' | 'smoothing'>): number {
  return c.radius * (1 + c.rimWidth + 3 * c.smoothing);
}

/** Build a body's crater set + spatial bucket — pure function of `seed`.
 *  50-300 craters (design range), power-law radii, floors biased shallower
 *  for larger craters (real basins are broad and comparatively shallow;
 *  small bowls are proportionally deep). */
export function generateCraterField(seed: number): CraterField {
  const rng = channel(seed, 'craters');
  const count = Math.round(range(rng, MIN_CRATERS, MAX_CRATERS));
  const craters: Crater[] = [];
  const reaches: number[] = [];
  for (let i = 0; i < count; i++) {
    const center = randomUnitVec(rng);
    const radius = powerLawRadius(rng(), MIN_RADIUS, MAX_RADIUS);
    const sizeT = Math.min(1, Math.max(0, (radius - MIN_RADIUS) / (MAX_RADIUS - MIN_RADIUS)));
    // Bigger, bolder than a literal 1:1 real-world profile would be — this is
    // the archetype's ONE defining relief signal (docs/planet-visual-realism.md
    // §2.4(a)), competing against a dialed-back but non-zero ridged-fBm floor
    // (see terrainHeight's reliefScale), so it needs to clearly read at orbit
    // distance, not just up close.
    const floorHeight = -(1.8 - 1.2 * sizeT) + range(rng, -0.12, 0.12);
    const rimWidth = range(rng, 0.15, 0.35);
    const rimSteepness = range(rng, 4.0, 8.0);
    const smoothing = range(rng, 0.15, 0.28);
    const crater: Crater = { center, radius, rimWidth, rimSteepness, floorHeight, smoothing };
    craters.push(crater);
    reaches.push(craterReach(crater));
  }

  // Cell width targets the median crater's reach so most craters occupy a
  // handful of cells; the rarer large outliers just span a few more.
  const sortedReach = [...reaches].sort((a, b) => a - b);
  const medianReach = sortedReach.length
    ? sortedReach[Math.floor(sortedReach.length / 2)]
    : MIN_RADIUS;
  const cellsPerAxis = Math.max(4, Math.min(24, Math.round(1 / Math.max(1e-3, medianReach))));
  const cellWidth = 2 / cellsPerAxis;

  const buckets = new Map<number, number[]>();
  for (let i = 0; i < craters.length; i++) {
    const c = craters[i];
    const cx = cellIndex(c.center[0], cellsPerAxis);
    const cy = cellIndex(c.center[1], cellsPerAxis);
    const cz = cellIndex(c.center[2], cellsPerAxis);
    const span = Math.min(4, Math.max(1, Math.ceil(reaches[i] / cellWidth)));
    for (let dx = -span; dx <= span; dx++) {
      const bx = cx + dx;
      if (bx < 0 || bx >= cellsPerAxis) continue;
      for (let dy = -span; dy <= span; dy++) {
        const by = cy + dy;
        if (by < 0 || by >= cellsPerAxis) continue;
        for (let dz = -span; dz <= span; dz++) {
          const bz = cz + dz;
          if (bz < 0 || bz >= cellsPerAxis) continue;
          const key = bucketKey(bx, by, bz, cellsPerAxis);
          let arr = buckets.get(key);
          if (!arr) { arr = []; buckets.set(key, arr); }
          arr.push(i);
        }
      }
    }
  }

  return { craters, cellsPerAxis, buckets };
}

function smoothMin(a: number, b: number, k: number): number {
  if (k <= 1e-6) return Math.min(a, b);
  const h = Math.max(0, Math.min(1, (b - a + k) / (2 * k)));
  return a * h + b * (1 - h) - k * h * (1 - h);
}

function smoothMax(a: number, b: number, k: number): number {
  return -smoothMin(-a, -b, k);
}

/** Sebastian Lague's crater formula, verbatim (§2.4(a)):
 *  x = dist(pos,centre)/radius; cavity = x²−1; rimX = min(x−1−rimWidth, 0);
 *  rim = rimSteepness·rimX²; shape = smoothMin(smoothMax(cavity, floorHeight,
 *  s), rim, s); height += shape·radius. */
function craterShapeHeight(dir: Vec3, c: Crater): number {
  const dx = dir[0] - c.center[0];
  const dy = dir[1] - c.center[1];
  const dz = dir[2] - c.center[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const x = dist / c.radius;
  const cavity = x * x - 1;
  const rimX = Math.min(x - 1 - c.rimWidth, 0);
  const rim = c.rimSteepness * rimX * rimX;
  const shape = smoothMin(smoothMax(cavity, c.floorHeight, c.smoothing), rim, c.smoothing);
  return shape * c.radius;
}

/** Additive height contribution from every crater whose reach could plausibly
 *  cover `dir` (a unit direction). O(craters-in-bucket), not O(all craters). */
export function sampleCraterHeight(dir: Vec3, field: CraterField): number {
  const { craters, cellsPerAxis, buckets } = field;
  const cx = cellIndex(dir[0], cellsPerAxis);
  const cy = cellIndex(dir[1], cellsPerAxis);
  const cz = cellIndex(dir[2], cellsPerAxis);
  const idx = buckets.get(bucketKey(cx, cy, cz, cellsPerAxis));
  if (!idx || idx.length === 0) return 0;
  let h = 0;
  for (const i of idx) {
    const c = craters[i];
    const dx = dir[0] - c.center[0];
    const dy = dir[1] - c.center[1];
    const dz = dir[2] - c.center[2];
    const distSq = dx * dx + dy * dy + dz * dz;
    const reach = craterReach(c);
    if (distSq > reach * reach) continue;
    h += craterShapeHeight(dir, c);
  }
  return h;
}

/** Memoized per-seed — the field is a pure function of `seed`, so every
 *  chunk/brick sample for the same body reuses the same generated set
 *  instead of re-rolling it per call. Small bounded cache (Lab authoring can
 *  churn through many seeds in one session) — evicts the oldest entry past
 *  the cap rather than growing unboundedly. */
const MAX_CACHED_FIELDS = 32;
const fieldCache = new Map<number, CraterField>();
export function getCraterField(seed: number): CraterField {
  const cached = fieldCache.get(seed);
  if (cached) return cached;
  const f = generateCraterField(seed);
  if (fieldCache.size >= MAX_CACHED_FIELDS) {
    const oldest = fieldCache.keys().next().value;
    if (oldest !== undefined) fieldCache.delete(oldest);
  }
  fieldCache.set(seed, f);
  return f;
}
