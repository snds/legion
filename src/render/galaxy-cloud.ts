// ═══════════════════════════════════════════════════════════════════
// GALAXY CLOUD — a low-res emission raymarch of the interstellar GAS/nebulosity that follows the SAME
// spiral structure as the physically-sampled stars (galaxy-physical.ts). It reuses the disc-volume
// raymarch METHOD (ray-AABB into a box, log-distributed jittered steps) but swaps the density for a GLSL
// port of this galaxy's armWave (log-spiral density wave + value-noise warp), so the glowing clouds trace
// the generated flocculent arms rather than a separate analytic model. Emission-only + additive: the gas
// adds a soft blue/HII glow ON the arms; the dust layer (renderOrder 10) then occludes it. Deliberately
// few steps — "volume + resolution can be lower" — and every arm parameter is a uniform synced from the
// PhysicalGalaxyConfig so the clouds re-trace the arms live as the panel knobs move.
// ═══════════════════════════════════════════════════════════════════

import {
  AdditiveBlending, BoxGeometry, Color, Matrix4, Mesh, ShaderMaterial, Vector3, BackSide,
  type Camera,
} from 'three';
import { WU_PER_PC } from '../core/metrics';
import { MW } from './mw-model';
import type { PhysicalGalaxyConfig } from './galaxy-physical';

const KPC_TO_WU = 1000 * WU_PER_PC;
const DEG2RAD = Math.PI / 180;

export interface CloudConfig {
  scaleHeight_pc: number; // gas layer thickness (thicker than dust, thinner than stars)
  leadDeg: number;        // gas sits just inside the arm crest (HII on the leading edge)
  armSharp: number;       // arm ridge tightness (cos^k)
  clumpScale: number;     // 3D clump frequency (per kpc) — the cloudy texture
  intensity: number;      // emission gain
}

export const DEFAULT_CLOUD_CONFIG: CloudConfig = {
  scaleHeight_pc: 180, leadDeg: 6, armSharp: 6.0, clumpScale: 1.4, intensity: 0.9,
};

// Gas disc is flatter/more extended than the stars, so the arm ridges — not a bright central ring —
// carry the structure. Radial scale length = stellar × this.
const GAS_RADIAL_FACTOR = 1.7;

const cloudVertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const cloudFragmentShader = /* glsl */ `
  precision highp float;
  varying vec3 vWorldPos;

  uniform mat4 uInvModel;     // world → galaxy local (rotating) frame
  uniform vec3 uBoxMin;       // local-space AABB
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
  uniform float uClumpFreq;   // per kpc
  uniform float uRimFeather;  // 0 = sharp rim … 1 = ragged, wispy feathered edge
  uniform float uIntensity;
  uniform vec3 uArmGlow;      // cool blue arm emission
  uniform vec3 uHiiGlow;      // warm pink HII knots
  uniform float uSteps;

  #ifndef CLOUD_STEPS
  #define CLOUD_STEPS 30
  #endif
  #define PI 3.14159265

  // ── value-noise FBM (float hash; matches the star warp's geometry, not its exact bits) ──
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

  // The galaxy's warped m-arm density wave: +1 on a ridge, −1 between (same form as galaxy-physical.ts).
  float armWave(float R, float phi) {
    float cot = 1.0 / uPitchTan;
    vec2 q = vec2(R * cos(phi), R * sin(phi)) * uNoiseScale;
    float warp = uArmNoise * PI * fbm2(q);
    float psi = uArmCount * (phi - cot * log(max(R, 0.05) / uR0)) + warp;
    return cos(psi);
  }

  float ign(vec2 px) {
    return fract(52.9829189 * fract(0.06711056 * px.x + 0.00583715 * px.y));
  }

  // Gas density at a LOCAL-frame point (WU). Exponential disc × thin gas layer × arm ridge × bar cutoff ×
  // 3D clumps — the same structure the stars are sampled from.
  float densityAt(vec3 p, out float clumpHi) {
    clumpHi = 0.0;
    float R = length(p.xz) / uKpcWu;
    float phi = atan(p.z, p.x);
    // Feathered, ragged rim (matches the star rim): the truncation radius wiggles with φ and falls off
    // softly, so the diffuse gas CONTINUES the feathering past the discrete-star streamers.
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
    // Clumps texture the arms but must not erase them: a mild 0.55..1.0 modulation, plus a small floor so
    // the smooth arm spine survives. The bright knots (clumpHi) drive the warm HII tint.
    float cl = 0.55 + 0.45 * fbm2(p.xz / uKpcWu * uClumpFreq + vec2(p.y / uKpcWu * 0.4, 0.0));
    clumpHi = smoothstep(0.85, 1.05, cl) * ridge;
    return radial * vert * barCut * ridge * cl * rimFall;
  }

  void main() {
    vec3 roW = cameraPosition;
    vec3 ro = (uInvModel * vec4(roW, 1.0)).xyz;             // camera in local frame
    vec3 sp = (uInvModel * vec4(vWorldPos, 1.0)).xyz;       // box surface in local frame
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
    vec3 accum = vec3(0.0);

    for (int i = 0; i < CLOUD_STEPS; i++) {
      if (float(i) >= uSteps) break;
      float a0 = (float(i) + jitter) / uSteps;
      float a1 = (float(i) + 1.0) / uSteps;
      float t = t0 * pow(tFar / t0, a0);
      float tn = t0 * pow(tFar / t0, a1);
      float dt = max(tn - t, 0.0) / uKpcWu; // step length in kpc → emission ∝ path length
      float chi;
      float d = densityAt(ro + rd * t, chi);
      vec3 col = mix(uArmGlow, uHiiGlow, chi); // blue arms, pink HII in the dense knots
      accum += d * col * dt;
    }

    vec3 rgb = accum * uIntensity;
    if (max(rgb.r, max(rgb.g, rgb.b)) < 0.0006) discard;
    gl_FragColor = vec4(rgb, 1.0); // AdditiveBlending: glow adds over the stars
  }
`;

export interface GalaxyCloud {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /** Re-point the arm uniforms at the current config so the gas re-traces the arms live. */
  sync(cfg: PhysicalGalaxyConfig, cloud: CloudConfig): void;
  /** Per-frame: refresh the world→local matrix (the galaxy rotates) + active step count. */
  update(camera: Camera, steps: number): void;
}

/** Build the cloud volume box. Add it to the galaxy root (it rotates with the stars) at renderOrder 5. */
export function buildGalaxyCloud(
  cfg: PhysicalGalaxyConfig, cloud: CloudConfig = DEFAULT_CLOUD_CONFIG,
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
      uRimFeather: { value: cfg.rimFeather },
      uIntensity: { value: cloud.intensity },
      uArmGlow: { value: new Color(0.26, 0.42, 0.85) },
      uHiiGlow: { value: new Color(0.95, 0.5, 0.72) },
      uSteps: { value: 30 },
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
    u.uRimFeather!.value = c.rimFeather;
    u.uIntensity!.value = cl.intensity;
  };
  const update = (camera: Camera, steps: number): void => {
    mesh.updateMatrixWorld();
    invModel.copy(mesh.matrixWorld).invert();
    material.uniforms.uInvModel!.value.copy(invModel);
    material.uniforms.uSteps!.value = steps;
    camera.getWorldPosition(new Vector3()); // ensure cameraPosition uniform is fresh (three auto-binds)
  };

  return { mesh, material, sync, update };
}
