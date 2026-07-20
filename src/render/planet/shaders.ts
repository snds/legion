// ═══════════════════════════════════════════════════════════════════
// PLANET SHADERS — GLSL for the one surface material, giants, atmosphere,
// rings, and the distant analytic-sphere impostor.
//
// All lighting is WORLD-SPACE (normalMatrix carries the spin, so the sun
// direction is a plain world vector — no per-frame object-space rotation). The
// surface material is the SINGLE material the presets drive (P1); giants use the
// banded-cloud material (Decision 5); the impostor is the one-draw analytic
// ray-sphere for the far LOD stage (procedural-planet-research.md §1).
//
// GLSL ES 1.0 style (varying / gl_FragColor) to match the project's existing
// planet shaders; Three injects position/normal/uv/matrices/cameraPosition.
// ═══════════════════════════════════════════════════════════════════

import { GLSL_SIMPLEX, GLSL_FBM, GLSL_PLATES, GLSL_TERRAIN, GLSL_RAMP, GLSL_CLOUDS } from './glsl';

// ── Surface globe (cube-sphere terrain) ─────────────────────────────
// The vertex shader only DISPLACES geometry (silhouette); all height + normal
// used for shading is recomputed PER-FRAGMENT (analytic gradient of the height
// field), so shading, coastlines and ocean depth are tessellation-independent —
// no faceting/stair-stepping regardless of mesh LOD.
export const SURFACE_VERT = /* glsl */ `
${GLSL_SIMPLEX}
${GLSL_FBM}
${GLSL_PLATES}
${GLSL_TERRAIN}
uniform float uDisplacement;
uniform float uUseBake;          // 1 = sample the baked master, 0 = live analytic
uniform sampler2D uHeightAtlas;  // stacked 6-face height atlas (res × 6·res)
uniform float uHeightRes;
attribute vec2 faceUV;           // face-local (u,v) ∈ [0,1] → bake lookup
attribute float aFace;           // cube face index 0..5 (constant per leaf)
attribute vec3 aFaceU;           // object-space face axes → world tangents for bake
attribute vec3 aFaceV;
varying vec3  vWorldPos;
varying vec3  vDir;      // undisplaced object-space unit direction
varying vec3  vWN;       // world-space sphere normal (smooth)
varying vec3  vWT;       // world-space tangent   (basis for relief perturbation)
varying vec3  vWB;       // world-space bitangent
varying vec2  vFaceUV;
varying float vFace;
varying vec3  vFU;       // world-space face-U tangent (bake normal basis)
varying vec3  vFV;

// Sample the stacked atlas for face f at face-local fuv. Clamp a half-texel
// inside the face's row band so linear filtering never bleeds across faces.
float atlasHeight(sampler2D atlas, float f, vec2 fuv, float res){
  vec2 c = clamp(fuv, 0.5 / res, 1.0 - 0.5 / res);
  return texture2D(atlas, vec2(c.x, (f + c.y) / 6.0)).r;
}

void main(){
  vec3 dir = normalize(position);
  vDir = dir;
  vFaceUV = faceUV;
  vFace = aFace;
  // Smooth world-space TBN basis (interpolates cleanly — the crisp relief comes
  // from the per-fragment gradient, this only orients it). WORLD-space via
  // modelMatrix (object→world); normalMatrix is object→VIEW here (headlight).
  vec3 up = abs(dir.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
  vec3 t = normalize(cross(up, dir));
  vec3 bt = cross(dir, t);
  mat3 m3 = mat3(modelMatrix);
  vWN = normalize(m3 * dir);
  vWT = normalize(m3 * t);
  vWB = normalize(m3 * bt);
  vFU = normalize(m3 * aFaceU);
  vFV = normalize(m3 * aFaceV);
  // Height: baked master (atlas) or live analytic terrain. Either way the SAME
  // finishHeight() lays craters/canyons/ice-shelf mass on top (bake parity).
  float h = uUseBake > 0.5 ? finishHeight(atlasHeight(uHeightAtlas, aFace, faceUV, uHeightRes), dir)
                           : terrainHeight(dir);
  // Water fills the basins: the ocean SURFACE is flat at sea level (the seafloor
  // no longer bumps the water geometry — it shows through the bathymetry colour).
  float hs = uSeaLevel > 0.0 ? max(h, uSeaLevel) : h;
  // Displace land radially; centre the mean so the globe keeps its radius.
  float disp = uDisplacement * (hs - 0.5);
  vec3 displaced = position * (1.0 + disp);
  vWorldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

export const SURFACE_FRAG = /* glsl */ `
${GLSL_SIMPLEX}
${GLSL_FBM}
${GLSL_PLATES}
${GLSL_TERRAIN}
${GLSL_RAMP}
${GLSL_CLOUDS}
uniform float uDisplacement;
uniform float uNormalStrength; // relief-normal (bump) exaggeration
uniform float uCloudShadow;   // how hard cloud shadows shade the direct light
uniform vec3  uSunDirObj;     // sun dir in OBJECT space (for the cloud-shell ray)
uniform float uUseBake;
uniform sampler2D uHeightAtlas; // stacked 6-face height atlas
uniform float uHeightRes;       // baked face resolution (for the normal step)
uniform vec3  uSunDir;        // world-space, surface → sun
// (uSeaLevel + uLatitudeIce are declared in GLSL_TERRAIN — shared with the
//  vertex's flat-ocean displacement and the ice-cap mass.)
uniform vec3  uOceanShallow;
uniform vec3  uOceanDeep;
// (uMoisture + the climate modifiers are declared in GLSL_TERRAIN — the field is
//  shared, so ground cover and anything else keying off climate stay in step.)
uniform float uRoughness;
uniform float uLushDepth;     // how strongly the biome palette replaces bare ground
uniform vec3  uEmissive;
uniform float uEmissiveStrength;
uniform float uNightLights;
uniform float uTerminator;    // terminator softness
uniform vec3  uAtmosTint;
varying vec3  vWorldPos;
varying vec3  vDir;
varying vec3  vWN;
varying vec3  vWT;
varying vec3  vWB;
varying vec2  vFaceUV;
varying float vFace;
varying vec3  vFU;
varying vec3  vFV;

float atlasHeight(sampler2D atlas, float f, vec2 fuv, float res){
  vec2 c = clamp(fuv, 0.5 / res, 1.0 - 0.5 / res);
  return texture2D(atlas, vec2(c.x, (f + c.y) / 6.0)).r;
}

void main(){
  vec3 dir = normalize(vDir);
  float vHeight;
  vec3 N;
  if (uUseBake > 0.5) {
    // Baked master + live ephemera (finishHeight — bake parity). Relief normal =
    // the atlas gradient (erosion relief, face-UV frame) PLUS the ephemera
    // gradient (crater/canyon/cap, analytic tangent frame with the base held
    // fixed — decouples the two frames cleanly). Under the ice cap the atlas
    // relief flattens with the shelf plateau, matching the analytic path.
    float b0 = atlasHeight(uHeightAtlas, vFace, vFaceUV, uHeightRes);
    vHeight = finishHeight(b0, dir);
    float e = 1.5 / uHeightRes;
    float hu = atlasHeight(uHeightAtlas, vFace, vFaceUV + vec2(e, 0.0), uHeightRes);
    float hv = atlasHeight(uHeightAtlas, vFace, vFaceUV + vec2(0.0, e), uHeightRes);
    vec3 grad = ((hu - b0) / e) * normalize(vFU) + ((hv - b0) / e) * normalize(vFV);
    // The shelf plateau flattens the eroded relief, but NOT to nothing: an ice
    // sheet drapes over the ground it buries, so ridges and valleys still show
    // optically through the surface. Keep ~30% of the gradient under the cap.
    grad *= mix(1.0, 0.30, iceCap(dir));
    vec3 up = abs(dir.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
    vec3 t = normalize(cross(up, dir));
    vec3 b = cross(dir, t);
    float eps = 0.0035;
    float gex = (finishHeight(b0, normalize(dir + t*eps)) - vHeight) / eps;
    float gey = (finishHeight(b0, normalize(dir + b*eps)) - vHeight) / eps;
    grad += gex * normalize(vWT) + gey * normalize(vWB);
    N = normalize(vWN - uNormalStrength * grad);
  } else {
    // Live analytic: per-fragment height + gradient (tessellation-independent).
    vHeight = terrainHeight(dir);
    vec3 up = abs(dir.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
    vec3 t = normalize(cross(up, dir));
    vec3 b = cross(dir, t);
    float eps = 0.0035;
    float gx = (terrainHeight(normalize(dir + t*eps)) - vHeight) / eps;
    float gy = (terrainHeight(normalize(dir + b*eps)) - vHeight) / eps;
    N = normalize(vWN - uNormalStrength * (gx * normalize(vWT) + gy * normalize(vWB)));
  }
  bool ocean = uSeaLevel > 0.0 && vHeight < uSeaLevel;
  if (ocean){
    // FLAT water-surface normal: the sphere normal + a whisper of wave detail.
    // The seafloor no longer shades the surface — it reads through the COLOUR.
    vec3 wave = vec3(snoise(dir * 90.0), snoise(dir * 90.0 + 31.7), snoise(dir * 90.0 + 77.3));
    N = normalize(vWN + 0.015 * wave);
  }
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndl = dot(N, uSunDir);
  float day = smoothstep(-uTerminator, uTerminator, ndl);

  vec3 albedo;
  // Hoisted: the biome branch fills these, and the night-lights pass below needs
  // them to decide where people would actually settle (rain + temperate land).
  float moist = 0.0;
  float temp = 0.0;
  float spec = 0.0;
  if (ocean){
    float depth = clamp((uSeaLevel - vHeight) / max(uSeaLevel, 1e-3), 0.0, 1.0);
    // Terrain-informed bathymetry: shallow→deep quickly near the shore, then an
    // ABYSS darkening so trenches (underwater craters/canyons — the Mariana
    // effect) read as distinctly deeper, diffused water.
    // Depth ramp. The bright turquoise band is a NARROW fringe on Earth — the
    // shelf break falls away fast, so only the last few tens of metres before
    // the beach read as pale. Ramping shallow->deep over 35% of the depth range
    // painted a wide cyan halo around every landmass; 0.10 keeps it a fringe.
    albedo = mix(uOceanShallow, uOceanDeep, smoothstep(0.0, 0.10, depth));
    // Open water then keeps deepening gently toward the abyssal plain.
    albedo = mix(albedo, uOceanDeep * 0.72, smoothstep(0.10, 0.55, depth));
    // Abyss darkening, floored well above black: deep ocean from orbit is a dark
    // navy, not a void. A 0.4 floor on an already-dark deep colour crushed the
    // basins to near-black and made every coastline read as a hard cut.
    albedo *= mix(1.0, 0.72, smoothstep(0.45, 1.0, depth));
    // Fresnel + sun glint (Lague-style water, done on-surface).
    float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 H = normalize(uSunDir + V);
    spec = pow(max(dot(N, H), 0.0), 80.0) * day;
    albedo = mix(albedo, uAtmosTint, fres * 0.4);
  } else {
    float hh = uSeaLevel > 0.0 ? (vHeight - uSeaLevel) / max(1.0 - uSeaLevel, 1e-3) : vHeight;
    hh = clamp(hh, 0.0, 1.0);
    albedo = sampleRamp(hh);
    // ── Whittaker biomes: the climate MOISTURE field crossed with TEMPERATURE
    // (latitude + altitude lapse) picks the actual biome — taiga, temperate
    // forest, rainforest, savanna, steppe, tundra, desert — instead of tinting
    // one green over everything. Vegetation thins out past the treeline (a
    // temperature threshold, so it tracks mountains AND latitude) and the bare
    // altitude ramp shows through above it.
    vec3 wdirC = warpedDir(dir);
    moist = climateMoisture(dir, wdirC, hh);
    temp = climateTemp(dir, hh);
    float cover = smoothstep(uTreeline - 0.06, uTreeline + 0.10, temp)  // treeline / alpine
                * (0.35 + 0.65 * smoothstep(0.05, 0.35, moist));        // bare rock where truly arid
    albedo = mix(albedo, biomeColor(temp, moist), cover * uLushDepth);
    // ── Polar ice keys off the SAME cap-mass field the height uses (iceCap in
    // GLSL_TERRAIN), plus frost on the highest peaks. Two refinements:
    //
    // 1. SEA ICE vs LAND GLACIER. Frozen ocean is thin, wet and salty — it
    //    reads PALER and distinctly BLUER than kilometres of compressed
    //    continental ice, which scatters warmer and brighter. Which one we are
    //    standing on is decided by the MACRO basin (pre-cap), since the cap
    //    itself raises the surface above sea level.
    // 2. The ice is not opaque paint: a fraction of the ground below still
    //    modulates it, so ridges and valleys read THROUGH the sheet rather than
    //    vanishing under flat white.
    float cap = iceCap(dir);
    float frost = 0.6 * smoothstep(0.85, 0.97, hh);
    float iceAmt = max(cap, frost);
    if (iceAmt > 0.001){
      float basin = plateMacro(wdirC);                       // pre-cap ground
      float sea = 1.0 - smoothstep(uSeaLevel - 0.03, uSeaLevel + 0.03, basin);
      vec3 seaIce  = vec3(0.82, 0.89, 0.99);                 // paler, bluer
      vec3 landIce = vec3(0.95, 0.955, 0.95);                // thick, brighter
      vec3 iceCol = mix(landIce, seaIce, sea);
      // Terrain reads through: darken slightly in hollows, brighten on rises.
      float relief = clamp((vHeight - uSeaLevel) * 1.6, -0.5, 0.5);
      iceCol *= 1.0 + 0.16 * relief * (1.0 - sea);           // land ice only
      albedo = mix(albedo, iceCol, iceAmt);
    }
  }

  // Cloud self-shadowing: sample the SAME cloud field where the sun ray from this
  // surface point crosses the cloud shell (thin-shell intersection at 1.03R in
  // unit-dir space), and shade only the DIRECT light — the clouds overhead cast
  // their own shapes onto the ground.
  float cshadow = 1.0;
  if (uCloudCover > 0.0 && uCloudShadow > 0.0){
    float b = dot(dir, uSunDirObj);
    float s = -b + sqrt(max(b * b + 0.0609, 0.0)); // 1.03^2 - 1 = 0.0609
    vec3 cdir = normalize(dir + s * uSunDirObj);
    cshadow = 1.0 - uCloudShadow * cloudDensity(cdir);
  }

  // Lambert + soft terminator.
  vec3 lit = albedo * (0.05 + 0.95 * day * max(ndl, 0.0) * cshadow);
  lit += spec * (1.0 - uRoughness) * vec3(1.0) * cshadow;

  // Lava emissive (glows in the low cracks, brightest on the night side).
  if (uEmissiveStrength > 0.0){
    float glow = smoothstep(uSeaLevel + 0.1, uSeaLevel - 0.1, vHeight);
    lit += uEmissive * uEmissiveStrength * glow * (0.4 + 0.6 * (1.0 - day));
  }

  // ── Night-side city lights: people do not settle at random. Weighted by where
  // humans actually build — fresh water and river mouths, coastlines (trade),
  // fertile land with reliable rain, temperate latitudes, and low flat ground.
  // Then clustered: a low-frequency "where civilisation took hold" field carves
  // out a few bright metro cores, a high-frequency field speckles the towns
  // around them, and both fade off with the habitability score, so lit regions
  // TRAIL OFF into darkness and follow coasts as tendrils instead of covering
  // every landmass in even confetti.
  if (uNightLights > 0.0 && uSeaLevel > 0.0){
    float night = 1.0 - day;
    if (night > 0.01){
      float land = smoothstep(uSeaLevel - 0.004, uSeaLevel + 0.004, vHeight);
      float hh2 = clamp((vHeight - uSeaLevel) / max(1.0 - uSeaLevel, 1e-3), 0.0, 1.0);
      // Coastal band: ports and river mouths. Strongest right at the waterline.
      float coast   = 1.0 - smoothstep(0.0, 0.12, hh2);
      float lowland = 1.0 - smoothstep(0.12, 0.45, hh2);   // plains, not peaks
      // Farmland: needs rain, but nobody farms swamp or ice.
      float fertile = smoothstep(0.22, 0.5, moist) * (1.0 - smoothstep(0.88, 1.05, moist));
      // Temperate gate: settlement needs meaningfully warm ground, and the very
      // hottest ground is also thinner (equatorial deserts / deep jungle).
      float livable = smoothstep(0.26, 0.55, temp) * (1.0 - 0.35 * smoothstep(0.86, 1.0, temp));
      // Explicit POLAR falloff on top of temperature. Earth's population density
      // collapses past ~60 deg: there are real cities at 55-60 (Oslo, Stockholm,
      // St Petersburg) but almost nothing above 70 — the Arctic coast is a
      // handful of settlements, not a lit band. Temperature alone was too
      // permissive because the biome curve still reads 60 deg as habitable
      // taiga, which is true for TREES and not for cities.
      float lat2 = abs(dir.y);
      livable *= 1.0 - 0.93 * smoothstep(0.80, 0.97, lat2);
      float H = clamp((0.42 * coast + 0.26 * lowland + 0.54 * fertile) * livable, 0.0, 1.0);
      H *= land * (1.0 - iceCap(dir));
      // Metro cores + surrounding towns, both gated by habitability.
      // Sharp falloff is what makes this read as CITIES rather than a glowing
      // landmass: population density is strongly non-linear in habitability, so
      // H is raised to a power and the noise thresholds are narrow. Only the
      // best ground lights up brightly; the rest trails off into darkness.
      float Hc = H * H;                                        // density ~ H^2
      float region = fbm(dir * 5.5 + uNoiseSeed * 0.7) * 0.5 + 0.5;
      float metro  = smoothstep(0.58, 0.86, region) * Hc;      // a few big cores
      float towns  = smoothstep(0.70, 0.97, fbm(dir * 52.0 + uNoiseSeed) * 0.5 + 0.5) * H;
      float lights = (metro * 1.15 + towns * 0.75) * night;
      // Sodium-warm cores, cooler at the sparse edges (LED/mercury outskirts).
      vec3 tint = mix(vec3(1.0, 0.78, 0.42), vec3(0.85, 0.88, 1.0), 0.35 * towns * (1.0 - metro));
      lit += tint * lights * uNightLights;
    }
  }

  gl_FragColor = vec4(lit, 1.0);
}
`;

// ── Cloud shell (surface worlds) ─────────────────────────────────────
// A thin translucent shell above the surface rendering the SAME cloudDensity
// field the surface samples for its shadows — so shadow and cloud always agree.
export const CLOUD_VERT = /* glsl */ `
varying vec3 vDir;
varying vec3 vWorldNormal;
void main(){
  vDir = normalize(position);
  vWorldNormal = normalize(mat3(modelMatrix) * vDir);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const CLOUD_FRAG = /* glsl */ `
${GLSL_SIMPLEX}
${GLSL_FBM}
${GLSL_PLATES}
${GLSL_CLOUDS}
uniform vec3  uSunDir;
uniform float uTerminator;
varying vec3  vDir;
varying vec3  vWorldNormal;
void main(){
  float dcl = cloudDensity(normalize(vDir));
  if (dcl <= 0.004) discard;
  vec3 N = normalize(vWorldNormal);
  float ndl = dot(N, uSunDir);
  float day = smoothstep(-uTerminator, uTerminator, ndl);
  vec3 col = vec3(1.0) * (0.08 + 0.92 * day * max(ndl, 0.0));
  gl_FragColor = vec4(col, dcl * 0.85);
}
`;

// ── Gas / ice giant (banded cloud material) ─────────────────────────
export const GIANT_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * vDir); // world-space (not view)
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const GIANT_FRAG = /* glsl */ `
${GLSL_SIMPLEX}
uniform vec3  uSunDir;
uniform vec3  uBandA;
uniform vec3  uBandB;
uniform float uBandCount;
uniform float uTurbulence;
uniform float uStorm;       // 0/1 — has a great spot
uniform vec3  uNoiseSeed;
uniform float uTime;
uniform float uTerminator;
varying vec3  vWorldPos;
varying vec3  vWorldNormal;
varying vec3  vDir;

void main(){
  vec3 N = normalize(vWorldNormal);
  float ndl = dot(N, uSunDir);
  float day = smoothstep(-uTerminator, uTerminator, ndl);

  float lat = vDir.y; // -1..1
  // Turbulent latitude warp so bands aren't ruler-straight.
  vec3 sp = vDir * 3.0 + uNoiseSeed;
  float warp = snoise(vec3(sp.x, sp.y * 0.5, sp.z + uTime * 0.02)) * uTurbulence * 0.15;
  float bands = sin((lat + warp) * uBandCount * 3.14159);
  float t = smoothstep(-0.6, 0.6, bands);
  vec3 col = mix(uBandA, uBandB, t);

  // Fine cloud turbulence.
  float fine = snoise(vDir * 12.0 + uNoiseSeed + vec3(uTime * 0.03, 0.0, 0.0));
  col *= 0.9 + 0.1 * fine;

  // Great-spot storm — an off-equator oval.
  if (uStorm > 0.5){
    vec3 c = normalize(vec3(0.6, -0.35, 0.72));
    float d = distance(vDir, c);
    float storm = smoothstep(0.28, 0.05, d);
    col = mix(col, vec3(0.75, 0.35, 0.25), storm * 0.8);
  }

  vec3 lit = col * (0.06 + 0.94 * day * max(ndl, 0.0));
  gl_FragColor = vec4(lit, 1.0);
}
`;

// ── Atmosphere shell (P2 — Rayleigh/Mie-ish rim) ────────────────────
export const ATMOS_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main(){
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normalize(position)); // world-space (not view)
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ATMOS_FRAG = /* glsl */ `
uniform vec3  uSunDir;
uniform vec3  uColor;
uniform float uDensity;
varying vec3  vWorldPos;
varying vec3  vWorldNormal;
void main(){
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  // Rim: strongest at the limb (grazing view).
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
  float ndl = dot(N, uSunDir);
  float day = smoothstep(-0.35, 0.6, ndl);         // scatter only lit air
  // Forward Mie glow near the sun direction along the view.
  float mie = pow(max(dot(V, uSunDir), 0.0), 8.0) * 0.5;
  float a = (rim * day + mie) * uDensity;
  gl_FragColor = vec4(uColor * a, a);
}
`;

// ── Rings (structured density bands, sampled from a LUT) ─────────────
export const RING_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec2 vLocal;   // xz in ring plane (planet radii)
void main(){
  vLocal = position.xy;   // plane geometry authored in XY, laid flat by globe.ts
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const RING_FRAG = /* glsl */ `
uniform sampler2D uDensity;   // 1×N density LUT
uniform float uInner;         // planet radii
uniform float uOuter;
uniform vec3  uColor;
uniform vec3  uSunDir;
uniform vec3  uPlanetCenter;  // world
uniform float uPlanetRadius;  // world
varying vec3  vWorldPos;
varying vec2  vLocal;
void main(){
  float r = length(vLocal);
  if (r < uInner || r > uOuter) discard;
  float u = (r - uInner) / max(uOuter - uInner, 1e-4);
  float d = texture2D(uDensity, vec2(u, 0.5)).r;
  if (d <= 0.001) discard;

  // Planet shadow across the rings (cheap: project ring point onto sun ray).
  vec3 rel = vWorldPos - uPlanetCenter;
  float along = dot(rel, uSunDir);
  vec3 perp = rel - along * uSunDir;
  float shadow = (along < 0.0 && length(perp) < uPlanetRadius) ? 0.35 : 1.0;

  float alpha = d * 0.9;
  gl_FragColor = vec4(uColor * shadow, alpha);
}
`;

// ── Distant impostor (one-draw analytic ray-sphere on a billboard) ───
export const IMPOSTOR_VERT = /* glsl */ `
uniform vec3  uCenter;   // world
uniform vec3  uRight;    // camera right (world, unit)
uniform vec3  uUp;       // camera up (world, unit)
uniform float uRadius;   // world
varying vec3  vWorld;
void main(){
  // position is a unit quad in [-1,1]²; blow it up to a camera-facing billboard
  // a little larger than the sphere so the silhouette isn't clipped.
  vec3 wp = uCenter + (position.x * uRight + position.y * uUp) * uRadius * 1.1;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const IMPOSTOR_FRAG = /* glsl */ `
${GLSL_SIMPLEX}
uniform vec3  uCenter;
uniform float uRadius;
uniform vec3  uSunDir;
uniform vec3  uColor;
uniform vec3  uNoiseSeed;
varying vec3  vWorld;
void main(){
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  // Analytic ray-sphere intersection.
  vec3 oc = ro - uCenter;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - uRadius * uRadius;
  float disc = b*b - c;
  if (disc < 0.0) discard;
  float tHit = -b - sqrt(disc);
  if (tHit < 0.0) discard;
  vec3 hit = ro + rd * tHit;
  vec3 N = normalize(hit - uCenter);
  float ndl = max(dot(N, uSunDir), 0.0);
  float day = smoothstep(-0.05, 0.2, dot(N, uSunDir));
  // Cheap 3-octave colour variation so it isn't a flat disc.
  float f = 0.0, amp = 0.5, freq = 2.0;
  for (int i = 0; i < 3; i++){ f += amp * snoise(N * freq + uNoiseSeed); freq *= 2.0; amp *= 0.5; }
  vec3 col = uColor * (0.85 + 0.3 * f);
  vec3 lit = col * (0.05 + 0.95 * ndl) * day;
  gl_FragColor = vec4(lit, 1.0);
}
`;
