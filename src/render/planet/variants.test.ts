import { describe, it, expect } from 'vitest';
import {
  OCEAN_VARIANTS, variantById, DEFAULT_SYSTEMIC,
  masterValues, applyOffsets, type SystemicState,
} from './variants';

describe('habitable-world variants', () => {
  it('every variant has a unique id, label and blurb', () => {
    const ids = OCEAN_VARIANTS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of OCEAN_VARIANTS) {
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.blurb.length).toBeGreaterThan(0);
      expect(variantById(v.id)).toBe(v);
    }
  });

  it('keeps cloud cover below the white-out threshold', () => {
    // Past ~0.6 the deck closes up and the surface stops reading at all — a
    // review catch on the Hothouse preset. Guard it so no variant regresses.
    for (const v of OCEAN_VARIANTS) {
      if (v.preset.cloudCover !== undefined) expect(v.preset.cloudCover).toBeLessThanOrEqual(0.6);
    }
  });

  it('orders sensibly: glacial is icier and drier than hothouse', () => {
    const g = variantById('glacial')!.preset;
    const h = variantById('hothouse')!.preset;
    expect(g.latitudeIce!).toBeGreaterThan(h.latitudeIce!);
    expect(g.moisture!).toBeLessThan(h.moisture!);
    expect(g.treeline!).toBeGreaterThan(h.treeline!);  // trees pushed back when cold
    expect(g.seaLevel!).toBeLessThan(h.seaLevel!);     // water locked up in ice
  });
});

describe('systemic dials', () => {
  it('0.5 on every dial lands on the Earth-like anchor', () => {
    const mid = masterValues({ warmth: 0.5, hydrosphere: 0.5, tectonics: 0.5, biosphere: 0.5 });
    expect(mid.preset.latitudeIce).toBeCloseTo(0.5);
    expect(mid.preset.moisture).toBeCloseTo(1.0);
    expect(mid.preset.seaLevel).toBeCloseTo(0.55);
    expect(mid.macro.landCoverage).toBeCloseTo(0.30);
    expect(mid.macro.plateCount).toBe(26);
  });

  it('warmth sweeps monotonically from glacial to hothouse', () => {
    const cold = masterValues({ ...DEFAULT_SYSTEMIC, warmth: 0 });
    const warm = masterValues({ ...DEFAULT_SYSTEMIC, warmth: 1 });
    expect(cold.preset.latitudeIce).toBeGreaterThan(warm.preset.latitudeIce);
    expect(cold.preset.moisture).toBeLessThan(warm.preset.moisture);   // cold = dry
    expect(cold.preset.aridBelts).toBeGreaterThan(warm.preset.aridBelts); // sharper gradient
  });

  it('tectonic vigour drives craters INVERSELY (resurfacing erases them)', () => {
    const dead = masterValues({ ...DEFAULT_SYSTEMIC, tectonics: 0 });
    const young = masterValues({ ...DEFAULT_SYSTEMIC, tectonics: 1 });
    expect(dead.macro.craters).toBeGreaterThan(young.macro.craters);
    expect(dead.macro.uplift).toBeLessThan(young.macro.uplift);
  });

  it('no dial can push a parameter out of its slider range', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const v = masterValues({ warmth: t, hydrosphere: t, tectonics: t, biosphere: t });
      expect(v.preset.cloudCover).toBeLessThanOrEqual(0.6);   // white-out guard
      expect(v.macro.landCoverage).toBeGreaterThan(0.02);
      expect(v.macro.plateCount).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('offset model — manual edits survive a master move', () => {
  const seed = (s: SystemicState): { live: Record<string, number>; base: Record<string, number> } => {
    const m = masterValues(s);
    return { live: { ...m.preset }, base: { ...m.preset } };
  };

  it('preserves a hand edit as a delta when the dial moves', () => {
    const s: SystemicState = { ...DEFAULT_SYSTEMIC, warmth: 0.5 };
    const { live, base } = seed(s);
    // Hand-raise the treeline well above what the dial produced.
    const handDelta = 0.1;
    live.treeline = base.treeline + handDelta;

    const next = masterValues({ ...s, warmth: 0.9 });
    applyOffsets(live, next.preset, base);

    // The edit rides along: new value = new baseline + the same delta.
    expect(live.treeline).toBeCloseTo(next.preset.treeline + handDelta, 5);
    // ...and it is NOT simply the master value (that would be the old overwrite).
    expect(live.treeline).not.toBeCloseTo(next.preset.treeline, 5);
  });

  it('un-edited parameters track the dial exactly', () => {
    const s: SystemicState = { ...DEFAULT_SYSTEMIC, warmth: 0.5 };
    const { live, base } = seed(s);
    const next = masterValues({ ...s, warmth: 0.2 });
    applyOffsets(live, next.preset, base);
    expect(live.moisture).toBeCloseTo(next.preset.moisture, 5);
    expect(live.latitudeIce).toBeCloseTo(next.preset.latitudeIce, 5);
  });

  it('clamps an offset that would leave the valid range', () => {
    const s: SystemicState = { ...DEFAULT_SYSTEMIC, warmth: 0.5 };
    const { live, base } = seed(s);
    live.latitudeIce = 1.0;                       // hand-maxed
    const next = masterValues({ ...s, warmth: 0 }); // dial also pushes ice up
    applyOffsets(live, next.preset, base);
    expect(live.latitudeIce).toBeLessThanOrEqual(1);
    expect(live.latitudeIce).toBeGreaterThanOrEqual(0);
  });

  it('round-trips: moving a dial away and back restores the edited value', () => {
    const s: SystemicState = { ...DEFAULT_SYSTEMIC, warmth: 0.5 };
    const { live, base } = seed(s);
    live.moisture = base.moisture - 0.2;          // hand-dried the world
    const before = live.moisture;

    let b = base;
    for (const w of [0.8, 0.3, 0.5]) {            // wander, then come home
      const n = masterValues({ ...s, warmth: w });
      applyOffsets(live, n.preset, b);
      b = n.preset;
    }
    expect(live.moisture).toBeCloseTo(before, 5);
  });

  it('integer parameters stay integral through an offset', () => {
    const s: SystemicState = { ...DEFAULT_SYSTEMIC, tectonics: 0.5 };
    const m = masterValues(s);
    const live = { ...m.macro }; const base = { ...m.macro };
    live.plateCount = base.plateCount + 5;
    const next = masterValues({ ...s, tectonics: 0.83 });
    applyOffsets(live, next.macro, base);
    expect(Number.isInteger(live.plateCount)).toBe(true);
  });
});
