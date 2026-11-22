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
    grad *= mix(1.0, 0.30, iceCap(dir, vHeight));
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
    // PACK ICE on open water. Sea ice is a thin skin, not a glacier: it never
    // reaches the caps' opacity, and it reads paler and bluer. Freezing runs
    // AHEAD of the land snow line (salt water freezes readily once the air is
    // cold enough and there is no relief to warm it), so it uses the same
    // temperature field with no altitude term.
    float seaT = climateTemp(dir, 0.0);
    float pack = snowCover(seaT, uLatitudeIce) * 0.72;
    if (pack > 0.002){
      // Break the margin up so it reads as floe and lead, not a painted disc.
      pack *= 0.55 + 0.45 * (fbm(dir * 8.0 + uNoiseSeed * 1.7) * 0.5 + 0.5);
      albedo = mix(albedo, vec3(0.80, 0.87, 0.97), clamp(pack, 0.0, 0.9));
      spec *= 1.0 - clamp(pack, 0.0, 0.9);   // ice is not glassy like open water
    }
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
    // BIOME altitude reads the SMOOTH analytic macro height, never the per-texel
    // baked vHeight. A baked-atlas seam at a quadtree-leaf boundary is a tiny
    // height step on its own, but the lapse-rate term amplifies it: it crosses
    // the treeline and flips the biome to bare ground along the leaf's straight
    // edges (the hexagonal tan patch, 2026-07-22). Colour follows the broad
    // terrain shape; the baked relief still drives the ramp, normals and
    // displacement, so nothing else is lost. plateMacro is dir-based and
    // continuous, so baked and unbaked biomes now match exactly.
    float bh = clamp((plateMacro(wdirC) - uSeaLevel) / max(1.0 - uSeaLevel, 1e-3), 0.0, 1.0);
    moist = climateMoisture(dir, wdirC, bh);
    temp = climateTemp(dir, bh);
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
    float cap = iceCap(dir, vHeight);
    float frost = 0.6 * smoothstep(0.85, 0.97, hh);
    // SNOWPACK, layered UNDER the glaciers: no mass, just a blanket you still
    // read the terrain through. Because it keys off temperature it climbs
    // mountain ranges and spreads outward from the caps as the world cools —
    // so a glacial world whitens over almost everything while the caps stay
    // the only true ice sheets. Capped below 1 so terrain never fully vanishes.
    float snow = snowCover(temp, uLatitudeIce) * 0.88;
    float iceAmt = max(max(cap, frost), snow);
    if (iceAmt > 0.001){
      float basin = plateMacro(wdirC);                       // pre-cap ground
      float sea = 1.0 - smoothstep(uSeaLevel - 0.03, uSeaLevel + 0.03, basin);
      // Sea ice is THINNER than a glacier: over water the snowpack alone only
      // ever forms a pack-ice skin, so its coverage is held back unless the cap
      // itself has reached here.
      if (sea > 0.5) iceAmt = max(max(cap, frost), snow * 0.62);
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
  // cDensOver is shared with lightning underglow (avoids a 2nd full cloudDensity).
  float cDensOver = 0.0;
  float cshadow = 1.0;
  if (uCloudCover > 0.0 && uCloudShadow > 0.0){
    float b = dot(dir, uSunDirObj);
    float s = -b + sqrt(max(b * b + 0.0609, 0.0)); // 1.03^2 - 1 = 0.0609
    vec3 cdir = normalize(dir + s * uSunDirObj);
    // Cheap path: approximate shadow from overhead density (skips sun-ray sample).
    if (uCloudCheap > 0.5) {
      cDensOver = cloudDensity(dir);
      cshadow = 1.0 - uCloudShadow * cDensOver;
    } else {
      cshadow = 1.0 - uCloudShadow * cloudDensity(cdir);
    }
  }

  // Lambert + soft terminator.
  vec3 lit = albedo * (0.05 + 0.95 * day * max(ndl, 0.0) * cshadow);
  lit += spec * (1.0 - uRoughness) * vec3(1.0) * cshadow;

  // Lightning UNDER-GLOW: the cell directly overhead (radially out) throws a
  // faint blue-white flash down onto the ground. Reuses the same lightningFlash
  // and clock as the cloud shell, so the ground flickers in step with the bolt
  // above it. Night-side only — daylight drowns it.
  if (uLightning > 0.0){
    if (uCloudCover > 0.0 && cDensOver <= 0.0) cDensOver = cloudDensity(dir);
    float bolt = lightningFlash(dir, cDensOver);
    lit += vec3(0.45, 0.58, 0.9) * bolt * 0.35 * (1.0 - day);
  }

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
      // Harsh-environment thinning — the poles, the ice-cap fringe, and large
      // deserts are all the same story: people still live there, but density and
      // volume are a fraction of the temperate norm. Each penalty FLOORS at a
      // trace rather than going dark, so these regions show a sparse scatter of
      // lights (Arctic ports, desert oasis towns) instead of a black void.
      //
      //  · cold      — falls with temperature, so it thins toward the poles AND
      //                up mountains (always active; temp needs no other uniform).
      //  · capNear   — the closer to permanent ice/snow, the sparser; and because
      //                the snow line tracks the caps, this band GROWS as the caps
      //                grow, so a glacial world's mid-latitudes depopulate too.
      //  · arid      — true desert keeps only scattered settlement.
      float cold    = mix(0.05, 1.0, smoothstep(0.16, 0.44, temp));
      float capNear = mix(0.05, 1.0, 1.0 - smoothstep(0.02, 0.45,
                          iceCap(dir, vHeight) + snowCover(temp, uLatitudeIce)));
      float arid    = mix(0.10, 1.0, smoothstep(0.12, 0.42, moist));
      livable *= cold * capNear * arid;
      float H = clamp((0.42 * coast + 0.26 * lowland + 0.54 * fertile) * livable, 0.0, 1.0);
      H *= land;
      // Metro cores + surrounding towns, both gated by habitability.
      // Sharp falloff is what makes this read as CITIES rather than a glowing
      // landmass: population density is strongly non-linear in habitability, so
      // H is raised to a power and the noise thresholds are narrow. Only the
      // best ground lights up brightly; the rest trails off into darkness.
      // The smooth fields only set DENSITY — they must never be the light shape
      // itself. Thresholding a low-frequency fbm produces soft-edged blobs, not
      // cities; real night imagery is fine, sharp speckle whose SPACING tightens
      // toward the cores. So: a broad "where civilisation took hold" field plus
      // habitability gives a probability, and that probability lowers the
      // threshold on very high-frequency noise. Dense areas light up almost
      // everywhere, sparse ones only at the rare peaks — which is exactly how
      // conurbations blur into a sheet at the centre and break into separate
      // dots at the edges.
      float Hc = H * H;                                        // density ~ H^2
      float region = fbm(dir * 5.5 + uNoiseSeed * 0.7) * 0.5 + 0.5;
      float dens = clamp(Hc * (0.30 + 1.45 * smoothstep(0.42, 0.86, region)), 0.0, 1.0);
      if (dens > 0.002){
        // Two crisp octaves at CITY scale (single snoise, not fbm — fbm's
        // smoothing is what rounded these into blobs).
        // Frequency is capped deliberately: past ~300 these features go
        // SUB-PIXEL with the planet full-screen, which shimmers under the
        // planet's own rotation instead of reading as steady city lights.
        float n1 = snoise(dir * 150.0 + uNoiseSeed * 3.1) * 0.5 + 0.5;
        float t1 = mix(0.985, 0.60, dens);                     // core: easy to light
        float core  = smoothstep(t1, t1 + 0.035, n1);
        float small = 0.0;
        if (uCloudCheap <= 0.5) {
          float n2 = snoise(dir * 300.0 + uNoiseSeed * 7.7) * 0.5 + 0.5;
          float t2 = mix(0.995, 0.72, dens);                   // outliers: rarer
          small = smoothstep(t2, t2 + 0.02, n2) * 0.65;        // satellite towns
        }
        float lights = max(core, small) * night;
        // Sodium-warm in the dense cores, cooler at the sparse edges.
        vec3 tint = mix(vec3(0.86, 0.90, 1.0), vec3(1.0, 0.76, 0.40), smoothstep(0.15, 0.7, dens));
        lit += tint * lights * uNightLights * (0.55 + 0.75 * dens);
      }
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
  vec3 cd = normalize(vDir);
  float dcl = cloudDensity(cd);
  if (dcl <= 0.004) discard;
  vec3 N = normalize(vWorldNormal);
  float ndl = dot(N, uSunDir);
  float day = smoothstep(-uTerminator, uTerminator, ndl);
  vec3 col = vec3(1.0) * (0.08 + 0.92 * day * max(ndl, 0.0));
  float a = dcl * 0.85;
  // Lightning lights the cloud from within: a blue-white flash added to the
  // colour AND to the opacity, so a dark night-side storm cell briefly glows
  // and the bolt reads as happening inside the cloud rather than on top of it.
  float bolt = lightningFlash(cd, dcl);
  if (bolt > 0.001){
    col += vec3(0.72, 0.82, 1.0) * bolt * 1.7;
    a = clamp(a + bolt * 0.55, 0.0, 1.0);
  }
  gl_FragColor = vec4(col, a);
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
// docs/planet-visual-realism.md §2.1 (GasGiant) / §2.2 (IceGiant) — seeded
// irregular band profile + polar-cutoff vortex crossfade + a seeded storm/
// streak population + Jónsson limb darkening, replacing the old single
// constant-frequency sin() stripe + one hardcoded great-spot boolean.
const int MAX_BANDS = 16;
const int MAX_STORMS = 6; // keep in sync with continuum/index.ts MAX_GIANT_STORMS

uniform vec3  uSunDir;
uniform vec3  uBandA;
uniform vec3  uBandB;
uniform float uBandCount;
uniform float uBandContrast; // 0..1 — how strongly the band profile reads (ice: ~0.06)
uniform float uTurbulence;
uniform vec3  uNoiseSeed;
uniform float uTime;
uniform float uTerminator;
// Seeded storm/streak population (CPU-placed at band-shear latitudes, see
// continuum/index.ts buildGiantFeatures — at most 1 giant anticyclone + 2-5
// medium ovals for gas giants, or 0-3 bright zonal streaks for ice giants).
uniform int   uStormCount;
uniform vec3  uStormPos[MAX_STORMS];    // unit sphere direction (object space)
uniform float uStormRadius[MAX_STORMS]; // chord-distance influence radius
uniform float uStormAspect[MAX_STORMS]; // 1 = round oval; >1 = zonal streak
uniform float uStormSpiral[MAX_STORMS]; // >0 = analytic spiral warp strength
uniform vec3  uStormColor[MAX_STORMS];
// Real-photo override (Audit fix — curated Sol giants: Jupiter/Saturn/
// Uranus/Neptune). continuum/index.ts's buildGiantMat sets uUseAlbedoMap=1
// once continuum/real-albedo.ts finishes loading that body's bundled photo;
// EE's fictional giants (Jotunheim/Niflheim, no real photo) keep
// uUseAlbedoMap=0 and this whole block is a no-op — byte-identical band
// shading to before this uniform existed.
uniform sampler2D uAlbedoMap;
uniform float uUseAlbedoMap;
varying vec3  vWorldPos;
varying vec3  vWorldNormal;
varying vec3  vDir;

// Dave Hoskins cheap decorrelated hash (duplicated from GLSL_FBM — that
// chunk also declares uNoiseSeed/uRidged/uWarp, which would collide with
// this material's own uniform block, so it isn't included here).
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }

// Seeded per-band interval width (0.5..1.5 — irregular, not uniform 1/N
// spacing), matching §2.1's "divide latitude into N seeded intervals,
// perturb interior boundaries with seeded noise" structure rule.
float bandWeight(float i, vec3 seed){
  return 0.5 + hash13(vec3(i * 12.9898 + seed.x * 0.013, i * 4.1414 + seed.y * 0.017, seed.z * 0.011));
}

// Finds which seeded band [0, bandCount) a 0..1 latitude coordinate falls
// into, plus its local position (0..1) within that band's width — the
// cumulative-weighted-interval walk that makes band widths vary instead of
// every band spanning an identical 1/bandCount slice.
vec2 bandLookup(float latN, float bandCount, vec3 seed){
  float total = 0.0;
  for (int i = 0; i < MAX_BANDS; i++){
    if (float(i) >= bandCount) break;
    total += bandWeight(float(i), seed);
  }
  total = max(total, 1e-4);
  float acc = 0.0;
  for (int i = 0; i < MAX_BANDS; i++){
    if (float(i) >= bandCount) break;
    float wn = bandWeight(float(i), seed) / total;
    float next = acc + wn;
    if (latN <= next || float(i) >= bandCount - 1.0){
      return vec2(float(i), wn > 1e-5 ? clamp((latN - acc) / wn, 0.0, 1.0) : 0.5);
    }
    acc = next;
  }
  return vec2(0.0, 0.5);
}

// Per-band colour: alternates the two ramp colours by parity, then a small
// seeded value jitter — "variation lives in VALUE, not hue" (§2.1 palette).
vec3 bandColorAt(float idx, vec3 seed){
  vec3 base = mix(uBandA, uBandB, mod(idx, 2.0));
  float h = hash13(vec3(idx * 7.31 + seed.z, idx * 2.17, seed.x * 0.005));
  return base * (0.82 + 0.36 * h);
}

void main(){
  vec3 N = normalize(vWorldNormal);
  float ndl = dot(N, uSunDir);
  float day = smoothstep(-uTerminator, uTerminator, ndl);

  float lat = vDir.y; // sin(latitude), -1..1
  // Turbulent latitude warp so bands aren't ruler-straight. P2-7: the warp's
  // amplitude MUST stay a bounded fraction of one band's period (1/uBandCount)
  // or its phase shift exceeds a full band cycle and degenerates into
  // isotropic wavy/contour "wood-grain" noise instead of latitude-aligned
  // bands. Scaling by 1/uBandCount keeps the warp's worst case a fraction of
  // one band's width for ANY band count.
  vec3 sp = vDir * 3.0 + uNoiseSeed;
  float warp = snoise(vec3(sp.x, sp.y * 0.5, sp.z + uTime * 0.02))
    * uTurbulence * (0.35 / max(uBandCount, 1.0));
  float latN = clamp((lat + warp) * 0.5 + 0.5, 0.0, 1.0);

  vec2 bp = bandLookup(latN, max(uBandCount, 1.0), uNoiseSeed);
  vec3 thisCol = bandColorAt(bp.x, uNoiseSeed);
  // Soften the seam between adjacent bands (a hard step reads as "mushy" at
  // the exact boundary either way — this blends only the outer ~1/5th of
  // each band's width into its neighbour, per §2.1's smoothstep-steepness note).
  float distToEdge = min(bp.y, 1.0 - bp.y);
  float edgeBlend = 1.0 - smoothstep(0.0, 0.22, distToEdge);
  float nIdx = clamp(bp.x + (bp.y < 0.5 ? -1.0 : 1.0), 0.0, max(uBandCount - 1.0, 0.0));
  vec3 neighborCol = bandColorAt(nIdx, uNoiseSeed);
  vec3 bandCol = mix(thisCol, neighborCol, edgeBlend * 0.5);

  // Contrast gate: ice giants collapse almost to the ramp midpoint (≤0.06 —
  // "almost featureless is correct"), gas giants keep near-full contrast.
  vec3 midCol = mix(uBandA, uBandB, 0.5);
  vec3 col = mix(midCol, bandCol, clamp(uBandContrast, 0.0, 1.0));

  // Fine cloud turbulence.
  float fine = snoise(vDir * 12.0 + uNoiseSeed + vec3(uTime * 0.03, 0.0, 0.0));
  col *= 0.9 + 0.1 * fine;

  // Polar cutoff (~|lat| 50°, §2.1/§2.2): bands fade to mottled vortex fBm
  // instead of running stripes pole-to-pole.
  float latDeg = degrees(asin(clamp(vDir.y, -1.0, 1.0)));
  float polarMix = smoothstep(45.0, 55.0, abs(latDeg));
  if (polarMix > 0.001){
    vec3 vp = vDir * 6.0 + uNoiseSeed * 1.3;
    float v1 = snoise(vp + vec3(uTime * 0.01, 0.0, 0.0));
    float v2 = snoise(vp * 2.3 + 11.0);
    float vf = v1 * 0.6 + v2 * 0.4;
    vec3 vortexCol = mix(uBandA, uBandB, 0.5 + 0.5 * vf) * (0.85 + 0.25 * vf);
    col = mix(col, vortexCol, polarMix);
  }

  // Seeded storm/streak population (§2.1's "a RULE, not noise") — at most one
  // giant anticyclone + 2-5 medium ovals with a one-shot analytic spiral warp
  // for gas giants, or a handful of bright zonal streaks (elongated via the
  // aspect stretch below) for ice giants. Placement is CPU-seeded at
  // band-shear latitudes (continuum/index.ts), not drawn here.
  for (int i = 0; i < MAX_STORMS; i++){
    if (i >= uStormCount) break;
    vec3 center = uStormPos[i];
    float aspect = max(uStormAspect[i], 1e-3);
    vec3 up = abs(center.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 zonal = normalize(cross(up, center));  // east-west (constant-latitude) tangent
    vec3 merid = cross(center, zonal);          // north-south tangent
    vec3 delta = vDir - center;
    float az = dot(delta, zonal) / aspect;      // aspect > 1 stretches reach zonally
    float am = dot(delta, merid);
    float d = length(vec2(az, am));
    float r = max(uStormRadius[i], 1e-3);
    float influence = smoothstep(r, r * 0.15, d);
    if (influence <= 0.001) continue;
    if (uStormSpiral[i] > 0.0){
      // One-shot analytic spiral warp: theta += strength * exp(-d^2/r^2)
      // (§2.1) via a Rodrigues rotation of the sample direction around the
      // storm's own axis, so the interior noise reads as a spiral, not a
      // flat oval.
      float ang = uStormSpiral[i] * exp(-(d * d) / (r * r));
      float ca = cos(ang), sa = sin(ang);
      vec3 warped = vDir * ca + cross(center, vDir) * sa + center * dot(center, vDir) * (1.0 - ca);
      float swirl = snoise(warped * 16.0 + uNoiseSeed * 1.7) * 0.5 + 0.5;
      vec3 stormCol = mix(uStormColor[i] * 0.75, uStormColor[i] * 1.15, swirl);
      col = mix(col, stormCol, influence * 0.9);
    } else {
      // Bright transient streak (ice giants): additive, not a replace-mix,
      // so it reads as a lit cloud on top of the haze rather than a patch.
      col += uStormColor[i] * influence * 0.55;
    }
  }

  // Real-photo override: replaces the procedural band colour with the real
  // bundled photo (sampled via a standard equirect projection of this
  // fragment's own object-space direction — same lon=atan2(z,x)/lat=asin(y)
  // convention continuum/real-albedo.ts's CPU sampler and generators/
  // climate-provider.ts's band lookup already share) BEFORE the lighting
  // below — the limb-darkening/day-night terms still apply on top exactly as
  // they do for the procedural band colour, so real Jupiter/Saturn/Uranus/
  // Neptune still get this shader's own lighting treatment, not a bypass.
  if (uUseAlbedoMap > 0.5){
    float rLon = atan(vDir.z, vDir.x);
    float rLat = asin(clamp(vDir.y, -1.0, 1.0));
    vec2 rUv = vec2(rLon / 6.28318530718 + 0.5, 0.5 - rLat / 3.14159265359);
    col = texture2D(uAlbedoMap, rUv).rgb;
  }

  // Jónsson limb-darkening model (§2.1/§2.2, https://bjj.mmedia.is/3dtest/jup_shading.html):
  // cos(i)^0.85 diffuse power, plus a per-channel multiplier that kicks in
  // past cos(e) < 0.75 and is strongest at zero phase angle — the B channel's
  // much larger residual (rc=0.5) is what gives the limb its faint blue tint.
  vec3 V = normalize(cameraPosition - vWorldPos);
  float nde = max(dot(N, V), 0.0001);              // cos(e)
  float cosA = clamp(dot(uSunDir, V), -1.0, 1.0);  // cos(phase angle), approx
  float diffuse = pow(clamp(ndl, 0.0, 1.0), 0.85);
  vec3 limbMul = vec3(1.0);
  if (nde < 0.75){
    float ratio = clamp(nde, 0.0001, 0.75) / 0.75;
    float phaseF = clamp((cosA + 1.0) * 0.5, 0.0, 1.0);
    vec3 rp = vec3(0.2, 0.125, 0.04);
    vec3 rc = vec3(0.1, 0.07, 0.5);
    vec3 mulFull = pow(vec3(ratio), rp * (1.0 - rc)) + rc;
    limbMul = mix(vec3(1.0), mulFull, phaseF);
  }

  vec3 lit = col * limbMul * (0.06 + 0.94 * day * diffuse);
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
