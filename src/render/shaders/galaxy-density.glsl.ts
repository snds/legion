// ═══════════════════════════════════════════════════════════════════
// GALAXY DENSITY — GLSL chunk, generated from src/render/galaxy-density.ts
//
// ⚠ MIRROR CONTRACT: every scalar constant below is interpolated directly
// from the TS module (cannot drift); the FUNCTION BODIES are hand-mirrored
// 1:1 — any structural edit must change both files in the same commit. The
// TS side is locked by the vitest sample-table snapshot; the GPU side is
// validated against that same table by the Phase-2 harness
// (docs/galaxy-visual-redesign.md §3, §4.3).
//
// Coordinates: galaxy-local (Sgr A* origin, disc in X–Z, +Y vertical), WU.
// ═══════════════════════════════════════════════════════════════════

import {
  A_STARS, ARM_REF_R, ARM_SHARP, ARM_FBM_SCALE, ARM_FBM_FLOOR,
  BAR_AMP, BAR_ANGLE, BAR_H, BAR_LEN, BAR_W,
  BULGE_A, BULGE_AMP, BULGE_SQUASH, CLUMP_SCALE, DISC_RADIUS_WU,
  DUST2_WEIGHT, DUST_NORM, DUST_SHARP, HII_KNOTS, HR_DUST, HR_THICK,
  HR_THIN, HZ_DUST, HZ_DUST2, HZ_THICK, HZ_THIN, HOME_POS, KAPPA_MID,
  KAPPA_RGB, LANE_OFFSET, PITCH, RIFT_CLOUDS, R_FLARE, TAPER_IN, TAPER_OUT,
  THICK_WEIGHT, WARP_ONSET, WARP_RIM_AMP,
  COL_BULGE, COL_DISC, COL_HII, COL_OLD,
} from '../galaxy-density';

const f = (n: number): string => {
  const s = String(n);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};
const v3 = (a: readonly [number, number, number]): string =>
  `vec3(${f(a[0])}, ${f(a[1])}, ${f(a[2])})`;

const riftArray = RIFT_CLOUDS.map(c =>
  `RiftCloud(${v3(c.c)}, ${v3(c.r)}, ${f(c.k)})`).join(',\n  ');
const hiiArray = HII_KNOTS.map(k =>
  `HiiKnot(${v3(k.c)}, ${f(k.r)}, ${f(k.amp)})`).join(',\n  ');

export const galaxyDensityGLSL = /* glsl */ `
// ── generated constants (source of truth: galaxy-density.ts) ──
#define N_RIFT ${RIFT_CLOUDS.length}
#define N_HII ${HII_KNOTS.length}

const float GD_HR_THIN = ${f(HR_THIN)};
const float GD_HZ_THIN = ${f(HZ_THIN)};
const float GD_THICK_W = ${f(THICK_WEIGHT)};
const float GD_HR_THICK = ${f(HR_THICK)};
const float GD_HZ_THICK = ${f(HZ_THICK)};
const float GD_BULGE_A = ${f(BULGE_A)};
const float GD_BULGE_SQUASH = ${f(BULGE_SQUASH)};
const float GD_BULGE_AMP = ${f(BULGE_AMP)};
const float GD_BAR_AMP = ${f(BAR_AMP)};
const float GD_BAR_ANGLE = ${f(BAR_ANGLE)};
const float GD_BAR_LEN = ${f(BAR_LEN)};
const float GD_BAR_W = ${f(BAR_W)};
const float GD_BAR_H = ${f(BAR_H)};
const float GD_PITCH = ${f(PITCH)};
const float GD_ARM_REF_R = ${f(ARM_REF_R)};
const float GD_A_STARS = ${f(A_STARS)};
const float GD_ARM_SHARP = ${f(ARM_SHARP)};
const float GD_ARM_FBM_SCALE = ${f(ARM_FBM_SCALE)};
const float GD_ARM_FBM_FLOOR = ${f(ARM_FBM_FLOOR)};
const float GD_HR_DUST = ${f(HR_DUST)};
const float GD_HZ_DUST = ${f(HZ_DUST)};
const float GD_HZ_DUST2 = ${f(HZ_DUST2)};
const float GD_DUST2_W = ${f(DUST2_WEIGHT)};
const float GD_KAPPA_MID = ${f(KAPPA_MID)};
const float GD_DUST_SHARP = ${f(DUST_SHARP)};
const float GD_LANE_OFFSET = ${f(LANE_OFFSET)};
const float GD_CLUMP_SCALE = ${f(CLUMP_SCALE)};
const float GD_WARP_ONSET = ${f(WARP_ONSET)};
const float GD_WARP_RIM_AMP = ${f(WARP_RIM_AMP)};
const float GD_R_FLARE = ${f(R_FLARE)};
const float GD_TAPER_IN = ${f(TAPER_IN)};
const float GD_TAPER_OUT = ${f(TAPER_OUT)};
const float GD_DISC_RADIUS = ${f(DISC_RADIUS_WU)};
const float GD_DUST_NORM = ${f(Number(DUST_NORM.toPrecision(10)))};
const vec3 GD_KAPPA_RGB = ${v3(KAPPA_RGB)};
const vec3 GD_HOME = ${v3(HOME_POS)};
const vec3 GD_COL_DISC = ${v3(COL_DISC)};
const vec3 GD_COL_OLD = ${v3(COL_OLD)};
const vec3 GD_COL_BULGE = ${v3(COL_BULGE)};
const vec3 GD_COL_HII = ${v3(COL_HII)};

// ── GALAXY LAB live-tuning uniforms (TEMPORARY) ──
// Promoted from the constants above so the dev panel can nudge the look at
// the galaxy tier. The host material MUST provide them (galaxy.ts spreads
// galaxyLabVolumeUniforms() into the disc-volume material); their DEFAULT
// values equal the corresponding constants, so an untouched panel renders
// the exact committed model. Only the volume + its bake clone use this chunk.
uniform float uArmContrast;   // default GD_A_STARS
uniform float uArmSharp;      // default GD_ARM_SHARP
uniform float uArmFloor;      // default GD_ARM_FBM_FLOOR
uniform float uArmScale;      // default GD_ARM_FBM_SCALE
uniform float uDiscWidth;     // ×GD_HZ_THIN (1.0 = model)
uniform float uBulgeAmp;      // ×GD_BULGE_AMP (1.0 = model)
uniform float uDustStrength;  // ×dust κ (1.0 = model)
uniform float uHiiAmp;        // ×HII knot emission (1.0 = model)

struct RiftCloud { vec3 c; vec3 r; float k; };
struct HiiKnot { vec3 c; float r; float amp; };
const RiftCloud GD_RIFT[N_RIFT] = RiftCloud[N_RIFT](
  ${riftArray}
);
const HiiKnot GD_HII[N_HII] = HiiKnot[N_HII](
  ${hiiArray}
);

// ── mirrored helpers (1:1 with galaxy-density.ts) ──
float gdHash3(vec3 i) {
  return fract(sin(i.x * 127.1 + i.y * 311.7 + i.z * 74.7) * 43758.5453);
}

float gdValueNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 fr = p - i;
  vec3 u = fr * fr * (3.0 - 2.0 * fr);
  float c000 = gdHash3(i);
  float c100 = gdHash3(i + vec3(1.0, 0.0, 0.0));
  float c010 = gdHash3(i + vec3(0.0, 1.0, 0.0));
  float c110 = gdHash3(i + vec3(1.0, 1.0, 0.0));
  float c001 = gdHash3(i + vec3(0.0, 0.0, 1.0));
  float c101 = gdHash3(i + vec3(1.0, 0.0, 1.0));
  float c011 = gdHash3(i + vec3(0.0, 1.0, 1.0));
  float c111 = gdHash3(i + vec3(1.0, 1.0, 1.0));
  float x00 = mix(c000, c100, u.x), x10 = mix(c010, c110, u.x);
  float x01 = mix(c001, c101, u.x), x11 = mix(c011, c111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

float gdFbm3(vec3 p) {
  float v = 0.0, a = 0.5, fq = 1.0;
  for (int i = 0; i < 3; i++) {
    v += a * gdValueNoise3(p * fq);
    a *= 0.5; fq *= 2.0;
  }
  return v / 0.875;
}

float gdWarpY(vec2 xz) {
  float R = length(xz);
  if (R <= GD_WARP_ONSET) return 0.0;
  float t = (R - GD_WARP_ONSET) / (GD_DISC_RADIUS - GD_WARP_ONSET);
  return t * t * GD_WARP_RIM_AMP * sin(atan(xz.y, xz.x));
}

float gdFlare(float R) {
  return exp(max(0.0, R - GD_HOME.x) / GD_R_FLARE);
}

float gdTaper(float R) {
  float t = clamp((R - GD_TAPER_IN) / (GD_TAPER_OUT - GD_TAPER_IN), 0.0, 1.0);
  return 1.0 - t * t * (3.0 - 2.0 * t);
}

float gdSpiralInnerFade(float R) {
  float t = clamp((R - 1500.0) / 600.0, 0.0, 1.0); // spiral features start at bar tips
  return t * t * (3.0 - 2.0 * t);
}

float gdArmPattern(float R, float theta) {
  float lnTerm = log(max(R, 50.0) / GD_ARM_REF_R) / tan(GD_PITCH);
  // m=2 major + m=4 secondary crest, inter-arm nulls preserved (negative
  // lobes clamp to 0); pow(.,ARM_SHARP) narrows & defines the arms.
  float crest = 0.667 * cos(2.0 * (theta - lnTerm)) + 0.333 * cos(4.0 * (theta - lnTerm));
  return pow(max(0.0, crest), uArmSharp) * gdSpiralInnerFade(R);
}

// Organic 3D-FBM falloff that breaks the smooth arm ridge into clumpy, wispy,
// star-position-like structure (cloud base-shape × noise). In [FLOOR, 1].
float gdArmFalloff(vec3 p) {
  float n = gdFbm3(p / uArmScale) * 0.5 + 0.5;
  return uArmFloor + (1.0 - uArmFloor) * n;
}

float gdDustLane(float R, float theta) {
  float lnTerm = log(max(R, 50.0) / GD_ARM_REF_R) / tan(GD_PITCH);
  float c = 0.5 + 0.5 * cos(2.0 * (theta - lnTerm) - GD_LANE_OFFSET);
  return pow(c, GD_DUST_SHARP);
}

float gdHernquist(float r, float a) {
  float x = max(r, 0.05 * a) / a;
  return 1.0 / (x * pow(1.0 + x, 3.0));
}

float gdBarField(float x, float yw, float z) {
  float cb = cos(GD_BAR_ANGLE), sb = sin(GD_BAR_ANGLE);
  float u = x * cb + z * sb;
  float v = -x * sb + z * cb;
  return exp(-(u / GD_BAR_LEN) * (u / GD_BAR_LEN)
             - (v / GD_BAR_W) * (v / GD_BAR_W)
             - (yw / GD_BAR_H) * (yw / GD_BAR_H));
}

struct GalaxySample { vec3 j; float kappaV; };

// Extinction coefficient κ_V only (the EXTINCTION block of sampleGalaxy, extracted so
// a light-march can sample dust without the full emission cost). Takes R/yw/theta/tap
// precomputed by the caller, so sampleGalaxy's combined path recomputes nothing — its
// kappaV is byte-identical to the inline version.
float gdDustKappa(vec3 p, float R, float yw, float theta, float tap) {
  float dust = exp(-R / GD_HR_DUST)
    * (exp(-abs(yw) / GD_HZ_DUST) + GD_DUST2_W * exp(-abs(yw) / GD_HZ_DUST2));
  // Clump fBm only where dust is non-negligible (perf; mirrors TS guard).
  if (dust > 1e-5) {
    dust *= 0.4 + 1.2 * gdFbm3(p / GD_CLUMP_SCALE);
    float lf = gdSpiralInnerFade(R);
    dust *= (1.0 - lf) + lf * (0.25 + gdDustLane(R, theta));
  }
  dust *= tap;

  float kappaV = GD_KAPPA_MID * dust / GD_DUST_NORM * uDustStrength;
  for (int i = 0; i < N_RIFT; i++) {
    vec3 d = (p - GD_RIFT[i].c) / GD_RIFT[i].r;
    float d2 = dot(d, d);
    if (d2 < 9.0) kappaV += GD_RIFT[i].k * exp(-d2);
  }
  return kappaV;
}

GalaxySample sampleGalaxy(vec3 p) {
  float R = length(p.xz);
  float theta = atan(p.z, p.x);
  float yw = p.y - gdWarpY(p.xz);
  float tap = gdTaper(R);

  // EMISSION
  float hzT = GD_HZ_THIN * uDiscWidth * gdFlare(R);
  float thin = exp(-R / GD_HR_THIN) * exp(-abs(yw) / hzT);
  float thick = GD_THICK_W * exp(-R / GD_HR_THICK) * exp(-abs(yw) / GD_HZ_THICK);
  float bulge = GD_BULGE_AMP * uBulgeAmp * gdHernquist(
    length(vec3(p.x, yw * GD_BULGE_SQUASH, p.z)), GD_BULGE_A);
  float bar = GD_BAR_AMP * gdBarField(p.x, yw, p.z);
  float armS = 1.0 + uArmContrast * gdArmPattern(R, theta) * gdArmFalloff(p);

  vec3 j = (GD_COL_DISC * (thin * armS) + GD_COL_OLD * thick
            + GD_COL_BULGE * (bulge + bar)) * tap;

  for (int i = 0; i < N_HII; i++) {
    vec3 d = p - GD_HII[i].c;
    float d2 = dot(d, d) / (GD_HII[i].r * GD_HII[i].r);
    if (d2 < 9.0) j += GD_COL_HII * (GD_HII[i].amp * exp(-d2)) * uHiiAmp;
  }

  // EXTINCTION (extracted to gdDustKappa; identical result, reusable by the light-march)
  float kappaV = gdDustKappa(p, R, yw, theta, tap);

  return GalaxySample(j, kappaV);
}
`;
