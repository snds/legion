// ═══════════════════════════════════════════════════════════════════
// PLANET RNG — deterministic per-body randomness for globe generation
//
// Everything the planet renderer decides at build time (palette jitter,
// band offsets, ring placement, noise seed offsets) is a pure function of a
// planet's stable `seed` (Step 0, system-gen.derivePlanetPhysical). We reuse
// the project's canonical deterministic primitives (FNV-1a + mulberry32) so a
// planet regenerates byte-identically on revisit — the determinism discipline
// from docs/procedural-worlds-plan.md (Decision 3).
// ═══════════════════════════════════════════════════════════════════

import { seedFrom, mulberry32 } from '../../data/system-gen';

export { seedFrom, mulberry32 };

/** A small stream of deterministic values seeded from a planet seed + a stable
 *  channel name, so independent generators (bands vs rings vs palette) never
 *  correlate yet each is fully reproducible. */
export function channel(seed: number, name: string): () => number {
  return mulberry32((seedFrom(name) ^ (seed >>> 0)) >>> 0);
}

/** Uniform in [min, max). */
export function range(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** A deterministic 3-vector offset (used as a domain-warp seed for the GPU
 *  noise so two same-type planets never share terrain). Components in [-r, r]. */
export function seedOffset(seed: number, r = 1000): [number, number, number] {
  const rng = channel(seed, 'noise-offset');
  return [range(rng, -r, r), range(rng, -r, r), range(rng, -r, r)];
}
