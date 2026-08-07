import { describe, expect, it } from 'vitest';
import type { GenPlanet } from '../../../data/system-gen';
import { createGeneratorBundle } from './index';

const ocean: GenPlanet = {
  type: 'ocean', kind: 'rocky', au: 1, massEarth: 1, radiusEarth: 1,
  insolation: 1, isGasGiant: false, hasRings: false, inHZ: true, seed: 2002,
};

/** height for a given fraction-of-sea-level depth (equator dir keeps ice out of it). */
function heightForDepth(seaLevel: number, depth: number): number {
  return seaLevel * (1 - depth);
}

describe('F7 / P-LOOK-04: ocean depth ramp stays narrow (bathymetry hidden)', () => {
  it('open ocean between the shelf and the abyssal floor reads as one flat colour', () => {
    const b = createGeneratorBundle(ocean);
    const seaLevel = b.params.seaLevel;
    const dir: [number, number, number] = [1, 0, 0]; // equator — no ice/snow interference
    const midShallow = b.climate.sample(dir, heightForDepth(seaLevel, 0.55));
    const midDeep = b.climate.sample(dir, heightForDepth(seaLevel, 0.9));
    expect(midShallow.sea).toBe(true);
    expect(midDeep.sea).toBe(true);
    // Regression: a 0.55-wide darken smoothstep(0.45, 1, depth) meant ordinary
    // seafloor undulation (well short of true trenches) still traced a visible
    // light/dark gradient into orbit albedo. Depths 0.55..0.9 must now match
    // almost exactly (same flat abyss colour) rather than drifting darker.
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(midShallow.color[c] - midDeep.color[c])).toBeLessThan(0.005);
    }
  });

  it('only the deepest trench slice darkens further toward true abyss', () => {
    const b = createGeneratorBundle(ocean);
    const seaLevel = b.params.seaLevel;
    const dir: [number, number, number] = [1, 0, 0];
    const flatFloor = b.climate.sample(dir, heightForDepth(seaLevel, 0.8));
    const deepestTrench = b.climate.sample(dir, heightForDepth(seaLevel, 1.0));
    const flatMax = Math.max(...flatFloor.color);
    const trenchMax = Math.max(...deepestTrench.color);
    expect(trenchMax).toBeLessThan(flatMax);
  });

  it('the coastal shelf fringe (P-LOOK-04 narrow ramp) stays within the first 10% of depth', () => {
    const b = createGeneratorBundle(ocean);
    const seaLevel = b.params.seaLevel;
    const dir: [number, number, number] = [1, 0, 0];
    const shelf = b.climate.sample(dir, heightForDepth(seaLevel, 0.05));
    const justPastShelf = b.climate.sample(dir, heightForDepth(seaLevel, 0.15));
    const openOcean = b.climate.sample(dir, heightForDepth(seaLevel, 0.6));
    // Shelf-to-open-ocean colour shift should already be mostly resolved by
    // depth 0.15 — the shelf must not bleed a wide visible gradient outward.
    const shelfToPast = Math.abs(shelf.color[2] - justPastShelf.color[2]);
    const pastToOpen = Math.abs(justPastShelf.color[2] - openOcean.color[2]);
    expect(pastToOpen).toBeLessThan(shelfToPast);
  });
});
