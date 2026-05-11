// ═══════════════════════════════════════════════════════════════════
// GALACTIC DISC — Procedural Diffuse Spiral
// Renders the Milky Way's stellar disc as a continuous warm volume
// with logarithmic spiral structure, fractal cloud variation, and
// dark dust lanes that occlude the underlying brightness — matching
// the ESA Gaia visualization aesthetic (sepia gold bulge, brown dust,
// pale beige outer disc).
//
// Implementation: a single CircleGeometry at galactic-plane y=0 rendered
// with NormalBlending so dust lanes can DARKEN the disc (additive can
// only add light). Output alpha is the disc presence, so empty regions
// stay fully transparent and reveal the starfield beneath.
// ═══════════════════════════════════════════════════════════════════

export const galacticDiscVertexShader = /* glsl */ `
  varying vec2 vUv;

  // Galactic-warp uniforms. Real Milky Way disc bends out of the
  // galactic plane at large radii — measured by HI / OB-star surveys
  // to grow linearly from ~7 kpc outward, reaching ±1 kpc amplitude
  // by 15 kpc. Modeled here as: z_warp(r,θ) = amp(r) * sin(θ - θ_nodes).
  uniform float uWarpAmplitude;  // peak displacement at r=1 (world units)
  uniform float uWarpInnerR;     // normalized r below which warp is zero
  uniform float uWarpAngle;      // line-of-nodes azimuth (radians)

  void main() {
    vUv = uv;
    vec2 p = uv - 0.5;
    float r = length(p) * 2.0;
    float theta = atan(p.y, p.x);

    vec3 pos = position;
    // Disc geometry is in local XY (later rotated -π/2 about X to lie
    // in the galactic plane). Local-Z displacement therefore becomes
    // world-Y displacement — the "above / below the plane" direction.
    float amp = max(0.0, r - uWarpInnerR) * uWarpAmplitude;
    pos.z += amp * sin(theta - uWarpAngle);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const galacticDiscFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3  uBulgeColor;   // warm yellow-white core
  uniform vec3  uArmColor;     // pale sepia disc / arms
  uniform vec3  uDustColor;    // brown-black dust tint
  uniform float uBulgeRadius;  // 0..1 fraction of disc radius
  uniform float uArmTwist;     // spiral tightness (radians per log(r))
  uniform float uArmCount;     // typically 4
  uniform float uArmPhaseOffset; // rotates the arm pattern (radians)
  uniform float uBarAngle;     // radians — bar orientation
  uniform float uBarLength;    // 0..1 — bar half-length as fraction of disc radius
  uniform float uBarWidth;     // 0..1 — bar half-width
  uniform float uDustStrength; // 0..1
  uniform float uOpacity;
  uniform float uTime;

  varying vec2 vUv;

  // ── 2D value noise ────────────────────────────────────────────
  vec2 hash2(vec2 p) {
    return fract(sin(vec2(
      dot(p, vec2(127.1, 311.7)),
      dot(p, vec2(269.5, 183.3))
    )) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = dot(hash2(i)               - 0.5, f);
    float b = dot(hash2(i + vec2(1.0,0.0)) - 0.5, f - vec2(1.0,0.0));
    float c = dot(hash2(i + vec2(0.0,1.0)) - 0.5, f - vec2(0.0,1.0));
    float d = dot(hash2(i + vec2(1.0,1.0)) - 0.5, f - vec2(1.0,1.0));
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y) * 0.5 + 0.5;
  }
  // 5-octave fractal Brownian motion — generates the cloud variation.
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.07;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // Centered at (0,0), unit-radius disc.
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    if (r > 1.0) discard;

    float theta = atan(p.y, p.x);
    // Logarithmic-spiral phase. uArmPhaseOffset lets us rotate the
    // arm pattern so the principal arms emerge from the bar ends
    // (matches real Sb/SBb galaxies).
    float lr = log(max(r, 0.02));
    float armPhase = theta - lr * uArmTwist + uArmPhaseOffset;

    // Arm density profile — variable sharpness with radius so arms
    // feather into the inter-arm regions at the outer disc (matching
    // observed Milky Way / Gaia density maps where arms diffuse with
    // increasing galactocentric radius).
    float armBand = 0.5 + 0.5 * cos(armPhase * uArmCount);
    // Sharpness 2.0 in the inner third → 0.7 at the edge. The cos band
    // raised to a lower power widens dramatically, so outer arms read
    // as broad density gradients rather than thin lanes.
    float armSharpness = mix(2.0, 0.7, smoothstep(0.15, 0.85, r));
    float arms = pow(armBand, armSharpness);

    // Inner attenuation: arms fade as r→0 so the central kpc is
    // bulge+bar territory, not concentric arm rings (the visual
    // problem at the very center previously).
    arms *= smoothstep(0.08, 0.26, r);
    // Outer taper: smooth fade so the disc rim doesn't read as a hard
    // arm boundary.
    arms *= 1.0 - smoothstep(0.82, 1.0, r);

    // Arm-edge noise breakup — varies arm density along its length so
    // the band has texture rather than uniform luminosity. (The swirl
    // and rot used by cloud-noise are defined later; recompute inline.)
    float swirlEarly = -lr * 1.4;
    mat2 rotEarly = mat2(cos(swirlEarly), -sin(swirlEarly), sin(swirlEarly), cos(swirlEarly));
    vec2 lengthNoise = rotEarly * (p * 3.5);
    float armDensityNoise = fbm(lengthNoise);
    arms *= mix(0.55, 1.15, armDensityNoise);

    // Asymmetric arm strength — real Milky Way has two principal arms
    // (Sagittarius/Perseus) brighter than the other two (Norma/Scutum).
    float principal = 0.5 + 0.5 * cos(armPhase * 2.0);
    arms *= 0.55 + 0.45 * principal;

    // Bulge: smooth Gaussian falloff anchored at the center.
    float bulge = exp(-pow(r / uBulgeRadius, 2.0) * 2.5);

    // Central bar — bright elongated ellipse oriented at uBarAngle.
    // Real Milky Way has a ~5 kpc bar at ~25° relative to Sun-GC line.
    float cba = cos(uBarAngle), sba = sin(uBarAngle);
    vec2 barCoord = vec2(cba * p.x + sba * p.y, -sba * p.x + cba * p.y);
    float bar = exp(
      -pow(barCoord.x / uBarLength, 2.0) * 1.6
      -pow(barCoord.y / uBarWidth,  2.0) * 6.0
    );

    // Overall radial disc envelope — slower falloff so outer arms keep presence.
    float discEnv = exp(-r * 1.6) * (1.0 - smoothstep(0.88, 1.0, r));

    // Sampled cloud noise, rotated by log(r) so the noise field
    // swirls with the spiral — keeps the grain feeling continuous
    // with the arm structure rather than fighting it.
    float swirl = -lr * 1.4;
    mat2 rot = mat2(cos(swirl), -sin(swirl), sin(swirl), cos(swirl));
    vec2 sUV = rot * (p * 6.0);
    float cloud = fbm(sUV);
    cloud = mix(0.5, cloud, 0.95);

    // Dust pattern — broken filaments concentrated along the trailing
    // (inner) edge of each arm where real density-wave compression
    // produces dust lanes (Cassini/Gaia/Hubble observations of M51,
    // M83, NGC 1300 all show this morphology). Modulated by two FBM
    // octaves at different frequencies for patchy, non-uniform lanes.
    vec2 dustUV = rot * (p * 14.0) + vec2(armPhase * 1.8, 0.0);
    float dustNoise = fbm(dustUV);
    float dustFine = fbm(p * 36.0);             // high-freq breakup
    float armEdge = pow(arms, 0.8) * (0.55 + 0.45 * cos(armPhase * uArmCount - 0.6));
    float dust = smoothstep(0.45, 0.78, dustNoise * armEdge);
    // Break the dust into patchy filaments rather than continuous bands.
    dust *= 0.45 + 0.55 * dustFine;
    dust *= smoothstep(0.08, 0.25, r);          // no dust through the bulge
    dust *= 1.0 - smoothstep(0.78, 0.95, r);    // no dust at extreme edge

    // ── Compose ──
    // Arm/inter-arm color modulation: arms warmer + brighter, gaps cooler + dimmer.
    vec3 armTint = mix(uArmColor * 0.5, uArmColor * 1.15, arms);
    vec3 baseDisc = armTint * (discEnv + arms * 0.9) * (0.7 + cloud * 0.6) * 2.2;
    vec3 bulgeContribution = uBulgeColor * bulge * 2.4;
    // Bar reads warm like the bulge but slightly more saturated.
    // Punch it up so the bar is a clear visual feature, not a subtle hint.
    vec3 barContribution = uBulgeColor * bar * 2.6;
    vec3 color = baseDisc + bulgeContribution + barContribution;

    // Dust occlusion — multiplicative darkening toward uDustColor.
    color = mix(color, color * uDustColor, dust * uDustStrength);

    // Alpha = how much of this disc is present here. Heavier weighting on
    // discEnv + arms + bulge so the diffuse layer reads as the dominant
    // visual rather than a faint tint behind the additive particle field.
    float coverage = discEnv * (0.65 + arms * 0.9) + bulge * 1.4 + bar * 1.7;
    coverage *= (0.5 + cloud * 0.7);
    coverage += dust * 0.55;
    coverage = clamp(coverage, 0.0, 1.0);

    gl_FragColor = vec4(color, coverage * uOpacity);
  }
`;
