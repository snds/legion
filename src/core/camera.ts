// ═══════════════════════════════════════════════════════════════════
// CAMERA — Monolithic Prototype Orbital Camera
// Simple per-frame lerp interpolation for orbit, zoom, and focus.
// Lerp factors match the original monolithic prototype exactly:
//   - Zoom: 0.06
//   - Orbit (theta/phi): 0.1
//   - Focus point: 0.05
//
// No easing curves, no exponential damping, no VP params.
// Just flat lerps every frame — smooth and predictable.
// ═══════════════════════════════════════════════════════════════════

import { PerspectiveCamera, Vector3, type Object3D } from 'three';
import { Game, getCamDist, T_LOW_ORBIT, T_ORBIT } from './state';
import { Events } from './events';
import { setIconFov } from '../render/icon-system';
import { Broker } from '../render/scale-manager';

// ── Lerp Factors (monolithic prototype values) ──────────────────

const ZOOM_LERP = 0.06;
const ORBIT_LERP = 0.1;
const FOCUS_LERP = 0.05;
const FOV_LERP = 0.08;

// ── Adaptive Focal Length ───────────────────────────────────────
// FOV narrows as we approach the focused object (cinematic telephoto,
// compresses depth) and widens at galactic scale so the spiral fits.
// Curve is anchored on camDist with three breakpoints:
//   ≤ 30 WU       (planet surface / station close-up)    → 32°  (~75mm)
//   ~ 400 WU      (system / heliopause)                  → 50°  (~45mm, default-ish)
//   ~ 3000 WU     (sector / arm)                         → 62°
//   ≥ 9000 WU     (galaxy)                               → 72°  (wide)

const FOV_NEAR = 32;
const FOV_MID = 50;
const FOV_FAR = 62;
const FOV_WIDE = 72;

function fovForDistance(camDist: number): number {
  if (camDist <= 30) return FOV_NEAR;
  if (camDist <= 400) {
    const t = (camDist - 30) / (400 - 30);
    return FOV_NEAR + (FOV_MID - FOV_NEAR) * t;
  }
  if (camDist <= 3000) {
    const t = (camDist - 400) / (3000 - 400);
    return FOV_MID + (FOV_FAR - FOV_MID) * t;
  }
  if (camDist <= 9000) {
    const t = (camDist - 3000) / (9000 - 3000);
    return FOV_FAR + (FOV_WIDE - FOV_FAR) * t;
  }
  return FOV_WIDE;
}

// Per-object focus scale: the close-in tiers (surface, low-orbit, orbit)
// frame the focused body's bounding radius rather than absolute world
// units. A reference planet (Earth ≈ 0.3 WU radius) gives scale 1.0;
// a gas giant 2.0 WU → scale 6.67; a small moon 0.08 WU → scale 0.27.
const FOCUS_REFERENCE_RADIUS = 0.3;

function focusScaleMultiplier(zoomLevel: number, scale: number): number {
  // The close-in tiers frame the focused BODY (× its radius scale); system+ tiers are absolute (× 1). This used
  // to be a per-DOMAIN step, which made camDist JUMP at the tier boundaries mid-zoom when tracking a non-reference
  // body. Ramp it CONTINUOUSLY in the zoom level instead — full body scale through low-orbit, easing to 1 across
  // the ORBIT tier — so the wheel zoom is smooth end-to-end (no snap) while framing the same at each tier centre.
  if (scale === 1) return 1;
  if (zoomLevel <= T_LOW_ORBIT) return scale;
  if (zoomLevel >= T_ORBIT) return 1;
  const t = (zoomLevel - T_LOW_ORBIT) / (T_ORBIT - T_LOW_ORBIT); // 0 at low-orbit end … 1 at inner-system start
  return scale + (1 - scale) * t;
}

export class CameraController {
  private cam: PerspectiveCamera;
  private theta = 0.4;      // current azimuth angle (smoothed)
  private phi = 1.4;         // current polar angle (smoothed)
  private focus = { x: 0, y: 0, z: 0 };

  // ── Tracking State ──
  // When set, the update loop reads this object's world position each
  // frame and feeds it into camFocusTarget. Lets the camera follow
  // moving objects (planets, bobs in flight) or stay locked on static
  // objects (stations, galactic markers) regardless of scene-graph
  // transforms above them.
  private trackedObject: Object3D | null = null;
  private readonly _trackPos = new Vector3();
  // Per-object scale (set from trackedObject.userData.bodyRadius). 1.0
  // means "use absolute camDist"; >1 multiplies close-tier distances.
  private focusScale = 1.0;

  // World-space velocity tracking — frame-by-frame derivative of camera
  // position. Consumers (star streak shader, motion-blur effects) read this
  // each frame to compute per-feature visual response to camera motion.
  private readonly _velocity = new Vector3();
  private readonly _lastCamPos = new Vector3(); // last AUTHORITATIVE anchor (cam.pos + R)
  private readonly _anchorPos = new Vector3();
  private readonly _r = new Vector3(); // scratch: floating-origin rebase R
  private _velocityValid = false;

  /** World-space camera velocity in units per second, updated each frame. */
  get velocity(): Vector3 { return this._velocity; }

  /**
   * Update `_velocity` from the float64 AUTHORITATIVE camera anchor (render
   * position + the frame broker's floating-origin rebase R), not raw cam.position.
   * Under the Phase-2b identity policy R≡0, so the anchor === cam.position and this
   * is bit-identical to the prior raw-position velocity; once Phase 2c moves the
   * camera toward the residual origin, raw cam.position is ~constant and streaks
   * would read ~0 — the anchor delta is the true motion. Skipped on the first
   * frame and on implausibly large dt (debug pause / tab-resume) so a near-zero
   * "velocity" never falsely suppresses streaks.
   */
  private _trackVelocity(dt: number): void {
    Broker.getSceneRebase(this._anchorPos).add(this.cam.position); // anchor = cam.pos + R
    if (this._velocityValid && dt > 0 && dt < 0.5) {
      this._velocity.subVectors(this._anchorPos, this._lastCamPos).divideScalar(dt);
    } else {
      this._velocity.set(0, 0, 0);
    }
    this._lastCamPos.copy(this._anchorPos);
    this._velocityValid = true;
  }

  /**
   * Floating origin (Phase 2c): rebase the just-computed ABSOLUTE camera pose to
   * the residual render frame. Sets R = the camera's absolute world position on
   * the broker, then shifts cam.position AND the look target by −R so the camera
   * renders near the origin (float32-safe at galactic magnitudes). It is a global
   * −R translation, so the rendered image is pixel-identical; it just keeps GPU
   * coordinates small. No-op when the floating origin is inactive (R≡0). Must run
   * after near/far + velocity-independent math and before _trackVelocity (which
   * reads the residual cam.position so its anchor = R + residual = the absolute
   * position). `tx,ty,tz` is the ABSOLUTE look target.
   */
  private _rebaseToResidual(tx: number, ty: number, tz: number): void {
    Broker.setRebase(this.cam.position);          // R := absolute cam world pos (or 0 if inactive)
    const r = Broker.getSceneRebase(this._r);
    this.cam.position.sub(r);                      // → residual (≈0 when active)
    this.cam.lookAt(tx - r.x, ty - r.y, tz - r.z); // re-aim in the residual frame
  }

  // ── Flight-Path State ────────────────────────────────────────────
  // When set, the camera is mid-flight: position and look-at are
  // driven by a Bezier-eased trajectory rather than orbit/focus math.
  // On arrival, hands back to orbit mode with the new focus + a
  // tier-appropriate zoom level.
  private flightState: {
    startTime: number;
    duration: number;          // seconds
    startPos: Vector3;
    endPos: Vector3;
    controlPoint: Vector3;     // single Bezier control point
    startLook: Vector3;        // what camera was looking at when flight began
    endLook: Vector3;          // destination focus point (target body)
    endZoomLevel: number;      // target zoom-curve position after landing
  } | null = null;
  private readonly _flightTmp = new Vector3();
  private readonly _flightTmp2 = new Vector3();

  /** True while a flight is in progress — main code can avoid issuing
   *  conflicting orbit/zoom changes during the cinematic. */
  get flying(): boolean { return this.flightState !== null; }

  /**
   * Cinematic flight from current camera state to a new orbital position
   * around `targetPos`. The camera translates along a single-control-point
   * Bezier arc with ease-in-out cubic timing, looking at the target
   * throughout the traversal. On arrival, hands back to orbit mode.
   *
   * The arc rises above the galactic plane (worldUp = +Y) so transitions
   * between disc-immersed views feel like a fly-OVER rather than a tunnel.
   */
  flyTo(targetPos: Vector3, opts: {
    /** Final orbital distance from target. Defaults to current camDist. */
    targetCamDist?: number;
    /** Target zoomLevel for orbit mode after landing. Defaults to current. */
    targetZoomLevel?: number;
    /** Animation duration in seconds. Auto-derives from distance if omitted. */
    duration?: number;
  } = {}): void {
    // Inputs (targetPos from a raycast hit, cam.position) are in the residual
    // render frame under the floating origin; convert to ABSOLUTE so the Bezier
    // endpoints + focus stay consistent. The per-frame _rebaseToResidual re-
    // residualises during the flight. R≡0 when inactive ⇒ identity.
    const r = Broker.getSceneRebase(this._r);
    const target = targetPos.clone().add(r);
    const startPos = this.cam.position.clone().add(r);
    const targetCamDist = opts.targetCamDist ?? Game.data.camDist;
    const targetZoomLevel = opts.targetZoomLevel ?? Game.data.targetZoom;

    // End position: orbital position around target preserving the camera's
    // current angular orientation (theta/phi). This avoids unexpected
    // azimuthal swings on arrival — the camera lands looking from the same
    // general direction it was already pointing.
    const sinPhi = Math.sin(this.phi);
    const cosPhi = Math.cos(this.phi);
    const sinTheta = Math.sin(this.theta);
    const cosTheta = Math.cos(this.theta);
    const endPos = new Vector3(
      target.x + targetCamDist * sinPhi * cosTheta,
      target.y + targetCamDist * cosPhi,
      target.z + targetCamDist * sinPhi * sinTheta,
    );

    // Control point: midpoint of start/end, lifted along +Y by 30% of the
    // travel distance so the arc rises over the disc plane during flight.
    const travelDist = startPos.distanceTo(endPos);
    const controlPoint = new Vector3()
      .addVectors(startPos, endPos).multiplyScalar(0.5);
    controlPoint.y += travelDist * 0.30;

    // Duration: bounded by distance / nominal-speed. 8000 WU/s feels right
    // at galactic scale; shorter local hops still get a minimum 0.6s so the
    // motion reads as deliberate rather than snap.
    const duration = opts.duration ?? Math.min(5.0, Math.max(0.6, travelDist / 8000));

    this.flightState = {
      startTime: performance.now() / 1000,
      duration,
      startPos,
      endPos,
      controlPoint,
      startLook: new Vector3(this.focus.x, this.focus.y, this.focus.z),
      endLook: target.clone(),
      endZoomLevel: targetZoomLevel,
    };

    // Set the orbit-mode focus target immediately so when the flight ends
    // and hands back to orbit math, the focus is already where we want.
    Game.data.camFocusTarget = { x: target.x, y: target.y, z: target.z };
    // Drop any active object tracking during flight (the destination is
    // a position, not an object; if the user wants to lock on, they can
    // dblclick after landing).
    this.trackedObject = null;
    this.focusScale = 1.0;
  }

  /** Abort flight immediately, leaving the camera in its current state.
   *  Used when user-initiated input (drag/zoom) should preempt the flight. */
  cancelFlight(): void {
    if (this.flightState) {
      // Hand off to orbit mode at current position
      this._snapOrbitStateToCurrentPos();
      this.flightState = null;
    }
  }

  /** Compute theta/phi/focus that would reproduce the current camera
   *  position via the orbital math. Called on flight completion and
   *  flight cancellation to seamlessly continue in orbit mode. */
  private _snapOrbitStateToCurrentPos(): void {
    const fx = Game.data.camFocusTarget?.x ?? 0;
    const fy = Game.data.camFocusTarget?.y ?? 0;
    const fz = Game.data.camFocusTarget?.z ?? 0;
    // cam.position is in the residual render frame; focus is absolute. Reconstruct
    // the absolute camera position (camAbs = cam.position + R) before deriving the
    // orbit angles/distance. R≡0 when the floating origin is inactive.
    const r = Broker.getSceneRebase(this._r);
    const dx = (this.cam.position.x + r.x) - fx;
    const dy = (this.cam.position.y + r.y) - fy;
    const dz = (this.cam.position.z + r.z) - fz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const phi = Math.acos(Math.max(-1, Math.min(1, dy / dist)));
    const theta = Math.atan2(dz, dx);
    this.theta = theta;
    this.phi = phi;
    this.focus.x = fx; this.focus.y = fy; this.focus.z = fz;
    Game.data.targetTheta = theta;
    Game.data.targetPhi = phi;
  }

  constructor(cam: PerspectiveCamera) {
    this.cam = cam;

    // Stop tracking on deselect / Escape so the camera doesn't keep
    // chasing the previous focus after the user dismisses it.
    Events.on('select:clear', () => {
      this.trackedObject = null;
    });
  }

  /**
   * Set camFocusTarget directly — no transition animation.
   * The per-frame lerp (0.05) provides all the smoothing needed.
   * Clears any active object tracking — explicit position wins.
   */
  focusOn(x: number, y: number, z: number): void {
    this.trackedObject = null;
    this.focusScale = 1.0;
    // Callers pass a re-rooted render-frame position (from a raycast hit); store
    // it ABSOLUTE so the orbit math + rebase stay consistent. R≡0 when inactive.
    const r = Broker.getSceneRebase(this._r);
    Game.data.camFocusTarget = { x: x + r.x, y: y + r.y, z: z + r.z };
  }

  /**
   * Lock the camera onto an Object3D — its world position becomes the
   * focus target every frame. Use for "double-click to follow object."
   * Pass null to release.
   */
  trackObject(obj: Object3D | null): void {
    this.trackedObject = obj;
    if (obj) {
      // Seed the focus target immediately so the first frame doesn't
      // lurch from wherever the camera previously was.
      obj.getWorldPosition(this._trackPos);
      // Un-residual the render-frame position to ABSOLUTE (floating origin; see
      // the tracking refresh in update()). R≡0 when inactive.
      const rb = Broker.getSceneRebase(this._r);
      Game.data.camFocusTarget = {
        x: this._trackPos.x + rb.x, y: this._trackPos.y + rb.y, z: this._trackPos.z + rb.z,
      };
      // Derive close-tier scale factor from the body's geometry radius.
      const r = (obj.userData?.bodyRadius as number | undefined) ?? FOCUS_REFERENCE_RADIUS;
      this.focusScale = Math.max(0.1, r / FOCUS_REFERENCE_RADIUS);
    } else {
      this.focusScale = 1.0;
    }
  }

  update(dt: number): void {
    const data = Game.data;

    // ── Flight Mode ──
    // When mid-flight, override orbit-mode math with Bezier-eased
    // trajectory. Camera translates along the arc, looks at the target,
    // and on arrival hands back to orbit mode.
    if (this.flightState) {
      const fs = this.flightState;
      const nowSec = performance.now() / 1000;
      const tRaw = Math.min(1, (nowSec - fs.startTime) / fs.duration);
      // Ease-in-out cubic — gentle acceleration + deceleration at endpoints,
      // cruise speed in the middle. Matches the "settled moments" rhythm
      // observed in the ESA reference fly-throughs.
      const t = tRaw < 0.5 ? 4 * tRaw * tRaw * tRaw
                           : 1 - Math.pow(-2 * tRaw + 2, 3) / 2;

      // Quadratic Bezier: B(t) = (1-t)²·P0 + 2(1-t)t·P1 + t²·P2
      const it = 1 - t;
      this.cam.position.set(
        it * it * fs.startPos.x + 2 * it * t * fs.controlPoint.x + t * t * fs.endPos.x,
        it * it * fs.startPos.y + 2 * it * t * fs.controlPoint.y + t * t * fs.endPos.y,
        it * it * fs.startPos.z + 2 * it * t * fs.controlPoint.z + t * t * fs.endPos.z,
      );

      // Look target eases from start-focus → end-focus along the same curve.
      this._flightTmp.copy(fs.startLook).lerp(fs.endLook, t);
      this.cam.lookAt(this._flightTmp);

      // Frustum stays in sync with the new camDist range; we approximate
      // dist as camera→target so near/far don't clip mid-flight.
      const distToTarget = this.cam.position.distanceTo(this._flightTmp);
      this.cam.near = distToTarget * 0.001; // proportional (U4 — see orbit branch)
      this.cam.far = distToTarget * 100;
      const targetFov = fovForDistance(distToTarget);
      this.cam.fov += (targetFov - this.cam.fov) * FOV_LERP;
      setIconFov(this.cam.fov);
      this.cam.updateProjectionMatrix();

      // Floating origin: rebase the absolute Bezier pose to the residual render
      // frame (see _rebaseToResidual). Before _trackVelocity and the arrival snap.
      this._rebaseToResidual(this._flightTmp.x, this._flightTmp.y, this._flightTmp.z);

      // Velocity from the f64 authoritative anchor (drives star streaks).
      this._trackVelocity(dt);

      // Arrival: set orbital state to match landing position, hand off.
      if (tRaw >= 1) {
        data.targetZoom = fs.endZoomLevel;
        data.zoomLevel = fs.endZoomLevel;
        this._snapOrbitStateToCurrentPos();
        this.flightState = null;
      }
      Game.updateZoomDomain();
      return;
    }

    // ── Tracking ──
    // If the camera is locked onto an object, refresh focus target from
    // its current world position before the focus lerp runs.
    if (this.trackedObject) {
      // getWorldPosition() is in the RE-ROOTED render frame (shifted by −R under
      // the floating origin); add R back so camFocusTarget is ABSOLUTE — the frame
      // the orbit math + the rebase work in. The R that re-rooted the graph last
      // frame cancels exactly, so a tracked camera does NOT oscillate. (three.js
      // composes matrixWorld in JS float64, and the residual is small, so the
      // read is precise.) R≡0 when inactive ⇒ identity.
      this.trackedObject.getWorldPosition(this._trackPos);
      const r = Broker.getSceneRebase(this._r);
      data.camFocusTarget = {
        x: this._trackPos.x + r.x, y: this._trackPos.y + r.y, z: this._trackPos.z + r.z,
      };
    }

    // ── Orbit Angle Interpolation (lerp 0.1) ──
    this.theta += (data.targetTheta - this.theta) * ORBIT_LERP;
    this.phi += (data.targetPhi - this.phi) * ORBIT_LERP;

    // ── Zoom Interpolation (lerp 0.06) ──
    data.zoomLevel += (data.targetZoom - data.zoomLevel) * ZOOM_LERP;

    // Derive camera distance from piecewise curve. Close-in tiers
    // (surface / low-orbit / orbit) multiply by focusScale so the
    // framing is proportional to the focused body's actual radius.
    const baseDist = getCamDist(data.zoomLevel);
    data.camDist = baseDist * focusScaleMultiplier(data.zoomLevel, this.focusScale);

    // ── Focus Interpolation (lerp 0.05) ──
    if (data.camFocusTarget) {
      this.focus.x += (data.camFocusTarget.x - this.focus.x) * FOCUS_LERP;
      this.focus.y += (data.camFocusTarget.y - this.focus.y) * FOCUS_LERP;
      this.focus.z += (data.camFocusTarget.z - this.focus.z) * FOCUS_LERP;
    }

    // ── Position camera on orbital sphere ──
    const dist = data.camDist;
    const sinPhi = Math.sin(this.phi);
    const cosPhi = Math.cos(this.phi);
    const sinTheta = Math.sin(this.theta);
    const cosTheta = Math.cos(this.theta);

    this.cam.position.set(
      this.focus.x + dist * sinPhi * cosTheta,
      this.focus.y + dist * cosPhi,
      this.focus.z + dist * sinPhi * sinTheta,
    );
    this.cam.lookAt(this.focus.x, this.focus.y, this.focus.z);

    // Dynamic near/far planes — PROPORTIONAL to camDist (no absolute floors).
    // Scale-unification U4: camDist now spans ~1e-6 WU (a planet at true scale)
    // to ~3.6e7 WU (the galaxy), so the old 0.01/1000 WU floors would swallow
    // the whole scene at the system tier. Proportional planes bracket whatever
    // is framed; the logarithmic depth buffer (renderer) keeps the ratio
    // resolvable. ~1e5 near/far ratio, matched to the old close-tier behaviour.
    this.cam.near = dist * 0.001;
    this.cam.far = dist * 100;

    // Adaptive focal length — FOV lerps toward distance-derived target.
    // FOV_LERP (0.08) keeps the change smooth and noticeable without
    // inducing motion sickness on rapid zoom transitions.
    const targetFov = fovForDistance(dist);
    this.cam.fov += (targetFov - this.cam.fov) * FOV_LERP;
    // Keep the icon-system in sync so screen-pixel-sized icons stay correct
    setIconFov(this.cam.fov);

    this.cam.updateProjectionMatrix();

    // Floating origin: rebase the absolute pose to the residual render frame
    // (camera → ≈origin; world translated −R). Pixel-identical; keeps GPU coords
    // small. Before _trackVelocity so the anchor reads the absolute position.
    this._rebaseToResidual(this.focus.x, this.focus.y, this.focus.z);

    // Camera velocity from the f64 authoritative anchor (see _trackVelocity).
    this._trackVelocity(dt);

    // Update zoom domain
    Game.updateZoomDomain();
  }
}
