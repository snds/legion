// ═══════════════════════════════════════════════════════════════════
// GALAXY IMAGE DENSITY — drive the in-plane star density from a reference image (face-on Milky Way).
//
// "Replace the arms": a top-down picture of the galaxy IS a map of surface star density. We sample its
// luminance at each cell's galactic (x, z) and write it into the same per-cell densityFactor field the
// brush writes — so the image's spiral structure becomes the galaxy's, and the hand brush still refines
// on top. The colour version is reserved for tinting dust/clouds later.
//
// REPLACE (not multiply): the bake computes count ∝ (emission/REF)·densityFactor, so to make count ∝ the
// IMAGE we set densityFactor ∝ image·(meanEmission/emission) — the analytic emission CANCELS, leaving
// count ∝ image. The emission-boost is clamped so faint disc-edge cells can't blow out.
//
// Browser-only loader (Image + canvas); the sampler + the field write are pure and unit-tested.
// ═══════════════════════════════════════════════════════════════════

import { cellKey } from './sector/sector';
import type { EditState } from './sector/galaxy-edit';
import type { PopulatedCell } from './sector/galaxy-enumerate';

/** Cap on the emission→image boost for faint cells (keeps the disc edge from over-brightening). */
const CANCEL_CLAMP = 12;
/** Hard ceiling on an image-set densityFactor (the emission-cancel needs more headroom than the brush). */
const IMAGE_MAX_DF = 24;

/** A loaded luminance grid (0..1), row-major, w×h. */
export interface DensityImage {
  readonly w: number;
  readonly h: number;
  readonly lum: Float32Array;
}

/** How the square image maps onto the galactic plane. */
export interface ImageDensityConfig {
  /** Galactocentric pc spanned by the FULL image width/height (the disc is ≈ 0.9× this). */
  spanPc: number;
  /** Rotate the image about the galactic centre (rad) to align the arms / Sol. */
  rotationRad: number;
  /** Sharpen the arm contrast: count ∝ image^contrast. 1 = linear. */
  contrast: number;
  /** Overall density scale; 1 keeps the total star count ≈ the base build-out. */
  strength: number;
  /** Lower clamp on densityFactor (0 lets dark gaps empty out). */
  floor: number;
}

export const DEFAULT_IMAGE_CONFIG: ImageDensityConfig = {
  spanPc: 32000, rotationRad: 0, contrast: 1.6, strength: 0.4, floor: 0,
};

/** Bilinear luminance at galactic (xPc, zPc). 0 outside the image (black margin ⇒ no stars). */
export function sampleImageDensity(img: DensityImage, xPc: number, zPc: number, cfg: ImageDensityConfig): number {
  const c = Math.cos(cfg.rotationRad);
  const s = Math.sin(cfg.rotationRad);
  const rx = xPc * c - zPc * s;
  const rz = xPc * s + zPc * c;
  const u = rx / cfg.spanPc + 0.5;     // image horizontal ↔ galactic x
  const v = rz / cfg.spanPc + 0.5;     // image vertical   ↔ galactic z
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
  const fx = u * (img.w - 1);
  const fy = v * (img.h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, img.w - 1);
  const y1 = Math.min(y0 + 1, img.h - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const l = img.lum;
  const top = l[y0 * img.w + x0] * (1 - tx) + l[y0 * img.w + x1] * tx;
  const bot = l[y1 * img.w + x0] * (1 - tx) + l[y1 * img.w + x1] * tx;
  return top * (1 - ty) + bot * ty;
}

/** Write the image's in-plane density into the edit field (REPLACE mode). Returns the dirtied regions
 *  (all enumerated regions). count ∝ image^contrast, with the total ≈ the base build-out at strength 1. */
export function applyImageDensity(
  editState: EditState, cells: PopulatedCell[], img: DensityImage, cfg: ImageDensityConfig,
): Set<string> {
  const n = cells.length;
  const lums = new Float32Array(n);
  let sumLum = 0;
  let sumEm = 0;
  for (let i = 0; i < n; i++) {
    const pc = cells[i];
    const l = sampleImageDensity(img, pc.centerPc.x, pc.centerPc.z, cfg);
    lums[i] = l;
    sumLum += l;
    sumEm += pc.emission;
  }
  const meanLum = Math.max(1e-6, sumLum / Math.max(1, n));
  const meanEm = Math.max(1e-6, sumEm / Math.max(1, n));
  const dirty = new Set<string>();
  for (let i = 0; i < n; i++) {
    const pc = cells[i];
    const shaped = Math.pow(lums[i] / meanLum, cfg.contrast);                    // arm contrast (mean ≈ 1)
    const cancel = Math.min(CANCEL_CLAMP, meanEm / Math.max(1e-6, pc.emission)); // emission drops out in the bake
    const df = Math.min(IMAGE_MAX_DF, Math.max(cfg.floor, cfg.strength * shaped * cancel));
    const ck = cellKey(pc.cell);
    const m = editState.modifiers.get(ck);
    if (m) m.densityFactor = df;
    else editState.modifiers.set(ck, { densityFactor: df, displacementPc: [0, 0, 0], dustOpacity: 0 });
    dirty.add(pc.regionKey);
  }
  return dirty;
}

/** Load a face-on density image: draw it to an offscreen canvas and extract a Rec.709 luminance grid. */
export async function loadFaceOnDensity(url: string): Promise<DensityImage> {
  const im = new Image();
  im.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    im.onload = (): void => resolve();
    im.onerror = (): void => reject(new Error(`failed to load density image: ${url}`));
    im.src = url;
  });
  const w = im.naturalWidth;
  const h = im.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(im, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
  }
  return { w, h, lum };
}
