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

/** Tectonic MACRO field — the GLSL mirror of plates.ts `macroHeight()`. Two
 *  layers: a CONTINENT field (few big landmasses) and PLATE boundaries (many
 *  cells whose edges make ranges/rifts). MUST stay in step with the CPU reference
 *  (the Phase-3 bake caches it). Only loop-index array access, so it is safe in
 *  both vertex and fragment shaders. MAX_* must equal plates.ts. */
export const GLSL_PLATES = /* glsl */ `
const int MAX_PLATES = 48;
const int MAX_CONTINENTS = 8;
uniform int   uContCount;
uniform vec3  uContSeed[MAX_CONTINENTS];  // unit continent-centre directions
uniform float uContSize[MAX_CONTINENTS];  // per-continent cap radius (radians)
uniform int   uPlateCount;
uniform vec3  uPlateSeed[MAX_PLATES];      // unit plate-centre directions
uniform vec3  uPlateMotion[MAX_PLATES];    // per-plate tangent drift
uniform float uPlateUplift;                // convergent-range height gain
uniform float uRangeWidth;                 // inland spread of ranges (dot-space)
uniform float uCoastAmp;                    // coastline-fracture amplitude (radians)
uniform float uCoastFreq;                   // coastline-fracture frequency (bay scale)
uniform float uRangeVar;                    // along-boundary uplift variation (broken peaks)

const float OCEAN_FLOOR = 0.20;
const float LAND_HEIGHT  = 0.68;

// Shared coastline value-noise — MUST match coastFbm() in plates.ts (CPU) so a
// baked coast and a live coast agree. uint hashing mirrors the CPU Math.imul/>>>
// exactly (integer-identical; only the final float division differs by float32
// rounding, <<1 texel). A MACRO term — a function of direction, continuous across
// cube faces — so it decides WHERE the shoreline is, shared by both paths.
float uhashf(int X, int Y, int Z){
  uint h = uint(X)*374761393u + uint(Y)*668265263u + uint(Z)*1274126177u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return float(h) / 4294967295.0;
}
float coastNoise(vec3 p){
  vec3 i = floor(p), f = p - i;
  vec3 u = f * f * (3.0 - 2.0 * f);
  ivec3 b = ivec3(i);
  float c000 = uhashf(b.x,   b.y,   b.z),   c100 = uhashf(b.x+1, b.y,   b.z);
  float c010 = uhashf(b.x,   b.y+1, b.z),   c110 = uhashf(b.x+1, b.y+1, b.z);
  float c001 = uhashf(b.x,   b.y,   b.z+1), c101 = uhashf(b.x+1, b.y,   b.z+1);
  float c011 = uhashf(b.x,   b.y+1, b.z+1), c111 = uhashf(b.x+1, b.y+1, b.z+1);
  return mix(mix(mix(c000,c100,u.x), mix(c010,c110,u.x), u.y),
             mix(mix(c001,c101,u.x), mix(c011,c111,u.x), u.y), u.z);
}
float coastFbm(vec3 dir, float freq){
  float f = 0.0, amp = 0.5, fr = freq;
  for (int i = 0; i < 4; i++){
    f += amp * coastNoise(vec3(dir.x*fr + 19.1, dir.y*fr + 47.7, dir.z*fr + 83.3));
    fr *= 2.0; amp *= 0.5;
  }
  return f - 0.47; // roughly zero-centred (fBm sum mean ≈ 0.47)
}

float plateMacro(vec3 dir){
  // NB: dir arrives already domain-warped by terrainHeight (live) — the warp is
  // isotropic simplex there. The bake path currently samples this unwarped (the
  // known baked/unbaked parity gap; the fix is a CPU simplex port, not the
  // anisotropic value-noise warp that reintroduced faceted plate creases).
  // ── continents: base land/ocean shape ──
  // The cap edge is FRACTURED by the shared coast noise so the shoreline is a
  // fractal iso-contour (bays/peninsulas/near-shore islands), not a smooth disc
  // that warp only wobbles — the "glob" failure mode (ledger P-01/P-02/P-03).
  float cn = coastFbm(dir, uCoastFreq) * uCoastAmp; // radians the coast meanders
  float base = OCEAN_FLOOR;
  for (int i = 0; i < MAX_CONTINENTS; i++){
    if (i >= uContCount) break;
    float d = acos(clamp(dot(dir, uContSeed[i]), -1.0, 1.0));
    float land = smoothstep(uContSize[i], uContSize[i] * 0.5, d + cn); // fractal shoreline
    base = max(base, OCEAN_FLOOR + (LAND_HEIGHT - OCEAN_FLOOR) * land);
  }
  // ── plates: nearest two → boundary landform (range / rift) ──
  float d1 = -1e9, d2 = -1e9;
  vec3  s1 = vec3(0.0), s2 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0);
  for (int i = 0; i < MAX_PLATES; i++){
    if (i >= uPlateCount) break;
    vec3 s = uPlateSeed[i];
    float dp = dot(dir, s);
    if (dp > d1){ d2 = d1; s2 = s1; m2 = m1; d1 = dp; s1 = s; m1 = uPlateMotion[i]; }
    else if (dp > d2){ d2 = dp; s2 = s; m2 = uPlateMotion[i]; }
  }
  float range = exp(-(d1 - d2) / uRangeWidth);   // 1 at boundary → 0 inland
  vec3 axis = normalize(s2 - s1);
  float conv = dot(m1, axis) - dot(m2, axis);     // >0 converging
  // P-04: vary uplift ALONG the boundary so ranges break into peaks / rise-fall
  // along their length, not a uniform wall. Mean-preserving (rv ≈ 1 average).
  float rv = clamp(1.0 + uRangeVar * (2.0 * coastFbm(dir, 5.5)), 0.1, 2.0);
  base += range * conv * uPlateUplift * (conv > 0.0 ? 1.0 : 0.5) * rv;
  return clamp(base, 0.0, 1.0);
}
`;

/** Combined terrain height: tectonic MACRO (continents + ranges) roughened by
 *  fBm/ridged DETAIL, with the macro lookup HEAVILY domain-warped (multi-scale)
 *  so continent/plate edges dissolve into organic coastlines rather than cells.
 *  Returns a normalised height in [0,1]. Requires GLSL_FBM + GLSL_PLATES. */
export const GLSL_TERRAIN = /* glsl */ `
uniform float uDetailScale;   // detail-noise frequency multiplier (fine vs lumpy)
uniform float uCraters;       // impact-crater coverage 0..1 (0 = off) — Mercury/Mars ephemera
uniform float uCraterFreq;    // crater cell density (also sets size scale)
uniform float uCraterDepth;   // bowl depth / rim height

// Dave Hoskins hashes (cheap, decorrelated) for crater cell placement.
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3  hash33(vec3 p3){ p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }

// Overlapping impact craters: a jittered cell grid on the sphere shell. Each cell
// may host a crater (hash gate → coverage), its centre jittered (no lattice), its
// radius randomised (size variety). Profile = parabolic BOWL (down) + thin gaussian
// RIM (up) + soft ejecta fade — reads as impacts, not bumps. Contributions SUM, so
// craters overlap and deepen where they cross (basins-in-basins).
float craterField(vec3 dir){
  if (uCraters <= 0.0) return 0.0;
  vec3 ip = floor(dir * uCraterFreq);
  float h = 0.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++){
    vec3 cell = ip + vec3(float(x), float(y), float(z));
    if (hash13(cell + 3.7) > uCraters) continue;            // sparsity ← coverage
    vec3 j = hash33(cell + 1.9);
    vec3 c = normalize(cell + (j - 0.5) * 1.6);              // jittered centre on the shell
    float sizeF = mix(0.35, 1.9, j.x);                       // crater size factor (~1)
    float rad = sizeF / uCraterFreq;                        // varied angular radius
    float t = acos(clamp(dot(dir, c), -1.0, 1.0)) / rad;    // 0 centre → 1 rim
    if (t > 1.7) continue;
    // Mercury/Mars profile: a FLAT depressed floor that walls up to a SHARP raised
    // rim, then ejecta fades out — reads as a crisp impact, not a soft dimple.
    float floor = -(1.0 - smoothstep(0.55, 1.0, t));        // flat floor → 0 at rim
    float rim   = exp(-pow((t - 1.0) * 4.5, 2.0));          // sharp rim ring at t=1
    // depth scales with the crater's SIZE FACTOR (~1), not the tiny angular radius
    // (radians) — scaling by rad shrank craters ~10x below the terrain relief.
    h += (0.95 * floor + 0.6 * rim) * sizeF * smoothstep(1.7, 1.02, t);
  }
  return h * uCraterDepth;
}

float terrainHeight(vec3 dir){
  vec3 p = dir * 1.7 + uNoiseSeed;
  // Isotropic simplex domain warp (a broad bend + a finer crenellation) so
  // continent/plate edges dissolve into organic coastlines rather than straight
  // Voronoi cells. (Sharing THIS warp with the CPU bake for baked/unbaked parity
  // needs a CPU simplex port — a follow-up; value noise here is anisotropic.)
  vec3 wLo = vec3(fbm(p * 0.6 + 11.3), fbm(p * 0.6 + 47.7), fbm(p * 0.6 + 83.1));
  vec3 wHi = vec3(fbm(p * 2.3 + 5.1), fbm(p * 2.3 + 27.9), fbm(p * 2.3 + 61.4));
  vec3 wdir = normalize(dir + uWarp * (0.55 * wLo + 0.18 * wHi));
  float macro = plateMacro(wdir);
  // Detail sampled at a HIGHER base frequency (uDetailScale) so relief is fine and
  // planet-scale, not lumpy; centred so it roughens without shifting the mean
  // (keeps sea level meaningful). Ridged near ranges = rugged peaks; fBm elsewhere.
  vec3 dp = (p + uWarp * wLo) * uDetailScale;
  float hills = fbm(dp) * 0.5 + 0.5;
  float mts   = clamp(ridged(dp), 0.0, 1.0);
  float detail = mix(hills, mts, uRidged);
  float relief = mix(0.16, 0.32, smoothstep(0.55, 0.85, macro)); // rougher up high
  return clamp(macro + (detail - 0.5) * relief + craterField(dir), 0.0, 1.0);
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
