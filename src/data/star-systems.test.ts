// ═══════════════════════════════════════════════════════════════════
// STAR SYSTEMS TESTS — resolveSystem carries the physical record and
// preserves a REAL catalogue star's type + colour.
//
// The exoplanet index is not loaded here, so resolveSystem takes the
// GENERATED-planet path; the STAR is still resolved from the catalogue's
// real spectral type + B−V colour, which is what these assertions guard.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { resolveSystem, type CatalogStar } from './star-systems';
import { parseSpectral, bvToTempK, type SpectralLetter } from './system-gen';

function star(over: Partial<CatalogStar>): CatalogStar {
  return {
    name: 'Test Star', desig: 'HD 000000', spect: 'K2V', con: 'Eri',
    distLy: 10, x: 1, y: 0, z: 0, mag: 5, ci: 0.9, ...over,
  };
}

const LETTERS: SpectralLetter[] = ['O', 'B', 'A', 'F', 'G', 'K', 'M'];

describe('resolveSystem — real catalogue stars keep their real type + colour', () => {
  it('a K-dwarf resolves to class K with the K-class colour (not overwritten)', () => {
    const s = resolveSystem(star({ spect: 'K2V', ci: 0.9 }));
    expect(s.star.cls).toBe('K');
    expect(s.star.spectralType).toBe('K');
    // Colour is the REAL class colour, byte-identical to the parse.
    expect(s.star.colorHex).toBe(parseSpectral('K2V').colorHex);
  });
  it("temperature comes from the catalogue's real B−V colour", () => {
    const ci = 0.9;
    const s = resolveSystem(star({ spect: 'K2V', ci }));
    expect(s.star.tempK).toBe(Math.round(bvToTempK(ci)));
  });
  it('preserves type + colour across a range of real classes', () => {
    const cases: Array<[string, SpectralLetter, number]> = [
      ['A0V', 'A', 0.0], ['F5V', 'F', 0.45], ['G2V', 'G', 0.65], ['M4V', 'M', 1.5],
    ];
    for (const [spect, letter, ci] of cases) {
      const s = resolveSystem(star({ spect, ci }));
      expect(s.star.spectralType).toBe(letter);
      expect(s.star.colorHex).toBe(parseSpectral(spect).colorHex);
      expect(LETTERS).toContain(s.star.spectralType);
    }
  });
});

describe('resolveSystem — physical record + determinism', () => {
  it('carries the full star + planet physical record', () => {
    const s = resolveSystem(star({ name: 'HD 4747', spect: 'G8V', ci: 0.77 }));
    expect(s.star.massSolar).toBeGreaterThan(0);
    expect(s.star.radiusSolar).toBeGreaterThan(0);
    expect(s.star.luminositySolar).toBeGreaterThan(0);
    expect(s.star.activity).toBeGreaterThanOrEqual(0);
    for (const p of s.planets) {
      expect(p.massEarth).toBeGreaterThan(0);
      expect(p.radiusEarth).toBeGreaterThan(0);
      expect(p.insolation).toBeGreaterThan(0);
      expect(Number.isInteger(p.seed)).toBe(true);
    }
  });
  it('is deterministic — same catalogue star → identical resolved system', () => {
    const cat = star({ name: 'Gl 411', spect: 'M2V', ci: 1.5 });
    expect(resolveSystem(cat)).toEqual(resolveSystem(cat));
  });
});
