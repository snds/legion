// ═══════════════════════════════════════════════════════════════════
// ASTEROID SHADER — Flat-Shaded Instanced Rocks
// Uses dFdx/dFdy derivatives for flat shading (no normal maps).
// Per-instance color via instance attribute. Lambert lighting from star.
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

  uniform float uLightIntensity;

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

    // Light from origin (star)
    float wpLen = length(vWorldPos);
    vec3 L = wpLen > 0.0001 ? -vWorldPos / wpLen : vec3(0.0, 1.0, 0.0);
    float NdotL = max(dot(N, L), 0.0);

    // Lambert diffuse + ambient
    float ambient = 0.08;
    vec3 color = vColor * (ambient + NdotL * uLightIntensity);

    gl_FragColor = vec4(color, 1.0);
  }
`;
