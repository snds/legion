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

// 3-octave fBm — the cheap variant for hot paths (dense granulation, the corona
// raymarch) where five octaves at high base frequency is wasted cost + aliasing.
float fbm3(vec3 p){
  float sum = 0.0, amp = 0.5, freq = 1.0;
  for (int i = 0; i < 3; i++){
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

// Magnetic active-region footpoints (active-regions.ts): dark umbra + bright
// plage anchors. uSpotDir are object-space unit directions; keep the fixed 10
// in lock-step with MAX_FOOTPOINTS.
uniform int uSpotCount;
uniform vec3 uSpotDir[10];
uniform float uSpotStr[10];

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

  // ── Convective plasma flow ──
  // A SMALL, high-frequency domain warp roils the granulation (turbulent shear)
  // without the large-scale swirl that read as "cloud layers". Time enters the
  // noise VOLUME as a z-offset so cells boil IN PLACE — appear, merge, fade — on
  // top of the rotational advection carried by sp. Rate is time-warp-coupled via
  // uTime (see procedural-star.ts).
  float flow = uTime * (0.10 + 0.14 * uActivity);
  vec3 warp = vec3(
    snoise(sp * 4.0 + vec3(0.0, 0.0, flow)),
    snoise(sp * 4.0 + vec3(5.2, 0.0, flow)),
    snoise(sp * 4.0 + vec3(9.1, 0.0, flow))
  );
  vec3 q = sp + 0.045 * warp;

  // ── High-density granulation → a "temperature field" ∈~[0,1] ──
  // Fine, dense convection cells tiled far higher than before (so it reads as
  // roiling granules, not smooth clouds): a primary granule octave + a fine
  // mottle octave, both boiling through the noise volume. Dark SUNSPOTS are
  // subtracted and bright FACULAE added below. The field drives colour AND
  // brightness; the colour RANGE is set by the star's temperature (kelvinToRGB),
  // so type still governs hue — this only governs the mottling within it.
  float boil = flow * 1.4;
  float g1 = fbm3(q * 11.0 + so + vec3(0.0, 0.0, boil));        // primary granules
  float g2 = fbm3(q * 24.0 + so + vec3(0.0, 0.0, boil * 1.7));  // fine mottle
  float granule = g1 * 0.62 + g2 * 0.38;                        // ~[0,1], mean ~0.5

  // Magnetic sunspots + plage from the active-region footpoints: each footpoint
  // is a dark UMBRA core ringed by bright faculae/PLAGE. The coronal loops anchor
  // at the SAME points, so the spots and the arcs are one magnetic structure. A
  // little noise wobble keeps the spots from being perfect circles.
  float umbra = 0.0;
  float plage = 0.0;
  float wob = 0.030 * (fbm(sp * 6.0 + so) - 0.5);   // irregular spot boundary
  for (int i = 0; i < 10; i++) {
    if (i >= uSpotCount) break;
    float ang = acos(clamp(dot(sp, uSpotDir[i]), -1.0, 1.0)) + wob;
    float s = uSpotStr[i];
    // Dark umbra core + surrounding faculae/plage ring (bright).
    umbra = max(umbra, s * smoothstep(0.135, 0.050, ang));
    plage = max(plage, s * (smoothstep(0.34, 0.14, ang) - smoothstep(0.14, 0.075, ang)));
  }
  plage *= 0.55 + 0.85 * fbm(sp * 6.0 + so);      // plage is granular, not a flat wash

  float field = 0.5
    + (granule - 0.5) * (1.45 * uGranulationAmp)  // convective contrast (type-gated)
    + plage * 0.50                                // bright faculae ringing the spots
    - umbra * 1.55;                               // dark umbra
  // Collapse to a flat disc as the star shrinks to a point (clean LOD, no shimmer).
  field = 0.5 + (field - 0.5) * uDetailFade;
  field = clamp(field, 0.0, 1.25);

  // ── field → local temperature → Planckian colour (wide sweep, mean ≈ Teff) ──
  float localTemp = uTempK * mix(0.66, 1.34, field);
  vec3 col = kelvinToRGB(localTemp);

  // ── Limb darkening (Fresnel): dimmer + redder toward the rim ──
  float ndv = clamp(dot(normalize(vNormalV), normalize(vViewDirV)), 0.0, 1.0);
  float limbExp = mix(0.45, 0.75, clamp(uRadius * 0.25, 0.0, 1.0)); // giants soften
  float limb = pow(ndv, limbExp);
  col *= mix(0.32, 1.0, limb);
  col = mix(col * vec3(1.18, 0.72, 0.46), col, limb); // reddened rim
  col *= 1.0 + 0.05 * log(max(uLuminosity, 1e-3) + 1.0) * limb; // faint core lift

  // Brightness tracks the SAME field so granules glow and sunspots go genuinely
  // dark (they read through the HDR/bloom instead of washing to a flat disc).
  float surfBright = mix(0.35, 1.55, field);
  col *= max(surfBright, 0.08);

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

  // Close-range exposure trim: at full detail the ×gain disc otherwise clips to
  // a flat white ball (bloom + AgX desaturate the highlight), burying both the
  // granulation and the star's own colour. Pull the disc well down when it fills
  // the frame so the amber photosphere + dark sunspots read; restore full
  // magnitude as it shrinks so the distant point-of-light brightness / bloom
  // hand-off stays calibrated (uDetailFade → 0 far away).
  col *= mix(1.0, 0.34, uDetailFade);

  gl_FragColor = vec4(col, 1.0);
}
`;

// ── Volumetric corona — raymarched streamers on a bounding shell ─────────────
// Replaces the old flat back-side glow (which filled its whole disc with a grey
// wash and occluded the starfield). A bounding sphere at uRb·body-radii is
// marched in OBJECT space: at each sample the density is angular-noise streamers
// (coherent along the radial → plumes point outward, like real coronal
// streamers) times a radial falloff that's dense near the photosphere and
// decays to nothing at the shell. Additive + wispy, so there is no hard
// silhouette to collide with other bodies, and it rides the star body so it
// LODs away on pull-back. Occluded by the photosphere: the march stops at the
// near surface intersection, so the far half never bleeds through the star.

export const coronaVertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vObjPos;
void main() {
  vObjPos = position; // object space (body-radius units)
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`;

export const coronaFragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;      // temperature tint
uniform vec3 uCamObjPos;  // camera position in this mesh's object space
uniform float uIntensity; // distance-enveloped brightness (0 → skip)
uniform float uReach;     // 0 = hug the limb (in-system) … 1 = flared plumes (Kuiper)
uniform float uTime;
uniform float uActivity;
uniform float uSeed;
uniform float uRs;        // photosphere radius (object units)
uniform float uRb;        // bounding-shell radius (object units)
varying vec3 vObjPos;

${GLSL_SIMPLEX}

// Ray/sphere: t at (near,far). Miss → (1e9,-1e9) so far<near fails every test.
vec2 raySphere(vec3 ro, vec3 rd, float rad) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - rad * rad;
  float h = b * b - c;
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

const int STEPS = 12;

void main() {
  #include <logdepthbuf_fragment>
  if (uIntensity < 0.001) discard;   // enveloped away (deep in-system dim, or past the heliopause)

  vec3 ro = uCamObjPos;
  vec3 rd = normalize(vObjPos - ro);

  vec2 tb = raySphere(ro, rd, uRb);      // enter/exit the corona shell
  float t0 = max(tb.x, 0.0);
  float t1 = tb.y;
  if (t1 <= t0) discard;

  // Occlude behind the photosphere: clip the march to the near surface hit.
  vec2 ts = raySphere(ro, rd, uRs);
  if (ts.y > ts.x && ts.x > t0) t1 = min(t1, ts.x);
  if (t1 <= t0) discard;

  float stepLen = (t1 - t0) / float(STEPS);
  float flow = uTime * (0.05 + 0.05 * uActivity);
  vec3 so = vec3(uSeed * 0.13, uSeed * 0.29, uSeed * 0.51);

  float emission = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float t = t0 + (float(i) + 0.5) * stepLen;
    vec3 p = ro + rd * t;
    float r = length(p);
    float radial = clamp((r - uRs) / max(uRb - uRs, 1e-4), 0.0, 1.0);
    vec3 dir = p / max(r, 1e-4);
    // Angular-dominated domain → noise is coherent along each radial line, so
    // features read as plumes/streamers reaching outward. Slow churn + a gentle
    // outward advection give the living, breathing look.
    vec3 qd = dir * 2.4 + so + vec3(0.0, 0.0, flow) - dir * flow * 0.6;
    float n = fbm3(qd * 1.7);
    float streamer = pow(max(n, 0.0), 2.3);
    // Coronal density: brightest hugging the limb, decaying outward. The decay
    // rate is set by uReach — steep (tight rim) in-system, gentle (plumes reach
    // outward) at the Kuiper flare. A small dip at the surface keeps it a halo.
    float decay = mix(9.0, 2.6, uReach);
    float dens = streamer * exp(-radial * decay) * smoothstep(0.0, 0.05, radial);
    emission += dens;
  }
  emission *= stepLen / max(uRb - uRs, 1e-4);
  emission *= uIntensity;

  gl_FragColor = vec4(uColor * emission, 1.0); // additive blend consumes rgb
}
`;
