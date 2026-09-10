// ═══════════════════════════════════════════════════════════════════
// PLANET PRESETS — one material, six looks, chosen by planet.type
//
// procedural-worlds-plan.md P1: "Planet-type presets (rocky/gas/ice/ocean/lava/
// desert) as parameter sets over ONE material, chosen by planet.type." Every
// surface planet uses the SAME shader (glsl.ts / shaders.ts); a preset is just
// the uniform BLOCK that shader reads. Giants (gas/ice) use the banded-cloud
// material instead — Decision 5 keeps their vertical structure as data.
//
// Presets are the archetype baseline; derivePlanetParams() then jitters them
// deterministically from the body's `seed` (Step 0) and shifts them by its
// physical record (insolation → snow line, aridity → moisture) so two ocean
// worlds aren't identical. Pure — no Three.js — so it's fully unit-tested.
// ═══════════════════════════════════════════════════════════════════

import type { GenPlanet, PlanetVisualType } from '../../data/system-gen';
import { channel, range, seedOffset } from './rng';
import { masterValues, applyOffsets, DEFAULT_SYSTEMIC, type SystemicState } from './variants';

export type RGB = readonly [number, number, number];

/** A stop in the altitude colour ramp: `at` is normalised height (0 = sea floor,
 *  1 = peak); `color` is linear RGB. The shader lerps between successive stops. */
export interface RampStop { at: number; color: RGB; }

/** Everything the surface/atmosphere/band/ring shaders need for one planet.
 *  ALL values are plain numbers/arrays so this crosses into GLSL uniforms and
 *  serialises for the determinism test. */
export interface PlanetRenderParams {
  type: PlanetVisualType;
  isGiant: boolean;

  // ── terrain (surface worlds) ──
  ramp: RampStop[];          // altitude colour ramp (low→high)
  seaLevel: number;          // normalised height below which is ocean (0 = none)
  oceanShallow: RGB;
  oceanDeep: RGB;
  displacement: number;      // peak radial displacement as a fraction of radius
  ridged: number;            // 0 = smooth fBm hills, 1 = sharp ridged mountains
  warp: number;              // domain-warp strength (organic coastlines)
  latitudeIce: number;       // 0 = none, 1 = strong polar caps
  moisture: number;          // BASE humidity — the climate field's starting level
  // ── climate modifiers (each an independent driver of the moisture field) ──
  aridBelts: number;         // Hadley circulation: dry subtropics / wet ITCZ depth
  rainShadow: number;        // orographic drying leeward of upwind ranges
  orographic: number;       // WINDWARD wetting — forests climb the wet flank
  lapseRate: number;        // altitude cooling — sets the montane forest belt
  treeline: number;         // temperature below which trees give out
  windBearing: number;       // radians — tilts the zonal prevailing wind
  continental: number;       // inland drying (maritime coasts stay wet)
  altitudeDry: number;       // how fast highlands dry out (treeline)
  patchiness: number;        // mesoscale variation within a belt
  lushDepth: number;         // how deep/saturated the wet-region greenery goes
  snowfall: number;         // snow-cover extent (albedo overlay, no mass)
  roughness: number;         // specular breakup
  noiseSeed: RGB;            // domain offset so bodies never share terrain

  // ── giants (banded cloud material) ──
  bandColorA: RGB;
  bandColorB: RGB;
  bandCount: number;         // number of latitude cloud bands
  bandTurbulence: number;    // swirl/turbulence in the bands
  stormChance: number;       // probability the body sports a great-spot storm

  // ── atmosphere shell (P2) ──
  hasAtmosphere: boolean;
  atmosphere: RGB;           // Rayleigh tint (day rim)
  atmosphereDensity: number; // shell thickness / opacity scale
  nightLights: number;       // 0 = none, 1 = strong city-lights where NdotL<0

  // ── cloud layer (surface worlds; giants use the banded material) ──
  cloudCover: number;        // 0..1 sky coverage
  cloudShadow: number;       // how hard clouds shade the ground (self-shadow)
  cloudFlow: number;         // zonal circulation speed (trade winds / jets)
  cloudTurb: number;         // evolving shear/morph turbulence
  cyclones: number;          // cyclone strength (hurricanes)
  cloudTerrain: number;      // terrain/climate coupling (orographic + wet-dry)
  cloudDetail: number;       // formation scale: >1 = smaller systems + finer billows
  cloudSpeed: number;        // weather-clock scale (1 ≈ legacy rate; default near-still)
  cycloneSize: number;       // storm angular radius (radians)
  cloudWisp: number;         // shear-thinning: stretched cloud evaporates into wisps
  cloudRegion: number;       // synoptic regionality: whole regions clear or fill
  lightning: number;         // storm lightning intensity (0 = off)

  // ── emissive (lava) ──
  emissive: RGB;
  emissiveStrength: number;

  // ── whole-body physical record (P2-2) ──
  /** massEarth / radiusEarth³, Earth = 1. The one bulk-physical scalar the
   *  pipeline never computed before (Audit A5) — exposed so tests/tools can
   *  see what drove the atmosphere gate + material shift below. */
  density: number;
}

interface Preset {
  ramp: RampStop[];
  seaLevel: number;
  oceanShallow: RGB;
  oceanDeep: RGB;
  displacement: number;
  ridged: number;
  warp: number;
  latitudeIce: number;
  moisture: number;
  aridBelts: number;
  rainShadow: number;
  orographic: number;
  lapseRate: number;
  treeline: number;
  windBearing: number;
  continental: number;
  altitudeDry: number;
  patchiness: number;
  lushDepth: number;
  snowfall: number;
  roughness: number;
  bandColorA: RGB;
  bandColorB: RGB;
  bandCount: number;
  bandTurbulence: number;
  stormChance: number;
  hasAtmosphere: boolean;
  atmosphere: RGB;
  atmosphereDensity: number;
  nightLights: number;
  cloudCover: number;
  cloudShadow: number;
  cloudFlow: number;
  cloudTurb: number;
  cyclones: number;
  cloudTerrain: number;
  cloudDetail: number;
  cloudSpeed: number;
  cycloneSize: number;
  cloudWisp: number;
  cloudRegion: number;
  lightning: number;
  emissive: RGB;
  emissiveStrength: number;
}

const G0: RGB = [0, 0, 0];

/** The archetype types, in a stable display order (matches the lab + catalog). */
export const PLANET_TYPES: readonly PlanetVisualType[] = ['rocky', 'ocean', 'desert', 'lava', 'ice', 'gas'];

export type { Preset };

// Archetype baselines. Colours are linear RGB (roughly sRGB²·² pre-corrected by
// eye — the shader outputs linear and the pipeline tonemaps). MUTABLE so the
// Generator Lab can tune the canonical guideposts live; derivePlanetParams reads
// them each build, so a tuned archetype propagates to every generated body of
// that type. snapshotPresets() serialises the current set for Copy-JSON / Save.
export const PRESETS: Record<PlanetVisualType, Preset> = {
  rocky: {
    // Continuum rocky QA (2026-08-07): thin dusty atmos + warmer ochre ramp.
    // Lab guidepost: lab-ideal.json rocky (applied in planet-lab). Keep PRESETS
    // aligned so generated rocky bodies match the lab identity.
    ramp: [
      { at: 0.0, color: [0.22, 0.14, 0.10] },
      { at: 0.45, color: [0.42, 0.28, 0.18] },
      { at: 0.75, color: [0.36, 0.27, 0.20] },
      { at: 1.0, color: [0.58, 0.50, 0.44] },
    ],
    seaLevel: 0, oceanShallow: G0, oceanDeep: G0,
    // Slightly softer ridged/displacement — orbit silhouette + albedo isolines.
    displacement: 0.034, ridged: 0.48, warp: 0.4, latitudeIce: 0.12, moisture: 0.2, aridBelts: 0.7, rainShadow: 0.5, orographic: 0.5, lapseRate: 0.5, treeline: 0.10, windBearing: 0.2, continental: 0.6, altitudeDry: 0.6, patchiness: 0.35, lushDepth: 0.5, snowfall: 0.75,
    roughness: 0.9,
    bandColorA: G0, bandColorB: G0, bandCount: 0, bandTurbulence: 0, stormChance: 0,
    hasAtmosphere: true, atmosphere: [0.55, 0.42, 0.32], atmosphereDensity: 0.38, nightLights: 0,
    cloudCover: 0.08, cloudShadow: 0.55, cloudFlow: 0.4, cloudTurb: 0.3, cyclones: 0.1, cloudTerrain: 0.5, cloudDetail: 1.6, cloudSpeed: 0.12, cycloneSize: 0.11, cloudWisp: 0.55, cloudRegion: 0.75, lightning: 0.8,
    emissive: G0, emissiveStrength: 0,
  },
  ocean: {
    // BARE GROUND only — soil/rock/scree. Vegetation colour now comes entirely
    // from the biome layer (biomeColor), so the ramp must not pre-tint the land
    // green: a green ramp showing through partial canopy cover was exactly what
    // made every biome read as pale sage.
    ramp: [
      { at: 0.0, color: [0.19, 0.16, 0.12] },   // coastal silt / dark soil
      { at: 0.35, color: [0.26, 0.22, 0.16] },  // loam
      { at: 0.6, color: [0.34, 0.29, 0.22] },   // dry earth / rock
      { at: 0.85, color: [0.40, 0.38, 0.36] },  // grey scree
      { at: 1.0, color: [0.92, 0.94, 0.97] },   // snow
    ],
    // Guidepost: lab-ideal.json (Sean, 2026-07-30) — flat relief + softer ice + denser weather.
    seaLevel: 0.55, oceanShallow: [0.10, 0.42, 0.52], oceanDeep: [0.02, 0.09, 0.22],
    displacement: 0, ridged: 0.45, warp: 0.6, latitudeIce: 0.3, moisture: 1.0, aridBelts: 0.8, rainShadow: 0.65, orographic: 0.7, lapseRate: 0.55, treeline: 0.09, windBearing: 0.25, continental: 0.5, altitudeDry: 0.55, patchiness: 0.4, lushDepth: 1.0, snowfall: 0.75,
    roughness: 0.25,
    bandColorA: G0, bandColorB: G0, bandCount: 0, bandTurbulence: 0, stormChance: 0,
    hasAtmosphere: true, atmosphere: [0.30, 0.52, 0.92], atmosphereDensity: 1.0, nightLights: 0.8,
    // F4 (2026-08-06) briefly cut cloudCover 0.55->0.22 / raised cloudShadow
    // 0.6->0.75 here to fix a Continuum-only whiteout — but this Preset is
    // SHARED (Legacy + Continuum both call derivePlanetParams against it for
    // real, non-lab gameplay), so that thinned every Legacy ocean world too.
    // Reverted to the pre-F4 shipping values. Continuum's cloud-shell curve
    // additively folds cloudTurb/cloudRegion into its noise sum (see
    // continuum/shaders.ts) and saturates at this cover, but Continuum only
    // ever runs inside the Generator Lab (continuum/index.ts header), which
    // applies lab-ideal.json's cloudCover:0.22/cloudShadow:0.75 override onto
    // PRESETS *before* the globe is built (planet-lab.ts applyLab) — so the
    // Continuum-only thinning still lands there without touching Legacy.
    cloudCover: 0.55, cloudShadow: 0.6, cloudFlow: 0.7, cloudTurb: 0.91, cyclones: 0.34, cloudTerrain: 0.8, cloudDetail: 1.45, cloudSpeed: 0.12, cycloneSize: 0.13, cloudWisp: 0.6, cloudRegion: 0.82, lightning: 0.8,
    emissive: G0, emissiveStrength: 0,
  },
  desert: {
    ramp: [
      { at: 0.0, color: [0.55, 0.38, 0.22] },
      { at: 0.5, color: [0.72, 0.52, 0.30] },
      { at: 0.8, color: [0.60, 0.42, 0.26] },
      { at: 1.0, color: [0.80, 0.66, 0.48] },
    ],
    seaLevel: 0, oceanShallow: G0, oceanDeep: G0,
    displacement: 0.05, ridged: 0.7, warp: 0.5, latitudeIce: 0.05, moisture: 0.08, aridBelts: 1.0, rainShadow: 0.8, orographic: 0.45, lapseRate: 0.5, treeline: 0.09, windBearing: 0.15, continental: 0.9, altitudeDry: 0.5, patchiness: 0.5, lushDepth: 0.7, snowfall: 0.75,
    roughness: 0.85,
    bandColorA: G0, bandColorB: G0, bandCount: 0, bandTurbulence: 0, stormChance: 0,
    hasAtmosphere: true, atmosphere: [0.82, 0.62, 0.40], atmosphereDensity: 0.5, nightLights: 0.15,
    cloudCover: 0.10, cloudShadow: 0.45, cloudFlow: 0.55, cloudTurb: 0.35, cyclones: 0.15, cloudTerrain: 0.5, cloudDetail: 1.6, cloudSpeed: 0.12, cycloneSize: 0.11, cloudWisp: 0.55, cloudRegion: 0.75, lightning: 0.8,
    emissive: G0, emissiveStrength: 0,
  },
  lava: {
    ramp: [
      { at: 0.0, color: [0.12, 0.06, 0.05] },
      { at: 0.5, color: [0.25, 0.10, 0.07] },
      { at: 0.85, color: [0.35, 0.14, 0.08] },
      { at: 1.0, color: [0.20, 0.09, 0.07] },
    ],
    seaLevel: 0.4, oceanShallow: [1.0, 0.45, 0.10], oceanDeep: [0.9, 0.18, 0.03],
    displacement: 0.06, ridged: 0.85, warp: 0.35, latitudeIce: 0, moisture: 0, aridBelts: 0, rainShadow: 0, orographic: 0, lapseRate: 0.5, treeline: 0.09, windBearing: 0, continental: 0, altitudeDry: 0, patchiness: 0, lushDepth: 0, snowfall: 0.75,
    roughness: 0.7,
    bandColorA: G0, bandColorB: G0, bandCount: 0, bandTurbulence: 0, stormChance: 0,
    hasAtmosphere: true, atmosphere: [0.9, 0.35, 0.15], atmosphereDensity: 0.6, nightLights: 0,
    cloudCover: 0.08, cloudShadow: 0.4, cloudFlow: 0.35, cloudTurb: 0.5, cyclones: 0.0, cloudTerrain: 0.4, cloudDetail: 1.5, cloudSpeed: 0.12, cycloneSize: 0.11, cloudWisp: 0.45, cloudRegion: 0.6, lightning: 0.8,
    emissive: [1.0, 0.35, 0.08], emissiveStrength: 1.0,
  },
  ice: {
    // "ice" as a Neptune-class ICE GIANT (Step 0: radius 3.5–8 R⊕ ⇒ giant).
    ramp: [], seaLevel: 0, oceanShallow: G0, oceanDeep: G0,
    displacement: 0, ridged: 0, warp: 0, latitudeIce: 0, moisture: 0, aridBelts: 0, rainShadow: 0, orographic: 0, lapseRate: 0.5, treeline: 0.09, windBearing: 0, continental: 0, altitudeDry: 0, patchiness: 0, lushDepth: 0, snowfall: 0.75, roughness: 0,
    bandColorA: [0.42, 0.60, 0.78], bandColorB: [0.26, 0.44, 0.66],
    bandCount: 9, bandTurbulence: 0.35, stormChance: 0.5,
    hasAtmosphere: true, atmosphere: [0.45, 0.70, 0.90], atmosphereDensity: 1.1, nightLights: 0,
    cloudCover: 0, cloudShadow: 0, cloudFlow: 0, cloudTurb: 0, cyclones: 0, cloudTerrain: 0, cloudDetail: 1, cloudSpeed: 0.1, cycloneSize: 0.12, cloudWisp: 0, cloudRegion: 0, lightning: 0,
    emissive: G0, emissiveStrength: 0,
  },
  gas: {
    ramp: [], seaLevel: 0, oceanShallow: G0, oceanDeep: G0,
    displacement: 0, ridged: 0, warp: 0, latitudeIce: 0, moisture: 0, aridBelts: 0, rainShadow: 0, orographic: 0, lapseRate: 0.5, treeline: 0.09, windBearing: 0, continental: 0, altitudeDry: 0, patchiness: 0, lushDepth: 0, snowfall: 0.75, roughness: 0,
    bandColorA: [0.86, 0.74, 0.54], bandColorB: [0.66, 0.50, 0.34],
    bandCount: 14, bandTurbulence: 0.6, stormChance: 0.7,
    hasAtmosphere: true, atmosphere: [0.92, 0.82, 0.55], atmosphereDensity: 1.2, nightLights: 0,
    cloudCover: 0, cloudShadow: 0, cloudFlow: 0, cloudTurb: 0, cyclones: 0, cloudTerrain: 0, cloudDetail: 1, cloudSpeed: 0.1, cycloneSize: 0.12, cloudWisp: 0, cloudRegion: 0, lightning: 0,
    emissive: G0, emissiveStrength: 0,
  },
};

/** Deep clone of the current archetype presets — the Copy-JSON / Save payload. */
export function snapshotPresets(): Record<PlanetVisualType, Preset> {
  return JSON.parse(JSON.stringify(PRESETS)) as Record<PlanetVisualType, Preset>;
}

/** Overlay a (partial) preset set onto the live PRESETS — committed defaults from
 *  planet-defaults.json, or an interim lab tuning. Mutates in place so existing
 *  references (derivePlanetParams closures) see the change on the next build. */
export function applyPresetOverrides(
  overrides: Partial<Record<PlanetVisualType, Partial<Preset>>>,
): void {
  for (const type of Object.keys(overrides) as PlanetVisualType[]) {
    const o = overrides[type];
    if (o) Object.assign(PRESETS[type], o);
  }
}

function jitterRGB(c: RGB, rng: () => number, amt: number): RGB {
  return [
    Math.max(0, c[0] + range(rng, -amt, amt)),
    Math.max(0, c[1] + range(rng, -amt, amt)),
    Math.max(0, c[2] + range(rng, -amt, amt)),
  ];
}

/** Shift a colour's luminance by a flat amount (positive = darker). Used to
 *  read bulk density as a material property (denser ⇒ darker/iron-heavy;
 *  less dense ⇒ paler/icier) without inventing a whole albedo model. */
function shiftLuma(c: RGB, amt: number): RGB {
  return [
    Math.max(0, Math.min(1, c[0] - amt)),
    Math.max(0, Math.min(1, c[1] - amt)),
    Math.max(0, Math.min(1, c[2] - amt)),
  ];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Bulk density, Earth = 1 (mass/radius³ — the ratio system-gen.ts computes
 *  both halves of and rendering has never once divided; Audit A5). Cheap
 *  derived scalar, not a core/interior simulation — the task's explicit
 *  non-goal. */
export function computeDensity(planet: Pick<GenPlanet, 'massEarth' | 'radiusEarth'>): number {
  const r = Math.max(planet.radiusEarth, 1e-3);
  return Math.max(0, planet.massEarth) / (r * r * r);
}

// A body needs to be both big enough AND dense enough to plausibly hold a
// real atmosphere/weather system over geologic time (Mars ≈ 0.53 R⊕ keeps a
// thin one; smaller/icier bodies don't). `kind: 'dwarf'` is an explicit,
// harder override: a real plutoid (Pluto/Ceres/Eris) can sit at a moderate
// bulk density (ice+rock mix) yet still fail to hold an atmosphere — it's the
// tiny ABSOLUTE mass, not the density ratio, that dooms it, and `kind` is
// already the more reliable signal for a body that small. This is a size/mass
// gate, not a full escape-velocity model — deliberately cheap (see A5's "do
// not build a full interior/core physics simulation" recommendation).
// 0.5 R⊕ is the PLANET_SIZE dwarf/rocky band boundary (system-gen.ts) — at or
// above it a body is generated as 'rocky' or larger and should be able to
// retain a real atmosphere by size alone (Mars, 0.53 R⊕, keeps a thin one);
// below it (or for a real-archive override that lands there regardless of
// `kind`) it's gated off on size even without the explicit dwarf check.
const ATMOSPHERE_RADIUS_FLOOR = 0.5; // R⊕
const ATMOSPHERE_DENSITY_FLOOR = 0.28; // Earth = 1

function retainsAtmosphere(planet: GenPlanet, density: number, isGiant: boolean): boolean {
  if (isGiant) return true; // giants are never gated by this — banded material, always has an envelope
  // P2-12: an authored catalogue fact overrides the heuristic below, either
  // direction — this is how an explicitly airless body (Mercury/Vulcan, both
  // of which clear the radius/density floor on their rep-radius stand-ins)
  // stays airless once routed through Continuum. Only the curated-catalogue
  // adapter ever sets this field; a procedurally-generated planet leaves it
  // undefined and falls through to the heuristic exactly as before.
  if (planet.hasAtmosphere !== undefined) return planet.hasAtmosphere;
  if (planet.kind === 'dwarf') return false;
  return planet.radiusEarth >= ATMOSPHERE_RADIUS_FLOOR && density >= ATMOSPHERE_DENSITY_FLOOR;
}

/** The systemic-master output at the archetype "default" physical state
 *  (Earth-like insolation/size, in the habitable zone) — computed once. Every
 *  PRESETS[type] baseline was hand-tuned starting from roughly this point
 *  (variants.test.ts pins it: mid-dial reproduces PRESETS.ocean's seaLevel/
 *  moisture exactly), so it's the zero-point the offset model below measures
 *  a body's physical record against. A body whose record reduces to this
 *  same state (e.g. the curated catalogue adapter's Earth-insolation,
 *  rep-radius-1 stand-ins) gets a zero offset — no drift from its tuned look. */
const SYSTEMIC_BASELINE = masterValues(DEFAULT_SYSTEMIC).preset;

/** Every Preset field the four systemic masters (variants.ts) own. */
const SYSTEMIC_OWNED_KEYS = Object.keys(SYSTEMIC_BASELINE);

/**
 * Map a body's PHYSICAL record — never a lab dial — onto the same 4-axis
 * systemic state variants.ts already models (warmth/hydrosphere/tectonics/
 * biosphere). This is A7's explicit recommendation: promote that layer from a
 * lab-only authoring aid to a real per-body driver, evaluated at generation
 * time instead of once per archetype baseline.
 */
function physicalSystemicState(planet: GenPlanet): SystemicState {
  const insol = Math.max(0.02, planet.insolation);
  const logInsol = Math.log2(insol);

  // Stellar-flux-driven warmth — insolation 1 (Earth) ⇒ warmth 0.5 exactly.
  const warmth = clamp(0.5 + 0.28 * logInsol, 0, 1);

  // Ocean worlds evaporate toward Hydrosphere's arid end when hot, ice-lock
  // toward its water-world end when cold (insolation 1 ⇒ 0.5, the default).
  // Non-ocean types have no liquid-water field to modulate; they keep the
  // fixed dry/none baseline their own archetype already encodes.
  const hydrosphereByType: Partial<Record<PlanetVisualType, number>> = {
    ocean: clamp(0.5 - 0.22 * logInsol, 0, 1),
    rocky: 0.32, desert: 0.12, lava: 0.02,
  };
  const hydrosphere = hydrosphereByType[planet.type] ?? 0.5;

  // Tectonic vigour from size: a bigger body retains more internal heat and
  // keeps resurfacing (radiusEarth 1 ⇒ 0.5, the default); small/low-mass ones
  // cool and go geologically dead — which is also why they keep their
  // craters (applyTectonics' own inverse craters coupling). Dwarfs/plutoids
  // are dead by definition (Pluto/Ceres logic).
  const tectonics = planet.kind === 'dwarf' ? 0.04 : clamp(planet.radiusEarth / 2, 0, 1);

  // Only bodies actually in the habitable zone get meaningfully colonised by
  // life in this model; everything else stays near-barren.
  const biosphere = planet.inHZ ? DEFAULT_SYSTEMIC.biosphere : 0.05;

  return { warmth, hydrosphere, tectonics, biosphere };
}

/**
 * Deterministic per-body render params. Starts from the archetype preset for
 * `planet.type`, then:
 *  • re-centres the systemic-master-owned fields (variants.ts) on this body's
 *    OWN physical record instead of the lab's default dial, preserving each
 *    archetype's hand-tuned offset from that default (P2-2 — promotes the
 *    systemic layer from a lab-only authoring aid to a real per-body driver,
 *    per Audit A7),
 *  • jitters palette + band/terrain scalars from the body seed (channel-split so
 *    terrain and clouds don't correlate),
 *  • derives bulk density (mass/radius³) and uses it to gate atmosphere/cloud/
 *    weather presence and to shift one material read (surface albedo +
 *    roughness) — the whole-body physical coverage Audit A5 found was
 *    computed and then silently dropped,
 *  • honours `planet.hasRings` downstream (globe.ts) — that flag is Step 0's.
 * Same `seed` ⇒ identical params (pinned by presets.test.ts).
 */
export function derivePlanetParams(planet: GenPlanet): PlanetRenderParams {
  const base = PRESETS[planet.type] ?? PRESETS.rocky;
  const seed = planet.seed >>> 0;
  const pal = channel(seed, 'palette');
  const ter = channel(seed, 'terrain');

  const isGiant = planet.isGasGiant || planet.type === 'gas' || planet.type === 'ice';

  // Systemic layer, re-centred per body (see physicalSystemicState doc). Giants
  // don't use any of these fields (banded material, not terrain) — skip.
  const live: Record<string, number> = {};
  for (const k of SYSTEMIC_OWNED_KEYS) live[k] = (base as unknown as Record<string, number>)[k];
  if (!isGiant) {
    // P2-23: dampen cold-driven ice/snow growth by how much moisture this
    // ARCHETYPE actually has to work with (ocean 1.0 ⇒ unchanged; rocky 0.2 /
    // desert 0.08 / lava 0 ⇒ a cold body gains only a fraction of the
    // ocean-calibrated polar ice/snow swing). See applyWarmth's doc comment.
    const wetness = clamp(base.moisture, 0, 1);
    const target = masterValues(physicalSystemicState(planet), wetness).preset;
    applyOffsets(live, target, SYSTEMIC_BASELINE);
  }

  const density = computeDensity(planet);
  const keepsAtmosphere = retainsAtmosphere(planet, density, isGiant);
  // Denser bodies read as darker/iron-heavy; low-density ones paler/icier —
  // one visible material property driven by the density scalar (A5).
  const albedoShift = isGiant ? 0 : clamp((density - 1) * 0.18, -0.16, 0.16);
  const roughnessShift = isGiant ? 0 : clamp((density - 1) * 0.12, -0.18, 0.18);

  // P2-23: an authored per-body ramp override (currently Mars only — see
  // GenPlanet.rampOverride's doc comment) replaces the archetype's own ramp
  // colours but keeps the same density-shift/jitter treatment as every
  // other body, so it still varies by seed and isn't a flat special case.
  const rampSource = planet.rampOverride ?? base.ramp;
  const ramp = rampSource.map((s) => ({ at: s.at, color: jitterRGB(shiftLuma(s.color, albedoShift), pal, 0.04) }));

  // Giant band count scales gently with size (bigger ⇒ more visible banding).
  const sizeBands = Math.round(base.bandCount * (0.8 + Math.min(1.5, planet.radiusEarth / 10)));

  return {
    type: planet.type,
    isGiant,
    ramp,
    seaLevel: live.seaLevel,
    oceanShallow: jitterRGB(base.oceanShallow, pal, 0.03),
    oceanDeep: jitterRGB(base.oceanDeep, pal, 0.02),
    displacement: base.displacement * range(ter, 0.85, 1.2),
    ridged: live.ridged,
    warp: base.warp * range(ter, 0.8, 1.25),
    latitudeIce: live.latitudeIce,
    // Lab slider max is 1.5 — do NOT clamp to 1.0 (that made "Base humidity"
    // dead above 1.0: value stuck + fingerprint unchanged → no Continuum remesh).
    moisture: Math.max(0, Math.min(1.5, live.moisture + range(pal, -0.1, 0.1))),
    // Climate modifiers: jitter the ones that make worlds feel different (belt
    // depth, shadow strength, wind bearing, patchiness); keep the rest stable.
    aridBelts: Math.max(0, Math.min(1.5, live.aridBelts * range(ter, 0.8, 1.2))),
    rainShadow: Math.max(0, Math.min(1.5, live.rainShadow * range(ter, 0.8, 1.25))),
    orographic: Math.max(0, Math.min(1.5, live.orographic * range(ter, 0.85, 1.2))),
    lapseRate: live.lapseRate,
    treeline: live.treeline,
    windBearing: base.windBearing + range(ter, -0.35, 0.35),
    continental: live.continental,
    altitudeDry: live.altitudeDry,
    patchiness: Math.max(0, Math.min(1.5, live.patchiness * range(ter, 0.85, 1.2))),
    lushDepth: Math.max(0, Math.min(1.5, live.lushDepth)),
    snowfall: Math.max(0, Math.min(1.5, live.snowfall)),
    // Giants keep the archetype's exact roughness (0 — unused by the banded
    // material); only surface worlds get the density-driven shift + floor.
    roughness: isGiant ? base.roughness : clamp(base.roughness + roughnessShift, 0.05, 1),
    noiseSeed: seedOffset(seed),
    bandColorA: jitterRGB(base.bandColorA, pal, 0.05),
    bandColorB: jitterRGB(base.bandColorB, pal, 0.05),
    bandCount: Math.max(0, sizeBands),
    bandTurbulence: base.bandTurbulence * range(ter, 0.85, 1.2),
    stormChance: base.stormChance,
    hasAtmosphere: base.hasAtmosphere && keepsAtmosphere,
    atmosphere: jitterRGB(base.atmosphere, pal, 0.03),
    atmosphereDensity: keepsAtmosphere ? base.atmosphereDensity : 0,
    nightLights: base.nightLights,
    cloudCover: keepsAtmosphere ? Math.min(1, live.cloudCover * range(ter, 0.8, 1.2)) : 0,
    cloudShadow: keepsAtmosphere ? base.cloudShadow : 0,
    cloudFlow: base.cloudFlow * range(ter, 0.85, 1.2),
    cloudTurb: base.cloudTurb,
    cyclones: keepsAtmosphere ? base.cyclones * range(ter, 0.6, 1.3) : 0,
    cloudTerrain: base.cloudTerrain,
    cloudDetail: base.cloudDetail,
    cloudSpeed: base.cloudSpeed,
    cycloneSize: base.cycloneSize * range(ter, 0.8, 1.25),
    cloudWisp: base.cloudWisp,
    cloudRegion: Math.min(1, base.cloudRegion * range(ter, 0.85, 1.15)),
    lightning: keepsAtmosphere ? base.lightning : 0,
    emissive: base.emissive,
    emissiveStrength: base.emissiveStrength,
    density,
  };
}

/** Whether this body emits a great-spot storm — deterministic from the seed. */
export function hasStorm(planet: GenPlanet): boolean {
  const p = PRESETS[planet.type] ?? PRESETS.rocky;
  if (p.stormChance <= 0) return false;
  return channel(planet.seed >>> 0, 'storm')() < p.stormChance;
}
