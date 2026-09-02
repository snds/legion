// Pure helpers for planet-lab interim Save — per-archetype independence.
import type { PlanetVisualType } from '../../data/system-gen';
import { PLANET_TYPES } from './presets';
import { DEFAULT_SYSTEMIC, type SystemicState } from './variants';

export const LAB_STORE_V4 = 'legion.planetLab.interim.v4';
export const LAB_STORE_V3 = 'legion.planetLab.interim.v3';

export function freshSystemicByType(): Record<PlanetVisualType, SystemicState> {
  return Object.fromEntries(
    PLANET_TYPES.map((t) => [t, { ...DEFAULT_SYSTEMIC }]),
  ) as Record<PlanetVisualType, SystemicState>;
}

/** Merge a (possibly partial / legacy) systemic map onto a live per-type table. */
export function applySystemicByType(
  dest: Record<PlanetVisualType, SystemicState>,
  src: Partial<Record<PlanetVisualType, Partial<SystemicState>>> | undefined,
): void {
  if (!src) return;
  for (const t of PLANET_TYPES) {
    const row = src[t];
    if (!row) continue;
    if (typeof row.warmth === 'number') dest[t].warmth = row.warmth;
    if (typeof row.hydrosphere === 'number') dest[t].hydrosphere = row.hydrosphere;
    if (typeof row.tectonics === 'number') dest[t].tectonics = row.tectonics;
    if (typeof row.biosphere === 'number') dest[t].biosphere = row.biosphere;
  }
}
