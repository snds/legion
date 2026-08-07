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
