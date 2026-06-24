// Region/LOD fill pass — the corridor planner. Proves it walks home→core as a deduped, deterministic
// disc-plane swath spanning the full radius (so the stress pass covers the density ramp to the core).

import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { cellForGalPc, cellKey, HOME_GAL_PC } from './sector';
import { planCorridorSectors } from './sector-fill';

describe('Fill corridor planner', () => {
  const CORE = new Vector3(0, 0, 0);
  const cells = planCorridorSectors(new Vector3(HOME_GAL_PC.x, HOME_GAL_PC.y, HOME_GAL_PC.z), CORE);

  it('produces a substantial deduped swath', () => {
    expect(cells.length).toBeGreaterThan(80); // ~9-12 regions × 16 sectors
    const keys = cells.map(cellKey);
    expect(new Set(keys).size).toBe(keys.length); // no duplicates
  });

  it('lies in the home disc-plane layer', () => {
    const homeJ = cellForGalPc(new Vector3(HOME_GAL_PC.x, HOME_GAL_PC.y, HOME_GAL_PC.z)).j;
    expect(cells.every((c) => c.j === homeJ)).toBe(true);
  });

  it('spans the full radius from the core to home (the density ramp)', () => {
    const iVals = cells.map((c) => c.i);
    const homeI = cellForGalPc(new Vector3(HOME_GAL_PC.x, HOME_GAL_PC.y, HOME_GAL_PC.z)).i;
    expect(Math.max(...iVals)).toBeGreaterThanOrEqual(homeI - 4); // reaches home (~i=33)
    expect(Math.min(...iVals)).toBeLessThanOrEqual(4);            // reaches the core (~i=0)
  });

  it('is deterministic', () => {
    const again = planCorridorSectors(new Vector3(HOME_GAL_PC.x, HOME_GAL_PC.y, HOME_GAL_PC.z), CORE);
    expect(again.map(cellKey)).toEqual(cells.map(cellKey));
  });
});
