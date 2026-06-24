// Sector-cloud prototype Inc 2 — embedded stars. Proves the load-bearing claims:
// determinism (seed → identical field), sector-local bounds, valid IMF colours, and
// "count/colour agree with the model" — count and emission both track galactic
// position (richer toward the core, near-empty far above the plane).

import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from 'three';
import { createHomeSector, createSector, HOME_GAL_PC, DEFAULT_SECTOR_EDGE_PC } from './sector';
import { generateSectorStars, sectorStarSeedKey } from './sector-stars';

const HALF_WU = (DEFAULT_SECTOR_EDGE_PC / 2) * 1000; // 125,000 WU

describe('Sector stars — determinism', () => {
  it('same sector → byte-identical field across runs (deterministic seed)', () => {
    const a = generateSectorStars(createHomeSector());
    const b = generateSectorStars(createHomeSector());
    expect(a.count).toBe(b.count);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.sizes)).toEqual(Array.from(b.sizes));
  });

  it('seed key is stable for the same centre + edge', () => {
    expect(sectorStarSeedKey(createHomeSector())).toBe(sectorStarSeedKey(createHomeSector()));
  });

  it('draws NO entropy from Math.random (spec: deterministic mulberry32 only)', () => {
    const home = createHomeSector();
    const spy = vi.spyOn(Math, 'random');
    generateSectorStars(home);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('Sector stars — no silent under-fill (count == field length)', () => {
  it('a near-void far sector still fills count exactly (uniform fallback)', () => {
    // 12 kpc off the disc plane: emission → ~0, so rejection alone could not fill.
    const far = createSector(
      new Vector3(HOME_GAL_PC.x, HOME_GAL_PC.y + 12000, HOME_GAL_PC.z),
      DEFAULT_SECTOR_EDGE_PC,
    );
    const d = generateSectorStars(far);
    expect(d.positions.length).toBe(d.count * 3);
    expect(d.colors.length).toBe(d.count * 3);
    expect(d.sizes.length).toBe(d.count);
    expect(d.count).toBeGreaterThanOrEqual(400); // MIN floor honoured by the fallback
  });
});

describe('Sector stars — frame + content validity', () => {
  const data = generateSectorStars(createHomeSector());

  it('count is positive and the arrays are consistent', () => {
    expect(data.count).toBeGreaterThan(0);
    expect(data.positions.length).toBe(data.count * 3);
    expect(data.colors.length).toBe(data.count * 3);
    expect(data.sizes.length).toBe(data.count);
  });

  it('all stars sit within the breached AABB (±half edge · 1.15 in WU)', () => {
    const bound = HALF_WU * 1.15; // STAR_BREACH — stars spill slightly past the bounds
    for (let i = 0; i < data.positions.length; i++) {
      expect(Math.abs(data.positions[i]!)).toBeLessThanOrEqual(bound);
    }
  });

  it('colours are finite, in [0,1]; sizes are plausible px', () => {
    for (let i = 0; i < data.colors.length; i++) {
      const c = data.colors[i]!;
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < data.sizes.length; i++) {
      expect(data.sizes[i]!).toBeGreaterThan(0.5);
      expect(data.sizes[i]!).toBeLessThan(7);
    }
  });

  it('home sector is substantially populated', () => {
    expect(data.count).toBeGreaterThan(1000);
    expect(data.emissionMean).toBeGreaterThan(0);
  });
});

describe('Sector stars — count/emission agree with the density model', () => {
  const home = generateSectorStars(createHomeSector());

  it('a sector 2 kpc toward the galactic core is brighter AND denser', () => {
    const coreward = createSector(
      new Vector3(HOME_GAL_PC.x - 2000, HOME_GAL_PC.y, HOME_GAL_PC.z),
      DEFAULT_SECTOR_EDGE_PC,
    );
    const cw = generateSectorStars(coreward);
    expect(cw.emissionMean).toBeGreaterThan(home.emissionMean); // model: ∝ exp(-R/HR)
    expect(cw.count).toBeGreaterThanOrEqual(home.count);
  });

  it('a sector 5 kpc above the disc plane is far dimmer AND sparser', () => {
    const highup = createSector(
      new Vector3(HOME_GAL_PC.x, HOME_GAL_PC.y + 5000, HOME_GAL_PC.z),
      DEFAULT_SECTOR_EDGE_PC,
    );
    const hi = generateSectorStars(highup);
    expect(hi.emissionMean).toBeLessThan(home.emissionMean * 0.1); // far off the thin disc
    expect(hi.count).toBeLessThan(home.count);
  });
});
