import { describe, it, expect } from 'vitest';
import type { GenPlanet, PlanetVisualType } from '../../data/system-gen';
import { derivePlanetParams, hasStorm } from './presets';

function planet(over: Partial<GenPlanet> = {}): GenPlanet {
  return {
    kind: 'rocky', au: 1, inHZ: false,
    type: 'rocky', massEarth: 1, radiusEarth: 1, insolation: 1,
    isGasGiant: false, hasRings: false, seed: 12345,
    ...over,
  };
}

describe('derivePlanetParams determinism', () => {
  it('is a pure function of the record (same seed ⇒ identical params)', () => {
    const a = derivePlanetParams(planet({ seed: 999 }));
    const b = derivePlanetParams(planet({ seed: 999 }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds diverge (palette/terrain jitter)', () => {
    const a = derivePlanetParams(planet({ seed: 1 }));
    const b = derivePlanetParams(planet({ seed: 2 }));
    expect(a.noiseSeed).not.toEqual(b.noiseSeed);
    expect(a.displacement).not.toBe(b.displacement);
  });
});

describe('type presets', () => {
  const types: PlanetVisualType[] = ['rocky', 'ocean', 'desert', 'lava', 'ice', 'gas'];

  it('selects a distinct look per type', () => {
    const seen = new Set<string>();
    for (const type of types) {
      const p = derivePlanetParams(planet({ type, isGasGiant: type === 'gas' || type === 'ice' }));
      seen.add(JSON.stringify(p.ramp) + p.isGiant + p.bandCount);
    }
    expect(seen.size).toBe(types.length);
  });

  it('ocean worlds have a sea level and night-side city lights', () => {
    const p = derivePlanetParams(planet({ type: 'ocean' }));
    expect(p.seaLevel).toBeGreaterThan(0);
    expect(p.nightLights).toBeGreaterThan(0);
    expect(p.hasAtmosphere).toBe(true);
  });

  it('lava worlds emit', () => {
    const p = derivePlanetParams(planet({ type: 'lava' }));
    expect(p.emissiveStrength).toBeGreaterThan(0);
  });

  it('gas / ice giants are banded, not terrain', () => {
    for (const type of ['gas', 'ice'] as const) {
      const p = derivePlanetParams(planet({ type, isGasGiant: true, radiusEarth: 10 }));
      expect(p.isGiant).toBe(true);
      expect(p.bandCount).toBeGreaterThan(0);
      expect(p.ramp).toHaveLength(0);
    }
  });

  it('band count scales with giant radius', () => {
    const small = derivePlanetParams(planet({ type: 'gas', isGasGiant: true, radiusEarth: 8 }));
    const big = derivePlanetParams(planet({ type: 'gas', isGasGiant: true, radiusEarth: 15 }));
    expect(big.bandCount).toBeGreaterThanOrEqual(small.bandCount);
  });
});

describe('physical record shifts the look', () => {
  it('cold (low-insolation) worlds grow polar ice; hot ones lose it', () => {
    const cold = derivePlanetParams(planet({ type: 'rocky', insolation: 0.1 }));
    const hot = derivePlanetParams(planet({ type: 'rocky', insolation: 3 }));
    expect(cold.latitudeIce).toBeGreaterThan(hot.latitudeIce);
  });
});

describe('storms', () => {
  it('are deterministic and confined to giants', () => {
    expect(hasStorm(planet({ type: 'rocky' }))).toBe(false);
    const p = planet({ type: 'gas', isGasGiant: true, seed: 7 });
    expect(hasStorm(p)).toBe(hasStorm(p));
  });
});
