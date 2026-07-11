// ═══════════════════════════════════════════════════════════════════
// SCHWARZSCHILD GR MATH — the physics behind the black-hole set-piece
//
// Geometrized units: G = c = 1, so mass M carries the length scale
// (multiply by GM/c² to recover metres). The non-spinning (Schwarzschild)
// black hole is fully described by M; every characteristic radius is a
// pure multiple of it:
//
//   event horizon   r_s   = 2M          (Schwarzschild radius)
//   photon sphere   r_ph  = 3M          (= 1.5 r_s, unstable photon orbits)
//   shadow / b_crit       = 3√3 M ≈ 5.196 M   (capture impact parameter)
//   disk inner edge r_ISCO = 6M         (= 3 r_s, innermost stable orbit)
//
// This module is the SINGLE SOURCE OF TRUTH for that math. The GLSL shader
// (blackhole-shader.ts) mirrors the same Binet integrator and g-factor on the
// GPU; these TypeScript functions are what the unit tests pin against known GR
// results (weak-field deflection 4M/b, capture at b_crit, ISCO velocity c/2),
// so a regression in the ported shader math is caught here first.
//
// Spec: docs/black-hole-simulation-research.md §1–3, oseiskar/black-hole (MIT).
// ═══════════════════════════════════════════════════════════════════

/** Event horizon (Schwarzschild radius) r_s = 2M. */
export function eventHorizon(M: number): number {
  return 2 * M;
}

/** Photon sphere r_ph = 3M — radius of unstable circular photon orbits. */
export function photonSphere(M: number): number {
  return 3 * M;
}

/**
 * Critical impact parameter b_crit = 3√3 M ≈ 5.196 M. A photon from infinity
 * with b < b_crit is captured (spirals through the horizon); with b just above
 * it winds around the photon sphere before escaping — this is the photon ring.
 */
export function criticalImpactParameter(M: number): number {
  return 3 * Math.sqrt(3) * M;
}

/** Innermost stable circular orbit r_ISCO = 6M — the accretion disk's inner edge. */
export function isco(M: number): number {
  return 6 * M;
}

/**
 * Weak-field (large-b) light deflection α ≈ 4M/b = 2 r_s / b. Exact in the
 * limit b ≫ M; the full integrator (traceFromInfinity) reproduces it there and
 * diverges — correctly — as b → b_crit. Einstein's 1.75″ at the solar limb.
 */
export function weakFieldDeflection(b: number, M: number): number {
  return (4 * M) / b;
}

// ── Accretion disk: Novikov–Thorne / Shakura–Sunyaev thin disk ──────

/**
 * Radiative-flux shape of a thin disk, F(r) ∝ r⁻³·(1 − √(r_in/r)), zero at the
 * inner edge, peaking near ~1.36 r_in, then falling as r⁻³. Dimensionless
 * (the GMṀ/8πσ prefactor is folded into the caller's temperature scale).
 * Returns 0 inside r_in. Spec: arXiv 1201.2060.
 */
export function diskFluxProfile(r: number, rIn: number): number {
  if (r <= rIn) return 0;
  return (1 - Math.sqrt(rIn / r)) / (r * r * r);
}

/**
 * Effective temperature profile T(r) ∝ F(r)^¼, normalised so the caller scales
 * by a peak temperature. T ∝ r^(−3/4) in the outer disk (Wien → colour ramp).
 */
export function temperatureProfile(r: number, rIn: number): number {
  const f = diskFluxProfile(r, rIn);
  return f > 0 ? Math.pow(f, 0.25) : 0;
}

/** Radius (> rIn) of peak disk flux, ≈ (49/36) r_in for a Novikov–Thorne disk. */
export function peakFluxRadius(rIn: number): number {
  return (49 / 36) * rIn;
}

// ── Relativistic disk kinematics: one factor g = ν_obs / ν_emit ─────

/** Gravitational redshift of a static emitter at radius r: √(1 − 2M/r). */
export function gravitationalRedshift(r: number, M: number): number {
  const x = 1 - (2 * M) / r;
  return x > 0 ? Math.sqrt(x) : 0;
}

/**
 * Locally-measured orbital speed β of a circular geodesic (Keplerian disk
 * material) at radius r, as seen by a static observer: β = √(M/r)/√(1 − 2M/r).
 * Reaches exactly c/2 at the ISCO (r = 6M) — the canonical check.
 */
export function orbitalBeta(r: number, M: number): number {
  const denom = 1 - (2 * M) / r;
  if (denom <= 0) return 1;
  return Math.sqrt(M / r) / Math.sqrt(denom);
}

/**
 * Combined redshift factor g = ν_obs/ν_emit for a Keplerian disk element,
 * folding gravitational redshift and relativistic Doppler into one number.
 *
 *   g = √(1 − 2M/r) · √(1 − β²) / (1 − β·n̂)
 *
 * where β is the orbital speed (orbitalBeta) and cosθ = dot(velocityDir, n̂) is
 * the cosine between the emitter's motion and the photon's propagation
 * direction toward the observer. Colour is shifted by g (T_obs = g·T_emit) and
 * bolometric intensity scales as g³ (the relativistic-beaming cube) — this is
 * what makes the approaching side of the disk dramatically brighter.
 */
export function redshiftFactor(r: number, M: number, cosAngle: number): number {
  const beta = orbitalBeta(r, M);
  const gamma = 1 / Math.sqrt(Math.max(1e-9, 1 - beta * beta));
  const grav = gravitationalRedshift(r, M);
  return (grav / gamma) / (1 - beta * cosAngle);
}

// ── Null-geodesic integrator (the core): Binet equation in u = 1/r ──

export interface GeodesicResult {
  /** True if the photon crossed the horizon (b < b_crit). */
  captured: boolean;
  /** Net light-bending angle α = φ_total − π (radians), valid when escaped. */
  deflection: number;
  /** Number of integration steps taken (winding grows near b_crit). */
  steps: number;
}

/**
 * Integrate a null geodesic coming from infinity with impact parameter b,
 * solving the exact Binet equation
 *
 *   d²u/dφ² = −u + 3M·u²          (u ≡ 1/r)
 *
 * with a symplectic Velocity-Verlet (Leapfrog) step and an adaptive Δφ that
 * shrinks near the hole. Initial conditions place the ray at r = ∞ (u = 0)
 * moving inward on a straight line of impact parameter b: du/dφ|₀ = 1/b.
 *
 * The photon either (a) reaches the horizon u ≥ 1/(2M) → captured, or (b)
 * returns to u = 0 → escaped, at which point the total swept angle minus π is
 * the deflection. This is the same scheme the GLSL shader runs per pixel; the
 * shadow and photon ring fall out for free (no special-casing).
 */
export function traceFromInfinity(
  b: number,
  M: number,
  opts: { maxSteps?: number; baseStep?: number } = {},
): GeodesicResult {
  const maxSteps = opts.maxSteps ?? 20000;
  const baseStep = opts.baseStep ?? 0.01;
  const uHorizon = 1 / (2 * M); // u at the event horizon

  // Binet acceleration a(u) = d²u/dφ² = −u + 3M u².
  const accel = (u: number): number => -u + 3 * M * u * u;

  let u = 0;             // start at r = ∞ (u = 0); accel(0) = 0 so this is exact
  let dudphi = 1 / b;    // du/dφ for an undeflected ray of impact parameter b
  let phi = 0;
  let steps = 0;

  while (steps < maxSteps) {
    // Adaptive step: take smaller Δφ where curvature (u) is large — near the
    // hole geodesics bend fast; far out they are nearly straight.
    const h = baseStep / (1 + 40 * u * u);

    // Velocity-Verlet on u(φ): symplectic, stable at large h far out.
    const a0 = accel(u);
    const uNext = u + dudphi * h + 0.5 * a0 * h * h;
    const aNext = accel(uNext);
    dudphi += 0.5 * (a0 + aNext) * h;
    const uPrev = u;
    u = uNext;
    phi += h;
    steps++;

    if (u >= uHorizon) {
      return { captured: true, deflection: NaN, steps };
    }
    if (u <= 0 && steps > 1) {
      // Returned to infinity. Interpolate the exact φ where u = 0 on this final
      // step (the step overshoots into u < 0) — without this, up to a full Δφ of
      // spurious angle is counted, which swamps the small weak-field deflection.
      const frac = uPrev / (uPrev - u);
      const phiCross = phi - h + frac * h;
      return { captured: false, deflection: phiCross - Math.PI, steps };
    }
  }
  // Ran out of steps without resolving — treat as captured (deep winding).
  return { captured: true, deflection: NaN, steps };
}
