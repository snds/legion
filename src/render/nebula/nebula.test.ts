// ═══════════════════════════════════════════════════════════════════
// NEBULA PRIMITIVE TESTS — determinism + physical/LOD invariants.
//
// The primitive must be byte-deterministic from its params (a seed change is a
// "universe reset", per the plan's determinism discipline) and its authored
// shell stack must encode the emission-ramp + graduated-opacity structure the
// shader consumes. These assertions lock both, and — like galaxy-density.test —
// snapshot the TS field so any structural drift is caught in CI (the GLSL is a
// downstream 1:1 mirror, see nebula-noise.ts).
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { SOL_GAL_PC } from '../../core/metrics';
import { nbHash3, nbValueNoise3, nbFbm3, nbWarpedFbm3 } from './nebula-noise';
import { buildShellSpecs, type NebulaParams } from './nebula';
import { galPosFromGalactic, pullbackTaper } from './nebula-placement';

const BASE: NebulaParams = {
  galPosPc: { x: 8000, y: -100, z: -150 },
  radiusPc: 42,
  shellCount: 5,
  seed: 'orion-m42',
};

describe('nebula noise — deterministic value-noise + fBm (TS↔GLSL mirror)', () => {
  it('nbHash3 is reproducible and in [0,1)', () => {
    const a = nbHash3(3, 7, 11);
    expect(a).toBe(nbHash3(3, 7, 11));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });

  it('nbValueNoise3 / nbFbm3 stay in [0,1] over a scan', () => {
    for (let i = 0; i < 40; i++) {
      const p = i * 0.37;
      expect(nbValueNoise3(p, p * 1.3, -p)).toBeGreaterThanOrEqual(0);
      expect(nbValueNoise3(p, p * 1.3, -p)).toBeLessThanOrEqual(1);
      const f = nbFbm3(p, -p * 0.5, p * 2);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it('domain warp perturbs the field (kills banding) yet stays bounded', () => {
    const plain = nbFbm3(1.1, 2.2, 3.3);
    const warped = nbWarpedFbm3(1.1, 2.2, 3.3, 1.0);
    expect(warped).not.toBe(plain);          // the warp actually moved the sample
    expect(warped).toBeGreaterThanOrEqual(0);
    expect(warped).toBeLessThanOrEqual(1);
    expect(nbWarpedFbm3(1.1, 2.2, 3.3, 0)).toBe(plain); // warp=0 ⇒ identity
  });

  it('matches the recorded field sample table (update deliberately, in both mirrors)', () => {
    const pts: [number, number, number][] = [
      [0, 0, 0], [1.7, -2.3, 0.9], [10.5, 4.2, -6.1], [-3.3, 3.3, 3.3],
    ];
    const got = pts.map(([x, y, z]) => ({
      valueNoise: Number(nbValueNoise3(x, y, z).toFixed(6)),
      fbm: Number(nbFbm3(x, y, z).toFixed(6)),
      warped: Number(nbWarpedFbm3(x, y, z, 1).toFixed(6)),
    }));
    expect(got).toMatchSnapshot();
  });
});

describe('nebula shell specs — deterministic + graduated structure', () => {
  it('is deterministic: same params ⇒ identical specs', () => {
    expect(buildShellSpecs(BASE)).toEqual(buildShellSpecs(BASE));
  });

  it('a different seed relocates the field offsets (universe reset)', () => {
    const a = buildShellSpecs(BASE);
    const b = buildShellSpecs({ ...BASE, seed: 'crab' });
    expect(a[0].seed).not.toEqual(b[0].seed);
    // …but the deterministic geometry ramp (radius/opacity/colorT) is unchanged.
    expect(a.map(s => s.radiusWU)).toEqual(b.map(s => s.radiusWU));
  });

  it('shells nest outward with graduated (falling) opacity — Orlando technique', () => {
    const s = buildShellSpecs(BASE);
    expect(s).toHaveLength(5);
    for (let i = 1; i < s.length; i++) {
      expect(s[i].radiusWU).toBeGreaterThan(s[i - 1].radiusWU); // radius grows
      expect(s[i].opacity).toBeLessThan(s[i - 1].opacity);      // opacity falls
    }
  });

  it('emission ramp: core shell = teal end (colorT 0), outer = dust end (colorT 1)', () => {
    const s = buildShellSpecs(BASE);
    expect(s[0].colorT).toBe(0);                 // hot/dense core → [OIII] teal
    expect(s[s.length - 1].colorT).toBe(1);      // envelope → H-alpha/dust
    for (let i = 1; i < s.length; i++) {
      expect(s[i].colorT).toBeGreaterThan(s[i - 1].colorT); // monotonic ramp
      expect(s[i].warp).toBeGreaterThan(s[i - 1].warp);     // outer = more filamentary
    }
  });

  it('outer shell radius = radiusPc·WU_PER_PC; core = coreFraction of it', () => {
    const s = buildShellSpecs(BASE);
    expect(s[s.length - 1].radiusWU).toBeCloseTo(42 * 1000, 3);
    expect(s[0].radiusWU).toBeCloseTo(42 * 1000 * 0.34, 3);
  });

  it('respects a minimum of 2 shells', () => {
    expect(buildShellSpecs({ ...BASE, shellCount: 1 })).toHaveLength(2);
  });

  it('matches the recorded shell-spec table', () => {
    expect(buildShellSpecs(BASE)).toMatchSnapshot();
  });
});

describe('nebula placement — galactic (l,b,d) → galactocentric pc', () => {
  it('offset magnitude from Sol equals the heliocentric distance', () => {
    const g = galPosFromGalactic(209.01, -19.38, 412);
    const d = Math.hypot(g.x - SOL_GAL_PC.x, g.y - SOL_GAL_PC.y, g.z - SOL_GAL_PC.z);
    expect(d).toBeCloseTo(412, 6);
  });

  it('l=0,b=0 points along +X toward the GC anchor (gx term); NGP is +Y', () => {
    const gc = galPosFromGalactic(0, 0, 100);
    expect(gc.x - SOL_GAL_PC.x).toBeCloseTo(100, 6); // full offset on X
    expect(gc.y - SOL_GAL_PC.y).toBeCloseTo(0, 6);
    expect(gc.z - SOL_GAL_PC.z).toBeCloseTo(0, 6);
    const pole = galPosFromGalactic(123, 90, 50);    // straight up → vertical (Y)
    expect(pole.y - SOL_GAL_PC.y).toBeCloseTo(50, 6);
  });
});

describe('nebula zoom LOD — pull-back taper', () => {
  it('full presence across galaxy framing, 0 on deep pull-back, monotonic', () => {
    expect(pullbackTaper(2e6, 42)).toBe(1);       // galaxy-framing onset
    expect(pullbackTaper(1e9, 42)).toBe(0);       // whole-galaxy speck
    const mid = pullbackTaper(2e7, 42);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // strictly non-increasing as the camera pulls back
    let prev = 1;
    for (let c = 5e6; c <= 4e7; c += 2.5e6) {
      const v = pullbackTaper(c, 42);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
});
