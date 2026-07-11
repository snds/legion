// ═══════════════════════════════════════════════════════════════════
// RING SYSTEM — structured, samplable radius/density bands (not a sprite)
//
// procedural-worlds-plan.md Decision 5: "If hasRings: a structured, samplable
// ring system (radius/density bands), not a flat sprite." A later ring-station
// layer must be able to ASK "what's the density at radius r?", so the rings are
// generated as an ordered set of bands with gaps (Cassini-division analogues),
// deterministically from the body seed. globe.ts renders them by SAMPLING this
// same structure into the ring shader — one source of truth for looks AND
// gameplay. Pure — no Three.js — fully unit-tested.
// ═══════════════════════════════════════════════════════════════════

import { channel, range } from './rng';

/** One concentric ring band. Radii are MULTIPLES of the planet radius. */
export interface RingBand {
  readonly inner: number;   // inner edge (planet radii)
  readonly outer: number;   // outer edge (planet radii)
  readonly density: number; // 0..1 optical density (0 = the gap after it)
}

export interface RingSystem {
  readonly innerRadius: number; // overall inner edge (planet radii)
  readonly outerRadius: number; // overall outer edge (planet radii)
  readonly bands: readonly RingBand[];
}

/**
 * Deterministically generate a body's ring system from its seed. Giants get
 * broader, denser systems than the rare terrestrial ring. The disc starts just
 * outside the Roche-ish limit (~1.3 R) and is carved into 3–7 bands separated by
 * gaps; each band gets its own optical density. Same seed ⇒ identical system.
 */
export function generateRings(seed: number, isGiant: boolean): RingSystem {
  const rng = channel(seed >>> 0, 'rings');
  const innerRadius = range(rng, 1.25, 1.5);
  const span = isGiant ? range(rng, 1.1, 1.9) : range(rng, 0.3, 0.7);
  const outerRadius = innerRadius + span;

  const bandCount = isGiant ? Math.round(range(rng, 4, 7)) : Math.round(range(rng, 2, 4));
  const bands: RingBand[] = [];
  let r = innerRadius;
  const step = (outerRadius - innerRadius) / bandCount;
  for (let i = 0; i < bandCount; i++) {
    const gap = range(rng, 0.05, 0.35) * step; // Cassini-division analogue
    const inner = r;
    const outer = Math.min(outerRadius, r + step - gap);
    if (outer > inner) {
      bands.push({ inner, outer, density: +range(rng, isGiant ? 0.35 : 0.15, 1).toFixed(3) });
    }
    r += step;
  }
  return { innerRadius, outerRadius, bands };
}

/**
 * Optical density at a radius (planet radii) — the samplable query a ring-station
 * layer would use. 0 outside the system or in a gap. Bands are sorted, so a
 * linear scan is fine (≤7 bands).
 */
export function densityAt(rings: RingSystem, radius: number): number {
  if (radius < rings.innerRadius || radius > rings.outerRadius) return 0;
  for (const b of rings.bands) {
    if (radius >= b.inner && radius <= b.outer) return b.density;
  }
  return 0; // in a gap
}

/** Flatten the bands into a fixed-length density LUT the ring shader samples
 *  (index 0 = innerRadius, last = outerRadius). `n` samples across the disc. */
export function densityLUT(rings: RingSystem, n: number): Float32Array<ArrayBuffer> {
  const lut = new Float32Array(new ArrayBuffer(n * 4));
  const span = rings.outerRadius - rings.innerRadius;
  for (let i = 0; i < n; i++) {
    const radius = rings.innerRadius + (span * i) / (n - 1);
    lut[i] = densityAt(rings, radius);
  }
  return lut;
}
