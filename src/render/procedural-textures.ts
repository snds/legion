// ═══════════════════════════════════════════════════════════════════
// PROCEDURAL PLANET TEXTURES — Per-Planet-Type Generation
// Generates unique planet surfaces using layered simplex noise with
// domain warping. Each planet type has a distinct visual recipe.
//
// Pipeline:
//   1. Check IndexedDB cache for existing LODs
//   2. If uncached, generate 2K master in chunked batches (non-blocking)
//   3. Downsample to LOD 0 (512px) for instant visibility
//   4. Cache all LODs in IndexedDB via Dexie
//   5. Planets are generated one at a time to avoid thread starvation
//
// Texture version is bumped when algorithm changes to force regen.
// ═══════════════════════════════════════════════════════════════════

import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace, type Texture } from 'three';
import { textureDb } from '../persistence/save-db';

// ── Constants ────────────────────────────────────────────────────

const TEXTURE_VERSION = 2;  // Bumped: new master resolution + chunked gen

// Master texture resolution — 2K is fast enough for real-time generation
// while looking great at system zoom. Each planet takes ~100-300ms.
const MASTER_W = 2048;
const MASTER_H = 1024;

// LOD resolutions (downsampled from master)
const LOD_DEFS = [
  { level: 0, w: 512,  h: 256 },   // < 50px on screen — instant load
  { level: 1, w: 2048, h: 1024 },   // 50px+ — full master resolution
] as const;

// Rows to process per animation frame during chunked generation
const ROWS_PER_CHUNK = 64;

// ── Simplex Noise (2D/3D) ────────────────────────────────────────
// Compact implementation — no external dependencies.

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

const grad3 = [
  [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
  [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
  [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
];

// Permutation table (seeded)
let perm: Uint8Array;
let perm12: Uint8Array;

function seedNoise(seed: number): void {
  const p = new Uint8Array(256);
  // Simple LCG seeded shuffle
  let s = seed | 0;
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) | 0;
    const j = ((s >>> 0) % (i + 1));
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  perm = new Uint8Array(512);
  perm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    perm12[i] = perm[i] % 12;
  }
}

function noise2D(x: number, y: number): number {
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const X0 = i - t, Y0 = j - t;
  const x0 = x - X0, y0 = y - Y0;
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;

  let n0 = 0, n1 = 0, n2 = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) { t0 *= t0; const gi = perm12[ii + perm[jj]]; n0 = t0 * t0 * (grad3[gi][0] * x0 + grad3[gi][1] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) { t1 *= t1; const gi = perm12[ii + i1 + perm[jj + j1]]; n1 = t1 * t1 * (grad3[gi][0] * x1 + grad3[gi][1] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) { t2 *= t2; const gi = perm12[ii + 1 + perm[jj + 1]]; n2 = t2 * t2 * (grad3[gi][0] * x2 + grad3[gi][1] * y2); }

  return 70 * (n0 + n1 + n2); // [-1, 1]
}

function noise3D(x: number, y: number, z: number): number {
  const s = (x + y + z) * F3;
  const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
  const t = (i + j + k) * G3;
  const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);

  let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
  if (x0 >= y0) {
    if (y0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; }
    else if (x0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; }
    else { i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; }
  } else {
    if (y0 < z0) { i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; }
    else if (x0 < z0) { i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; }
    else { i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; }
  }

  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2*G3, y2 = y0 - j2 + 2*G3, z2 = z0 - k2 + 2*G3;
  const x3 = x0 - 1 + 3*G3, y3 = y0 - 1 + 3*G3, z3 = z0 - 1 + 3*G3;

  const ii = i & 255, jj = j & 255, kk = k & 255;
  let n = 0;

  let tt = 0.6 - x0*x0 - y0*y0 - z0*z0;
  if (tt > 0) { tt *= tt; const gi = perm12[ii + perm[jj + perm[kk]]]; n += tt * tt * (grad3[gi][0]*x0 + grad3[gi][1]*y0 + grad3[gi][2]*z0); }
  tt = 0.6 - x1*x1 - y1*y1 - z1*z1;
  if (tt > 0) { tt *= tt; const gi = perm12[ii+i1 + perm[jj+j1 + perm[kk+k1]]]; n += tt * tt * (grad3[gi][0]*x1 + grad3[gi][1]*y1 + grad3[gi][2]*z1); }
  tt = 0.6 - x2*x2 - y2*y2 - z2*z2;
  if (tt > 0) { tt *= tt; const gi = perm12[ii+i2 + perm[jj+j2 + perm[kk+k2]]]; n += tt * tt * (grad3[gi][0]*x2 + grad3[gi][1]*y2 + grad3[gi][2]*z2); }
  tt = 0.6 - x3*x3 - y3*y3 - z3*z3;
  if (tt > 0) { tt *= tt; const gi = perm12[ii+1 + perm[jj+1 + perm[kk+1]]]; n += tt * tt * (grad3[gi][0]*x3 + grad3[gi][1]*y3 + grad3[gi][2]*z3); }

  return 32 * n; // [-1, 1]
}

// ── FBM (Fractal Brownian Motion) ────────────────────────────────

function fbm2D(x: number, y: number, octaves: number, lacunarity = 2.0, gain = 0.5): number {
  let val = 0, amp = 1, freq = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    val += noise2D(x * freq, y * freq) * amp;
    max += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return val / max;
}

function fbm3D(x: number, y: number, z: number, octaves: number, lacunarity = 2.0, gain = 0.5): number {
  let val = 0, amp = 1, freq = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    val += noise3D(x * freq, y * freq, z * freq) * amp;
    max += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return val / max;
}

// ── Color Utilities ──────────────────────────────────────────────

type RGB = [number, number, number];

function lerpColor(a: RGB, b: RGB, t: number): RGB {
  const s = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * s,
    a[1] + (b[1] - a[1]) * s,
    a[2] + (b[2] - a[2]) * s,
  ];
}

function gradientLUT(stops: { t: number; c: RGB }[], val: number): RGB {
  const v = Math.max(0, Math.min(1, val));
  for (let i = 0; i < stops.length - 1; i++) {
    if (v <= stops[i + 1].t) {
      const range = stops[i + 1].t - stops[i].t;
      const local = range > 0 ? (v - stops[i].t) / range : 0;
      return lerpColor(stops[i].c, stops[i + 1].c, local);
    }
  }
  return stops[stops.length - 1].c;
}

// ── Planet Type Recipes ──────────────────────────────────────────
// Each recipe takes (u, v, seed) → RGB color [0–255].
// u ∈ [0,1] longitude, v ∈ [0,1] latitude.
// We convert to spherical coords for seamless wrapping via 3D noise.

export type PlanetRecipeId = 'vulcan' | 'ragnarok' | 'romulus' | 'pax' | 'jotunheim' | 'niflheim' | 'helheim';

interface PlanetRecipe {
  id: PlanetRecipeId;
  generate: (u: number, v: number, sx: number, sy: number, sz: number) => RGB;
}

function makeSpherical(u: number, v: number): [number, number, number] {
  const theta = u * Math.PI * 2;
  const phi = v * Math.PI;
  return [
    Math.sin(phi) * Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
  ];
}

const RECIPES: Record<PlanetRecipeId, PlanetRecipe> = {
  // Vulcan — Mercury-like cratered gray-brown surface
  vulcan: {
    id: 'vulcan',
    generate(_u, _v, sx, sy, sz) {
      const base = fbm3D(sx * 4, sy * 4, sz * 4, 6, 2.0, 0.55) * 0.5 + 0.5;
      const craters = Math.abs(noise3D(sx * 12, sy * 12, sz * 12));
      const val = base * 0.8 + craters * 0.2;
      return gradientLUT([
        { t: 0.0, c: [60, 50, 45] },
        { t: 0.3, c: [100, 90, 80] },
        { t: 0.5, c: [130, 120, 105] },
        { t: 0.7, c: [150, 140, 125] },
        { t: 1.0, c: [170, 160, 145] },
      ], val);
    },
  },

  // Ragnarok — Venus-like ochre/orange cloud bands with dark volcanic patches
  ragnarok: {
    id: 'ragnarok',
    generate(_u, _v, sx, sy, sz) {
      // Domain warp for swirling clouds
      const wx = noise3D(sx * 3, sy * 3, sz * 3) * 0.4;
      const wy = noise3D(sx * 3 + 100, sy * 3, sz * 3) * 0.4;
      const clouds = fbm3D(sx * 5 + wx, sy * 5 + wy, sz * 5, 5, 2.2, 0.5) * 0.5 + 0.5;
      const volcanic = noise3D(sx * 8, sy * 8, sz * 8) * 0.5 + 0.5;
      const val = clouds * 0.7 + volcanic * 0.3;
      return gradientLUT([
        { t: 0.0, c: [80, 40, 20] },
        { t: 0.2, c: [140, 80, 30] },
        { t: 0.4, c: [190, 130, 50] },
        { t: 0.6, c: [210, 160, 70] },
        { t: 0.8, c: [220, 180, 100] },
        { t: 1.0, c: [230, 200, 130] },
      ], val);
    },
  },

  // Romulus — Oceanic world with deep blue oceans and teal-green landmasses
  romulus: {
    id: 'romulus',
    generate(_u, v, sx, sy, sz) {
      const terrain = fbm3D(sx * 5, sy * 5, sz * 5, 6, 2.0, 0.5) * 0.5 + 0.5;
      const detail = noise3D(sx * 15, sy * 15, sz * 15) * 0.1;
      const elevation = terrain + detail;
      const seaLevel = 0.48;
      const polar = Math.abs(Math.cos(v * Math.PI));

      if (polar > 0.85) {
        // Ice caps
        const iceBlend = (polar - 0.85) / 0.15;
        const base = elevation > seaLevel ? [40, 120, 80] as RGB : [30, 80, 140] as RGB;
        return lerpColor(base, [220, 230, 240], iceBlend);
      }

      if (elevation < seaLevel) {
        // Ocean
        const depth = elevation / seaLevel;
        return gradientLUT([
          { t: 0.0, c: [10, 25, 60] },
          { t: 0.4, c: [20, 50, 110] },
          { t: 0.7, c: [30, 70, 140] },
          { t: 1.0, c: [40, 90, 160] },
        ], depth);
      }
      // Land
      const land = (elevation - seaLevel) / (1 - seaLevel);
      return gradientLUT([
        { t: 0.0, c: [30, 100, 70] },
        { t: 0.3, c: [50, 120, 60] },
        { t: 0.6, c: [80, 110, 50] },
        { t: 0.8, c: [120, 100, 60] },
        { t: 1.0, c: [160, 140, 100] },
      ], land);
    },
  },

  // Pax — Mars-like rust-red desert with dark basalt plateaus
  pax: {
    id: 'pax',
    generate(_u, _v, sx, sy, sz) {
      const base = fbm3D(sx * 4, sy * 4, sz * 4, 6, 2.1, 0.5) * 0.5 + 0.5;
      const ridges = 1 - Math.abs(noise3D(sx * 8, sy * 8, sz * 8));
      const val = base * 0.7 + ridges * 0.3;
      return gradientLUT([
        { t: 0.0, c: [80, 30, 15] },
        { t: 0.2, c: [140, 60, 25] },
        { t: 0.4, c: [180, 90, 40] },
        { t: 0.6, c: [200, 120, 60] },
        { t: 0.8, c: [210, 150, 90] },
        { t: 1.0, c: [220, 180, 140] },
      ], val);
    },
  },

  // Jotunheim — Jupiter-like banded gas giant in amber/cream/brown
  jotunheim: {
    id: 'jotunheim',
    generate(_u, v, sx, sy, sz) {
      // Latitude-based banding
      const lat = v * Math.PI;
      const bands = Math.sin(lat * 12) * 0.3 + Math.sin(lat * 6) * 0.2;
      // Turbulence swirls
      const wx = noise3D(sx * 3, sy * 3, sz * 3) * 0.5;
      const swirl = fbm3D(sx * 6 + wx, sy * 6, sz * 6, 4, 2.0, 0.5) * 0.3;
      const val = (bands + swirl) * 0.5 + 0.5;
      return gradientLUT([
        { t: 0.0, c: [100, 60, 30] },
        { t: 0.2, c: [160, 110, 50] },
        { t: 0.4, c: [200, 160, 90] },
        { t: 0.6, c: [220, 190, 130] },
        { t: 0.8, c: [230, 210, 170] },
        { t: 1.0, c: [240, 225, 200] },
      ], val);
    },
  },

  // Niflheim — Saturn-like pale blue-gray banded ice giant
  niflheim: {
    id: 'niflheim',
    generate(_u, v, sx, sy, sz) {
      const lat = v * Math.PI;
      const bands = Math.sin(lat * 10) * 0.25 + Math.sin(lat * 5) * 0.15;
      const swirl = fbm3D(sx * 5, sy * 5, sz * 5, 4, 2.0, 0.45) * 0.2;
      const val = (bands + swirl) * 0.5 + 0.5;
      return gradientLUT([
        { t: 0.0, c: [80, 100, 130] },
        { t: 0.2, c: [120, 140, 160] },
        { t: 0.4, c: [150, 170, 185] },
        { t: 0.6, c: [175, 190, 200] },
        { t: 0.8, c: [200, 210, 215] },
        { t: 1.0, c: [215, 220, 225] },
      ], val);
    },
  },

  // Helheim — Dark blue-gray dwarf with bright ice fracture lines
  helheim: {
    id: 'helheim',
    generate(_u, _v, sx, sy, sz) {
      const base = fbm3D(sx * 5, sy * 5, sz * 5, 5, 2.0, 0.5) * 0.5 + 0.5;
      // Ice fracture lines — sharp ridges
      const ridge = 1 - Math.abs(noise3D(sx * 10, sy * 10, sz * 10));
      const fracture = Math.pow(Math.max(0, ridge - 0.6) / 0.4, 2);
      const val = base;
      const baseColor = gradientLUT([
        { t: 0.0, c: [30, 35, 50] },
        { t: 0.3, c: [50, 55, 70] },
        { t: 0.6, c: [65, 70, 85] },
        { t: 1.0, c: [80, 85, 100] },
      ], val);
      // Add bright ice fractures
      return lerpColor(baseColor, [180, 200, 230], fracture * 0.7);
    },
  },
};

// ── Planet Name → Recipe Mapping ─────────────────────────────────

const PLANET_RECIPE_MAP: Record<string, PlanetRecipeId> = {
  'Vulcan': 'vulcan',
  'Ragnarok': 'ragnarok',
  'Romulus': 'romulus',
  'Pax': 'pax',
  'Jotunheim': 'jotunheim',
  'Niflheim': 'niflheim',
  'Helheim': 'helheim',
};

// ── Master Texture Generation ────────────────────────────────────

/**
 * Generate master texture canvas in one shot (synchronous).
 * At 2K resolution, this takes ~100-300ms per planet.
 */
function generateMasterCanvas(recipeId: PlanetRecipeId, seed: number): HTMLCanvasElement {
  seedNoise(seed);
  const recipe = RECIPES[recipeId];
  const canvas = document.createElement('canvas');
  canvas.width = MASTER_W;
  canvas.height = MASTER_H;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(MASTER_W, MASTER_H);
  const data = imgData.data;

  for (let py = 0; py < MASTER_H; py++) {
    const v = py / MASTER_H;
    for (let px = 0; px < MASTER_W; px++) {
      const u = px / MASTER_W;
      const [sx, sy, sz] = makeSpherical(u, v);
      const [r, g, b] = recipe.generate(u, v, sx, sy, sz);
      const idx = (py * MASTER_W + px) * 4;
      data[idx] = Math.max(0, Math.min(255, r | 0));
      data[idx + 1] = Math.max(0, Math.min(255, g | 0));
      data[idx + 2] = Math.max(0, Math.min(255, b | 0));
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Generate master texture in chunks across multiple frames.
 * Processes ROWS_PER_CHUNK rows per requestAnimationFrame to avoid blocking.
 */
function generateMasterCanvasChunked(
  recipeId: PlanetRecipeId,
  seed: number,
): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    seedNoise(seed);
    const recipe = RECIPES[recipeId];
    const canvas = document.createElement('canvas');
    canvas.width = MASTER_W;
    canvas.height = MASTER_H;
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.createImageData(MASTER_W, MASTER_H);
    const data = imgData.data;
    let currentRow = 0;

    function processChunk(): void {
      const endRow = Math.min(currentRow + ROWS_PER_CHUNK, MASTER_H);
      for (let py = currentRow; py < endRow; py++) {
        const v = py / MASTER_H;
        for (let px = 0; px < MASTER_W; px++) {
          const u = px / MASTER_W;
          const [sx, sy, sz] = makeSpherical(u, v);
          const [r, g, b] = recipe.generate(u, v, sx, sy, sz);
          const idx = (py * MASTER_W + px) * 4;
          data[idx] = Math.max(0, Math.min(255, r | 0));
          data[idx + 1] = Math.max(0, Math.min(255, g | 0));
          data[idx + 2] = Math.max(0, Math.min(255, b | 0));
          data[idx + 3] = 255;
        }
      }
      currentRow = endRow;

      if (currentRow < MASTER_H) {
        requestAnimationFrame(processChunk);
      } else {
        ctx.putImageData(imgData, 0, 0);
        resolve(canvas);
      }
    }

    requestAnimationFrame(processChunk);
  });
}

// ── Downsampling ─────────────────────────────────────────────────

function downsampleCanvas(master: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(master, 0, 0, w, h);
  return canvas;
}

// ── IndexedDB Cache ──────────────────────────────────────────────

function cacheKey(planetName: string, lodLevel: number): string {
  return `ee-${planetName.toLowerCase()}-lod${lodLevel}-v${TEXTURE_VERSION}`;
}

async function getCachedBlob(planetName: string, lodLevel: number): Promise<Blob | null> {
  try {
    const entry = await textureDb.textures.get(cacheKey(planetName, lodLevel));
    if (entry && entry.version === TEXTURE_VERSION) return entry.blob;
  } catch { /* miss */ }
  return null;
}

async function cacheBlob(planetName: string, lodLevel: number, blob: Blob): Promise<void> {
  try {
    await textureDb.textures.put({
      id: cacheKey(planetName, lodLevel),
      blob,
      version: TEXTURE_VERSION,
    });
  } catch (e) {
    console.warn(`[ProceduralTextures] Failed to cache ${planetName} LOD${lodLevel}:`, e);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('toBlob failed')),
      'image/jpeg',
      quality,
    );
  });
}

function blobToTexture(blob: Blob): Promise<Texture> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const tex = new CanvasTexture(img);
      tex.minFilter = LinearMipmapLinearFilter;
      tex.colorSpace = SRGBColorSpace;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      URL.revokeObjectURL(url);
      resolve(tex);
    };
    img.src = url;
  });
}

function canvasToTexture(canvas: HTMLCanvasElement): Texture {
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ── Deterministic Seed ──────────────────────────────────────────

function planetSeed(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// ── Public API ───────────────────────────────────────────────────

export interface ProceduralTextureResult {
  /** LOD textures. Initially null, filled as each LOD is generated. */
  textures: (Texture | null)[];
  /** Current active LOD level */
  currentLod: number;
}

/**
 * Generate or load cached procedural texture for a planet.
 * Returns immediately. LODs are loaded/generated asynchronously
 * and delivered via callback.
 */
export function generatePlanetTexture(
  planetName: string,
  onLodReady: (lod: number, tex: Texture) => void,
): ProceduralTextureResult {
  const recipeId = PLANET_RECIPE_MAP[planetName];
  if (!recipeId) {
    console.warn(`[ProceduralTextures] No recipe for planet "${planetName}"`);
    return { textures: [null, null], currentLod: -1 };
  }

  const result: ProceduralTextureResult = {
    textures: [null, null],
    currentLod: -1,
  };

  // Start async pipeline — catch errors so they don't go unhandled
  _generateAsync(planetName, recipeId, result, onLodReady).catch((e) => {
    console.error(`[ProceduralTextures] Failed to generate "${planetName}":`, e);
  });

  return result;
}

// Queue to serialize planet generation (one at a time to avoid thread starvation)
const _genQueue: Array<() => Promise<void>> = [];
let _genRunning = false;

async function _runQueue(): Promise<void> {
  if (_genRunning) return;
  _genRunning = true;
  while (_genQueue.length > 0) {
    const next = _genQueue.shift()!;
    await next();
  }
  _genRunning = false;
}

async function _generateAsync(
  planetName: string,
  recipeId: PlanetRecipeId,
  result: ProceduralTextureResult,
  onLodReady: (lod: number, tex: Texture) => void,
): Promise<void> {
  const seed = planetSeed(planetName);

  // Try loading all LODs from cache first
  let allCached = true;
  for (const lodDef of LOD_DEFS) {
    const cachedBlob = await getCachedBlob(planetName, lodDef.level);
    if (cachedBlob) {
      const tex = await blobToTexture(cachedBlob);
      result.textures[lodDef.level] = tex;
      result.currentLod = lodDef.level;
      onLodReady(lodDef.level, tex);
      console.info(`[ProceduralTextures] ${planetName} LOD${lodDef.level} loaded from cache`);
    } else {
      allCached = false;
    }
  }

  if (allCached) return;

  // Queue generation to avoid running all 7 planets simultaneously
  return new Promise<void>((resolve) => {
    _genQueue.push(async () => {
      console.info(`[ProceduralTextures] Generating ${planetName} (${MASTER_W}x${MASTER_H})...`);
      const t0 = performance.now();

      // Generate master texture in non-blocking chunks
      const master = await generateMasterCanvasChunked(recipeId, seed);

      console.info(`[ProceduralTextures] ${planetName} generated in ${(performance.now() - t0) | 0}ms`);

      // Create LODs from master
      for (const lodDef of LOD_DEFS) {
        if (result.textures[lodDef.level]) continue; // already loaded from cache

        const lodCanvas = lodDef.w === MASTER_W && lodDef.h === MASTER_H
          ? master  // LOD 1 IS the master, no downsample needed
          : downsampleCanvas(master, lodDef.w, lodDef.h);

        const tex = canvasToTexture(lodCanvas);
        result.textures[lodDef.level] = tex;
        result.currentLod = lodDef.level;
        onLodReady(lodDef.level, tex);

        // Cache in background
        canvasToBlob(lodCanvas).then(blob => cacheBlob(planetName, lodDef.level, blob));
      }

      resolve();
    });
    _runQueue();
  });
}

/**
 * Check if a planet name has a procedural recipe (i.e., is an EE planet).
 */
export function hasProceduralRecipe(name: string): boolean {
  return name in PLANET_RECIPE_MAP;
}
