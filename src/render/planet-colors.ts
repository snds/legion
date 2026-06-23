// ═══════════════════════════════════════════════════════════════════
// PLANET COLORS — Per-type atmosphere color table
// Maps Legion's PlanetType enum to atmosphere colors for the
// planet shader system. Day and twilight tints per type.
// ═══════════════════════════════════════════════════════════════════

// PlanetType enum values from core/components (the REAL enum — this table
// previously documented and used a stale ordering, so Desert got ice-giant
// cyan, IceGiant got Pluto-grey, and Dwarf fell back to Rocky):
// 0 = Rocky, 1 = Oceanic, 2 = Desert, 3 = GasGiant, 4 = IceGiant, 5 = Dwarf

export interface AtmosphereColorSet {
  /** Primary atmosphere color (fresnel rim, day side) */
  primary: [number, number, number];
  /** Intensity multiplier for the atmosphere */
  intensity: number;
}

/** Default atmosphere colors indexed by PlanetType */
export const ATMOSPHERE_COLORS: Record<number, AtmosphereColorSet> = {
  // Rocky — thin, warm haze (Mars-like)
  0: {
    primary: [0.85, 0.65, 0.45],
    intensity: 0.6,
  },
  // Oceanic — thick blue-white (Earth-like)
  1: {
    primary: [0.4, 0.6, 0.9],
    intensity: 1.0,
  },
  // Desert — dusty ochre haze (Arrakis-like)
  2: {
    primary: [0.82, 0.66, 0.42],
    intensity: 0.7,
  },
  // Gas Giant — warm amber-yellow (Jupiter/Saturn-like)
  3: {
    primary: [0.9, 0.8, 0.5],
    intensity: 0.85,
  },
  // Ice Giant — cyan-blue (Uranus/Neptune-like)
  4: {
    primary: [0.45, 0.7, 0.85],
    intensity: 0.9,
  },
  // Dwarf — very thin, grey (Pluto-like)
  5: {
    primary: [0.5, 0.5, 0.55],
    intensity: 0.3,
  },
};

/**
 * Get atmosphere color for a given planet type.
 * Falls back to Rocky if type not found.
 */
export function getAtmosphereColor(planetType: number): AtmosphereColorSet {
  return ATMOSPHERE_COLORS[planetType] ?? ATMOSPHERE_COLORS[0];
}

// ── Stellar Classification (Planckian / blackbody) ────────────────
// Mapped from Morgan-Keenan main-sequence temperatures.
// Used by galactic-view star markers so each system reads as a real
// star, not an arbitrary colored disc.
//
//   O  ≳30000K  blue
//   B  10000–30000K  blue-white
//   A  7500–10000K   white
//   F  6000–7500K    yellow-white
//   G  5200–6000K    yellow (Sun)
//   K  3700–5200K    orange
//   M  2400–3700K    red
//   L/T  brown dwarfs, deep red

export type StellarClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M' | 'L';

/** Approximate sRGB for the photospheric color at each class. */
export const STELLAR_CLASS_COLOR: Record<StellarClass, number> = {
  O: 0x9bb0ff,
  B: 0xaabfff,
  A: 0xcad7ff,
  F: 0xf8f7ff,
  G: 0xfff4e8,
  K: 0xffd2a1,
  M: 0xff9966,
  L: 0xff6b3d,
};

/** Halo tint — slightly more saturated than the core, for bloom sprite. */
export const STELLAR_CLASS_HALO: Record<StellarClass, number> = {
  O: 0x6a8cff,
  B: 0x8aa8ff,
  A: 0xc0d0ff,
  F: 0xf6f0ff,
  G: 0xffe6c2,
  K: 0xffb070,
  M: 0xff7a3a,
  L: 0xff4a1a,
};

/**
 * Classify from an MK SPECTRAL TYPE string (e.g. 'K2V', 'sdM4', 'dM5.5e') —
 * the real HYG class carried by the curated catalogue. Picks the first main
 * O/B/A/F/G/K/M letter (skipping luminosity/subdwarf prefixes like sd-, d-),
 * falling back to G. Preferred over name-lookup when a spectral type is on hand.
 */
export function classifyStarSpect(spect: string): StellarClass {
  const m = spect.toUpperCase().match(/[OBAFGKM]/);
  const c = m?.[0];
  return (c && c in STELLAR_CLASS_COLOR ? c : 'G') as StellarClass;
}

/** StellarRender from a spectral type (see classifyStarSpect). */
export function getStellarRenderSpect(spect: string): StellarRender {
  const cls = classifyStarSpect(spect);
  return { core: STELLAR_CLASS_COLOR[cls], halo: STELLAR_CLASS_HALO[cls], cls };
}

export interface StellarRender {
  core: number;
  halo: number;
  cls: StellarClass;
}
