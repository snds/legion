// Image-density sampler (Phase: image-driven galaxy). The loader is DOM-bound (verified live); here we
// lock the pure mapping galactic-(x,z) → image luminance: centring, span, bilinear, and out-of-bounds.

import { describe, it, expect } from 'vitest';
import { sampleImageDensity, DEFAULT_IMAGE_CONFIG, type DensityImage, type ImageDensityConfig } from './galaxy-image-density';

// A 2×2 luminance grid: top row [0, 1], bottom row [1, 0] (row-major, v down).
const img: DensityImage = { w: 2, h: 2, lum: new Float32Array([0, 1, 1, 0]) };
const cfg = (over: Partial<ImageDensityConfig> = {}): ImageDensityConfig => ({ ...DEFAULT_IMAGE_CONFIG, spanPc: 1000, rotationRad: 0, ...over });

describe('sampleImageDensity', () => {
  it('maps the galactic centre to the image centre (mean of the 4 texels)', () => {
    // (0,0) → u=v=0.5 → bilinear of all four = (0+1+1+0)/4
    expect(sampleImageDensity(img, 0, 0, cfg())).toBeCloseTo(0.5, 6);
  });

  it('lands a corner on its texel: +x,+z → image bottom-right (lum 0), -x,-z → top-left (lum 0)', () => {
    const r = 499; // just inside the +500 pc half-span so u,v < 1
    expect(sampleImageDensity(img, r, r, cfg())).toBeCloseTo(0, 2);   // bottom-right texel = 0
    expect(sampleImageDensity(img, r, -r, cfg())).toBeCloseTo(1, 2);  // top-right texel = 1
  });

  it('returns 0 outside the image span (black margin ⇒ no stars)', () => {
    expect(sampleImageDensity(img, 600, 0, cfg())).toBe(0);   // beyond +500 pc half-span
    expect(sampleImageDensity(img, 0, -9999, cfg())).toBe(0);
  });

  it('rotation 90° swaps the x/z axes of the sample', () => {
    const upright = sampleImageDensity(img, 300, -100, cfg());
    const rotated = sampleImageDensity(img, -100, -300, cfg({ rotationRad: Math.PI / 2 }));
    expect(rotated).toBeCloseTo(upright, 5);
  });
});
