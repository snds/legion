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
  // Per-vertex screen-space streak direction (normalized) + amount (0..MAX).
  // Packed as vec3 (xy=direction, z=amount) to keep the varying budget low.
  varying vec3 vStreak;
  uniform float uSizeScale;
  uniform float uPixelRatio;
  // World-space camera velocity (units per second). Frame-by-frame derivative
  // of camera.position, passed in by the LOD updater. The vertex shader
  // transforms it to view-space and divides by per-star depth to get each
  // star's screen-space drift rate — closer stars streak more than far ones.
  uniform vec3 uCamVelocity;
  // Global 0..1 gate. Below the speed threshold (slow navigation, orbiting),
  // this is 0 and the shader behaves identically to the no-streak version.
  // Ramps in during high-speed camera translation only.
  uniform float uStreakStrength;
  // Hard cap on stretch amount. 0.4 = max sprite 1.4x its rest size along
  // the streak axis — well below "hyperspace effect."
  uniform float uMaxStretch;

  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    // Transform world-space camera velocity into view space. modelViewMatrix
    // is V * M; for direction transforms we want only the rotational part,
    // which (V * M)[xyz][xyz] gives correctly when w=0.
    vec3 viewVel = (modelViewMatrix * vec4(uCamVelocity, 0.0)).xyz;
    // Per-star screen-space drift. Forward in view space is -Z, so depth =
    // -mvPosition.z (positive in front of camera). Stars stream OPPOSITE the
    // camera's apparent velocity, hence the negation.
    float depth = max(-mvPosition.z, 0.001);
    vec2 screenVel = -viewVel.xy / depth;
    float speed = length(screenVel);

    // Stretch amount: gated by global strength, clamped to uMaxStretch.
    // The 0.0008 calibration factor converts a typical fast-flight camera
    // velocity (10k-30k WU/s at galaxy scale, ~1000 WU depth) into a 0..0.4
    // range. Tweakable from the LOD updater if too strong/weak.
    float stretch = clamp(speed * 0.0008 * uStreakStrength, 0.0, uMaxStretch);

    vec2 dir = speed > 0.001 ? screenVel / speed : vec2(1.0, 0.0);
    vStreak = vec3(dir, stretch);

    // Inflate the point sprite along the streak axis. gl_PointSize is a
    // scalar so the sprite grows in both axes equally; the fragment shader
    // then compresses the perpendicular axis back down so the visual ends
    // up elongated, not just bigger.
    gl_PointSize = aSize * uSizeScale * uPixelRatio * (1.0 + stretch);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const galacticStarsFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vStreak;
  // Per-field additive dim (1.0 = none). Dense sectors set this < 1 so N overlapping points sum to
  // a natural coloured glow instead of clamping to white — which is what reveals the arm-phase colour.
  uniform float uDensityDim;

  void main() {
    // gl_PointCoord is the screen-aligned UV across the (square) sprite.
    vec2 p = gl_PointCoord - 0.5;

    // Rotate p into the streak frame: x along streak direction, y perpendicular.
    vec2 dir = vStreak.xy;
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 q = vec2(dot(p, dir), dot(p, perp));

    // Ellipse: semi-major along streak = 0.5 (full sprite half-width),
    // semi-minor perpendicular = 0.5 / (1+stretch) so the perpendicular
    // visible width stays roughly constant as the sprite grows. d=1 is
    // the boundary of the lit region.
    float stretch = vStreak.z;
    float d = length(vec2(q.x, q.y * (1.0 + stretch))) * 2.0;
    if (d > 1.0) discard;

    // Soft diffuse falloff (unchanged at rest). When stretched, alpha is
    // slightly reduced so streaked stars read as "in motion" / dimmer
    // rather than as larger / more present.
    float core = pow(1.0 - d, 1.6);
    float halo = 0.06 * (1.0 - d);
    float intensity = (core + halo) * (1.0 - stretch * 0.5) * uDensityDim;

    gl_FragColor = vec4(vColor, intensity);
  }
`;
