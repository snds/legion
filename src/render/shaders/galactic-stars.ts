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
  // Per-star spiral-arm crestiness (0 gap … 1 crest). Only meaningful for sector stars; the disc
  // geometry omits it (defaults to 0). Drives the arm-phase DEBUG recolour below.
  attribute float aCrest;
  // Phase-1 galactic-motion orbit: (R0_kpc, phi0_rad, y0_kpc, omega_radPerMyr). Azimuth streams as
  // phi0 + omega*uTime; at uTime=0 this reproduces the baked position exactly.
  attribute vec4 aOrbit;
  uniform float uTime;     // Myr (0 = frozen; advanced by the time-warp slider)
  uniform float uArmDebug; // 0 = normal colour, 1 = recolour by arm phase (debug topology view)
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
  // Continuous per-VERTEX distance LOD reference (WU). > 0 (the full-galaxy build-out) shrinks each
  // point by clamp(ref/depth, floor, 1) so the far galaxy recedes to a faint dusting SMOOTHLY — no
  // per-region size shells (the concentric banding). 0 = off (disc + near streaming want constant size).
  uniform float uDepthLODRef;

  void main() {
    // Arm-phase debug: gap (crest 0) → dim red, crest (1) → bright cyan, so spiral arms light up and
    // seam continuity is obvious. uArmDebug lerps between the true colour and the topology ramp.
    vec3 armCol = mix(vec3(0.9, 0.25, 0.18), vec3(0.30, 0.85, 1.0), aCrest);
    vColor = mix(color, armCol, uArmDebug);
    // Galactic motion (Phase 1): stream each star along its circular guiding orbit at Ω(R). Inner stars have
    // larger omega ⇒ differential rotation. Trig runs in kpc (O(1-16)); ×KPC_TO_WU (1e6) LAST so ±1e7 WU
    // never enters cos/sin (float precision). At uTime=0, phi=phi0 ⇒ this equals the baked position.
    const float KPC_TO_WU = 1000000.0;
    float phi = aOrbit.y + aOrbit.w * uTime;
    vec3 orbitPos = vec3(aOrbit.x * cos(phi), aOrbit.z, aOrbit.x * sin(phi)) * KPC_TO_WU;
    vec4 mvPosition = modelViewMatrix * vec4(orbitPos, 1.0);

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
    // Continuous depth LOD (build-out): per-vertex, so far points shrink smoothly to a 0.2 floor
    // (uniform faint dusting at distance, no per-region shells). Off when uDepthLODRef == 0.
    float lodSize = uDepthLODRef > 0.0 ? clamp(uDepthLODRef / depth, 0.2, 1.0) : 1.0;
    gl_PointSize = aSize * uSizeScale * uPixelRatio * (1.0 + stretch) * lodSize;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// POSITION-BASED variant for the streamed sector / region-merge star fields. Those live in the
// UNIFIED metric (1pc=1000WU) and are re-rooted by the floating origin via their GROUP transform, so
// they must render from the `position` attribute through modelViewMatrix — NOT the aOrbit galactic-
// motion path above (which reconstructs an ABSOLUTE galactocentric position in the galaxy-native ×1e6
// frame, for the disc's differential rotation). Same size / streak / depth-LOD / arm-debug logic; only
// the vertex position source differs. (Without this, sector/region stars — which set `position` but
// never `aOrbit` — collapsed to orbitPos=(0,0,0), i.e. every star at its sector's origin.)
export const sectorStarsVertexShader = /* glsl */ `
  attribute vec3 color;
  attribute float aSize;
  attribute float aCrest;
  varying vec3 vColor;
  varying vec3 vStreak;
  varying float vCrest; // arm crestiness (0 gap … 1 crest) → fragment "galactic form" mask
  uniform float uSizeScale;
  uniform float uPixelRatio;
  uniform float uArmDebug;
  uniform vec3 uCamVelocity;
  uniform float uStreakStrength;
  uniform float uMaxStretch;
  uniform float uDepthLODRef;

  void main() {
    vCrest = aCrest;
    vec3 armCol = mix(vec3(0.9, 0.25, 0.18), vec3(0.30, 0.85, 1.0), aCrest);
    vColor = mix(color, armCol, uArmDebug);
    // Unified-frame position, re-rooted via the group's modelMatrix (floating origin).
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    vec3 viewVel = (modelViewMatrix * vec4(uCamVelocity, 0.0)).xyz;
    float depth = max(-mvPosition.z, 0.001);
    vec2 screenVel = -viewVel.xy / depth;
    float speed = length(screenVel);
    float stretch = clamp(speed * 0.0008 * uStreakStrength, 0.0, uMaxStretch);
    vec2 dir = speed > 0.001 ? screenVel / speed : vec2(1.0, 0.0);
    vStreak = vec3(dir, stretch);

    float lodSize = uDepthLODRef > 0.0 ? clamp(uDepthLODRef / depth, 0.2, 1.0) : 1.0;
    gl_PointSize = aSize * uSizeScale * uPixelRatio * (1.0 + stretch) * lodSize;
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

// Sector/region fragment with the GALACTIC-FORM MASK (Phase 5a exploration). The streamed stars are
// density-sampled, so at the galaxy tier they pile into an even fill with weak spiral contrast. Dim the
// inter-arm/gap stars (low crest) and keep the arm-crest stars, so the field resolves into the spiral
// form. uFormMask (0 = raw uniform field … 1 = fully carved) is the live A/B knob; a 0.15 floor keeps a
// faint inter-arm dusting. This is the analytic-form proxy for the eventual live-galaxy screen-space mask.
export const sectorStarsFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vStreak;
  varying float vCrest;
  uniform float uDensityDim;
  uniform float uFormMask;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    vec2 dir = vStreak.xy;
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 q = vec2(dot(p, dir), dot(p, perp));
    float stretch = vStreak.z;
    float d = length(vec2(q.x, q.y * (1.0 + stretch))) * 2.0;
    if (d > 1.0) discard;

    float core = pow(1.0 - d, 1.6);
    float halo = 0.06 * (1.0 - d);
    // Spiral-form mask: gap→0.15, crest→1.0, lerped by uFormMask (0 leaves the raw field untouched).
    float form = mix(1.0, mix(0.15, 1.0, smoothstep(0.05, 0.8, vCrest)), uFormMask);
    float intensity = (core + halo) * (1.0 - stretch * 0.5) * uDensityDim * form;

    gl_FragColor = vec4(vColor, intensity);
  }
`;
