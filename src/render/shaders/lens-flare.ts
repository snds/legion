// ═══════════════════════════════════════════════════════════════════
// LENS FLARE SHADER — Procedural Fullscreen Flare Effect
// Generates glare rays, ghost elements, halo ring, and starburst
// entirely procedurally (no textures). Applied as a post-processing
// pass when looking toward the star.
// ═══════════════════════════════════════════════════════════════════

export const lensFlareVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const lensFlareFragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uLightPos;       // star screen position (0-1 UV space)
  uniform float uIntensity;     // overall flare intensity (0-1, includes occlusion fade)
  uniform float uOpacity;       // user-controlled opacity
  uniform int uStarPoints;      // number of glare rays
  uniform float uGlareSize;     // size of the glare
  uniform float uFlareSize;     // size of ghost elements
  uniform float uFlareSpeed;    // animation speed for ghosts
  uniform float uHaloScale;     // halo ring scale
  uniform vec3 uColorGain;      // RGB color tint (0-255 mapped to 0-1)
  uniform float uTime;

  varying vec2 vUv;

  // NaN-safe helper: clamp any NaN/Inf to 0
  float safe(float v) { return (v >= 0.0 || v <= 0.0) ? v : 0.0; }

  // Soft radial gradient
  float disk(vec2 pos, float r) {
    float d = length(pos);
    return 1.0 - smoothstep(r * 0.8, r, d);
  }

  // Star-shaped glare pattern
  float starGlare(vec2 pos, int points, float size) {
    if (size < 0.0001) return 0.0;
    float d = length(pos);
    if (d < 0.0001) return 1.0; // at the light source center
    float angle = atan(pos.y, pos.x);

    // Blade pattern
    float blade = cos(angle * float(points)) * 0.5 + 0.5;
    blade = pow(blade, 8.0);

    // Radial falloff — guard division by size
    float falloff = exp(-d / size * 3.0);

    return blade * falloff;
  }

  // Ghost element (lens reflection)
  float ghost(vec2 pos, float r, float blur) {
    if (r < 0.00001) return 0.0;
    float d = length(pos);
    return smoothstep(r + blur, r, d) * smoothstep(r - blur - r * 0.3, r - blur, d);
  }

  // Halo ring
  float halo(vec2 pos, float r, float thickness) {
    if (r < 0.00001 || thickness < 0.00001) return 0.0;
    float d = length(pos);
    return smoothstep(r + thickness, r, d) * smoothstep(r - thickness, r, d);
  }

  void main() {
    vec4 color = texture2D(tDiffuse, vUv);

    // NaN/Inf safety net: if tDiffuse contains corrupted pixels, sanitize them
    // This prevents NaN from persisting across frames via the bloom additive blend
    if (!(color.r >= 0.0 || color.r <= 0.0)) color.r = 0.0;
    if (!(color.g >= 0.0 || color.g <= 0.0)) color.g = 0.0;
    if (!(color.b >= 0.0 || color.b <= 0.0)) color.b = 0.0;

    if (uIntensity < 0.001) {
      gl_FragColor = color;
      return;
    }

    vec2 uv = vUv;
    vec2 lightUV = uLightPos;
    vec2 delta = uv - lightUV;

    vec2 aspectDelta = delta;

    // ── Glare rays ──
    float glare = starGlare(aspectDelta, uStarPoints, uGlareSize);

    // ── Central glow ──
    float centerGlow = disk(aspectDelta, 0.02) * 2.0;
    float innerGlow = disk(aspectDelta, 0.08) * 0.5;

    // ── Ghost elements along center→light axis ──
    float ghosts = 0.0;
    vec2 ghostVec = lightUV - vec2(0.5);
    float ghostDist = length(ghostVec);
    // Guard: normalize produces NaN when light is at screen center
    vec2 ghostDir = ghostDist > 0.001 ? ghostVec / ghostDist : vec2(1.0, 0.0);

    for (int i = 0; i < 5; i++) {
      float t = float(i + 1) * 0.18;
      vec2 ghostPos = vec2(0.5) + ghostDir * ghostDist * (1.0 - t * 2.0);
      float r = uFlareSize * (0.5 + float(i) * 0.3);
      ghosts += ghost(uv - ghostPos, r, r * 0.5) * 0.15;
    }

    // ── Halo ring ──
    float haloRing = halo(aspectDelta, uHaloScale * 0.15, 0.015) * 0.3;

    // ── Combine ──
    // Sanitize all contributions to prevent NaN propagation
    float totalFlare = safe(glare) + safe(centerGlow) + safe(innerGlow) + safe(ghosts) + safe(haloRing);

    // Apply color tint — normalize is safe here because vec3(1.0)+colorGain is always non-zero
    vec3 colorGain = uColorGain / 255.0;
    vec3 flareColor = vec3(1.0) + colorGain;
    float flareLen = length(flareColor);
    flareColor = flareLen > 0.001 ? (flareColor / flareLen) * 1.4 : vec3(0.81);

    // Add warm core + tinted outer
    vec3 warmCore = vec3(1.0, 0.95, 0.8) * safe(centerGlow);
    vec3 tintedFlare = flareColor * (safe(glare) + safe(innerGlow) + safe(ghosts) + safe(haloRing));

    vec3 flareContrib = (warmCore + tintedFlare) * uIntensity * uOpacity;

    color.rgb += flareContrib;

    // Final NaN safety net — if anything went wrong, output the sanitized input
    if (!(color.r >= 0.0 || color.r <= 0.0)) color.r = 0.0;
    if (!(color.g >= 0.0 || color.g <= 0.0)) color.g = 0.0;
    if (!(color.b >= 0.0 || color.b <= 0.0)) color.b = 0.0;

    gl_FragColor = vec4(color.rgb, 1.0);
  }
`;
