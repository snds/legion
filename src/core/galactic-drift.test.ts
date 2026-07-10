import { describe, it, expect } from 'vitest';
import { driftGalPc, driftedRegionalScenePos, gameTimeToMyr, SECONDS_PER_MYR } from './galactic-drift';
import { galacticYear_Myr } from '../render/mw-model';
import { CURATED_SYSTEMS, HOME_SYSTEM, regionalScenePos } from '../data/curated-systems';
import { SOL_GAL_PC } from './metrics';

const out = { x: 0, y: 0, z: 0 };

describe('driftGalPc — differential galactic rotation', () => {
  it('is the identity at t = 0', () => {
    driftGalPc(8300, 12, -40, 0, out);
    expect(out).toEqual({ x: 8300, y: 12, z: -40 });
  });

  it('preserves in-plane radius and leaves y (galactic Z) untouched', () => {
    driftGalPc(8300, 25, 100, 137.5, out);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(Math.hypot(8300, 100), 6);
    expect(out.y).toBe(25);
  });

  it('completes one full orbit in one galactic year (~216 Myr at Sol)', () => {
    const period = galacticYear_Myr(8.3);
    expect(period).toBeGreaterThan(180);
    expect(period).toBeLessThan(260);
    driftGalPc(8300, 0, 0, period, out);
    expect(out.x).toBeCloseTo(8300, 4);
    expect(Math.abs(out.z)).toBeLessThan(1e-4);
  });

  it('rotates with the disc convention (ω = −Ω): z goes NEGATIVE from +x', () => {
    // Documents the sign contract with galaxy-physical's baked orbit elements
    // (orbits[i·4+3] = −angularSpeed): a marker must co-rotate with the disc.
    driftGalPc(8300, 0, 0, 10, out);
    expect(out.z).toBeLessThan(0);
  });

  it('shears differentially — inner systems sweep more azimuth than outer', () => {
    const inner = { x: 0, y: 0, z: 0 };
    const outer = { x: 0, y: 0, z: 0 };
    driftGalPc(4000, 0, 0, 50, inner);
    driftGalPc(12000, 0, 0, 50, outer);
    const phiInner = Math.abs(Math.atan2(inner.z, inner.x));
    const phiOuter = Math.abs(Math.atan2(outer.z, outer.x));
    expect(phiInner).toBeGreaterThan(phiOuter);
  });
});

describe('driftedRegionalScenePos — home-relative drifted frame', () => {
  it('reproduces regionalScenePos exactly at t = 0 (all curated systems)', () => {
    for (const sys of CURATED_SYSTEMS) {
      const expected = regionalScenePos(sys);
      driftedRegionalScenePos(sys.solPc, 0, out);
      // 1e-6 WU: the galactocentric anchor add/subtract round-trip costs
      // ~1e-9 WU of float64 cancellation noise vs the direct subtraction.
      expect(out.x).toBeCloseTo(expected.x, 6);
      expect(out.y).toBeCloseTo(expected.y, 6);
      expect(out.z).toBeCloseTo(expected.z, 6);
    }
  });

  it('keeps home pinned at the origin for all t (the frame is home-relative)', () => {
    driftedRegionalScenePos(HOME_SYSTEM.solPc, 300, out);
    expect(Math.hypot(out.x, out.y, out.z)).toBeLessThan(1e-6);
  });

  it('drifts Sol relative to home — solar-system drift is accounted for', () => {
    const sol = CURATED_SYSTEMS.find((s) => s.name === 'Sol')!;
    const epoch = regionalScenePos(sol);
    driftedRegionalScenePos(sol.solPc, 100, out); // 100 Myr — huge, for signal
    const moved = Math.hypot(out.x - epoch.x, out.y - epoch.y, out.z - epoch.z);
    expect(moved).toBeGreaterThan(1); // WU — differential shear across ~2 pc of ΔR
    // Order-of-magnitude check: Oort-type shear over Sol↔home's ~2 pc radial
    // offset accumulates parsecs per 100 Myr, not tens of parsecs.
    expect(moved).toBeLessThan(20 * 1000); // < 20 pc of relative drift
  });

  it('regional drift is microscopic at gameplay time scales (correctness, not spectacle)', () => {
    const sol = CURATED_SYSTEMS.find((s) => s.name === 'Sol')!;
    const epoch = regionalScenePos(sol);
    const tenYears = gameTimeToMyr(10 * 3.15576e7);
    driftedRegionalScenePos(sol.solPc, tenYears, out);
    const moved = Math.hypot(out.x - epoch.x, out.y - epoch.y, out.z - epoch.z);
    expect(moved).toBeLessThan(0.01); // < 1/100 WU after a decade at Sol's range
  });
});

describe('gameTimeToMyr', () => {
  it('converts float64 game seconds to Myr', () => {
    expect(gameTimeToMyr(SECONDS_PER_MYR)).toBe(1);
    expect(gameTimeToMyr(0)).toBe(0);
  });
});

describe('epoch anchor sanity', () => {
  it('Sol sits at the model R0 (galactocentric ~8.3 kpc)', () => {
    expect(Math.hypot(SOL_GAL_PC.x, SOL_GAL_PC.z)).toBeCloseTo(8300, 0);
  });
});
