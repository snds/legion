import { describe, it, expect } from 'vitest';
import { PerspectiveCamera } from 'three';
import { createActiveRegions, MAX_FOOTPOINTS, MAX_REGIONS } from './active-regions';
import type { StarRecord } from './star-physics';

const ACTIVE_M: StarRecord = {
  tempK: 3200, radiusSolar: 0.3, luminositySolar: 0.02, activity: 0.9,
  spectralType: 'M', seed: 4242,
};
const QUIET_OB: StarRecord = {
  tempK: 30000, radiusSolar: 8, luminositySolar: 20000, activity: 0.03,
  spectralType: 'O', seed: 99,
};

describe('createActiveRegions', () => {
  it('an active dwarf gets bipolar footpoints (even count) + a loop/CME group', () => {
    const f = createActiveRegions(ACTIVE_M, 0.6);
    expect(f.footCount).toBeGreaterThan(0);
    expect(f.footCount % 2).toBe(0);                 // spots come in pairs
    expect(f.footCount).toBeLessThanOrEqual(MAX_FOOTPOINTS);
    expect(f.footCount).toBeLessThanOrEqual(MAX_REGIONS * 2);
    expect(f.group.children.length).toBeGreaterThan(0);
    // Footpoint directions are unit vectors on the sphere.
    for (let i = 0; i < f.footCount; i++) {
      const x = f.footDir[i * 3], y = f.footDir[i * 3 + 1], z = f.footDir[i * 3 + 2];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 4);
      expect(f.footStr[i]).toBeGreaterThan(0);
    }
    f.dispose();
  });

  it('a quiet O/B star produces no active regions', () => {
    const f = createActiveRegions(QUIET_OB, 2);
    expect(f.footCount).toBe(0);
    expect(f.group.children.length).toBe(0);
    f.dispose();
  });

  it('is deterministic from the record seed', () => {
    const a = createActiveRegions(ACTIVE_M, 0.6);
    const b = createActiveRegions(ACTIVE_M, 0.6);
    expect(b.footCount).toBe(a.footCount);
    expect(Array.from(b.footDir)).toEqual(Array.from(a.footDir));
    a.dispose(); b.dispose();
  });

  it('update() runs without throwing', () => {
    const f = createActiveRegions(ACTIVE_M, 0.6);
    expect(() => f.update(1.5, new PerspectiveCamera(), 1)).not.toThrow();
    f.dispose();
  });
});
