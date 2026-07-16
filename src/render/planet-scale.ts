// ═══════════════════════════════════════════════════════════════════
// PLANET SCALE — true 1:1 planetary radius (v2 Phase 0b, ?scale1to1).
//
// The default game renders planets at a hand-authored, inflated `size` so they
// read at system framing. Under ?scale1to1 we render them at their TRUE radius
// instead, so a planet feels like a real world you cross real distance to reach
// (paired with the telephoto FOV from Phase 0a). Curated catalogue bodies carry
// only a legacy visual `size` + PlanetType (no real radius), so we map the type
// to a representative R⊕ for the review; generated bodies (which do carry
// radiusEarth) can pass it directly. renderSyncSystem folds the per-body factor
// into the visual scale; bodyRadius is corrected so the camera focus/approach
// frames the true size. Off → identity (factor 1); default game is untouched.
// ═══════════════════════════════════════════════════════════════════

import { AU_TO_WU } from '../core/metrics';
import { PlanetType } from '../core/components';

/** Planet v2 Phase 0/0b true-scale review flag (same flag drives the FOV in
 *  camera.ts). Read once at module load. */
export const TRUE_SCALE = typeof location !== 'undefined'
  && new URLSearchParams(location.search).has('scale1to1');

/** 1 Earth radius in AU (6371 km / 1.496e8 km per AU). */
export const R_EARTH_AU = 4.2635e-5;

/** True planetary radius in system-tier AUTHORING units (× SYSTEM_TIER_SCALE at
 *  render time). Earth ⇒ 1·4.2635e-5·10 ≈ 4.26e-4 authoring units. */
export function trueRadiusAuthoring(radiusEarth: number): number {
  return radiusEarth * R_EARTH_AU * AU_TO_WU;
}

// Representative R⊕ per legacy PlanetType — the curated catalogue has no real
// radii, so the 1:1 review uses a plausible class radius.
const REP_R_EARTH: Readonly<Record<number, number>> = {
  [PlanetType.Rocky]: 1.0,
  [PlanetType.Oceanic]: 1.0,
  [PlanetType.Desert]: 0.9,
  [PlanetType.GasGiant]: 11,
  [PlanetType.IceGiant]: 4,
  [PlanetType.Dwarf]: 0.2,
};
/** Luna-class stand-in for moons (no per-moon radius in the curated data). */
export const MOON_REP_R_EARTH = 0.27;

export function planetTypeRepRadiusEarth(planetTypeId: number): number {
  return REP_R_EARTH[planetTypeId] ?? 1.0;
}

/** Per-body multiplier that brings an authored-`size` mesh to true 1:1 radius.
 *  Returns 1 when the flag is off (identity — no change to the default game). */
export function trueScaleFactor(authoredSize: number, radiusEarth: number): number {
  if (!TRUE_SCALE || authoredSize <= 0) return 1;
  return trueRadiusAuthoring(radiusEarth) / authoredSize;
}
