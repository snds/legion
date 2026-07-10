import { describe, it, expect } from 'vitest';
import { wheelZoomNotches } from './input';

// Cross-device wheel normalization. The contract: one physical mouse-wheel notch
// maps to ≈1 notch (so mouse feel is preserved), while a Mac trackpad's many
// high-resolution sub-notch events SUM to physical scroll distance instead of
// each applying a whole zoom step (the "touchpad too sensitive" bug).
describe('wheelZoomNotches — cross-device wheel normalization', () => {
  it('maps one mouse-wheel notch (~100px, pixel mode) to ≈1 notch — mouse feel preserved', () => {
    expect(wheelZoomNotches(100, 0)).toBeCloseTo(1, 5);
    expect(wheelZoomNotches(-100, 0)).toBeCloseTo(-1, 5);
  });

  it('sums a trackpad swipe from many sub-notch pixel events (old code: a full step each)', () => {
    // A moderate two-finger swipe: 40 fine events of 8px ≈ 320px ≈ 3.2 notches total.
    // The OLD sign-only handler would have applied 40 full steps (~13x too much).
    const events = Array.from({ length: 40 }, () => wheelZoomNotches(8, 0));
    const total = events.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(3.2, 5);
    // Each individual event is a small fraction of a notch — never a whole step.
    expect(events[0]).toBeLessThan(0.1);
  });

  it('normalizes line mode (Firefox mouse wheel) to pixels', () => {
    // 3 lines * 40px = 120px = 1.2 notches.
    expect(wheelZoomNotches(3, 1)).toBeCloseTo(1.2, 5);
  });

  it('normalizes page mode to pixels', () => {
    // 1 page * 800px = 800px = 8 notches, clamped to the per-event cap.
    expect(wheelZoomNotches(1, 2)).toBe(2);
  });

  it('clamps a single fast flick / momentum spike so it cannot leap the whole range', () => {
    expect(wheelZoomNotches(100000, 0)).toBe(2);
    expect(wheelZoomNotches(-100000, 0)).toBe(-2);
  });

  it('preserves scroll direction (sign)', () => {
    expect(Math.sign(wheelZoomNotches(50, 0))).toBe(1);
    expect(Math.sign(wheelZoomNotches(-50, 0))).toBe(-1);
  });
});
