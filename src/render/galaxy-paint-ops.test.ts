// Galaxy paint Phase 1b — the stroke→field replay. Proves a stroke bumps only the cells within its
// radius, dirties their regions, and that rebuildEditState replays the op-list deterministically.

import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import type { PopulatedCell } from './sector/galaxy-enumerate';
import { emptyEditState } from './sector/galaxy-edit';
import { applyStroke, rebuildEditState, type BrushStroke } from './galaxy-paint-ops';

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
