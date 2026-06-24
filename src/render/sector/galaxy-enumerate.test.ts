// Full-galaxy build-out Inc 1 — the enumeration. Proves it selects populated cells across the 3D
// disc deterministically, reaches the diffused rim, and thins on all axes (the key visual claim).

import { describe, it, expect, vi } from 'vitest';
import { cellKey } from './sector';
import { enumerateGalaxy } from './galaxy-enumerate';

// One full enumeration shared across the assertions (it walks ~100k cells — the dominant cost).
const g = enumerateGalaxy();

describe('Galaxy enumeration — population + determinism', () => {
  it('populates a substantial set of cells across the disc', () => {
    expect(g.cells.length).toBeGreaterThan(30000); // ~63k at the default threshold
    expect(g.cells.length).toBeLessThan(100000);
    expect(g.byRegion.size).toBeGreaterThan(800); // grouped into ~1.5k 1 kpc regions
  });

  it('draws NO entropy from Math.random and is reproducible', () => {
    const spy = vi.spyOn(Math, 'random');
    const a = enumerateGalaxy({ yExtentPc: 250, threshold: 0.3 }); // cheaper config for the repeat
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    const b = enumerateGalaxy({ yExtentPc: 250, threshold: 0.3 });
    expect(a.cells.map((c) => cellKey(c.cell))).toEqual(b.cells.map((c) => cellKey(c.cell)));
  });

  it("every cell's region grouping is consistent", () => {
    for (const [rk, list] of g.byRegion) {
      expect(list.every((c) => c.regionKey === rk)).toBe(true);
    }
    expect([...g.byRegion.values()].reduce((n, l) => n + l.length, 0)).toBe(g.cells.length);
  });
});

describe('Galaxy enumeration — thinning on all axes', () => {
  it('reaches the diffused rim but is radially truncated (~12–15 kpc)', () => {
    let maxR = 0;
    for (const c of g.cells) maxR = Math.max(maxR, Math.hypot(c.centerPc.x, c.centerPc.z));
    expect(maxR).toBeGreaterThan(12000); // the rim wisps reach far out
    expect(maxR).toBeLessThan(15000);    // but truncated — no hard disc edge past here
  });

  it('thins VERTICALLY — densest near the midplane, monotone taper to a thin fringe off-plane', () => {
    const h = g.layerHistogram;
    const mid = h.get(0) ?? 0;
    expect(mid).toBe(h.get(-1) ?? 0);              // symmetric about the plane
    expect(mid).toBeGreaterThan(h.get(3) ?? 0);    // 3 layers up: clearly fewer
    expect(h.get(3) ?? 0).toBeGreaterThan(h.get(6) ?? 1); // monotone taper toward the vertical edge
    expect(h.get(6) ?? 0).toBeLessThan(mid * 0.35);       // the disc edge is a thin fringe (oblate)
  });

  it('thins RADIALLY — denser interior than rim (per-radius cell count falls off)', () => {
    let inner = 0; // R < 6 kpc
    let outer = 0; // 10–14 kpc
    for (const c of g.cells) {
      const R = Math.hypot(c.centerPc.x, c.centerPc.z);
      if (R < 6000) inner++;
      else if (R >= 10000 && R < 14000) outer++;
    }
    // the inner disc carries more vertical layers + arm density than the thin outer rim ring
    expect(inner).toBeGreaterThan(0);
    expect(outer).toBeGreaterThan(0);
    // density per unit area: inner annulus (R<6) far denser than the outer ring despite less area
    const innerArea = Math.PI * 6000 ** 2;
    const outerArea = Math.PI * (14000 ** 2 - 10000 ** 2);
    expect(inner / innerArea).toBeGreaterThan(outer / outerArea);
  });
});
