// Galaxy paint Phase 1b — the stroke→field replay. Proves a stroke bumps only the cells within its
// radius, dirties their regions, and that rebuildEditState replays the op-list deterministically.

import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import type { PopulatedCell } from './sector/galaxy-enumerate';
import { emptyEditState } from './sector/galaxy-edit';
import { applyStroke, rebuildEditState, strokeCentroidXZ, MAX_DENSITY_FACTOR, type BrushStroke } from './galaxy-paint-ops';

const mk = (i: number, k: number): PopulatedCell => ({
  cell: { i, j: 0, k },
  centerPc: new Vector3((i + 0.5) * 250, 125, (k + 0.5) * 250),
  emission: 1,
  armPhase: 'gap',
  densityClass: 'nominal',
  regionKey: `R:${Math.floor(i / 4)}|0|${Math.floor(k / 4)}`,
});
const cells = [mk(0, 0), mk(1, 0), mk(40, 0)]; // two adjacent (region R:0|0|0) + one far (R:10|0|0)

describe('applyStroke', () => {
  it('bumps densityFactor for cells within the brush radius, dirties their regions, leaves others', () => {
    const editState = emptyEditState();
    const stroke: BrushStroke = {
      brushType: 'density-add',
      path: [[125, 125, 125]], // cell (0,0,0) centre
      radiusPc: 400,           // covers cells 0 and 1 (250 pc apart), not cell 40
      intensity: 1,
    };
    const dirty = applyStroke(stroke, editState, cells);
    expect(editState.modifiers.get('0|0|0')!.densityFactor).toBeGreaterThan(1); // centre: full bump
    expect(editState.modifiers.get('1|0|0')!.densityFactor).toBeGreaterThan(1); // within radius: partial
    expect(editState.modifiers.get('1|0|0')!.densityFactor).toBeLessThan(editState.modifiers.get('0|0|0')!.densityFactor);
    expect(editState.modifiers.has('40|0|0')).toBe(false); // far cell untouched
    expect(dirty.has('R:0|0|0')).toBe(true);
    expect(dirty.has('R:10|0|0')).toBe(false);
  });

  it('scales each cell\'s deposit by its strongest stamp\'s pen pressure (feather vs firm)', () => {
    const editState = emptyEditState();
    const stroke: BrushStroke = {
      brushType: 'density-add',
      path: [[125, 125, 125], [375, 125, 125]], // stamp on cell (0,0,0), stamp on cell (1,0,0)
      pressures: [1, 0.5],                       // firm on cell 0, feather on cell 1
      radiusPc: 200,                             // r<250 ⇒ each stamp only reaches its own cell
      intensity: 1,
    };
    applyStroke(stroke, editState, cells);
    expect(editState.modifiers.get('0|0|0')!.densityFactor).toBeCloseTo(2.0, 5); // 1 + 1*1*1
    expect(editState.modifiers.get('1|0|0')!.densityFactor).toBeCloseTo(1.5, 5); // 1 + 1*1*0.5
  });

  it('accumulates across strokes; rebuildEditState replays the op-list deterministically', () => {
    const stroke: BrushStroke = { brushType: 'density-add', path: [[125, 125, 125]], radiusPc: 200, intensity: 0.5 };
    const a = emptyEditState();
    applyStroke(stroke, a, cells);
    applyStroke(stroke, a, cells); // twice → double the bump
    const once = emptyEditState();
    applyStroke(stroke, once, cells);
    expect(a.modifiers.get('0|0|0')!.densityFactor).toBeCloseTo(1 + 2 * 0.5, 5);
    // rebuild from a 2-op list matches the accumulated state
    const rebuilt = rebuildEditState([stroke, stroke], cells);
    expect(rebuilt.editState.modifiers.get('0|0|0')!.densityFactor).toBeCloseTo(a.modifiers.get('0|0|0')!.densityFactor, 5);
    expect(rebuilt.dirty.has('R:0|0|0')).toBe(true);
  });
});

describe('applyStroke — erase / falloff / opacity ceiling (Phase 2d)', () => {
  const at = (path: BrushStroke['path'], extra: Partial<BrushStroke>): BrushStroke => ({
    brushType: 'density-add', path, radiusPc: 200, intensity: 1, ...extra,
  });

  it('erase multiplies densityFactor down toward 0, composing with a prior add', () => {
    const es = emptyEditState();
    applyStroke(at([[125, 125, 125]], {}), es, cells);                                  // cell0 → 2.0
    applyStroke(at([[125, 125, 125]], { brushType: 'density-erase', intensity: 0.5 }), es, cells); // ×(1−0.5)
    expect(es.modifiers.get('0|0|0')!.densityFactor).toBeCloseTo(1.0, 5); // 2.0 × 0.5
  });

  it('erase on an unedited cell drops it below 1 (fewer stars than the base)', () => {
    const es = emptyEditState();
    applyStroke(at([[125, 125, 125]], { brushType: 'density-erase', intensity: 0.5 }), es, cells);
    expect(es.modifiers.get('0|0|0')!.densityFactor).toBeCloseTo(0.5, 5); // 1 × (1−0.5)
  });

  it('the opacity ceiling clamps runaway additive scrubbing at MAX_DENSITY_FACTOR', () => {
    const es = emptyEditState();
    for (let i = 0; i < 10; i++) applyStroke(at([[125, 125, 125]], { intensity: 3 }), es, cells); // ≫ 8 uncapped
    expect(es.modifiers.get('0|0|0')!.densityFactor).toBe(MAX_DENSITY_FACTOR);
  });

  it('hard falloff deposits full strength across the disc; ease is softer than linear at the edge', () => {
    const hard = emptyEditState(); applyStroke(at([[125, 125, 125]], { radiusPc: 400, falloff: 'hard' }), hard, cells);
    const lin = emptyEditState(); applyStroke(at([[125, 125, 125]], { radiusPc: 400, falloff: 'linear' }), lin, cells);
    const ease = emptyEditState(); applyStroke(at([[125, 125, 125]], { radiusPc: 400, falloff: 'ease' }), ease, cells);
    // cell (1,0,0) is 250 pc from the stamp; radius 400 ⇒ t = 0.625
    const h = hard.modifiers.get('1|0|0')!.densityFactor;
    const l = lin.modifiers.get('1|0|0')!.densityFactor;
    const e = ease.modifiers.get('1|0|0')!.densityFactor;
    expect(h).toBeCloseTo(2.0, 5);   // full deposit through the disc
    expect(h).toBeGreaterThan(l);
    expect(l).toBeGreaterThan(e);    // ease tapers faster toward the edge
  });
});

describe('strokeCentroidXZ', () => {
  it('averages the path on the galactic plane (x,z) for the held-press coalesce test', () => {
    expect(strokeCentroidXZ([[0, 5, 0], [200, 5, 100]])).toEqual([100, 50]);
    expect(strokeCentroidXZ([[125, 5, 125]])).toEqual([125, 125]); // a single press → its own centre
    expect(strokeCentroidXZ([])).toEqual([0, 0]);                  // empty guard (no divide-by-zero)
  });
});
