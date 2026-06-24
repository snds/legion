// ═══════════════════════════════════════════════════════════════════
// STELLAR POPULATION — IMF-weighted star colour + size sampling
//
// The single source of truth for "what colour and size is a random star".
// Used by the galactic disc star field (galaxy.ts) AND the per-sector embedded
// stars (sector/sector-stars.ts), so resolved stars share one population model.
//
// Each sampler takes a `rand` source (default Math.random). The disc passes
// nothing (non-deterministic, fine — it's a fixed backdrop); the sector passes a
// deterministic mulberry32 so generated stars are reproducible across reloads.
//
// Returns [r, g, b, sizePx]. Colours are pulled toward white — real stars on a
// black sky register as mostly white pinpricks with subtle hue tints rather than
// saturated dots; the tints below match what Gaia DR3 visualisations render.
// ═══════════════════════════════════════════════════════════════════

export type Rand = () => number;

/** Main-sequence + giant mix (IMF-weighted): M-dwarf dominated, sparse giants.
 *  Consumes EXACTLY 4 rand() draws per call (1 selector + 3 value terms), the same
 *  in every branch — so a seeded caller's stream stays aligned regardless of class. */
export function sampleStellarPopulation(rand: Rand = Math.random): [number, number, number, number] {
  const r = rand();
  // M giants — warm pastel
  if (r < 0.05) return [1.0, 0.85 + rand() * 0.07, 0.72 + rand() * 0.08, 4.5 + rand() * 2.0];
  // K giants — pale amber
  if (r < 0.14) return [1.0, 0.92 + rand() * 0.05, 0.82 + rand() * 0.08, 3.5 + rand() * 1.3];
  // O/B supergiants — pale ice blue
  if (r < 0.17) return [0.88 + rand() * 0.06, 0.93 + rand() * 0.05, 1.0, 4.0 + rand() * 2.0];
  // A/F bright main sequence — near-white, slight cool tint
  if (r < 0.27) return [0.97 + rand() * 0.03, 0.98 + rand() * 0.02, 1.0, 2.6 + rand() * 0.9];
  // G/K main sequence — near-white with warm tint (sun-like)
  if (r < 0.55) return [1.0, 0.98 + rand() * 0.02, 0.92 + rand() * 0.05, 1.8 + rand() * 0.7];
  // M dwarfs — pale warm
  return [1.0, 0.88 + rand() * 0.05, 0.78 + rand() * 0.08, 1.1 + rand() * 0.5];
}

/** Halo / bulge — older, slightly warmer pastel. */
export function sampleHaloPopulation(rand: Rand = Math.random): [number, number, number, number] {
  const r = rand();
  if (r < 0.10) return [1.0, 0.90 + rand() * 0.05, 0.80 + rand() * 0.08, 2.8 + rand() * 1.4];
  if (r < 0.45) return [1.0, 0.96 + rand() * 0.03, 0.90 + rand() * 0.05, 1.8 + rand() * 0.6];
  return [1.0, 0.88 + rand() * 0.05, 0.78 + rand() * 0.08, 1.2 + rand() * 0.5];
}
