// ═══════════════════════════════════════════════════════════════════
// GALACTIC DISC VOLUME v2 — emission–absorption raymarch over the SHARED
// analytic galaxy model (galaxy-density.glsl.ts ← galaxy-density.ts).
//
// v1 was an art-tuned 2D-pattern volume that read correctly only from
// outside at galaxy tier; from inside, every ray accumulated similar
// optical depth → uniform fog (the reverted-bake failure). v2 marches the
// CI-calibrated physical model (vitest: band-not-fog proven numerically),
// so one medium serves exterior views, flythrough, and the future
// system-tier bake (docs/galaxy-visual-redesign.md §4).
//
// Key properties:
//   • Camera-inside-capable ray setup (tNear clamp) — unchanged from v1.
//   • LOG-distributed, jittered steps (IGN) — resolves the near field
//     without starving the far field on long in-plane rays.
//   • PER-CHANNEL transmittance (CCM89 κ_RGB): dust lanes redden what is
//     behind them (tan/amber rifts), not just darken.
//   • Premultiplied output (emission, coverage): with CustomBlending
//     (One, OneMinusSrcAlpha) the band's glow ADDS over the black sky
//     while dust coverage OCCLUDES the additive star Points behind it —
//     the principled replacement for the deleted dust-strand particles
//     and core-glow sprites.
//   • Emission is calibrated by uEmissionScale ONLY — brightness ratios
//     inside the sky are the model's job, absolute level is exposure's
//     job (§4.5: no per-tier emissivity inflation, no opacity ramps).
// ═══════════════════════════════════════════════════════════════════

import { galaxyDensityGLSL } from './galaxy-density.glsl';

export const galacticDiscVolumeVertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const galacticDiscVolumeFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uBoxMin;        // volume AABB, world space (static — constraint)
  uniform vec3 uBoxMax;
  uniform vec3 uGalaxyOrigin;  // galaxy group's world position (Sgr A* in world)
  uniform float uEmissionScale;
  uniform float uOpacity;      // pinned 1.0; Phase-4 crossfade is the only ramp
  uniform float uJitter;       // 1 live (breaks step banding); 0 for the bake
                               // (256 steps need no jitter — and baking the
                               // per-pixel jitter into static cube texels is
                               // what produced the grain + cube-face seam)
  uniform float uModelScale;   // galaxy group render-scale (Phase 2c-1). The disc
                               // density model is calibrated in the native 333-WU/kpc
                               // frame; the group renders ×uModelScale larger (unified
                               // 1000 WU/pc). Bridge back: the sample point AND every
                               // world step length divide by uModelScale → model space.
                               // 1.0 = no-op (pre-rescale). Miss any one division and
                               // the disc compiles but goes opaque/blown-out.

  varying vec3 vWorldPos;

  ${galaxyDensityGLSL}

  // Interleaved gradient noise — cheap per-pixel jitter that breaks the
  // log-step banding without a noise texture.
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

    // Logarithmic step distribution from just past the camera to the box
    // exit: dense where a step subtends a large angle, coarse far away.
    float t0 = max(tNear, 2.0);
    float jitter = uJitter * ign(gl_FragCoord.xy);
    // STEPS is a material define: 32 live (40 per spec was ~28fps at galaxy
    // tier full-coverage; Phase 6 half-res is the real reserve), 256 for the
    // one-shot system-tier bake (galaxy-backdrop.ts) where there is no frame
    // budget and long in-plane rays need the resolution.
    #ifndef STEPS
    #define STEPS 32
    #endif

    vec3 accum = vec3(0.0);
    vec3 T = vec3(1.0);

    for (int i = 0; i < STEPS; i++) {
      float a0 = (float(i) + jitter) / float(STEPS);
      float a1 = (float(i) + 1.0) / float(STEPS);
      float t  = t0 * pow(tFar / t0, a0);
      float tn = t0 * pow(tFar / t0, a1);
      float dt = max(tn - t, 0.0);
      // Into the native-333 model frame: ONE shared model-space step length
      // (uModelScale=1 → identity). dtm drives BOTH emission and extinction so
      // the three-way coupling (sample point + both dt) can never silently drift.
      float dtm = dt / uModelScale;

      GalaxySample s = sampleGalaxy((ro + rd * t - uGalaxyOrigin) / uModelScale);

      accum += T * s.j * dtm;                  // emission decoupled from alpha
      T *= exp(-s.kappaV * GD_KAPPA_RGB * dtm);

      if (max(T.r, max(T.g, T.b)) < 0.005) break;
    }

    // Premultiplied: rgb = light added over the sky; alpha = how much the
    // dust occludes what is rendered behind (additive star Points).
    float coverage = 1.0 - (T.r + T.g + T.b) / 3.0;
    vec3 rgb = accum * uEmissionScale * uOpacity;
    if (coverage < 0.002 && max(rgb.r, max(rgb.g, rgb.b)) < 0.0005) discard;
    gl_FragColor = vec4(rgb, coverage * uOpacity);
  }
`;
