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

import { GLSL_SIMPLEX, GLSL_FBM, GLSL_RAMP } from './glsl';

// ── Surface globe (cube-sphere terrain) ─────────────────────────────
export const SURFACE_VERT = /* glsl */ `
${GLSL_SIMPLEX}
${GLSL_FBM}
uniform float uDisplacement;
varying vec3  vWorldPos;
varying vec3  vWorldNormal;
varying vec3  vDir;      // undisplaced object-space unit direction
varying float vHeight;   // [0,1] terrain height

void main(){
  vec3 dir = normalize(position);
  float h = terrainHeight(dir);
  vHeight = h;
  vDir = dir;

  // Finite-difference normal on the sphere tangent plane → lit relief.
  vec3 up = abs(dir.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
  vec3 t = normalize(cross(up, dir));
  vec3 b = cross(dir, t);
  float eps = 0.02;
  float hT = terrainHeight(normalize(dir + t*eps));
  float hB = terrainHeight(normalize(dir + b*eps));
  vec3 grad = (t*(hT-h) + b*(hB-h)) / eps;
  vec3 nObj = normalize(dir - grad * uDisplacement * 4.0);

  // Displace land radially; centre the mean so the globe keeps its radius.
  float disp = uDisplacement * (h - 0.5);
  vec3 displaced = position * (1.0 + disp);

  vWorldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;
  vWorldNormal = normalize(normalMatrix * nObj);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

export const SURFACE_FRAG = /* glsl */ `
${GLSL_SIMPLEX}
${GLSL_RAMP}
uniform vec3  uSunDir;        // world-space, surface → sun
uniform float uSeaLevel;
uniform vec3  uOceanShallow;
uniform vec3  uOceanDeep;
uniform float uLatitudeIce;
uniform float uMoisture;
uniform float uRoughness;
uniform vec3  uEmissive;
uniform float uEmissiveStrength;
uniform float uNightLights;
uniform float uTerminator;    // terminator softness
uniform vec3  uAtmosTint;
varying vec3  vWorldPos;
varying vec3  vWorldNormal;
varying vec3  vDir;
varying float vHeight;

void main(){
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndl = dot(N, uSunDir);
  float day = smoothstep(-uTerminator, uTerminator, ndl);

  bool ocean = uSeaLevel > 0.0 && vHeight < uSeaLevel;
  vec3 albedo;
  float spec = 0.0;
  if (ocean){
    float depth = clamp((uSeaLevel - vHeight) / max(uSeaLevel, 1e-3), 0.0, 1.0);
    albedo = mix(uOceanShallow, uOceanDeep, depth);
    // Fresnel + sun glint (Lague-style water, done on-surface).
    float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 H = normalize(uSunDir + V);
    spec = pow(max(dot(N, H), 0.0), 80.0) * day;
    albedo = mix(albedo, uAtmosTint, fres * 0.4);
  } else {
    float hh = uSeaLevel > 0.0 ? (vHeight - uSeaLevel) / max(1.0 - uSeaLevel, 1e-3) : vHeight;
    albedo = sampleRamp(clamp(hh, 0.0, 1.0));
    // Moisture darkens/greens lowlands a touch.
    albedo = mix(albedo, albedo * vec3(0.8, 1.05, 0.8), uMoisture * (1.0 - hh) * 0.5);
    // Latitude ice caps.
    float lat = abs(vDir.y);
    float ice = smoothstep(1.0 - uLatitudeIce * 0.6, 1.0, lat) * step(uSeaLevel, vHeight);
    albedo = mix(albedo, vec3(0.95, 0.97, 1.0), ice);
  }

  // Lambert + soft terminator.
  vec3 lit = albedo * (0.05 + 0.95 * day * max(ndl, 0.0));
  lit += spec * (1.0 - uRoughness) * vec3(1.0);

  // Lava emissive (glows in the low cracks, brightest on the night side).
  if (uEmissiveStrength > 0.0){
    float glow = smoothstep(uSeaLevel + 0.1, uSeaLevel - 0.1, vHeight);
    lit += uEmissive * uEmissiveStrength * glow * (0.4 + 0.6 * (1.0 - day));
  }

  // Night-side city lights where there's land (NdotL<0), a hashed mask.
  if (uNightLights > 0.0){
    float night = 1.0 - day;
    float land = step(uSeaLevel, vHeight);
    float m = snoise(vDir * 40.0);
    float lights = smoothstep(0.72, 0.9, m) * land * night;
    lit += vec3(1.0, 0.85, 0.5) * lights * uNightLights;
  }

  gl_FragColor = vec4(lit, 1.0);
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
  vWorldNormal = normalize(normalMatrix * vDir);
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
  vWorldNormal = normalize(normalMatrix * normalize(position));
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
