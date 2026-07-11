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

/** fBm, ridged multifractal, domain warp + the combined terrain height field.
 *  `terrainHeight(dir)` returns a normalised height in ~[0,1] for a unit-sphere
 *  direction, blending smooth fBm and sharp ridges by uRidged, warped by uWarp. */
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

float terrainHeight(vec3 dir){
  vec3 p = dir * 1.7 + uNoiseSeed;
  // domain warp for organic coastlines
  vec3 w = vec3(fbm(p + 11.3), fbm(p + 47.7), fbm(p + 83.1));
  p += uWarp * w;
  float hills = fbm(p) * 0.5 + 0.5;      // [0,1]
  float mts   = clamp(ridged(p), 0.0, 1.0);
  return mix(hills, mts, uRidged);
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
