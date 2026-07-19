// ═══════════════════════════════════════════════════════════════════
// HABITABLE-WORLD VARIANTS — named climate states for the ocean archetype
//
// Each variant is a real, documented planetary climate — four of them states
// Earth has actually occupied, one an exoplanet class — expressed in the lab's
// own parameters. They exist to answer "what does a habitable world look like?"
// with evidence rather than slider-fiddling, and to give the archetype a set of
// believable starting points.
//
// The science each one encodes (and therefore what to check when reviewing it):
//
// TERRAN — Earth today. Land ~29% of the surface. Forests ~27-31% of land area,
//   deserts+xeric ~19% (a third if semi-arid steppe is included), grassland
//   ~13%. The Hadley circulation's descending branch at ~25-35 deg puts the
//   great deserts (Sahara, Arabian, Kalahari, Atacama, Australian, Sonoran) in
//   two belts, with wet equator and wet mid-latitudes between them — so
//   aridBelts is strong while base humidity stays high.
//
// HOTHOUSE — early Eocene (~50 Ma), the best-studied warm Earth. CO2 far above
//   modern, NO permanent polar ice, forests (Metasequoia) and crocodilians at
//   ~78 N on Ellesmere Island. Its signature is the "equable climate" problem: a
//   much FLATTER equator-to-pole temperature gradient. Here that is a weak
//   aridBelts + very low treeline + near-zero latitudeIce, plus a higher sea
//   level (ice-free water volume) so land fraction drops.
//
// GLACIAL — Last Glacial Maximum (~21 ka). Ice sheets to ~40 N, sea level ~120 m
//   LOWER (so more land is exposed), global mean ~4-6 C cooler, and — the part
//   people forget — markedly DRIER and dustier: cold air holds less water, so
//   rainforest contracted to refugia while steppe and desert expanded (the
//   "mammoth steppe"). Low base humidity + strong belts + high continentality.
//
// PANGAEAN — a supercontinent world (Pangaea, ~250 Ma). One vast landmass means
//   moisture cannot reach the interior: the megamonsoon wets the coasts while
//   the interior becomes a continental desert (the Permian-Triassic red beds).
//   Modelled as few continents + high land coverage + extreme continentality.
//
// ARCHIPELAGO — a water-rich world (high-water-fraction super-Earth / ocean
//   world). Little land, all of it near ocean, so climate is maritime
//   everywhere: continentality collapses, deserts essentially cannot form, and
//   the few landmasses are lush to their centres.
// ═══════════════════════════════════════════════════════════════════

import type { Preset } from './presets';
import type { MacroParams } from './plates';

export interface PlanetVariant {
  readonly id: string;
  readonly label: string;
  /** One-line note shown in the lab so the intent is legible on the panel. */
  readonly blurb: string;
  readonly preset: Partial<Preset>;
  readonly macro: Partial<MacroParams>;
}

/** Ocean-archetype climate states. Order runs cold -> hot -> exotic. */
export const OCEAN_VARIANTS: readonly PlanetVariant[] = [
  {
    id: 'terran',
    label: 'Terran',
    blurb: 'Earth today — 29% land, Hadley deserts at 25-35°, taiga to the poles.',
    preset: {
      seaLevel: 0.55, latitudeIce: 0.5,
      moisture: 1.0, aridBelts: 0.8, rainShadow: 0.65, orographic: 0.7,
      lapseRate: 0.55, treeline: 0.09, windBearing: 0.25,
      continental: 0.5, altitudeDry: 0.55, patchiness: 0.4, lushDepth: 1.0,
      cloudCover: 0.55, cloudShadow: 0.6,
    },
    macro: { continents: 4, landCoverage: 0.30, sizeVariety: 0.35, uplift: 0.26 },
  },
  {
    id: 'glacial',
    label: 'Glacial',
    blurb: 'Last Glacial Maximum — ice to 40°, sea level 120 m lower, globally drier.',
    preset: {
      // Lower sea level EXPOSES continental shelf: more land, and the caps are huge.
      seaLevel: 0.47, latitudeIce: 0.95,
      // Cold air holds less water — the LGM was arid, not just cold.
      moisture: 0.58, aridBelts: 1.15, rainShadow: 0.8, orographic: 0.55,
      lapseRate: 0.75, treeline: 0.22, windBearing: 0.3,
      continental: 0.9, altitudeDry: 0.7, patchiness: 0.5, lushDepth: 0.85,
      cloudCover: 0.42, cloudShadow: 0.55,
    },
    macro: { continents: 4, landCoverage: 0.42, sizeVariety: 0.35, uplift: 0.28 },
  },
  {
    id: 'hothouse',
    label: 'Hothouse',
    blurb: 'Early Eocene — no polar ice, forests at 78°N, flat pole-to-equator gradient.',
    preset: {
      // Ice-free: that water is in the ocean, so the waterline rises.
      seaLevel: 0.62, latitudeIce: 0.04,
      // The "equable climate" signature: a much weaker latitudinal gradient.
      moisture: 1.2, aridBelts: 0.42, rainShadow: 0.5, orographic: 0.8,
      lapseRate: 0.42, treeline: 0.02, windBearing: 0.15,
      continental: 0.35, altitudeDry: 0.4, patchiness: 0.35, lushDepth: 1.15,
      cloudCover: 0.57, cloudShadow: 0.62,
    },
    macro: { continents: 5, landCoverage: 0.24, sizeVariety: 0.4, uplift: 0.24 },
  },
  {
    id: 'pangaean',
    label: 'Pangaean',
    blurb: 'Supercontinent — megamonsoon coasts, vast arid interior (Permian red beds).',
    preset: {
      seaLevel: 0.52, latitudeIce: 0.3,
      // Coasts wet, interior starved: continentality is the whole story here.
      moisture: 1.05, aridBelts: 0.9, rainShadow: 0.75, orographic: 0.85,
      lapseRate: 0.55, treeline: 0.09, windBearing: 0.2,
      continental: 1.45, altitudeDry: 0.55, patchiness: 0.45, lushDepth: 1.0,
      cloudCover: 0.5, cloudShadow: 0.6,
    },
    macro: { continents: 2, landCoverage: 0.46, sizeVariety: 0.12, uplift: 0.34 },
  },
  {
    id: 'archipelago',
    label: 'Archipelago',
    blurb: 'Water world — scattered islands, maritime everywhere, deserts cannot form.',
    preset: {
      seaLevel: 0.68, latitudeIce: 0.35,
      // Everywhere is coast, so the interior-drying term has nothing to bite on.
      moisture: 1.15, aridBelts: 0.5, rainShadow: 0.35, orographic: 0.75,
      lapseRate: 0.5, treeline: 0.07, windBearing: 0.3,
      continental: 0.1, altitudeDry: 0.45, patchiness: 0.5, lushDepth: 1.1,
      cloudCover: 0.56, cloudShadow: 0.6,
    },
    macro: { continents: 8, landCoverage: 0.12, sizeVariety: 0.75, uplift: 0.3 },
  },
];

export function variantById(id: string): PlanetVariant | undefined {
  return OCEAN_VARIANTS.find((v) => v.id === id);
}

// ═══ SYSTEMIC CONTROLS ═══════════════════════════════════════════════
// The detail sliders are the right level for FINISHING a world and the wrong
// level for FINDING one: the parameters that make a coherent look move together
// in reality (a colder world is also drier, icier, and has a lower waterline),
// so hunting for "a look" meant nudging six sliders in step and getting
// incoherent worlds in between.
//
// These four dials each drive one physically-coupled BUNDLE. They are the
// continuous version of the climate states above: same idea, but sweepable.
//
// Semantics (deliberate, and the reason this is safe to revert): a master dial
// OVERWRITES the detail params it owns, then the panel refreshes so the new
// detail values are visible and can still be hand-tuned afterwards. Masters are
// therefore a STARTING POINT, never a lock — identical to how the climate
// states behave. The parameters each dial owns are listed per function; nothing
// else is touched, so anything not owned by a master stays hand-authored.

export interface SystemicState {
  warmth: number;      // 0 = deep glacial, 0.5 = temperate, 1 = ice-free hothouse
  hydrosphere: number; // 0 = arid/low sea level, 0.5 = Earth, 1 = ocean world
  tectonics: number;   // 0 = dead/eroded, 0.5 = Earth, 1 = young/violent
  biosphere: number;   // 0 = barren rock, 0.5 = sparse, 1 = fully verdant
}

export const DEFAULT_SYSTEMIC: SystemicState = {
  warmth: 0.5, hydrosphere: 0.5, tectonics: 0.5, biosphere: 0.75,
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Piecewise lerp through a mid anchor so 0.5 lands on the Earth-like value. */
const via = (lo: number, mid: number, hi: number, t: number): number =>
  t < 0.5 ? lerp(lo, mid, t * 2) : lerp(mid, hi, (t - 0.5) * 2);

/** WARMTH owns: latitudeIce, treeline, moisture, aridBelts, lapseRate, cloudCover.
 *  Colder is also DRIER (cold air holds less water) and has stronger latitudinal
 *  contrast — the LGM lesson — so those move together, not independently. */
export function applyWarmth(t: number, p: Record<string, number>): void {
  p.latitudeIce = via(0.95, 0.5, 0.04, t);
  p.treeline    = via(0.24, 0.09, 0.02, t);
  p.moisture    = via(0.55, 1.0, 1.22, t);
  p.aridBelts   = via(1.15, 0.8, 0.42, t);   // flatter gradient when warm
  p.lapseRate   = via(0.78, 0.55, 0.42, t);
  // Cloud cover is capped BELOW the white-out threshold (~0.6) on purpose: past
  // it the deck closes and the surface stops reading at all (caught in review).
  p.cloudCover  = via(0.40, 0.55, 0.58, t);
}

/** HYDROSPHERE owns: seaLevel, landCoverage, continental, rainShadow.
 *  More water = higher waterline, less land, and a maritime climate everywhere
 *  (the interior-drying term has nothing to bite on). */
export function applyHydrosphere(t: number, p: Record<string, number>, m: Record<string, number>): void {
  p.seaLevel    = via(0.40, 0.55, 0.70, t);
  m.landCoverage = via(0.62, 0.30, 0.10, t);
  p.continental = via(1.30, 0.50, 0.10, t);
  p.rainShadow  = via(0.85, 0.65, 0.35, t);
}

/** TECTONICS owns: uplift, plateCount, ridged, rangeVar, canyons, craters.
 *  A young violent world is high, ridged and rifted; a dead one is worn flat and
 *  keeps its craters because nothing resurfaces them (Mars/Mercury logic). */
export function applyTectonics(t: number, p: Record<string, number>, m: Record<string, number>): void {
  m.uplift     = via(0.10, 0.26, 0.52, t);
  m.plateCount = Math.round(via(8, 26, 44, t));
  p.ridged     = via(0.18, 0.45, 0.85, t);
  m.rangeVar   = via(0.30, 0.55, 0.80, t);
  m.canyons    = via(0.05, 0.15, 0.55, t);
  m.craters    = via(0.55, 0.15, 0.02, t);  // INVERSE: resurfacing erases craters
}

/** BIOSPHERE owns: lushDepth, orographic, patchiness, altitudeDry.
 *  How far life has actually colonised the climate the other dials produced. */
export function applyBiosphere(t: number, p: Record<string, number>): void {
  p.lushDepth   = via(0.0, 0.7, 1.15, t);
  p.orographic  = via(0.2, 0.55, 0.85, t);
  p.patchiness  = via(0.6, 0.45, 0.35, t);  // barren worlds look blotchier
  p.altitudeDry = via(0.8, 0.6, 0.42, t);
}
