// ═══════════════════════════════════════════════════════════════════
// MILKY WAY MODEL — the one tunable source of truth for the galaxy's physical structure + kinematics.
//
// Phase P0 of the kinematic density-wave galaxy. These are the constants + closed-form relations a star
// needs to ride a real galactic orbit (guiding-centre circular motion + epicyclic wobble) and for the
// spiral/bar pattern to rotate as a rigid wave the stars stream through. NO simulation here — pure data
// + pure functions, so it's fully unit-tested and shared by the bake, the GPU playback, and the dust.
//
// Sources are SCIENCE/METHOD values (rotation curve, structural params) — commercial-OK — NOT raw Gaia
// DR3 catalogue rows (CC-BY-NC). Numbers from the standard MW literature (Reid+ 2019 R0/Θ0; Bland-Hawthorn
// & Gerhard 2016 review for disc scales/bar; Vallée / Hou & Han for arm count + pitch).
// ═══════════════════════════════════════════════════════════════════

/** Kilometres per kiloparsec (1 pc = 3.0856775814913673e13 km). */
const KM_PER_KPC = 3.0856775814913673e16;
/** Seconds per megayear (Julian year = 3.15576e7 s). */
const S_PER_MYR = 3.15576e13;
/** Convert an angular rate given as (km/s)/kpc into rad/Myr. (Θ/R is naturally (km/s)/kpc.) */
export const KMS_PER_KPC_TO_RAD_PER_MYR = S_PER_MYR / KM_PER_KPC; // ≈ 1.02272e-3

/** Structural + kinematic constants of the Milky Way. Tunable game constants — the pattern speeds in
 *  particular are uncertain by ~1.5× in the literature, so treat them as dials, not ground truth. */
export const MW = {
  /** Sol's galactocentric radius (kpc). */
  R0_kpc: 8.2,
  /** Circular speed at Sol / the local standard of rest (km/s). */
  THETA0_kms: 233,
  /** Local slope of the rotation curve dΘ/dR near Sol (km/s/kpc) — gently declining, ~flat. */
  rotationCurveSlope_kms_kpc: -1.7,

  /** Thin / thick disc radial scale lengths (kpc). */
  thinScaleLength_kpc: 2.6,
  thickScaleLength_kpc: 2.0,
  /** Thin / thick disc vertical scale heights (pc). */
  thinScaleHeight_pc: 300,
  thickScaleHeight_pc: 900,

  /** Central bar half-length (kpc) and its angle to the Sol–centre line (deg). */
  barHalfLength_kpc: 5,
  barAngle_deg: 27,

  /** Number of major spiral arms and their logarithmic pitch angle (deg). */
  armCount: 4,
  armPitch_deg: 12,

  /** Rigid pattern speeds (km/s/kpc): the spiral wave turns slower than the bar. */
  spiralPatternSpeed_kms_kpc: 24,
  barPatternSpeed_kms_kpc: 38,
} as const;

/** A galactic rotation curve: circular speed Θ(R) and its radial slope dΘ/dR (both km/s, kpc). */
export interface RotationCurve {
  /** Circular speed Θ at radius R (km/s). */
  speed(Rkpc: number): number;
  /** dΘ/dR at radius R (km/s/kpc). */
  slope(Rkpc: number): number;
}

/** A perfectly flat rotation curve (Θ constant) — the textbook first-order MW model; gives κ = √2·Ω. */
export function flatCurve(theta0 = MW.THETA0_kms): RotationCurve {
  return { speed: () => theta0, slope: () => 0 };
}

/** A linear, gently-declining rotation curve Θ(R) = Θ0 + slope·(R − R0), floored so it can't go negative. */
export function linearCurve(
  theta0 = MW.THETA0_kms, R0 = MW.R0_kpc, slope = MW.rotationCurveSlope_kms_kpc,
): RotationCurve {
  return {
    speed: (Rkpc: number) => Math.max(20, theta0 + slope * (Rkpc - R0)),
    slope: () => slope,
  };
}

/** The default MW rotation curve (gently declining). */
export const MW_CURVE: RotationCurve = linearCurve();

/** Circular speed Θ(R) in km/s. */
export function circularSpeed_kms(Rkpc: number, curve: RotationCurve = MW_CURVE): number {
  return curve.speed(Rkpc);
}

/** Angular speed Ω(R) = Θ/R in rad/Myr (the rate a star on a circular orbit sweeps azimuth). */
export function angularSpeed_radPerMyr(Rkpc: number, curve: RotationCurve = MW_CURVE): number {
  return (curve.speed(Rkpc) / Rkpc) * KMS_PER_KPC_TO_RAD_PER_MYR;
}

/** Epicyclic frequency κ(R) in rad/Myr — the rate of the small radial oscillation about the guiding
 *  radius. κ² = 2Ω(Ω + dΘ/dR); for a flat curve (dΘ/dR = 0) this is exactly κ = √2·Ω. */
export function epicyclicFreq_radPerMyr(Rkpc: number, curve: RotationCurve = MW_CURVE): number {
  const omega = angularSpeed_radPerMyr(Rkpc, curve);
  const dThetaDR = curve.slope(Rkpc) * KMS_PER_KPC_TO_RAD_PER_MYR; // (km/s/kpc) → rad/Myr
  return Math.sqrt(Math.max(0, 2 * omega * (omega + dThetaDR)));
}

/** Orbital period (one full galactic year) at radius R, in Myr. ~216 Myr at Sol. */
export function galacticYear_Myr(Rkpc: number, curve: RotationCurve = MW_CURVE): number {
  return (2 * Math.PI) / angularSpeed_radPerMyr(Rkpc, curve);
}

/** Corotation radius for a rigid pattern of the given speed (kpc): where Ω(R) equals the pattern speed.
 *  Inside it, stars overtake the pattern; outside, the pattern overtakes them. */
export function corotationRadius_kpc(patternSpeed_kms_kpc: number, curve: RotationCurve = MW_CURVE): number {
  // Θ(R)/R = Ωp  →  for a flat curve R = Θ0/Ωp; solved by bisection for a general curve.
  let lo = 0.5;
  let hi = 30;
  for (let it = 0; it < 60; it++) {
    const mid = 0.5 * (lo + hi);
    const omegaAtMid = curve.speed(mid) / mid; // km/s/kpc
    if (omegaAtMid > patternSpeed_kms_kpc) lo = mid; // Ω falls with R → go outward
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}
