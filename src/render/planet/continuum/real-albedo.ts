// ═══════════════════════════════════════════════════════════════════
// REAL ALBEDO REGISTRY — wires the bundled NASA/JPL-derived photos in
// `/textures/sol/*` into an actually-consumed texture (Audit fix:
// system-loader.ts used to `fetch()` these paths purely to warm the HTTP
// cache; nothing ever loaded them as a texture or fed `uAlbedoMap`).
//
// Two consumption paths, both fed by the SAME `THREE.TextureLoader.load()`:
//   - GPU (giants): the whole-sphere GIANT_FRAG band shader has no chunk
//     pool to bake into, so it samples `getRealAlbedoTexture()` directly via
//     an equirect UV computed from the fragment's own unit direction.
//   - CPU (rocky bodies + moons): chunk-pool.ts / surface-voxels.ts bake
//     their OWN per-chunk/per-brick DataTexture from generator colour
//     samples. `getRealAlbedoSampler()` lets generators/index.ts's single
//     `sampleSurface()` choke point override `SurfaceSample.color` with the
//     real photo, so it rides the EXISTING per-chunk albedo pipeline
//     unchanged — lighting, terminator, cloud-shadow compositing,
//     planetshine all still apply on top exactly as before ("the shader
//     doesn't know the difference").
//
// KTX2/ETC1S re-encode (docs/planet-visual-realism.md §4.4) is the noted
// VRAM-efficiency follow-up — NOT done here; this wires the bundled JPGs
// directly (an acceptable first landing per that doc's own framing).
//
// Keyed by the catalogue body's own display name (PlanetConfig.name /
// MoonConfig.name) — set on GenPlanet.realTextureBody by
// planet-continuum-adapter.ts, the one place a body name enters the render
// pipeline (mirrors the MARS_RAMP_OVERRIDE_BY_NAME precedent there).
// ═══════════════════════════════════════════════════════════════════

import { LinearFilter, SRGBColorSpace, TextureLoader, type Texture } from 'three';
import { asset } from '../../../core/assets';
import type { Vec3 } from '../cube-sphere';

const loader = new TextureLoader();

/** CPU equirect sample resolution — enough to read distinctly (Io's sulfur
 *  blotches, Europa's dark lineae cracks) without paying a megapixel-scale
 *  decode per body. One-time cost at load, not per-frame/per-chunk. */
const SAMPLE_W = 1024;
const SAMPLE_H = 512;

type Sampler = (dir: Vec3) => [number, number, number];

interface RealAlbedoEntry {
  texture: Texture | null;
  sampler: Sampler | null;
  callbacks: Array<() => void>;
}

const registry = new Map<string, RealAlbedoEntry>();

/** sRGB (JPEG source) → linear — every OTHER albedo source this pipeline
 *  feeds through `sampleSurface` (climate-provider.ts's biome/ramp colours)
 *  is a hand-tuned 0..1 float consumed directly by the lighting math with no
 *  decode step; skipping this for a real photo would read visibly
 *  over-bright/washed once the existing wrap-lighting + AgX tonemap
 *  multiply on top of it. */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function buildSampler(image: CanvasImageSource): Sampler {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Headless/unsupported canvas (e.g. some test/SSR harnesses) — fall back to
  // a neutral grey rather than throwing; the body just keeps its procedural
  // bake (same as "not loaded yet").
  if (!ctx) return () => [0.5, 0.5, 0.5];
  ctx.drawImage(image, 0, 0, SAMPLE_W, SAMPLE_H);
  const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
  const lin = new Float32Array(SAMPLE_W * SAMPLE_H * 3);
  for (let i = 0, p = 0; i < lin.length; i += 3, p += 4) {
    lin[i] = srgbToLinear(data[p] / 255);
    lin[i + 1] = srgbToLinear(data[p + 1] / 255);
    lin[i + 2] = srgbToLinear(data[p + 2] / 255);
  }
  return (dir: Vec3): [number, number, number] => {
    // Standard planetary-equirect convention: longitude from atan2(z, x)
    // (matches generators/climate-provider.ts's own `atan2(dir[2], dir[0])`
    // band-lookup — the one dir→lon convention already shared across the
    // codebase), latitude from asin(y) (y is the polar axis — ContinuumGlobe
    // spins the surface group about Y and tilts about Z).
    const lon = Math.atan2(dir[2], dir[0]);
    const lat = Math.asin(Math.max(-1, Math.min(1, dir[1])));
    let u = lon / (2 * Math.PI) + 0.5;
    u -= Math.floor(u); // wrap
    const v = Math.min(1, Math.max(0, 0.5 - lat / Math.PI));
    const x = Math.min(SAMPLE_W - 1, Math.floor(u * SAMPLE_W));
    const y = Math.min(SAMPLE_H - 1, Math.floor(v * SAMPLE_H));
    const o = (y * SAMPLE_W + x) * 3;
    return [lin[o], lin[o + 1], lin[o + 2]];
  };
}

function entryFor(name: string): RealAlbedoEntry {
  let entry = registry.get(name);
  if (!entry) {
    entry = { texture: null, sampler: null, callbacks: [] };
    registry.set(name, entry);
  }
  return entry;
}

/** Kick a real `THREE.TextureLoader` load for one curated body's
 *  `texturePath`, keyed by its catalogue display name. Idempotent — safe to
 *  call from both system-loader.ts's Stage A hover-preload AND
 *  planet-continuum-adapter.ts's direct-construction path (the latter is the
 *  correctness backstop: a body can be built without Stage A ever running,
 *  e.g. the `?system=sol` direct-boot path). Fire-and-forget: callers that
 *  need to react once the photo actually lands use `onRealAlbedoReady`. */
export function preloadRealAlbedo(name: string, path: string): void {
  if (registry.has(name)) return;
  const entry = entryFor(name);
  loader.load(
    asset(path),
    (tex) => {
      tex.colorSpace = SRGBColorSpace;
      tex.minFilter = LinearFilter;
      tex.magFilter = LinearFilter;
      tex.needsUpdate = true;
      entry.texture = tex;
      entry.sampler = buildSampler(tex.image as CanvasImageSource);
      const callbacks = entry.callbacks.splice(0);
      for (const cb of callbacks) cb();
    },
    undefined,
    (err) => {
      // Warm-up/consumption only — the body keeps its procedural bake on
      // failure, exactly like today's fetch()-warm behaviour.
      console.warn(`[real-albedo] failed to load "${name}" from ${path}`, err);
    },
  );
}

/** GPU path — the giant-band shader (GIANT_FRAG) samples this directly.
 *  `undefined` until `preloadRealAlbedo`'s load resolves. */
export function getRealAlbedoTexture(name: string): Texture | undefined {
  return registry.get(name)?.texture ?? undefined;
}

/** CPU path — generators/index.ts's `sampleSurface` overrides
 *  `SurfaceSample.color` with this. `undefined` until loaded. */
export function getRealAlbedoSampler(name: string): Sampler | undefined {
  return registry.get(name)?.sampler ?? undefined;
}

/** Live readiness check, used to key the chunk-bake fingerprint (see
 *  generators/index.ts's `surfaceFingerprint`) so a body's persisted
 *  chunk-asset cache (body-asset-store.ts) can't keep serving pre-photo
 *  procedural bytes once the real texture lands mid-session. */
export function isRealAlbedoReady(name: string): boolean {
  return !!registry.get(name)?.texture;
}

/** Fires once — immediately (synchronously) if `name`'s photo is already
 *  loaded, otherwise the moment it finishes loading. Callers use this to
 *  rebuild whatever they baked/rendered before it was ready. */
export function onRealAlbedoReady(name: string, cb: () => void): void {
  const entry = entryFor(name);
  if (entry.texture) { cb(); return; }
  entry.callbacks.push(cb);
}
