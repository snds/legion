import { describe, expect, it } from 'vitest';
import { Vector3, PerspectiveCamera } from 'three';
import {
  APPROACH_FLIGHT_FULL_AU,
  APPROACH_FLIGHT_START_AU,
  approachFlightBlend,
  applyApproachFlightCamera,
  resetApproachFlightSticky,
} from './approach-camera';
import { texResCoarseForLevel, texResStreamForLevel, texResForLevel } from './chunk-types';

describe('approach flight camera (C4)', () => {
  it('blends from orbit nadir into atmosphere flight', () => {
    expect(approachFlightBlend(0.8)).toBe(0);
    expect(approachFlightBlend(APPROACH_FLIGHT_START_AU)).toBe(0);
    expect(approachFlightBlend(APPROACH_FLIGHT_FULL_AU)).toBe(1);
    expect(approachFlightBlend(0.2)).toBeGreaterThan(0.3);
    expect(approachFlightBlend(0.2)).toBeLessThan(1);
  });

  it('never rolls camera.up off world +Y (poles-on-equator bug)', () => {
    resetApproachFlightSticky();
    const cam = new PerspectiveCamera(50, 1, 0.01, 100);
    cam.position.set(0, 0, 1.15);
    // Simulate prior bug state: radial up left behind after a close pass.
    cam.up.set(0, 0, 1);
    cam.lookAt(0, 0, 0);
    applyApproachFlightCamera(cam, new Vector3(0, 0, 0), 0.08);
    expect(cam.up.x).toBeCloseTo(0, 5);
    expect(cam.up.y).toBeCloseTo(1, 5);
    expect(cam.up.z).toBeCloseTo(0, 5);
    // Zooming back out must also restore world up.
    applyApproachFlightCamera(cam, new Vector3(0, 0, 0), 0.8);
    expect(cam.up.y).toBeCloseTo(1, 5);
  });

  it('tilts look away from planet centre when close', () => {
    resetApproachFlightSticky();
    const cam = new PerspectiveCamera(50, 1, 0.01, 100);
    cam.position.set(0, 0, 1.15);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    applyApproachFlightCamera(cam, new Vector3(0, 0, 0), 0.08);
    const after = new Vector3();
    cam.getWorldDirection(after);
    // No longer pointing straight at the origin (nadir).
    expect(after.dot(new Vector3(0, 0, -1))).toBeLessThan(0.92);
    expect(cam.fov).toBeLessThan(50);
  });

  // P2-19 Part 2 — the two tests above use dist≈1.15× radius (implicit,
  // radius never passed), i.e. literally skimming the surface. Real
  // SURFACE-tier zoom frames a body from ~5 body-radii out (getCamDist's
  // SURFACE range × focusScaleMultiplier), not ~1.15× — a fixed-angle
  // deviation that's invisible when the body fills most of the sky (1.15×)
  // throws the look target completely off a body's small ~11° disc at 5×.
  // This was the actual root cause of Helheim/Earth not rendering even
  // after the P2-19 race-condition fix (see approach-camera.ts's
  // `worldRadius` param doc). Regression-pin the fix: the body must always
  // stay within a margin of its own visible angular extent, regardless of
  // the horizon-flight blend `t`.
  it('stays within the body\'s visible disc at real SURFACE-tier distance (~5 radii), not just near-literal-surface', () => {
    resetApproachFlightSticky();
    const radius = 0.3; // typical authored rocky-body size (Earth/Helheim both use this)
    const dist = radius * 5; // SURFACE-tier framing, not the 1.15x "skimming" case above
    const cam = new PerspectiveCamera(23, 1, 0.01, 100);
    cam.position.set(0, 0, dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    const stickyEast = new Vector3(1, 0, 0);
    // 0.155 AU ≈ the real physicalAuFromZoom() value at SURFACE-tier zoom
    // (ZOOM_STEPS[0]) — deep enough into the atmosphere-flight blend
    // (t ≈ 0.79) to have thrown the look target ~61° off-body pre-fix.
    applyApproachFlightCamera(cam, new Vector3(0, 0, 0), 0.155, stickyEast, radius);

    const dir = new Vector3();
    cam.getWorldDirection(dir);
    const toCenter = new Vector3(0, 0, 0).sub(cam.position).normalize();
    const angleDeg = Math.acos(Math.max(-1, Math.min(1, dir.dot(toCenter)))) * 180 / Math.PI;
    const halfAngleDeg = Math.atan(radius / dist) * 180 / Math.PI; // body's own angular half-size
    const maxDeviationDeg = halfAngleDeg * 0.7; // the fix's clamp margin

    // The whole point of the fix: correctness over exact feel — the body
    // must stay in view, landing at (not past) the clamp boundary given the
    // unclamped blend would otherwise overshoot by tens of degrees.
    expect(angleDeg).toBeLessThanOrEqual(maxDeviationDeg + 0.5);
    expect(angleDeg).toBeGreaterThan(maxDeviationDeg - 0.5);
    // Still a real deviation from pure nadir — some horizon-look flavor survives.
    expect(angleDeg).toBeGreaterThan(0.5);
  });

  // P2-17 — moons are the first bodies to drive this camera at a genuinely
  // different scale than anything routed so far (catalogue MoonConfig.size
  // 0.075-0.30, star-catalog.ts SOL_MOONS/EPS_ERI_MOONS). The clamp math is
  // entirely worldRadius/dist RATIOS (dimensionless — see approach-camera.ts
  // worldRadius param doc), so nothing here is expected to behave
  // differently at moon scale than at the radius=0.3 SURFACE-tier test
  // above; this pins that down as a verified fact, not an assumption,
  // before any moon ever drives the real camera (P2-18).
  it('stays within the visible disc at SURFACE-tier distance across the full catalogue moon size range', () => {
    // Luna (0.08), Europa (0.075, smallest catalogued moon), Io/Ganymede/
    // Titan (~0.09-0.12), Thrym (0.30, largest catalogued moon).
    for (const radius of [0.075, 0.08, 0.12, 0.30]) {
      resetApproachFlightSticky();
      const dist = radius * 5; // SURFACE-tier framing (same ratio as the planet-scale test above)
      const cam = new PerspectiveCamera(23, 1, 0.01, 100);
      cam.position.set(0, 0, dist);
      cam.up.set(0, 1, 0);
      cam.lookAt(0, 0, 0);
      const stickyEast = new Vector3(1, 0, 0);
      applyApproachFlightCamera(cam, new Vector3(0, 0, 0), 0.155, stickyEast, radius);

      expect(Number.isFinite(cam.position.x + cam.position.y + cam.position.z)).toBe(true);
      const dir = new Vector3();
      cam.getWorldDirection(dir);
      expect(Number.isFinite(dir.x + dir.y + dir.z)).toBe(true);
      expect(dir.length()).toBeGreaterThan(0.99); // still a real unit direction, not degenerate

      const toCenter = new Vector3(0, 0, 0).sub(cam.position).normalize();
      const angleDeg = Math.acos(Math.max(-1, Math.min(1, dir.dot(toCenter)))) * 180 / Math.PI;
      const halfAngleDeg = Math.atan(radius / dist) * 180 / Math.PI;
      const maxDeviationDeg = halfAngleDeg * 0.7;
      expect(angleDeg).toBeLessThanOrEqual(maxDeviationDeg + 0.5);
    }
  });

  // Sweep the FULL approach-flight blend range (orbit → full atmosphere
  // flight) at a single representative moon radius — catches any NaN/
  // inversion that only shows up partway through the blend, not just at
  // the single viewAu snapshot the size-range test above uses.
  it('stays finite and in-disc across the whole approach blend at moon scale (Luna-sized, 0.08)', () => {
    const radius = 0.08;
    const dist = radius * 5;
    const viewAus = [
      APPROACH_FLIGHT_START_AU, // t = 0, orbit nadir
      (APPROACH_FLIGHT_START_AU + APPROACH_FLIGHT_FULL_AU) / 2, // t ≈ 0.5
      APPROACH_FLIGHT_FULL_AU, // t = 1, full flight
      APPROACH_FLIGHT_FULL_AU * 0.5, // past full — blend still clamps to 1, not beyond
    ];
    const stickyEast = new Vector3(1, 0, 0);
    resetApproachFlightSticky();
    for (const viewAu of viewAus) {
      const cam = new PerspectiveCamera(23, 1, 0.01, 100);
      cam.position.set(0, 0, dist);
      cam.up.set(0, 1, 0);
      cam.lookAt(0, 0, 0);
      applyApproachFlightCamera(cam, new Vector3(0, 0, 0), viewAu, stickyEast, radius);

      expect(Number.isFinite(cam.position.x + cam.position.y + cam.position.z)).toBe(true);
      expect(Number.isFinite(cam.fov)).toBe(true);
      const dir = new Vector3();
      cam.getWorldDirection(dir);
      expect(Number.isFinite(dir.x + dir.y + dir.z)).toBe(true);

      const toCenter = new Vector3(0, 0, 0).sub(cam.position).normalize();
      const angleDeg = Math.acos(Math.max(-1, Math.min(1, dir.dot(toCenter)))) * 180 / Math.PI;
      const halfAngleDeg = Math.atan(radius / dist) * 180 / Math.PI;
      expect(angleDeg).toBeLessThanOrEqual(halfAngleDeg * 0.7 + 0.5);
    }
  });
});

describe('stream bake masks', () => {
  it('stream tex res is cheaper than coarse/full', () => {
    for (const L of [2, 4, 7]) {
      expect(texResStreamForLevel(L)).toBeLessThanOrEqual(texResCoarseForLevel(L));
      expect(texResStreamForLevel(L)).toBeLessThan(texResForLevel(L));
      expect(texResStreamForLevel(L)).toBeLessThanOrEqual(32);
    }
  });
});
