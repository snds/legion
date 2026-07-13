import { describe, it, expect } from 'vitest';
import {
  generatePlates, macroHeight, macroParams,
  packContSeeds, packContSize, packPlateSeeds, packPlateMotion,
  MAX_PLATES, MAX_CONTINENTS, type Vec3,
} from './plates';

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

// A deterministic spray of unit directions to probe the field over the sphere.
function dirs(n: number): Vec3[] {
  const out: Vec3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * ga;
    out.push([r * Math.cos(th), y, r * Math.sin(th)]);
  }
  return out;
}

describe('generatePlates', () => {
  it('is deterministic — same seed ⇒ identical field', () => {
    expect(generatePlates(4242, 'rocky')).toEqual(generatePlates(4242, 'rocky'));
  });

  it('different seeds diverge', () => {
    expect(generatePlates(1, 'rocky').plateSeeds).not.toEqual(generatePlates(2, 'rocky').plateSeeds);
  });

  it('places the archetype’s continent + plate counts on the unit sphere', () => {
    const mp = macroParams('ocean');
    const f = generatePlates(7, 'ocean');
    expect(f.continentCount).toBe(mp.continents);
    expect(f.plateCount).toBe(mp.plateCount);
    for (const s of f.contSeeds) expect(len(s)).toBeCloseTo(1, 5);
    for (const s of f.plateSeeds) expect(len(s)).toBeCloseTo(1, 5);
  });

  it('plate drift is tangent to the sphere at its seed', () => {
    const f = generatePlates(99, 'lava');
    for (let i = 0; i < f.plateCount; i++) {
      expect(Math.abs(dot(f.plateSeeds[i], f.plateMotion[i]))).toBeLessThan(1e-6);
    }
  });

  it('respects the uniform-array caps', () => {
    for (const t of ['rocky', 'ocean', 'desert', 'lava', 'ice', 'gas'] as const) {
      const f = generatePlates(3, t);
      expect(f.plateCount).toBeLessThanOrEqual(MAX_PLATES);
      expect(f.continentCount).toBeLessThanOrEqual(MAX_CONTINENTS);
    }
  });

  it('continent cap radii scale down as land coverage drops', () => {
    // Ocean (30% land) should have smaller continents than desert (92% land).
    const meanR = (t: 'ocean' | 'desert'): number => {
      const f = generatePlates(11, t);
      return f.contSize.reduce((s, r) => s + r, 0) / f.contSize.length;
    };
    expect(meanR('ocean')).toBeLessThan(meanR('desert'));
  });
});

describe('macroHeight', () => {
  it('stays in [0,1] everywhere', () => {
    const f = generatePlates(12345, 'rocky');
    for (const d of dirs(400)) {
      const h = macroHeight(f, d);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
  });

  it('is finite everywhere (no NaNs)', () => {
    const f = generatePlates(808, 'desert');
    for (const d of dirs(200)) expect(Number.isFinite(macroHeight(f, d))).toBe(true);
  });

  it('a continent centre is land; a far-from-any-continent point is ocean-floor', () => {
    const f = generatePlates(2024, 'ocean');
    // Continent centre reads as land (≥ the land plateau, minus rift possibility).
    const atCentre = macroHeight(f, f.contSeeds[0]);
    expect(atCentre).toBeGreaterThan(0.55);
    // The antipode of every continent is far from all of them for a sparse ocean
    // world — pick the sphere direction maximally distant from all continents.
    let worst = Infinity, wd: Vec3 = [0, 1, 0];
    for (const d of dirs(600)) {
      const nearest = Math.max(...f.contSeeds.map((c) => dot(d, c)));
      if (nearest < worst) { worst = nearest; wd = d; }
    }
    expect(macroHeight(f, wd)).toBeLessThan(0.45); // below the ocean waterline band
  });

  it('varies across the sphere (continents + ranges, not a flat shell)', () => {
    const f = generatePlates(2024, 'rocky');
    const hs = dirs(400).map((d) => macroHeight(f, d));
    expect(Math.max(...hs) - Math.min(...hs)).toBeGreaterThan(0.25);
  });
});

describe('uniform packing', () => {
  it('packs fixed-size arrays, zero-padded past count', () => {
    const f = generatePlates(5, 'rocky');
    expect(packContSeeds(f)).toHaveLength(MAX_CONTINENTS * 3);
    expect(packContSize(f)).toHaveLength(MAX_CONTINENTS);
    expect(packPlateSeeds(f)).toHaveLength(MAX_PLATES * 3);
    expect(packPlateMotion(f)).toHaveLength(MAX_PLATES * 3);
    const ps = packPlateSeeds(f);
    for (let i = f.plateCount; i < MAX_PLATES; i++) expect(ps[i * 3]).toBe(0);
    // first plate round-trips (float32 packing ⇒ tolerance)
    expect(ps[0]).toBeCloseTo(f.plateSeeds[0][0], 6);
    expect(ps[1]).toBeCloseTo(f.plateSeeds[0][1], 6);
  });
});
