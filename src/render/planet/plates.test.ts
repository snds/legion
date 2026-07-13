import { describe, it, expect } from 'vitest';
import {
  generatePlates, macroHeight, macroParams, packSeeds, packElev, packMotion,
  MAX_PLATES, type Vec3,
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
    const a = generatePlates(4242, 'rocky');
    const b = generatePlates(4242, 'rocky');
    expect(a).toEqual(b);
  });

  it('different seeds diverge', () => {
    const a = generatePlates(1, 'rocky');
    const b = generatePlates(2, 'rocky');
    expect(a.seeds).not.toEqual(b.seeds);
  });

  it('places `plateCount` seeds on the unit sphere', () => {
    const f = generatePlates(7, 'rocky');
    expect(f.count).toBe(macroParams('rocky').plateCount);
    for (const s of f.seeds) expect(len(s)).toBeCloseTo(1, 5);
  });

  it('plate drift is tangent to the sphere at its seed', () => {
    const f = generatePlates(99, 'lava');
    for (let i = 0; i < f.count; i++) {
      // motion ⟂ seed (drift lies in the local tangent plane)
      expect(Math.abs(dot(f.seeds[i], f.motion[i]))).toBeLessThan(1e-6);
    }
  });

  it('never exceeds MAX_PLATES (uniform-array bound)', () => {
    for (const t of ['rocky', 'ocean', 'desert', 'lava', 'ice', 'gas'] as const) {
      expect(generatePlates(3, t).count).toBeLessThanOrEqual(MAX_PLATES);
    }
  });

  it('base elevations respect the archetype land/ocean bands', () => {
    const mp = macroParams('ocean');
    const f = generatePlates(55, 'ocean');
    const lo = Math.min(mp.oceanElev[0], mp.contElev[0]);
    const hi = Math.max(mp.oceanElev[1], mp.contElev[1]);
    for (const e of f.elev) { expect(e).toBeGreaterThanOrEqual(lo); expect(e).toBeLessThanOrEqual(hi); }
    // an ocean world should have both water plates and land plates
    const hasWater = f.elev.some((e) => e <= mp.oceanElev[1]);
    const hasLand = f.elev.some((e) => e >= mp.contElev[0]);
    expect(hasWater && hasLand).toBe(true);
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

  it('is deterministic and continuous (no NaNs)', () => {
    const f = generatePlates(808, 'desert');
    for (const d of dirs(200)) expect(Number.isFinite(macroHeight(f, d))).toBe(true);
  });

  it('reads a plate interior as that plate’s base elevation', () => {
    // Sampling exactly at a seed direction is deep inside that plate, so the
    // blend collapses to its own base elevation (± the boundary uplift, ~0 here).
    const f = generatePlates(2024, 'rocky');
    const i = 0;
    const h = macroHeight(f, f.seeds[i]);
    expect(h).toBeCloseTo(f.elev[i], 2);
  });

  it('varies across the sphere (continents, not a flat shell)', () => {
    const f = generatePlates(2024, 'rocky');
    const hs = dirs(300).map((d) => macroHeight(f, d));
    const min = Math.min(...hs), max = Math.max(...hs);
    expect(max - min).toBeGreaterThan(0.2); // real relief between ocean & land
  });
});

describe('uniform packing', () => {
  it('packs fixed MAX_PLATES arrays, zero-padded past count', () => {
    const f = generatePlates(5, 'rocky');
    const seeds = packSeeds(f), elev = packElev(f), motion = packMotion(f);
    expect(seeds).toHaveLength(MAX_PLATES * 3);
    expect(elev).toHaveLength(MAX_PLATES);
    expect(motion).toHaveLength(MAX_PLATES * 3);
    // padding region is zero
    for (let i = f.count; i < MAX_PLATES; i++) {
      expect(elev[i]).toBe(0);
      expect(seeds[i * 3]).toBe(0);
    }
    // first plate round-trips (float32 packing ⇒ compare with tolerance)
    expect(seeds[0]).toBeCloseTo(f.seeds[0][0], 6);
    expect(seeds[1]).toBeCloseTo(f.seeds[0][1], 6);
    expect(seeds[2]).toBeCloseTo(f.seeds[0][2], 6);
    expect(elev[0]).toBeCloseTo(f.elev[0], 6);
  });
});
