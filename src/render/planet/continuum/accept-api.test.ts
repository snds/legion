import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { sunDirForPose } from './accept-api';

// sunFacing() = sun·view (both world-space unit vectors). These lock the
// pure math poseSun relies on: day/night/terminator must each reach their
// target sunFacing for ANY camera view direction, not just the default lab
// orbit angle. This is the fix for the F3 bug — planet yaw cannot move
// sunFacing (it never touches the camera or the sun), so posing must place
// the sun directly relative to the current view, which is what this proves.
describe('sunDirForPose', () => {
  const views = [
    new Vector3(0, 0, 1),
    new Vector3(1, 0, 0),
    new Vector3(0.6, 0.35, 0.72).normalize(),
    new Vector3(0, 1, 0), // near-pole view — exercises the terminator fallback axis
    new Vector3(-0.4, -0.8, 0.3).normalize(),
  ];

  it('day pose puts the sun toward the camera (sunFacing → +1)', () => {
    for (const view of views) {
      const sun = sunDirForPose('day', view);
      expect(sun.dot(view)).toBeCloseTo(1, 5);
      expect(sun.length()).toBeCloseTo(1, 5);
    }
  });

  it('night pose puts the sun away from the camera (sunFacing → -1)', () => {
    for (const view of views) {
      const sun = sunDirForPose('night', view);
      expect(sun.dot(view)).toBeCloseTo(-1, 5);
      expect(sun.length()).toBeCloseTo(1, 5);
    }
  });

  it('terminator pose puts the sun perpendicular to the view (sunFacing → 0)', () => {
    for (const view of views) {
      const sun = sunDirForPose('terminator', view);
      expect(sun.dot(view)).toBeCloseTo(0, 5);
      expect(sun.length()).toBeCloseTo(1, 5);
    }
  });
});
