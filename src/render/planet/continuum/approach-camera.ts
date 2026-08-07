// C4 — approach flight camera: limb-forward look when inside atmosphere.
// IMPORTANT: never rewrite camera.up to the planet radial. The orbital CameraController
// lookAt(planet) next frame with a radial up is near-degenerate and leaves the view
// permanently rolled (poles appear on the equator). Keep world +Y.

import { Vector3 } from 'three';

/** Start blending from nadir (look at planet) toward horizon flight. */
export const APPROACH_FLIGHT_START_AU = 0.32;
/** Full atmospheric parallel flight by this distance. */
export const APPROACH_FLIGHT_FULL_AU = 0.11;

/** Minimal camera surface used by Continuum (PerspectiveCamera satisfies this). */
export interface ApproachCameraLike {
  position: Vector3;
  up: Vector3;
  fov: number;
  getWorldDirection(target: Vector3): Vector3;
  lookAt(x: number | Vector3, y?: number, z?: number): void;
  updateProjectionMatrix(): void;
}

const _radial = new Vector3();
const _east = new Vector3();
const _look = new Vector3();
const _planetLook = new Vector3();
const _horizon = new Vector3();
const _worldUp = new Vector3(0, 1, 0);
/** Sticky east so polar crossings don't flip look every frame. */
const _stickyEast = new Vector3(1, 0, 0);

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** 0 at orbit, 1 in atmosphere flight. */
export function approachFlightBlend(viewAu: number): number {
  if (viewAu >= APPROACH_FLIGHT_START_AU) return 0;
  if (viewAu <= APPROACH_FLIGHT_FULL_AU) return 1;
  return clamp01(
    (APPROACH_FLIGHT_START_AU - viewAu)
      / Math.max(1e-6, APPROACH_FLIGHT_START_AU - APPROACH_FLIGHT_FULL_AU),
  );
}

/**
 * Reorient for close approach: look toward the limb (horizon ahead) while
 * keeping world +Y up so orbit framing never rolls. Narrows FOV (C4).
 */
export function applyApproachFlightCamera(
  camera: ApproachCameraLike,
  planetWorld: Vector3,
  viewAu: number,
): number {
  // Always pin world up — also repairs any prior radial-up corruption.
  camera.up.copy(_worldUp);

  const t = approachFlightBlend(viewAu);
  if (t <= 0.001) return 0;

  _radial.copy(camera.position).sub(planetWorld);
  const dist = _radial.length();
  if (dist < 1e-9) return 0;
  _radial.multiplyScalar(1 / dist);

  // East = worldUp × radial (tangent, parallel to surface & level with horizon).
  _east.crossVectors(_worldUp, _radial);
  if (_east.lengthSq() < 1e-8) {
    _east.copy(_stickyEast);
  } else {
    _east.normalize();
    if (_east.dot(_stickyEast) < 0) _east.negate();
    _stickyEast.copy(_east);
  }

  // Horizon aim: ahead along east, slightly below radial so surface fills the frame.
  const ahead = dist * (0.55 + 0.35 * t);
  const down = dist * (0.08 + 0.12 * t);
  _horizon.copy(planetWorld)
    .addScaledVector(_radial, dist - down)
    .addScaledVector(_east, ahead);

  // Blend from planet-centre look (orbit) → limb look (flight).
  _planetLook.copy(planetWorld).lerp(_horizon, t);
  camera.lookAt(_planetLook);

  // Narrow FOV sells scale without extra tris.
  const targetFov = 32 - 14 * t; // ~32° → ~18°
  camera.fov += (targetFov - camera.fov) * (0.08 + 0.10 * t);
  camera.updateProjectionMatrix();

  void _look;
  return t;
}

/** Test helper — reset sticky east between cases. */
export function resetApproachFlightSticky(): void {
  _stickyEast.set(1, 0, 0);
}
