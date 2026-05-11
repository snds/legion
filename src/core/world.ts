// ═══════════════════════════════════════════════════════════════════
// ECS WORLD — World Instance, String Table, Entity Factory
// bitECS worlds are pure data containers. This module creates the
// world and provides helpers for entity lifecycle management.
//
// The string table stores display names and designations since
// bitECS SoA components only support numeric types. Entities
// reference strings by index into this table.
// ═══════════════════════════════════════════════════════════════════

import {
  createWorld, addEntity, removeEntity, addComponent,
} from 'bitecs';
import {
  Position, Rotation, Scale, Velocity, Orbit,
  Identity, EntityType,
  BobState, Personality, PlanetState, StationState,
  StarSystem, AlienCiv, Transit, RenderSize,
  IsLocal, IsSelectable, NeedsSyncToRender,
} from './components';

// ── World ────────────────────────────────────────────────────────

export const world = createWorld();

// ── String Table ─────────────────────────────────────────────────

class StringTable {
  private strings: string[] = [];
  private lookup = new Map<string, number>();

  /** Add a string and return its index. Returns existing index if duplicate. */
  add(str: string): number {
    const existing = this.lookup.get(str);
    if (existing !== undefined) return existing;

    const index = this.strings.length;
    this.strings.push(str);
    this.lookup.set(str, index);
    return index;
  }

  /** Get string by index */
  get(index: number): string {
    return this.strings[index] ?? '';
  }

  /** Serialize for save/load */
  serialize(): string[] {
    return [...this.strings];
  }

  /** Deserialize from save data */
  deserialize(data: string[]): void {
    this.strings = [...data];
    this.lookup.clear();
    data.forEach((str, i) => this.lookup.set(str, i));
  }

  get count(): number {
    return this.strings.length;
  }
}

export const Strings = new StringTable();

// ── Entity Factories ─────────────────────────────────────────────

export interface StarConfig {
  name: string;
  color: number;
  radius: number;
}

export function createStarEntity(cfg: StarConfig): number {
  const eid = addEntity(world);
  addComponent(world, Position, eid);
  addComponent(world, Identity, eid);
  addComponent(world, RenderSize, eid);
  addComponent(world, IsLocal, eid);
  addComponent(world, IsSelectable, eid);
  addComponent(world, NeedsSyncToRender, eid);

  Identity.nameIndex[eid] = Strings.add(cfg.name);
  Identity.typeTag[eid] = EntityType.Star;
  RenderSize.radius[eid] = cfg.radius;
  Position.x[eid] = 0;
  Position.y[eid] = 0;
  Position.z[eid] = 0;

  return eid;
}

export interface PlanetConfig {
  name: string;
  designation: string;
  planetType: number;
  sma: number;      // semi-major axis (AU)
  ecc: number;      // eccentricity
  size: number;     // visual radius
  color: number;
  surfaceTemp: number;
  gravity: number;
  status: number;
  hasAtmosphere: boolean;
  atmosColor: number;
  inclination?: number;
  startAngle?: number;
  meanMotion?: number;
  texturePath?: string;
  ringTexturePath?: string;
  axialTilt?: number;    // degrees
  dayLength?: number;    // in Earth days
}

export function createPlanetEntity(cfg: PlanetConfig): number {
  const eid = addEntity(world);
  addComponent(world, Position, eid);
  addComponent(world, Orbit, eid);
  addComponent(world, Identity, eid);
  addComponent(world, PlanetState, eid);
  addComponent(world, RenderSize, eid);
  addComponent(world, IsLocal, eid);
  addComponent(world, IsSelectable, eid);
  addComponent(world, NeedsSyncToRender, eid);

  Identity.nameIndex[eid] = Strings.add(cfg.name);
  Identity.designIndex[eid] = Strings.add(cfg.designation);
  Identity.typeTag[eid] = EntityType.Planet;

  Orbit.semiMajorAxis[eid] = cfg.sma;
  Orbit.eccentricity[eid] = cfg.ecc;
  Orbit.inclination[eid] = cfg.inclination ?? 0;
  Orbit.meanAnomaly[eid] = cfg.startAngle ?? Math.random() * Math.PI * 2;
  Orbit.meanMotion[eid] = cfg.meanMotion ?? (2 * Math.PI) / (cfg.sma * cfg.sma * 365);

  PlanetState.planetType[eid] = cfg.planetType;
  PlanetState.surfaceTemp[eid] = cfg.surfaceTemp;
  PlanetState.gravity[eid] = cfg.gravity;
  PlanetState.status[eid] = cfg.status;
  PlanetState.hasAtmosphere[eid] = cfg.hasAtmosphere ? 1 : 0;
  PlanetState.atmosColor[eid] = cfg.atmosColor;

  RenderSize.radius[eid] = cfg.size;

  return eid;
}

export interface MoonConfig {
  name: string;
  parentName: string;
  size: number;
  color: number;
  sma: number;      // orbital radius in parent-local visual units
  ecc: number;
  inclination?: number;
  dayLength?: number;
  tidalLock?: boolean;
  texturePath?: string;
}

export function createMoonEntity(cfg: MoonConfig, parentEid: number): number {
  const eid = addEntity(world);
  addComponent(world, Position, eid);
  addComponent(world, Orbit, eid);
  addComponent(world, Identity, eid);
  addComponent(world, RenderSize, eid);
  addComponent(world, IsLocal, eid);
  addComponent(world, IsSelectable, eid);
  addComponent(world, NeedsSyncToRender, eid);

  Identity.nameIndex[eid] = Strings.add(cfg.name);
  Identity.designIndex[eid] = Strings.add(`Moon of ${cfg.parentName}`);
  Identity.typeTag[eid] = EntityType.Moon;

  // Moon SMA is in parent-local visual units, not AU.
  // Store raw value; orbitalSystem handles the scaling.
  Orbit.semiMajorAxis[eid] = cfg.sma;
  Orbit.eccentricity[eid] = cfg.ecc;
  Orbit.inclination[eid] = cfg.inclination ?? 0;
  Orbit.meanAnomaly[eid] = Math.random() * Math.PI * 2;
  // Moon orbital period: faster than planets, scale by sma^1.5 (Kepler)
  Orbit.meanMotion[eid] = (2 * Math.PI) / (cfg.sma * Math.sqrt(cfg.sma) * 10);
  Orbit.parentEid[eid] = parentEid;

  RenderSize.radius[eid] = cfg.size;

  return eid;
}

export interface BobConfig {
  name: string;
  callsign: string;
  generation: number;
  color: number;
  health: number;
  driftIndex: number;
  focusType: number;
  autonomy: number;
  systemEid: number;
  personality: {
    aggression: number;
    curiosity: number;
    caution: number;
    sociability: number;
    optimism: number;
    humor: number;
    independence: number;
  };
  position?: { x: number; y: number; z: number };
}

export function createBobEntity(cfg: BobConfig): number {
  const eid = addEntity(world);
  addComponent(world, Position, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, Identity, eid);
  addComponent(world, BobState, eid);
  addComponent(world, Personality, eid);
  addComponent(world, RenderSize, eid);
  addComponent(world, IsLocal, eid);
  addComponent(world, IsSelectable, eid);
  addComponent(world, NeedsSyncToRender, eid);

  Identity.nameIndex[eid] = Strings.add(cfg.name);
  Identity.designIndex[eid] = Strings.add(cfg.callsign);
  Identity.typeTag[eid] = EntityType.Bob;

  BobState.generation[eid] = cfg.generation;
  BobState.health[eid] = cfg.health;
  BobState.driftIndex[eid] = cfg.driftIndex;
  BobState.focusType[eid] = cfg.focusType;
  BobState.autonomy[eid] = cfg.autonomy;
  BobState.color[eid] = cfg.color;
  BobState.systemEid[eid] = cfg.systemEid;

  Personality.aggression[eid] = cfg.personality.aggression;
  Personality.curiosity[eid] = cfg.personality.curiosity;
  Personality.caution[eid] = cfg.personality.caution;
  Personality.sociability[eid] = cfg.personality.sociability;
  Personality.optimism[eid] = cfg.personality.optimism;
  Personality.humor[eid] = cfg.personality.humor;
  Personality.independence[eid] = cfg.personality.independence;

  if (cfg.position) {
    Position.x[eid] = cfg.position.x;
    Position.y[eid] = cfg.position.y;
    Position.z[eid] = cfg.position.z;
  }
  RenderSize.radius[eid] = 1.5;

  return eid;
}

export interface SystemConfig {
  name: string;
  x: number;
  y: number;
  z: number;
  distanceLy: number;
  color: number;
  planetCount: number;
  bobCount: number;
  explored: boolean;
  hasBobs: boolean;
  isHome: boolean;
  spectralType?: number;
}

export function createSystemEntity(cfg: SystemConfig): number {
  const eid = addEntity(world);
  addComponent(world, Position, eid);
  addComponent(world, Identity, eid);
  addComponent(world, StarSystem, eid);
  addComponent(world, RenderSize, eid);
  addComponent(world, IsSelectable, eid);
  addComponent(world, NeedsSyncToRender, eid);

  Identity.nameIndex[eid] = Strings.add(cfg.name);
  Identity.typeTag[eid] = EntityType.System;

  Position.x[eid] = cfg.x;
  Position.y[eid] = cfg.y;
  Position.z[eid] = cfg.z;

  StarSystem.distanceLy[eid] = cfg.distanceLy;
  StarSystem.color[eid] = cfg.color;
  StarSystem.planetCount[eid] = cfg.planetCount;
  StarSystem.bobCount[eid] = cfg.bobCount;
  StarSystem.explored[eid] = cfg.explored ? 1 : 0;
  StarSystem.hasBobs[eid] = cfg.hasBobs ? 1 : 0;
  StarSystem.isHome[eid] = cfg.isHome ? 1 : 0;
  StarSystem.spectralType[eid] = cfg.spectralType ?? 0;

  RenderSize.radius[eid] = cfg.isHome ? 4 : (cfg.hasBobs ? 3 : 2);

  return eid;
}

export function destroyEntity(eid: number): void {
  removeEntity(world, eid);
}
