// ═══════════════════════════════════════════════════════════════════
// SCALE MANAGER — Configurable Visual Scale for Celestial Bodies
// Allows scaling celestial body visual sizes from 1x (real) to 8x
// within the solar system. Scale smoothly transitions to 1x at
// the heliopause boundary. Beyond heliopause: no scaling applied.
//
// Scale only affects visual mesh sizes, NOT orbital positions.
// ═══════════════════════════════════════════════════════════════════

import { VP } from './visual-params';
import { Game, getCamDist } from '../core/state';

/**
 * Get the effective visual scale factor for the current camera position.
 * Within the solar system: returns the user-configured scale (1x-8x).
 * In the transition zone: smoothly lerps toward 1x.
 * Beyond the transition zone: returns 1x.
 */
export function getEffectiveScale(): number {
  const userScale = VP.get('visualScale');
  const camDist = Game.data.camDist;

  // Transition zone distances (in world units)
  const innerAU = VP.get('transitionZoneInner');
  const outerAU = VP.get('transitionZoneOuter');
  const AU_SCALE = 10;
  const innerDist = innerAU * AU_SCALE;
  const outerDist = outerAU * AU_SCALE;

  if (camDist <= innerDist) {
    // Fully within solar system — use full user scale
    return userScale;
  }

  if (camDist >= outerDist) {
    // Beyond transition zone — no scaling
    return 1.0;
  }

  // In transition zone — smooth lerp from userScale to 1.0
  const t = (camDist - innerDist) / (outerDist - innerDist);
  // Use smoothstep for non-linear transition (no visual pop)
  const smooth = t * t * (3 - 2 * t);
  return userScale + (1.0 - userScale) * smooth;
}

/**
 * Check if the current zoom level is within the solar system
 * (i.e., visual scaling should be applied).
 */
export function isInSolarSystem(): boolean {
  const outerAU = VP.get('transitionZoneOuter');
  const AU_SCALE = 10;
  return Game.data.camDist < outerAU * AU_SCALE;
}
