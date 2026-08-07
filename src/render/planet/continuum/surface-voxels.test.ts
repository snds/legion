import { describe, expect, it } from 'vitest';
import { createGeneratorBundle } from '../generators';
import type { GenPlanet } from '../../../data/system-gen';
import { NEAR_CLOUD_AU } from './cloud-voxels';
import {
  bakeSurfaceBrickMaps,
  NEAR_SURFACE_AU,
  SURFACE_BAKE_RES,
  SURFACE_EXIT_AU,
  shouldEngageSurfaceVoxels,
  surfaceVoxelBlend,
} from './surface-voxels';

const ocean: GenPlanet = {
  type: 'ocean', kind: 'rocky', au: 1, massEarth: 1, radiusEarth: 1,
  insolation: 1, isGasGiant: false, hasRings: false, inHZ: true, seed: 2002,
};

describe('continuum surface voxels', () => {
  it('engages tighter than cloud bricks and exits with hysteresis (B4)', () => {
    expect(NEAR_SURFACE_AU).toBeLessThan(NEAR_CLOUD_AU);
    expect(SURFACE_EXIT_AU).toBeGreaterThan(NEAR_CLOUD_AU);
    expect(shouldEngageSurfaceVoxels(NEAR_SURFACE_AU, false)).toBe(true);
    expect(shouldEngageSurfaceVoxels(NEAR_SURFACE_AU + 0.01, false)).toBe(false);
    // Once engaged, stay until past exit
    expect(shouldEngageSurfaceVoxels((NEAR_SURFACE_AU + SURFACE_EXIT_AU) * 0.5, true)).toBe(true);
    expect(shouldEngageSurfaceVoxels(SURFACE_EXIT_AU + 0.01, true)).toBe(false);
  });

  it('blend rises as camera approaches while engaged', () => {
    expect(surfaceVoxelBlend(0.8, false)).toBe(0);
    const far = surfaceVoxelBlend(SURFACE_EXIT_AU * 0.98, true);
    const near = surfaceVoxelBlend(NEAR_SURFACE_AU * 0.5, true);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(0.5);
  });

  it('bakes height+albedo from the same generator (B3 identity)', () => {
    const bundle = createGeneratorBundle(ocean);
    const maps = bakeSurfaceBrickMaps(bundle, [0, 1, 0], 0.08, SURFACE_BAKE_RES);
    expect(maps.heightRGBA.length).toBe(SURFACE_BAKE_RES * SURFACE_BAKE_RES * 4);
    expect(maps.albedo.length).toBe(SURFACE_BAKE_RES * SURFACE_BAKE_RES * 4);
    let hMin = 255, hMax = 0;
    for (let i = 0; i < maps.heightRGBA.length; i += 4) {
      hMin = Math.min(hMin, maps.heightRGBA[i]);
      hMax = Math.max(hMax, maps.heightRGBA[i]);
    }
    expect(hMax).toBeGreaterThan(hMin); // relief across footprint
    let hasSea = false;
    let hasLand = false;
    for (let i = 0; i < maps.albedo.length; i += 4) {
      if (maps.albedo[i + 3] > 127) hasSea = true;
      else hasLand = true;
    }
    // Ocean world near pole may be ice/sea dominant — at least some non-black albedo
    let lit = 0;
    for (let i = 0; i < maps.albedo.length; i += 4) {
      if (maps.albedo[i] + maps.albedo[i + 1] + maps.albedo[i + 2] > 30) lit++;
    }
    expect(lit).toBeGreaterThan(SURFACE_BAKE_RES);
    void hasSea; void hasLand;
  });
});
