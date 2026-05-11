// ═══════════════════════════════════════════════════════════════════
// SUN SURFACE SHADER — Animated Perlin cubemap sampling with fresnel
// Samples 3 time-rotated cubemap layers, averages them.
// Ported from PSS FWDPSS.js lines 50339-50340.
// ═══════════════════════════════════════════════════════════════════

export const sunSurfaceVertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uTime;

varying vec3 vLayer0;
varying vec3 vLayer1;
varying vec3 vLayer2;
varying vec3 vNormalView;
varying vec3 vViewDir;

mat3 rotateY(float a) {
  float s = sin(a), c = cos(a);
  return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

mat3 rotateX(float a) {
  float s = sin(a), c = cos(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

mat3 rotateZ(float a) {
  float s = sin(a), c = cos(a);
  return mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
}

void main() {
  vec3 pos = position;
  vec3 n = normal;

  // 3 time-rotated coordinate layers for cubemap sampling
  float t = uTime * 0.05;
  vLayer0 = n * rotateY(t);
  vLayer1 = n * rotateX(t + 2.094);
  vLayer2 = n * rotateZ(t - 4.188);

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  vNormalView = normalize(normalMatrix * n);
  // Guard: when camera is inside sun mesh, mvPos ≈ 0 → normalize produces NaN
  float mvDist = length(mvPos.xyz);
  vViewDir = mvDist > 0.0001 ? -mvPos.xyz / mvDist : vec3(0.0, 0.0, 1.0);

  gl_Position = projectionMatrix * mvPos;
  #include <logdepthbuf_vertex>
}
`;

export const sunSurfaceFragmentShader = /* glsl */ `
#include <logdepthbuf_pars_fragment>

uniform samplerCube uPerlinCube;
uniform float uFresnelPower;
uniform float uFresnelInfluence;
uniform float uTint;
uniform float uBase;
uniform float uBrightnessOffset;
uniform float uBrightness;

varying vec3 vLayer0;
varying vec3 vLayer1;
varying vec3 vLayer2;
varying vec3 vNormalView;
varying vec3 vViewDir;

vec3 brightnessToColor(float b) {
  b += uBrightnessOffset;
  // Warm orange-to-yellow ramp: R stays high, G follows, B deeply suppressed
  float r = b;
  float g = b * b * 0.7;
  float bb = b * b * b * b * 0.15;
  return vec3(r, g, bb) * uBrightness;
}

void main() {
  // Sample 3 time-offset layers from Perlin cubemap
  float n0 = textureCube(uPerlinCube, vLayer0).r;
  float n1 = textureCube(uPerlinCube, vLayer1).r;
  float n2 = textureCube(uPerlinCube, vLayer2).r;
  float n = (n0 + n1 + n2) / 3.0;

  // Fresnel rim glow
  float nDotV = dot(vNormalView, vViewDir);
  float fresnel = pow(1.0 - clamp(nDotV, 0.0, 1.0), uFresnelPower) * uFresnelInfluence;
  float brightness = n * uBase + fresnel;

  vec3 color = brightnessToColor(brightness);

  gl_FragColor = vec4(color, 1.0);
  #include <logdepthbuf_fragment>
}
`;
