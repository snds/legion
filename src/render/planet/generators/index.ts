import type { GenPlanet } from '../../../data/system-gen';
import { derivePlanetParams, type PlanetRenderParams } from '../presets';
import { MACRO, type MacroParams } from '../plates';
import { createPlateProvider } from './plates-provider';
import { createClimateProvider } from './climate-provider';
import { createWeatherProvider } from './weather-provider';
import { createAuthoringStore } from './authoring-store';
import type { GeneratorBundle, SurfaceSample, Vec3 } from './types';

export type {
  GeneratorBundle, SurfaceSample, Vec3,
  PlateTectonicsProvider, ClimateProvider, WeatherProvider, AuthoringStore, StormSlot,
} from './types';
export { createPlateProvider } from './plates-provider';
export { createClimateProvider } from './climate-provider';
export { createWeatherProvider } from './weather-provider';
export { createAuthoringStore } from './authoring-store';

/** Full surface sample: plates + climate + authoring delta. */
export function sampleSurface(bundle: GeneratorBundle, dir: Vec3, chunkKey = ''): SurfaceSample {
  let h = bundle.plates.terrainHeight(dir);
  h = Math.max(0, Math.min(1, h + bundle.authoring.heightDelta(dir, chunkKey)));
  // Climate thresholds use continuous macro elev (Legacy hex-seam lesson).
  const elev = bundle.plates.macroHeight(dir);
  const c = bundle.climate.sample(dir, h, elev);
  return { height: h, ...c };
}

function f3(n: number): string { return n.toFixed(3); }

/** Heightfield / albedo bake identity — cloud-only edits must not remesh. */
export function surfaceFingerprint(
  seed: number,
  p: PlanetRenderParams,
  macro: MacroParams,
  authoringFp: string,
): string {
  return [
    seed, p.type,
    f3(p.seaLevel), f3(p.warp), f3(p.ridged), f3(p.displacement),
    f3(p.moisture), f3(p.aridBelts), f3(p.rainShadow), f3(p.orographic),
    f3(p.lapseRate), f3(p.treeline), f3(p.windBearing), f3(p.continental),
    f3(p.altitudeDry), f3(p.patchiness), f3(p.lushDepth), f3(p.snowfall),
    f3(p.latitudeIce), f3(p.roughness), f3(p.emissiveStrength),
    // nightLights is live (fragment only) — must not remesh / tint albedo.
    f3(p.oceanShallow[0]), f3(p.oceanShallow[1]), f3(p.oceanShallow[2]),
    f3(p.oceanDeep[0]), f3(p.oceanDeep[1]), f3(p.oceanDeep[2]),
    macro.plateCount, macro.continents, f3(macro.landCoverage), f3(macro.sizeVariety),
    f3(macro.uplift), f3(macro.rangeWidth), f3(macro.rangeVar),
    f3(macro.coastAmp), f3(macro.coastFreq), f3(macro.detailScale),
    f3(macro.craters), f3(macro.craterFreq), f3(macro.craterDepth),
    f3(macro.canyons), f3(macro.canyonFreq), f3(macro.canyonDepth),
    f3(macro.normalStrength),
    authoringFp,
  ].join('|');
}

/** Build the generator bundle for a planet body. */
export function createGeneratorBundle(planet: GenPlanet): GeneratorBundle {
  const seed = planet.seed >>> 0;
  const paramsRef = { current: derivePlanetParams(planet) };
  const macroRef = { current: { ...MACRO[paramsRef.current.type] } as MacroParams };
  const plates = createPlateProvider(seed, paramsRef.current.type, paramsRef, macroRef);
  const climate = createClimateProvider(paramsRef);
  const weather = createWeatherProvider(seed, paramsRef, plates);
  const authoring = createAuthoringStore();

  return {
    seed,
    get type() { return paramsRef.current.type; },
    get params() { return paramsRef.current; },
    get macro() { return macroRef.current; },
    plates,
    climate,
    weather,
    authoring,
    fingerprint() {
      return surfaceFingerprint(seed, paramsRef.current, macroRef.current, authoring.fingerprint());
    },
    refreshParams(next: PlanetRenderParams, nextMacro: MacroParams) {
      paramsRef.current = next;
      macroRef.current = { ...nextMacro };
      // Live MACRO snapshot drives height + fingerprint; remesh via invalidate.
      plates.invalidate();
      weather.invalidate();
    },
  };
}
