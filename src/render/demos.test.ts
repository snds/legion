import { describe, it, expect } from 'vitest';
import { DEMOS, demoById, HERO_BLACKHOLE_ABS, type DemoId } from './demos';

describe('demos registry', () => {
  it('exposes the five shipped subsystems with unique ids', () => {
    expect(DEMOS).toHaveLength(5);
    const ids = DEMOS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining(['star', 'planet', 'nebula', 'blackhole', 'galaxy']),
    );
  });

  it('every demo has a tier target in [0,1] and a finite focus point', () => {
    for (const d of DEMOS) {
      expect(d.targetZoom).toBeGreaterThan(0);
      expect(d.targetZoom).toBeLessThan(1);
      expect(Number.isFinite(d.focusAbs.x)).toBe(true);
      expect(Number.isFinite(d.focusAbs.y)).toBe(true);
      expect(Number.isFinite(d.focusAbs.z)).toBe(true);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.blurb.length).toBeGreaterThan(0);
      expect(d.icon.length).toBeGreaterThan(0);
    }
  });

  it('demoById round-trips and rejects unknown / null ids', () => {
    for (const d of DEMOS) {
      expect(demoById(d.id)).toBe(d);
    }
    expect(demoById(null)).toBeNull();
    expect(demoById('nope' as DemoId)).toBeNull();
  });

  it('the black-hole demo focuses the shared hero position', () => {
    const bh = demoById('blackhole');
    expect(bh?.focusAbs.equals(HERO_BLACKHOLE_ABS)).toBe(true);
  });
});
