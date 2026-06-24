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

// The seven spectral branches — each builds [r,g,b,sizePx] from a `rand` source, consuming the
// SAME draws regardless of which sampler selects it (so both samplers share identical colour bodies
// and sampleArmStar at crestiness 0 reproduces sampleRealisticStar exactly). Order: M, K, G, F,
// giants, A, B/O — reddest/faintest → bluest/brightest. blackbody-ish, saturated (not white-pulled).
const STAR_BRANCHES: ReadonlyArray<(rand: Rand) => [number, number, number, number]> = [
  (rd) => [1.0, 0.46 + rd() * 0.16, 0.30 + rd() * 0.14, 0.5 + rd() * 0.5], // M dwarf — red-orange, tiny
  (rd) => [1.0, 0.70 + rd() * 0.10, 0.46 + rd() * 0.12, 0.6 + rd() * 0.5], // K dwarf — orange
  (rd) => [1.0, 0.92 + rd() * 0.05, 0.80 + rd() * 0.10, 0.7 + rd() * 0.6], // G dwarf — yellow-white
  (rd) => [0.98 + rd() * 0.02, 0.97 + rd() * 0.03, 0.93 + rd() * 0.06, 0.9 + rd() * 0.6], // F dwarf — white
  (rd) => [1.0, 0.66 + rd() * 0.14, 0.42 + rd() * 0.16, 1.8 + rd() * 1.4], // K/M giants — amber, large
  (rd) => [0.80 + rd() * 0.12, 0.86 + rd() * 0.08, 1.0, 1.2 + rd() * 0.8], // A — blue-white
  (rd) => [0.58 + rd() * 0.14, 0.70 + rd() * 0.12, 1.0, 1.6 + rd() * 1.2], // B/O — blue, bright
];

// Cumulative IMF cut-points (6; the 7th branch, B/O, is the remainder). INTER-ARM (gap) = the true
// solar-neighbourhood census. CREST = the density-wave starburst mix: the hot tail (F/A/B+O) pushed
// up an order of magnitude so young blue stars become VISIBLE, with an M-dwarf FLOOR (≥ ~0.55) so the
// field stays physical, not gaudy. sampleArmStar lerps between them by crestiness.
const GAP_CUTS = [0.73, 0.85, 0.93, 0.96, 0.985, 0.997] as const;
// Balanced crest mix: blue tail (A+B/O) ~15%, hot (F+A+B/O) ~21%, M floor 0.55 — reads clearly as a
// spiral arm without abandoning the red-dwarf majority. (Push these toward the hot end for bolder.)
const CREST_CUTS = [0.55, 0.67, 0.77, 0.83, 0.85, 0.92] as const;

function pickStar(rand: Rand, cuts: ArrayLike<number>): [number, number, number, number] {
  const r = rand();
  for (let i = 0; i < cuts.length; i++) {
    if (r < cuts[i]!) return STAR_BRANCHES[i]!(rand);
  }
  return STAR_BRANCHES[cuts.length]!(rand);
}

/** Statistically realistic RESOLVED star — number-weighted IMF + blackbody-ish colour. Reflects the
 *  true solar-neighbourhood census: overwhelmingly small dim RED/ORANGE dwarfs (M ~73%, K ~12%), a
 *  sprinkle of yellow/white (G ~8%, F ~3%), rare bright BLUE (A, B/O); size luminosity-driven. The
 *  POSITION-INDEPENDENT baseline (= sampleArmStar at crestiness 0). Returns [r,g,b,sizePx]. */
export function sampleRealisticStar(rand: Rand = Math.random): [number, number, number, number] {
  return pickStar(rand, GAP_CUTS);
}

/** Arm-phase–aware resolved star (density-wave physics). `crestiness` ∈ [0,1] is how deep into a
 *  spiral-arm crest the star sits (0 = inter-arm gap, 1 = crest): the IMF cut-points lerp from the
 *  inter-arm census toward the crest's hot-biased mix, so arm crests grow a visible blue-white young
 *  population while gaps stay warm red — the colour contrast (not mere overdensity) that makes a star
 *  field READ as a spiral galaxy. Pure function of (rand, crestiness): the position drives crestiness
 *  upstream, never the RNG, so determinism + seam-continuity across the tiled grid are preserved.
 *  Consumes the SAME draw count as sampleRealisticStar per branch. */
export function sampleArmStar(rand: Rand, crestiness: number): [number, number, number, number] {
  const c = crestiness <= 0 ? 0 : crestiness >= 1 ? 1 : crestiness;
  if (c === 0) return pickStar(rand, GAP_CUTS);
  const cuts = GAP_CUTS.map((g, i) => g + (CREST_CUTS[i]! - g) * c);
  return pickStar(rand, cuts);
}

/** Halo / bulge — older, slightly warmer pastel. */
export function sampleHaloPopulation(rand: Rand = Math.random): [number, number, number, number] {
  const r = rand();
  if (r < 0.10) return [1.0, 0.90 + rand() * 0.05, 0.80 + rand() * 0.08, 2.8 + rand() * 1.4];
  if (r < 0.45) return [1.0, 0.96 + rand() * 0.03, 0.90 + rand() * 0.05, 1.8 + rand() * 0.6];
  return [1.0, 0.88 + rand() * 0.05, 0.78 + rand() * 0.08, 1.2 + rand() * 0.5];
}
