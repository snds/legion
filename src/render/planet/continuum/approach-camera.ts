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
const _centerDir = new Vector3();
const _perp = new Vector3();
// P2-19: these are pure per-call scratch — freshly overwritten from this
// call's inputs before ever being read, so sharing them module-wide across
// different callers/bodies within the same frame is safe (no state survives
// between calls). `_stickyEast` below is the ONE exception — it is designed
// as intentional cross-FRAME hysteresis memory for a SINGLE body ("so polar
// crossings don't flip look every frame") — sharing THAT one module-wide was
// the actual bug: with multiple ContinuumGlobes calling this function in the
// same frame (any globe whose OWN apparent size crosses the LOD "near"
// threshold, not just the camera's focused body), each call's east vector was
// being compared against — and corrupting — whichever OTHER body's call ran
// immediately before it that same frame, throwing the look direction off by
// tens of degrees. `_stickyEast` is now a required per-caller parameter
// (ContinuumGlobe owns one instance per globe); `_stickyEastDefault` below
// exists only as this module's own fallback for callers that don't need
// cross-body isolation (unit tests exercising a single body/camera pair).
const _stickyEastDefault = new Vector3(1, 0, 0);

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
  // P2-19: caller-owned hysteresis state (one Vector3 per body). Callers that
  // share a camera across multiple simultaneously-"near" bodies MUST pass a
  // distinct instance per body (ContinuumGlobe does — see its `stickyEast`
  // field) or this function's east-vector continuity check will read a
  // DIFFERENT body's leftover value and can flip the look direction by tens
  // of degrees. Defaults to this module's own single shared instance, which
  // is fine only when at most one body ever drives this camera.
  stickyEast: Vector3 = _stickyEastDefault,
  // P2-19 (Part 2): the body's own world-space radius. `ahead`/`down` below
  // used to scale with raw camera-to-planet-CENTRE distance (`dist`) — but
  // that produces a FIXED angular deviation from planet-centre regardless of
  // how many body-radii away the camera actually is (the ahead/down RATIO,
  // not their absolute size, determines the angle). That's invisible when
  // literally skimming the surface (dist ≈ 1.x radii — the body fills most of
  // the sky, so any reasonable deviation still lands on it) but throws the
  // look target completely off the visible disc at SURFACE-tier zoom
  // (dist ≈ 5 radii — the disc only spans ~11° to begin with). Scaling by
  // `worldRadius` instead makes the deviation shrink the farther out (in
  // radii-terms) the camera actually is; the clamp below is the hard
  // backstop that guarantees correctness (target within the body's own
  // angular extent) regardless of how the blend math is tuned. 0/omitted
  // (e.g. the unit test) falls back to the pre-fix legacy behavior (scale by
  // `dist`, no clamp) so single-body/no-radius callers are unaffected.
  worldRadius = 0,
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
    _east.copy(stickyEast);
  } else {
    _east.normalize();
    if (_east.dot(stickyEast) < 0) _east.negate();
    stickyEast.copy(_east);
  }

  // Horizon aim: ahead along east, slightly below radial so surface fills the frame.
  const hasRadius = worldRadius > 1e-9 && worldRadius < dist;
  const swingBase = hasRadius ? worldRadius : dist;
  const ahead = swingBase * (0.55 + 0.35 * t);
  const down = swingBase * (0.08 + 0.12 * t);
  _horizon.copy(planetWorld)
    .addScaledVector(_radial, dist - down)
    .addScaledVector(_east, ahead);

  // Blend from planet-centre look (orbit) → limb look (flight).
  _planetLook.copy(planetWorld).lerp(_horizon, t);

  // Hard backstop (P2-19 Part 2): never let the look point drift past a
  // margin inside the body's own visible angular half-size
  // (atan(radius/dist) — same formula lod.ts's apparentRadiusPx uses),
  // regardless of what the blend above produced. Correctness over exact
  // cinematic feel, per this task's explicit priority.
  if (hasRadius) {
    const halfAngle = Math.atan(worldRadius / dist);
    const maxDeviation = halfAngle * 0.7;
    _look.copy(_planetLook).sub(camera.position);
    const lookDist = _look.length();
    if (lookDist > 1e-9) {
      _look.multiplyScalar(1 / lookDist);
      const cosAngle = Math.max(-1, Math.min(1, -_look.dot(_radial)));
      const angle = Math.acos(cosAngle);
      if (angle > maxDeviation) {
        _centerDir.copy(_radial).negate();
        _perp.copy(_look).addScaledVector(_centerDir, -_look.dot(_centerDir));
        if (_perp.lengthSq() > 1e-12) {
          _perp.normalize();
          _look.copy(_centerDir).multiplyScalar(Math.cos(maxDeviation))
            .addScaledVector(_perp, Math.sin(maxDeviation));
          _planetLook.copy(camera.position).addScaledVector(_look, lookDist);
        }
      }
    }
  }

  camera.lookAt(_planetLook);

  // Narrow FOV sells scale without extra tris.
  const targetFov = 32 - 14 * t; // ~32° → ~18°
  camera.fov += (targetFov - camera.fov) * (0.08 + 0.10 * t);
  camera.updateProjectionMatrix();

  return t;
}

/** Test helper — reset the module's own default sticky-east between cases
 *  (only relevant to callers using the default parameter, i.e. tests exercising
 *  a single body/camera pair; real per-body callers own their own instance). */
export function resetApproachFlightSticky(): void {
  _stickyEastDefault.set(1, 0, 0);
}
