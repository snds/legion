// sampleRealisticStar — the resolved-star census used by sector stars. Asserts the two
// properties the look depends on: determinism (seeded → reproducible) and the realistic
// type skew (the overwhelming majority are small red/orange dwarfs, not white pinpricks).

import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../data/system-gen';
import { sampleArmStar, sampleRealisticStar } from './stellar-population';

// M dwarf is the only branch with r=1, low green, low blue; A/B-O are the blue tail (full blue, cut red).
const isM = (s: number[]) => s[0] === 1 && s[1]! < 0.63 && s[2]! < 0.45;
const isBlue = (s: number[]) => s[2]! >= 0.99 && s[0]! < 0.95;

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

describe('sampleArmStar — density-wave arm-phase bias', () => {
  it('at crestiness 0 is byte-identical to sampleRealisticStar (seam/determinism preserved)', () => {
    const a = mulberry32(2024);
    const b = mulberry32(2024);
    for (let i = 0; i < 300; i++) {
      expect(sampleArmStar(a, 0)).toEqual(sampleRealisticStar(b));
    }
  });

  it('at crestiness 1 boosts the blue tail ~order of magnitude and holds an M-dwarf floor', () => {
    const gapRand = mulberry32(55);
    const crestRand = mulberry32(55);
    const N = 8000;
    let gapBlue = 0;
    let crestBlue = 0;
    let crestM = 0;
    for (let i = 0; i < N; i++) {
      if (isBlue(sampleRealisticStar(gapRand))) gapBlue++;
      const c = sampleArmStar(crestRand, 1);
      if (isBlue(c)) crestBlue++;
      if (isM(c)) crestM++;
    }
    expect(crestBlue).toBeGreaterThan(gapBlue * 4); // young blue population becomes visible on the crest
    expect(crestM / N).toBeGreaterThan(0.5);        // M floor — never an artificial all-blue field
    expect(crestM / N).toBeLessThan(0.62);          // ~0.55 target
  });

  it('clamps crestiness outside [0,1]', () => {
    const a = mulberry32(9);
    const b = mulberry32(9);
    // crestiness < 0 behaves as 0
    expect(sampleArmStar(a, -3)).toEqual(sampleRealisticStar(b));
  });
});
