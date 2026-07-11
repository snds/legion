// ═══════════════════════════════════════════════════════════════════
// NEBULA PLACEMENT — pure galaxy-tier math (galactocentric pc ↔ scene WU,
// galactic (l,b,d) → position, zoom-LOD pull-back taper).
//
// Kept separate from test-nebula.ts so it carries NO dependency on galaxy.ts
// (the heavy renderer module): the determinism tests exercise these directly.
// The frame is the SAME one the curated stars use — galactocentric parsecs,
// Sgr A* at the origin, galactic plane = XZ, north galactic pole = +Y, Sol at
// SOL_GAL_PC — so a nebula placed here sits correctly among the real stars.
// ═══════════════════════════════════════════════════════════════════

import { Vector3 } from 'three';
import { WU_PER_PC, SOL_GAL_PC } from '../../core/metrics';
import { HOME_GAL_PC } from '../sector/sector';
import type { NebulaVec3 } from './nebula';

/**
 * Galactocentric position (parsecs) of an object at galactic longitude `lDeg`,
 * latitude `bDeg`, heliocentric distance `distPc`. Uses the SAME axis mapping as
 * curated-systems (px=gx toward GC, py=gz = NGP/vertical, pz=gy toward l=90°),
 * added to Sol's galactocentric anchor — so it lands in-frame with the stars.
 */
export function galPosFromGalactic(lDeg: number, bDeg: number, distPc: number): NebulaVec3 {
  const l = (lDeg * Math.PI) / 180;
  const b = (bDeg * Math.PI) / 180;
  const gx = distPc * Math.cos(b) * Math.cos(l); // toward GC (l=0)
  const gy = distPc * Math.cos(b) * Math.sin(l); // toward l=90°
  const gz = distPc * Math.sin(b);               // toward NGP (vertical)
  // Game axes: x=gx, y=gz (vertical), z=gy — matches curated-systems' solPc.
  return {
    x: SOL_GAL_PC.x + gx,
    y: SOL_GAL_PC.y + gz,
    z: SOL_GAL_PC.z + gy,
  };
}

/** Absolute scene-WU center (home at the scene origin) of a galactocentric point
 *  — identical convention to sector.ts's `centerAbsWU`. */
export function nebulaCenterAbsWU(galPosPc: NebulaVec3, out = new Vector3()): Vector3 {
  return out
    .set(galPosPc.x, galPosPc.y, galPosPc.z)
    .sub(HOME_GAL_PC)
    .multiplyScalar(WU_PER_PC);
}

function smooth01(x: number, lo: number, hi: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/**
 * Zoom-LOD pull-back taper: 1 across the galaxy-framing band, easing to 0 as the
 * camera pulls back far beyond the nebula's own scale (so a 40-pc object doesn't
 * linger as a bright dot once the whole galaxy is a speck). Thresholds are
 * multiples of the nebula's world radius — the same "yield once you're well
 * outside it" philosophy star-shells uses. Multiplied onto getGalaxyCrossfade().
 */
export function pullbackTaper(camDist: number, radiusPc: number): number {
  const rWU = Math.max(radiusPc, 1) * WU_PER_PC;
  return 1 - smooth01(camDist, rWU * 200, rWU * 800);
}
