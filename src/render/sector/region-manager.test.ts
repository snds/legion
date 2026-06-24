// Region/LOD backbone Inc 2 — the region scheduling layer. Proves the residency block + churn,
// and the load-bearing invariant that the region filter is a NO-OP in Inc 2: every sector in the
// camera's 3×3×1 block falls inside the 3×3×1 region block, so streaming stays byte-identical.

import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { cellCenterPc, cellForGalPc, cellKey, HOME_GAL_PC, DEFAULT_SECTOR_EDGE_PC } from './sector';
import { regionForGalPc, regionKey } from './region';
import { residentCells } from './sector-manager';
import { residentRegionCells } from './region-manager';

describe('Region streaming — residency block', () => {
  it('residentRegionCells is the 3×3×1 disc-plane block (9 regions, one layer)', () => {
    const cells = residentRegionCells({ i: 8, j: 0, k: -1 });
    expect(cells.length).toBe(9);
    expect(cells.every((c) => c.j === 0)).toBe(true);
    expect(new Set(cells.map((c) => c.i)).size).toBe(3);
    expect(new Set(cells.map((c) => c.k)).size).toBe(3);
    expect(cells.map(regionKey)).toContain(regionKey({ i: 8, j: 0, k: -1 })); // includes itself
  });

  it('crossing one region churns 3 out / 3 in (6 stay)', () => {
    const a = residentRegionCells({ i: 8, j: 0, k: -1 }).map(regionKey);
    const b = residentRegionCells({ i: 9, j: 0, k: -1 }).map(regionKey);
    const aSet = new Set(a);
    const bSet = new Set(b);
    expect(b.filter((k) => !aSet.has(k)).length).toBe(3);
    expect(a.filter((k) => !bSet.has(k)).length).toBe(3);
    expect(b.filter((k) => aSet.has(k)).length).toBe(6);
  });
});

describe('Region filter is a no-op in Inc 2 (streaming stays byte-identical)', () => {
  // The camera's 3×3×1 SECTOR block (750 pc) must lie entirely within the 3×3×1 REGION block
  // (3 kpc) — for the home cell AND for arbitrary cells across the galaxy — so the region gate in
  // updateSectorManager never trims a desired sector.
  const PLACES: [string, Vector3][] = [
    ['home', new Vector3(HOME_GAL_PC.x, HOME_GAL_PC.y, HOME_GAL_PC.z)],
    ['core', new Vector3(0, 0, 0)],
    ['arm', new Vector3(-6200, 5, 9100)],
    ['boundary-adjacent', new Vector3(999, 0, 1999)], // near a region corner — the worst case
  ];

  for (const [name, g] of PLACES) {
    it(`every sector in the ${name} block sits in a resident region`, () => {
      const camCell = cellForGalPc(g);
      const camRegion = regionForGalPc(g);
      const residentRegions = new Set(residentRegionCells(camRegion).map(regionKey));
      const probe = new Vector3();
      for (const sc of residentCells(camCell)) {
        const r = regionForGalPc(cellCenterPc(sc, DEFAULT_SECTOR_EDGE_PC, probe));
        expect(residentRegions.has(regionKey(r)), `${name} ${cellKey(sc)}`).toBe(true);
      }
    });
  }
});
