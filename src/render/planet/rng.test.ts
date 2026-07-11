import { describe, it, expect } from 'vitest';
import { channel, range, seedOffset, seedFrom } from './rng';

describe('deterministic RNG', () => {
  it('channels are reproducible and independent', () => {
    const a1 = channel(42, 'palette');
    const a2 = channel(42, 'palette');
    expect(a1()).toBe(a2());

    // Different channel names decorrelate from the same seed.
    const pal = channel(42, 'palette');
    const ter = channel(42, 'terrain');
    expect(pal()).not.toBe(ter());
  });

  it('range stays within bounds', () => {
    const rng = channel(1, 'x');
    for (let i = 0; i < 100; i++) {
      const v = range(rng, -3, 7);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(7);
    }
  });

  it('seedOffset is deterministic and bounded', () => {
    const a = seedOffset(777);
    const b = seedOffset(777);
    expect(a).toEqual(b);
    for (const c of a) expect(Math.abs(c)).toBeLessThanOrEqual(1000);
    expect(seedOffset(778)).not.toEqual(a);
  });

  it('re-exports the canonical seedFrom', () => {
    expect(seedFrom('abc')).toBe(seedFrom('abc'));
    expect(seedFrom('abc')).not.toBe(seedFrom('abd'));
  });
});
