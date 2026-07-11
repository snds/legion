// Phase B B1 — the streaming manager's load-bearing logic: the residency block, the
// per-crossing churn delta, and the camera-focus → galactic-cell transform.

import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
  absWUToGalPc, cellForGalPc, cellKey, createHomeSector, HOME_GAL_PC, DEFAULT_SECTOR_EDGE_PC,
  hystereticCell,
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

  it('radius parameter widens the block: radius 2 → 5×5×1 = 25 cells (the manager default)', () => {
    const cell = { i: 33, j: -1, k: -1 };
    const cells = residentCells(cell, 2);
    expect(cells.length).toBe(25);
    expect(cells.every((c) => c.j === -1)).toBe(true); // still one vertical layer
    expect(new Set(cells.map((c) => c.i)).size).toBe(5); // i ∈ {31..35}
    expect(new Set(cells.map((c) => c.k)).size).toBe(5); // k ∈ {-3..1}
    expect(cells.map(cellKey)).toContain(cellKey(cell));
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

describe('Sector streaming — hysteresis (no boundary thrash)', () => {
  const E = DEFAULT_SECTOR_EDGE_PC; // 250 pc

  it('with no current cell, picks the raw cell', () => {
    const g = new Vector3(600, 100, 50);
    expect(cellKey(hystereticCell(g, null, E, 20))).toBe(cellKey(cellForGalPc(g, E)));
  });

  it('keeps the current cell for a sub-margin jitter across a boundary', () => {
    const current = { i: 0, j: 0, k: -1 };          // z slab [-250, 0)
    const g = new Vector3(125, 125, 5);             // z = +5 pc, only 5 pc past the k=0 boundary
    expect(hystereticCell(g, current, E, 20).k).toBe(-1); // stays — no churn
  });

  it('switches once the focus clears the margin', () => {
    const current = { i: 0, j: 0, k: -1 };
    const g = new Vector3(125, 125, 25);            // z = +25 pc > 20 margin past the boundary
    expect(hystereticCell(g, current, E, 20).k).toBe(0);  // commits to the new cell
  });

  it('a large move jumps straight to the correct (distant) cell, not merely ±1', () => {
    const current = { i: 0, j: 0, k: 0 };
    const g = new Vector3(2600, 0, 0);              // i = floor(2600/250) = 10
    expect(hystereticCell(g, current, E, 20).i).toBe(10);
  });

  it('absorbs the home boundary-straddle (home sits ~0.6 pc from the k=0 boundary)', () => {
    const homeCell = cellForGalPc(HOME_GAL_PC, E);  // (33, -1, -1)
    const jitter = HOME_GAL_PC.clone().add(new Vector3(0, 0, 1)); // z ≈ +0.4 — raw flips to k=0
    expect(cellKey(hystereticCell(jitter, homeCell, E, 20))).toBe(cellKey(homeCell)); // no flip
  });
});
