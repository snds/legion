// ═══════════════════════════════════════════════════════════════════
// ASTEROID SHADER — Flat-Shaded Instanced Rocks
// Uses dFdx/dFdy derivatives for flat shading (no normal maps).
// Per-instance color via instance attribute. Lambert lighting from the
// system's star(s) — position/color uniforms with MAX_STARS=2, so future
// binary systems (or a neutron star's blue-white point) light the belt
// by changing uniforms, not shaders. Inverse-square falloff normalized
// to the belt's mid radius so the inner belt reads slightly brighter.
//
// Scale-unification U2: lighting is computed in the belt's SYSTEM-LOCAL frame
// (before modelMatrix), NOT world space. The local tier renders scaled by
// SYSTEM_TIER_SCALE and shifted by the per-frame floating origin, so a world-
// space light distance no longer matches uRefDist (authored WU) — at true scale
// d collapses to ~1e-2 WU while uRefDist ≈ 30, blowing falloff up ~1e6× and
// washing the belt to solid white. The local frame is invariant to both the
// group scale and the floating origin: the star sits at the system origin, and
// distances are the authored orbital radii uRefDist is normalized against.
// uStarPos is therefore in this system-local frame (primary star = origin).
// ═══════════════════════════════════════════════════════════════════

export const asteroidVertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 instanceColor;
  varying vec3 vColor;
  varying vec3 vLightPos;   // asteroid position in the system-local (authored) frame — star at origin

  void main() {
    vColor = instanceColor;
    // System-local position (instance placement only, no modelMatrix): authored
    // WU, star at the origin — invariant to the group scale + floating origin.
    vec4 localPos = instanceMatrix * vec4(position, 1.0);
    vLightPos = localPos.xyz;
    // Full world transform for rasterization (scale + floating-origin shift).
    vec4 worldPos = modelMatrix * localPos;

    gl_Position = projectionMatrix * viewMatrix * worldPos;
    #include <logdepthbuf_vertex>
  }
`;

export const asteroidFragmentShader = /* glsl */ `
  #include <logdepthbuf_pars_fragment>

  #define MAX_STARS 2

  uniform float uLightIntensity;
  uniform vec3 uStarPos[MAX_STARS];    // system-local star positions (primary = origin)
  uniform vec3 uStarColor[MAX_STARS];  // linear radiance tint per star
  uniform int uStarCount;
  uniform float uRefDist;              // distance at which falloff = 1 (belt mid radius, authored WU)

  varying vec3 vColor;
  varying vec3 vLightPos;

  void main() {
    #include <logdepthbuf_fragment>

    // Flat shading via screen-space derivatives (system-local frame; the star
    // direction below is in the same frame, so NdotL is consistent).
    vec3 dx = dFdx(vLightPos);
    vec3 dy = dFdy(vLightPos);
    vec3 crossN = cross(dx, dy);
    float crossLen = length(crossN);
    vec3 N = crossLen > 0.0001 ? crossN / crossLen : vec3(0.0, 1.0, 0.0);

    // Accumulate Lambert from each star with inverse-square falloff. All in the
    // system-local frame: d is the authored orbital distance uRefDist normalizes.
    vec3 light = vec3(0.0);
    for (int s = 0; s < MAX_STARS; s++) {
      if (s >= uStarCount) break;
      vec3 toStar = uStarPos[s] - vLightPos;
      float d = max(length(toStar), 0.0001);
      vec3 L = toStar / d;
      float NdotL = max(dot(N, L), 0.0);
      float falloff = (uRefDist * uRefDist) / (d * d);
      light += uStarColor[s] * (NdotL * falloff);
    }

    // Near-zero ambient: space has no fill light — the dark side of a rock is
    // dark. The tiny floor keeps silhouettes from dissolving into pure black.
    float ambient = 0.02;
    vec3 color = vColor * (ambient + light * uLightIntensity);

    gl_FragColor = vec4(color, 1.0);
  }
`;
