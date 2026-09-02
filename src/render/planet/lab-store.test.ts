import { describe, expect, it } from 'vitest';
import { applySystemicByType, freshSystemicByType } from './lab-store';

describe('planet lab per-archetype store', () => {
  it('fresh table gives each archetype its own World-dial object', () => {
    const t = freshSystemicByType();
    expect(t.rocky).not.toBe(t.ocean);
    t.rocky.warmth = 0.9;
    expect(t.ocean.warmth).toBe(0.5);
    expect(t.desert.warmth).toBe(0.5);
  });

  it('applySystemicByType merges only listed archetypes', () => {
    const t = freshSystemicByType();
    applySystemicByType(t, {
      rocky: { warmth: 0.2, tectonics: 0.9 },
      desert: { hydrosphere: 0.1 },
    });
    expect(t.rocky.warmth).toBe(0.2);
    expect(t.rocky.tectonics).toBe(0.9);
    expect(t.rocky.biosphere).toBe(0.75);
    expect(t.desert.hydrosphere).toBe(0.1);
    expect(t.ocean.warmth).toBe(0.5);
  });
});
