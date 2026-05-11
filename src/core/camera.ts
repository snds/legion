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
import { Game, getCamDist } from './state';
import { Events } from './events';
import { setIconFov } from '../render/icon-system';

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
    Game.data.camFocusTarget = { x, y, z };
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
      Game.data.camFocusTarget = { x: this._trackPos.x, y: this._trackPos.y, z: this._trackPos.z };
    }
  }

  update(_dt: number): void {
    const data = Game.data;

    // ── Tracking ──
    // If the camera is locked onto an object, refresh focus target from
    // its current world position before the focus lerp runs.
    if (this.trackedObject) {
      this.trackedObject.getWorldPosition(this._trackPos);
      data.camFocusTarget = { x: this._trackPos.x, y: this._trackPos.y, z: this._trackPos.z };
    }

    // ── Orbit Angle Interpolation (lerp 0.1) ──
    this.theta += (data.targetTheta - this.theta) * ORBIT_LERP;
    this.phi += (data.targetPhi - this.phi) * ORBIT_LERP;

    // ── Zoom Interpolation (lerp 0.06) ──
    data.zoomLevel += (data.targetZoom - data.zoomLevel) * ZOOM_LERP;

    // Derive camera distance from piecewise curve
    data.camDist = getCamDist(data.zoomLevel);

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

    // Dynamic near/far planes based on zoom
    this.cam.near = Math.max(0.01, dist * 0.001);
    this.cam.far = Math.max(1000, dist * 100);

    // Adaptive focal length — FOV lerps toward distance-derived target.
    // FOV_LERP (0.08) keeps the change smooth and noticeable without
    // inducing motion sickness on rapid zoom transitions.
    const targetFov = fovForDistance(dist);
    this.cam.fov += (targetFov - this.cam.fov) * FOV_LERP;
    // Keep the icon-system in sync so screen-pixel-sized icons stay correct
    setIconFov(this.cam.fov);

    this.cam.updateProjectionMatrix();

    // Update zoom domain
    Game.updateZoomDomain();
  }
}
