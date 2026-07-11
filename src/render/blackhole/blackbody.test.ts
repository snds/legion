// ═══════════════════════════════════════════════════════════════════
// BLACKBODY RAMP TESTS — Planck-locus colour, pinned to physical intuition
//
// The disk colours a real thermal-emission ramp: cool → red, hot → blue-white,
// with the Sun's ~5800 K sitting near neutral. These assertions guard the
// T→RGB conversion the disk relies on so a bad matrix or fit flip fails in CI.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { blackbodyRGB, rampCoord, RAMP_MIN_K, RAMP_MAX_K } from './blackbody';

describe('blackbody T→RGB', () => {
  it('cool temperatures are red-dominant', () => {
    const [r, g, b] = blackbodyRGB(1500);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r).toBeCloseTo(1, 5); // normalised so the brightest channel is 1
  });

  it('hot temperatures are blue-dominant', () => {
    const [r, , b] = blackbodyRGB(30000);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeCloseTo(1, 5);
  });

  it('sunlike ~5800 K is roughly balanced (near-white)', () => {
    const [r, g, b] = blackbodyRGB(5800);
    // All channels present and within a modest spread of each other.
    expect(Math.min(r, g, b)).toBeGreaterThan(0.5);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.5);
  });

  it('hue shifts monotonically blue-ward with temperature', () => {
    const blueFrac = (t: number): number => {
      const [r, g, b] = blackbodyRGB(t);
      return b / (r + g + b);
    };
    expect(blueFrac(2000)).toBeLessThan(blueFrac(6000));
    expect(blueFrac(6000)).toBeLessThan(blueFrac(20000));
  });

  it('all channels stay in [0,1]', () => {
    for (let t = 1000; t <= 40000; t += 2500) {
      for (const c of blackbodyRGB(t)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('ramp coordinate mapping', () => {
  it('clamps to [0,1] across the ramp range', () => {
    expect(rampCoord(RAMP_MIN_K - 500)).toBe(0);
    expect(rampCoord(RAMP_MAX_K + 5000)).toBe(1);
    expect(rampCoord((RAMP_MIN_K + RAMP_MAX_K) / 2)).toBeCloseTo(0.5, 5);
  });
});
