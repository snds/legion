// ═══════════════════════════════════════════════════════════════════
// KELVIN → sRGB — blackbody / Planckian-locus colour
//
// procedural-star-research.md §2 recommends three's ColorUtils.setKelvin,
// but that API does NOT exist in the pinned three@0.171 (it landed in a
// later release). So we implement the same underlying model directly: the
// Tanner Helland piecewise fit to the Planckian locus (valid ~1000–40000 K,
// tannerhelland.com/2012/09/18). This is a CONTINUOUS analytic function of
// temperature — not the discrete stepwise RGB-by-temperature LUT the
// bpodgursky reference hard-baked (and that the plan explicitly rejects).
//
// The eye sees broadband thermal emission far paler than the spectral
// labels: a "yellow" G looks white, a "red" M looks orange, and there are
// NO green or violet stars. The fit already desaturates toward white; a
// small extra desaturation guards the mid-range from reading too yellow.
//
// Provided in two forms that MUST agree: kelvinToRGB() for JS-side colour
// (icon tint, tests) and GLSL_KELVIN for the surface shader, which evaluates
// a per-fragment LOCAL temperature (hot granules bluer, cool spots redder) —
// physically-driven colour, never a baked ramp.
// ═══════════════════════════════════════════════════════════════════

/** Slight pull toward white applied after the raw fit, so the G-type Sun
 *  reads white rather than butter-yellow. Kept mild — over-desaturating
 *  would wash out the M-dwarf orange the population is meant to show. */
const DESATURATE = 0.12;

/**
 * Blackbody colour for a temperature in Kelvin, as linear-ish sRGB in [0,1].
 * Continuous over the full stellar range; O/B → blue-white, G → white,
 * K → pale gold, M → orange. Never returns a green- or violet-dominant hue.
 */
export function kelvinToRGB(tempK: number): [number, number, number] {
  // The fit is parameterised in hundreds of kelvin, clamped to its valid span.
  // A non-finite input (NaN/±Inf) falls back to the solar anchor rather than
  // poisoning the whole pipeline with NaN colour.
  const safe = Number.isFinite(tempK) ? tempK : 5772;
  const t = Math.min(40000, Math.max(1000, safe)) / 100;

  let r: number;
  let g: number;
  let b: number;

  // ── Red ──
  if (t <= 66) {
    r = 255;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
  }

  // ── Green ──
  if (t <= 66) {
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }

  // ── Blue ──
  if (t >= 66) {
    b = 255;
  } else if (t <= 19) {
    b = 0;
  } else {
    b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  }

  let cr = clamp01(r / 255);
  let cg = clamp01(g / 255);
  let cb = clamp01(b / 255);

  // Desaturate toward the channel luminance — pulls the whole locus a touch
  // paler, matching perception (no over-saturated "yellow"/"red" stars).
  const lum = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
  cr = mix(cr, lum, DESATURATE);
  cg = mix(cg, lum, DESATURATE);
  cb = mix(cb, lum, DESATURATE);

  return [cr, cg, cb];
}

/** Pack kelvinToRGB into a single 0xRRGGBB int (icon/label tint). */
export function kelvinToHex(tempK: number): number {
  const [r, g, b] = kelvinToRGB(tempK);
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * GLSL port of kelvinToRGB — the SAME Tanner Helland fit and desaturation,
 * so the shader's per-fragment local-temperature colour matches the JS base
 * colour exactly. Exposes `vec3 kelvinToRGB(float tempK)`.
 */
export const GLSL_KELVIN = /* glsl */ `
vec3 kelvinToRGB(float tempK) {
  float t = clamp(tempK, 1000.0, 40000.0) / 100.0;
  float r, g, b;

  if (t <= 66.0) {
    r = 255.0;
    g = 99.4708025861 * log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * pow(t - 60.0, -0.1332047592);
    g = 288.1221695283 * pow(t - 60.0, -0.0755148492);
  }

  if (t >= 66.0) {
    b = 255.0;
  } else if (t <= 19.0) {
    b = 0.0;
  } else {
    b = 138.5177312231 * log(t - 10.0) - 305.0447927307;
  }

  vec3 c = clamp(vec3(r, g, b) / 255.0, 0.0, 1.0);
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(c, vec3(lum), ${DESATURATE.toFixed(3)});
}
`;
