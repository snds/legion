// ═══════════════════════════════════════════════════════════════════
// GALAXY CLOUD — a low-res emission raymarch of the interstellar GAS/nebulosity that follows the SAME
// spiral structure as the physically-sampled stars (galaxy-physical.ts). Emission-only + additive: the gas
// adds a soft blue/HII glow ON the arms; the dust layer (renderOrder 10) then occludes it.
//
// PERF (the static-field bake): the gas density is a FROZEN MOMENT (only root.rotation.y moves), so the
// march re-evaluated an identical FBM-heavy integral every frame — pure waste. We now BAKE densityAt() ONCE
// into a 2D SLICE ATLAS (32 thin Y-layers packed 8×4 into a 2048×1024 RGBA8 texture: RGB = pre-tinted
// emission, A = density) using the offscreen render+readback harness, then the SAME ray-AABB box-march reads
// one manual-trilinear texture fetch per step instead of ~2 FBM. The baked atlas rides the rigid rotation
// for free (the march runs in the local frame), so it stays correct face-on / edge-on / dive-in with no
// re-bake — re-bake only on sync() (the same knob-change event that resamples the stars). A plain 2D atlas
// (not a 3D texture) keeps it GLSL-ES-1.00 + universally portable (iPad WebGL2). If no bake renderer is
// available the shader falls back to the LIVE march (uUseVolume=0), so it can never fail closed.
// ═══════════════════════════════════════════════════════════════════

import {
  AdditiveBlending, BackSide, BoxGeometry, ClampToEdgeWrapping, Color, DataTexture, LinearFilter,
  Matrix4, Mesh, NoBlending, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial,
  UnsignedByteType, Vector3, Vector4, WebGLRenderTarget,
  type Camera, type WebGLRenderer,
} from 'three';
import { WU_PER_PC } from '../core/metrics';
import { getBakeRenderer } from './texture-baker';
import { MW } from './mw-model';
import type { PhysicalGalaxyConfig } from './galaxy-physical';

const KPC_TO_WU = 1000 * WU_PER_PC;
const DEG2RAD = Math.PI / 180;

// Slice-atlas dimensions: 32 Y-layers packed 8 cols × 4 rows of 256² tiles → one 2048×1024 RGBA8 texture.
const TILE = 256, A_COLS = 8, A_ROWS = 4, SLICES = A_COLS * A_ROWS; // 32
const ATLAS_W = TILE * A_COLS, ATLAS_H = TILE * A_ROWS;             // 2048 × 1024

export interface CloudConfig {
  scaleHeight_pc: number; // gas layer thickness (thicker than dust, thinner than stars)
  leadDeg: number;        // gas sits just inside the arm crest (HII on the leading edge)
  armSharp: number;       // arm ridge tightness (cos^k)
  clumpScale: number;     // 3D clump frequency (per kpc) — the structure scale
  definition: number;     // 0 = soft round clumps … 1 = high-contrast filamentary structure (outcome knob)
  selfShadow: number;     // 0 = flat emission … 1 = strong bake-time self-shadow (volumetric form); 0 = off
  coreWhite: number;      // 0 = no white (blue/pink only) … 1 = dense gas reads cool/warm white (legibility)
  intensity: number;      // emission gain
}

export const DEFAULT_CLOUD_CONFIG: CloudConfig = {
  // intensity bumped 0.9 → 2.5: at 0.9 the additive gas was invisible against the bright star field (you
  // couldn't tell it was rendering). It reads distinctly only once self-shadow/white (P2/P3) give it
  // character; until then this at least makes it visible, especially with stars toggled off.
  scaleHeight_pc: 180, leadDeg: 6, armSharp: 6.0, clumpScale: 1.4, definition: 0.5, selfShadow: 0.4,
  coreWhite: 0.55, intensity: 2.5,
};

// The 'definition' outcome knob drives two field uniforms along a tuned curve: contrast (gamma) opens the
// inter-clump gas, erosion carves filaments. Kept here so buildGalaxyCloud + sync() derive them identically.
const defToGamma = (d: number): number => 1.0 + 2.0 * d;   // 0 → 1 (smooth) … 1 → 3 (clumps pop)
const defToErosion = (d: number): number => 0.75 * d;      // 0 → none … 1 → strong filament carving
// 'self shadow' knob → bake-time absorption coefficient for the +Y light-march (0 = off).
const defToShadow = (d: number): number => d * 8.0;
// 'core white' knob → density thresholds where the white ramp starts (lo) and saturates (hi). Higher knob =
// lower thresholds = more of the dense gas reads white. Calibrated to the MEASURED field: density is heavily
// skewed (p90≈0.025, p99≈0.087, max≈0.34), so the white must key off the top few % to land on the dense
// ridges/clumps. c=0 → barely any white; c=0.5 → top ~few % white; c=1 → most structure white.
const whiteHi = (c: number): number => 0.16 - 0.115 * c; // c=0 → 0.16 … c=0.5 → 0.10 … c=1 → 0.045
const whiteLo = (c: number): number => whiteHi(c) * 0.33;

// Gas disc is flatter/more extended than the stars, so the arm ridges — not a bright central ring —
// carry the structure. Radial scale length = stellar × this.
const GAS_RADIAL_FACTOR = 1.7;

// ── Shared density GLSL: the SHAPE uniforms + noise + armWave + spurField + densityAt. Included VERBATIM by
//    both the bake quad AND the runtime fallback, so they evaluate an identical field (zero aesthetic drift).
const DENSITY_GLSL = /* glsl */ `
  precision highp float;
  #define PI 3.14159265

  uniform vec3 uBoxMin;       // local-space AABB (WU)
  uniform vec3 uBoxMax;
  uniform float uKpcWu;       // WU per kpc
  uniform float uRd;          // disc radial scale length (kpc)
  uniform float uRmax;        // truncation (kpc)
  uniform float uHgas;        // gas vertical scale height (kpc)
  uniform float uArmCount;    // m
  uniform float uPitchTan;    // tan(pitch)
  uniform float uNoiseScale;  // arm warp spatial frequency (per kpc)
  uniform float uArmNoise;    // warp amplitude
  uniform float uR0;          // log-spiral reference radius (kpc)
  uniform float uArmSharp;
  uniform float uLeadGas;     // phase lead (rad)
  uniform float uBarLo;       // inner spiral fade-in (kpc)
  uniform float uBarHi;
  uniform float uClumpFreq;   // per kpc — clump spatial frequency (structure scale)
  uniform float uClumpGamma;  // clump contrast (1 = smooth … higher = clumps pop, inter-clump empties)
  uniform float uErosionAmt;  // 0 = round clumps … 1 = filamentary (ridged erosion carves threads)
  uniform float uRimFeather;  // 0 = sharp rim … 1 = ragged, wispy feathered edge
  uniform float uSpurAmp;     // spur/feather field (shared with galaxy-physical.ts)
  uniform float uSpurOpen;
  uniform float uSpurDensity;
  uniform float uSpurSharp;
  uniform float uSpurWarp;
  uniform float uSpurInterArm;
  uniform float uSpurFlank;
  uniform float uSpurReach;
  uniform vec3 uArmGlow;      // cool blue arm emission
  uniform vec3 uHiiGlow;      // warm pink HII knots
  uniform vec3 uCoolWhite;    // dense OUTER/young gas → cool white
  uniform vec3 uWarmWhite;    // dense INNER/old gas → warm white
  uniform float uWhiteLo;     // density where the white ramp starts
  uniform float uWhiteHi;     // density where the gas is fully white
  uniform float uRwarm;       // R (kpc) below which dense gas is warm-white
  uniform float uRcool;       // R (kpc) above which dense gas is cool-white

  float hash21(vec2 p) {
    p = fract(p * vec2(127.31, 311.7));
    p += dot(p, p + 34.21);
    return fract(p.x * p.y) * 2.0 - 1.0;
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm2(vec2 p) {
    return 0.6 * vnoise(p) + 0.3 * vnoise(p * 2.13) + 0.1 * vnoise(p * 4.31);
  }
  // ── 3D value noise (signed, same style as the 2D pair) so the gas clumps are genuinely volumetric
  //    blobs, not the XZ-keyed vertical columns the old p.y phase-shift produced. ──
  float hash31(vec3 p) {
    p = fract(p * vec3(127.31, 311.7, 74.7));
    p += dot(p, p.yzx + 34.21);
    return fract((p.x + p.y) * p.z) * 2.0 - 1.0;
  }
  float vnoise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i), n100 = hash31(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(i + vec3(0.0, 1.0, 0.0)), n110 = hash31(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(i + vec3(0.0, 0.0, 1.0)), n101 = hash31(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(i + vec3(0.0, 1.0, 1.0)), n111 = hash31(i + vec3(1.0, 1.0, 1.0));
    float x00 = mix(n000, n100, u.x), x10 = mix(n010, n110, u.x);
    float x01 = mix(n001, n101, u.x), x11 = mix(n011, n111, u.x);
    return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
  }
  float fbm3(vec3 p) {
    return 0.6 * vnoise3(p) + 0.3 * vnoise3(p * 2.13) + 0.1 * vnoise3(p * 4.31);
  }
  // Ridged erosion octave — the GLSL twin of galaxy-physical.ts ridge(): pow(max(0,1-|fbm|),sharp).
  // Carves filamentary edges so dense gas reads as threads, not a smooth blob.
  float ridged3(vec3 p, float sharp) {
    return pow(max(0.0, 1.0 - abs(fbm3(p))), sharp);
  }
  float spurField(float R, float phi, float psi, float warp, float cot, float L) {
    if (uSpurAmp <= 0.0) return 0.0;
    float inner = smoothstep(uBarLo, uBarHi, R);
    if (inner <= 0.0) return 0.0;
    float cot2 = cot / uSpurOpen;
    float m2 = uArmCount * uSpurDensity;
    float ns2 = uNoiseScale * 1.7;
    vec2 q2 = vec2(R * cos(phi), R * sin(phi)) * ns2;
    float w2 = uSpurWarp * PI * fbm2(q2 + 137.0);
    float psi2 = m2 * (phi - cot2 * L) + uSpurDensity * warp + w2;
    float tooth = pow(max(0.0, cos(psi2)), uSpurSharp);
    float c = cos(psi);
    float onArm = smoothstep(-0.2, 0.6, c);
    float gap = 1.0 - smoothstep(-0.6, 0.2, c);
    float u = sin(psi);
    float trail = smoothstep(0.0, uSpurFlank, u);
    float reach = 1.0 - smoothstep(uSpurReach, min(0.97, uSpurReach + 0.45), u);
    return uSpurAmp * (onArm * tooth * trail * reach + uSpurInterArm * gap * tooth) * inner;
  }
  float armWave(float R, float phi) {
    float cot = 1.0 / uPitchTan;
    float L = log(max(R, 0.05) / uR0);
    vec2 q = vec2(R * cos(phi), R * sin(phi)) * uNoiseScale;
    float warp = uArmNoise * PI * fbm2(q);
    float psi = uArmCount * (phi - cot * L) + warp;
    float base = cos(psi) + spurField(R, phi, psi, warp, cot, L);
    return clamp(base, -1.0, 1.0);
  }
  // Gas density at a LOCAL-frame point (WU) → density + clumpHi (HII tint weight).
  float densityAt(vec3 p, out float clumpHi) {
    clumpHi = 0.0;
    float R = length(p.xz) / uKpcWu;
    float phi = atan(p.z, p.x);
    float rmod = uRimFeather * 0.32 * fbm2(vec2(cos(phi), sin(phi)) * 4.3 + 50.0);
    float rmid = uRmax * (1.0 + rmod);
    float rw = 0.06 + 0.30 * uRimFeather;
    float rimFall = 1.0 - smoothstep(rmid * (1.0 - rw), rmid * (1.0 + rw * 0.7), R);
    if (rimFall <= 0.002) return 0.0;
    float y = abs(p.y) / uKpcWu;
    float radial = exp(-R / uRd);
    float vert = exp(-y / uHgas);
    float barCut = smoothstep(uBarLo, uBarHi, R);
    float ridge = pow(max(0.0, armWave(R, phi + uLeadGas)), uArmSharp);
    // 3D clump field — genuinely volumetric (was an XZ-keyed value with a token p.y phase = vertical
    // columns). Contrast (uClumpGamma) lets the inter-clump gas EMPTY instead of sitting at a 0.55 floor
    // (the old fog), and a ridged erosion octave carves filamentary threads for definition.
    vec3 cp = p / uKpcWu * uClumpFreq;
    float n = clamp(0.5 + 0.5 * fbm3(cp), 0.0, 1.0);
    // Contrast (gamma) opens the inter-clump gas, but normalize by a 0.7 reference so the BRIGHT clumps stay
    // ~unchanged: definition reshapes structure, it must NOT just dim the whole field (the first-pass failure).
    float cl = pow(n, uClumpGamma) / pow(0.7, uClumpGamma);
    float ero = ridged3(cp * 2.3 + 19.0, 3.0);
    cl = clamp(mix(cl, cl * ero, uErosionAmt), 0.0, 1.5); // erosion carves filaments; clamp the renorm overshoot
    clumpHi = smoothstep(0.6, 1.1, cl) * ridge;
    return radial * vert * barCut * ridge * cl * rimFall;
  }

  // Gas emission COLOUR — shared by the bake + the live march so they never drift. Blue arm glow ↔ pink HII,
  // blended toward a density-driven WHITE in the dense volumes (cool-white in the young outer arms → warm-
  // white toward the old inner disc). The white makes the dense STRUCTURE legible; the bake's self-shadow
  // then darkens the shadowed side so the white reads as FORM, not an additive bloom.
  vec3 gasColor(vec3 p, float d, float chi) {
    float R = length(p.xz) / uKpcWu;
    vec3 baseGas = mix(uArmGlow, uHiiGlow, chi);
    vec3 whiteRamp = mix(uWarmWhite, uCoolWhite, smoothstep(uRwarm, uRcool, R));
    float rhoN = smoothstep(uWhiteLo, uWhiteHi, d); // 0 faint … 1 dense → white
    return mix(baseGas, whiteRamp, rhoN);
  }
`;

const cloudVertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const cloudFragmentShader = DENSITY_GLSL + /* glsl */ `
  varying vec3 vWorldPos;
  uniform mat4 uInvModel;     // world → galaxy local (rotating) frame
  uniform float uIntensity;
  uniform float uSteps;
  uniform sampler2D uVolume;  // baked slice atlas (RGB emission, A density)
  uniform float uUseVolume;   // 1 = sample the bake, 0 = live FBM march fallback

  #ifndef CLOUD_STEPS
  #define CLOUD_STEPS 30
  #endif

  float ign(vec2 px) {
    return fract(52.9829189 * fract(0.06711056 * px.x + 0.00583715 * px.y));
  }

  // Manual trilinear over the slice atlas. tc = (xFrac, zFrac, yFrac); the Y axis selects the slice, XZ the
  // in-tile texel. Clamp the in-tile UV to the texel centre so bilinear never bleeds across tile borders.
  vec4 sampleSlice(float s, vec2 xz) {
    float col = mod(s, ${A_COLS}.0);
    float row = floor(s / ${A_COLS}.0);
    vec2 inTile = clamp(xz, 0.5 / ${TILE}.0, 1.0 - 0.5 / ${TILE}.0);
    vec2 uv = (vec2(col, row) + inTile) / vec2(${A_COLS}.0, ${A_ROWS}.0);
    return texture2D(uVolume, uv);
  }
  vec4 sampleVolume(vec3 tc) {
    float sy = tc.z * ${SLICES}.0 - 0.5;
    float f = floor(sy);
    float s0 = clamp(f, 0.0, ${SLICES}.0 - 1.0);
    float s1 = clamp(f + 1.0, 0.0, ${SLICES}.0 - 1.0);
    return mix(sampleSlice(s0, tc.xy), sampleSlice(s1, tc.xy), clamp(sy - f, 0.0, 1.0));
  }

  void main() {
    vec3 roW = cameraPosition;
    vec3 ro = (uInvModel * vec4(roW, 1.0)).xyz;
    vec3 sp = (uInvModel * vec4(vWorldPos, 1.0)).xyz;
    vec3 rd = normalize(sp - ro);

    vec3 invD = 1.0 / rd;
    vec3 t1 = (uBoxMin - ro) * invD;
    vec3 t2 = (uBoxMax - ro) * invD;
    vec3 tMin = min(t1, t2), tMax = max(t1, t2);
    float tNear = max(max(tMin.x, tMin.y), tMin.z);
    float tFar = min(min(tMax.x, tMax.y), tMax.z);
    if (tNear > tFar || tFar < 0.0) discard;

    float t0 = max(tNear, 1.0);
    float jitter = ign(gl_FragCoord.xy);
    vec3 boxSize = uBoxMax - uBoxMin;
    vec3 accum = vec3(0.0);

    for (int i = 0; i < CLOUD_STEPS; i++) {
      if (float(i) >= uSteps) break;
      float a0 = (float(i) + jitter) / uSteps;
      float a1 = (float(i) + 1.0) / uSteps;
      float t = t0 * pow(tFar / t0, a0);
      float tn = t0 * pow(tFar / t0, a1);
      float dt = max(tn - t, 0.0) / uKpcWu;
      vec3 p = ro + rd * t;
      float d; vec3 col;
      if (uUseVolume > 0.5) {
        vec3 tc = (p - uBoxMin) / boxSize;        // (xFrac, yFrac, zFrac)
        vec4 v = sampleVolume(vec3(tc.x, tc.z, tc.y)); // atlas: XZ in-tile, Y → slice
        d = v.a * v.a; col = v.rgb;                // decode sqrt-encoded density (see bake shader)
      } else {
        float chi; d = densityAt(p, chi); col = gasColor(p, d, chi);
      }
      accum += d * col * dt;
    }

    vec3 rgb = accum * uIntensity;
    if (max(rgb.r, max(rgb.g, rgb.b)) < 0.0006) discard;
    gl_FragColor = vec4(rgb, 1.0); // AdditiveBlending: glow adds over the stars
  }
`;

const bakeVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const bakeFragmentShader = DENSITY_GLSL + /* glsl */ `
  varying vec2 vUv;
  uniform float uSliceY;        // local-frame Y (WU) of this slice
  uniform float uShadowStrength; // bake-time self-shadow absorption (0 = off)
  void main() {
    vec3 p = vec3(mix(uBoxMin.x, uBoxMax.x, vUv.x), uSliceY, mix(uBoxMin.z, uBoxMax.z, vUv.y));
    float chi;
    float d = densityAt(p, chi);
    // BAKE-TIME SELF-SHADOW (single light pass, zero per-frame cost): march toward +Y (above the disc) and
    // accumulate the optical depth of the gas column overhead → T = exp(-strength·τ). Pre-multiplying the
    // emission by T darkens gas buried under dense material — dark skirts under bright cores = volumetric
    // form. densityAt is already in scope here, so no second render target / readback is needed.
    float T = 1.0;
    if (uShadowStrength > 0.0) {
      // March a SHORT distance (~0.6 kpc of gas directly overhead), not the whole column — local occlusion
      // gives the clumps/arm crests dimensional form (lit top, shadowed underside) instead of dimming the
      // whole midplane uniformly (which a march-to-box-top does, since the disc is thin).
      float dyWU = 0.6 * uKpcWu / 6.0;
      float tau = 0.0; vec3 lp = p; float chi2;
      for (int i = 0; i < 6; i++) { lp.y += dyWU; tau += densityAt(lp, chi2); }
      T = exp(-uShadowStrength * tau * dyWU / uKpcWu);
    }
    // sqrt-encode density into the 8-bit alpha (decoded as a*a at march time). The gas peaks near ~0.1 and is
    // mostly ≪0.01, which a LINEAR 8-bit store crushes to 0–2/255 (~25× too faint); sqrt redistributes the
    // range toward the faint end (d=0.01 → 25/255 instead of 2/255).
    gl_FragColor = vec4(gasColor(p, d, chi) * T, sqrt(clamp(d, 0.0, 1.0)));
  }
`;

// Shape uniforms the bake reads (everything densityAt + the colour mix need). Copied from the cloud material.
const SHAPE_KEYS = [
  'uBoxMin', 'uBoxMax', 'uKpcWu', 'uRd', 'uRmax', 'uHgas', 'uArmCount', 'uPitchTan', 'uNoiseScale',
  'uArmNoise', 'uR0', 'uArmSharp', 'uLeadGas', 'uBarLo', 'uBarHi', 'uClumpFreq', 'uClumpGamma',
  'uErosionAmt', 'uRimFeather',
  'uSpurAmp', 'uSpurOpen', 'uSpurDensity', 'uSpurSharp', 'uSpurWarp', 'uSpurInterArm', 'uSpurFlank',
  'uSpurReach', 'uArmGlow', 'uHiiGlow', 'uShadowStrength',
  'uCoolWhite', 'uWarmWhite', 'uWhiteLo', 'uWhiteHi', 'uRwarm', 'uRcool',
] as const;

let _bakeScene: Scene | null = null;
let _bakeCam: OrthographicCamera | null = null;
let _bakeMat: ShaderMaterial | null = null;
function ensureBakeRig(): ShaderMaterial {
  if (_bakeMat) return _bakeMat;
  const uniforms: Record<string, { value: unknown }> = { uSliceY: { value: 0 } };
  for (const k of SHAPE_KEYS) uniforms[k] = { value: null };
  _bakeMat = new ShaderMaterial({
    vertexShader: bakeVertexShader, fragmentShader: bakeFragmentShader, uniforms,
    blending: NoBlending, depthTest: false, depthWrite: false,
  });
  _bakeScene = new Scene();
  _bakeScene.add(new Mesh(new PlaneGeometry(2, 2), _bakeMat));
  _bakeCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return _bakeMat;
}

const _prevVP = new Vector4();

/** Bake densityAt() into a 2D slice atlas (32 Y-layers, RGBA8). Renders each layer into a tile of one RT via
 *  viewport+scissor, then a single readback fills a DataTexture. Returns null if the bake can't run. */
function bakeCloudAtlas(renderer: WebGLRenderer, cloudMat: ShaderMaterial): DataTexture | null {
  const mat = ensureBakeRig();
  const cu = cloudMat.uniforms;
  for (const k of SHAPE_KEYS) mat.uniforms[k]!.value = cu[k]!.value; // share current shape values
  const boxMin = cu.uBoxMin!.value as Vector3;
  const boxMax = cu.uBoxMax!.value as Vector3;

  const rt = new WebGLRenderTarget(ATLAS_W, ATLAS_H, {
    format: RGBAFormat, type: UnsignedByteType, minFilter: LinearFilter, magFilter: LinearFilter,
    depthBuffer: false,
  });
  const prevTarget = renderer.getRenderTarget();
  const prevScissorTest = renderer.getScissorTest();
  renderer.getViewport(_prevVP);
  // three.js multiplies setViewport/setScissor args by the renderer pixel ratio. The render target is sized in
  // raw pixels (ATLAS_W×ATLAS_H), so divide by the ratio → each tile maps to exactly TILE×TILE *RT* pixels.
  // (Without this, at DPR 2 every slice rendered at 2× and 24 of 32 fell off the RT — the "mislocated" bug.)
  const ipr = 1 / renderer.getPixelRatio();
  renderer.setRenderTarget(rt);
  renderer.setScissorTest(true);
  for (let s = 0; s < SLICES; s++) {
    const col = s % A_COLS;
    const row = Math.floor(s / A_COLS);
    mat.uniforms.uSliceY!.value = boxMin.y + ((s + 0.5) / SLICES) * (boxMax.y - boxMin.y);
    renderer.setViewport(col * TILE * ipr, row * TILE * ipr, TILE * ipr, TILE * ipr);
    renderer.setScissor(col * TILE * ipr, row * TILE * ipr, TILE * ipr, TILE * ipr);
    renderer.render(_bakeScene!, _bakeCam!);
  }
  const buf = new Uint8Array(ATLAS_W * ATLAS_H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, ATLAS_W, ATLAS_H, buf);
  renderer.setScissorTest(prevScissorTest);
  renderer.setViewport(_prevVP);
  renderer.setRenderTarget(prevTarget);
  rt.dispose();

  const tex = new DataTexture(buf, ATLAS_W, ATLAS_H, RGBAFormat, UnsignedByteType);
  tex.minFilter = LinearFilter; tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping; tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export interface GalaxyCloud {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /** Re-point the arm uniforms at the current config + RE-BAKE the volume so the gas re-traces the arms. */
  sync(cfg: PhysicalGalaxyConfig, cloud: CloudConfig): void;
  /** Per-frame: refresh the world→local matrix (the galaxy rotates) + active step count. */
  update(camera: Camera, steps: number): void;
  /** Free the baked atlas texture. */
  dispose(): void;
}

/** Build the cloud volume box. Add it to the galaxy root (it rotates with the stars) at renderOrder 5.
 *  `renderer` (default: the registered bake renderer) bakes the static field to a slice atlas; without one
 *  the shader falls back to the live FBM march. */
export function buildGalaxyCloud(
  cfg: PhysicalGalaxyConfig, cloud: CloudConfig = DEFAULT_CLOUD_CONFIG,
  renderer: WebGLRenderer | null = getBakeRenderer(),
): GalaxyCloud {
  const halfXZ = cfg.rMax_kpc * KPC_TO_WU * 1.4; // room for the feathered rim to reach past rMax
  const halfY = (cloud.scaleHeight_pc / 1000) * KPC_TO_WU * 4.0; // ±4 scale heights covers the gas layer
  const geo = new BoxGeometry(halfXZ * 2, halfY * 2, halfXZ * 2);
  const material = new ShaderMaterial({
    vertexShader: cloudVertexShader,
    fragmentShader: cloudFragmentShader,
    uniforms: {
      uInvModel: { value: new Matrix4() },
      uBoxMin: { value: new Vector3(-halfXZ, -halfY, -halfXZ) },
      uBoxMax: { value: new Vector3(halfXZ, halfY, halfXZ) },
      uKpcWu: { value: KPC_TO_WU },
      uRd: { value: cfg.discScaleLength_kpc * GAS_RADIAL_FACTOR },
      uRmax: { value: cfg.rMax_kpc },
      uHgas: { value: cloud.scaleHeight_pc / 1000 },
      uArmCount: { value: cfg.armCount },
      uPitchTan: { value: Math.tan(cfg.armPitch_deg * DEG2RAD) },
      uNoiseScale: { value: cfg.armNoiseScale },
      uArmNoise: { value: cfg.armNoise },
      uR0: { value: MW.R0_kpc },
      uArmSharp: { value: cloud.armSharp },
      uLeadGas: { value: (cloud.leadDeg * DEG2RAD) / Math.max(1, cfg.armCount) },
      uBarLo: { value: cfg.barLength_kpc * 0.55 },
      uBarHi: { value: cfg.barLength_kpc * 1.1 },
      uClumpFreq: { value: cloud.clumpScale },
      uClumpGamma: { value: defToGamma(cloud.definition) },
      uErosionAmt: { value: defToErosion(cloud.definition) },
      uShadowStrength: { value: defToShadow(cloud.selfShadow) },
      uRimFeather: { value: cfg.rimFeather },
      uSpurAmp: { value: cfg.armSpurAmp },
      uSpurOpen: { value: cfg.armSpurOpen },
      uSpurDensity: { value: cfg.armSpurDensity },
      uSpurSharp: { value: cfg.armSpurSharp },
      uSpurWarp: { value: cfg.armSpurWarp },
      uSpurInterArm: { value: cfg.armSpurInterArm },
      uSpurFlank: { value: cfg.armSpurFlank },
      uSpurReach: { value: cfg.armSpurReach },
      uIntensity: { value: cloud.intensity },
      uArmGlow: { value: new Color(0.26, 0.42, 0.85) },
      uHiiGlow: { value: new Color(0.95, 0.5, 0.72) },
      uCoolWhite: { value: new Color(0.82, 0.88, 1.0) },
      uWarmWhite: { value: new Color(1.0, 0.95, 0.86) },
      uWhiteLo: { value: whiteLo(cloud.coreWhite) },
      uWhiteHi: { value: whiteHi(cloud.coreWhite) },
      uRwarm: { value: 3.0 },
      uRcool: { value: 9.0 },
      uSteps: { value: 30 },
      uVolume: { value: null },
      uUseVolume: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: BackSide, // render back faces so the volume is visible from inside or outside the box
    blending: AdditiveBlending,
  });
  const mesh = new Mesh(geo, material);
  mesh.name = 'galaxy-cloud';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5; // after stars (0), before dust (10) so dust occludes the gas glow

  const reBake = (): void => {
    if (!renderer) return; // no renderer ⇒ keep the live-march fallback (uUseVolume stays 0)
    const tex = bakeCloudAtlas(renderer, material);
    if (!tex) return;
    const old = material.uniforms.uVolume!.value as DataTexture | null;
    material.uniforms.uVolume!.value = tex;
    material.uniforms.uUseVolume!.value = 1;
    if (old) old.dispose();
  };
  reBake(); // bake the initial field

  const invModel = new Matrix4();
  const sync = (c: PhysicalGalaxyConfig, cl: CloudConfig): void => {
    const u = material.uniforms;
    u.uRd!.value = c.discScaleLength_kpc * GAS_RADIAL_FACTOR;
    u.uRmax!.value = c.rMax_kpc;
    u.uHgas!.value = cl.scaleHeight_pc / 1000;
    u.uArmCount!.value = c.armCount;
    u.uPitchTan!.value = Math.tan(c.armPitch_deg * DEG2RAD);
    u.uNoiseScale!.value = c.armNoiseScale;
    u.uArmNoise!.value = c.armNoise;
    u.uArmSharp!.value = cl.armSharp;
    u.uLeadGas!.value = (cl.leadDeg * DEG2RAD) / Math.max(1, c.armCount);
    u.uBarLo!.value = c.barLength_kpc * 0.55;
    u.uBarHi!.value = c.barLength_kpc * 1.1;
    u.uClumpFreq!.value = cl.clumpScale;
    u.uClumpGamma!.value = defToGamma(cl.definition);
    u.uErosionAmt!.value = defToErosion(cl.definition);
    u.uShadowStrength!.value = defToShadow(cl.selfShadow);
    u.uWhiteLo!.value = whiteLo(cl.coreWhite);
    u.uWhiteHi!.value = whiteHi(cl.coreWhite);
    u.uRimFeather!.value = c.rimFeather;
    u.uSpurAmp!.value = c.armSpurAmp;
    u.uSpurOpen!.value = c.armSpurOpen;
    u.uSpurDensity!.value = c.armSpurDensity;
    u.uSpurSharp!.value = c.armSpurSharp;
    u.uSpurWarp!.value = c.armSpurWarp;
    u.uSpurInterArm!.value = c.armSpurInterArm;
    u.uSpurFlank!.value = c.armSpurFlank;
    u.uSpurReach!.value = c.armSpurReach;
    u.uIntensity!.value = cl.intensity; // (intensity is a live gain — not baked)
    reBake(); // re-trace the gas onto the retuned arms
  };
  const update = (camera: Camera, steps: number): void => {
    mesh.updateMatrixWorld();
    invModel.copy(mesh.matrixWorld).invert();
    material.uniforms.uInvModel!.value.copy(invModel);
    material.uniforms.uSteps!.value = steps;
    camera.getWorldPosition(new Vector3()); // ensure cameraPosition uniform is fresh (three auto-binds)
  };
  const dispose = (): void => {
    const tex = material.uniforms.uVolume!.value as DataTexture | null;
    if (tex) tex.dispose();
  };

  return { mesh, material, sync, update, dispose };
}
