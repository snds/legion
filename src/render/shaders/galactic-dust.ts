// ═══════════════════════════════════════════════════════════════════
// GALACTIC DUST — Volumetric Interstellar Absorption
// Separate dust-plane shader matching galactic-disc.ts's dust pattern.
// Renders dark filaments via NormalBlending with the disc's dust color
// (near-black brown), so the dust ACTUALLY OCCLUDES stellar emission
// that's been painted earlier in the render order.
//
// Used to interleave dust planes between the stellar disc layers so
// stars below the dust get dimmed (just like real edge-on galaxy
// photos: NGC 891 / NGC 4565 / M31 all show dark bands silhouetting
// the disc), evening out arm brightness from any viewing angle.
// ═══════════════════════════════════════════════════════════════════

export const galacticDustVertexShader = /* glsl */ `
  varying vec2 vUv;
  uniform float uWarpAmplitude;
  uniform float uWarpInnerR;
  uniform float uWarpAngle;
  void main() {
    vUv = uv;
    vec2 p = uv - 0.5;
    float r = length(p) * 2.0;
    float theta = atan(p.y, p.x);
    vec3 pos = position;
    float amp = max(0.0, r - uWarpInnerR) * uWarpAmplitude;
    pos.z += amp * sin(theta - uWarpAngle);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const galacticDustFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3  uDustColor;
  uniform float uArmTwist;
  uniform float uArmCount;
  uniform float uArmPhaseOffset;
  uniform float uLayerArmShift;
  uniform float uLayerSeed;
  uniform float uDustStrength;
  uniform float uOpacity;
  uniform float uLayerOpacity;

  varying vec2 vUv;

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
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    if (r > 1.0) discard;

    float theta = atan(p.y, p.x);
    float lr = log(max(r, 0.02));
    float armPhase = theta - lr * uArmTwist + uArmPhaseOffset + uLayerArmShift;

    // Dust pattern — match the disc shader's geometry so dust falls on
    // the inner trailing edges of the arms where real density-wave
    // compression concentrates molecular gas + dust.
    float swirl = -lr * 1.4;
    mat2 rot = mat2(cos(swirl), -sin(swirl), sin(swirl), cos(swirl));
    vec2 dustUV = rot * (p * 14.0) + vec2(armPhase * 1.8 + uLayerSeed * 0.9, uLayerSeed * 0.4);
    float dustNoise = fbm(dustUV);
    float dustFine = fbm(p * 36.0 + vec2(uLayerSeed * 1.7, 0.0));

    float armBand = 0.5 + 0.5 * cos(armPhase * uArmCount);
    float arms = pow(armBand, 1.5);
    float armEdge = pow(arms, 0.8) * (0.55 + 0.45 * cos(armPhase * uArmCount - 0.6));

    float dust = smoothstep(0.42, 0.78, dustNoise * armEdge);
    dust *= 0.45 + 0.55 * dustFine;
    dust *= smoothstep(0.08, 0.25, r);          // no dust through bulge
    dust *= 1.0 - smoothstep(0.82, 1.0, r);     // no dust at rim
    // Also add inter-arm patchy dust (not just arm-edges) for the
    // continuous-disc-veil look real galaxies show.
    float interArmDust = smoothstep(0.55, 0.85, dustNoise) * 0.3;
    interArmDust *= smoothstep(0.20, 0.40, r) * (1.0 - smoothstep(0.78, 1.0, r));
    dust = max(dust, interArmDust * 0.6);

    gl_FragColor = vec4(uDustColor, dust * uDustStrength * uOpacity * uLayerOpacity);
  }
`;
