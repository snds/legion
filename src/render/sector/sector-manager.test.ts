// Phase B B1 — the streaming manager's load-bearing logic: the residency block, the
// per-crossing churn delta, and the camera-focus → galactic-cell transform.

import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
  absWUToGalPc, cellForGalPc, cellKey, createHomeSector, HOME_GAL_PC, DEFAULT_SECTOR_EDGE_PC,
} from './sector';
import { residentCells } from './sector-manager';

describe('Sector streaming — residency block', () => {
  it('residentCells is the 3×3×1 disc-plane block around a cell', () => {
    const cell = { i: 33, j: -1, k: -1 };
    const cells = residentCells(cell);
    expect(cells.length).toBe(9);
    expect(cells.every((c) => c.j === -1)).toBe(true); // one vertical layer (disc is oblate)
    expect(new Set(cells.map((c) => c.i)).size).toBe(3); // i ∈ {32,33,34}
    expect(new Set(cells.map((c) => c.k)).size).toBe(3); // k ∈ {-2,-1,0}
    expect(cells.map(cellKey)).toContain(cellKey(cell)); // includes the camera cell itself
  });

  it('crossing one cell churns exactly 3 out / 3 in (6 stay)', () => {
    const a = residentCells({ i: 33, j: -1, k: -1 }).map(cellKey);
    const b = residentCells({ i: 34, j: -1, k: -1 }).map(cellKey); // camera moved +1 in i
    const aSet = new Set(a);
    const bSet = new Set(b);
    expect(b.filter((k) => !aSet.has(k)).length).toBe(3); // entered
    expect(a.filter((k) => !bSet.has(k)).length).toBe(3); // left
    expect(b.filter((k) => aSet.has(k)).length).toBe(6); // resident across the crossing
  });
});

describe('Sector streaming — camera focus → cell', () => {
  it('absWUToGalPc inverts centerAbsWU (home WU origin → HOME_GAL_PC)', () => {
    const g = absWUToGalPc(new Vector3(0, 0, 0));
    expect(g.x).toBeCloseTo(HOME_GAL_PC.x, 6);
    expect(g.y).toBeCloseTo(HOME_GAL_PC.y, 6);
    expect(g.z).toBeCloseTo(HOME_GAL_PC.z, 6);
    const home = createHomeSector();
    const back = absWUToGalPc(home.centerAbsWU.clone());
    expect(back.distanceTo(home.centerPc)).toBeLessThan(1e-6); // a sector's WU round-trips to its pc
  });

  it('the camera at the WU origin resolves to the home cell', () => {
    const camCell = cellForGalPc(absWUToGalPc(new Vector3(0, 0, 0)), DEFAULT_SECTOR_EDGE_PC);
    const homeCell = cellForGalPc(HOME_GAL_PC, DEFAULT_SECTOR_EDGE_PC);
    expect(cellKey(camCell)).toBe(cellKey(homeCell));
  });

  it('a focus 600 pc away in galactic +x resolves to a different cell (traversal)', () => {
    const focusWU = new Vector3(600_000, 0, 0); // 600 pc · WU_PER_PC
    const camCell = cellForGalPc(absWUToGalPc(focusWU), DEFAULT_SECTOR_EDGE_PC);
    const homeCell = cellForGalPc(HOME_GAL_PC, DEFAULT_SECTOR_EDGE_PC);
    expect(cellKey(camCell)).not.toBe(cellKey(homeCell));
    expect(camCell.i).toBeGreaterThan(homeCell.i);
  });
});
