// sampleRealisticStar — the resolved-star census used by sector stars. Asserts the two
// properties the look depends on: determinism (seeded → reproducible) and the realistic
// type skew (the overwhelming majority are small red/orange dwarfs, not white pinpricks).

import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../data/system-gen';
import { sampleRealisticStar } from './stellar-population';

describe('sampleRealisticStar', () => {
  it('is deterministic for a given seeded rand stream', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 50; i++) {
      expect(sampleRealisticStar(a)).toEqual(sampleRealisticStar(b));
    }
  });

  it('returns in-gamut [r,g,b] and positive pinpoint sizes', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 2000; i++) {
      const [r, g, b, sz] = sampleRealisticStar(rand);
      for (const c of [r, g, b]) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
      expect(sz).toBeGreaterThan(0);
      expect(sz).toBeLessThan(4); // pinpoints — far smaller than the old 6.5px backdrop mix
    }
  });

  it('is dominated by red/orange dwarfs (the true census), not white/blue', () => {
    const rand = mulberry32(99);
    let reddish = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const [, , b] = sampleRealisticStar(rand);
      if (b < 0.7) reddish++; // M/K/G-ish — warm, low blue
    }
    expect(reddish / N).toBeGreaterThan(0.8); // ≳ M(73%)+K(12%) are warm-dominant
  });

  it('still produces rare bright blue stars (A / B / O)', () => {
    const rand = mulberry32(42);
    let blue = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const [r, , b] = sampleRealisticStar(rand);
      if (b >= 0.99 && r < 0.95) blue++; // blue-white / blue: full blue channel, reduced red
    }
    expect(blue).toBeGreaterThan(0);
    expect(blue / N).toBeLessThan(0.05); // but rare
  });
});
