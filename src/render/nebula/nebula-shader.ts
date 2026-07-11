// ═══════════════════════════════════════════════════════════════════
// NEBULA SHADER — one nested iso-density SHELL (Orlando's technique).
//
// A shell is a subdivided icosphere whose vertices are pushed along their
// normal by fBm — a lumpy iso-density surface, not a billboard. The stack of
// shells at graduated radii/opacities approximates the emission volume for
// real-time cost (no per-pixel raymarch).
//
// Fragment work (the ecency recipe): sample a domain-warped fBm density
// field in the shell's OBJECT frame (continuous across shells since they
// share the group origin), then
//   • emission colour ramp — [OIII] teal at the hot/dense core → H-alpha red
//     across the broader ionized gas, keyed by the shell's ramp param + the
//     escalating pow(density,{2,5}) core glow;
//   • dust as an ABSORPTION term — a second fBm field attenuates the emission
//     via exp(-dust·κ), thicker on the outer shells.
// Additive blending stacks the shells into a volumetric glow (teal core reads
// through the redder envelope), matching star-shells' compositing.
// ═══════════════════════════════════════════════════════════════════

import { nebulaNoiseGLSL } from './nebula-noise';

export const nebulaVertexShader = /* glsl */ `
  precision highp float;

  uniform float uRadius;   // shell radius, world units (undisplaced)
  uniform float uWarp;     // domain-warp strength for the density field
  uniform float uWarpAmp;  // vertex displacement amount (fraction of radius)
  uniform float uFreq;     // field frequency over the unit sphere
  uniform vec3  uSeed;     // per-shell field offset (deterministic)
  uniform float uTime;     // slow drift (does not affect authored geometry)

  varying vec3 vField;     // stable field-sample point (unit-sphere dir · freq)
  varying vec3 vNormalV;   // view-space normal (for limb/fresnel)
  varying vec3 vViewDir;   // view-space direction to camera

  ${nebulaNoiseGLSL}

  void main() {
    vec3 dir = normalize(position);
    // Field coordinate: the UNDISPLACED direction, so the fragment field is
    // stable regardless of the vertex push (no swim), and coherent across the
    // shell stack (all shells share this origin + frequency family).
    vec3 field = dir * uFreq + uSeed;
    vField = field;

    // Iso-density displacement: push the smooth sphere out along its normal by
    // a warped-fBm lump so the silhouette breaks into filaments instead of a
    // clean ball. A gentle uTime term lets the surface breathe.
    float lump = nbWarpedFbm3(field + vec3(uTime * 0.02, 0.0, uTime * 0.015), uWarp);
    vec3 displaced = dir * uRadius * (1.0 + (lump - 0.5) * 2.0 * uWarpAmp);

    vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
    vNormalV = normalize(normalMatrix * dir);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

export const nebulaFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uPresence;    // 0..1 zoom-LOD gate (galaxy-scale visibility)
  uniform float uBrightness;  // overall emission gain
  uniform float uOpacity;     // this shell's base coverage
  uniform float uColorT;      // 0 = core shell (teal) → 1 = outer shell (dust)
  uniform float uWarp;        // domain-warp strength (matches the vertex field)
  uniform float uTime;

  uniform vec3  uOIII;        // [OIII] 500.7nm teal — hottest/most-ionized core
  uniform vec3  uHalpha;      // H-alpha 656.3nm red — broad ionized envelope
  uniform vec3  uDust;        // dust extinction tint (absorption term)
  uniform float uOIIIStr;
  uniform float uHalphaStr;
  uniform float uDustStr;

  varying vec3 vField;
  varying vec3 vNormalV;
  varying vec3 vViewDir;

  ${nebulaNoiseGLSL}

  void main() {
    // Domain-warped density (kills banding, yields filaments). The drift term
    // keeps the wisps alive without moving the authored shell.
    vec3 p = vField + vec3(0.0, uTime * 0.02, 0.0);
    float d = clamp(nbWarpedFbm3(p, uWarp), 0.0, 1.0);

    // Layered core glow (ecency recipe): escalating powers isolate the densest
    // gas. pow(d,2) is the broad ionized body; pow(d,5)/pow(d,8) are the hot
    // compact core where [OIII] emission concentrates.
    float body = pow(d, 2.0);
    float core = pow(d, 5.0);
    float hot  = pow(d, 8.0);

    // Emission ramp: teal [OIII] traces the hot dense core (boosted so it reads
    // THROUGH the additive red envelope); H-alpha red fills the broader body and
    // strengthens outward (uColorT) as [OIII] fades. The core term is weighted
    // toward the inner shells (colorT→0), the body toward the outer.
    vec3 emit =
        uOIII   * uOIIIStr   * (core * 2.6 + hot * 3.2) * (1.0 - 0.6 * uColorT)
      + uHalpha * uHalphaStr * body * (0.35 + 0.65 * uColorT);

    // Dust as ABSORPTION: an offset fBm field extinguishes the emission,
    // thicker on the outer (dustier) shells. A faint scatter tint remains so
    // the lanes read as brown-red, not pure black.
    float dust = nbFbm3(p * 1.7 + 13.0);
    float trans = exp(-dust * uDustStr * (0.25 + 0.75 * uColorT));
    emit = emit * trans + uDust * (1.0 - trans) * 0.03;

    // Limb brightening: grazing faces integrate more path through the shell.
    // A low face-on base keeps the shells as translucent VEILS (you see through
    // the red envelope to the teal core — diffuse gas, not stacked onion skins);
    // the fresnel term concentrates coverage at the limbs where the line of
    // sight grazes more gas.
    float fres = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewDir))), 1.5);
    float coverage = clamp(smoothstep(0.06, 0.68, d) * (0.32 + 0.85 * fres), 0.0, 1.0);

    float a = coverage * uOpacity * uPresence;
    if (a < 0.002) discard;
    gl_FragColor = vec4(emit * uBrightness * uPresence, a);
  }
`;
