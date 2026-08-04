// Generator layer — pluggable providers for any surface engine (Continuum, Legacy, …).
// Sampling is deterministic from seed + direction; engines never own a second height master.

import type { PlanetVisualType } from '../../../data/system-gen';
import type { PlanetRenderParams } from '../presets';
import type { MacroParams, PlateField } from '../plates';
import type { Vec3 } from '../cube-sphere';

export type { Vec3 };

/** Normalized height / climate sample at a unit direction. */
export interface SurfaceSample {
  height: number;
  sea: boolean;
  temp: number;
  moisture: number;
  ice: number;
  /** 0..1 habitability / settlement weight. */
  habit: number;
  /** Linear RGB albedo hint. */
  color: [number, number, number];
}

export interface PlateTectonicsProvider {
  readonly type: PlanetVisualType;
  readonly field: PlateField;
  /** Macro tectonic height in [0,1] (warped space handled by caller or provider). */
  macroHeight(dir: Vec3): number;
  /** Full terrain height including detail / finish (engine may use as column top). */
  terrainHeight(dir: Vec3): number;
  invalidate(): void;
}

export interface ClimateProvider {
  /**
   * @param height Full terrain height (sea line, ramp, ice mass).
   * @param climateElev Continuous elev for lapse/moisture (plate macro). Defaults to height.
   */
  sample(
    dir: Vec3,
    height: number,
    climateElev?: number,
  ): Pick<SurfaceSample, 'temp' | 'moisture' | 'ice' | 'habit' | 'color' | 'sea'>;
  invalidate(): void;
}

export interface StormSlot {
  /** Object-space unit centre. */
  pos: Vec3;
  /** Signed strength (hemisphere spin). */
  strength: number;
}

export interface WeatherProvider {
  /** Cloud density 0..1 at unit direction (time-varying). */
  cloudDensity(dir: Vec3, timeSec: number): number;
  storms(): readonly StormSlot[];
  tick(dt: number, cloudSpeed: number): void;
  invalidate(): void;
}

/** Optional per-chunk paint diffs; edits win over procedural sample. */
export interface AuthoringStore {
  fingerprint(): string;
  /** Height delta at dir, or 0 if none. */
  heightDelta(dir: Vec3, chunkKey: string): number;
  biomeOverride(dir: Vec3, chunkKey: string): number | null;
  clear(): void;
}

export interface GeneratorBundle {
  seed: number;
  type: PlanetVisualType;
  params: PlanetRenderParams;
  macro: MacroParams;
  plates: PlateTectonicsProvider;
  climate: ClimateProvider;
  weather: WeatherProvider;
  authoring: AuthoringStore;
  /** Combined fingerprint for chunk cache invalidation. */
  fingerprint(): string;
  refreshParams(params: PlanetRenderParams, macro: MacroParams): void;
}
