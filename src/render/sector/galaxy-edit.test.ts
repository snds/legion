// Galaxy painting tool Phase 0 — the non-destructive bake seam. Proves: starId determinism; the
// seam is the IDENTITY with no edits (build-out byte-identical); a single override moves exactly one
// star without disturbing the base stream; the density modifier scales count; a delete omits one star.

import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { generateSectorStarsFast, REF_EMISSION } from './sector-stars';
import { computeStarId, fnv1a32, emptyEditState, type EditState } from './galaxy-edit';

const CELL = new Vector3(8375, -125, -125); // a real home-neighbourhood cell centre (cell 33|-1|-1)
const CELL_KEY = '33|-1|-1';
const REGION_KEY = 'R:8|-1|-1';

describe('starId', () => {
  it('fnv1a32 + computeStarId are deterministic and index-distinct', () => {
    expect(computeStarId(CELL_KEY, 5)).toBe(computeStarId(CELL_KEY, 5));     // stable across calls/reloads
    expect(computeStarId(CELL_KEY, 5)).not.toBe(computeStarId(CELL_KEY, 6)); // distinct per index
    expect(computeStarId(CELL_KEY, 5)).not.toBe(computeStarId('34|-1|-1', 5)); // distinct per cell
    expect(fnv1a32('abc')).toBe(fnv1a32('abc'));
  });
});

describe('edit seam', () => {
  const base = generateSectorStarsFast(CELL, REF_EMISSION, 1000);

  it('is the IDENTITY with an empty editState (build-out byte-identical)', () => {
    const withEmpty = generateSectorStarsFast(CELL, REF_EMISSION, 1000, 250,
      { editState: emptyEditState(), cellKey: CELL_KEY, regionKey: REGION_KEY });
    expect(withEmpty.count).toBe(base.count);
    expect(Array.from(withEmpty.positions)).toEqual(Array.from(base.positions));
    expect(Array.from(withEmpty.colors)).toEqual(Array.from(base.colors));
    expect(Array.from(withEmpty.crests)).toEqual(Array.from(base.crests));
  });

  it('a single position override moves exactly that star, base stream untouched', () => {
    const editState: EditState = emptyEditState();
    const starId = computeStarId(CELL_KEY, 0);
    editState.overrides.set(REGION_KEY, new Map([[starId, { position: [CELL.x + 10, CELL.y, CELL.z] }]]));
    const edited = generateSectorStarsFast(CELL, REF_EMISSION, 1000, 250,
      { editState, cellKey: CELL_KEY, regionKey: REGION_KEY });
    expect(edited.count).toBe(base.count);
    // star 0 → its absolute galPc became (CELL + 10pc x) → sector-local 10 pc = 10000 WU, 0, 0
    expect(edited.positions[0]).toBeCloseTo(10000, 0);
    expect(edited.positions[1]).toBeCloseTo(0, 0);
    expect(edited.positions[2]).toBeCloseTo(0, 0);
    // every OTHER star is byte-identical to the base
    for (let i = 3; i < base.positions.length; i++) {
      expect(edited.positions[i]).toBe(base.positions[i]);
    }
  });

  it('a brightness override scales only that star colour', () => {
    const editState: EditState = emptyEditState();
    editState.overrides.set(REGION_KEY, new Map([[computeStarId(CELL_KEY, 0), { brightness: 0.5 }]]));
    const edited = generateSectorStarsFast(CELL, REF_EMISSION, 1000, 250,
      { editState, cellKey: CELL_KEY, regionKey: REGION_KEY });
    expect(edited.colors[0]).toBeCloseTo(base.colors[0]! * 0.5, 5);
    expect(edited.colors[3]).toBe(base.colors[3]); // star 1 untouched
  });

  it('the per-cell density modifier scales the star count', () => {
    const editState: EditState = emptyEditState();
    editState.modifiers.set(CELL_KEY, { densityFactor: 0.5, displacementPc: [0, 0, 0], dustOpacity: 0 });
    const edited = generateSectorStarsFast(CELL, REF_EMISSION, 1000, 250,
      { editState, cellKey: CELL_KEY, regionKey: REGION_KEY });
    expect(edited.count).toBe(Math.round(base.count * 0.5));
  });

  it('a delete override omits exactly one star', () => {
    const editState: EditState = emptyEditState();
    editState.overrides.set(REGION_KEY, new Map([[computeStarId(CELL_KEY, 0), { position: null }]]));
    const edited = generateSectorStarsFast(CELL, REF_EMISSION, 1000, 250,
      { editState, cellKey: CELL_KEY, regionKey: REGION_KEY });
    expect(edited.count).toBe(base.count - 1);
    // the surviving stars are the base's stars 1..N (compacted): star 1's position is now at index 0
    expect(edited.positions[0]).toBe(base.positions[3]);
  });
});
