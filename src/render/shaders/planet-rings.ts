// ═══════════════════════════════════════════════════════════════════
// PLANET RINGS SHADER — Ring with Planet Shadow
// Projects planet shadow onto ring fragments by computing
// the ring fragment's distance to the planet-sun axis.
// ═══════════════════════════════════════════════════════════════════

export const planetRingsVertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  varying vec2 vUv;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;

    gl_Position = projectionMatrix * viewMatrix * worldPos;
    #include <logdepthbuf_vertex>
  }
`;

export const planetRingsFragmentShader = /* glsl */ `
  #include <logdepthbuf_pars_fragment>

  uniform vec3 uRingColor;
  uniform float uRingOpacity;
  uniform vec3 uSunDir;
  uniform vec3 uPlanetCenter;
  uniform float uPlanetRadius;
  uniform float uShadowAmbient;
  uniform float uShadowSoftness;
  uniform float uShadowStrength;
  uniform float uInnerRadius;
  uniform float uOuterRadius;
  uniform sampler2D uRingTexture;
  uniform bool uHasRingTexture;

  varying vec2 vUv;
  varying vec3 vWorldPos;

  void main() {
    #include <logdepthbuf_fragment>

    // Radial UV — distance from planet center projected onto ring plane
    vec3 toFrag = vWorldPos - uPlanetCenter;
    float dist = length(toFrag);

    // Normalize distance within ring bounds for alpha fade
    float ringT = (dist - uInnerRadius) / (uOuterRadius - uInnerRadius);
    float ringAlpha = smoothstep(0.0, 0.05, ringT) * smoothstep(1.0, 0.95, ringT);

    // Ring pattern — from texture or procedural bands
    float ringPattern;
    if (uHasRingTexture) {
      // Sample ring texture using radial position (ringT maps inner→outer to 0→1)
      vec4 texSample = texture2D(uRingTexture, vec2(ringT, 0.5));
      ringPattern = texSample.r;
      ringAlpha *= texSample.a;
    } else {
      // Procedural radial bands using sin waves
      float band = sin(ringT * 40.0) * 0.15 + 0.85;
      float band2 = sin(ringT * 120.0) * 0.05 + 0.95;
      ringPattern = band * band2;
    }

    // Planet shadow on ring
    // Project fragment position onto sun direction axis
    vec3 L = normalize(uSunDir);
    vec3 fragToCenter = uPlanetCenter - vWorldPos;
    float projDist = dot(fragToCenter, L);

    // Only shadow fragments on the far side of the planet from the sun
    float shadow = 1.0;
    if (projDist > 0.0) {
      // Distance from fragment to the planet-sun axis
      vec3 projected = vWorldPos + L * projDist;
      float axialDist = length(projected - uPlanetCenter);

      // Shadow if within planet radius (with softness)
      float softRadius = uPlanetRadius * (1.0 + uShadowSoftness);
      float shadowFactor = smoothstep(uPlanetRadius, softRadius, axialDist);
      shadow = mix(uShadowAmbient, 1.0, shadowFactor);
      shadow = mix(1.0, shadow, uShadowStrength);
    }

    vec3 color = uRingColor * ringPattern * shadow;
    float alpha = uRingOpacity * ringAlpha * shadow;

    if (alpha < 0.01) discard;

    gl_FragColor = vec4(color, alpha);
  }
`;
