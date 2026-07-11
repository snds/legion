// ═══════════════════════════════════════════════════════════════════
// SYSTEM GENERATOR TESTS — determinism + Kepler occurrence trends
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import {
  parseSpectral, generateSystem, deriveStellarPhysical, derivePlanetPhysical,
  bvToTempK, letterFromTemp, type PlanetKind, type PlanetVisualType, type SpectralLetter,
} from './system-gen';

const GIANTS: PlanetKind[] = ['gas-giant', 'ice-giant', 'neptune'];
const LETTERS: SpectralLetter[] = ['O', 'B', 'A', 'F', 'G', 'K', 'M'];
const PLANET_TYPES: PlanetVisualType[] = ['rocky', 'gas', 'ice', 'ocean', 'lava', 'desert'];

describe('parseSpectral', () => {
  it('reads class / subtype / luminosity class', () => {
    const m = parseSpectral('M5Ve');
    expect(m.cls).toBe('M');
    expect(m.subtype).toBe(5);
    expect(m.lumClass).toBe('V');
    expect(parseSpectral('G2V').cls).toBe('G');
    expect(parseSpectral('K1V').cls).toBe('K');
  });
  it('giants are far more luminous than the main-sequence anchor', () => {
    expect(parseSpectral('K1III').lumSun).toBeGreaterThan(parseSpectral('K1V').lumSun);
  });
  it('white-dwarf prefixes resolve to class D', () => {
    expect(parseSpectral('DA').cls).toBe('D');
    expect(parseSpectral('DA2').cls).toBe('D');
  });
  it('blank / junk falls back to a K dwarf', () => {
    expect(parseSpectral('').cls).toBe('K');
    expect(parseSpectral('???').cls).toBe('K');
  });
  it('hotter classes are bluer/hotter than cooler ones', () => {
    expect(parseSpectral('O5V').teffK).toBeGreaterThan(parseSpectral('M5V').teffK);
  });
});

describe('generateSystem — determinism', () => {
  it('same star + type → identical system, always', () => {
    const a = generateSystem('Gl 411', 'M2V');
    const b = generateSystem('Gl 411', 'M2V');
    expect(b).toEqual(a);
  });
  it('different stars diverge', () => {
    const a = generateSystem('Gl 411', 'M2V');
    const b = generateSystem('Gl 412', 'M2V');
    // Same class, but the per-star seed should (almost always) differ.
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe('generateSystem — Kepler occurrence trends (aggregate)', () => {
  // Aggregate over many synthetic stars so the statistical trend is testable.
  function survey(spect: string, n = 600) {
    let planets = 0, giants = 0, total = 0;
    for (let i = 0; i < n; i++) {
      const s = generateSystem(`star-${spect}-${i}`, spect);
      planets += s.planets.length;
      for (const p of s.planets) { total++; if (GIANTS.includes(p.kind)) giants++; }
    }
    return { meanPlanets: planets / n, giantFrac: total ? giants / total : 0 };
  }

  it('M dwarfs host MORE planets on average than G stars', () => {
    expect(survey('M4V').meanPlanets).toBeGreaterThan(survey('G2V').meanPlanets);
  });
  it('giants are a SMALLER fraction around M dwarfs than around F/G stars', () => {
    expect(survey('M4V').giantFrac).toBeLessThan(survey('F5V').giantFrac);
  });
  it('hot/short-lived O/B and remnants are planet-sparse', () => {
    expect(survey('O5V').meanPlanets).toBeLessThan(survey('K2V').meanPlanets);
    expect(survey('DA', 200).meanPlanets).toBeLessThan(1);
  });
});

describe('star physical record — fields exist + are physical', () => {
  it('every generated star carries the full physical record', () => {
    const s = generateSystem('Gl 411', 'M2V').star;
    expect(LETTERS).toContain(s.spectralType);
    expect(s.massSolar).toBeGreaterThan(0);
    expect(s.radiusSolar).toBeGreaterThan(0);
    expect(s.luminositySolar).toBeGreaterThan(0);
    expect(s.tempK).toBeGreaterThan(0);
    expect(s.ageGyr).toBeGreaterThanOrEqual(0);
    expect(s.activity).toBeGreaterThanOrEqual(0);
    expect(s.activity).toBeLessThanOrEqual(1);
  });
  it('spectralType matches the parsed class for main-sequence stars', () => {
    expect(generateSystem('a', 'G2V').star.spectralType).toBe('G');
    expect(generateSystem('b', 'M5V').star.spectralType).toBe('M');
    expect(generateSystem('c', 'O5V').star.spectralType).toBe('O');
  });
  it('hotter classes are more massive, larger, brighter, hotter', () => {
    const o = generateSystem('o', 'O5V').star;
    const m = generateSystem('m', 'M5V').star;
    expect(o.massSolar).toBeGreaterThan(m.massSolar);
    expect(o.radiusSolar).toBeGreaterThan(m.radiusSolar);
    expect(o.luminositySolar).toBeGreaterThan(m.luminositySolar);
    expect(o.tempK).toBeGreaterThan(m.tempK);
  });
  it('age is bounded by the class main-sequence lifetime (O stars are young)', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateSystem(`hot-${i}`, 'O5V').star.ageGyr).toBeLessThan(1);
      expect(generateSystem(`cool-${i}`, 'M5V').star.ageGyr).toBeLessThanOrEqual(13.5);
    }
  });
  it('cool convective dwarfs can be far more active than early types', () => {
    // Aggregate: the M-dwarf activity ceiling dwarfs the A/O ceiling regardless of age.
    let mMax = 0, aMax = 0;
    for (let i = 0; i < 100; i++) {
      mMax = Math.max(mMax, generateSystem(`m-${i}`, 'M3V').star.activity);
      aMax = Math.max(aMax, generateSystem(`a-${i}`, 'A0V').star.activity);
    }
    expect(mMax).toBeGreaterThan(aMax);
  });
  it('a real B−V colour drives temperature over the model (no overwrite)', () => {
    const modelled = generateSystem('x', 'G2V').star.tempK;
    const observed = generateSystem('x', 'G2V', { bv: 0.65 }).star.tempK;
    expect(observed).toBe(Math.round(bvToTempK(0.65)));
    expect(observed).not.toBe(modelled);
  });
  it('bvToTempK / letterFromTemp are self-consistent for a Sun-like colour', () => {
    const t = bvToTempK(0.65); // the Sun's B−V
    expect(t).toBeGreaterThan(5300);
    expect(t).toBeLessThan(6000);
    expect(letterFromTemp(t)).toBe('G');
  });
});

describe('star physical record — determinism', () => {
  it('same seed → identical physical record', () => {
    const a = deriveStellarPhysical(parseSpectral('K2V'), 'HD 22049|K2V');
    const b = deriveStellarPhysical(parseSpectral('K2V'), 'HD 22049|K2V');
    expect(b).toEqual(a);
  });
  it('same B−V → identical temperature', () => {
    const a = generateSystem('HD 1', 'K2V', { bv: 0.9 }).star;
    const b = generateSystem('HD 1', 'K2V', { bv: 0.9 }).star;
    expect(a.tempK).toBe(b.tempK);
  });
});

describe('planet physical record — fields exist + derive from mass/radius/insolation', () => {
  it('every generated planet carries the full physical record', () => {
    const sys = generateSystem('K2V-host', 'K2V');
    // Use a seed guaranteed to yield planets.
    const withPlanets = [sys, generateSystem('G2V-host', 'G2V'), generateSystem('M4V-host', 'M4V')]
      .find((s) => s.planets.length) ?? sys;
    for (const p of withPlanets.planets) {
      expect(PLANET_TYPES).toContain(p.type);
      expect(p.massEarth).toBeGreaterThan(0);
      expect(p.radiusEarth).toBeGreaterThan(0);
      expect(p.insolation).toBeGreaterThan(0);
      expect(typeof p.isGasGiant).toBe('boolean');
      expect(typeof p.hasRings).toBe('boolean');
      expect(Number.isInteger(p.seed)).toBe(true);
    }
  });
  it('a giant kind is a gas/ice giant; a rocky kind is not', () => {
    const gas = derivePlanetPhysical('gas-giant', 5, 1, false, 'seed', 0);
    expect(gas.isGasGiant).toBe(true);
    expect(gas.type).toBe('gas');
    const rock = derivePlanetPhysical('rocky', 1, 1, true, 'seed', 0);
    expect(rock.isGasGiant).toBe(false);
    expect(rock.radiusEarth).toBeLessThan(1.5);
  });
  it('type follows insolation: scorched → lava, habitable-zone → ocean, cold → rocky', () => {
    expect(derivePlanetPhysical('rocky', 0.2, 1, false, 's', 0).type).toBe('lava');  // insolation 25
    expect(derivePlanetPhysical('rocky', 1, 1, true, 's', 0).type).toBe('ocean');    // Earth-like, in HZ
    expect(derivePlanetPhysical('rocky', 5, 1, false, 's', 0).type).toBe('rocky');   // insolation 0.04
  });
  it('insolation is L / au² (Earth = 1)', () => {
    expect(derivePlanetPhysical('rocky', 1, 1, true, 's', 0).insolation).toBeCloseTo(1, 5);
    expect(derivePlanetPhysical('rocky', 2, 1, false, 's', 0).insolation).toBeCloseTo(0.25, 5);
  });
  it('real archive radius/mass are authoritative; only the missing side is modelled', () => {
    const p = derivePlanetPhysical('super-earth', 1, 1, true, 's', 0, { rade: 1.6, masse: 5.0 });
    expect(p.radiusEarth).toBe(1.6);
    expect(p.massEarth).toBe(5.0);
  });
  it('per-body seed is stable and per-index distinct', () => {
    const a0 = derivePlanetPhysical('rocky', 1, 1, false, 'host', 0);
    const b0 = derivePlanetPhysical('rocky', 1, 1, false, 'host', 0);
    const a1 = derivePlanetPhysical('rocky', 1, 1, false, 'host', 1);
    expect(a0).toEqual(b0);
    expect(a0.seed).not.toBe(a1.seed);
  });
});

describe('generateSystem — habitable zone', () => {
  it('the HZ sits closer in for fainter (M) stars than for the Sun-like G', () => {
    expect(generateSystem('x', 'M5V').hzAu).toBeLessThan(generateSystem('y', 'G2V').hzAu);
  });
  it('a G2V HZ is ~1 AU', () => {
    const hz = generateSystem('z', 'G2V').hzAu;
    expect(hz).toBeGreaterThan(0.7);
    expect(hz).toBeLessThan(1.4);
  });
});
