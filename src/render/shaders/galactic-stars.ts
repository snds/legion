// ═══════════════════════════════════════════════════════════════════
// GALACTIC STARS — Per-Particle Size + Color Stellar Population
// Replaces PointsMaterial for galactic star fields. Each point is a
// circular soft-edge sprite with its own size (drawn from a stellar
// luminosity distribution) and color (drawn from Planckian spectra
// indexed by stellar class). The "shape orbs / sharp diffuse light
// falloff" behaviour the user described comes from the fragment
// shader's pow(1-d) profile centred on gl_PointCoord.
//
// Custom attributes:
//   color (vec3) — per-particle RGB (standard three.js naming)
//   aSize (float) — per-particle pixel size at uSizeScale=1
// Uniforms:
//   uSizeScale — global multiplier, driven by LOD updater
//   uPixelRatio — devicePixelRatio so points render crisp on HiDPI
// ═══════════════════════════════════════════════════════════════════

export const galacticStarsVertexShader = /* glsl */ `
  attribute vec3 color;
  attribute float aSize;
  varying vec3 vColor;
  uniform float uSizeScale;
  uniform float uPixelRatio;
  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uSizeScale * uPixelRatio;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const galacticStarsFragmentShader = /* glsl */ `
  varying vec3 vColor;
  void main() {
    // Distance from the center of the point sprite (0 at center, 1 at edge).
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    if (d > 1.0) discard;
    // Soft diffuse falloff — hot bright core, smoothly fading halo.
    // pow(1-d, 1.6) gives a sharp center; the +0.06*(1-d) term adds a
    // faint outer glow so bigger stars register as small bloomy orbs
    // rather than hard pixels.
    float core = pow(1.0 - d, 1.6);
    float halo = 0.06 * (1.0 - d);
    float intensity = core + halo;
    gl_FragColor = vec4(vColor, intensity);
  }
`;
