// ═══════════════════════════════════════════════════════════════════
// SUN GLOW SHADER — BackSide rim-based glow shell
// Rendered inside-out with additive blending.
// Ported from PSS FWDPSS.js lines 50343-50344.
// ═══════════════════════════════════════════════════════════════════

export const sunGlowVertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uExpand;

varying vec3 vNormalView;
varying vec3 vViewDir;

void main() {
  // Expand vertices along normals to create glow shell
  vec3 pos = position + normal * uExpand;

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  vNormalView = normalize(normalMatrix * normal);
  // Guard: when camera is inside glow shell, mvPos ≈ 0 → normalize produces NaN
  float mvDist = length(mvPos.xyz);
  vViewDir = mvDist > 0.0001 ? -mvPos.xyz / mvDist : vec3(0.0, 0.0, 1.0);

  gl_Position = projectionMatrix * mvPos;
  #include <logdepthbuf_vertex>
}
`;

export const sunGlowFragmentShader = /* glsl */ `
#include <logdepthbuf_pars_fragment>

uniform float uInner;
uniform float uOuter;
uniform float uIntensity;
uniform float uTint;
uniform float uBrightness;

varying vec3 vNormalView;
varying vec3 vViewDir;

vec3 brightnessToColor(float b) {
  // Warm orange glow ramp
  float r = b;
  float g = b * b * 0.7;
  float bb = b * b * b * b * 0.15;
  return vec3(r, g, bb) * uBrightness;
}

void main() {
  float rim = 1.0 - abs(dot(vNormalView, vViewDir));
  float band = smoothstep(uOuter, uInner, rim);
  float brightness = band * uIntensity;

  vec3 color = brightnessToColor(brightness);

  gl_FragColor = vec4(color, brightness);
  #include <logdepthbuf_fragment>
}
`;
