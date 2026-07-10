// ═══════════════════════════════════════════════════════════════════
// GALACTIC DRIFT — systems orbit Sgr A*.
//
// Canonical positions (curated solPc, the HYG catalogue) are EPOCH
// SNAPSHOTS. As simulated time advances, every system sweeps its own
// differential circular orbit: Ω(R) from the SAME Milky-Way rotation model
// the physical galaxy's streaming shader uses (render/mw-model), with the
// SAME sign (galaxy-physical bakes ω = −Ω(R) into its orbit elements), so
// drifted markers CO-ROTATE with the visible disc.
//
// Magnitudes: one galactic year at Sol ≈ 216 Myr. At the current max time
// accel (1 yr/s) drift is microscopic in any session — the point is
// correctness: the sim ACCOUNTS for it, and cranked far enough the
// neighbourhood visibly shears (inner systems overtake outer ones).
//
// Frames: the regional scene is HOME-relative, so regional consumers see
// only DIFFERENTIAL drift (system − home): pure shear, tiny across 25 pc.
// The absolute swing around the centre shows at the galactic tier, where
// positions are galactocentric. Circular orbits stay in their plane, so
// y (galactic Z) never changes — marker stems stay valid under drift.
// ═══════════════════════════════════════════════════════════════════

import { angularSpeed_radPerMyr } from '../render/mw-model';
import { SOL_GAL_PC, WU_PER_PC } from './metrics';
import { HOME_SYSTEM } from '../data/curated-systems';

export const SECONDS_PER_MYR = 3.15576e13; // 1e6 Julian years of 365.25 d

/** Simulated game time (float64 seconds) → galactic-drift clock in Myr. */
export function gameTimeToMyr(gameTimeSec: number): number {
  return gameTimeSec / SECONDS_PER_MYR;
}

export interface Vec3Like { x: number; y: number; z: number }

/**
 * Drift a GALACTOCENTRIC parsec position (game axes: plane XZ, +Y NGP,
 * Sgr A* at the origin) by tMyr of differential rotation. Pure rotation in
 * the XZ plane about +Y; y is untouched.
 */
export function driftGalPc(x: number, y: number, z: number, tMyr: number, out: Vec3Like): Vec3Like {
  const rPc = Math.hypot(x, z);
  if (rPc < 1e-6 || tMyr === 0) { out.x = x; out.y = y; out.z = z; return out; }
  // Same sign convention as the disc's streaming orbits (ω = −Ω(R)).
  const th = -angularSpeed_radPerMyr(rPc / 1000) * tMyr;
  const c = Math.cos(th), s = Math.sin(th);
  out.x = x * c - z * s; // φ = atan2(z, x) advanced by th
  out.y = y;
  out.z = x * s + z * c;
  return out;
}

const homeScratch: Vec3Like = { x: 0, y: 0, z: 0 };
const sysScratch: Vec3Like = { x: 0, y: 0, z: 0 };

/**
 * Drifted regional scene position (WU, home at the origin) for a system given
 * its epoch HELIOCENTRIC parsec offset. Both the system and home drift on
 * their own galactocentric orbits; the difference is what the regional frame
 * shows. At tMyr = 0 this reproduces regionalScenePos() exactly.
 */
export function driftedRegionalScenePos(solPc: Vec3Like, tMyr: number, out: Vec3Like): Vec3Like {
  driftGalPc(SOL_GAL_PC.x + HOME_SYSTEM.solPc.x, SOL_GAL_PC.y + HOME_SYSTEM.solPc.y,
             SOL_GAL_PC.z + HOME_SYSTEM.solPc.z, tMyr, homeScratch);
  driftGalPc(SOL_GAL_PC.x + solPc.x, SOL_GAL_PC.y + solPc.y,
             SOL_GAL_PC.z + solPc.z, tMyr, sysScratch);
  out.x = (sysScratch.x - homeScratch.x) * WU_PER_PC;
  out.y = (sysScratch.y - homeScratch.y) * WU_PER_PC;
  out.z = (sysScratch.z - homeScratch.z) * WU_PER_PC;
  return out;
}

/**
 * Minimum drift-clock step (Myr) worth re-deriving positions for: 100 game-
 * years ≈ sub-WU regional shear. Consumers gate their per-frame updates on
 * this so drift costs nothing at normal time compression.
 */
export const DRIFT_MIN_STEP_MYR = 1e-4;
