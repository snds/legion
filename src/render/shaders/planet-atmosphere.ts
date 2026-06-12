// ═══════════════════════════════════════════════════════════════════
// PLANET ATMOSPHERE SHADER — BackSide Fresnel Rim Glow
// Renders on BackSide of a slightly larger sphere.
// Fresnel rim with twilight color bias, alpha discard for
// performance, and sun-direction-dependent intensity.
// ═══════════════════════════════════════════════════════════════════

export const planetAtmosphereVertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;

  void main() {
    // WORLD-space normal (matches planet-surface.ts fix): normalMatrix is the
    // VIEW-space normal matrix, which made the atmosphere's day/twilight gating
    // rotate with the camera instead of tracking the world-space sun.
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    // Guard: when camera is at object position, toCamera ≈ 0 → normalize produces NaN
    vec3 toCamera = cameraPosition - worldPos.xyz;
    float toCameraDist = length(toCamera);
    vViewDir = toCameraDist > 0.0001 ? toCamera / toCameraDist : vec3(0.0, 0.0, 1.0);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
    #include <logdepthbuf_vertex>
  }
`;

export const planetAtmosphereFragmentShader = /* glsl */ `
  #include <logdepthbuf_pars_fragment>

  uniform vec3 uAtmosColor;
  uniform vec3 uSunDir;
  uniform float uFresnelPower;
  uniform float uCenterFalloff;
  uniform float uEdgeThreshold;
  uniform float uEdgeSoftness;
  uniform float uTwilightBias;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;

  void main() {
    #include <logdepthbuf_fragment>

    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewDir);
    vec3 L = normalize(uSunDir);

    // Fresnel rim — stronger at edges (BackSide, so N points inward)
    float NdotV = dot(N, V);
    float sinTheta = sqrt(1.0 - NdotV * NdotV);
    float rim = pow(sinTheta, uFresnelPower);

    // Sun orientation — how lit is this part of the atmosphere
    float sunOrientation = dot(N, L);

    // Day side: full atmosphere color
    // Twilight: bias toward warmer tones
    // Night side: dim
    float dayFactor = smoothstep(-0.5, 0.3, sunOrientation);
    float twilightMix = pow(dayFactor, uTwilightBias);

    // Twilight color — warmer/brighter at terminator
    vec3 twilightColor = uAtmosColor * 1.4 + vec3(0.1, 0.04, 0.0);
    vec3 atmosColor = mix(uAtmosColor * 0.15, uAtmosColor, twilightMix);
    atmosColor = mix(atmosColor, twilightColor, (1.0 - abs(sunOrientation * 2.0 - 1.0)) * 0.3);

    // Center falloff — reduce opacity toward center of planet disc
    float centerDim = pow(sinTheta, uCenterFalloff);

    // Edge ramp — additional control for edge visibility
    float edgeRamp = smoothstep(uEdgeThreshold - uEdgeSoftness, uEdgeThreshold + uEdgeSoftness, sinTheta);

    float alpha = rim * centerDim * edgeRamp * dayFactor;

    // Discard very faint fragments for performance
    if (alpha < 0.02) discard;

    gl_FragColor = vec4(atmosColor, alpha);
  }
`;
