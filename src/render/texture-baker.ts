// ═══════════════════════════════════════════════════════════════════
// PLANET TEXTURE BAKER — GPU equirectangular bake (Phase 2)
//
// Replaces the per-pixel CPU canvas loop in procedural-textures.ts. A
// fullscreen quad is rendered into an equirect render target; per pixel
//   phi   = uv.y · π          (colatitude, 0=N pole … π=S pole)
//   theta = uv.x · 2π         (longitude)
//   dir   = (sinφ cosθ, sinφ sinθ, cosφ)   — pole on +Z, mirrors the old
//                                            CPU makeSpherical() exactly
// and ALL noise is evaluated in 3D on that unit direction. Two free wins
// fall out of 3D-direction sourcing (parallelcascades.com/planet-texture-
// baking-part-1): the antimeridian seam vanishes (u=0 and u=1 sample the
// identical 3D point) and there is no polar pinch (sinφ→0 collapses to a
// single constant direction, not a smeared row).
//
// The RT is a scratch buffer only: we read it back into a <canvas> and
// return a CanvasTexture — the SAME texture type the CPU path produced —
// so the LOD ladder, IndexedDB cache, colorspace, and flipY conventions
// downstream are byte-for-byte unchanged. Bake cost is ~1 frame + an 8 MB
// readback vs the old 100–300 ms CPU loop.
//
// See docs/planet-visual-realism.md §4.1 / §5 Phase 2.
// ═══════════════════════════════════════════════════════════════════

import {
  WebGLRenderer, WebGLRenderTarget, Scene, OrthographicCamera, Mesh,
  PlaneGeometry, ShaderMaterial, LinearFilter, RGBAFormat, UnsignedByteType,
  SRGBColorSpace,
} from 'three';
import type { PlanetRecipeId } from './procedural-textures';

// ── Renderer registration ────────────────────────────────────────
// The baker needs the live WebGLRenderer. main.ts registers it once at
// boot, before populateWorld() triggers any planet generation (same
// pattern as bakeGalaxyBackdrop receiving the renderer).

let _renderer: WebGLRenderer | null = null;
export function setBakeRenderer(renderer: WebGLRenderer): void {
  _renderer = renderer;
}

// ── GLSL: 3D simplex noise (Ashima / Stefan Gustavson, MIT) ──────────
// Domain-offset by uSeed inside the recipe samplers so each planet's
// hash seeds a distinct-but-deterministic surface (parity tolerance:
// "same archetype read, seeds re-rolled is fine" — §5 Phase 2).

const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
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
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
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

uniform vec3 uSeed;
float sn(vec3 p){ return snoise(p + uSeed); }

float fbm(vec3 p, int octaves, float lac, float gain){
  float a = 0.5, f = 1.0, sum = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= octaves) break;
    sum += a * sn(p * f);
    f *= lac; a *= gain;
  }
  return sum;
}
`;

// ── GLSL: palette + per-recipe surface functions ────────────────────
// gradientLUT(t) ports of the CPU stop lists. Colors authored as sRGB
// 0–1 (CPU 0–255 ÷ 255); the main() converts to linear on write so the
// SRGBColorSpace readback round-trips to the same bytes the CPU wrote.

const RECIPE_GLSL: Record<PlanetRecipeId, string> = {
  // Vulcan — Mercury-like cratered gray-brown
  vulcan: /* glsl */ `
    vec3 surfaceColor(vec3 dir, float vLat){
      float base = fbm(dir*4.0, 6, 2.0, 0.55) * 0.5 + 0.5;
      float craters = abs(sn(dir*12.0));
      float t = base*0.8 + craters*0.2;
      vec3 c = mix(vec3(60,50,45),   vec3(100,90,80),  smoothstep(0.0,0.3,t));
      c = mix(c, vec3(130,120,105), smoothstep(0.3,0.5,t));
      c = mix(c, vec3(150,140,125), smoothstep(0.5,0.7,t));
      c = mix(c, vec3(170,160,145), smoothstep(0.7,1.0,t));
      return c/255.0;
    }`,

  // Ragnarok — Venus-like ochre cloud bands with dark volcanic patches
  ragnarok: /* glsl */ `
    vec3 surfaceColor(vec3 dir, float vLat){
      float wx = sn(dir*3.0) * 0.4;
      float wy = sn(dir*3.0 + vec3(100.0,0.0,0.0)) * 0.4;
      float clouds = fbm(dir*5.0 + vec3(wx,wy,0.0), 5, 2.2, 0.5) * 0.5 + 0.5;
      float volc = sn(dir*8.0) * 0.5 + 0.5;
      float t = clouds*0.7 + volc*0.3;
      vec3 c = mix(vec3(80,40,20),   vec3(140,80,30),  smoothstep(0.0,0.2,t));
      c = mix(c, vec3(190,130,50),  smoothstep(0.2,0.4,t));
      c = mix(c, vec3(210,160,70),  smoothstep(0.4,0.6,t));
      c = mix(c, vec3(220,180,100), smoothstep(0.6,0.8,t));
      c = mix(c, vec3(230,200,130), smoothstep(0.8,1.0,t));
      return c/255.0;
    }`,

  // Romulus — Oceanic: deep blue oceans, teal-green land, polar ice
  romulus: /* glsl */ `
    vec3 surfaceColor(vec3 dir, float vLat){
      float terrain = fbm(dir*5.0, 6, 2.0, 0.5) * 0.5 + 0.5;
      float detail = sn(dir*15.0) * 0.1;
      float elev = terrain + detail;
      float seaLevel = 0.48;
      float polar = abs(cos(vLat * 3.14159265));
      if (polar > 0.85){
        float ice = (polar - 0.85) / 0.15;
        vec3 base = elev > seaLevel ? vec3(40,120,80) : vec3(30,80,140);
        return mix(base, vec3(220,230,240), clamp(ice,0.0,1.0)) / 255.0;
      }
      if (elev < seaLevel){
        float depth = elev / seaLevel;
        vec3 c = mix(vec3(10,25,60),  vec3(20,50,110), smoothstep(0.0,0.4,depth));
        c = mix(c, vec3(30,70,140),  smoothstep(0.4,0.7,depth));
        c = mix(c, vec3(40,90,160),  smoothstep(0.7,1.0,depth));
        return c/255.0;
      }
      float land = (elev - seaLevel) / (1.0 - seaLevel);
      vec3 c = mix(vec3(30,100,70),  vec3(50,120,60),  smoothstep(0.0,0.3,land));
      c = mix(c, vec3(80,110,50),   smoothstep(0.3,0.6,land));
      c = mix(c, vec3(120,100,60),  smoothstep(0.6,0.8,land));
      c = mix(c, vec3(160,140,100), smoothstep(0.8,1.0,land));
      return c/255.0;
    }`,

  // Pax — Mars-like rust-red desert with dark basalt ridges
  pax: /* glsl */ `
    vec3 surfaceColor(vec3 dir, float vLat){
      float base = fbm(dir*4.0, 6, 2.1, 0.5) * 0.5 + 0.5;
      float ridges = 1.0 - abs(sn(dir*8.0));
      float t = base*0.7 + ridges*0.3;
      vec3 c = mix(vec3(80,30,15),   vec3(140,60,25),  smoothstep(0.0,0.2,t));
      c = mix(c, vec3(180,90,40),   smoothstep(0.2,0.4,t));
      c = mix(c, vec3(200,120,60),  smoothstep(0.4,0.6,t));
      c = mix(c, vec3(210,150,90),  smoothstep(0.6,0.8,t));
      c = mix(c, vec3(220,180,140), smoothstep(0.8,1.0,t));
      return c/255.0;
    }`,

  // Jotunheim — GasGiant (Jupiter-class). Seeded 1D latitude band profile
  // (perturbed widths, smoothstep belt/zone edges) → photo-derived ramp;
  // bands fade to a mottled vortex above ~|lat| 50°; one GRS-class storm
  // with analytic spiral warp + brick tint. docs §2.1.
  jotunheim: /* glsl */ `
    uniform float uBandCount;
    uniform float uPolarLat;
    uniform float uSaturn;
    uniform int   uStormCount;
    uniform vec4  uStorms[6];   // (u, v, radius, strength)

    // Jupiter ramp: belts (dark) → zones (pale). Desaturated tans/browns/creams.
    vec3 jupRamp(float t){
      vec3 c = mix(vec3(64.0,68.0,54.0),   vec3(144.0,97.0,77.0),  smoothstep(0.0,0.2,t));
      c = mix(c, vec3(200.0,139.0,58.0),  smoothstep(0.2,0.4,t));
      c = mix(c, vec3(211.0,156.0,126.0), smoothstep(0.4,0.6,t));
      c = mix(c, vec3(167.0,156.0,134.0), smoothstep(0.6,0.8,t));
      c = mix(c, vec3(210.0,207.0,218.0), smoothstep(0.8,1.0,t));
      return c/255.0;
    }
    // Saturn ramp: low-contrast butterscotch family (value-only variation).
    vec3 satRamp(float t){
      return mix(vec3(0.62,0.58,0.50), vec3(0.88,0.83,0.72), smoothstep(0.0,1.0,t));
    }

    // 1D band field: zonal turbulence perturbs the latitude lookup, seeded
    // varying widths, smoothstep belt/zone edges, per-band value jitter.
    float bandField(float lat01, vec3 dir){
      float turb = fbm(vec3(dir.x*0.6, dir.y*0.6, dir.z*3.0), 5, 2.1, 0.55);
      float l = lat01 + turb * 0.035;
      float phase = l * uBandCount + 0.55 * sn(vec3(0.0, 0.0, l*3.0));
      float tri = abs(fract(phase) - 0.5) * 2.0;          // triangle 0..1..0
      float band = smoothstep(0.22, 0.78, tri);
      float bandId = floor(phase);
      band += sn(vec3(bandId*1.7, 0.0, 0.0)) * 0.12;       // per-band value jitter
      band += fbm(vec3(dir.x*0.8, dir.y*0.8, dir.z*8.0), 4, 2.0, 0.5) * 0.06; // deck detail
      return clamp(band, 0.0, 1.0);
    }

    vec3 surfaceColor(vec3 dir, float vLat){
      float absLat = abs(vLat - 0.5) * 2.0;
      float bf = bandField(vLat, dir);
      vec3 col = uSaturn > 0.5 ? satRamp(bf) : jupRamp(bf);

      // Polar cutoff: crossfade bands → muted mottled vortex above ~50°.
      float polar = smoothstep(uPolarLat, uPolarLat + 0.18, absLat);
      if (polar > 0.001){
        float vortex = fbm(dir*6.0, 5, 2.0, 0.5) * 0.5 + 0.5;
        vec3 polarCol = (uSaturn > 0.5 ? satRamp(0.4) : jupRamp(0.45)) * (0.7 + 0.3*vortex);
        col = mix(col, polarCol, polar);
      }

      // Storms — analytic ovals: spiral-warped detail + brick/salmon tint.
      for (int i = 0; i < 6; i++){
        if (i >= uStormCount) break;
        vec4 s = uStorms[i];
        float du = vUv.x - s.x; du -= floor(du + 0.5);     // longitude wrap [0,1]
        float dv = vLat - s.y;
        float d2 = (du*du)*2.4 + dv*dv;                    // elliptical (wider in lon)
        float infl = exp(-d2 / (s.z*s.z));
        if (infl > 0.002){
          float ang = infl * s.w * 5.0;                    // spiral by influence
          float ca = cos(ang), sa = sin(ang);
          vec2 rot = vec2(ca*du - sa*dv, sa*du + ca*dv);
          float swirl = fbm(vec3(rot*38.0, 0.0) + dir*2.0, 4, 2.0, 0.5) * 0.5 + 0.5;
          vec3 brick = mix(vec3(200.0,139.0,58.0)/255.0, vec3(144.0,97.0,77.0)/255.0, swirl);
          col = mix(col, brick * (0.85 + 0.3*swirl), smoothstep(0.0, 1.0, infl));
        }
      }
      return col;
    }`,

  // Niflheim — IceGiant (Uranus-class). Pale greenish-cyan methane haze with
  // 2–4 barely-visible bands (Irwin 2024: Neptune's cobalt is a Voyager
  // contrast-stretch artifact — pale is correct). Optional faint zonal
  // streaks near ~35° lat. docs §2.2.
  niflheim: /* glsl */ `
    uniform float uStreak;

    // Uranus photo ramp (#65868B → #93B8BE → #BBE1E4 → #D5FBFC).
    vec3 uranRamp(float t){
      vec3 c = mix(vec3(101.0,134.0,139.0), vec3(147.0,184.0,190.0), smoothstep(0.0,0.33,t));
      c = mix(c, vec3(187.0,225.0,228.0), smoothstep(0.33,0.66,t));
      c = mix(c, vec3(213.0,251.0,252.0), smoothstep(0.66,1.0,t));
      return c/255.0;
    }

    vec3 surfaceColor(vec3 dir, float vLat){
      float absLat = abs(vLat - 0.5) * 2.0;
      // Barely-visible bands (contrast crushed to ~0.06) under heavy haze.
      float band = sin(vLat * 3.14159265 * 6.0) * 0.5 + 0.5;
      band = mix(0.5, band, 0.10);
      float haze = fbm(dir*2.0, 3, 2.0, 0.5) * 0.06;       // low-pass methane haze
      float t = clamp(0.62 + (band - 0.5)*0.12 + haze - absLat*0.12, 0.0, 1.0);
      vec3 col = uranRamp(t);

      // Optional faint bright cloud streak near ~35° latitude (both hemispheres).
      if (uStreak > 0.5){
        float s = exp(-pow((absLat - 0.62) / 0.05, 2.0));
        float sn8 = fbm(vec3(dir.x*0.5, dir.y*0.5, dir.z*8.0), 4, 2.0, 0.5) * 0.5 + 0.5;
        col = mix(col, vec3(0.95,0.99,1.0), s * smoothstep(0.6,0.9,sn8) * 0.5);
      }
      return col;
    }`,

  // Helheim — dark blue-gray dwarf with bright ice fractures
  helheim: /* glsl */ `
    vec3 surfaceColor(vec3 dir, float vLat){
      float base = fbm(dir*5.0, 5, 2.0, 0.5) * 0.5 + 0.5;
      float ridge = 1.0 - abs(sn(dir*10.0));
      float fracture = pow(max(0.0, ridge - 0.6) / 0.4, 2.0);
      vec3 c = mix(vec3(30,35,50),  vec3(50,55,70),  smoothstep(0.0,0.3,base));
      c = mix(c, vec3(65,70,85),    smoothstep(0.3,0.6,base));
      c = mix(c, vec3(80,85,100),   smoothstep(0.6,1.0,base));
      c = mix(c, vec3(180,200,230), clamp(fracture*0.7, 0.0, 1.0));
      return c/255.0;
    }`,
};

function fragmentFor(recipeId: PlanetRecipeId): string {
  return /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    ${NOISE_GLSL}
    ${RECIPE_GLSL[recipeId]}
    void main(){
      float theta = vUv.x * 6.28318530718;   // longitude 0..2π
      float phi   = vUv.y * 3.14159265359;    // colatitude 0..π
      vec3 dir = vec3(sin(phi)*cos(theta), sin(phi)*sin(theta), cos(phi));
      vec3 c = surfaceColor(dir, vUv.y);
      // sRGB→linear on write; RT is SRGBColorSpace so three re-encodes,
      // making the readback bytes match the old CPU sRGB canvas exactly.
      gl_FragColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(2.2)), 1.0);
    }
  `;
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }
`;

// ── Offscreen bake rig (created lazily, reused across all bakes) ─────

let _scene: Scene | null = null;
let _camera: OrthographicCamera | null = null;
let _quad: Mesh | null = null;
let _material: ShaderMaterial | null = null;

function ensureRig(): void {
  if (_quad) return;
  _scene = new Scene();
  _camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  _material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: fragmentFor('vulcan'), // replaced per-bake
    uniforms: {
      uSeed: { value: [0, 0, 0] },
      // Giant/ice-giant structure (Phase 3a). Unused by other recipes —
      // three skips uniforms the compiled program doesn't reference.
      uBandCount: { value: 11 },     // visible zonal bands
      uPolarLat: { value: 0.56 },    // |lat|·2 where bands fade to vortex (~50°)
      uSaturn: { value: 0 },         // 0 Jupiter-class, 1 Saturn-class
      uStormCount: { value: 0 },
      uStorms: { value: new Float32Array(24) }, // vec4[6]: (u, v, radius, strength)
      uStreak: { value: 0 },         // ice giant: 1 = show faint cloud streaks
    },
  });
  // Fullscreen clip-space triangle pair (positions ARE clip coords).
  _quad = new Mesh(new PlaneGeometry(2, 2), _material);
  _scene.add(_quad);
}

// Hash a 32-bit seed into a large vec3 domain offset that decorrelates
// each planet's noise field. Frequencies in the recipes top out ~15, so
// offsets in the hundreds fully separate seeds.
function seedOffset(seed: number): [number, number, number] {
  const a = (Math.sin(seed * 12.9898) * 43758.5453) % 1;
  const b = (Math.sin(seed * 78.233 + 1.0) * 43758.5453) % 1;
  const c = (Math.sin(seed * 39.425 + 2.0) * 43758.5453) % 1;
  return [a * 600 + 100, b * 600 + 100, c * 600 + 100];
}

// Deterministic [0,1) from an integer seed + salt (avoids Math.random;
// matches the float-hash style used elsewhere in the project).
function hash01(seed: number, salt: number): number {
  const x = Math.sin(seed * 0.0001 + salt * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// Per-recipe structural uniforms derived from the seed. Only the gas/ice
// giants consume these; other recipes leave the defaults untouched.
function applyGiantUniforms(recipeId: PlanetRecipeId, seed: number, u: Record<string, { value: unknown }>): void {
  // Reset to inert defaults each bake (the material is shared).
  u.uStormCount!.value = 0;
  u.uStreak!.value = 0;
  u.uSaturn!.value = 0;

  if (recipeId === 'jotunheim') {
    // Jupiter-class: 10–14 bands, polar cutoff ~50°, one GRS-class oval at a
    // shear latitude (~22°S → vLat 0.62) plus a couple of medium ovals.
    u.uBandCount!.value = 10 + Math.floor(hash01(seed, 1) * 5); // 10–14
    u.uPolarLat!.value = 0.55 + hash01(seed, 2) * 0.06;         // ~50–55°
    u.uSaturn!.value = 0;
    const storms = u.uStorms!.value as Float32Array;
    // Great oval: u seeded, v=0.62 (22°S), large radius, strong swirl.
    const greatV = 0.62;
    storms.set([hash01(seed, 3), greatV, 0.11, 1.0], 0);
    // Two medium ovals at other shear latitudes, opposite hemisphere spread.
    storms.set([hash01(seed, 4), 0.40, 0.055, 0.7], 4);
    storms.set([hash01(seed, 5), 0.71, 0.05, 0.6], 8);
    u.uStormCount!.value = 3;
  } else if (recipeId === 'niflheim') {
    // Uranus-class ice giant: faint streaks ~30% of seeds (Niflheim's seed decides).
    u.uStreak!.value = hash01(seed, 7) < 0.35 ? 1 : 0;
  }
}

let _lastRecipe: PlanetRecipeId | null = null;

/**
 * GPU-bake a recipe into an equirect <canvas>. Returns the canvas so the
 * existing LOD/cache/delivery code in procedural-textures.ts is unchanged.
 * Throws if the renderer was never registered (should be impossible —
 * setBakeRenderer runs at boot before any planet is built).
 */
export function bakeRecipeToCanvas(
  recipeId: PlanetRecipeId,
  seed: number,
  width: number,
  height: number,
): HTMLCanvasElement {
  if (!_renderer) {
    throw new Error('[TextureBaker] renderer not registered — call setBakeRenderer() at boot');
  }
  ensureRig();
  const renderer = _renderer;
  const mat = _material!;

  // Recompile the fragment shader only when the recipe changes from the
  // previous bake (each recipe is a distinct GLSL surfaceColor body).
  if (_lastRecipe !== recipeId) {
    mat.fragmentShader = fragmentFor(recipeId);
    mat.needsUpdate = true;
    _lastRecipe = recipeId;
  }
  mat.uniforms.uSeed.value = seedOffset(seed);
  applyGiantUniforms(recipeId, seed, mat.uniforms);

  const rt = new WebGLRenderTarget(width, height, {
    format: RGBAFormat,
    type: UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
    colorSpace: SRGBColorSpace,
  });

  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(_scene!, _camera!);

  // Read back the sRGB-encoded bytes (RT is SRGBColorSpace, so the write
  // re-encoded our linear output back to sRGB).
  const buffer = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, width, height, buffer);
  renderer.setRenderTarget(prevTarget);
  rt.dispose();

  // WebGL framebuffer rows are bottom-to-top; the equirect convention
  // (and the old CPU canvas) is top-to-bottom (north pole at row 0).
  // Flip rows while copying into ImageData.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * rowBytes;
    img.data.set(buffer.subarray(src, src + rowBytes), y * rowBytes);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
