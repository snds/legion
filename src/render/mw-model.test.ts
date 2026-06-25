// MW model (P0) — locks the kinematic relations the whole density-wave galaxy hangs on: the rotation
// curve, Ω, the epicyclic κ (κ = √2·Ω for a flat curve), the ~216 Myr galactic year, and corotation.

import { describe, it, expect } from 'vitest';
import {
  MW, flatCurve, circularSpeed_kms, angularSpeed_radPerMyr, epicyclicFreq_radPerMyr,
  galacticYear_Myr, corotationRadius_kpc,
} from './mw-model';

describe('rotation curve', () => {
  it('flat curve holds Θ0 everywhere; the declining curve falls outward', () => {
    expect(circularSpeed_kms(MW.R0_kpc, flatCurve())).toBeCloseTo(MW.THETA0_kms, 6);
    expect(circularSpeed_kms(20, flatCurve())).toBeCloseTo(MW.THETA0_kms, 6);
    const inner = circularSpeed_kms(MW.R0_kpc - 1);
    const outer = circularSpeed_kms(MW.R0_kpc + 1);
    expect(outer).toBeLessThan(inner);                       // gently declining
    expect(circularSpeed_kms(MW.R0_kpc)).toBeCloseTo(MW.THETA0_kms, 6); // Θ(R0) = Θ0 by construction
  });
});

describe('angular speed Ω', () => {
  it('falls with radius (differential rotation: the inner disc laps the outer)', () => {
    expect(angularSpeed_radPerMyr(4)).toBeGreaterThan(angularSpeed_radPerMyr(12));
  });
});

describe('epicyclic frequency κ', () => {
  it('equals √2·Ω exactly for a flat rotation curve', () => {
    const omega = angularSpeed_radPerMyr(MW.R0_kpc, flatCurve());
    const kappa = epicyclicFreq_radPerMyr(MW.R0_kpc, flatCurve());
    expect(kappa).toBeCloseTo(Math.SQRT2 * omega, 12);
  });

  it('is slightly SUB-√2·Ω for the gently-declining real curve (within a few %)', () => {
    const omega = angularSpeed_radPerMyr(MW.R0_kpc);
    const kappa = epicyclicFreq_radPerMyr(MW.R0_kpc);
    expect(kappa).toBeLessThan(Math.SQRT2 * omega);          // dΘ/dR < 0 ⇒ κ < √2·Ω
    expect(kappa).toBeGreaterThan(0.94 * Math.SQRT2 * omega); // but only marginally — the curve is ~flat
  });
});

describe('galactic year', () => {
  it('is ~216 Myr at Sol and longer farther out', () => {
    expect(galacticYear_Myr(MW.R0_kpc)).toBeGreaterThan(210);
    expect(galacticYear_Myr(MW.R0_kpc)).toBeLessThan(222);
    expect(galacticYear_Myr(MW.R0_kpc + 4)).toBeGreaterThan(galacticYear_Myr(MW.R0_kpc));
  });
});

describe('corotation radius', () => {
  it('puts the spiral pattern just outside Sol and the faster bar well inside', () => {
    const spiralCR = corotationRadius_kpc(MW.spiralPatternSpeed_kms_kpc);
    const barCR = corotationRadius_kpc(MW.barPatternSpeed_kms_kpc);
    expect(spiralCR).toBeGreaterThan(MW.R0_kpc);   // corotation just beyond the Sun (~9.7 kpc)
    expect(spiralCR).toBeLessThan(11);
    expect(barCR).toBeLessThan(spiralCR);          // the faster bar corotates farther in
    // at corotation, the disc's angular speed Ω = Θ/R (in km/s/kpc) equals the pattern speed
    expect(circularSpeed_kms(spiralCR) / spiralCR).toBeCloseTo(MW.spiralPatternSpeed_kms_kpc, 4);
  });
});
