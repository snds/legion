import { describe, it, expect } from 'vitest';
import { kelvinToRGB, kelvinToHex } from './kelvin';

const SUN_K = 5772;

describe('kelvinToRGB — perceptual Planckian colour', () => {
  it('the Sun (G, ~5772 K) reads white, not saturated yellow', () => {
    const [r, g, b] = kelvinToRGB(SUN_K);
    expect(Math.min(r, g, b)).toBeGreaterThan(0.7);        // all channels high → white-ish
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.25); // low chroma
  });

  it('an M dwarf (~3200 K) reads orange (red ≫ blue)', () => {
    const [r, g, b] = kelvinToRGB(3200);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r - b).toBeGreaterThan(0.3);
  });

  it('an O/B star (~40000 K) reads blue-white (blue ≥ red)', () => {
    const [r, , b] = kelvinToRGB(40000);
    expect(b).toBeGreaterThanOrEqual(r);
    expect(b).toBeGreaterThan(0.9);
  });

  it('NEVER produces a green-dominant star across the whole range', () => {
    for (let t = 1500; t <= 40000; t += 250) {
      const [r, g, b] = kelvinToRGB(t);
      // Green may tie the max near ~6600 K white, but must never exceed both.
      expect(g).toBeLessThanOrEqual(Math.max(r, b) + 1e-6);
    }
  });

  it('is monotonic-ish: cooler ⇒ warmer (r/b ratio rises as T falls)', () => {
    const ratio = (t: number): number => {
      const [r, , b] = kelvinToRGB(t);
      return r / Math.max(b, 1e-4);
    };
    expect(ratio(3000)).toBeGreaterThan(ratio(5772));
    expect(ratio(5772)).toBeGreaterThan(ratio(15000));
  });

  it('clamps out-of-range temperatures without NaN', () => {
    for (const t of [0, -100, 500, 1e9, NaN]) {
      const [r, g, b] = kelvinToRGB(t);
      expect(Number.isFinite(r)).toBe(true);
      expect(Number.isFinite(g)).toBe(true);
      expect(Number.isFinite(b)).toBe(true);
    }
  });

  it('is deterministic + packs to a valid hex', () => {
    expect(kelvinToRGB(SUN_K)).toEqual(kelvinToRGB(SUN_K));
    const hex = kelvinToHex(SUN_K);
    expect(hex).toBeGreaterThanOrEqual(0);
    expect(hex).toBeLessThanOrEqual(0xffffff);
  });
});
