// MW orbit (P2a) — the load-bearing guarantee: deriveOrbit inverts evalOrbit at t=0 (so the bake can store
// orbits and the disc renders IDENTICAL at t=0), and advancing time produces correct epicyclic motion.

import { describe, it, expect } from 'vitest';
import {
  deriveOrbit, evalOrbitCyl, evalOrbitGalKpc, dispersions_kms, amplitudeScale_kpc, verticalFreq_radPerMyr,
  type OrbitElements,
} from './mw-orbit';
import { MW } from './mw-model';

// A spread of stars across the disc: (R0 kpc, φ0 rad, z0 kpc, A_R kpc, ψ_R, A_z target kpc).
const CASES: Array<[number, number, number, number, number, number]> = [
  [8.2, 0, 0, 0.3, 0.7, 0.2],
  [4.0, 1.3, 0.15, 0.5, 2.1, 0.3],
  [12.0, -2.0, -0.25, 0.2, 4.9, 0.1],
  [2.5, 3.0, 0.05, 0.1, 0.0, 0.05],
  [8.2, 2.5, -0.4, 0.4, 5.5, 0.05], // A_z target < |z0| ⇒ must be floored to fit z0
];

describe('deriveOrbit ∘ evalOrbit at t=0 (the render-identical guarantee)', () => {
  it('reproduces every star\'s exact galactocentric position at t=0', () => {
    for (const [R0, phi0, z0, AR, psiR, AzT] of CASES) {
      const o = deriveOrbit(R0, phi0, z0, AR, psiR, AzT);
      const c = evalOrbitCyl(o, 0);
      expect(c.R).toBeCloseTo(R0, 9);
      expect(c.z).toBeCloseTo(z0, 9);
      // azimuth compared mod 2π
      const dphi = Math.atan2(Math.sin(c.phi - phi0), Math.cos(c.phi - phi0));
      expect(dphi).toBeCloseTo(0, 9);
      // and the Cartesian round-trips too
      const g = evalOrbitGalKpc(o, 0);
      expect(g.x).toBeCloseTo(R0 * Math.cos(phi0), 8);
      expect(g.z).toBeCloseTo(R0 * Math.sin(phi0), 8);
      expect(g.y).toBeCloseTo(z0, 9);
    }
  });
});

describe('orbital motion (t > 0)', () => {
  const o: OrbitElements = deriveOrbit(8.2, 0, 0.1, 0.4, 0.3, 0.25);

  it('the guiding centre advances in azimuth at Ω and the star actually moves', () => {
    const a = evalOrbitGalKpc(o, 0);
    const b = evalOrbitGalKpc(o, 50); // 50 Myr later
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(0.1); // moved ≫ 0.1 kpc
    // azimuth advanced by ~Ω·t (guiding term dominates)
    const phiA = evalOrbitCyl(o, 0).phi;
    const phiB = evalOrbitCyl(o, 50).phi;
    expect(phiB - phiA).toBeGreaterThan(0); // prograde
  });

  it('R stays within [Rg−A_R, Rg+A_R] and z within [−A_z, A_z] over a full epicycle', () => {
    let rMin = Infinity;
    let rMax = -Infinity;
    let zMax = -Infinity;
    for (let t = 0; t <= 400; t += 1) {
      const c = evalOrbitCyl(o, t);
      rMin = Math.min(rMin, c.R);
      rMax = Math.max(rMax, c.R);
      zMax = Math.max(zMax, Math.abs(c.z));
    }
    expect(rMin).toBeGreaterThanOrEqual(o.Rg_kpc - o.AR_kpc - 1e-9);
    expect(rMax).toBeLessThanOrEqual(o.Rg_kpc + o.AR_kpc + 1e-9);
    expect(zMax).toBeLessThanOrEqual(o.Az_kpc + 1e-9);
    expect(zMax).toBeGreaterThan(0.9 * o.Az_kpc); // a full epicycle samples near the turning point
  });
});

describe('dispersions + amplitudes', () => {
  it('thick disc is hotter than thin; dispersion rises inward; amplitude scales as σ/freq', () => {
    expect(dispersions_kms(MW.R0_kpc, true).sigmaR).toBeGreaterThan(dispersions_kms(MW.R0_kpc).sigmaR);
    expect(dispersions_kms(4).sigmaR).toBeGreaterThan(dispersions_kms(12).sigmaR);
    const nu = verticalFreq_radPerMyr();
    expect(amplitudeScale_kpc(40, nu)).toBeGreaterThan(amplitudeScale_kpc(20, nu)); // hotter ⇒ taller
    expect(nu).toBeGreaterThan(0);
  });
});
