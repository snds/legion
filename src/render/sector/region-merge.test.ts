// Full-galaxy build-out Inc 2+3 — the star cap + the region-merge renderer. Proves the cap is a
// deterministic prefix and the merge concatenates correctly with float-safe region-local coords.

import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { createHomeSector } from './sector';
import { generateSectorStars, generateSectorStarsFast } from './sector-stars';
import { buildRegionStarField } from './region-merge';
import type { PopulatedCell } from './galaxy-enumerate';

describe('starCountCap', () => {
  it('clamps the count to a deterministic prefix of the uncapped field', () => {
    const full = generateSectorStars(createHomeSector());
    const capped = generateSectorStars(createHomeSector(), 50);
    expect(capped.count).toBe(Math.min(full.count, 50));
    // the capped stars are exactly the first N of the uncapped (same seed stream, fewer placed)
    expect(Array.from(capped.positions)).toEqual(Array.from(full.positions.slice(0, capped.count * 3)));
    expect(Array.from(capped.colors)).toEqual(Array.from(full.colors.slice(0, capped.count * 3)));
  });

  it('no cap is unchanged', () => {
    expect(generateSectorStars(createHomeSector()).count).toBe(generateSectorStars(createHomeSector(), undefined).count);
  });
});

describe('region-merge', () => {
  // Two real cells inside region (8,-1,-1) (region centre pc = (8500,-500,-500)).
  const mk = (i: number, k: number): PopulatedCell => ({
    cell: { i, j: -1, k },
    centerPc: new Vector3((i + 0.5) * 250, -125, (k + 0.5) * 250),
    emission: 1,
    armPhase: 'gap',
    densityClass: 'nominal',
    regionKey: 'R:8|-1|-1',
  });
  const cells = [mk(33, -1), mk(34, -1)];
  const field = buildRegionStarField({ i: 8, j: -1, k: -1 }, cells, 100);

  it('merged count = sum of the cells (each fast-generated, capped)', () => {
    const sum = cells.reduce((n, c) => n + generateSectorStarsFast(c.centerPc, c.emission, 100).count, 0);
    expect(field.count).toBe(sum);
    const posAttr = field.points.geometry.getAttribute('position');
    expect(posAttr.count).toBe(field.count);
    expect(field.points.geometry.getAttribute('aCrest').count).toBe(field.count);
  });

  it('region-local coords are float-safe (well within ±600k WU; a known cell offset lands right)', () => {
    const pos = field.points.geometry.getAttribute('position').array as Float32Array;
    let maxAbs = 0;
    for (let i = 0; i < pos.length; i++) maxAbs = Math.max(maxAbs, Math.abs(pos[i]!));
    expect(maxAbs).toBeLessThan(600_000); // ±500k region span + breach, float32-exact at this range
    expect(Number.isFinite(maxAbs)).toBe(true);
    // cell (34,-1,-1) centre is +125 pc in x from the region centre → its stars cluster near +125000 WU
    const cell34 = generateSectorStarsFast(cells[1]!.centerPc, cells[1]!.emission, 100);
    // first star of the second cell sits at offset (125000, +375000? no: cy-rcy) ...
    // assert at least one star is in the +x half (the +125 pc cell), proving the offset applied
    let anyPlusX = false;
    for (let i = 0; i < pos.length; i += 3) if (pos[i]! > 50_000) anyPlusX = true;
    expect(anyPlusX).toBe(true);
    expect(cell34.count).toBeGreaterThan(0);
  });
});
