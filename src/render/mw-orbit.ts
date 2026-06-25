// ═══════════════════════════════════════════════════════════════════
// MW ORBIT — the per-star epicyclic galactic orbit (P2a of the kinematic density-wave galaxy).
//
// A star is stored not as a position but as ORBITAL ELEMENTS: a guiding radius on a circular orbit at
// Ω(R_g), a small radial epicycle at κ, and a vertical oscillation at ν. Its position is a closed-form
// function of the global time t (Myr) — EVALUATED, never integrated, so there is no drift over millions
// of years and the GPU can advance 2–3M stars in O(N) (P3). The pattern (arms/bar) rotates separately
// (P4); stars stream through it.
//
// THE KEY GUARANTEE (what makes P2 verifiable): deriveOrbit() inverts evalOrbit() at t=0 — given a star's
// current galactocentric position, it produces elements whose t=0 evaluation reproduces that position
// EXACTLY. So switching the bake to store orbits renders the disc identical at t=0; only advancing time
// moves anything.
//
// Units: R, z in kpc; angles in rad; time in Myr. Galactocentric Cartesian matches the scene — the disc
// lies in x–z (x = R·cosφ, z = R·sinφ) and y is the vertical height.
// ═══════════════════════════════════════════════════════════════════

import {
  MW, MW_CURVE, angularSpeed_radPerMyr, epicyclicFreq_radPerMyr, KMS_PER_KPC_TO_RAD_PER_MYR,
  type RotationCurve,
} from './mw-model';

/** Immutable per-star orbit (closed-form). Position(t) is a pure function of these + the global clock. */
export interface OrbitElements {
  /** Guiding-centre radius (kpc) — the mean orbital radius. */
  readonly Rg_kpc: number;
  /** Guiding azimuth at t=0 (rad). */
  readonly phiG0: number;
  /** Radial epicycle amplitude (kpc) and phase (rad): R(t) = Rg − A_R·cos(κt + ψ_R). */
  readonly AR_kpc: number;
  readonly psiR: number;
  /** Vertical amplitude (kpc) and phase (rad): z(t) = A_z·sin(νt + ψ_z). */
  readonly Az_kpc: number;
  readonly psiZ: number;
  /** Cached frequencies at Rg (rad/Myr): orbital Ω, radial epicyclic κ, vertical ν. */
  readonly omega: number;
  readonly kappa: number;
  readonly nu: number;
}

/** Vertical oscillation frequency ν (rad/Myr). Tuned so A_z ~ scale height for the disc's σ_z, giving the
 *  right disc thickness. ν ≈ σ_z / h_z (harmonic approximation); thin disc by default. */
export function verticalFreq_radPerMyr(sigmaZ_kms = 20, scaleHeight_pc = MW.thinScaleHeight_pc): number {
  const hz_kpc = scaleHeight_pc / 1000;
  return (sigmaZ_kms / hz_kpc) * KMS_PER_KPC_TO_RAD_PER_MYR;
}

/** Velocity dispersions (km/s) at radius R for a disc population — set the epicycle amplitude scales.
 *  Thin disc near Sol ≈ (σ_R 35, σ_φ 25, σ_z 20); thick disc ≈ 2×. Gently rises inward. */
export function dispersions_kms(Rkpc: number, thick = false): { sigmaR: number; sigmaZ: number } {
  const base = thick ? { sigmaR: 70, sigmaZ: 45 } : { sigmaR: 35, sigmaZ: 20 };
  const grad = Math.exp(-(Rkpc - MW.R0_kpc) / (2 * MW.thinScaleLength_kpc)); // hotter inward
  return { sigmaR: base.sigmaR * grad, sigmaZ: base.sigmaZ * grad };
}

/** Epicycle amplitude scale (kpc) for a velocity dispersion σ (km/s) and frequency f (rad/Myr): A ~ σ/f.
 *  (σ in (km/s) → (km/s)/kpc·kpc; divide by f in rad/Myr after the unit conversion.) */
export function amplitudeScale_kpc(sigma_kms: number, freq_radPerMyr: number): number {
  return (sigma_kms * KMS_PER_KPC_TO_RAD_PER_MYR) / Math.max(1e-9, freq_radPerMyr);
}

/** Evaluate the orbit at time t (Myr) → galactocentric cylindrical (R kpc, φ rad, z kpc). */
export function evalOrbitCyl(o: OrbitElements, tMyr: number): { R: number; phi: number; z: number } {
  const phaseR = o.kappa * tMyr + o.psiR;
  const R = o.Rg_kpc - o.AR_kpc * Math.cos(phaseR);
  // Tangential epicycle: the 2Ω/κ companion term, 90° out of phase with the radial term.
  const phi = o.phiG0 + o.omega * tMyr + ((2 * o.omega) / o.kappa) * (o.AR_kpc / o.Rg_kpc) * Math.sin(phaseR);
  const z = o.Az_kpc * Math.sin(o.nu * tMyr + o.psiZ);
  return { R, phi, z };
}

/** Evaluate the orbit at time t → galactocentric Cartesian (kpc): disc in x–z, y = vertical height. */
export function evalOrbitGalKpc(o: OrbitElements, tMyr: number): { x: number; y: number; z: number } {
  const c = evalOrbitCyl(o, tMyr);
  return { x: c.R * Math.cos(c.phi), y: c.z, z: c.R * Math.sin(c.phi) };
}

/** Invert evalOrbit at t=0: given a star's CURRENT galactocentric (R0,φ0,z0 in kpc) plus chosen radial
 *  amplitude/phase and a target vertical amplitude, return elements whose t=0 position is exactly
 *  (R0,φ0,z0). The guiding radius and azimuth are solved from the epicycle; the vertical phase is solved
 *  so z(0)=z0 (A_z floored to ≥|z0| so a solution exists). */
export function deriveOrbit(
  R0_kpc: number, phi0: number, z0_kpc: number,
  AR_kpc: number, psiR: number, AzTarget_kpc: number,
  curve: RotationCurve = MW_CURVE, sigmaZ_kms = 20,
): OrbitElements {
  const Rg = R0_kpc + AR_kpc * Math.cos(psiR); // ⇒ R(0) = Rg − A_R·cos(ψ_R) = R0
  const omega = angularSpeed_radPerMyr(Rg, curve);
  const kappa = epicyclicFreq_radPerMyr(Rg, curve);
  const nu = verticalFreq_radPerMyr(sigmaZ_kms);
  const phiG0 = phi0 - ((2 * omega) / kappa) * (AR_kpc / Rg) * Math.sin(psiR); // ⇒ φ(0) = φ0
  const Az = Math.max(AzTarget_kpc, Math.abs(z0_kpc) + 1e-12);
  const psiZ = Math.asin(Math.max(-1, Math.min(1, z0_kpc / Az))); // ⇒ z(0) = A_z·sin(ψ_z) = z0
  return { Rg_kpc: Rg, phiG0, AR_kpc, psiR, Az_kpc: Az, psiZ, omega, kappa, nu };
}
