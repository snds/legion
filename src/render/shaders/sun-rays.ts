// ═══════════════════════════════════════════════════════════════════
// SUN CORONA RAYS SHADER — Billboard quad strips with noise turbulence
// Camera-facing rays emanating from sun surface.
// Simplified from PSS FWDPSS.js lines 50345-50346.
// ═══════════════════════════════════════════════════════════════════

export const sunRaysVertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec4 aPos;    // x=phase along ray, y=billboard side, z=segment, w=unused
attribute vec3 aPos0;   // ray origin on sun surface
attribute vec4 aRandom; // per-ray random values

uniform float uTime;
uniform float uWidth;
uniform float uLength;
uniform float uNoiseFrequency;
uniform float uNoiseAmplitude;
uniform float uSunRadius;

varying float vAlpha;
varying vec3 vColor;

// Simplified twisted sine noise for ray displacement
float twistedNoise(vec3 p, float t) {
  float n = 0.0;
  float amp = 1.0;
  float freq = 1.0;
  for (int i = 0; i < 3; i++) {
    n += sin(p.x * freq + t * 1.3) * sin(p.y * freq + t * 0.7) * sin(p.z * freq + t) * amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return n;
}

void main() {
  float phase = aPos.x;   // 0-1 along ray
  float side = aPos.y;    // -1 or 1 for billboard
  vec3 rayDir = normalize(aPos0);

  // Apply noise turbulence to ray direction
  float t = uTime * 0.3 + aRandom.x * 6.28;
  float noise = twistedNoise(rayDir * uNoiseFrequency + aRandom.xyz * 10.0, t) * uNoiseAmplitude;

  // Position along ray with noise offset — start from sun surface
  vec3 worldPos = rayDir * (uSunRadius + phase * uLength * uSunRadius + noise * phase * 0.05 * uSunRadius);

  // Camera-facing billboard
  vec4 mvCenter = modelViewMatrix * vec4(worldPos, 1.0);
  vec3 viewRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  float width = uWidth * uSunRadius * (1.0 - phase) * (0.5 + aRandom.y * 0.5);
  mvCenter.xyz += viewRight * side * width * 0.01;

  // Warm orange-yellow ray color
  float hue = aRandom.z;
  vColor = vec3(
    0.9 + hue * 0.1,
    0.5 + hue * 0.3,
    0.1 + hue * 0.1
  );

  // Alpha: fades along ray length and at edges
  vAlpha = (1.0 - phase) * (1.0 - abs(side) * 0.3);

  gl_Position = projectionMatrix * mvCenter;
  #include <logdepthbuf_vertex>
}
`;

export const sunRaysFragmentShader = /* glsl */ `
#include <logdepthbuf_pars_fragment>

uniform float uOpacity;

varying float vAlpha;
varying vec3 vColor;

void main() {
  float alpha = vAlpha * vAlpha * uOpacity;
  gl_FragColor = vec4(vColor, alpha);
  #include <logdepthbuf_fragment>
}
`;
