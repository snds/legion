// ═══════════════════════════════════════════════════════════════════
// CURATED SYSTEMS — single source of truth for the hand-authored stars
//
// The ~16 nearby systems that anchor the game's local neighbourhood, each
// PINNED TO ITS REAL heliocentric position (parsecs) from the 25-pc HYG
// catalogue (public/star-systems-v1.json), matched by designation and
// validated against known distances in curated-systems.test.ts.
//
// It is the canonical replacement for two mutually-disagreeing fictional lists:
//   • star-catalog.ts STAR_SYSTEMS — a ±10-unit direction cube (regional tier)
//   • galaxy.ts GAL_SYSTEMS         — hand-authored ly offsets (galactic tier)
// One record, real coordinates, float64 galactocentric authority.
//
// Scale-unification (docs/scale-unification-plan.md): BOTH tiers now derive from
// this record. The regional tier reads regionalScenePos() — Phase 2c-1 Inc 6
// re-expressed it on the UNIFIED metric (×WU_PER_PC). The galactic tier reads
// galPos() — Phase 2c-1 Inc 4 re-pointed galaxy.ts onto it (the FROZEN galaxy-
// density HOME_POS stays put; the ~10⁴-WU offset between it and the curated home
// is sub-pixel at galaxy scale). One record, real coordinates, both tiers.
//
// Axes: galactic plane = XZ, north galactic pole = +Y (matches the build
// script's px=gx, py=gz, pz=gy mapping and the galaxy renderer's Y-up frame).
// ═══════════════════════════════════════════════════════════════════

import { Vector3 } from 'three';
import { SOL_GAL_PC, WU_PER_PC, LY_PER_PC } from '../core/metrics';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CuratedSystem {
  name: string;          // identity — must stay byte-stable (keys getStellarRender, markers)
  desig: string;         // catalogue designation matched in the HYG set
  spect: string;         // HYG spectral type (real)
  solPc: Vec3;           // REAL heliocentric position, parsecs (galactic axes)
  color: number;
  planetCount: number;
  bobCount: number;
  explored: boolean;
  hasBobs: boolean;
  isHome: boolean;
}

// Heliocentric parsec coordinates baked from public/star-systems-v1.json
// (matched by the designation in `desig`); gameplay metadata carried over
// verbatim from the prior star-catalog.ts STAR_SYSTEMS so identity, planet
// counts, Bob assignments, and home/explored flags are unchanged.
export const CURATED_SYSTEMS: CuratedSystem[] = [
  { name: 'Epsilon Eridani', desig: 'HD 22049',  spect: 'K2V',    solPc: { x: -2.068, y: -2.392, z: -0.587 }, color: 0xffcc44, planetCount: 7, bobCount: 3, explored: true,  hasBobs: true,  isHome: true  },
  { name: 'Tau Ceti',        desig: 'HD 10700',  spect: 'G8V',    solPc: { x: -1.033, y: -3.499, z:  0.125 }, color: 0xffd700, planetCount: 5, bobCount: 1, explored: true,  hasBobs: true,  isHome: false },
  { name: 'Lalande 21185',   desig: 'HD 95735',  spect: 'M2V',    solPc: { x: -1.054, y:  2.316, z: -0.094 }, color: 0xff6644, planetCount: 2, bobCount: 0, explored: true,  hasBobs: false, isHome: false },
  { name: 'Sol',             desig: 'Sol',       spect: 'G2V',    solPc: { x:  0,     y:  0,     z:  0     }, color: 0xfff4e0, planetCount: 8, bobCount: 0, explored: false, hasBobs: false, isHome: false },
  { name: 'Alpha Centauri',  desig: 'HD 128620', spect: 'G2V',    solPc: { x:  0.948, y: -0.016, z: -0.924 }, color: 0xfff8cc, planetCount: 3, bobCount: 0, explored: false, hasBobs: false, isHome: false },
  { name: "Barnard's Star",  desig: 'Gl 699',    spect: 'sdM4',   solPc: { x:  1.515, y:  0.443, z:  0.911 }, color: 0xff4422, planetCount: 1, bobCount: 0, explored: false, hasBobs: false, isHome: false },
  { name: 'Wolf 359',        desig: 'Gl 406',    spect: 'M6',     solPc: { x: -0.583, y:  1.985, z: -1.199 }, color: 0xff3322, planetCount: 0, bobCount: 0, explored: false, hasBobs: false, isHome: false },
  { name: 'Sirius',          desig: 'HD 48915',  spect: 'A0m...', solPc: { x: -1.769, y: -0.408, z: -1.913 }, color: 0xaaccff, planetCount: 0, bobCount: 0, explored: false, hasBobs: false, isHome: false },
  { name: 'Ross 154',        desig: 'Gl 729',    spect: 'M3.5Ve', solPc: { x:  2.865, y: -0.530, z:  0.573 }, color: 0xff5533, planetCount: 1, bobCount: 0, explored: false, hasBobs: false, isHome: false },
  { name: 'Ross 248',        desig: 'Gl 905',    spect: 'dM6  e', solPc: { x: -1.035, y: -0.922, z:  2.845 }, color: 0xff4433, planetCount: 0, bobCount: 0, explored: false, hasBobs: false, isHome: false },
  { name: 'Luyten 726-8',    desig: 'Gl 65A',    spect: 'dM5.5e', solPc: { x: -0.647, y: -2.547, z:  0.051 }, color: 0xff5544, planetCount: 0, bobCount: 0, explored: false, hasBobs: false, isHome: false },
  { name: '61 Cygni',        desig: 'HD 201091', spect: 'K5V',    solPc: { x:  0.463, y: -0.353, z:  3.437 }, color: 0xffaa44, planetCount: 2, bobCount: 0, explored: false, hasBobs: false, isHome: false },
  { name: 'Procyon',         desig: 'HD 61421',  spect: 'F5IV-V', solPc: { x: -2.848, y:  0.792, z: -1.900 }, color: 0xfff8dd, planetCount: 1, bobCount: 0, explored: false, hasBobs: false, isHome: false },
  { name: 'Epsilon Indi',    desig: 'HD 209100', spect: 'K5V',    solPc: { x:  2.215, y: -2.694, z: -0.977 }, color: 0xffbb44, planetCount: 3, bobCount: 0, explored: false, hasBobs: false, isHome: false },
  { name: 'Groombridge 34',  desig: 'HD 1326',   spect: 'M1V',    solPc: { x: -1.528, y: -1.135, z:  3.041 }, color: 0xff6644, planetCount: 1, bobCount: 0, explored: false, hasBobs: false, isHome: false },
  { name: 'YZ Ceti',         desig: 'Gl 54.1',   spect: 'M5.5Ve', solPc: { x: -0.621, y: -3.619, z:  0.363 }, color: 0xff3333, planetCount: 3, bobCount: 0, explored: false, hasBobs: false, isHome: false },
];

/** Home system (ε Eridani) — the origin of the regional scene frame. */
export const HOME_SYSTEM: CuratedSystem =
  CURATED_SYSTEMS.find((s) => s.isHome) ?? CURATED_SYSTEMS[0];

/**
 * Galactocentric position (parsecs, Sgr A* at the origin) — the float64
 * authoritative coordinate. Phase 2's frame broker consumes this to place the
 * galactic tier; for now it is the canonical anchor the regional frame derives.
 */
export function galPos(sys: CuratedSystem): Vec3 {
  return {
    x: SOL_GAL_PC.x + sys.solPc.x,
    y: SOL_GAL_PC.y + sys.solPc.y,
    z: SOL_GAL_PC.z + sys.solPc.z,
  };
}

/** True heliocentric distance, light-years. */
export function distanceLy(sys: CuratedSystem): number {
  return Math.hypot(sys.solPc.x, sys.solPc.y, sys.solPc.z) * LY_PER_PC;
}

/**
 * Regional scene-space position (world units), with home (ε Eridani) at the
 * origin, at the legacy regional scale. Derived from the REAL heliocentric
 * offset (system − home) so the local map is a true-geometry microcosm rather
 * than a fictional direction cube. The galactocentric anchor cancels in the
 * subtraction, so this is equivalently (galPos(sys) − galPos(home)) · scale.
 */
export function regionalScenePos(sys: CuratedSystem, out = new Vector3()): Vector3 {
  return out.set(
    (sys.solPc.x - HOME_SYSTEM.solPc.x) * WU_PER_PC,
    (sys.solPc.y - HOME_SYSTEM.solPc.y) * WU_PER_PC,
    (sys.solPc.z - HOME_SYSTEM.solPc.z) * WU_PER_PC,
  );
}
