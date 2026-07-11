import { describe, it, expect } from 'vitest';
import { generateRings, densityAt, densityLUT } from './rings';

describe('generateRings', () => {
  it('is deterministic from the seed', () => {
    const a = generateRings(4242, true);
    const b = generateRings(4242, true);
    expect(a).toEqual(b);
  });

  it('giants get broader, denser systems than terrestrials', () => {
    const giant = generateRings(1, true);
    const terra = generateRings(1, false);
    expect(giant.outerRadius - giant.innerRadius).toBeGreaterThan(terra.outerRadius - terra.innerRadius);
  });

  it('starts outside the Roche-ish limit', () => {
    const r = generateRings(99, true);
    expect(r.innerRadius).toBeGreaterThan(1); // never inside the planet
  });

  it('produces ordered, non-overlapping bands within the disc', () => {
    const r = generateRings(555, true);
    expect(r.bands.length).toBeGreaterThan(0);
    let prevOuter = r.innerRadius - 1e-6;
    for (const b of r.bands) {
      expect(b.inner).toBeGreaterThanOrEqual(prevOuter - 1e-9);
      expect(b.outer).toBeGreaterThan(b.inner);
      expect(b.outer).toBeLessThanOrEqual(r.outerRadius + 1e-6);
      expect(b.density).toBeGreaterThan(0);
      expect(b.density).toBeLessThanOrEqual(1);
      prevOuter = b.outer;
    }
  });
});

describe('samplable density (Decision 5)', () => {
  it('is zero outside the disc and returns a band density inside', () => {
    const r = generateRings(7, true);
    expect(densityAt(r, r.innerRadius - 0.5)).toBe(0);
    expect(densityAt(r, r.outerRadius + 0.5)).toBe(0);
    const mid = (r.bands[0].inner + r.bands[0].outer) / 2;
    expect(densityAt(r, mid)).toBeCloseTo(r.bands[0].density, 5);
  });

  it('reads zero inside a Cassini gap between two bands', () => {
    const r = generateRings(31, true);
    if (r.bands.length >= 2) {
      const gapMid = (r.bands[0].outer + r.bands[1].inner) / 2;
      if (gapMid > r.bands[0].outer && gapMid < r.bands[1].inner) {
        expect(densityAt(r, gapMid)).toBe(0);
      }
    }
    expect(r.bands.length).toBeGreaterThan(0);
  });

  it('bakes a LUT of the requested length matching densityAt', () => {
    const r = generateRings(3, true);
    const lut = densityLUT(r, 64);
    expect(lut).toHaveLength(64);
    expect(lut[0]).toBeCloseTo(densityAt(r, r.innerRadius), 5);
    expect(lut[63]).toBeCloseTo(densityAt(r, r.outerRadius), 5);
  });
});
