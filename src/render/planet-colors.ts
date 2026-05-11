// ═══════════════════════════════════════════════════════════════════
// PLANET COLORS — Per-type atmosphere color table
// Maps Legion's PlanetType enum to atmosphere colors for the
// planet shader system. Day and twilight tints per type.
// ═══════════════════════════════════════════════════════════════════

// PlanetType enum values from core/components:
// 0 = Rocky, 1 = Oceanic, 2 = IceGiant, 3 = GasGiant, 4 = Dwarf

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
  // Ice Giant — cyan-blue (Uranus/Neptune-like)
  2: {
    primary: [0.45, 0.7, 0.85],
    intensity: 0.9,
  },
  // Gas Giant — warm amber-yellow (Jupiter/Saturn-like)
  3: {
    primary: [0.9, 0.8, 0.5],
    intensity: 0.85,
  },
  // Dwarf — very thin, grey (Pluto-like)
  4: {
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
