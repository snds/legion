// ═══════════════════════════════════════════════════════════════════
// BLACK-HOLE GEODESIC SHADER (GLSL, WebGL2)
//
// A real backward null-geodesic ray tracer — NOT a screen-space distortion.
// Rendered by a FullScreenQuad into the BlackHole's half-res target; each
// output texel reconstructs the world ray through the corresponding point on
// the camera-facing billboard and integrates it through Schwarzschild spacetime.
//
// Working frame: black-hole-centred, in units of the Schwarzschild radius
// r_s = 2M = 1, so M = 0.5, horizon at r = 1, photon sphere at 1.5, ISCO at 3,
// shadow impact parameter b_crit = 3√3·M ≈ 2.598. The CPU side (BlackHole)
// converts world-unit positions into these units before setting the uniforms.
//
// Per texel:
//   1. Build the world ray through the billboard point.
//   2. Intersect it with the bounding sphere (R_BOUND r_s). Miss → transparent
//      (flat spacetime; the real background shows through). Hit → enter at the
//      sphere and integrate the Binet equation d²u/dφ² = −u + 3M·u² with a
//      symplectic Velocity-Verlet + adaptive Δφ.
//   3. Capture (r ≤ 1) → opaque black (the shadow). Disk crossing in
//      [ISCO, outer] → opaque disk colour with Doppler+redshift g (colour ×g,
//      intensity ×g³). Escape (r > R_BOUND) → sample the star cubemap along the
//      bent direction; alpha = how far the ray was bent, so the effect feathers
//      seamlessly into the undistorted background.
//
// Mirrors schwarzschild.ts (unit-tested) line for line. Spec: oseiskar physics
// page + docs/black-hole-simulation-research.md.
// ═══════════════════════════════════════════════════════════════════

import {
  ShaderMaterial, Vector3, Color, GLSL3, DoubleSide,
  type Texture, type CubeTexture,
} from 'three';
import { RAMP_MIN_K, RAMP_MAX_K } from './blackbody';

/** Bounding sphere radius (r_s units) — integrate only inside; flat outside. */
export const R_BOUND = 25.0;

export const blackholeVertexShader = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const blackholeFragmentShader = /* glsl */ `
  precision highp float;

  in vec2 vUv;
  out vec4 fragColor;

  // Camera + billboard geometry, all black-hole-centred and in r_s units.
  uniform vec3  uCamPos;            // camera position relative to BH centre
  uniform vec3  uBillboardCenter;   // billboard centre relative to BH centre
  uniform vec3  uBillboardRight;    // right axis · half-width
  uniform vec3  uBillboardUp;       // up axis · half-height

  // Accretion disk (r_s units + Kelvin) and appearance.
  uniform vec3  uDiskNormal;        // unit normal of the disk plane (world)
  uniform float uDiskInner;         // ISCO, r_s units (= 3.0)
  uniform float uDiskOuter;         // outer disk radius, r_s units
  uniform float uDiskTempK;         // peak effective temperature (K)
  uniform float uDiskBrightness;    // overall disk emission scale
  uniform float uSpin;              // +1 prograde / -1 retrograde disk rotation

  // Textures + scaling.
  uniform samplerCube uBackground;  // star cubemap (flat-space background)
  uniform sampler2D   uDiskRamp;    // blackbody T→RGB ramp (1-D)
  uniform float uBgIntensity;       // background sampling gain
  uniform float uRampMinK;
  uniform float uRampMaxK;

  const float M        = 0.5;       // mass in r_s units (r_s = 2M = 1)
  const float R_BOUND  = ${R_BOUND.toFixed(1)};
  const int   MAX_STEPS = 256;
  const float BASE_STEP = 0.035;    // base Δφ; adaptively shrunk near the hole
  const float BEND_FADE = 0.010;    // radians of bending for full billboard alpha

  // Binet acceleration d²u/dφ² = −u + 3M·u².
  float accel(float u) { return -u + 3.0 * M * u * u; }

  // Combined Doppler + gravitational-redshift factor g = ν_obs/ν_emit for a
  // Keplerian disk element at radius r, photon heading toward the observer along
  // n̂ (cosA = disk-velocity · n̂). Mirrors schwarzschild.ts redshiftFactor().
  float redshift(float r, float cosA) {
    float denom = 1.0 - 2.0 * M / r;          // = 1 - 1/r
    if (denom <= 0.0) return 0.0;
    float grav = sqrt(denom);
    float beta = sqrt(M / r) / sqrt(denom);   // orbital speed (c/2 at ISCO)
    beta = min(beta, 0.999);
    float gamma = 1.0 / sqrt(1.0 - beta * beta);
    return (grav / gamma) / (1.0 - beta * cosA);
  }

  // Novikov–Thorne flux shape F(r) ∝ r⁻³(1 − √(r_in/r)); 0 inside r_in.
  float diskFlux(float r, float rIn) {
    if (r <= rIn) return 0.0;
    return (1.0 - sqrt(rIn / r)) / (r * r * r);
  }

  // Disk colour + emission at a plane crossing of radius r, position p.
  vec4 diskSample(float r, vec3 p) {
    if (r < uDiskInner || r > uDiskOuter) return vec4(0.0);

    // Orbital velocity direction (prograde/retrograde) and photon direction
    // toward the camera — their cosine drives beaming/Doppler.
    vec3 tangent = normalize(cross(uDiskNormal, p)) * uSpin;
    vec3 toObs   = normalize(uCamPos - p);
    float cosA   = dot(tangent, toObs);

    float g = redshift(r, cosA);

    // Temperature from the NT profile, normalised so uDiskTempK is the peak.
    float rPeak = (49.0 / 36.0) * uDiskInner;
    float shape = pow(max(diskFlux(r, uDiskInner), 0.0), 0.25);
    float shapePeak = pow(max(diskFlux(rPeak, uDiskInner), 1e-6), 0.25);
    float tempEmit = uDiskTempK * shape / shapePeak;
    float tempObs  = g * tempEmit;                 // Wien shift: bluer if g>1

    float rampU = clamp((tempObs - uRampMinK) / (uRampMaxK - uRampMinK), 0.0, 1.0);
    vec3 col = texture(uDiskRamp, vec2(rampU, 0.5)).rgb;

    // Intensity: flux profile × relativistic beaming g³ (the famous cube).
    float fluxPeak = diskFlux(rPeak, uDiskInner);
    float flux = diskFlux(r, uDiskInner) / max(fluxPeak, 1e-6);
    float g3 = g * g * g;
    float intensity = uDiskBrightness * flux * g3;

    // Soft edge falloff so the annulus doesn't hard-clip at inner/outer radii.
    float edge = smoothstep(uDiskInner, uDiskInner * 1.05, r)
               * (1.0 - smoothstep(uDiskOuter * 0.9, uDiskOuter, r));

    return vec4(col * intensity * edge, 1.0);
  }

  void main() {
    // 1. World ray through this billboard point (BH-centred, r_s units).
    vec3 P = uBillboardCenter
           + (2.0 * vUv.x - 1.0) * uBillboardRight
           + (2.0 * vUv.y - 1.0) * uBillboardUp;
    vec3 O = uCamPos;
    vec3 D = normalize(P - O);

    // 2. Intersect the straight ray with the bounding sphere (radius R_BOUND).
    float tca = -dot(O, D);
    float impact2 = dot(O, O) - tca * tca;         // squared impact parameter
    float R2  = R_BOUND * R_BOUND;
    bool camInside = dot(O, O) <= R2;
    if (!camInside && (tca < 0.0 || impact2 > R2)) {
      // Ray never enters the bounding sphere → flat space, no contribution.
      fragColor = vec4(0.0);
      return;
    }

    // Advance to the sphere entry point (flat space up to there).
    float tEntry = camInside ? 0.0 : (tca - sqrt(max(R2 - impact2, 0.0)));
    vec3 start = O + max(tEntry, 0.0) * D;
    float r0 = length(start);

    if (r0 <= 1.0) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; } // inside horizon

    // 3. Set up the 2-D orbit plane spanned by (start, D). e1 is radial toward
    //    the entry point; e2 is the in-plane perpendicular along the ray.
    vec3 e1 = start / r0;
    float dCos = dot(D, e1);
    vec3 perp = D - dCos * e1;
    float dSin = length(perp);
    if (dSin < 1e-5) {
      // Purely radial ray: straight in (→ hole) or straight out (→ background).
      if (dCos < 0.0) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); }
      else { fragColor = vec4(texture(uBackground, D).rgb * uBgIntensity, 1.0); }
      return;
    }
    vec3 e2 = perp / dSin;

    // Initial Binet state (see schwarzschild.ts for the derivation):
    //   u(0) = 1/r0,  du/dφ(0) = −dCos / (r0 · dSin).
    float u = 1.0 / r0;
    float dudphi = -dCos / (r0 * dSin);
    float phi = 0.0;

    vec3 prevPos = start;
    float prevH = dot(prevPos, uDiskNormal);

    for (int i = 0; i < MAX_STEPS; i++) {
      float h = BASE_STEP / (1.0 + 40.0 * u * u);  // adaptive: fine near the hole

      // Velocity-Verlet (symplectic) step on u(φ).
      float a0 = accel(u);
      float uNext = u + dudphi * h + 0.5 * a0 * h * h;
      float aN = accel(uNext);
      dudphi += 0.5 * (a0 + aN) * h;
      u = uNext;
      phi += h;

      if (u >= 1.0) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; } // captured → shadow

      float r = 1.0 / u;
      vec3 pos = r * (cos(phi) * e1 + sin(phi) * e2);

      // Disk-plane crossing between prevPos and pos.
      float hgt = dot(pos, uDiskNormal);
      if (prevH * hgt < 0.0) {
        float f = prevH / (prevH - hgt);
        vec3 crossPt = mix(prevPos, pos, f);
        float rc = length(crossPt);
        vec4 disk = diskSample(rc, crossPt);
        if (disk.a > 0.0) {
          // Optically-thick disk: the first (nearest) hit occludes everything
          // behind it. Lensed far-side arcs come from OTHER rays that miss here.
          fragColor = vec4(disk.rgb, 1.0);
          return;
        }
      }

      if (r > R_BOUND) {
        // Escaped the bounding sphere → flat space. Bent direction = tangent.
        vec3 escDir = normalize(pos - prevPos);
        vec3 bg = texture(uBackground, escDir).rgb * uBgIntensity;
        // Alpha = how far the ray was bent vs. the undistorted view, so the
        // billboard feathers into the real background at its lensing-free rim.
        float bend = acos(clamp(dot(escDir, D), -1.0, 1.0));
        float a = clamp(bend / BEND_FADE, 0.0, 1.0);
        fragColor = vec4(bg, a);
        return;
      }

      prevPos = pos;
      prevH = hgt;
    }

    // Exhausted steps deep in the potential without resolving → treat as capture.
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
`;

export interface BlackholeUniformOptions {
  background: CubeTexture;
  diskRamp: Texture;
  diskInner?: number;   // r_s units (default ISCO = 3)
  diskOuter?: number;   // r_s units
  diskTempK?: number;
  diskBrightness?: number;
  bgIntensity?: number;
  spin?: number;        // +1 prograde / -1 retrograde
}

/** Build the ShaderMaterial for the geodesic full-screen pass. */
export function createBlackholeMaterial(opts: BlackholeUniformOptions): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
    vertexShader: blackholeVertexShader,
    fragmentShader: blackholeFragmentShader,
    uniforms: {
      uCamPos: { value: new Vector3() },
      uBillboardCenter: { value: new Vector3() },
      uBillboardRight: { value: new Vector3() },
      uBillboardUp: { value: new Vector3() },
      uDiskNormal: { value: new Vector3(0, 1, 0) },
      uDiskInner: { value: opts.diskInner ?? 3.0 },
      uDiskOuter: { value: opts.diskOuter ?? 12.0 },
      uDiskTempK: { value: opts.diskTempK ?? 12000 },
      uDiskBrightness: { value: opts.diskBrightness ?? 2.0 },
      uSpin: { value: opts.spin ?? 1.0 },
      uBackground: { value: opts.background },
      uDiskRamp: { value: opts.diskRamp },
      uBgIntensity: { value: opts.bgIntensity ?? 1.0 },
      uRampMinK: { value: RAMP_MIN_K },
      uRampMaxK: { value: RAMP_MAX_K },
    },
    // Unused vertex colour hook; keeps three from complaining under GLSL3.
    defines: {},
  });
}

/** A neutral disk colour used by point-of-light LOD sprites. */
export const DISK_ACCENT = new Color(0xffd9a0);
