import { describe, it, expect } from 'vitest';
import { snoise3, fbm3, warpDir } from './simplex';
import type { Vec3 } from './plates';

// A deterministic spray of sample points over a useful coordinate range.
function pts(n: number): Vec3[] {
  const out: Vec3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * ga;
    out.push([r * Math.cos(th) * 3.1, y * 3.1, r * Math.sin(th) * 3.1]);
  }
  return out;
}

describe('snoise3 (Ashima simplex port)', () => {
  it('is deterministic', () => {
    for (const [x, y, z] of pts(50)) {
      expect(snoise3(x, y, z)).toBe(snoise3(x, y, z));
    }
  });

  it('stays roughly in [-1,1] and is finite', () => {
    for (const [x, y, z] of pts(600)) {
      const n = snoise3(x, y, z);
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThan(-1.05);
      expect(n).toBeLessThan(1.05);
    }
  });

  it('actually varies (not a constant field)', () => {
    const ns = pts(400).map(([x, y, z]) => snoise3(x, y, z));
    expect(Math.max(...ns) - Math.min(...ns)).toBeGreaterThan(0.8);
  });

  it('is continuous (neighbouring samples differ by a small amount)', () => {
    const e = 1e-3;
    for (const [x, y, z] of pts(80)) {
      const a = snoise3(x, y, z);
      const b = snoise3(x + e, y, z);
      expect(Math.abs(a - b)).toBeLessThan(0.05); // Lipschitz-ish, no discontinuity
    }
  });

  it('gives a stable, bounded value at the origin (a fixed reference point)', () => {
    // Not zero (the three non-origin corner offsets contribute) — just pin that
    // it is finite, bounded and reproducible, as a canary against a broken port.
    const o = snoise3(0, 0, 0);
    expect(Number.isFinite(o)).toBe(true);
    expect(Math.abs(o)).toBeLessThan(1.05);
    expect(o).toBe(snoise3(0, 0, 0));
  });
});

describe('fbm3', () => {
  it('is finite and varies over the sphere', () => {
    const ns = pts(300).map(([x, y, z]) => fbm3(x, y, z));
    for (const n of ns) expect(Number.isFinite(n)).toBe(true);
    expect(Math.max(...ns) - Math.min(...ns)).toBeGreaterThan(0.4);
  });
});

describe('warpDir', () => {
  it('returns the input unchanged when warp <= 0', () => {
    const d: Vec3 = [0, 1, 0];
    expect(warpDir(d, 0, [0, 0, 0])).toBe(d);
  });

  it('returns a unit vector and actually displaces the direction', () => {
    const seed: Vec3 = [12.3, 45.6, 78.9];
    for (const p of pts(60)) {
      const d: Vec3 = (() => { const l = Math.hypot(...p); return [p[0] / l, p[1] / l, p[2] / l]; })();
      const w = warpDir(d, 0.6, seed);
      expect(Math.hypot(...w)).toBeCloseTo(1, 6);
      const moved = Math.hypot(w[0] - d[0], w[1] - d[1], w[2] - d[2]);
      expect(moved).toBeGreaterThan(0); // warp had an effect
    }
  });

  it('is deterministic for a given (dir, warp, seed)', () => {
    const d: Vec3 = [0.3, 0.6, 0.74];
    const seed: Vec3 = [1, 2, 3];
    expect(warpDir(d, 0.5, seed)).toEqual(warpDir(d, 0.5, seed));
  });
});
