// Physical galaxy generator — the NEW global star-set sampling (no sectors). Locks determinism and the
// load-bearing behaviour: the spiral arms genuinely CONCENTRATE disc stars onto the density-wave ridges
// (vs a smooth disc), so the structure emerges from the model rather than being painted.

import { describe, it, expect } from 'vitest';
import { samplePhysicalGalaxy, DEFAULT_PHYSICAL_CONFIG, type PhysicalGalaxyData } from './galaxy-physical';

const meanCrest = (d: PhysicalGalaxyData): number => {
  let s = 0;
  for (let i = 0; i < d.count; i++) s += d.crests[i]!;
  return s / d.count;
};

describe('samplePhysicalGalaxy', () => {
  it('is deterministic for a seed', () => {
    const a = samplePhysicalGalaxy({ ...DEFAULT_PHYSICAL_CONFIG, count: 5000 }, 7);
    const b = samplePhysicalGalaxy({ ...DEFAULT_PHYSICAL_CONFIG, count: 5000 }, 7);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
  });

  it('the density wave concentrates disc stars onto arm ridges (vs a smooth disc)', () => {
    const armed = samplePhysicalGalaxy({ ...DEFAULT_PHYSICAL_CONFIG, count: 40000, armContrast: 0.9 }, 3);
    const smooth = samplePhysicalGalaxy({ ...DEFAULT_PHYSICAL_CONFIG, count: 40000, armContrast: 0 }, 3);
    expect(meanCrest(armed)).toBeGreaterThan(meanCrest(smooth) * 1.3);
  });

  it('produces a centrally-concentrated disc within the radial cutoff', () => {
    const d = samplePhysicalGalaxy({ ...DEFAULT_PHYSICAL_CONFIG, count: 20000 }, 1);
    let within = 0;
    let rMax = 0;
    const KPC_TO_WU = 1e6;
    for (let i = 0; i < d.count; i++) {
      const x = d.positions[i * 3]!;
      const z = d.positions[i * 3 + 2]!;
      const Rkpc = Math.hypot(x, z) / KPC_TO_WU;
      if (Rkpc < 8) within++; // most stars inside ~1 disc scale-radius region
      rMax = Math.max(rMax, Rkpc);
    }
    expect(within / d.count).toBeGreaterThan(0.6); // exponential disc ⇒ centrally concentrated
    expect(rMax).toBeLessThanOrEqual(DEFAULT_PHYSICAL_CONFIG.rMax_kpc + 0.01); // radial cutoff honoured
  });
});
