import { describe, it, expect } from 'vitest';
import { generatePlates } from './plates';
import {
  bakeCube, bakeFaces, sampleMaster, hydraulicErode, thermalErode,
  DEFAULT_BAKE, type BakeParams,
} from './bake';

const P = (over: Partial<BakeParams> = {}): BakeParams => ({ ...DEFAULT_BAKE, res: 32, droplets: 2000, thermalIters: 4, ...over });

const stats = (g: Float32Array): { min: number; max: number; mean: number } => {
  let min = Infinity, max = -Infinity, sum = 0;
  for (const v of g) { min = Math.min(min, v); max = Math.max(max, v); sum += v; }
  return { min, max, mean: sum / g.length };
};
// mean absolute slope between horizontal neighbours — a roughness proxy
const meanSlope = (g: Float32Array, res: number): number => {
  let s = 0, n = 0;
  for (let y = 0; y < res; y++) for (let x = 0; x < res - 1; x++) { s += Math.abs(g[y * res + x + 1] - g[y * res + x]); n++; }
  return s / n;
};

describe('sampleMaster', () => {
  it('stays in [0,1] over the sphere', () => {
    const f = generatePlates(7, 'rocky');
    for (let i = 0; i < 200; i++) {
      const a = i * 2.3999632, y = 1 - (2 * (i + 0.5)) / 200, r = Math.sqrt(Math.max(0, 1 - y * y));
      const h = sampleMaster(f, [r * Math.cos(a), y, r * Math.sin(a)], 3, 0.35);
      expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThanOrEqual(1);
    }
  });
});

describe('bakeFaces', () => {
  it('produces 6 faces of res² samples in range, with real relief', () => {
    const f = generatePlates(2024, 'ocean');
    const faces = bakeFaces(f, P());
    expect(faces).toHaveLength(6);
    for (const g of faces) {
      expect(g).toHaveLength(32 * 32);
      const s = stats(g);
      expect(s.min).toBeGreaterThanOrEqual(0); expect(s.max).toBeLessThanOrEqual(1);
    }
    // at least one face has land/ocean contrast
    expect(Math.max(...faces.map((g) => stats(g).max - stats(g).min))).toBeGreaterThan(0.2);
  });
});

describe('thermalErode', () => {
  it('reduces the steepest slopes (talus) and stays in range', () => {
    const f = generatePlates(5, 'desert');
    const g = bakeFaces(f, P({ droplets: 0 }))[0];
    const before = meanSlope(g, 32);
    thermalErode(g, 32, P({ thermalIters: 12, talus: 0.004 }));
    const after = meanSlope(g, 32);
    const s = stats(g);
    expect(after).toBeLessThan(before); // smoothed steep slopes
    expect(s.min).toBeGreaterThanOrEqual(-1e-6); expect(s.max).toBeLessThanOrEqual(1 + 1e-6);
  });
});

describe('hydraulicErode', () => {
  it('is deterministic (same seed ⇒ identical field)', () => {
    const f = generatePlates(9, 'rocky');
    const a = bakeFaces(f, P({ droplets: 0 }))[0].slice();
    const b = a.slice();
    hydraulicErode(a, 32, 123, P());
    hydraulicErode(b, 32, 123, P());
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('actually modifies the terrain (carves/deposits) within range', () => {
    const f = generatePlates(9, 'rocky');
    const base = bakeFaces(f, P({ droplets: 0 }))[0];
    const eroded = base.slice();
    hydraulicErode(eroded, 32, 42, P({ droplets: 3000 }));
    let changed = 0;
    for (let i = 0; i < base.length; i++) if (Math.abs(base[i] - eroded[i]) > 1e-4) changed++;
    expect(changed).toBeGreaterThan(base.length * 0.05); // meaningfully reworked
    const s = stats(eroded);
    expect(s.min).toBeGreaterThanOrEqual(0); expect(s.max).toBeLessThanOrEqual(1);
  });
});

describe('bakeCube', () => {
  it('bakes 6 eroded faces, deterministic and in range', () => {
    const a = bakeCube(2024, 'ocean', { res: 24, droplets: 1000, thermalIters: 3 });
    const b = bakeCube(2024, 'ocean', { res: 24, droplets: 1000, thermalIters: 3 });
    expect(a.res).toBe(24);
    expect(a.faces).toHaveLength(6);
    for (let f = 0; f < 6; f++) expect(Array.from(a.faces[f])).toEqual(Array.from(b.faces[f]));
    for (const g of a.faces) { const s = stats(g); expect(s.min).toBeGreaterThanOrEqual(0); expect(s.max).toBeLessThanOrEqual(1); }
  });
});
