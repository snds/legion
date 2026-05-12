// ═══════════════════════════════════════════════════════════════════
// GALACTIC DISC VOLUME — Single-Pass Ray-Marched Volumetric Disc
// Replaces the 9-disc-plane + 8-dust-plane stack with one BoxGeometry
// + raymarch fragment shader. Each fragment marches the view ray from
// front face to back face of the box, sampling disc emission and dust
// extinction at each step. Front-to-back compositing accumulates the
// integrated color and transmittance.
//
// Why this beats stacked planes:
//   • Real volume — looks correct from any angle, including edge-on
//   • Dust occludes light from BEHIND it through the integration, not
//     just from its own layer
//   • One draw call instead of 17
//   • No layer-pop artifacts at oblique angles
//   • Same procedural pattern (arms, bar, bulge, dust) as before, now
//     evaluated in 3D with a vertical Gaussian density profile
//
// Performance:
//   • 24 march steps per fragment
//   • 3-octave FBM (reduced from 5 in the 2D shader) for noise sampling
//   • Early exit when transmittance < 0.01
//   • Disc covers ~30-60% of screen at galaxy tier, so net cost ~3-5ms
//     on a modest GPU — well within budget
// ═══════════════════════════════════════════════════════════════════

export const galacticDiscVolumeVertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const galacticDiscVolumeFragmentShader = /* glsl */ `
  precision highp float;

  // AABB of the volumetric box in world space.
  uniform vec3 uBoxMin;
  uniform vec3 uBoxMax;
  // Galactic disc geometry parameters (world units).
  uniform float uDiscRadius;     // disc-plane radius (~5000 WU = 15 kpc)
  uniform float uDiscThickness;  // vertical scale-height (~100 WU = 0.3 kpc)
  // Disc-look uniforms (mirrors the 2D shader).
  uniform vec3 uBulgeColor;
  uniform vec3 uArmColor;
  uniform vec3 uDustColor;
  uniform float uBulgeRadius;
  uniform float uArmTwist;
  uniform float uArmCount;
  uniform float uArmPhaseOffset;
  uniform float uBarAngle;
  uniform float uBarLength;
  uniform float uBarWidth;
  uniform float uDustStrength;
  uniform float uOpacity;
  uniform float uExtinction;     // Beer-Lambert extinction coefficient (1/WU)
  // Galactic warp (vertex-like, evaluated in the sampling function).
  uniform float uWarpAmplitude;  // peak Y displacement (WU) at r=1
  uniform float uWarpInnerR;     // normalized r below which warp is 0
  uniform float uWarpAngle;      // line-of-nodes azimuth

  varying vec3 vWorldPos;

  // ── Noise primitives (3 octaves for raymarch perf vs 5 in 2D) ──
  vec2 hash2(vec2 p) {
    return fract(sin(vec2(
      dot(p, vec2(127.1, 311.7)),
      dot(p, vec2(269.5, 183.3))
    )) * 43758.5453);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = dot(hash2(i)                 - 0.5, f);
    float b = dot(hash2(i + vec2(1.0, 0.0)) - 0.5, f - vec2(1.0, 0.0));
    float c = dot(hash2(i + vec2(0.0, 1.0)) - 0.5, f - vec2(0.0, 1.0));
    float d = dot(hash2(i + vec2(1.0, 1.0)) - 0.5, f - vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 0.5 + 0.5;
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * noise2(p);
      p *= 2.07;
      a *= 0.5;
    }
    return v;
  }

  // ── Sample the disc at a 3D point in world space ──
  // Returns vec4(emission_rgb, density). emission already accounts for
  // the position's vertical density profile so the caller doesn't have
  // to re-multiply.
  vec4 sampleDisc(vec3 worldP) {
    vec3 boxCenter = (uBoxMin + uBoxMax) * 0.5;
    vec3 local = worldP - boxCenter;
    // 2D disc plane coords (X, Z) normalized to [-1, 1]
    vec2 pUV = vec2(local.x, local.z) / uDiscRadius;
    float r = length(pUV);
    if (r > 1.0) return vec4(0.0);

    float theta = atan(pUV.y, pUV.x);
    float lr = log(max(r, 0.02));
    float armPhase = theta - lr * uArmTwist + uArmPhaseOffset;

    // Galactic warp — displace the effective Y at this position by a
    // sinusoidal amount past the warp inner radius.
    float warpAmp = max(0.0, r - uWarpInnerR) * uWarpAmplitude;
    float warpY = warpAmp * sin(theta - uWarpAngle);
    float effectiveY = local.y - warpY;

    // Arm density profile (variable sharpness for diffuse outer edges)
    float armBand = 0.5 + 0.5 * cos(armPhase * uArmCount);
    float armSharpness = mix(2.0, 0.7, smoothstep(0.15, 0.85, r));
    float arms = pow(armBand, armSharpness);
    arms *= smoothstep(0.08, 0.26, r);
    arms *= 1.0 - smoothstep(0.82, 1.0, r);
    float principal = 0.5 + 0.5 * cos(armPhase * 2.0);
    arms *= 0.55 + 0.45 * principal;

    // Bulge
    float bulge = exp(-pow(r / uBulgeRadius, 2.0) * 2.5);

    // Bar (elongated ellipse oriented at uBarAngle)
    float cba = cos(uBarAngle), sba = sin(uBarAngle);
    vec2 barCoord = vec2(cba * pUV.x + sba * pUV.y, -sba * pUV.x + cba * pUV.y);
    float bar = exp(
      -pow(barCoord.x / uBarLength, 2.0) * 1.6
      -pow(barCoord.y / uBarWidth,  2.0) * 6.0
    );

    // Radial envelope
    float discEnv = exp(-r * 1.6) * (1.0 - smoothstep(0.88, 1.0, r));

    // Cloud noise (3-octave FBM, rotated by log(r) to spiral with arms)
    float swirl = -lr * 1.4;
    mat2 rot = mat2(cos(swirl), -sin(swirl), sin(swirl), cos(swirl));
    vec2 sUV = rot * (pUV * 6.0);
    float cloud = mix(0.5, fbm(sUV), 0.95);

    // Vertical Gaussian density. The bulge has its own ~spherical
    // profile; arms are thin-disc; bar is mid. Combined here as one
    // exponential drop-off — simple but reads correctly.
    float h = effectiveY / uDiscThickness;
    float verticalDensity = exp(-h * h * 2.0);

    // Density (used for alpha accumulation)
    float density = (discEnv * (0.6 + arms * 0.9) + bulge * 1.4 + bar * 1.7)
                  * verticalDensity * cloud;

    // Color (warm sepia disc + warm gold bulge + warm gold bar)
    vec3 armTint = mix(uArmColor * 0.5, uArmColor * 1.15, arms);
    vec3 baseDisc = armTint * (discEnv + arms * 0.9) * 2.2;
    vec3 bulgeContribution = uBulgeColor * bulge * 2.4;
    vec3 barContribution = uBulgeColor * bar * 2.6;
    vec3 emission = (baseDisc + bulgeContribution + barContribution) * verticalDensity * cloud;

    return vec4(emission, density);
  }

  // ── Sample dust at a 3D point ──
  // Dust is thinner in Y than stars (it concentrates in the midplane).
  float sampleDust(vec3 worldP) {
    vec3 boxCenter = (uBoxMin + uBoxMax) * 0.5;
    vec3 local = worldP - boxCenter;
    vec2 pUV = vec2(local.x, local.z) / uDiscRadius;
    float r = length(pUV);
    if (r > 1.0) return 0.0;

    float theta = atan(pUV.y, pUV.x);
    float lr = log(max(r, 0.02));
    float armPhase = theta - lr * uArmTwist + uArmPhaseOffset;

    // Warp displacement
    float warpAmp = max(0.0, r - uWarpInnerR) * uWarpAmplitude;
    float warpY = warpAmp * sin(theta - uWarpAngle);
    float effectiveY = local.y - warpY;

    // Dust noise pattern (same as 2D shader)
    float swirl = -lr * 1.4;
    mat2 rot = mat2(cos(swirl), -sin(swirl), sin(swirl), cos(swirl));
    vec2 dustUV = rot * (pUV * 14.0) + vec2(armPhase * 1.8, 0.0);
    float dustNoise = fbm(dustUV);
    float dustFine = fbm(pUV * 36.0);

    // Arm-edge concentration
    float armBand = 0.5 + 0.5 * cos(armPhase * uArmCount);
    float arms = pow(armBand, 1.5);
    float armEdge = pow(arms, 0.8) * (0.55 + 0.45 * cos(armPhase * uArmCount - 0.6));

    float dust = smoothstep(0.42, 0.78, dustNoise * armEdge);
    dust *= 0.45 + 0.55 * dustFine;
    dust *= smoothstep(0.08, 0.25, r);
    dust *= 1.0 - smoothstep(0.82, 1.0, r);

    // Dust vertical profile — thinner than stars (concentrated at midplane).
    float h = effectiveY / (uDiscThickness * 0.5);
    float verticalDensity = exp(-h * h * 2.5);

    return dust * verticalDensity;
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorldPos - cameraPosition);

    // Ray-AABB slab intersection
    vec3 invD = 1.0 / rd;
    vec3 t1 = (uBoxMin - ro) * invD;
    vec3 t2 = (uBoxMax - ro) * invD;
    vec3 tMin = min(t1, t2);
    vec3 tMax = max(t1, t2);
    float tNear = max(max(tMin.x, tMin.y), tMin.z);
    float tFar  = min(min(tMax.x, tMax.y), tMax.z);
    if (tNear > tFar || tFar < 0.0) discard;
    tNear = max(tNear, 0.0);

    // March
    const int STEPS = 24;
    float stepSize = (tFar - tNear) / float(STEPS);

    vec3 accumColor = vec3(0.0);
    float transmittance = 1.0;

    for (int i = 0; i < STEPS; i++) {
      float t = tNear + (float(i) + 0.5) * stepSize;
      vec3 p = ro + rd * t;

      vec4 s = sampleDisc(p);
      if (s.a < 0.001) continue;

      float dust = sampleDust(p);
      // Extinction along this step (Beer-Lambert) — stars get extinguished by
      // their own density (self-shielding) plus dust at ~5x weight.
      float sigma_a = (s.a + dust * uDustStrength * 5.0) * uExtinction;
      float deltaT = exp(-sigma_a * stepSize);

      // Emission within this step. With pre-multiplied emission and the
      // (1 - deltaT) factor we get the standard volume-rendering integral
      // without dividing by sigma_a (which avoids div-by-zero in thin regions).
      vec3 stepEmission = s.rgb * (1.0 - deltaT);

      // Tint stars by dust (warm absorption color of interstellar grains)
      stepEmission = mix(stepEmission, stepEmission * uDustColor, dust * uDustStrength * 0.4);

      accumColor += transmittance * stepEmission;
      transmittance *= deltaT;
      if (transmittance < 0.01) break;
    }

    float alpha = (1.0 - transmittance) * uOpacity;
    if (alpha < 0.001) discard;
    gl_FragColor = vec4(accumColor, alpha);
  }
`;
