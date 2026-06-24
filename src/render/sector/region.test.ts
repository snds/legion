// Region/LOD backbone Inc 1 — the coarse 1 kpc index math. Proves the load-bearing claims:
// region↔centre round-trip anywhere (NO home-centricity), deterministic keys/seeds, hysteresis
// across a boundary, and the 4×4 sector-subgrid relationship (1 kpc = 4 × 250 pc).

import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { cellForGalPc, DEFAULT_SECTOR_EDGE_PC, HOME_GAL_PC } from './sector';
import {
  REGION_EDGE_PC, regionForGalPc, regionCenterPc, hystereticRegionCell,
  regionKey, regionSeedKey, classifyDensity, classifyArmPhase,
} from './region';
import { emissionAtGalPc, REF_EMISSION } from './sector-stars';

describe('Region index — cell math, anywhere in the galaxy', () => {
  // Sampled across the galaxy with NO reference to home — the index is position-pure.
  const PLACES: [string, Vector3][] = [
    ['core', new Vector3(0, 0, 0)],
    ['home', new Vector3(8297.93, -2.39, -0.59)],
    ['arm crest', new Vector3(-6200, 5, 9100)],
    ['far void', new Vector3(14000, 1200, -13000)],
  ];

  it('regionForGalPc → regionCenterPc lands back in the same region (round-trip)', () => {
    for (const [name, g] of PLACES) {
      const r = regionForGalPc(g);
      const back = regionForGalPc(regionCenterPc(r));
      expect(regionKey(back), name).toBe(regionKey(r));
      // the point sits within ±half-edge of its region centre, every axis
      const c = regionCenterPc(r);
      for (const ax of ['x', 'y', 'z'] as const) {
        expect(Math.abs(g[ax] - c[ax]), `${name}.${ax}`).toBeLessThanOrEqual(REGION_EDGE_PC / 2 + 1e-6);
      }
    }
  });

  it('keys + seeds are deterministic and carry distinct prefixes', () => {
    const r = regionForGalPc(new Vector3(8297.93, -2.39, -0.59));
    expect(regionKey(r)).toBe(regionKey(regionForGalPc(new Vector3(8297.93, -2.39, -0.59))));
    expect(regionSeedKey(r)).toBe(regionSeedKey(r));
    expect(regionKey(r).startsWith('R:')).toBe(true);        // distinct from a sector cellKey
    expect(regionSeedKey(r).startsWith('region:')).toBe(true);
  });

  it('region identity is pure of HOME_GAL_PC (same triple → same key regardless of origin)', () => {
    // Two arbitrary absolute positions; the index depends only on galPc, never on home.
    const a = regionForGalPc(new Vector3(2500, 0, 2500)); // i=2,j=0,k=2
    expect(regionKey(a)).toBe('R:2|0|2');
    const b = regionForGalPc(new Vector3(-1, -1, -1));     // floor(-1/1000) = -1 each
    expect(regionKey(b)).toBe('R:-1|-1|-1');
  });
});

describe('Region index — 4×4 sector subgrid (1 kpc = 4 × 250 pc)', () => {
  it('a region spans exactly 4 sector cells per disc-plane axis', () => {
    expect(REGION_EDGE_PC / DEFAULT_SECTOR_EDGE_PC).toBe(4);
    // every sector cell whose centre is inside region (0,0,0) shares its region
    const inside = new Set<string>();
    for (let si = 0; si < 4; si++) {
      for (let sk = 0; sk < 4; sk++) {
        const centrePc = new Vector3((si + 0.5) * 250, 125, (sk + 0.5) * 250);
        inside.add(`${cellForGalPc(centrePc).i}|${cellForGalPc(centrePc).k}`);
        expect(regionKey(regionForGalPc(centrePc))).toBe('R:0|0|0');
      }
    }
    expect(inside.size).toBe(16); // 4×4 distinct sector cells map into the one region
  });
});

describe('Region index — hysteresis (no coarse-boundary thrash)', () => {
  it('with no current region, picks the raw region', () => {
    const g = new Vector3(2500, 100, 2500);
    expect(regionKey(hystereticRegionCell(g, null))).toBe(regionKey(regionForGalPc(g)));
  });

  it('holds the current region for a sub-margin jitter across a boundary', () => {
    const current = { i: 0, j: 0, k: 0 };          // x slab [0, 1000)
    const g = new Vector3(1100, 500, 500);          // x = 1100, only 100 pc past the i=1 boundary (< 150)
    expect(hystereticRegionCell(g, current).i).toBe(0); // stays — region boundaries are 4× rarer
  });

  it('switches once the focus clears the 150 pc margin', () => {
    const current = { i: 0, j: 0, k: 0 };
    const g = new Vector3(1200, 500, 500);          // x = 1200 > 150 past the boundary
    expect(hystereticRegionCell(g, current).i).toBe(1);
  });

  it('a large move jumps straight to the correct distant region', () => {
    const current = { i: 0, j: 0, k: 0 };
    const g = new Vector3(8300, 0, 0);              // i = floor(8300/1000) = 8
    expect(hystereticRegionCell(g, current).i).toBe(8);
  });
});

describe('Region metadata — pure classifiers', () => {
  it('classifyDensity bands the emission ratio (home ≈ 1 → nominal, core ≫ → core)', () => {
    expect(classifyDensity(8)).toBe('core');
    expect(classifyDensity(1.5)).toBe('dense');
    expect(classifyDensity(1.0)).toBe('nominal');
    expect(classifyDensity(0.2)).toBe('sparse');
    expect(classifyDensity(0.01)).toBe('void');
    // boundaries are inclusive-low
    expect(classifyDensity(4)).toBe('core');
    expect(classifyDensity(1.3)).toBe('dense');
    expect(classifyDensity(0.35)).toBe('nominal');
    expect(classifyDensity(0.06)).toBe('sparse');
  });

  it('classifyArmPhase: core inside ~3 kpc, else crest/flank/gap by ridge', () => {
    expect(classifyArmPhase(0.0, 500)).toBe('core');   // R < 1000 native — bulge/bar
    expect(classifyArmPhase(0.9, 500)).toBe('core');   // core wins regardless of ridge
    expect(classifyArmPhase(0.7, 2800)).toBe('crest'); // ~8.4 kpc, on a ridge
    expect(classifyArmPhase(0.2, 2800)).toBe('flank');
    expect(classifyArmPhase(0.0, 2800)).toBe('gap');   // inter-arm
  });
});

describe('Region metadata — real density model (sensible labels across the galaxy)', () => {
  it('emission ranks core > home > off-plane void, and the classes follow', () => {
    const ratioCore = emissionAtGalPc(0, 0, 0) / REF_EMISSION;
    const ratioHome = emissionAtGalPc(HOME_GAL_PC.x, HOME_GAL_PC.y, HOME_GAL_PC.z) / REF_EMISSION;
    const ratioVoid = emissionAtGalPc(8300, 5000, 0) / REF_EMISSION; // 5 kpc above the plane
    expect(ratioCore).toBeGreaterThan(ratioHome);
    expect(ratioHome).toBeGreaterThan(ratioVoid);
    expect(classifyDensity(ratioCore)).toBe('core');   // the galactic centre is ≫ the solar circle
    expect(classifyDensity(ratioVoid)).toBe('void');   // far off the thin disc
    expect(['nominal', 'sparse', 'dense']).toContain(classifyDensity(ratioHome)); // home ≈ reference
  });
});
