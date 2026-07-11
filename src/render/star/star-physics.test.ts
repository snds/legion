import { describe, it, expect } from 'vitest';
import {
  starRecordFromSpectral, granulationAmp, spotCoverage, flareRate,
  emissiveGain, rotationRate, differentialRate, type StarRecord,
} from './star-physics';

/** A record literal with explicit fields, for testing the pure mappings
 *  without depending on the seeded age→activity draw. */
function rec(over: Partial<StarRecord>): StarRecord {
  return {
    tempK: 5772, radiusSolar: 1, luminositySolar: 1, activity: 0.5,
    spectralType: 'G', seed: 1, ...over,
  };
}

describe('starRecordFromSpectral — reads the Step 0 physical record', () => {
  it('maps each class letter through and fills the physical fields', () => {
    for (const [spec, letter] of [
      ['O5V', 'O'], ['B2V', 'B'], ['A0V', 'A'], ['F5V', 'F'],
      ['G2V', 'G'], ['K7V', 'K'], ['M5V', 'M'],
    ] as const) {
      const r = starRecordFromSpectral(spec, 'test');
      expect(r.spectralType).toBe(letter);
      expect(r.tempK).toBeGreaterThan(0);
      expect(r.radiusSolar).toBeGreaterThan(0);
      expect(r.luminositySolar).toBeGreaterThan(0);
      expect(r.activity).toBeGreaterThanOrEqual(0);
      expect(r.activity).toBeLessThanOrEqual(1);
    }
  });

  it('tolerates decorated labels ("G2V · HOME") and is deterministic', () => {
    const a = starRecordFromSpectral('G2V · HOME', 'Sol');
    const b = starRecordFromSpectral('G2V · HOME', 'Sol');
    expect(a).toEqual(b);
    expect(a.spectralType).toBe('G');
  });

  it('hotter classes are hotter + more luminous than cooler ones', () => {
    const o = starRecordFromSpectral('O5V', 'x');
    const m = starRecordFromSpectral('M5V', 'x');
    expect(o.tempK).toBeGreaterThan(m.tempK);
    expect(o.luminositySolar).toBeGreaterThan(m.luminositySolar);
  });
});

describe('granulation is gated by convective type (≈0 O/B, high M)', () => {
  it('O/B photospheres are smooth (≈0)', () => {
    expect(granulationAmp(rec({ spectralType: 'O', activity: 0.9 }))).toBeLessThan(0.05);
    expect(granulationAmp(rec({ spectralType: 'B', activity: 0.9 }))).toBeLessThan(0.06);
  });
  it('M dwarfs granulate strongly', () => {
    expect(granulationAmp(rec({ spectralType: 'M', activity: 0.2 }))).toBeGreaterThan(0.8);
  });
  it('increases monotonically across the sequence', () => {
    const seq = (['O', 'B', 'A', 'F', 'G', 'K', 'M'] as const)
      .map((s) => granulationAmp(rec({ spectralType: s, activity: 0.5 })));
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
  });
});

describe('starspots + flares scale with activity, gated by type', () => {
  it('spot coverage rises with activity, capped, and ≈0 for O/B', () => {
    expect(spotCoverage(rec({ spectralType: 'M', activity: 0 }))).toBe(0);
    expect(spotCoverage(rec({ spectralType: 'M', activity: 1 })))
      .toBeGreaterThan(spotCoverage(rec({ spectralType: 'M', activity: 0.3 })));
    expect(spotCoverage(rec({ spectralType: 'O', activity: 1 }))).toBeLessThan(0.01);
    expect(spotCoverage(rec({ spectralType: 'M', activity: 1 }))).toBeLessThan(0.4); // still a star
  });

  it('flare rate: young M dwarf high, quiet dwarf low, O/B ≈0', () => {
    expect(flareRate(rec({ spectralType: 'M', activity: 1 }))).toBeGreaterThan(0.9);
    expect(flareRate(rec({ spectralType: 'M', activity: 0.02 }))).toBeLessThan(0.05);
    expect(flareRate(rec({ spectralType: 'O', activity: 1 }))).toBe(0);
    expect(flareRate(rec({ spectralType: 'B', activity: 1 }))).toBe(0);
  });
});

describe('luminosity → HDR emissive (bloom ∝ luminosity)', () => {
  it('is monotonically increasing in luminosity, and bounded', () => {
    const dim = emissiveGain(rec({ luminositySolar: 1e-3 }));
    const sun = emissiveGain(rec({ luminositySolar: 1 }));
    const bright = emissiveGain(rec({ luminositySolar: 3e4 }));
    expect(dim).toBeLessThan(sun);
    expect(sun).toBeLessThan(bright);
    expect(dim).toBeGreaterThanOrEqual(0.6);
    expect(bright).toBeLessThanOrEqual(9.0);
  });
});

describe('rotation + differential rotation', () => {
  it('smaller stars spin visibly faster; both stay positive + bounded', () => {
    expect(rotationRate(rec({ radiusSolar: 0.2 }))).toBeGreaterThan(rotationRate(rec({ radiusSolar: 5 })));
    expect(differentialRate(rec({ spectralType: 'M', activity: 1 }))).toBeGreaterThan(0);
    expect(differentialRate(rec({ spectralType: 'O', activity: 0 }))).toBeLessThan(0.2);
    expect(differentialRate(rec({ spectralType: 'M', activity: 1 }))).toBeLessThanOrEqual(0.6);
  });
});
