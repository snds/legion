// Scale-unification Phase 1 — the curated systems are now pinned to REAL
// heliocentric coordinates and a float64 galactocentric anchor. These tests
// guard the frame math (round-trip, home-at-origin), the data integrity
// (de-dup, real distances), and the regional re-pin contract consumed by
// star-catalog.ts / main.ts.

import { describe, it, expect } from 'vitest';
import catalog from '../../public/star-systems-v1.json';
import {
  CURATED_SYSTEMS, HOME_SYSTEM, galPos, distanceLy, regionalScenePos,
  type CuratedSystem,
} from './curated-systems';
import { STAR_SYSTEMS } from './star-catalog';
import { SOL_GAL_PC, WU_PER_PC } from '../core/metrics';

const byName = (n: string): CuratedSystem => {
  const s = CURATED_SYSTEMS.find((c) => c.name === n);
  if (!s) throw new Error(`no curated system "${n}"`);
  return s;
};

describe('curated systems — galactocentric anchor', () => {
  it('galPos = SOL_GAL_PC + heliocentric offset, and round-trips back', () => {
    for (const s of CURATED_SYSTEMS) {
      const g = galPos(s);
      expect(g.x).toBeCloseTo(SOL_GAL_PC.x + s.solPc.x, 9);
      expect(g.y).toBeCloseTo(SOL_GAL_PC.y + s.solPc.y, 9);
      expect(g.z).toBeCloseTo(SOL_GAL_PC.z + s.solPc.z, 9);
      // round-trip: subtracting the anchor recovers the heliocentric position
      expect(g.x - SOL_GAL_PC.x).toBeCloseTo(s.solPc.x, 9);
      expect(g.y - SOL_GAL_PC.y).toBeCloseTo(s.solPc.y, 9);
      expect(g.z - SOL_GAL_PC.z).toBeCloseTo(s.solPc.z, 9);
    }
  });

  it('Sol sits at the galactocentric anchor (origin of the heliocentric frame)', () => {
    const sol = byName('Sol');
    expect(sol.solPc).toEqual({ x: 0, y: 0, z: 0 });
    const g = galPos(sol);
    expect([g.x, g.y, g.z]).toEqual([SOL_GAL_PC.x, SOL_GAL_PC.y, SOL_GAL_PC.z]);
  });
});

describe('curated systems — real distances match the sky', () => {
  // Heliocentric distances are independently known; the pinned coordinates
  // must reproduce them (proves the catalogue match + axis mapping are right).
  const KNOWN_LY: Record<string, number> = {
    'Epsilon Eridani': 10.5, 'Tau Ceti': 11.9, 'Alpha Centauri': 4.37,
    'Sirius': 8.6, "Barnard's Star": 5.96, 'Procyon': 11.46, 'Wolf 359': 7.86,
    '61 Cygni': 11.4, 'Epsilon Indi': 11.87,
  };
  it('reproduces published heliocentric distances within 0.5 ly', () => {
    for (const [name, ly] of Object.entries(KNOWN_LY)) {
      expect(distanceLy(byName(name))).toBeCloseTo(ly, 0); // toBeCloseTo(_,0) ⇒ <0.5 ly
    }
  });
});

describe('curated systems — solPc matches the source catalogue (ground truth)', () => {
  // The "known distances" suite only checks radial magnitude against a hand-typed
  // table, so a component swap that preserves |solPc| would slip through. This
  // asserts every baked coordinate against public/star-systems-v1.json directly,
  // component-by-component — the actual source the values were extracted from.
  const rows = (catalog as { stars: Array<{ n: string; d: string; x: number; y: number; z: number }> }).stars;
  const desigTokens = (d: string) => d.split('·').map((t) => t.trim());

  it('every non-Sol system reproduces its catalogue x/y/z exactly', () => {
    for (const s of CURATED_SYSTEMS) {
      if (s.name === 'Sol') continue; // Sol is the heliocentric origin, excluded from the catalogue
      const matches = rows.filter((r) => desigTokens(r.d).includes(s.desig));
      expect(matches, `desig "${s.desig}" (${s.name})`).toHaveLength(1);
      const r = matches[0];
      expect(s.solPc.x, `${s.name}.x`).toBeCloseTo(r.x, 3);
      expect(s.solPc.y, `${s.name}.y`).toBeCloseTo(r.y, 3);
      expect(s.solPc.z, `${s.name}.z`).toBeCloseTo(r.z, 3);
    }
  });
});

describe('curated systems — single source of truth (de-dup)', () => {
  it('has no duplicate names', () => {
    const names = CURATED_SYSTEMS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has no two systems at the same point (≥0.01 pc apart)', () => {
    for (let i = 0; i < CURATED_SYSTEMS.length; i++) {
      for (let j = i + 1; j < CURATED_SYSTEMS.length; j++) {
        const a = CURATED_SYSTEMS[i].solPc, b = CURATED_SYSTEMS[j].solPc;
        const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        expect(d).toBeGreaterThan(0.01);
      }
    }
  });

  it('provides exactly one canonical record per star shared with the galactic tier', () => {
    // Phase 2c-1 Inc 4 RECONCILED the tiers: galaxy.ts now renders its markers
    // straight from CURATED_SYSTEMS at galPos(), so this catalogue is the single
    // source for both the regional and galactic tiers. Asserts it stays well-
    // formed: one canonical record per star (no duplicate galactic/regional rows).
    const sharedWithGalacticTier = ['Sol', 'Epsilon Eridani', 'Tau Ceti', 'Sirius', 'Procyon', 'Wolf 359', '61 Cygni'];
    for (const n of sharedWithGalacticTier) {
      expect(CURATED_SYSTEMS.filter((s) => s.name === n)).toHaveLength(1);
    }
  });
});

describe('curated systems — regional scene frame', () => {
  it('home (ε Eridani) is the origin of the regional frame', () => {
    expect(HOME_SYSTEM.name).toBe('Epsilon Eridani');
    expect(HOME_SYSTEM.isHome).toBe(true);
    const p = regionalScenePos(HOME_SYSTEM);
    expect(p.length()).toBeLessThan(1e-9);
  });

  it('exactly one home system', () => {
    expect(CURATED_SYSTEMS.filter((s) => s.isHome)).toHaveLength(1);
  });

  it('regional positions are the real home-relative offset × the unified scale', () => {
    const sol = byName('Sol');
    const p = regionalScenePos(sol);
    // Sol−home offset (pc) × WU_PER_PC (unified 1000 WU/pc), component-wise
    expect(p.x).toBeCloseTo((sol.solPc.x - HOME_SYSTEM.solPc.x) * WU_PER_PC, 6);
    expect(p.y).toBeCloseTo((sol.solPc.y - HOME_SYSTEM.solPc.y) * WU_PER_PC, 6);
    expect(p.z).toBeCloseTo((sol.solPc.z - HOME_SYSTEM.solPc.z) * WU_PER_PC, 6);
    // Sol is ~10.49 ly = 3.216 pc from ε Eridani → ×1000 WU/pc ≈ 3216 WU
    expect(p.length()).toBeCloseTo(3216, -1);
  });

  it('the whole neighbourhood is a compact bubble at the unified scale', () => {
    // Phase 2c-1 Inc 6: the neighbourhood rides 1000 WU/pc, so the farthest
    // curated system sits ~5400 WU from home (was ~3875 at the retired ×220).
    let farthest = { name: '', wu: 0 };
    for (const s of CURATED_SYSTEMS) {
      const wu = regionalScenePos(s).length();
      expect(wu).toBeLessThan(6000);
      if (wu > farthest.wu) farthest = { name: s.name, wu };
    }
    // Ross 154 is the most distant from ε Eridani (~17.6 ly → ~5400 WU)
    expect(farthest.name).toBe('Ross 154');
    expect(farthest.wu).toBeGreaterThan(5000);
  });
});

describe('STAR_SYSTEMS derivation (consumer contract)', () => {
  it('mirrors the canonical record, in order, with scene-WU coordinates', () => {
    expect(STAR_SYSTEMS).toHaveLength(CURATED_SYSTEMS.length);
    STAR_SYSTEMS.forEach((sc, i) => {
      const s = CURATED_SYSTEMS[i];
      const p = regionalScenePos(s);
      expect(sc.name).toBe(s.name);
      expect(sc.x).toBeCloseTo(p.x, 6);
      expect(sc.y).toBeCloseTo(p.y, 6);
      expect(sc.z).toBeCloseTo(p.z, 6);
      expect(sc.isHome).toBe(s.isHome);
      expect(sc.planetCount).toBe(s.planetCount);
    });
  });

  it('places home at the scene origin', () => {
    const home = STAR_SYSTEMS.find((s) => s.isHome)!;
    expect(Math.hypot(home.x, home.y, home.z)).toBeLessThan(1e-9);
  });
});
