// ═══════════════════════════════════════════════════════════════════
// ASTEROID SHADER — Flat-Shaded Instanced Rocks
// Uses dFdx/dFdy derivatives for flat shading (no normal maps).
// Per-instance color via instance attribute. Lambert lighting from the
// system's star(s) — position/color uniforms with MAX_STARS=2, so future
// binary systems (or a neutron star's blue-white point) light the belt
// by changing uniforms, not shaders. Inverse-square falloff normalized
// to the belt's mid radius so the inner belt reads slightly brighter.
// ═══════════════════════════════════════════════════════════════════

export const asteroidVertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 instanceColor;
  varying vec3 vColor;
  varying vec3 vWorldPos;

  void main() {
    vColor = instanceColor;
    vec4 worldPos = instanceMatrix * vec4(position, 1.0);
    // Apply model matrix (the InstancedMesh's own transform)
    worldPos = modelMatrix * worldPos;
    vWorldPos = worldPos.xyz;

    gl_Position = projectionMatrix * viewMatrix * worldPos;
    #include <logdepthbuf_vertex>
  }
`;

export const asteroidFragmentShader = /* glsl */ `
  #include <logdepthbuf_pars_fragment>

  #define MAX_STARS 2

  uniform float uLightIntensity;
  uniform vec3 uStarPos[MAX_STARS];    // world-space star positions
  uniform vec3 uStarColor[MAX_STARS];  // linear radiance tint per star
  uniform int uStarCount;
  uniform float uRefDist;              // distance at which falloff = 1 (belt mid radius)

  varying vec3 vColor;
  varying vec3 vWorldPos;

  void main() {
    #include <logdepthbuf_fragment>

    // Flat shading via screen-space derivatives
    vec3 dx = dFdx(vWorldPos);
    vec3 dy = dFdy(vWorldPos);
    vec3 crossN = cross(dx, dy);
    float crossLen = length(crossN);
    vec3 N = crossLen > 0.0001 ? crossN / crossLen : vec3(0.0, 1.0, 0.0);

    // Accumulate Lambert from each star with inverse-square falloff.
    vec3 light = vec3(0.0);
    for (int s = 0; s < MAX_STARS; s++) {
      if (s >= uStarCount) break;
      vec3 toStar = uStarPos[s] - vWorldPos;
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
