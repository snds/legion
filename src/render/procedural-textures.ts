// ═══════════════════════════════════════════════════════════════════
// PROCEDURAL PLANET TEXTURES — Per-Planet-Type Generation
// Generates unique planet surfaces using layered simplex noise with
// domain warping. Each planet type has a distinct visual recipe.
//
// Pipeline:
//   1. Check IndexedDB cache for existing LODs
//   2. If uncached, GPU-bake the 2K master equirect (texture-baker.ts, ~1 frame)
//   3. Downsample to LOD 0 (512px) for instant visibility
//   4. Cache all LODs in IndexedDB via Dexie
//   5. Planets are baked one at a time to bound GPU spikes at load
//
// The per-pixel CPU noise loop was replaced by a GPU equirect bake in
// Phase 2 (docs/planet-visual-realism.md §4.1). This module now owns the
// pipeline (cache, LOD ladder, delivery, seed) and delegates pixel
// synthesis to texture-baker.ts, which returns a <canvas> — so everything
// below the bake call is unchanged from the CPU era.
//
// Texture version is bumped when the algorithm changes to force regen.
// ═══════════════════════════════════════════════════════════════════

import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace, type Texture } from 'three';
import { textureDb } from '../persistence/save-db';
import { bakeRecipeToCanvas } from './texture-baker';

// ── Constants ────────────────────────────────────────────────────

const TEXTURE_VERSION = 5;  // Bumped: Phase 3b terrestrial/desert recipe rewrite

// Master texture resolution — 2K looks great at system zoom; the GPU bake
// produces it in ~1 frame plus an ~8 MB readback (vs the old 100–300 ms CPU loop).
const MASTER_W = 2048;
const MASTER_H = 1024;

// LOD resolutions (downsampled from master)
const LOD_DEFS = [
  { level: 0, w: 512,  h: 256 },   // < 50px on screen — instant load
  { level: 1, w: 2048, h: 1024 },   // 50px+ — full master resolution
] as const;

// ── Planet Recipes ───────────────────────────────────────────────
// The 7 Eridani-Echo archetype ids. Pixel synthesis (3D-direction noise
// GLSL + palette ramps) lives in texture-baker.ts, keyed by this id; this
// module owns the cache/LOD/delivery pipeline around the bake.

export type PlanetRecipeId = 'vulcan' | 'ragnarok' | 'romulus' | 'pax' | 'jotunheim' | 'niflheim' | 'helheim';

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
      console.info(`[ProceduralTextures] Baking ${planetName} (${MASTER_W}x${MASTER_H})...`);
      const t0 = performance.now();

      // GPU equirect bake → master <canvas> (~1 frame). Yield once so the
      // delivery stays off the critical boot frame, matching the old async
      // contract that consumers (objects.ts onLodReady) already expect.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const master = bakeRecipeToCanvas(recipeId, seed, MASTER_W, MASTER_H);

      console.info(`[ProceduralTextures] ${planetName} baked in ${(performance.now() - t0) | 0}ms`);

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
