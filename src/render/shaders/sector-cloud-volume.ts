// ═══════════════════════════════════════════════════════════════════
// SECTOR CLOUD VOLUME — emission-only raymarch over the SHARED galaxy density
// model, scoped to one sector's AABB (sector-cloud prototype, Inc 3).
//
// Generalises galactic-disc-volume.ts to a sector box. The whole point is that it
// samples the SAME field (galaxy-density.glsl.ts sampleGalaxy) at the SAME native
// galactocentric coordinate the disc does — so the sector cloud and the far disc
// agree by construction (no seam), exactly as the embedded stars already do.
//
// FRAME (the one real difference from the disc): the disc samples
//   sampleGalaxy((worldPoint − uGalaxyOrigin) / uModelScale)
// using the galaxy group's world origin. The sector group rides the floating
// origin, so a fixed origin won't do. Instead we carry the sector's ABSOLUTE
// native centre + the per-frame residual and reconstruct the stable native point:
//   pNative = uSectorCenterNativeWU + (worldPoint − uWorldResidual) · uConvK
// Since worldPoint − uWorldResidual is the sector-LOCAL offset (R cancels), pNative
// is the absolute galactocentric position in native WU — stable across frames (no
// swim) and identical to what the disc resolves for the same physical point.
//
// Inc 3 is EMISSION-ONLY (no light-march — that's Inc 4; no AABB punch-out — Inc 5).
// High-frequency wisps come from worldFBM sampled at the ABSOLUTE native position
// (not the residual world position, which shifts each frame; not a per-sector
// reseed) → wisps flow continuously across sector faces.
// ═══════════════════════════════════════════════════════════════════

import { galaxyDensityGLSL } from './galaxy-density.glsl';

export const sectorCloudVertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const sectorCloudFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uBoxMin;                // sector AABB, world space (per-frame)
  uniform vec3 uBoxMax;
  uniform vec3 uSectorCenterNativeWU;  // sector centre in galaxy-local native WU (const)
  uniform vec3 uWorldResidual;         // sector group's per-frame floating-origin residual
  uniform float uConvK;                // world WU → native WU (= (KPC_TO_WU/1000)/WU_PER_PC)
  uniform float uEmissionScale;
  uniform float uOpacity;
  uniform float uJitter;
  uniform float uSteps;                // active raymarch steps (≤ STEPS define)
  uniform float uCloudScale;           // worldFBM scale, native WU (smaller = finer wisps)
  uniform float uCloudFloor;           // emission multiplier in the wisp gaps [0..1]

  // The cloud is the unresolved-star AGGREGATE: densest in the distance, it thins as you
  // move INTO it (the resolved star Points take over). A camera-distance fade does this.
  uniform float uFadeNearFloor;        // cloud strength right at the camera (≠ 0)
  uniform float uFadeFarWU;            // world WU at which the cloud reaches full strength
  uniform float uFeatherWU;            // soft-edge feather near the box faces (breach the bounds)

  // Cheap directional tint (HG forward-scatter toward the sector's brightest star). No
  // self-shadow light-march yet (subtle for now; dramatic lighting waits for a dense sector).
  uniform vec3 uLightNativePos;        // dominant star, galaxy-local native WU
  uniform vec3 uLightColor;            // its spectral colour
  uniform float uScatter;              // tint strength
  uniform float uHGg;                  // Henyey-Greenstein asymmetry (forward ≈ 0.6)

  varying vec3 vWorldPos;

  ${galaxyDensityGLSL}

  float ign(vec2 px) {
    return fract(52.9829189 * fract(0.06711056 * px.x + 0.00583715 * px.y));
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorldPos - cameraPosition);

    // Ray-AABB slab intersection (camera-inside-capable)
    vec3 invD = 1.0 / rd;
    vec3 t1 = (uBoxMin - ro) * invD;
    vec3 t2 = (uBoxMax - ro) * invD;
    vec3 tMin = min(t1, t2);
    vec3 tMax = max(t1, t2);
    float tNear = max(max(tMin.x, tMin.y), tMin.z);
    float tFar  = min(min(tMax.x, tMax.y), tMax.z);
    if (tNear > tFar || tFar < 0.0) discard;

    float t0 = max(tNear, 2.0);
    float jitter = uJitter * ign(gl_FragCoord.xy);
    #ifndef STEPS
    #define STEPS 24
    #endif

    vec3 accum = vec3(0.0);
    vec3 T = vec3(1.0);

    for (int i = 0; i < STEPS; i++) {
      if (float(i) >= uSteps) break;
      float a0 = (float(i) + jitter) / uSteps;
      float a1 = (float(i) + 1.0) / uSteps;
      float t  = t0 * pow(tFar / t0, a0);
      float tn = t0 * pow(tFar / t0, a1);
      float dt = max(tn - t, 0.0);
      float dtm = dt * uConvK;          // world step → native step (same scalar as the point)

      // Camera-distance fade + box-edge feather — computed BEFORE the expensive density
      // sample so negligible samples (near the camera, near the faces) are SKIPPED. This
      // is the perf win the fade buys: when immersed, the near screen-filling part of the
      // ray costs nothing; only the fuller far part is marched.
      vec3 pw = ro + rd * t;
      float camFade = uFadeNearFloor + (1.0 - uFadeNearFloor) * smoothstep(0.0, uFadeFarWU, t);
      vec3 dmin = pw - uBoxMin, dmax = uBoxMax - pw;
      float edge = min(min(min(dmin.x, dmin.y), dmin.z), min(min(dmax.x, dmax.y), dmax.z));
      float edgeFade = smoothstep(0.0, uFeatherWU, edge);
      float fade = camFade * edgeFade;
      if (fade < 0.02) continue;        // contributes ~nothing → skip the sample

      // Absolute galactocentric position in native WU — R cancels, so it matches the
      // disc and never swims with the floating origin.
      vec3 pNative = uSectorCenterNativeWU + (ro + rd * t - uWorldResidual) * uConvK;
      GalaxySample s = sampleGalaxy(pNative);

      // High-freq wisps: worldFBM at the ABSOLUTE native position (continuous across
      // sectors). Squared → carve cleaner gaps; floor keeps gaps from going black.
      float detail = gdFbm3(pNative / uCloudScale);
      float shape = mix(uCloudFloor, 1.0, detail * detail);
      float w = shape * fade;           // effective cloud density weight
      float density = s.kappaV * w;

      // Cheap directional tint: HG forward-scatter toward the dominant star (no light-march).
      vec3 Ldir = normalize(uLightNativePos - pNative);
      float gg = uHGg * uHGg;
      float phase = 0.0795775 * (1.0 - gg) / pow(max(1.0 + gg - 2.0 * uHGg * dot(rd, Ldir), 1e-4), 1.5);
      vec3 scatter = uLightColor * (uScatter * phase) * density;

      // Emission (aggregate glow) + directional tint. Extinction uses the SAME weighted
      // density (spec: density = structure × worldFBM) → gaps transparent, cloud not fog.
      accum += T * (s.j * w * uEmissionScale + scatter) * dtm;
      T *= exp(-density * GD_KAPPA_RGB * dtm);

      if (max(T.r, max(T.g, T.b)) < 0.005) break;
    }

    float coverage = 1.0 - (T.r + T.g + T.b) / 3.0;
    vec3 rgb = accum * uOpacity; // uEmissionScale folded into the per-step emission
    if (coverage < 0.002 && max(rgb.r, max(rgb.g, rgb.b)) < 0.0005) discard;
    gl_FragColor = vec4(rgb, coverage * uOpacity);
  }
`;
