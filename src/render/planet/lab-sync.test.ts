// P2-9 — CI guard for the Lab promotion mechanism (A7 recommendation:
// "a test that fails CI if lab-ideal.json and PRESETS/MACRO diverge").
//
// lab-ideal.json is now a DERIVED artifact: scripts/promote-lab.mjs writes it
// straight from the same read-back it just wrote into presets.ts/plates.ts/
// bake.ts, so the two should be byte-for-byte equivalent (as parsed values).
// If this test fails, someone edited lab-ideal.json OR PRESETS/MACRO/
// DEFAULT_BAKE by hand instead of through scripts/promote-lab.mjs — the
// exact hand-merge failure mode (F4, presets.ts:186-204) this task replaced.
import { describe, it, expect } from 'vitest';
import { PRESETS, PLANET_TYPES } from './presets';
import { MACRO } from './plates';
import { DEFAULT_BAKE } from './bake';
import labIdeal from './lab-ideal.json';

/** Mirrors scripts/lib/lab-codemod.mjs's valuesEqual (float-tolerant deep
 *  equality) — duplicated locally rather than imported across the src/
 *  boundary so this test has no dependency on a plain-JS module outside the
 *  TS project (tsc --noEmit can't type a .mjs file without a declaration). */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => valuesEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a), bk = Object.keys(b);
    return ak.length === bk.length && ak.every((k) => valuesEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/** MUST stay in exact sync with KNOWN_LAB_ONLY_OVERRIDES in
 *  scripts/promote-lab.mjs — the ONLY fields this test allows to diverge
 *  between lab-ideal.json and shipping source, because they're genuinely
 *  different by design (Continuum-in-Lab preview correction, see
 *  presets.ts:186-204 / the F4 postmortem), not drift. Any OTHER divergence
 *  fails below — that's the actual point of this test. */
const KNOWN_LAB_ONLY_OVERRIDES = new Set(['presets.ocean.cloudCover', 'presets.ocean.cloudShadow']);

describe('lab-ideal.json stays in sync with shipping source (P2-9)', () => {
  for (const type of PLANET_TYPES) {
    it(`presets.${type} matches lab-ideal.json (except documented lab-only overrides)`, () => {
      const guidepost = (labIdeal as { presets: Record<string, unknown> }).presets[type];
      expect(guidepost).toBeDefined();
      for (const [key, val] of Object.entries(guidepost as Record<string, unknown>)) {
        if (KNOWN_LAB_ONLY_OVERRIDES.has(`presets.${type}.${key}`)) continue; // documented, intentional
        const live = (PRESETS[type] as unknown as Record<string, unknown>)[key];
        if (!valuesEqual(live, val)) {
          throw new Error(
            `PRESETS.${type}.${key} = ${JSON.stringify(live)} but lab-ideal.json has ${JSON.stringify(val)}. `
            + 'Promote via `node scripts/promote-lab.mjs --write`, not a hand edit. '
            + 'If this divergence is INTENTIONAL, add it to KNOWN_LAB_ONLY_OVERRIDES here AND in scripts/promote-lab.mjs.',
          );
        }
      }
    });

    it(`macro.${type} matches lab-ideal.json`, () => {
      const guidepost = (labIdeal as { macro: Record<string, unknown> }).macro[type];
      expect(guidepost).toBeDefined();
      for (const [key, val] of Object.entries(guidepost as Record<string, unknown>)) {
        const live = (MACRO[type] as unknown as Record<string, unknown>)[key];
        if (!valuesEqual(live, val)) {
          throw new Error(
            `MACRO.${type}.${key} = ${JSON.stringify(live)} but lab-ideal.json has ${JSON.stringify(val)}. `
            + 'Promote via `node scripts/promote-lab.mjs --write`, not a hand edit.',
          );
        }
      }
    });
  }

  it('bake defaults match lab-ideal.json', () => {
    const guidepost = (labIdeal as { bake: Record<string, unknown> }).bake;
    for (const [key, val] of Object.entries(guidepost)) {
      const live = (DEFAULT_BAKE as unknown as Record<string, unknown>)[key];
      if (!valuesEqual(live, val)) {
        throw new Error(
          `DEFAULT_BAKE.${key} = ${JSON.stringify(live)} but lab-ideal.json has ${JSON.stringify(val)}. `
          + 'Promote via `node scripts/promote-lab.mjs --write`, not a hand edit.',
        );
      }
    }
  });
});
