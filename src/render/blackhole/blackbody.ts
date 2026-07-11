// ═══════════════════════════════════════════════════════════════════
// BLACKBODY T→RGB — Planck-locus colour ramp for the accretion disk
//
// The disk's Novikov–Thorne temperature profile T(r) is turned into colour by
// evaluating the Planckian locus (the chromaticity a true blackbody radiates at
// temperature T) and converting to linear sRGB. We bake it once into a 1-D
// ramp texture the shader samples by normalised temperature — the disk goes
// deep-red at the cool outer edge through orange/white to blue-white at the hot
// inner edge, exactly as a real thermal-emission disk does.
//
// Approximation: the analytic Planckian-locus fit of Kim et al. (2002), which
// is accurate across ~1000 K–40000 K — the full range a disk spans. Spec:
// docs/black-hole-simulation-research.md §3(a).
// ═══════════════════════════════════════════════════════════════════

import { DataTexture, RGBAFormat, LinearFilter, ClampToEdgeWrapping, type Texture } from 'three';

/** Temperature range the ramp spans (Kelvin). Covers cool disk edge → hot inner. */
export const RAMP_MIN_K = 1000;
export const RAMP_MAX_K = 40000;

/**
 * CIE 1931 xy chromaticity of a blackbody at temperature T (Kelvin), via the
 * Kim et al. (2002) cubic-spline fit of the Planckian locus. Valid 1667–25000 K;
 * clamped outside so the extremes stay well-behaved.
 */
function planckianLocusXY(tempK: number): [number, number] {
  const T = Math.min(25000, Math.max(1667, tempK));
  const t = 1000 / T;
  let x: number;
  if (T < 4000) {
    x = -0.2661239 * t * t * t - 0.2343589 * t * t + 0.8776956 * t + 0.179910;
  } else {
    x = -3.0258469 * t * t * t + 2.1070379 * t * t + 0.2226347 * t + 0.240390;
  }
  let y: number;
  if (T < 2222) {
    y = -1.1063814 * x * x * x - 1.34811020 * x * x + 2.18555832 * x - 0.20219683;
  } else if (T < 4000) {
    y = -0.9549476 * x * x * x - 1.37418593 * x * x + 2.09137015 * x - 0.16748867;
  } else {
    y = 3.0817580 * x * x * x - 5.87338670 * x * x + 3.75112997 * x - 0.37001483;
  }
  return [x, y];
}

/**
 * Linear-sRGB (unclamped, un-gamma'd) colour of a blackbody at temperature T.
 * The chromaticity is placed at unit luminance (Y = 1), converted xyY→XYZ→linear
 * sRGB, then scaled back so the brightest channel is 1 — i.e. pure hue, with the
 * disk's actual brightness supplied separately by the flux profile. Values are
 * clamped to ≥ 0 (out-of-gamut blues can go slightly negative).
 */
export function blackbodyRGB(tempK: number): [number, number, number] {
  const [x, y] = planckianLocusXY(tempK);
  if (y <= 0) return [0, 0, 0];

  // xyY (Y = 1) → XYZ
  const X = x / y;
  const Y = 1;
  const Z = (1 - x - y) / y;

  // XYZ → linear sRGB (D65)
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let b = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;

  r = Math.max(0, r);
  g = Math.max(0, g);
  b = Math.max(0, b);

  const peak = Math.max(r, g, b);
  if (peak > 0) {
    r /= peak;
    g /= peak;
    b /= peak;
  }
  return [r, g, b];
}

/**
 * Bake a 1-D blackbody colour ramp into a width×1 RGBA DataTexture. Column i
 * maps linearly to temperature RAMP_MIN_K…RAMP_MAX_K; the shader samples it at
 * u = (T − RAMP_MIN_K)/(RAMP_MAX_K − RAMP_MIN_K). Linear-filtered, clamped.
 */
export function buildBlackbodyRamp(width = 256): Texture {
  const data = new Uint8Array(width * 4);
  for (let i = 0; i < width; i++) {
    const f = width > 1 ? i / (width - 1) : 0;
    const tempK = RAMP_MIN_K + f * (RAMP_MAX_K - RAMP_MIN_K);
    const [r, g, b] = blackbodyRGB(tempK);
    // Store gamma-encoded (sRGB-ish) 8-bit; the shader treats it as colour data.
    data[i * 4 + 0] = Math.round(Math.min(1, Math.pow(r, 1 / 2.2)) * 255);
    data[i * 4 + 1] = Math.round(Math.min(1, Math.pow(g, 1 / 2.2)) * 255);
    data[i * 4 + 2] = Math.round(Math.min(1, Math.pow(b, 1 / 2.2)) * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new DataTexture(data, width, 1, RGBAFormat);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Normalise a temperature (K) to the ramp's [0,1] lookup coordinate. */
export function rampCoord(tempK: number): number {
  return Math.min(1, Math.max(0, (tempK - RAMP_MIN_K) / (RAMP_MAX_K - RAMP_MIN_K)));
}
