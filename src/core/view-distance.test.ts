import { describe, it, expect } from 'vitest';
import { physicalDistancePc } from './state';
import { AU_PER_PC } from './metrics';

// U1: the physical view distance must be ONE continuous, monotonic curve over
// the whole zoom range — no jump at the old heliopause→sector seam (z≈0.60),
// which used to teleport 279 AU → 9.5 ly (a ~2000× discontinuity).

describe('physicalDistancePc — continuous physical view distance', () => {
  it('is monotonic increasing across the whole zoom range', () => {
    let prev = -1;
    for (let z = 0; z <= 1.0001; z += 0.005) {
      const d = physicalDistancePc(z);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
  });

  it('has no discontinuity at the old seam (z≈0.60) — adjacent samples stay within 1.6×', () => {
    // Sweep the void band densely; the worst-case step between adjacent frames
    // must be smooth (the old seam jumped ~2000× in one step).
    let worst = 1;
    for (let z = 0.5; z <= 0.85; z += 0.002) {
      const a = physicalDistancePc(z);
      const b = physicalDistancePc(z + 0.002);
      worst = Math.max(worst, b / a);
    }
    expect(worst).toBeLessThan(1.6);
  });

  it('reads the system frame below the void (AU-scale) and the unified frame above', () => {
    // Deep in a system: sub-AU to hundreds of AU.
    const auAtOuter = physicalDistancePc(0.5) * AU_PER_PC;
    expect(auAtOuter).toBeGreaterThan(10);
    expect(auAtOuter).toBeLessThan(2000);
    // Neighbourhood: a few parsecs. Galaxy: thousands.
    expect(physicalDistancePc(0.75)).toBeGreaterThan(1);      // pc
    expect(physicalDistancePc(1.0)).toBeGreaterThan(10_000);  // pc (tens of kpc)
  });

  it('crosses the void continuously — 279 AU regime hands off to the pc regime without a gap', () => {
    const belowVoid = physicalDistancePc(0.60) * AU_PER_PC; // AU at the heliopause edge
    const aboveVoid = physicalDistancePc(0.68) * AU_PER_PC; // AU well into the neighbourhood
    expect(belowVoid).toBeGreaterThan(100);   // hundreds of AU at the heliopause
    expect(aboveVoid).toBeGreaterThan(belowVoid * 100); // swept far out, but continuously (see monotonic test)
  });
});
