// ═══════════════════════════════════════════════════════════════════
// EXOPLANET CROSS-MATCH TESTS — catalogue keys must match the archive keys
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { starKeys } from './exoplanets';
import { classifyByRadius } from './system-gen';

describe('starKeys — cross-match to the archive host keys', () => {
  it('extracts HIP / Gliese / name keys from a designation', () => {
    const k = starKeys('Proxima Centauri', 'Gl 551 · HIP 70890');
    expect(k).toContain('hip:70890');     // archive: "HIP 70890" → hip:70890
    expect(k).toContain('gj:551');
    expect(k).toContain('name:proxima centauri');
  });
  it('agrees with the build-side format for bare HD / HIP', () => {
    expect(starKeys('x', 'HD 95735')).toContain('hd:95735');
    expect(starKeys('x', 'HIP 70890')).toContain('hip:70890');
  });
  it('normalises Gliese suffixes (Gl 65A → gj:65a)', () => {
    expect(starKeys('x', 'Gl 65A')).toContain('gj:65a');
  });
  it('handles multiple " · "-joined designations', () => {
    const k = starKeys("Barnard's Star", 'Gl 699 · HIP 87937');
    expect(k).toContain('gj:699');
    expect(k).toContain('hip:87937');
  });
});

describe('classifyByRadius — Earth-radii size bins', () => {
  it('bins real planet radii into the shared taxonomy', () => {
    expect(classifyByRadius(1.0, null)).toBe('rocky');        // Proxima b 1.02 R⊕
    expect(classifyByRadius(1.8, null)).toBe('super-earth');
    expect(classifyByRadius(3.5, null)).toBe('neptune');
    expect(classifyByRadius(8, null)).toBe('ice-giant');
    expect(classifyByRadius(14, null)).toBe('gas-giant');     // eps Eri b 14.1 R⊕
  });
  it('falls back to mass when radius is unknown, else sub-Neptune', () => {
    expect(classifyByRadius(null, 1)).toBe('rocky');
    expect(classifyByRadius(null, null)).toBe('neptune');
  });
});
