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
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
    // Logarithmic-spiral phase: arms are loci where theta - k*log(r) = const.
    // log() of a very small r blows up; clamp to keep the center calm.
    float lr = log(max(r, 0.02));
    float armPhase = theta - lr * uArmTwist;

    // Arm density profile — pow() narrows the arms vs the gaps.
    float armBand = 0.5 + 0.5 * cos(armPhase * uArmCount);
    float arms = pow(armBand, 1.7);  // softer power = arms read at more radii

    // Bulge: smooth Gaussian falloff anchored at the center.
    float bulge = exp(-pow(r / uBulgeRadius, 2.0) * 2.5);

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

    // Dust pattern — higher-frequency noise modulated by the arm phase,
    // attenuated near the bulge and near the disc edge. Concentrated
    // along the *inner* edge of each arm where real dust lanes live.
    vec2 dustUV = rot * (p * 14.0) + vec2(armPhase * 1.8, 0.0);
    float dustNoise = fbm(dustUV);
    float armEdge = pow(arms, 0.8) * (0.55 + 0.45 * cos(armPhase * uArmCount - 0.6));
    float dust = smoothstep(0.45, 0.78, dustNoise * armEdge);
    dust *= smoothstep(0.08, 0.25, r);          // no dust through the bulge
    dust *= 1.0 - smoothstep(0.78, 0.95, r);    // no dust at extreme edge

    // ── Compose ──
    // Arm/inter-arm color modulation: arms warmer + brighter, gaps cooler + dimmer.
    vec3 armTint = mix(uArmColor * 0.5, uArmColor * 1.15, arms);
    vec3 baseDisc = armTint * (discEnv + arms * 0.9) * (0.7 + cloud * 0.6) * 2.2;
    vec3 bulgeContribution = uBulgeColor * bulge * 2.4;
    vec3 color = baseDisc + bulgeContribution;

    // Dust occlusion — multiplicative darkening toward uDustColor.
    color = mix(color, color * uDustColor, dust * uDustStrength);

    // Alpha = how much of this disc is present here. Heavier weighting on
    // discEnv + arms + bulge so the diffuse layer reads as the dominant
    // visual rather than a faint tint behind the additive particle field.
    float coverage = discEnv * (0.65 + arms * 0.9) + bulge * 1.4;
    coverage *= (0.5 + cloud * 0.7);
    coverage += dust * 0.55;
    coverage = clamp(coverage, 0.0, 1.0);

    gl_FragColor = vec4(color, coverage * uOpacity);
  }
`;
