import { describe, it, expect } from 'vitest';
import { physicalDistancePc, getCamDist } from './state';
import { AU_PER_PC, WU_PER_PC, SYSTEM_TIER_SCALE } from './metrics';

// Scale unification: the physical view distance is ONE continuous, monotonic
// curve over the whole zoom range — the system tier now rides the unified
// metric (true scale) so there is no seam. Surface AU readings are preserved
// (AU_TO_WU_TRUE·AU_PER_PC = WU_PER_PC), sweeping continuously into ly and kpc.

describe('physicalDistancePc — continuous unified view distance', () => {
  it('is monotonic increasing across the whole zoom range', () => {
    let prev = -1;
    for (let z = 0; z <= 1.0001; z += 0.005) {
      const d = physicalDistancePc(z);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
  });

  it('no discontinuity anywhere — adjacent samples stay within 1.6× (was ~2000× at the old seam)', () => {
    let worst = 1;
    for (let z = 0; z <= 0.998; z += 0.002) {
      const a = physicalDistancePc(z);
      const b = physicalDistancePc(z + 0.002);
      worst = Math.max(worst, b / a);
    }
    expect(worst).toBeLessThan(1.6);
  });

  it('is C0-continuous at the system→geometric handoff (T_HELIO=0.60)', () => {
    const below = physicalDistancePc(0.5999);
    const above = physicalDistancePc(0.6001);
    expect(above / below).toBeLessThan(1.02); // essentially equal across the join
  });

  it('preserves surface AU reading (~0.06 AU) — the unified metric keeps system distances honest', () => {
    const auAtSurface = physicalDistancePc(0.0) * AU_PER_PC;
    expect(auAtSurface).toBeGreaterThan(0.03);
    expect(auAtSurface).toBeLessThan(0.12);
  });

  it('surface camDist is true-scale-tiny (~1e-4 WU), galaxy is ~1e7 WU', () => {
    expect(getCamDist(0)).toBeLessThan(1e-3);        // planet at true scale
    expect(getCamDist(0)).toBeGreaterThan(1e-6);
    expect(getCamDist(1.0)).toBeGreaterThan(1e6);    // full galaxy frame
  });

  it('sweeps AU → ly → kpc: system in AU, neighbourhood in pc, galaxy in thousands of pc', () => {
    expect(physicalDistancePc(0.3) * AU_PER_PC).toBeGreaterThan(0.01); // AU regime
    expect(physicalDistancePc(0.85)).toBeGreaterThan(1);               // pc (neighbourhood/arm)
    expect(physicalDistancePc(1.0)).toBeGreaterThan(10_000);           // pc (tens of kpc)
  });

  it('the whole world rides ONE metric: camDist ÷ WU_PER_PC is the physical distance', () => {
    for (const z of [0.1, 0.45, 0.62, 0.8, 0.95]) {
      expect(physicalDistancePc(z)).toBeCloseTo(getCamDist(z) / WU_PER_PC, 9);
    }
  });

  it('SYSTEM_TIER_SCALE is the true/legacy ratio', () => {
    expect(SYSTEM_TIER_SCALE).toBeCloseTo(0.004848 / 10, 6);
  });
});
