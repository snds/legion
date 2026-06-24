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

/** Statistically realistic RESOLVED star — number-weighted IMF + blackbody-ish colour.
 *  Where sampleStellarPopulation is a white-pulled, giant-weighted "visible backdrop" mix (a
 *  far field reads as white pinpricks), this reflects the true solar-neighbourhood census: the
 *  overwhelming majority are small, dim RED/ORANGE dwarfs (M ~73%, K ~12%), a sprinkle of
 *  yellow/white (G ~8%, F ~3%), and rare bright BLUE stars (A, B/O). Colour is accurate per
 *  type (saturated, not white-pulled) and SIZE is luminosity-driven — hot/giant stars read as
 *  the larger, brighter pinpoints, dwarfs as the faint majority. For sector stars seen close.
 *  Returns [r, g, b, sizePx]. Consumes a variable (deterministic) number of rand() draws. */
export function sampleRealisticStar(rand: Rand = Math.random): [number, number, number, number] {
  const r = rand();
  // M dwarf (~73%) — red-orange, tiny
  if (r < 0.73) return [1.0, 0.46 + rand() * 0.16, 0.30 + rand() * 0.14, 0.5 + rand() * 0.5];
  // K dwarf (~12%) — orange
  if (r < 0.85) return [1.0, 0.70 + rand() * 0.10, 0.46 + rand() * 0.12, 0.6 + rand() * 0.5];
  // G dwarf (~8%) — yellow-white (sun-like)
  if (r < 0.93) return [1.0, 0.92 + rand() * 0.05, 0.80 + rand() * 0.10, 0.7 + rand() * 0.6];
  // F dwarf (~3%) — white
  if (r < 0.96) return [0.98 + rand() * 0.02, 0.97 + rand() * 0.03, 0.93 + rand() * 0.06, 0.9 + rand() * 0.6];
  // K/M giants (~2.5%) — amber, larger & brighter
  if (r < 0.985) return [1.0, 0.66 + rand() * 0.14, 0.42 + rand() * 0.16, 1.8 + rand() * 1.4];
  // A (~1.2%) — blue-white
  if (r < 0.997) return [0.80 + rand() * 0.12, 0.86 + rand() * 0.08, 1.0, 1.2 + rand() * 0.8];
  // B/O (~0.3%) — blue, bright
  return [0.58 + rand() * 0.14, 0.70 + rand() * 0.12, 1.0, 1.6 + rand() * 1.2];
}

/** Halo / bulge — older, slightly warmer pastel. */
export function sampleHaloPopulation(rand: Rand = Math.random): [number, number, number, number] {
  const r = rand();
  if (r < 0.10) return [1.0, 0.90 + rand() * 0.05, 0.80 + rand() * 0.08, 2.8 + rand() * 1.4];
  if (r < 0.45) return [1.0, 0.96 + rand() * 0.03, 0.90 + rand() * 0.05, 1.8 + rand() * 0.6];
  return [1.0, 0.88 + rand() * 0.05, 0.78 + rand() * 0.08, 1.2 + rand() * 0.5];
}
