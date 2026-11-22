import { describe, it, expect } from 'vitest';
import type { GenPlanet, PlanetVisualType } from '../../data/system-gen';
import { derivePlanetParams, hasStorm, PRESETS } from './presets';

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

  it('P2-23: a dry archetype (rocky) gains much less cold-driven ice/snow than a wet one (ocean) at the same insolation', () => {
    const coldRocky = derivePlanetParams(planet({ type: 'rocky', insolation: 0.1 }));
    const coldOcean = derivePlanetParams(planet({ type: 'ocean', insolation: 0.1 }));
    expect(coldRocky.latitudeIce).toBeLessThan(coldOcean.latitudeIce);
    expect(coldRocky.snowfall).toBeLessThan(coldOcean.snowfall);
  });

  it('P2-23: the wetness dampening never touches the hot-end (insolation >= Earth) response', () => {
    // Mercury-shaped case: hot rocky body — latitudeIce/snowfall should match
    // whatever the undampened (wetness=1) formula alone would already give,
    // since dampening only ever applies to the t<0.5 (cold) branch.
    const hotRocky = derivePlanetParams(planet({ type: 'rocky', insolation: 8 }));
    const hotOcean = derivePlanetParams(planet({ type: 'ocean', insolation: 8 }));
    // Both archetypes' hot-end latitudeIce clamps to the same floor (0).
    expect(hotRocky.latitudeIce).toBe(0);
    expect(hotOcean.latitudeIce).toBe(0);
  });
});

describe('P2-23 — per-body ramp override', () => {
  it('rampOverride replaces the archetype ramp colours when present', () => {
    const overrideRamp = [
      { at: 0, color: [0.9, 0.1, 0.1] as const },
      { at: 1, color: [0.2, 0.05, 0.02] as const },
    ];
    const p = derivePlanetParams(planet({ type: 'rocky', rampOverride: overrideRamp }));
    expect(p.ramp).toHaveLength(2);
    // Jittered/density-shifted, but still clearly derived from the override
    // (high red channel), not the default rocky ramp's muted brown.
    expect(p.ramp[0].color[0]).toBeGreaterThan(0.6);
  });

  it('omitting rampOverride keeps the default archetype ramp (no regression for every other body)', () => {
    const withOverride = derivePlanetParams(planet({ type: 'rocky', rampOverride: undefined }));
    const withoutField = derivePlanetParams(planet({ type: 'rocky' }));
    expect(withOverride.ramp).toEqual(withoutField.ramp);
    expect(withoutField.ramp).toHaveLength(PRESETS.rocky.ramp.length);
  });
});

describe('C1 - shared ocean preset ships the pre-F4 cover (Continuum thinning lives in lab-ideal.json)', () => {
  it('ocean archetype cloudCover/cloudShadow match the shipping (Legacy) baseline', () => {
    // F4 (2026-08-06) had cut these here to fix a Continuum-only whiteout, but
    // PRESETS is shared — derivePlanetParams() feeds real, non-lab Legacy
    // gameplay from this same object, so thinning it here also thinned every
    // Legacy ocean world. Continuum's own thinning is scoped to the Generator
    // Lab via lab-ideal.json's override (see shaders-c125.test.ts), applied
    // onto PRESETS before a Continuum globe is ever built. Lock the shipping
    // value here so a future Continuum-motivated edit doesn't regress Legacy.
    expect(PRESETS.ocean.cloudCover).toBeCloseTo(0.55, 5);
    expect(PRESETS.ocean.cloudShadow).toBeCloseTo(0.6, 5);
  });
});

describe('P2-12 - authored hasAtmosphere overrides the radius/density heuristic', () => {
  // Mercury/Vulcan stand-ins: rep-radius-1 rocky bodies with a real gravity-
  // derived massEarth (~0.38-0.4) that clears BOTH the radius floor (0.5 R⊕)
  // and the density floor (0.28) the heuristic gates on — so without an
  // explicit override they'd wrongly retain a full atmosphere + clouds.
  const airlessMassEarth = 0.38;

  it('an explicit false zeroes atmosphere/clouds even though the body clears the heuristic floor', () => {
    const withoutOverride = planet({ type: 'rocky', radiusEarth: 1, massEarth: airlessMassEarth });
    // Control: confirm the heuristic alone (no authored fact) really would
    // have kept an atmosphere here — otherwise this test wouldn't be proving
    // the override does anything.
    expect(derivePlanetParams(withoutOverride).hasAtmosphere).toBe(true);

    const airless = planet({ type: 'rocky', radiusEarth: 1, massEarth: airlessMassEarth, hasAtmosphere: false });
    const p = derivePlanetParams(airless);
    expect(p.hasAtmosphere).toBe(false);
    expect(p.atmosphereDensity).toBe(0);
    expect(p.cloudCover).toBe(0);
    expect(p.cyclones).toBe(0);
  });

  it('an explicit true grants an atmosphere even for a dwarf that the heuristic would otherwise zero', () => {
    const dwarf = planet({ kind: 'dwarf', type: 'rocky', radiusEarth: 0.2, massEarth: 0.01 });
    expect(derivePlanetParams(dwarf).hasAtmosphere).toBe(false);

    const overridden = planet({ kind: 'dwarf', type: 'rocky', radiusEarth: 0.2, massEarth: 0.01, hasAtmosphere: true });
    expect(derivePlanetParams(overridden).hasAtmosphere).toBe(true);
  });

  it('leaves the heuristic untouched for procedurally-generated bodies (no authored fact)', () => {
    const belowFloor = planet({ type: 'rocky', radiusEarth: 0.3, massEarth: 0.05 });
    expect(derivePlanetParams(belowFloor).hasAtmosphere).toBe(false);
  });
});

describe('storms', () => {
  it('are deterministic and confined to giants', () => {
    expect(hasStorm(planet({ type: 'rocky' }))).toBe(false);
    const p = planet({ type: 'gas', isGasGiant: true, seed: 7 });
    expect(hasStorm(p)).toBe(hasStorm(p));
  });
});
