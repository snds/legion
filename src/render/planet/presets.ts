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
  moisture: number;          // 0 = arid (desert), 1 = lush — biases the mid ramp
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

  // ── emissive (lava) ──
  emissive: RGB;
  emissiveStrength: number;
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
    ramp: [
      { at: 0.0, color: [0.20, 0.17, 0.14] },
      { at: 0.5, color: [0.38, 0.31, 0.24] },
      { at: 0.8, color: [0.30, 0.26, 0.22] },
      { at: 1.0, color: [0.55, 0.52, 0.50] },
    ],
    seaLevel: 0, oceanShallow: G0, oceanDeep: G0,
    displacement: 0.045, ridged: 0.6, warp: 0.4, latitudeIce: 0.15, moisture: 0.2,
    roughness: 0.9,
    bandColorA: G0, bandColorB: G0, bandCount: 0, bandTurbulence: 0, stormChance: 0,
    hasAtmosphere: false, atmosphere: [0.5, 0.4, 0.35], atmosphereDensity: 0.25, nightLights: 0,
    cloudCover: 0.15, cloudShadow: 0.5, cloudFlow: 0.4, cloudTurb: 0.3, cyclones: 0.1, cloudTerrain: 0.5, cloudDetail: 1.6, cloudSpeed: 0.12, cycloneSize: 0.11, cloudWisp: 0.55, cloudRegion: 0.75,
    emissive: G0, emissiveStrength: 0,
  },
  ocean: {
    ramp: [
      { at: 0.0, color: [0.18, 0.32, 0.16] },
      { at: 0.35, color: [0.28, 0.42, 0.20] },
      { at: 0.6, color: [0.45, 0.40, 0.26] },
      { at: 0.85, color: [0.40, 0.34, 0.28] },
      { at: 1.0, color: [0.92, 0.94, 0.97] },
    ],
    seaLevel: 0.55, oceanShallow: [0.10, 0.42, 0.52], oceanDeep: [0.02, 0.09, 0.22],
    displacement: 0.03, ridged: 0.45, warp: 0.6, latitudeIce: 0.5, moisture: 0.85,
    roughness: 0.4,
    bandColorA: G0, bandColorB: G0, bandCount: 0, bandTurbulence: 0, stormChance: 0,
    hasAtmosphere: true, atmosphere: [0.30, 0.52, 0.92], atmosphereDensity: 1.0, nightLights: 0.8,
    cloudCover: 0.55, cloudShadow: 0.6, cloudFlow: 0.7, cloudTurb: 0.55, cyclones: 0.5, cloudTerrain: 0.6, cloudDetail: 1.8, cloudSpeed: 0.12, cycloneSize: 0.13, cloudWisp: 0.6, cloudRegion: 0.65,
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
    displacement: 0.05, ridged: 0.7, warp: 0.5, latitudeIce: 0.05, moisture: 0.08,
    roughness: 0.85,
    bandColorA: G0, bandColorB: G0, bandCount: 0, bandTurbulence: 0, stormChance: 0,
    hasAtmosphere: true, atmosphere: [0.82, 0.62, 0.40], atmosphereDensity: 0.5, nightLights: 0.15,
    cloudCover: 0.10, cloudShadow: 0.45, cloudFlow: 0.55, cloudTurb: 0.35, cyclones: 0.15, cloudTerrain: 0.5, cloudDetail: 1.6, cloudSpeed: 0.12, cycloneSize: 0.11, cloudWisp: 0.55, cloudRegion: 0.75,
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
    displacement: 0.06, ridged: 0.85, warp: 0.35, latitudeIce: 0, moisture: 0,
    roughness: 0.7,
    bandColorA: G0, bandColorB: G0, bandCount: 0, bandTurbulence: 0, stormChance: 0,
    hasAtmosphere: true, atmosphere: [0.9, 0.35, 0.15], atmosphereDensity: 0.6, nightLights: 0,
    cloudCover: 0.08, cloudShadow: 0.4, cloudFlow: 0.35, cloudTurb: 0.5, cyclones: 0.0, cloudTerrain: 0.4, cloudDetail: 1.5, cloudSpeed: 0.12, cycloneSize: 0.11, cloudWisp: 0.45, cloudRegion: 0.6,
    emissive: [1.0, 0.35, 0.08], emissiveStrength: 1.0,
  },
  ice: {
    // "ice" as a Neptune-class ICE GIANT (Step 0: radius 3.5–8 R⊕ ⇒ giant).
    ramp: [], seaLevel: 0, oceanShallow: G0, oceanDeep: G0,
    displacement: 0, ridged: 0, warp: 0, latitudeIce: 0, moisture: 0, roughness: 0,
    bandColorA: [0.42, 0.60, 0.78], bandColorB: [0.26, 0.44, 0.66],
    bandCount: 9, bandTurbulence: 0.35, stormChance: 0.5,
    hasAtmosphere: true, atmosphere: [0.45, 0.70, 0.90], atmosphereDensity: 1.1, nightLights: 0,
    cloudCover: 0, cloudShadow: 0, cloudFlow: 0, cloudTurb: 0, cyclones: 0, cloudTerrain: 0, cloudDetail: 1, cloudSpeed: 0.1, cycloneSize: 0.12, cloudWisp: 0, cloudRegion: 0,
    emissive: G0, emissiveStrength: 0,
  },
  gas: {
    ramp: [], seaLevel: 0, oceanShallow: G0, oceanDeep: G0,
    displacement: 0, ridged: 0, warp: 0, latitudeIce: 0, moisture: 0, roughness: 0,
    bandColorA: [0.86, 0.74, 0.54], bandColorB: [0.66, 0.50, 0.34],
    bandCount: 14, bandTurbulence: 0.6, stormChance: 0.7,
    hasAtmosphere: true, atmosphere: [0.92, 0.82, 0.55], atmosphereDensity: 1.2, nightLights: 0,
    cloudCover: 0, cloudShadow: 0, cloudFlow: 0, cloudTurb: 0, cyclones: 0, cloudTerrain: 0, cloudDetail: 1, cloudSpeed: 0.1, cycloneSize: 0.12, cloudWisp: 0, cloudRegion: 0,
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

/**
 * Deterministic per-body render params. Starts from the archetype preset for
 * `planet.type`, then:
 *  • jitters palette + band/terrain scalars from the body seed (channel-split so
 *    terrain and clouds don't correlate),
 *  • shifts by the physical record — insolation raises the ice-cap line on cold
 *    worlds and bakes lava glow on scorched ones; a giant's band count scales
 *    with radius,
 *  • honours `planet.hasRings` downstream (globe.ts) — that flag is Step 0's.
 * Same `seed` ⇒ identical params (pinned by presets.test.ts).
 */
export function derivePlanetParams(planet: GenPlanet): PlanetRenderParams {
  const base = PRESETS[planet.type] ?? PRESETS.rocky;
  const seed = planet.seed >>> 0;
  const pal = channel(seed, 'palette');
  const ter = channel(seed, 'terrain');

  const isGiant = planet.isGasGiant || planet.type === 'gas' || planet.type === 'ice';

  // Colder worlds (low insolation) get bigger polar caps; hot ones lose them.
  const insol = Math.max(0, planet.insolation);
  const coldBias = insol < 0.5 ? 0.3 : insol > 1.5 ? -0.2 : 0;

  const ramp = base.ramp.map((s) => ({ at: s.at, color: jitterRGB(s.color, pal, 0.04) }));

  // Giant band count scales gently with size (bigger ⇒ more visible banding).
  const sizeBands = Math.round(base.bandCount * (0.8 + Math.min(1.5, planet.radiusEarth / 10)));

  return {
    type: planet.type,
    isGiant,
    ramp,
    seaLevel: base.seaLevel,
    oceanShallow: jitterRGB(base.oceanShallow, pal, 0.03),
    oceanDeep: jitterRGB(base.oceanDeep, pal, 0.02),
    displacement: base.displacement * range(ter, 0.85, 1.2),
    ridged: base.ridged,
    warp: base.warp * range(ter, 0.8, 1.25),
    latitudeIce: Math.max(0, Math.min(1, base.latitudeIce + coldBias)),
    moisture: Math.max(0, Math.min(1, base.moisture + range(pal, -0.1, 0.1))),
    roughness: base.roughness,
    noiseSeed: seedOffset(seed),
    bandColorA: jitterRGB(base.bandColorA, pal, 0.05),
    bandColorB: jitterRGB(base.bandColorB, pal, 0.05),
    bandCount: Math.max(0, sizeBands),
    bandTurbulence: base.bandTurbulence * range(ter, 0.85, 1.2),
    stormChance: base.stormChance,
    hasAtmosphere: base.hasAtmosphere,
    atmosphere: jitterRGB(base.atmosphere, pal, 0.03),
    atmosphereDensity: base.atmosphereDensity,
    nightLights: base.nightLights,
    cloudCover: Math.min(1, base.cloudCover * range(ter, 0.8, 1.2)),
    cloudShadow: base.cloudShadow,
    cloudFlow: base.cloudFlow * range(ter, 0.85, 1.2),
    cloudTurb: base.cloudTurb,
    cyclones: base.cyclones * range(ter, 0.6, 1.3),
    cloudTerrain: base.cloudTerrain,
    cloudDetail: base.cloudDetail,
    cloudSpeed: base.cloudSpeed,
    cycloneSize: base.cycloneSize * range(ter, 0.8, 1.25),
    cloudWisp: base.cloudWisp,
    cloudRegion: Math.min(1, base.cloudRegion * range(ter, 0.85, 1.15)),
    emissive: base.emissive,
    emissiveStrength: base.emissiveStrength,
  };
}

/** Whether this body emits a great-spot storm — deterministic from the seed. */
export function hasStorm(planet: GenPlanet): boolean {
  const p = PRESETS[planet.type] ?? PRESETS.rocky;
  if (p.stormChance <= 0) return false;
  return channel(planet.seed >>> 0, 'storm')() < p.stormChance;
}
