// ═══════════════════════════════════════════════════════════════════
// STAR SURFACE SHADER — one uniform-driven ShaderMaterial for all types
//
// procedural-star-research.md §3–§4 / procedural-worlds-plan.md S1–S2:
//   • animated fBm + domain-warp plasma flow on the sphere;
//   • granulation amplitude gated by type (≈0 for O/B smooth photospheres,
//     high for M) — driven by uGranulationAmp;
//   • limb-darkening Fresnel (dimmer, redder rim);
//   • starspots (low-freq clamped noise) scaled by uSpotCoverage;
//   • differential rotation (equator leads the poles);
//   • per-fragment LOCAL temperature → colour via the Planckian fit
//     (GLSL_KELVIN) — hot granules bluer, cool spots redder, no baked ramp;
//   • S2: activity-gated polar-sine flares + limb prominence tendrils;
//   • HDR emissive (uEmissiveGain ∝ luminosity) feeds the shared bloom pass;
//   • uDetailFade collapses surface detail toward a flat emissive disc as the
//     star shrinks to a point on pull-back (no aliasing shimmer, clean LOD).
//
// Self-contained: inlines a 3D simplex-noise implementation (Ashima /
// Gustavson, public domain) so the module depends on no other render file.
// logdepthbuf chunks included — the renderer runs a logarithmic depth buffer.
// ═══════════════════════════════════════════════════════════════════

import { GLSL_KELVIN } from './kelvin';

// Ashima 3D simplex noise (public domain) — snoise(vec3) → [-1,1].
const GLSL_SIMPLEX = /* glsl */ `
vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// 5-octave fractional Brownian motion, remapped to ~[0,1]. Five octaves is the
// detail/perf sweet spot the reference build settled on (research §1).
float fbm(vec3 p){
  float sum = 0.0, amp = 0.5, freq = 1.0;
  for (int i = 0; i < 5; i++){
    sum += amp * snoise(p * freq);
    freq *= 2.0;
    amp *= 0.5;
  }
  return sum * 0.5 + 0.5;
}
`;

export const starVertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vDir;        // object-space unit direction — stable noise domain
varying vec3 vNormalV;    // view-space normal (limb darkening)
varying vec3 vViewDirV;   // view-space fragment→camera direction

void main() {
  vDir = normalize(position);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normalize(position));
  vViewDirV = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`;

export const starFragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform float uTime;
uniform float uTempK;
uniform float uRadius;         // solar radii — limb softness
uniform float uLuminosity;     // solar L — subtle core lift
uniform float uGranulationAmp; // type-gated (≈0 O/B, high M)
uniform float uSpotCoverage;   // activity-scaled fractional coverage
uniform float uActivity;       // ∈[0,1]
uniform float uRotation;       // rad/s base spin
uniform float uDifferential;   // equator-leads strength
uniform float uEmissiveGain;   // HDR magnitude ∝ luminosity
uniform float uFlareRate;      // ∈[0,1] flare/prominence gate (S2)
uniform float uDetailFade;     // 1 near → 0 far (LOD to flat disc)
uniform float uSeed;

varying vec3 vDir;
varying vec3 vNormalV;
varying vec3 vViewDirV;

${GLSL_KELVIN}
${GLSL_SIMPLEX}

// Differential rotation: shift longitude by a latitude-dependent rate so the
// equator leads the poles (rigid when uDifferential = 0).
vec3 rotateDiff(vec3 p, float t) {
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float lon = atan(p.z, p.x);
  float rate = uRotation * (1.0 - uDifferential * sin(lat) * sin(lat));
  lon += t * rate;
  float cl = cos(lat);
  return vec3(cl * cos(lon), sin(lat), cl * sin(lon));
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 so = vec3(uSeed * 0.137, uSeed * 0.271, uSeed * 0.523);
  vec3 sp = rotateDiff(vDir, uTime);

  // ── Domain-warped plasma flow ──
  float flow = uTime * (0.05 + 0.10 * uActivity);
  vec3 warp = vec3(
    fbm(sp * 2.0 + so + flow),
    fbm(sp * 2.0 + so + 5.2 - flow),
    fbm(sp * 2.0 + so + 9.1 + flow * 0.5)
  ) - 0.5;
  vec3 q = sp + 0.35 * warp;

  // ── Granulation (type-gated) ──
  float gran = (fbm(q * 4.0 + so + flow * 0.6) - 0.5) * uGranulationAmp;

  // ── Broad temperature-variation layer (slow, large-scale) ──
  float broad = fbm(sp * 0.8 + so + uTime * 0.02) - 0.5;

  // ── Starspots (low-freq clamped noise, activity-scaled coverage) ──
  float spotN = fbm(sp * 1.3 + so + 17.0);
  float spot = uSpotCoverage > 0.001
    ? smoothstep(1.0 - uSpotCoverage, 1.0 - 0.35 * uSpotCoverage, spotN)
    : 0.0;

  // ── Per-fragment local temperature → Planckian colour ──
  float tempMod = 1.0 + (0.12 * gran + 0.04 * broad - 0.34 * spot) * uDetailFade;
  float localTemp = uTempK * tempMod;
  vec3 col = kelvinToRGB(localTemp);

  // ── Limb darkening (Fresnel): dimmer + redder toward the rim ──
  float ndv = clamp(dot(normalize(vNormalV), normalize(vViewDirV)), 0.0, 1.0);
  float limbExp = mix(0.45, 0.75, clamp(uRadius * 0.25, 0.0, 1.0)); // giants soften
  float limb = pow(ndv, limbExp);
  col *= mix(0.32, 1.0, limb);
  col = mix(col * vec3(1.18, 0.72, 0.46), col, limb); // reddened rim
  col *= 1.0 + 0.05 * log(max(uLuminosity, 1e-3) + 1.0) * limb; // faint core lift

  // Granulation + spots also modulate BRIGHTNESS (not just colour), so the
  // convective mottling and dark starspots read through the HDR/bloom instead
  // of washing out to a flat white disc. Faded out with distance (clean LOD).
  float surfBright = 1.0 + (0.30 * gran - 0.60 * spot) * uDetailFade;
  col *= max(surfBright, 0.15);

  // ── S2: activity-gated flares / prominences at the limb ──
  if (uFlareRate > 0.001) {
    float rim = 1.0 - ndv;
    float ang = atan(sp.z, sp.x);
    // Polar-coordinate sine flares — tongues of plasma around the disc.
    float tongues = pow(max(sin(ang * 8.0 + uTime * (0.6 + 0.8 * uActivity) + uSeed), 0.0), 3.0);
    // Eruption gate: high-freq animated noise, thresholded by flare rate.
    float erupt = smoothstep(0.62, 1.0, fbm(sp * 6.0 + so + uTime * 0.3));
    float flare = tongues * erupt * uFlareRate * smoothstep(0.25, 0.95, rim);
    col += flare * vec3(1.5, 0.55, 0.2) * 2.2 * uDetailFade;
  }

  // ── HDR emissive → shared bloom (∝ luminosity) ──
  col *= uEmissiveGain;

  gl_FragColor = vec4(col, 1.0);
}
`;

// ── Additive glow shell — scene-scaled corona (shrinks with the star) ────────
// A soft rim halo on a slightly larger back-side sphere. Radius rides the star
// body (never screen-constant), so on pull-back it shrinks WITH the disc — no
// fixed-size "catalogue-ball" pile-up — and the shared bloom carries the rest.

export const starGlowVertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vNormalV;
varying vec3 vViewDirV;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normalize(position));
  vViewDirV = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`;

export const starGlowFragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uIntensity;
uniform float uDetailFade;
varying vec3 vNormalV;
varying vec3 vViewDirV;
void main() {
  #include <logdepthbuf_fragment>
  float ndv = clamp(dot(normalize(vNormalV), normalize(vViewDirV)), 0.0, 1.0);
  // Back-side shell: brightest at the silhouette (grazing), fading outward.
  float rim = pow(1.0 - ndv, 2.4);
  gl_FragColor = vec4(uColor * rim * uIntensity, rim);
}
`;
