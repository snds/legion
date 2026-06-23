// Sector-cloud prototype Inc 1 — the skeleton's load-bearing math: containment,
// the float-safe frame (sector-local == regionalScenePos; group rides −R), and the
// grid index (incl. the boundary-split that justifies the centre-based prototype).

import { describe, it, expect, afterEach } from 'vitest';
import { Vector3 } from 'three';
import { CURATED_SYSTEMS, HOME_SYSTEM, galPos, regionalScenePos } from '../../data/curated-systems';
import { WU_PER_PC } from '../../core/metrics';
import { Broker } from '../scale-manager';
import {
  createHomeSector, createSector, galPcToSectorLocalWU, updateSectorFrame,
  cellForGalPc, cellCenterPc, cellKey, HOME_GAL_PC, DEFAULT_SECTOR_EDGE_PC,
} from './sector';

const galVec = (name: string): Vector3 => {
  const g = galPos(CURATED_SYSTEMS.find((s) => s.name === name)!);
  return new Vector3(g.x, g.y, g.z);
};

afterEach(() => Broker.setRebase(new Vector3(0, 0, 0))); // restore identity for other suites

describe('Sector — home sector (centre-based, prototype)', () => {
  it('contains the whole curated neighbourhood (all within ½·250 pc of home)', () => {
    const s = createHomeSector();
    expect(s.systems.length).toBe(CURATED_SYSTEMS.length);
    const names = s.systems.map((x) => x.name);
    expect(names).toContain('Epsilon Eridani');
    expect(names).toContain('Sol');
  });

  it('home sector centre is the scene origin (home at 0,0,0 absolute)', () => {
    const s = createHomeSector();
    expect(s.centerPc.x).toBeCloseTo(galPos(HOME_SYSTEM).x, 6);
    expect(s.centerAbsWU.length()).toBeLessThan(1e-9);
  });

  it('sector-local placement == regionalScenePos (markers already live there)', () => {
    const s = createHomeSector();
    for (const name of ['Sol', 'Tau Ceti', 'Ross 154']) {
      const local = galPcToSectorLocalWU(s, galVec(name));
      const reg = regionalScenePos(CURATED_SYSTEMS.find((x) => x.name === name)!);
      expect(local.x).toBeCloseTo(reg.x, 3);
      expect(local.y).toBeCloseTo(reg.y, 3);
      expect(local.z).toBeCloseTo(reg.z, 3);
    }
  });

  it('updateSectorFrame rides the floating origin (group pos = centreAbs − R)', () => {
    const s = createHomeSector(); // centreAbs = (0,0,0)
    const R = new Vector3(8_300_000, 5_000, -2_000);
    Broker.setRebase(R);
    updateSectorFrame(s);
    expect(s.group.position.x).toBeCloseTo(-R.x, 2);
    expect(s.group.position.y).toBeCloseTo(-R.y, 2);
    expect(s.group.position.z).toBeCloseTo(-R.z, 2);
  });

  it('a non-home sector centre maps to the right absolute WU and is empty in the void', () => {
    const c = new Vector3(HOME_GAL_PC.x - 1000, HOME_GAL_PC.y, HOME_GAL_PC.z); // 1 kpc toward core
    const s = createSector(c, DEFAULT_SECTOR_EDGE_PC);
    expect(s.centerAbsWU.x).toBeCloseTo(-1000 * WU_PER_PC, 3); // −1e6 WU
    expect(s.systems.length).toBe(0);
  });
});

describe('Sector — grid index (Phase B)', () => {
  it('cellForGalPc / cellCenterPc place a point in its cell', () => {
    const cell = cellForGalPc(new Vector3(8297.9, -2.4, -0.6), 250);
    expect(cell).toEqual({ i: 33, j: -1, k: -1 });
    const ctr = cellCenterPc(cell, 250);
    expect(ctr.x).toBeCloseTo(8375);
    expect(ctr.y).toBeCloseTo(-125);
    expect(ctr.z).toBeCloseTo(-125);
  });

  it('a naive grid SPLITS the neighbourhood — ε Eridani and Sol land in different cells', () => {
    // home y=-2.4 → j=-1; Sol y=0 → j=0. Documents why Phase B needs a region level
    // or boundary overlap (docs §10), and why the prototype uses a centre-based sector.
    const ch = cellForGalPc(galVec('Epsilon Eridani'), 250);
    const cs = cellForGalPc(galVec('Sol'), 250);
    expect(cellKey(cs)).not.toBe(cellKey(ch));
  });
});
