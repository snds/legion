// ═══════════════════════════════════════════════════════════════════
// SCHWARZSCHILD GR MATH TESTS — the physics, pinned against known results
//
// These lock the math the GLSL shader mirrors to textbook GR values, so a
// regression in the ported integrator or g-factor fails in CI before it ever
// reaches a pixel: characteristic radii, weak-field deflection 4M/b, capture at
// b_crit = 3√3 M, the photon-ring winding just outside it, ISCO velocity c/2,
// and the disk temperature falloff T ∝ r^(−3/4).
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import {
  eventHorizon, photonSphere, criticalImpactParameter, isco,
  weakFieldDeflection, temperatureProfile, diskFluxProfile, peakFluxRadius,
  gravitationalRedshift, orbitalBeta, redshiftFactor, traceFromInfinity,
} from './schwarzschild';

describe('characteristic radii (Schwarzschild)', () => {
  const M = 1;
  it('event horizon r_s = 2M', () => {
    expect(eventHorizon(M)).toBeCloseTo(2, 12);
  });
  it('photon sphere = 3M = 1.5 r_s', () => {
    expect(photonSphere(M)).toBeCloseTo(3, 12);
    expect(photonSphere(M)).toBeCloseTo(1.5 * eventHorizon(M), 12);
  });
  it('critical impact parameter = 3√3 M ≈ 5.196 M', () => {
    expect(criticalImpactParameter(M)).toBeCloseTo(5.19615242, 6);
  });
  it('ISCO = 6M = 3 r_s', () => {
    expect(isco(M)).toBeCloseTo(6, 12);
    expect(isco(M)).toBeCloseTo(3 * eventHorizon(M), 12);
  });
  it('radii scale linearly with M', () => {
    expect(criticalImpactParameter(5)).toBeCloseTo(5 * criticalImpactParameter(1), 10);
    expect(isco(2.5)).toBeCloseTo(2.5 * 6, 10);
  });
});

describe('null-geodesic integrator — deflection & capture', () => {
  const M = 1;

  it('reproduces the GR deflection series 4M/b + (15π/4−4)(M/b)² for large b', () => {
    // The exact strong-lensing expansion: leading Einstein term 4M/b plus the
    // (positive) second-order correction. The integrator must sit above the pure
    // first-order value and match the two-term series to sub-percent, converging
    // as b grows — that is the real physical statement, not agreement with 4M/b
    // alone (which is already ~4% low at b = 50 because GR bends more).
    let prevErr = Infinity;
    for (const b of [100, 200, 400]) {
      const { captured, deflection } = traceFromInfinity(b, M);
      expect(captured).toBe(false);
      const firstOrder = weakFieldDeflection(b, M);          // 4M/b
      const series = firstOrder + ((15 * Math.PI) / 4 - 4) * (M / b) ** 2;
      expect(deflection).toBeGreaterThan(firstOrder);        // 2nd-order is positive
      const relErr = Math.abs(deflection - series) / series;
      expect(relErr).toBeLessThan(0.015);
      expect(relErr).toBeLessThan(prevErr);                  // converges with b
      prevErr = relErr;
    }
  });

  it('captures photons below the critical impact parameter', () => {
    const bCrit = criticalImpactParameter(M);
    expect(traceFromInfinity(bCrit * 0.9, M).captured).toBe(true);
    expect(traceFromInfinity(bCrit * 0.5, M).captured).toBe(true);
    expect(traceFromInfinity(bCrit * 0.99, M).captured).toBe(true);
  });

  it('escapes just above the critical impact parameter', () => {
    const bCrit = criticalImpactParameter(M);
    expect(traceFromInfinity(bCrit * 1.02, M).captured).toBe(false);
    expect(traceFromInfinity(bCrit * 1.1, M).captured).toBe(false);
  });

  it('winds strongly (photon ring) as b → b_crit from above', () => {
    const bCrit = criticalImpactParameter(M);
    const near = traceFromInfinity(bCrit * 1.001, M);
    const far = traceFromInfinity(bCrit * 2.0, M);
    expect(near.captured).toBe(false);
    // Deflection diverges logarithmically at b_crit → far more bending + steps.
    expect(near.deflection).toBeGreaterThan(far.deflection);
    expect(near.deflection).toBeGreaterThan(Math.PI); // wound past a half-turn
    expect(near.steps).toBeGreaterThan(far.steps);
  });

  it('deflection increases monotonically as b shrinks toward b_crit', () => {
    const M2 = 1;
    let prev = 0;
    for (const b of [20, 12, 8, 6.5, 5.5]) {
      const d = traceFromInfinity(b, M2).deflection;
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
  });
});

describe('accretion-disk thermodynamics', () => {
  const rIn = 6; // ISCO for M=1

  it('flux is zero at and inside the inner edge', () => {
    expect(diskFluxProfile(rIn, rIn)).toBe(0);
    expect(diskFluxProfile(rIn * 0.5, rIn)).toBe(0);
  });

  it('temperature peaks near ~49/36 r_in then falls', () => {
    const rPeak = peakFluxRadius(rIn);
    const tPeak = temperatureProfile(rPeak, rIn);
    expect(tPeak).toBeGreaterThan(temperatureProfile(rIn * 1.01, rIn));
    expect(tPeak).toBeGreaterThan(temperatureProfile(rIn * 4, rIn));
  });

  it('follows T ∝ r^(−3/4) in the outer disk', () => {
    // Far from the inner edge the (1 − √(r_in/r)) term → 1, so T ∝ r^(−3/4).
    const r1 = 200, r2 = 400;
    const ratio = temperatureProfile(r1, rIn) / temperatureProfile(r2, rIn);
    expect(ratio).toBeCloseTo(Math.pow(r2 / r1, 0.75), 1);
  });
});

describe('relativistic disk kinematics (g factor)', () => {
  const M = 1;

  it('ISCO orbital speed is exactly c/2', () => {
    expect(orbitalBeta(6, M)).toBeCloseTo(0.5, 6);
  });

  it('gravitational redshift → 0 at the horizon, → 1 far away', () => {
    expect(gravitationalRedshift(2.0001, M)).toBeLessThan(0.01);
    expect(gravitationalRedshift(1e6, M)).toBeCloseTo(1, 4);
  });

  it('approaching side is blueshifted+beamed, receding side redshifted', () => {
    const r = 10;
    const approaching = redshiftFactor(r, M, +1); // velocity toward observer
    const receding = redshiftFactor(r, M, -1);
    expect(approaching).toBeGreaterThan(1);   // g > 1 → blueshift + brightening
    expect(receding).toBeLessThan(1);         // g < 1 → redshift + dimming
    expect(approaching).toBeGreaterThan(receding);
  });

  it('beaming asymmetry (g³) is dramatic near the inner disk', () => {
    const r = 6.5;
    const gA = redshiftFactor(r, M, +1);
    const gR = redshiftFactor(r, M, -1);
    // Intensity scales as g³ — the approaching/receding brightness ratio is large.
    const brightnessRatio = (gA * gA * gA) / (gR * gR * gR);
    expect(brightnessRatio).toBeGreaterThan(5);
  });
});
