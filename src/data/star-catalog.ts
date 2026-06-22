// ═══════════════════════════════════════════════════════════════════
// STAR CATALOG — Star System and Planet Data
// Provides the initial game world data. Systems are real stars
// within 20 LY of Sol, with procedurally augmented planet data.
//
// This module is pure data — no ECS or rendering dependencies.
// Entity creation uses world.ts factories with this data as input.
// ═══════════════════════════════════════════════════════════════════

import type { SystemConfig, PlanetConfig, BobConfig, StarConfig, MoonConfig } from '../core/world';
import { PlanetType, ExplorationStatus, BobFocus, BobAutonomy } from '../core/components';
import { CURATED_SYSTEMS, regionalScenePos, distanceLy } from './curated-systems';

// ── Star Systems ─────────────────────────────────────────────────
//
// Derived from the canonical CURATED_SYSTEMS record (curated-systems.ts).
// x/y/z are now REAL regional scene-WU coordinates — the system's true
// heliocentric offset from home (ε Eridani), at the legacy regional scale —
// NOT the prior fictional ±10 direction cube. createSystemEntity stores these
// into Position (so the star-graph and render-sync read the same real
// geometry) and main.ts places each marker at exactly this point.
export const STAR_SYSTEMS: SystemConfig[] = CURATED_SYSTEMS.map((s) => {
  const p = regionalScenePos(s);
  return {
    name: s.name,
    x: p.x, y: p.y, z: p.z,
    distanceLy: Math.round(distanceLy(s) * 10) / 10,
    color: s.color,
    planetCount: s.planetCount,
    bobCount: s.bobCount,
    explored: s.explored,
    hasBobs: s.hasBobs,
    isHome: s.isHome,
  };
});

// ── Epsilon Eridani Planets ──────────────────────────────────────

export const EPS_ERI_STAR: StarConfig = {
  name: 'Epsilon Eridani',
  color: 0xffcc44,
  radius: 0.6,
};

export const EPS_ERI_PLANETS: PlanetConfig[] = [
  {
    name: 'Vulcan',      designation: 'EE-I',
    planetType: PlanetType.Rocky, sma: 0.3, ecc: 0.05, size: 0.4,
    color: 0x887766, surfaceTemp: 600, gravity: 0.4, status: ExplorationStatus.Surveyed,
    hasAtmosphere: false, atmosColor: 0, inclination: 0.02,
    axialTilt: 0, dayLength: 58.6,
  },
  {
    name: 'Ragnarok',    designation: 'EE-II',
    planetType: PlanetType.Rocky, sma: 0.6, ecc: 0.08, size: 0.6,
    color: 0xcc8844, surfaceTemp: 380, gravity: 0.8, status: ExplorationStatus.Mining,
    hasAtmosphere: true, atmosColor: 0xccaa77, inclination: 0.05,
    axialTilt: 177, dayLength: 243,
  },
  {
    name: 'Romulus',      designation: 'EE-III',
    planetType: PlanetType.Oceanic, sma: 1.0, ecc: 0.03, size: 0.8,
    color: 0x4488bb, surfaceTemp: 290, gravity: 1.1, status: ExplorationStatus.Habitable,
    hasAtmosphere: true, atmosColor: 0x6699cc, inclination: 0.01,
    axialTilt: 23, dayLength: 1.0,
  },
  {
    name: 'Pax',          designation: 'EE-IV',
    planetType: PlanetType.Rocky, sma: 1.5, ecc: 0.1, size: 0.5,
    color: 0xcc6644, surfaceTemp: 220, gravity: 0.6, status: ExplorationStatus.Surveyed,
    hasAtmosphere: true, atmosColor: 0xddaa88, inclination: 0.08,
    axialTilt: 25, dayLength: 1.03,
  },
  {
    name: 'Jotunheim',    designation: 'EE-V',
    planetType: PlanetType.GasGiant, sma: 3.4, ecc: 0.07, size: 2.0,
    color: 0xddbb88, surfaceTemp: 130, gravity: 2.5, status: ExplorationStatus.Surveyed,
    hasAtmosphere: true, atmosColor: 0xeedd99, inclination: 0.03,
    axialTilt: 3, dayLength: 0.41,
  },
  {
    name: 'Niflheim',     designation: 'EE-VI',
    planetType: PlanetType.IceGiant, sma: 6.0, ecc: 0.12, size: 1.5,
    color: 0x88aacc, surfaceTemp: 80, gravity: 1.4, status: ExplorationStatus.Uncharted,
    hasAtmosphere: true, atmosColor: 0x99bbdd, inclination: 0.1,
    ringTexturePath: '/textures/saturn_ring_alpha.png',
    axialTilt: 27, dayLength: 0.44,
  },
  {
    name: 'Helheim',      designation: 'EE-VII',
    planetType: PlanetType.Dwarf, sma: 10.0, ecc: 0.2, size: 0.3,
    color: 0x667788, surfaceTemp: 45, gravity: 0.2, status: ExplorationStatus.Uncharted,
    hasAtmosphere: false, atmosColor: 0, inclination: 0.15,
    axialTilt: 28, dayLength: 0.67,
  },
];

// ── Sol System ─────────────────────────────────────────────────

export const SOL_STAR: StarConfig = {
  name: 'Sol',
  color: 0xfff4e0,
  radius: 0.35,
};

export const SOL_PLANETS: PlanetConfig[] = [
  {
    name: 'Mercury',     designation: 'Sol-I',
    planetType: PlanetType.Rocky, sma: 0.387, ecc: 0.2056, size: 0.15,
    color: 0x8a7d6e, surfaceTemp: 440, gravity: 0.38, status: ExplorationStatus.Uncharted,
    hasAtmosphere: false, atmosColor: 0, inclination: 0.122,
    axialTilt: 0.034, dayLength: 58.646,
    texturePath: '/textures/sol/mercury.jpg',
  },
  {
    name: 'Venus',       designation: 'Sol-II',
    planetType: PlanetType.Rocky, sma: 0.723, ecc: 0.0068, size: 0.28,
    color: 0xc8a55a, surfaceTemp: 737, gravity: 0.91, status: ExplorationStatus.Uncharted,
    hasAtmosphere: true, atmosColor: 0xccaa77, inclination: 0.059,
    axialTilt: 177.36, dayLength: -243.025,
    texturePath: '/textures/sol/venus.jpg',
  },
  {
    name: 'Earth',       designation: 'Sol-III',
    planetType: PlanetType.Oceanic, sma: 1.0, ecc: 0.0167, size: 0.3,
    color: 0x4488bb, surfaceTemp: 288, gravity: 1.0, status: ExplorationStatus.Uncharted,
    hasAtmosphere: true, atmosColor: 0x6699cc, inclination: 0,
    axialTilt: 23.44, dayLength: 0.997,
    texturePath: '/textures/sol/earth.jpg',
  },
  {
    name: 'Mars',        designation: 'Sol-IV',
    planetType: PlanetType.Rocky, sma: 1.524, ecc: 0.0934, size: 0.18,
    color: 0xc1440e, surfaceTemp: 210, gravity: 0.38, status: ExplorationStatus.Uncharted,
    hasAtmosphere: true, atmosColor: 0xcc8866, inclination: 0.032,
    axialTilt: 25.19, dayLength: 1.026,
    texturePath: '/textures/sol/mars.jpg',
  },
  {
    name: 'Jupiter',     designation: 'Sol-V',
    planetType: PlanetType.GasGiant, sma: 5.203, ecc: 0.0489, size: 0.8,
    color: 0xc8a55a, surfaceTemp: 165, gravity: 2.53, status: ExplorationStatus.Uncharted,
    hasAtmosphere: true, atmosColor: 0xddcc88, inclination: 0.023,
    axialTilt: 3.13, dayLength: 0.414,
    texturePath: '/textures/sol/jupiter.jpg',
  },
  {
    name: 'Saturn',      designation: 'Sol-VI',
    planetType: PlanetType.GasGiant, sma: 9.537, ecc: 0.0565, size: 0.65,
    color: 0xd4b87a, surfaceTemp: 134, gravity: 1.07, status: ExplorationStatus.Uncharted,
    hasAtmosphere: true, atmosColor: 0xddcc99, inclination: 0.043,
    axialTilt: 26.73, dayLength: 0.444,
    texturePath: '/textures/sol/saturn.jpg',
    ringTexturePath: '/textures/sol/saturn_ring_alpha.png',
  },
  {
    name: 'Uranus',      designation: 'Sol-VII',
    planetType: PlanetType.IceGiant, sma: 19.19, ecc: 0.0472, size: 0.35,
    color: 0x7ec8d8, surfaceTemp: 76, gravity: 0.89, status: ExplorationStatus.Uncharted,
    hasAtmosphere: true, atmosColor: 0x88bbcc, inclination: 0.013,
    axialTilt: 97.77, dayLength: -0.718,
    texturePath: '/textures/sol/uranus.jpg',
  },
  {
    name: 'Neptune',     designation: 'Sol-VIII',
    planetType: PlanetType.IceGiant, sma: 30.07, ecc: 0.0086, size: 0.4,
    color: 0x3f54ba, surfaceTemp: 72, gravity: 1.14, status: ExplorationStatus.Uncharted,
    hasAtmosphere: true, atmosColor: 0x6688cc, inclination: 0.031,
    axialTilt: 28.32, dayLength: 0.671,
    texturePath: '/textures/sol/neptune.jpg',
  },
];

export const SOL_MOONS: MoonConfig[] = [
  {
    name: 'Moon', parentName: 'Earth',
    size: 0.08, color: 0xaaaaaa, sma: 1.9, ecc: 0.0549,
    inclination: 0.09, dayLength: 27.322, tidalLock: true,
    texturePath: '/textures/sol/moon.jpg',
  },
  {
    name: 'Io', parentName: 'Jupiter',
    size: 0.09, color: 0xddcc44, sma: 4.6, ecc: 0.004,
    inclination: 0.001, dayLength: 1.769, tidalLock: true,
    texturePath: '/textures/sol/io.jpg',
  },
  {
    name: 'Europa', parentName: 'Jupiter',
    size: 0.075, color: 0xccbbaa, sma: 5.4, ecc: 0.009,
    inclination: 0.008, dayLength: 3.553, tidalLock: true,
    texturePath: '/textures/sol/europa.jpg',
  },
  {
    name: 'Ganymede', parentName: 'Jupiter',
    size: 0.12, color: 0x887766, sma: 6.6, ecc: 0.0013,
    inclination: 0.003, dayLength: 7.155, tidalLock: true,
    texturePath: '/textures/sol/ganymede.jpg',
  },
  {
    name: 'Callisto', parentName: 'Jupiter',
    size: 0.11, color: 0x665544, sma: 8.4, ecc: 0.007,
    inclination: 0.003, dayLength: 16.689, tidalLock: true,
    texturePath: '/textures/sol/callisto.jpg',
  },
  {
    name: 'Titan', parentName: 'Saturn',
    size: 0.12, color: 0xcc9944, sma: 8.2, ecc: 0.0288,
    inclination: 0.005, dayLength: 15.945, tidalLock: true,
    texturePath: '/textures/sol/titan.jpg',
  },
  {
    name: 'Triton', parentName: 'Neptune',
    size: 0.03, color: 0x99aabb, sma: 5.0, ecc: 0.00002,
    inclination: 2.737, dayLength: 5.877, tidalLock: true,
  },
];

// ── Initial Bobs ─────────────────────────────────────────────────

export function createInitialBobs(homeSystemEid: number): BobConfig[] {
  return [
    {
      name: 'Bob-1', callsign: 'ORIGINAL', generation: 1,
      color: 0x44aaff, health: 100, driftIndex: 0,
      focusType: BobFocus.Explorer, autonomy: BobAutonomy.Guided,
      systemEid: homeSystemEid,
      position: { x: 15, y: 2, z: 10 },
      personality: {
        aggression: 0.2, curiosity: 0.9, caution: 0.4,
        sociability: 0.6, optimism: 0.8, humor: 0.7, independence: 0.5,
      },
    },
    {
      name: 'Milo', callsign: 'MILO', generation: 2,
      color: 0x44dd88, health: 95, driftIndex: 0.1,
      focusType: BobFocus.Industrial, autonomy: BobAutonomy.Independent,
      systemEid: homeSystemEid,
      position: { x: -12, y: -1, z: 8 },
      personality: {
        aggression: 0.1, curiosity: 0.5, caution: 0.7,
        sociability: 0.8, optimism: 0.9, humor: 0.3, independence: 0.3,
      },
    },
    {
      name: 'Riker', callsign: 'RIKER', generation: 2,
      color: 0xffaa44, health: 90, driftIndex: 0.15,
      focusType: BobFocus.Sentinel, autonomy: BobAutonomy.Guided,
      systemEid: homeSystemEid,
      position: { x: 8, y: 3, z: -14 },
      personality: {
        aggression: 0.7, curiosity: 0.4, caution: 0.3,
        sociability: 0.5, optimism: 0.6, humor: 0.5, independence: 0.6,
      },
    },
  ];
}

// ── Build Items ──────────────────────────────────────────────────

export interface BuildItem {
  index: number;
  name: string;
  category: 'station' | 'ship' | 'upgrade' | 'infrastructure';
  cost: number;           // resource units
  buildTime: number;      // game days
  description: string;
  prerequisite?: string;  // tech tree requirement
}

export const BUILD_ITEMS: BuildItem[] = [
  { index: 0, name: 'Mining Hub',      category: 'station',        cost: 100, buildTime: 30,  description: 'Extracts raw materials from asteroid fields' },
  { index: 1, name: 'Shipyard',        category: 'station',        cost: 250, buildTime: 60,  description: 'Constructs and repairs Von Neumann probes' },
  { index: 2, name: 'Space Elevator',  category: 'infrastructure', cost: 500, buildTime: 120, description: 'Efficient surface-to-orbit cargo transfer' },
  { index: 3, name: 'Sensor Array',    category: 'station',        cost: 150, buildTime: 45,  description: 'Extends detection range across the system' },
  { index: 4, name: 'Replication Bay', category: 'upgrade',        cost: 400, buildTime: 90,  description: 'Enables Bob self-replication at this location' },
  { index: 5, name: 'Defense Grid',    category: 'infrastructure', cost: 300, buildTime: 75,  description: 'Automated defense against hostile entities' },
  { index: 6, name: 'Research Lab',    category: 'station',        cost: 200, buildTime: 50,  description: 'Accelerates technological research' },
  { index: 7, name: 'Comm Relay',      category: 'infrastructure', cost: 80,  buildTime: 20,  description: 'Extends communication network between systems' },
];
