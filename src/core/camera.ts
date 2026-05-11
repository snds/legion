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

import { PerspectiveCamera, MathUtils } from 'three';
import { Game, getCamDist } from './state';
import { Events } from './events';

// ── Lerp Factors (monolithic prototype values) ──────────────────

const ZOOM_LERP = 0.06;
const ORBIT_LERP = 0.1;
const FOCUS_LERP = 0.05;

export class CameraController {
  private cam: PerspectiveCamera;
  private theta = 0.4;      // current azimuth angle (smoothed)
  private phi = 1.4;         // current polar angle (smoothed)
  private focus = { x: 0, y: 0, z: 0 };

  // ── Tracking State ──
  private trackingEid: number | null = null;

  constructor(cam: PerspectiveCamera) {
    this.cam = cam;

    // Listen for entity selection to enable tracking
    Events.on('select:entity', (data: { eid: number; type: number }) => {
      this.trackingEid = data.eid;
    });

    Events.on('select:clear', () => {
      this.trackingEid = null;
    });
  }

  /**
   * Set camFocusTarget directly — no transition animation.
   * The per-frame lerp (0.05) provides all the smoothing needed.
   */
  focusOn(x: number, y: number, z: number): void {
    Game.data.camFocusTarget = { x, y, z };
  }

  update(_dt: number): void {
    const data = Game.data;

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
    this.cam.updateProjectionMatrix();

    // Update zoom domain
    Game.updateZoomDomain();
  }
}
