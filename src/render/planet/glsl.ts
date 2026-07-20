// ═══════════════════════════════════════════════════════════════════
// GLSL CHUNKS — the noise vocabulary shared by every planet shader
//
// ⚠ NEVER put a backtick in a comment below this line. Every chunk in this file
//   lives inside a TypeScript template literal, so a stray backtick — even in
//   GLSL comment prose, e.g. quoting an identifier — terminates the string and
//   produces a baffling TS1005 parse error dozens of lines away. This has cost
//   real debugging time four separate times (2026-07-14, -15, -19 x2). Quote
//   identifiers as plain words instead.
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

// Dave Hoskins hashes (cheap, decorrelated) — crater cells, cyclone seeds, etc.
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3  hash33(vec3 p3){ p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
`;

/** Cloud coverage field — ONE source shared by the cloud-shell material and the
 *  surface shader's self-shadow sampling, so the shadow on the ground always
 *  matches the cloud overhead. A LIVING circulation, not a static deck: zonal
 *  wind bands advect by latitude, seeded cyclones spin (hemisphere-correct
 *  Coriolis), a time-morphing warp shears the field, and the REAL macro terrain
 *  couples in (wet/dry climate belts breed or starve cloud; high ranges impede
 *  the deck). Requires GLSL_FBM and GLSL_PLATES (plateMacro) — include BOTH
 *  before this chunk. */
export const GLSL_CLOUDS = /* glsl */ `
uniform float uCloudCover;    // 0..1 sky coverage (0 = clear)
uniform float uCloudTime;     // raw clock (seconds) — scaled by uCloudSpeed below
uniform float uCloudSpeed;    // weather-clock scale (default near-imperceptible)
uniform float uCloudFlow;     // zonal circulation strength (trade winds / jets)
uniform float uCloudTurb;     // evolving shear / morph turbulence
uniform float uCloudTerrain;  // terrain/climate coupling (orographic + wet-dry)
uniform float uCloudDetail;   // formation scale: >1 = smaller systems + finer billow texture
uniform float uCloudWisp;     // shear-thinning: stretched cloud evaporates into wisps
uniform float uCloudRegion;   // synoptic regionality: whole regions clear or fill
uniform float uCycSize;       // storm angular radius (radians)
uniform vec3  uCycPos[3];     // storm centres (object space) — CPU-placed, ocean-gated
uniform float uCycStr[3];     // signed storm strength (sign = hemisphere spin; 0 = dormant)

vec3 rotY(vec3 d, float a){ float c = cos(a), s = sin(a); return vec3(c*d.x + s*d.z, d.y, -s*d.x + c*d.z); }
float fbm2(vec3 p){ return snoise(p) * 0.6 + snoise(p * 2.3) * 0.3; } // cheap 2-octave

float cloudDensity(vec3 d0){
  if (uCloudCover <= 0.0) return 0.0;
  float lat = d0.y; // sin(latitude)
  float T = uCloudTime * uCloudSpeed; // ONE weather clock for deck + storms + regions

  // ── Cyclones: CPU-placed vortices (globe.ts spawns them over OPEN WATER via the
  // exact macroHeight land test, decays them on landfall, and respawns spent ones)
  // — the shader only applies the spin. The twist runs in OBJECT space (d0) so the
  // visible eye sits exactly where the CPU gated it; the advected deck then flows
  // THROUGH the vortex. \`stretch\` accumulates how hard each sample was sheared by
  // storm arms — the wisp pass below thins stretched cloud instead of letting it
  // smear into pulled pixels.
  vec3 dv = d0;
  float stretch = 0.0;
  float storm = 0.0;
  float csize = max(uCycSize, 0.01);
  for (int i = 0; i < 3; i++){
    float str = uCycStr[i];
    if (str == 0.0) continue;
    vec3 cc = uCycPos[i];
    float ang = acos(clamp(dot(dv, cc), -1.0, 1.0)) / csize;      // 0 eye → 1 wall
    float w = exp(-ang * ang);                                    // vortex influence
    float spin = str * 5.0 * w;                                   // sign = Coriolis handedness
    float cs = cos(spin), sn = sin(spin);
    dv = dv * cs + cross(cc, dv) * sn + cc * dot(cc, dv) * (1.0 - cs); // Rodrigues twist
    stretch += abs(spin) * smoothstep(0.25, 1.1, ang);            // arms shear; the eye doesn't
    storm += w;
  }

  // ── Zonal circulation: a uniform deck drift plus a BOUNDED, slowly-reversing
  // differential shear (trades / jets). Bounded oscillation, not accumulation —
  // unbounded latitude-differential rotation smears the deck into ribbons (P-06).
  float zonal = 0.6 * cos(lat * 4.712) + 0.15 * cos(lat * 12.566);
  float tphase = T * 0.02; // uCloudSpeed=1 ≈ the old rate; the 0.12 default is ~8x slower
  float adv = 0.35 * tphase + 0.35 * zonal * sin(tphase * 0.22);
  vec3 d = rotY(dv, uCloudFlow * adv);

  // ── Evolving turbulence: a time-morphing warp — formations grow, shear and
  // decay instead of sliding around as a frozen pattern. uCloudDetail scales the
  // whole spectrum (smaller formations, finer billows). The morph warp displaces
  // in p-SPACE, so its distortion stays proportional to feature size at any
  // detail setting.
  float det = max(uCloudDetail, 0.25);
  vec3 p = d * 3.2 * det + uNoiseSeed * 0.31;
  if (uCloudTurb > 0.0){
    float tt = T * 0.02;
    p += uCloudTurb * 0.55 * vec3(fbm2(d * 1.6 + vec3(tt, 7.0, 0.0)),
                                  fbm2(d * 1.6 + vec3(0.0, tt + 23.0, 5.0)),
                                  fbm2(d * 1.6 + vec3(11.0, 0.0, tt + 41.0)));
  }
  float f = fbm(p) * 0.5 + 0.5;                        // broad weather systems
  f += 0.4  * (fbm(p * 3.6 + 17.3) * 0.5 + 0.5);       // billow detail
  f += 0.22 * (fbm(p * 8.8 + 31.7) * 0.5 + 0.5);       // fine cauliflower texture
  f /= 1.62;

  // ── Terrain / climate coupling: the wet equator and mid-latitude belts breed
  // cloud and the dry subtropics clear it (the SAME belts as the surface biomes);
  // high ranges impede the deck / poke above it (orographic clearing).
  if (uCloudTerrain > 0.0){
    float al = abs(lat);
    float latB = 1.0 - 0.7 * smoothstep(0.22, 0.42, al) * (1.0 - smoothstep(0.5, 0.72, al));
    float macroH = plateMacro(d0);
    f += uCloudTerrain * 0.16 * (latB - 0.5);
    f -= uCloudTerrain * 0.35 * smoothstep(0.72, 0.92, macroH);
  }

  // ── Synoptic regionality: an ultra-low-frequency moisture field pushes whole
  // regions to fully CLEAR sky or dense overcast (weather is not uniform) — the
  // regions drift/morph on the slow weather clock, so cover comes and goes.
  if (uCloudRegion > 0.0){
    float rg = fbm(d0 * 1.15 + uNoiseSeed * 0.53 + vec3(T * 0.008, 0.0, -T * 0.005));
    f += uCloudRegion * 0.5 * rg;
  }
  f += 0.3 * clamp(storm, 0.0, 1.0);                   // a storm IS dense cloud

  // ── Wisp pass: cloud that the storm arms stretched hard gets thinner and
  // shredded by fine noise — spiral extremes evaporate into translucent wisps
  // (widening the upper smoothstep edge caps their alpha) instead of stretching
  // like pulled pixels.
  float ws = clamp(stretch * 0.5, 0.0, 1.0) * uCloudWisp;
  if (ws > 0.0) f -= ws * (0.08 + 0.14 * (snoise(d * 14.0 + uNoiseSeed) * 0.5 + 0.5));

  float c0 = 1.0 - uCloudCover * 0.85;                 // coverage remap
  return smoothstep(c0 - 0.12, c0 + 0.18 + 0.4 * ws, f);
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
uniform float uCanyons;       // rift-canyon coverage 0..1 (0 = off) — Valles Marineris ephemera
uniform float uCanyonFreq;    // rift-system scale (higher = more, smaller systems)
uniform float uCanyonDepth;   // trough depth
uniform float uSeaLevel;      // waterline (shared: flat-ocean vertex + bathymetry + ice shelf)
uniform float uLatitudeIce;   // polar-cap EXTENT — drives the cap MASS below + its colour

// Polar cap coverage 0..1 for a direction — ONE source for both the ice MASS in
// terrainHeight and the ice COLOUR in the fragment, so they can never disagree.
// The edge is noise-broken (jagged shelf margin, not a ruled latitude circle).
// Ice-sheet coverage 0..1. The margin is deliberately UNEVEN: a single octave
// of edge noise only wobbles a circle, which is what made the caps read as even
// discs. Real ice sheets are asymmetric for three physical reasons, all cheap:
//
//  · MULTI-SCALE MARGIN — continental lobes, bays between them, and fine
//    crenellation. Ice sheets have structure at every scale, not one.
//  · ALTITUDE — highlands hold ice far equatorward of the plains around them.
//    This is the strongest asymmetry after latitude: it is why Greenland's
//    interior is ice while its coast is not, and why equatorial mountains carry
//    glaciers at all.
//  · CURRENT ASYMMETRY — warm water keeps one flank ice-free far poleward while
//    the opposite flank freezes much further equatorward. Norway and Labrador
//    sit at the same latitude and look nothing alike.
//
// The h argument is the pre-cap surface height, so the altitude term reads the
// ground the ice is actually sitting on.
float iceCap(vec3 dir, float h){
  if (uLatitudeIce <= 0.0) return 0.0;
  float al = abs(dir.y);
  float lobes = fbm(dir * 1.6 + uNoiseSeed * 0.4) * 0.15;   // continental lobes
  float bays  = fbm(dir * 5.0 + uNoiseSeed) * 0.07;         // bays / outlet gaps
  float fine  = snoise(dir * 15.0 + uNoiseSeed * 2.3) * 0.022;
  float alt   = 0.30 * clamp((h - uSeaLevel) * 1.6, 0.0, 1.0);
  float current = 0.055 * sin(atan(dir.z, dir.x) + uNoiseSeed.x * 2.0)
                * smoothstep(0.25, 0.75, al);                // only bites at depth
  float line = 1.0 - uLatitudeIce * 0.55;
  return smoothstep(0.0, 0.12, al + lobes + bays + fine + alt + current - line);
}


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
    // WINDOW INVARIANT (load-bearing): the loop above scans only the 3x3x3
    // neighbourhood, so every crater's FULL reach must fit inside it — centres
    // stay INSIDE their own cell (jitter < 0.5) and max influence stays under
    // one cell width: 1.7 * sizeF_max = 1.7 * 0.58 < 1.0. The old constants
    // (jitter 0.8 outside the cell, sizeF up to 1.9 → reach ~3.2 cells) let big
    // craters get CHOPPED along straight cell planes wherever the window ended
    // — blocky rectangular separations, worst at low density / in bathymetry
    // (field report, 2026-07-16).
    vec3 c = normalize(cell + (j - 0.5) * 0.98);             // jittered centre, in-cell
    float sizeF = mix(0.25, 0.58, j.x);                      // size factor (see invariant)
    float rad = sizeF / uCraterFreq;                        // varied angular radius
    float t = acos(clamp(dot(dir, c), -1.0, 1.0)) / rad;    // 0 centre → 1 rim
    if (t > 1.7) continue;
    // Mercury/Mars profile: a FLAT depressed floor that walls up to a SHARP raised
    // rim, then ejecta fades out — reads as a crisp impact, not a soft dimple.
    float floor = -(1.0 - smoothstep(0.55, 1.0, t));        // flat floor → 0 at rim
    float rim   = exp(-pow((t - 1.0) * 4.5, 2.0));          // sharp rim ring at t=1
    // depth scales with the crater's SIZE FACTOR, not the tiny angular radius
    // (radians) — scaling by rad shrank craters ~10x below the terrain relief.
    // The 2.4 renormalises the smaller sizeF range back to the old depth scale.
    h += (0.95 * floor + 0.6 * rim) * (sizeF * 2.4) * smoothstep(1.7, 1.02, t);
  }
  return h * uCraterDepth;
}

// Rift canyons (Valles Marineris / Venusian chasmata): carve along ISO-CONTOURS
// of a low-frequency fbm. A contour of a smooth field is a naturally LONG,
// sinuous curve — never a straight great-circle groove (the geometric-trench
// failure mode). A second mask noise breaks the contour's closed loops into
// sparse arcs (an un-masked iso-contour is a perfect ring — the visible tell),
// and a third varies depth along the rift so it reads as rifting/erosion, not
// a uniform extruded path. Profile: flat floor walled by steep sides.
float canyonField(vec3 dir){
  if (uCanyons <= 0.0) return 0.0;
  vec3 p = dir * uCanyonFreq + uNoiseSeed * 1.7;
  // The contour field must be SMOOTH (2 octaves, low-frequency): a full 6-octave
  // fbm crosses the iso band constantly at fine scales, shattering the "canyon"
  // into fractal cliff-speckle everywhere (caught in review). Meander comes from
  // the low octaves; the iso level sits near the field MEAN, where contours of a
  // random field are at their longest (percolation), not closed rings.
  float n = snoise(p) + 0.35 * snoise(p * 2.6 + 17.0);
  float band = abs(n - 0.08);                         // distance to the rift contour
  float w = 0.05;                                     // trough half-width (field units)
  if (band > w) return 0.0;                           // early-out: skip the mask fbm off-rift
  // Sparsity mask: breaks the contour's closed loops into arcs. The 0.75 factor
  // caps the pass-band so breakage survives even at coverage 1.0 — un-broken
  // loops read as perfect rings (verified live at max settings).
  float mask = smoothstep(1.0 - uCanyons * 0.75, 1.12 - uCanyons * 0.75,
                          fbm(p * 0.55 + 31.7) * 0.5 + 0.5);
  if (mask <= 0.001) return 0.0;
  float carve = 1.0 - smoothstep(w * 0.35, w, band);  // flat floor -> steep walls
  float dv = 0.55 + 0.9 * (fbm(p * 1.3 + 53.1) * 0.5 + 0.5); // depth varies along-rift
  return -carve * mask * dv * uCanyonDepth;
}

// Surface EPHEMERA + polar cap mass over any BASE height — analytic macro+detail
// OR the baked erosion master. ONE code path finishes both, so toggling the bake
// can never add/remove craters, canyons, or the ice shelf (the old parity gap:
// the atlas REPLACED terrainHeight, silently erasing every ephemeral feature).
float finishHeight(float base, vec3 dir){
  float h = base + craterField(dir) + canyonField(dir);
  // Polar ice-cap MASS: beyond the (noise-broken) cap line the surface rises to a
  // solid shelf plateau above sea level — frozen ocean kilometres deep forming a
  // land-like mass, not just a white tint. Land under the cap keeps its relief.
  // Pass the PRE-cap height so the altitude term reads the ground the ice is
  // sitting on, not the plateau the cap is about to create.
  float cap = iceCap(dir, h);
  if (cap > 0.0) h = mix(h, max(h, uSeaLevel + 0.14), cap);
  return clamp(h, 0.0, 1.0);
}

// ═══ CLIMATE — a moisture FIELD, not a global dial ═══════════════════
// Five independent physical drivers, each separately tunable, so a world can be
// broadly lush with believable dry regions (Earth) rather than uniformly one or
// the other. Structured as base + SIGNED contributions, never a product chain:
// five multiplied sub-1 factors collapse moisture to ~0 everywhere and the whole
// planet goes drab (the obvious trap when stacking climate terms).
//
//  · uMoisture      base humidity — what the world is on average
//  · uAridBelts     Hadley circulation: wet equator (ITCZ), DRY subtropics near
//                   25-30 deg (every major desert on Earth), wet mid-latitudes
//  · uRainShadow    orographic: ranges UPWIND wring the air out, leaving a dry
//                   lee (Atacama, Gobi, Great Basin). Prevailing wind is zonal
//                   and reverses by cell (trades -> westerlies -> polar
//                   easterlies), tiltable with uWindBearing
//  · uContinental   maritime vs continental: coasts stay wet, deep interiors dry
//  · uAltitudeDry   highlands dry + cold with elevation (treeline)
//  · uPatchiness    mesoscale variation so regions differ within a belt
uniform float uMoisture;
uniform float uAridBelts;
uniform float uRainShadow;
uniform float uOrographic;    // WINDWARD wetting — forests climb the wet flank
uniform float uWindBearing;   // radians; tilts the zonal wind meridionally
uniform float uContinental;
uniform float uAltitudeDry;
uniform float uPatchiness;
uniform float uLapseRate;     // altitude cooling — sets the montane forest belt
uniform float uTreeline;      // temperature below which trees give out (bare/alpine)
uniform float uSnowfall;      // snow-cover extent (albedo overlay, no mass)

// Prevailing surface wind (unit tangent) at a direction — the three-cell model.
// Wide blend bands: a hard reversal latitude leaves a straight vegetation seam.
vec3 prevailingWind(vec3 dir){
  vec3 up = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 east = normalize(cross(up, dir));
  vec3 north = cross(dir, east);
  float al = abs(dir.y);
  float flow = mix(-1.0, 1.0, smoothstep(0.36, 0.62, al));  // trades -> westerlies
  flow = mix(flow, -1.0, smoothstep(0.76, 0.94, al));       // -> polar easterlies
  vec3 w = east * flow;
  return normalize(w + north * sin(uWindBearing) * sign(dir.y + 1e-6));
}

// Moisture 0..1 at a surface point. hh is normalised land altitude (0 at the
// waterline, 1 at peaks); wdir is the SAME warped direction the terrain used.
float climateMoisture(vec3 dir, vec3 wdir, float hh){
  float m = uMoisture;

  // ── circulation: ITCZ wet, subtropical dry belts, mid-latitude wet, polar dry
  float al = abs(dir.y);
  float dryBelt = smoothstep(0.25, 0.44, al) * (1.0 - smoothstep(0.48, 0.68, al));
  float itcz    = 1.0 - smoothstep(0.0, 0.26, al);
  // Polar drying starts LATE and stays mild: the Arctic is a cold desert by
  // precipitation, but it is not bare — it is tundra, wet enough at the surface
  // (permafrost holds meltwater) to carry moss, sedge and dwarf shrub. Starting
  // this at 0.72 with a heavy weight pushed 46 deg+ toward the arid axis.
  float polar   = smoothstep(0.84, 1.0, al);
  // Weights are calibrated so a default world reads MOSTLY VEGETATED with dry
  // regions where the drivers stack (subtropical belt + deep interior + lee of a
  // range = desert), rather than arid-by-default: any single driver at full
  // strength should shift a biome one step, not strip the planet.
  m += uAridBelts * (0.30 * itcz - 0.55 * dryBelt - 0.16 * polar);

  // Both terrain-driven drivers below need the macro height HERE — sample once.
  // (Each plateMacro call walks the plate/continent seed loops, so the whole
  // climate block is budgeted at <=8 of them, and each driver early-outs at 0.)
  if (uRainShadow > 0.0 || uContinental > 0.0){
    float here = plateMacro(wdir);

    // ── orographic: BOTH halves of the mountain effect. March upwind for the
    // tallest barrier the air had to climb (its lee is dry — Atacama/Gobi), and
    // sample downwind to detect a WINDWARD slope (air forced up a range ahead
    // rains out on the way — the wet flank where temperate rainforest and
    // montane conifer belts actually live). Sampling in WARPED space keeps both
    // locked to the ranges as drawn. Macro field only: rain shadows are cast by
    // cordilleras, not by hills.
    if (uRainShadow > 0.0 || uOrographic > 0.0){
      vec3 wind = prevailingWind(dir);
      if (uRainShadow > 0.0){
        float barrier = here;
        for (int i = 1; i <= 3; i++){
          vec3 s = normalize(wdir - wind * (float(i) * 0.045)); // upwind = against the flow
          barrier = max(barrier, plateMacro(s));
        }
        m -= uRainShadow * smoothstep(0.02, 0.22, barrier - here);
      }
      if (uOrographic > 0.0){
        float ahead = max(plateMacro(normalize(wdir + wind * 0.045)),
                          plateMacro(normalize(wdir + wind * 0.09)));
        m += uOrographic * smoothstep(0.015, 0.16, ahead - here);
      }
    }

    // ── continentality: how much LAND surrounds this point — a coast draws
    // maritime moisture, a deep interior starves. Cheap ring test vs sea level.
    if (uContinental > 0.0){
      vec3 up = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 t = normalize(cross(up, wdir));
      vec3 b = cross(wdir, t);
      float land = 0.0;
      for (int i = 0; i < 4; i++){
        float a = float(i) * 1.5708;
        vec3 s = normalize(wdir + (t * cos(a) + b * sin(a)) * 0.10);
        // SMOOTHSTEP, never step(): a hard land/sea test quantises this sum into
        // 5 discrete levels, and each level boundary draws a hard-edged colour
        // seam straight across the interior (field report, 2026-07-19). The soft
        // band also reads better physically — a shoreline is a gradient of
        // maritime influence, not a switch.
        land += smoothstep(uSeaLevel - 0.06, uSeaLevel + 0.06, plateMacro(s));
      }
      m -= uContinental * 0.40 * (land * 0.25);   // 0 (island) .. 1 (deep interior)
    }
  }

  // ── altitude: thinner, colder air holds less water; hard cut above treeline
  m -= uAltitudeDry * (0.35 * hh + 0.75 * smoothstep(0.45, 0.85, hh));

  // ── mesoscale patchiness so a belt is never uniform
  m += uPatchiness * 0.55 * fbm(dir * 2.6 + uNoiseSeed * 0.13);

  return clamp(m, 0.0, 1.0);
}

// Surface TEMPERATURE 0..1 (1 = hot equatorial lowland, 0 = polar or high
// alpine). Two terms, exactly as on Earth: insolation falls off toward the
// poles, and the environmental LAPSE RATE cools with altitude — which is why a
// tropical mountain wears the same conifer-then-bare belts as a boreal lowland.
// This is the second Whittaker axis; moisture is the first.
float climateTemp(vec3 dir, float hh){
  // Fitted to Earth's mean annual temperature by latitude, normalised so 1 =
  // equatorial (~26 C) and 0 = polar (~-25 C):
  //     0deg 1.00 | 30deg 0.88 | 45deg 0.73 | 60deg 0.49 | 75deg 0.25 | 90deg 0.05
  // The old curve was a smoothstep straight over sin(latitude), which put 30 deg
  // at 0.5 and 58 deg at 0.05 — so vegetation cover collapsed and the bare ramp showed
  // through as tan. That is why high latitudes read as DESERT rather than the
  // taiga/tundra that actually lives there (field report, 2026-07-19).
  // Earth's gradient is flat through the tropics and steepens past ~45 deg;
  // a cubic in sin(lat) tracks that far better than a smoothstep.
  float al = abs(dir.y);
  float t = 1.0 - 0.95 * al * al * al;
  t -= uLapseRate * hh;                                 // altitude cooling
  t += 0.06 * fbm(dir * 3.7 + uNoiseSeed * 0.37);       // regional variation
  return clamp(t, 0.0, 1.0);
}

// SNOW COVER 0..1 — a seasonal/permanent snowpack that lies ON the terrain as
// an albedo overlay and adds NO mass, which is what separates it from iceCap:
// the caps are kilometres of ice that bury the ground into a shelf, snow is a
// blanket you still see the mountains through.
//
// Extent is driven by TEMPERATURE, so it climbs mountains and spreads from the
// poles for free, and its snow line rises as the caps grow (uLatitudeIce) —
// a cooling world whitens outward from the caps rather than the caps merely
// getting wider. The response is deliberately NON-LINEAR: a small cooling
// converts a large area to snow, because fresh snow raises albedo and cools
// further (the ice-albedo feedback that drives glacial onset). Hence the pow.
float snowCover(float temp, float latIce){
  if (uSnowfall <= 0.0) return 0.0;
  float line = mix(0.04, 0.62, latIce);            // snow line rises with the caps
  float t = smoothstep(line + 0.12, line - 0.12, temp);
  return clamp(pow(t, 0.65) * uSnowfall, 0.0, 1.0);
}

// ═══ BIOME PALETTE — the Whittaker grid (temperature x moisture) ═══════
// Linear RGB (the pipeline tonemaps), authored DARK and desaturated at the wet
// end: real forest canopy is a deep blue-green that reads almost black in
// shadow — the light "grass green" look comes from treating vegetation as one
// bright tint instead of a biome field.
// CALIBRATED TO EARTH'S ACTUAL ALBEDO SPREAD. Broadband albedo from orbit:
// Sahara sand ~0.35, grassland ~0.20, tundra ~0.20, boreal forest ~0.09-0.15,
// Amazon ~0.13 — so desert-to-forest is only about 3:1. Earth's land is far
// LESS contrasty than intuition suggests. An earlier pass ran ~10:1 (near-black
// canopy against pale sand) and read as harsh and posterised, so: forests dark
// but never black, deserts bright but never white.
vec3 biomeColor(float temp, float moist){
  // ── arid axis: cold desert/steppe gravel -> hot sand
  vec3 dry = mix(vec3(0.200, 0.185, 0.150), vec3(0.330, 0.265, 0.165),
                 smoothstep(0.30, 0.75, temp));
  // ── mid axis: tundra -> steppe/prairie straw -> tropical savanna. These sit
  // between bare ground and canopy, so they stay muted — a steppe is olive-tan,
  // not yellow.
  // Tundra is GREEN in season — moss, sedge and dwarf birch, not grey gravel.
  // The grey-brown reading is winter/satellite-composite bias.
  vec3 mid = mix(vec3(0.105, 0.150, 0.092),                    // tundra: moss/sedge
                 mix(vec3(0.185, 0.175, 0.100),                // temperate steppe
                     vec3(0.215, 0.185, 0.095),                // savanna
                     smoothstep(0.55, 0.85, temp)),
                 smoothstep(0.10, 0.38, temp));
  // ── wet axis: TAIGA (dark blue-green pine) -> temperate forest -> rainforest.
  vec3 wet = mix(vec3(0.042, 0.070, 0.058),                    // boreal / pine (blue-shifted)
                 vec3(0.050, 0.095, 0.045),                    // temperate broadleaf
                 smoothstep(0.22, 0.52, temp));
  wet = mix(wet, vec3(0.042, 0.100, 0.038),                    // tropical rainforest
            smoothstep(0.62, 0.88, temp));
  vec3 c = mix(dry, mid, smoothstep(0.16, 0.42, moist));
  return mix(c, wet, smoothstep(0.44, 0.70, moist));
}

// Isotropic simplex domain warp (a broad bend + a finer crenellation) so
// continent/plate edges dissolve into organic coastlines rather than straight
// Voronoi cells. Shared by terrainHeight AND the climate model — the rain
// shadow MUST sample plate structure in the same warped space, or its deserts
// sit beside mountains that aren't where they look like they are.
// (CPU bake parity uses the simplex port in simplex.ts — warpDir().)
vec3 warpedDir(vec3 dir){
  vec3 p = dir * 1.7 + uNoiseSeed;
  vec3 wLo = vec3(fbm(p * 0.6 + 11.3), fbm(p * 0.6 + 47.7), fbm(p * 0.6 + 83.1));
  vec3 wHi = vec3(fbm(p * 2.3 + 5.1), fbm(p * 2.3 + 27.9), fbm(p * 2.3 + 61.4));
  return normalize(dir + uWarp * (0.55 * wLo + 0.18 * wHi));
}

float terrainHeight(vec3 dir){
  vec3 p = dir * 1.7 + uNoiseSeed;
  vec3 wLo = vec3(fbm(p * 0.6 + 11.3), fbm(p * 0.6 + 47.7), fbm(p * 0.6 + 83.1));
  vec3 wdir = warpedDir(dir);
  float macro = plateMacro(wdir);
  // Detail sampled at a HIGHER base frequency (uDetailScale) so relief is fine and
  // planet-scale, not lumpy; centred so it roughens without shifting the mean
  // (keeps sea level meaningful). Ridged near ranges = rugged peaks; fBm elsewhere.
  vec3 dp = (p + uWarp * wLo) * uDetailScale;
  float hills = fbm(dp) * 0.5 + 0.5;
  float mts   = clamp(ridged(dp), 0.0, 1.0);
  float detail = mix(hills, mts, uRidged);
  float relief = mix(0.16, 0.32, smoothstep(0.55, 0.85, macro)); // rougher up high
  return finishHeight(macro + (detail - 0.5) * relief, dir);
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
