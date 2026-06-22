// ═══════════════════════════════════════════════════════════════════
// SYSTEM GENERATOR TESTS — determinism + Kepler occurrence trends
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { parseSpectral, generateSystem, type PlanetKind } from './system-gen';

const GIANTS: PlanetKind[] = ['gas-giant', 'ice-giant', 'neptune'];

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
