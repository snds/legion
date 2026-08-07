/** Continuum surface — climate albedo + cheap fragment micro-detail + LOD fade. */

export const continuumSurfaceVert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 aColor;
  attribute float aSea;
  attribute float aLevel;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vSea;
  varying float vLevel;
  varying vec3 vWorldPos;
  varying vec3 vObj;
  varying vec2 vUv;
  varying vec3 vNrad;

  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vColor = aColor;
    vSea = aSea;
    vLevel = aLevel;
    vObj = normalize(position);
    vNrad = normalize(mat3(modelMatrix) * vObj);
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

/** Shared cheap cloud field for ground shadows (A3). */
const continuumCloudFieldGlsl = /* glsl */ `
  float cHash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }
  float cNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(cHash(i), cHash(i + vec3(1,0,0)), f.x),
          mix(cHash(i + vec3(0,1,0)), cHash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(cHash(i + vec3(0,0,1)), cHash(i + vec3(1,0,1)), f.x),
          mix(cHash(i + vec3(0,1,1)), cHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float cFbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * cNoise(p); p = p * 2.07 + 11.3; a *= 0.5; }
    return s;
  }
  float continuumCloudDens(vec3 d0) {
    if (uCloudCover <= 0.001) return 0.0;
    vec3 d = normalize(d0);
    float lat = d.y;
    // Zonal shear is a spherical-domain rotation of d (Y-axis), never a cube/UV
    // projection — continuous everywhere including the poles. The per-latitude
    // offset must stay time-bounded (sin gate): a constant offset here freezes a
    // permanent differential-shear fold into the deck that reads as a mirrored
    // V/chevron through the facing hemisphere (Task F1). Matches the bounded
    // oscillation already used by Legacy (glsl.ts GLSL_CLOUDS, weather-provider.ts).
    float zonal = 0.6 * cos(lat * 4.712) + 0.15 * cos(lat * 12.566);
    float flow = max(uCloudFlow, 0.05);
    float adv = uCloudTime * 0.02 * flow + zonal * 0.35 * flow * sin(uCloudTime * 0.0044);
    float ca = cos(adv), sa = sin(adv);
    vec3 p = vec3(ca * d.x + sa * d.z, d.y, -sa * d.x + ca * d.z);
    float det = max(uCloudDetail, 0.35);
    float f = cFbm(p * (5.5 * det));
    f += 0.28 * cFbm(p * (18.0 * det) + vec3(uCloudTime * 0.03 * flow, 0.0, 0.0));
    float region = cFbm(p * 1.8 + 9.0);
    f += (region - 0.5) * 0.25;
    // F4: this field has no turb/region-driven amplitude (cheap ground-shadow
    // approximation), so its raw f sits lower on average than the cloud shell's
    // (Monte Carlo: mean ~0.62 vs ~0.79). At the shell's 0.14 window offset the
    // shadow term was nearly always zero once F4 lowered uCloudCover for the
    // shell's own overcast fix, so a 0.25 offset restores visible ground-shadow
    // contrast at the new lower cover without touching the shear/advection
    // above (F1 gate) or the shell's own curve.
    float c0 = 1.0 - uCloudCover * 0.85;
    float t = clamp((f - (c0 - 0.25)) / 0.28, 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }
`;

export const continuumSurfaceFrag = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uSunDir;
  uniform vec3 uSunDirObj;
  uniform float uDebugChunks;
  uniform float uFade;
  uniform sampler2D uAlbedoMap;
  uniform float uUseAlbedoMap;
  uniform float uRoughness;
  uniform float uNightLights;
  uniform float uCloudCover;
  uniform float uCloudShadow;
  uniform float uCloudTime;
  uniform float uCloudFlow;
  uniform float uCloudDetail;
  uniform vec3 uAtmosColor;
  uniform float uAtmosDensity;
  uniform float uPlanetRadius;
  uniform float uVoxelBlend;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vSea;
  varying float vLevel;
  varying vec3 vWorldPos;
  varying vec3 vObj;
  varying vec2 vUv;
  varying vec3 vNrad;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.11 + 17.0; a *= 0.5; }
    return s;
  }
` + continuumCloudFieldGlsl + /* glsl */ `
  void main() {
    float fade = clamp(uFade, 0.0, 1.0);
    if (fade < 0.999) {
      float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      if (d > fade) discard;
    }
    #include <logdepthbuf_fragment>

    vec3 Nmesh = normalize(vNormal);
    // Radial world normal — water specular must not follow chunk grid facets.
    vec3 Nrad = normalize(vNrad);
    vec3 L = normalize(uSunDir);

    vec3 albedo = vColor;
    float sea = vSea;
    if (uUseAlbedoMap > 0.5) {
      vec4 tex = texture2D(uAlbedoMap, vUv);
      albedo = tex.rgb;
      sea = tex.a;
    }

    // C5 — coast AA: LinearFilter already softens alpha; use fwidth to blend
    // ocean/land lighting across the silhouette instead of a hard lighting switch.
    float seaW = sea;
    float seaFw = fwidth(sea);
    if (seaFw > 1e-5) {
      seaW = smoothstep(0.5 - seaFw, 0.5 + seaFw, sea);
    }

    // Blend toward radial on water so sun glint is a smooth limb arc.
    vec3 N = normalize(mix(Nmesh, Nrad, seaW));
    float ndl = max(dot(N, L), 0.0);
    // C1 — sun-dominant wrap. Soft terminator; night gets atmos fill below (not chalk).
    float wrap = ndl * 0.94 + 0.028;
    float term = smoothstep(-0.06, 0.14, dot(N, L));
    wrap *= mix(0.12, 1.0, term);

    float micro = fbm(vObj * 64.0);
    float meso = fbm(vObj * 18.0 + 3.1);
    float snowish = smoothstep(0.72, 0.90, max(albedo.r, max(albedo.g, albedo.b)));
    // Orbit mottling fix: high-freq fbm on albedo looked like salt-and-pepper on
    // continents even when the bake was fine. Only apply micro/meso near-camera.
    float viewDist = length(cameraPosition - vWorldPos);
    float Rgate = max(uPlanetRadius, 1e-3);
    float detailAmt = 1.0 - smoothstep(Rgate * 0.22, Rgate * 1.05, viewDist);
    detailAmt *= detailAmt;
    if (seaW > 0.5) {
      float oceanVar = mix(1.0, mix(0.97 + 0.03 * meso, 1.0, snowish), detailAmt);
      albedo *= oceanVar;
      albedo = mix(albedo, albedo * vec3(0.9, 0.95, 1.05), 0.06 * micro * (1.0 - snowish) * detailAmt);
    } else {
      float landVar = mix(1.0, mix(0.94 + 0.05 * micro, 0.98 + 0.02 * meso, snowish), detailAmt);
      albedo *= landVar;
      albedo = mix(albedo, albedo * vec3(1.02, 1.01, 0.97), 0.05 * (meso - 0.45) * (1.0 - snowish) * detailAmt);
    }

    if (uDebugChunks > 0.5) {
      float band = fract(vLevel * 0.13);
      albedo = mix(albedo, albedo * vec3(1.05, 1.0, 0.92), 0.08 + 0.06 * band);
    }

    // Cloud self-shadow: sun-ray ∩ shell @ 1.03R (Legacy / SE shell shadow).
    float cshadow = 1.0;
    if (uCloudCover > 0.001 && uCloudShadow > 0.001) {
      vec3 S = normalize(uSunDirObj);
      vec3 dir = normalize(vObj);
      float b = dot(dir, S);
      float sHit = -b + sqrt(max(b * b + 0.0609, 0.0));
      vec3 cdir = normalize(dir + sHit * S);
      cshadow = 1.0 - uCloudShadow * continuumCloudDens(cdir);
    }

    vec3 lit = albedo * wrap * cshadow;

    // Blend ocean vs land lighting with AA weight (C5).
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 oceanLit = lit;
    vec3 landLit = lit;
    {
      vec3 H = normalize(L + V);
      float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
      // Softer gloss on water — hard Blinn peaks amplified mesh residual seams.
      float gloss = mix(96.0, 28.0, clamp(uRoughness, 0.0, 1.0));
      float spec = pow(max(dot(N, H), 0.0), gloss) * (1.0 - uRoughness * 0.65);
      oceanLit = mix(lit, lit * vec3(0.82, 0.90, 1.05), 0.22);
      // C2 — specular peaks above 1.0 so Karis bloom + AgX catch glints.
      oceanLit += vec3(0.75, 0.88, 1.05) * spec * (0.45 + 0.85 * fres) * ndl * cshadow * 1.55;
    }
    {
      float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
      landLit += albedo * rim * 0.04 * term;
      float night = smoothstep(0.08, -0.04, ndl);
      if (night > 0.01 && uNightLights > 0.01) {
        float metro = smoothstep(0.58, 0.78, fbm(vObj * 11.0));
        float towns = smoothstep(0.70, 0.88, fbm(vObj * 42.0 + 5.3));
        float lights = metro * 0.75 + towns * 0.4;
        lights *= (1.0 - snowish);
        // Night city HDR tick for bloom (still gated to night side only).
        landLit += vec3(1.0, 0.78, 0.48) * night * lights * uNightLights * 0.85;
      }
    }
    lit = mix(landLit, oceanLit, seaW);

    // Night-side atmospheric scatter / bounce — dark side readable without chalk wash.
    // Skylight (Rayleigh-tint) + faint anti-sun bounce through the air column.
    if (uAtmosDensity > 0.01) {
      float nightAmt = 1.0 - term;
      float limb = pow(1.0 - max(dot(N, V), 0.0), 1.45);
      float dens = clamp(uAtmosDensity, 0.0, 1.6);
      // Regression lock target: continuum-0.8-night (Task 6 pose).
      vec3 skyFill = uAtmosColor * (0.035 + 0.055 * limb) * dens;
      float antiSun = max(0.0, -dot(N, L));
      vec3 bounce = albedo * vec3(0.28, 0.38, 0.55) * antiSun * (0.04 + 0.03 * dens);
      // Soft penumbra lift so the terminator isn't a hard cut to black.
      float penumbra = (1.0 - smoothstep(-0.12, 0.2, dot(N, L))) * 0.025 * dens;
      lit += (skyFill * (0.45 + 0.55 * albedo) + bounce + albedo * penumbra) * nightAmt;
    }

    // C3 — aerial perspective: horizon softening when close. Never wash the
    // whole disk from orbit — viewDist/R is large on every face-on pixel there.
    if (uAtmosDensity > 0.01) {
      float R = max(uPlanetRadius, 1e-3);
      float graze = pow(1.0 - max(dot(N, V), 0.0), 1.8);
      // Gate out once the camera is more than a few radii away (space view).
      float nearAir = 1.0 - smoothstep(R * 0.55, R * 2.4, viewDist);
      float optical = uAtmosDensity * 0.55 * graze * nearAir;
      float haze = clamp(1.0 - exp(-optical), 0.0, 0.45);
      vec3 air = uAtmosColor * (0.22 + 0.78 * wrap);
      lit = mix(lit, air, haze);
    }

    // B4 — soft mute near camera when surface voxels own the close layer.
    if (uVoxelBlend > 0.01) {
      float camNear = length(cameraPosition - vWorldPos) / max(uPlanetRadius, 1e-3);
      float handoff = uVoxelBlend * (1.0 - smoothstep(0.025, 0.14, camNear));
      lit *= 1.0 - handoff * 0.35;
    }

    gl_FragColor = vec4(lit, 1.0);
  }
`;

/** Atmosphere limb — Rayleigh-tinted rim + warm sun-horizon (A2). */
export const continuumAtmosVert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vObj;
  varying vec3 vWorldPos;
  void main() {
    vObj = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;

export const continuumAtmosFrag = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uSunDir;
  uniform vec3 uColor;
  uniform float uDensity;
  varying vec3 vObj;
  varying vec3 vWorldPos;
  void main() {
    if (uDensity <= 0.001) discard;
    #include <logdepthbuf_fragment>
    vec3 V = normalize(cameraPosition - vWorldPos);
    // Outward radial. Mesh is BackSide (inner near-shell): face-on has
    // outward·V < 0, so use abs — otherwise fresnel maxes across the disk
    // and the shell paints the whole planet blue.
    vec3 N = normalize(vObj);
    vec3 L = normalize(uSunDir);
    float ndv = abs(dot(N, V));
    float fres = pow(1.0 - ndv, 2.6);
    float soft = pow(1.0 - ndv, 1.35);
    float ndl = dot(N, L);
    float sunFacing = clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
    // F2 — sun-horizon glow keys off the SURFACE POINT vs the day/night
    // terminator (ndl ~ 0), not the view direction. At orbit/space distances the
    // camera-to-fragment direction V barely changes across the whole visible
    // disc, so a view-direction-only term (old: pow(dot(V,L),8)) went bright
    // almost everywhere the sun was roughly behind the camera — saturating
    // the *entire* rim instead of a graze at the terminator. Combined with
    // the un-tonemapped HDR boost below, every channel clipped flat to white,
    // which is the reported hard white/cream limb. Gating on ndl instead
    // localizes the warm glow to where the terminator great circle actually
    // crosses the visible silhouette (SE eclipse diamond-ring language).
    float terminator = 1.0 - smoothstep(0.0, 0.22, abs(ndl));
    float sunHorizon = terminator * soft;
    vec3 rayleigh = mix(uColor, vec3(0.35, 0.55, 0.95), 0.35);
    vec3 mie = vec3(1.0, 0.72, 0.42);
    vec3 col = mix(rayleigh, mie, clamp(sunHorizon * 1.4, 0.0, 0.85));
    col *= 0.55 + 0.55 * sunFacing;
    // C2 — sun-horizon HDR so additive limb blooms through AgX/Karis.
    col *= 1.0 + sunHorizon * 2.2;
    // Limb-only opacity (match Legacy rim*day). Density scales brightness, not disk fill.
    float a = (fres * 0.85 + soft * 0.12) * uDensity * (0.35 + 0.65 * sunFacing);
    a += sunHorizon * uDensity * 0.28;
    // C5 — soft limb edge (avoid hard polygonal discard pop).
    float aAA = a;
    float aFw = fwidth(a);
    if (aFw > 1e-5) aAA = smoothstep(0.0, max(aFw * 1.5, 0.02), a);
    if (aAA < 0.008) discard;
    gl_FragColor = vec4(col, clamp(aAA, 0.0, 0.95));
  }
`;

export const continuumCloudShellVert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vObj;
  varying vec3 vWorldPos;
  void main() {
    vObj = normalize(position);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
    #include <logdepthbuf_vertex>
  }
`;

export const continuumCloudShellFrag = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uSunDir;
  uniform float uCover;
  uniform float uTime;
  uniform float uDetail;
  uniform float uFlow;
  uniform float uTurb;
  uniform float uWisp;
  uniform float uRegion;
  uniform float uLightning;
  uniform vec3 uStorm0;
  uniform vec3 uStorm1;
  uniform vec3 uStorm2;
  uniform float uStormS0;
  uniform float uStormS1;
  uniform float uStormS2;
  uniform float uStormSize;
  varying vec3 vObj;
  varying vec3 vWorldPos;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n = mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
    return n;
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 8; i++) { s += a * noise(p); p = p * 2.07 + 11.3; a *= 0.5; }
    return s;
  }
  float storm(vec3 d, vec3 c, float str, float sz) {
    if (abs(str) < 0.01) return 0.0;
    float ang = acos(clamp(dot(d, normalize(c)), -1.0, 1.0)) / max(sz, 0.01);
    float core = exp(-ang * ang);
    float tang = atan(d.z - c.z, d.x - c.x) + ang * 6.0 * sign(str);
    float arms = 0.55 + 0.45 * cos(tang * 2.0);
    float fringe = mix(1.0, 0.55 + 0.45 * noise(d * 18.0), clamp(uWisp, 0.0, 1.0));
    return core * arms * abs(str) * fringe;
  }

  void main() {
    if (uCover <= 0.001) discard;
    vec3 d = normalize(vObj);
    float lat = d.y;
    // See continuumCloudDens above — the sin() gate bounds the per-latitude
    // shear so it cannot freeze into a static V/chevron through disc center.
    float zonal = 0.6 * cos(lat * 4.712) + 0.15 * cos(lat * 12.566);
    float flow = max(uFlow, 0.05);
    float adv = uTime * 0.02 * flow + zonal * 0.35 * flow * sin(uTime * 0.0044);
    float ca = cos(adv), sa = sin(adv);
    vec3 p = vec3(ca * d.x + sa * d.z, d.y, -sa * d.x + ca * d.z);
    float det = max(uDetail, 0.35);
    float turb = clamp(uTurb, 0.0, 1.5);
    float f = fbm(p * (5.5 * det));
    f += (0.22 + 0.18 * turb) * fbm(p * (22.0 * det) + vec3(uTime * 0.03 * flow, 0.0, 0.0));
    f += (0.08 + 0.12 * turb) * fbm(p * (48.0 * det) + vec3(0.0, uTime * 0.02 * flow, 0.0));
    f += 0.4 * storm(d, uStorm0, uStormS0, uStormSize);
    f += 0.4 * storm(d, uStorm1, uStormS1, uStormSize);
    f += 0.4 * storm(d, uStorm2, uStormS2, uStormSize);
    // Clear vs overcast patches (cloudRegion).
    float region = fbm(p * (1.4 + 1.6 * clamp(uRegion, 0.0, 1.0)) + 9.0);
    f += (region - 0.5) * (0.15 + 0.35 * clamp(uRegion, 0.0, 1.0));
    float c0 = 1.0 - uCover * 0.85;
    float t = clamp((f - (c0 - 0.14)) / 0.28, 0.0, 1.0);
    float dens = t * t * (3.0 - 2.0 * t);
    dens *= mix(0.55, 1.0, smoothstep(0.08, 0.55, dens));
    dens *= mix(1.0, 0.72 + 0.28 * dens, clamp(uWisp, 0.0, 1.0));
    if (dens < 0.03) discard;
    #include <logdepthbuf_fragment>
    vec3 N = normalize(vObj);
    vec3 L = normalize(uSunDir);
    float ndl = dot(N, L);
    // Legacy parity: day-gated Lambert — half-Lambert (*0.5+0.5) made night clouds glow.
    float day = smoothstep(-0.08, 0.16, ndl);
    float litAmt = 0.06 + 0.94 * day * max(ndl, 0.0);
    // Thin twilight skirt on the night edge (airglow), not a full-disk wash.
    float twilight = exp(-pow(ndl / 0.28, 2.0)) * (1.0 - day);
    vec3 dayCol = vec3(0.94, 0.96, 0.99);
    vec3 nightCol = vec3(0.05, 0.07, 0.12);
    vec3 col = mix(nightCol, dayCol, clamp(litAmt, 0.0, 1.2));
    col += dayCol * twilight * 0.10;
    // F5 — cheap self-shadow / thickness cue (day-gated, no raymarch): approximate
    // optical path length through the deck as 1/ndl (Beer-Lambert-style), so a
    // thick, dense core reads self-shadowed as the sun raked low toward the
    // anti-sun flank instead of flat-lit cardboard. Purely arithmetic on values
    // already computed above (dens, ndl, day) — no extra noise samples. Gated by
    // day so night clouds (day == 0) are untouched and stay silhouette-thin.
    float pathLen = 1.0 / max(ndl, 0.18);
    float thickness = clamp(dens * pathLen * 0.55, 0.0, 1.0);
    col *= 1.0 - 0.4 * thickness * day;
    // Lightning: storm eyewalls only. Never seed the strobe with dens —
    // density drifts every frame from uTime fbm, so dens-hash flashes every
    // cloud core (P-LOOK flash across the deck; orbit-0.8au / look-orient).
    float flash = 0.0;
    if (uLightning > 0.01 && dens > 0.22) {
      float stormW = max(
        max(storm(d, uStorm0, uStormS0, uStormSize),
            storm(d, uStorm1, uStormS1, uStormSize)),
        storm(d, uStorm2, uStormS2, uStormSize));
      float w = clamp(stormW * 2.5, 0.0, 1.0);
      if (w > 0.05) {
        vec3 cell = floor(d * 28.0);
        float g = hash(cell + 5.1);
        if (g < 0.35) {
          float ph = hash(cell + 2.7);
          float strobe = fract(uTime * (2.5 + 3.0 * ph) + ph);
          flash = exp(-strobe * 24.0) * w * dens * uLightning;
        }
      }
    }
    col += vec3(0.95, 0.97, 1.0) * clamp(flash, 0.0, 1.6);
    // Night clouds thinner in alpha so they read as silhouette, not emissive fog.
    // Regression lock target: continuum-0.6-clouds (Task 6 pose).
    float a = dens * mix(0.32, 0.72, day);
    gl_FragColor = vec4(col, a);
  }
`;

export const continuumCloudBrickVert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vLocal;
  varying vec3 vWorldPos;
  void main() {
    vLocal = position;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
    #include <logdepthbuf_vertex>
  }
`;

export const continuumCloudBrickFrag = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uSunDir;
  uniform float uTime;
  uniform float uCover;
  uniform float uBrickHalf;
  uniform vec3 uBrickCenterObj;
  uniform float uPlanetRadius;
  varying vec3 vLocal;
  varying vec3 vWorldPos;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }
  float noise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
          mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
          mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.1; a *= 0.5; }
    return s;
  }

  void main() {
    if (uCover <= 0.001) discard;
    float alt = length(vWorldPos) / max(uPlanetRadius, 1e-3);
    float band = smoothstep(1.01, 1.025, alt) * (1.0 - smoothstep(1.04, 1.07, alt));
    vec3 worldDir = normalize(vWorldPos);
    float n = fbm(worldDir * 28.0 + vec3(uTime * 0.05, 0.0, uTime * 0.03));
    float dens = band * uCover * smoothstep(0.28, 0.72, n);
    dens *= (1.0 - length(vLocal) / max(uBrickHalf * 1.732, 1e-3));
    if (dens < 0.03) discard;
    #include <logdepthbuf_fragment>
    vec3 N = normalize(vWorldPos);
    vec3 L = normalize(uSunDir);
    float ndl = dot(N, L);
    float day = smoothstep(-0.08, 0.16, ndl);
    float litAmt = 0.06 + 0.94 * day * max(ndl, 0.0);
    vec3 col = mix(vec3(0.05, 0.07, 0.12), vec3(0.92, 0.95, 0.99), clamp(litAmt, 0.0, 1.2));
    gl_FragColor = vec4(col, dens * mix(0.28, 0.6, day));
  }
`;

/** Camera-local surface voxel brick — raymarches generator-baked height + albedo (B3). */
export const continuumSurfaceBrickVert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vLocal;
  varying vec3 vWorldPos;
  varying vec3 vObjCenter;
  void main() {
    vLocal = position;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vObjCenter = normalize((modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
    #include <logdepthbuf_vertex>
  }
`;

export const continuumSurfaceBrickFrag = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uSunDir;
  uniform float uBlend;
  uniform float uDisplacement;
  uniform float uPlanetRadius;
  uniform float uSeaLevel;
  uniform sampler2D uHeightMap;
  uniform sampler2D uAlbedoMap;
  uniform vec3 uBrickCenterObj;
  uniform float uBrickHalf;
  varying vec3 vLocal;
  varying vec3 vWorldPos;
  varying vec3 vObjCenter;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }
  float noise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
          mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
          mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
  }

  vec2 brickUv(vec3 dir) {
    vec3 c = normalize(uBrickCenterObj);
    vec3 n = normalize(dir);
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), c));
    if (length(east) < 1e-4) east = vec3(1.0, 0.0, 0.0);
    vec3 north = normalize(cross(c, east));
    float halfAng = max(uBrickHalf / max(uPlanetRadius, 1e-3), 1e-4);
    float ang = acos(clamp(dot(n, c), -1.0, 1.0));
    if (ang > halfAng * 1.25) return vec2(-1.0);
    vec3 tang = n - c * dot(n, c);
    float u = 0.5 + 0.5 * (dot(tang, east) / halfAng);
    float v = 0.5 + 0.5 * (dot(tang, north) / halfAng);
    if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) return vec2(-1.0);
    return clamp(vec2(u, v), 0.0, 1.0);
  }

  void main() {
    if (uBlend < 0.01) discard;
    #include <logdepthbuf_fragment>

    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorldPos - cameraPosition);
    float R = max(uPlanetRadius, 1e-3);
    float disp = clamp(uDisplacement, 0.0, 0.12);

    // Short ray march through brick volume (HZD-style temporal budget: few steps).
    float t0 = length(vWorldPos - ro) - uBrickHalf * 1.6;
    float tMax = t0 + uBrickHalf * 3.2;
    t0 = max(t0, 0.0);
    vec3 hitCol = vec3(0.0);
    float hitA = 0.0;
    float hitT = -1.0;
    const int STEPS = 18;
    for (int i = 0; i < STEPS; i++) {
      float t = mix(t0, tMax, (float(i) + 0.5) / float(STEPS));
      vec3 p = ro + rd * t;
      float r = length(p);
      vec3 dir = p / max(r, 1e-6);
      vec2 uv = brickUv(dir);
      if (uv.x < 0.0) continue;
      float h = texture2D(uHeightMap, uv).r;
      float surfR = R * (1.0 + h * disp);
      float band = 1.0 - abs(r - surfR) / max(R * (0.004 + disp * 0.55), 1e-4);
      if (band <= 0.0) continue;
      float dens = band * band;
      // Rocky micro-relief near camera (same seed channel as plates detail feel).
      dens *= 0.65 + 0.35 * noise(dir * 90.0);
      dens *= uBlend;
      if (dens < 0.08) continue;
      vec4 alb = texture2D(uAlbedoMap, uv);
      float sea = alb.a;
      vec3 col = alb.rgb;
      vec3 N = normalize(dir);
      float ndl = max(dot(N, normalize(uSunDir)), 0.0);
      float wrap = ndl * 0.94 + 0.035;
      float term = smoothstep(-0.05, 0.12, dot(N, normalize(uSunDir)));
      wrap *= mix(0.15, 1.0, term);
      vec3 lit = col * wrap;
      if (sea > 0.5) {
        vec3 V = normalize(cameraPosition - p);
        vec3 H = normalize(normalize(uSunDir) + V);
        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
        float spec = pow(max(dot(N, H), 0.0), 48.0);
        lit = mix(lit, lit * vec3(0.82, 0.90, 1.05), 0.22);
        lit += vec3(0.75, 0.88, 1.05) * spec * (0.3 + 0.7 * fres) * ndl * 1.6;
      }
      // Front-to-back accumulate; first strong hit wins depth.
      float a = dens * 0.85;
      hitCol = hitCol + (1.0 - hitA) * lit * a;
      hitA = hitA + (1.0 - hitA) * a;
      if (hitT < 0.0 && a > 0.35) hitT = t;
      if (hitA > 0.92) break;
    }
    if (hitA < 0.04) discard;
    // Edge fade of brick AABB
    float edge = 1.0 - smoothstep(0.72, 1.0, length(vLocal) / max(uBrickHalf * 1.732, 1e-3));
    hitA *= edge * uBlend;
    if (hitA < 0.03) discard;
    gl_FragColor = vec4(hitCol / max(hitA, 1e-3), hitA);
  }
`;
