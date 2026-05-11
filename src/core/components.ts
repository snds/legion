// ═══════════════════════════════════════════════════════════════════
// ECS COMPONENTS — Struct-of-Arrays (bitECS)
// Every piece of mutable game state lives here as a component.
// Rendering reads from these; simulation writes to them.
// This separation enables clean serialization, networking, and replay.
//
// Convention:
//   - Components are plain SoA stores (Float64Array, Uint8Array, etc.)
//   - Tags are zero-size markers used for queries
//   - Relationship data uses entity IDs (eid) as references
// ═══════════════════════════════════════════════════════════════════

import { defineComponent, Types } from 'bitecs';

// ── Spatial ──────────────────────────────────────────────────────

/** World-space position (doubles for astronomical precision) */
export const Position = defineComponent({
  x: Types.f64,
  y: Types.f64,
  z: Types.f64,
});

/** Euler rotation in radians */
export const Rotation = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/** Uniform or per-axis scale */
export const Scale = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/** Velocity vector for movement systems */
export const Velocity = defineComponent({
  x: Types.f64,
  y: Types.f64,
  z: Types.f64,
});

// ── Orbital Mechanics ────────────────────────────────────────────

/** Keplerian orbital elements */
export const Orbit = defineComponent({
  semiMajorAxis: Types.f64,  // AU
  eccentricity:  Types.f64,
  inclination:   Types.f64,  // radians
  argPeriapsis:  Types.f64,  // ω
  longAscNode:   Types.f64,  // Ω
  meanAnomaly:   Types.f64,  // current M
  meanMotion:    Types.f64,  // rad/s
  parentEid:     Types.ui32, // entity this orbits (0 = star)
});

// ── Identity & Classification ────────────────────────────────────

/** Display name index (maps to string table) */
export const Identity = defineComponent({
  nameIndex:   Types.ui16, // index into string table
  designIndex: Types.ui16, // designation string index
  typeTag:     Types.ui8,  // EntityType enum
});

/** Entity type enum — stored as ui8 in Identity.typeTag */
export enum EntityType {
  Star       = 0,
  Planet     = 1,
  Moon       = 2,
  Bob        = 3,
  Station    = 4,
  Asteroid   = 5,
  Comet      = 6,
  Phenomenon = 7,
  System     = 8,   // regional/galactic star system marker
  Alien      = 9,
  Galaxy     = 10,
}

// ── Bob (Von Neumann Probe) ──────────────────────────────────────

/** Bob-specific attributes */
export const BobState = defineComponent({
  generation: Types.ui8,
  health:     Types.f32,
  driftIndex: Types.f32,
  focusType:  Types.ui8,   // BobFocus enum
  autonomy:   Types.ui8,   // BobAutonomy enum
  color:      Types.ui32,  // hex color
  systemEid:  Types.ui32,  // current system entity (0 = in transit)
});

/** Bob personality traits (drives AI utility curves) */
export const Personality = defineComponent({
  aggression:  Types.f32,  // 0-1
  curiosity:   Types.f32,  // 0-1
  caution:     Types.f32,  // 0-1
  sociability: Types.f32,  // 0-1
  optimism:    Types.f32,  // 0-1
  humor:       Types.f32,  // 0-1
  independence: Types.f32, // 0-1
});

export enum BobFocus {
  Sentinel   = 0,
  Industrial = 1,
  Explorer   = 2,
  Research   = 3,
}

export enum BobAutonomy {
  Directive   = 0,
  Guided      = 1,
  Independent = 2,
  Autonomous  = 3,
}

// ── Planet ────────────────────────────────────────────────────────

export const PlanetState = defineComponent({
  planetType:    Types.ui8,   // PlanetType enum
  surfaceTemp:   Types.f32,   // Kelvin
  gravity:       Types.f32,   // g
  status:        Types.ui8,   // ExplorationStatus enum
  bobsPresent:   Types.ui8,
  hasAtmosphere: Types.ui8,   // boolean
  atmosColor:    Types.ui32,  // hex
});

export enum PlanetType {
  Rocky    = 0,
  Oceanic  = 1,
  Desert   = 2,
  GasGiant = 3,
  IceGiant = 4,
  Dwarf    = 5,
}

export enum ExplorationStatus {
  Uncharted    = 0,
  Surveyed     = 1,
  Mining       = 2,
  Harvesting   = 3,
  Habitable    = 4,
  Construction = 5,
}

// ── Station ──────────────────────────────────────────────────────

export const StationState = defineComponent({
  stationType: Types.ui8,    // StationType enum
  capacity:    Types.ui16,
  parentEid:   Types.ui32,   // planet this orbits
  orbitOffset: Types.f32,    // distance from parent
  angle:       Types.f32,    // current orbital angle
});

export enum StationType {
  MiningHub     = 0,
  Shipyard      = 1,
  SpaceElevator = 2,
  SensorArray   = 3,
}

// ── Transit ──────────────────────────────────────────────────────

export const Transit = defineComponent({
  fromSystemEid: Types.ui32,
  toSystemEid:   Types.ui32,
  progress:      Types.f64,  // 0-1
  travelYears:   Types.f64,
  startGameTime: Types.f64,
});

// ── Star System (Regional/Galactic) ──────────────────────────────

export const StarSystem = defineComponent({
  spectralType: Types.ui8,
  distanceLy:   Types.f64,
  color:        Types.ui32,
  bobCount:     Types.ui8,
  planetCount:  Types.ui8,
  explored:     Types.ui8,  // boolean
  hasBobs:      Types.ui8,  // boolean
  status:       Types.ui8,  // 0=green, 1=yellow, 2=red
  isHome:       Types.ui8,  // boolean
});

// ── Alien Civilization ───────────────────────────────────────────

export const AlienCiv = defineComponent({
  threatLevel:     Types.ui8,  // 0=protected, 1=neutral, 2=hostile
  color:           Types.ui32,
  influenceRadius: Types.f32,
});

// ── Rendering Hints ──────────────────────────────────────────────

/** Visual size for rendering (separates display from simulation) */
export const RenderSize = defineComponent({
  radius: Types.f32,
});

/** Links an ECS entity to a Three.js Object3D via lookup map */
export const RenderRef = defineComponent({
  meshId: Types.ui32, // key into renderObjectMap
});

/** Visibility state (driven by zoom tier logic) */
export const Visibility = defineComponent({
  visible:     Types.ui8,  // boolean
  iconVisible: Types.ui8,  // boolean
  meshOpacity: Types.f32,
  iconOpacity: Types.f32,
});

// ── Production Queue ─────────────────────────────────────────────

export const BuildOrder = defineComponent({
  itemIndex:  Types.ui16,  // index into buildable items table
  stationEid: Types.ui32,
  progress:   Types.f32,   // 0-100
  cost:       Types.ui16,
});

// ── Tags (zero-size markers for queries) ─────────────────────────

export const IsLocal      = defineComponent(); // exists in current system
export const IsSelectable = defineComponent(); // can be clicked/hovered
export const IsSelected   = defineComponent(); // currently selected
export const IsHovered    = defineComponent(); // currently hovered
export const NeedsSyncToRender = defineComponent(); // dirty flag
