// ═══════════════════════════════════════════════════════════════════
// GLSL CHUNKS — the noise vocabulary shared by every planet shader
//
// procedural-planet-research.md §2: fBm (continents), ridged multifractal
// (mountains), domain warp (organic coastlines). One canonical 3D simplex noise
// (Ashima / webgl-noise, public domain) underlies all of it, so terrain is a
// pure GPU function of position + a per-body seed offset (uNoiseSeed) — the same
// determinism the CPU side keeps. These are string constants concatenated into
// the ShaderMaterials in shaders.ts (GLSL ES 3.0 / WebGL2).
// ═══════════════════════════════════════════════════════════════════

/** Ashima Arts 3D simplex noise — `snoise(vec3) → [-1,1]`. Public domain. */
export const GLSL_SIMPLEX = /* glsl */ `
vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

/** fBm + ridged multifractal noise — the detail vocabulary. `uNoiseSeed` offsets
 *  the domain per body; `uRidged`/`uWarp` steer the combined terrain field below. */
export const GLSL_FBM = /* glsl */ `
uniform vec3  uNoiseSeed;   // per-body domain offset (determinism)
uniform float uRidged;      // 0 = fBm hills, 1 = ridged mountains
uniform float uWarp;        // domain-warp strength

float fbm(vec3 p){
  float f = 0.0, amp = 0.5, freq = 1.0;
  for (int i = 0; i < 6; i++){
    f += amp * snoise(p * freq);
    freq *= 2.0; amp *= 0.5;
  }
  return f; // ~[-1,1]
}

float ridged(vec3 p){
  float f = 0.0, amp = 0.5, freq = 1.0, prev = 1.0;
  for (int i = 0; i < 6; i++){
    float n = 1.0 - abs(snoise(p * freq));
    n *= n;
    f += n * amp * prev;
    prev = n;
    freq *= 2.0; amp *= 0.5;
  }
  return f; // ~[0,1.x]
}
`;

/** Tectonic-plate MACRO field — the GLSL mirror of plates.ts `macroHeight()`.
 *  MUST stay line-for-line with that CPU reference (the Phase-3 bake caches it).
 *  Only ever called from the VERTEX shader, and only loop-index array access, so
 *  it is safe on GLSL ES 1.0. `MAX_PLATES` must equal plates.ts MAX_PLATES. */
export const GLSL_PLATES = /* glsl */ `
const int MAX_PLATES = 24;
uniform int   uPlateCount;
uniform vec3  uPlateSeed[MAX_PLATES];   // unit plate-centre directions
uniform float uPlateElev[MAX_PLATES];   // per-plate base elevation [0,1]
uniform vec3  uPlateMotion[MAX_PLATES]; // per-plate tangent drift
uniform float uPlateBoundary;           // dot-space boundary half-width
uniform float uPlateUplift;             // convergent-range height gain

float plateMacro(vec3 dir){
  // Nearest two plates by angular proximity (larger dot = closer). Capture each
  // plate's attributes during the scan so we never index by a runtime value.
  float d1 = -1e9, d2 = -1e9;
  vec3  s1 = vec3(0.0), s2 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0);
  float e1 = 0.0, e2 = 0.0;
  for (int i = 0; i < MAX_PLATES; i++){
    if (i >= uPlateCount) break;
    vec3 s = uPlateSeed[i];
    float dp = dot(dir, s);
    if (dp > d1){
      d2 = d1; s2 = s1; m2 = m1; e2 = e1;
      d1 = dp; s1 = s;  m1 = uPlateMotion[i]; e1 = uPlateElev[i];
    } else if (dp > d2){
      d2 = dp; s2 = s;  m2 = uPlateMotion[i]; e2 = uPlateElev[i];
    }
  }
  // Blend base elevation across the boundary (smooth coast, not a cliff).
  float t = smoothstep(0.0, uPlateBoundary, d1 - d2);
  float h = mix(e2, e1, t);
  // Convergent boundaries push up ranges; divergent ones rift down.
  vec3 axis = normalize(s2 - s1);
  float conv = dot(m1, axis) - dot(m2, axis);
  float band = 1.0 - t;                 // 1 at boundary → 0 inside a plate
  h += band * conv * uPlateUplift;
  return clamp(h, 0.0, 1.0);
}
`;

/** Combined terrain height: plate MACRO (continents + ranges) roughened by fBm/
 *  ridged DETAIL, with the plate lookup domain-warped so cells read as coastlines
 *  rather than polygons. Returns a normalised height in [0,1] for a unit dir.
 *  Requires GLSL_FBM (fbm/ridged/uNoiseSeed/uRidged/uWarp) + GLSL_PLATES. */
export const GLSL_TERRAIN = /* glsl */ `
float terrainHeight(vec3 dir){
  vec3 p = dir * 1.7 + uNoiseSeed;
  vec3 w = vec3(fbm(p + 11.3), fbm(p + 47.7), fbm(p + 83.1));
  // Warp the plate lookup direction → organic, non-polygonal coastlines.
  vec3 wdir = normalize(dir + uWarp * 0.12 * w);
  float macro = plateMacro(wdir);
  // Mid/high-frequency detail, also domain-warped, centred so it roughens the
  // macro relief without shifting its mean (keeps sea level meaningful).
  vec3 dp = p + uWarp * w;
  float hills = fbm(dp) * 0.5 + 0.5;
  float mts   = clamp(ridged(dp), 0.0, 1.0);
  float detail = mix(hills, mts, uRidged);
  return clamp(macro + (detail - 0.5) * 0.35, 0.0, 1.0);
}
`;

/** Colour-ramp helper: sample a piecewise-linear altitude ramp packed as
 *  parallel arrays (uRampAt[i], uRampColor[i]) with uRampCount stops. */
export const GLSL_RAMP = /* glsl */ `
const int MAX_STOPS = 6;
uniform int   uRampCount;
uniform float uRampAt[MAX_STOPS];
uniform vec3  uRampColor[MAX_STOPS];

vec3 sampleRamp(float h){
  if (uRampCount <= 0) return vec3(0.5);
  if (h <= uRampAt[0]) return uRampColor[0];
  for (int i = 1; i < MAX_STOPS; i++){
    if (i >= uRampCount) break;
    if (h <= uRampAt[i]){
      float t = (h - uRampAt[i-1]) / max(1e-4, uRampAt[i] - uRampAt[i-1]);
      return mix(uRampColor[i-1], uRampColor[i], clamp(t, 0.0, 1.0));
    }
  }
  return uRampColor[uRampCount - 1];
}
`;
