#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// PROMOTE LAB — P2-9 replacement for the Lab's "Copy JSON" hand-merge.
//
// OLD path: click "Copy JSON" in the Lab, hand-paste the clipboard blob into
// presets.ts / plates.ts / bake.ts / lab-ideal.json yourself, four separate
// manual edits, nothing checked. Already shipped a real regression (F4 —
// see presets.ts:186-204: a Continuum-only tuning value leaked into the
// SHARED PRESETS.ocean object and thinned every Legacy ocean world too).
//
// NEW path: this script is the ONLY promotion path. It takes the exact same
// "Copy JSON" clipboard payload (still produced by planet-lab.ts — Save/Save
// interim/localStorage are untouched, still load-bearing per
// .intent/guidelines.md) and:
//   1. Diffs it field-by-field against the CURRENT presets.ts/plates.ts/
//      bake.ts source (via scripts/lib/lab-codemod.mjs, TS-compiler-API
//      based — reads real values, not text guesses).
//   2. Applies ONLY the fields that actually changed, as a minimal text
//      splice (every comment, every untouched field, byte-identical).
//   3. Re-reads the patched source back and writes lab-ideal.json FROM that
//      read-back — so the guidepost and the shipped values can never
//      diverge; there is no longer a 4th hand-edit to forget.
//   4. Prints a full per-field change list before writing anything (dry-run
//      by default — pass --write to actually touch files).
//
// Usage:
//   node scripts/promote-lab.mjs                       # dry-run from clipboard (pbpaste)
//   node scripts/promote-lab.mjs --write                # apply from clipboard
//   node scripts/promote-lab.mjs --file lab-export.json --write
//   cat lab-export.json | node scripts/promote-lab.mjs --stdin --write
//
// After --write: run `npx tsc --noEmit` and `npm test` (the P2-9 sync test —
// src/render/planet/lab-sync.test.ts — fails CI if this ever drifts again).
// ═══════════════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchExportedObject, readExportedObject, stringifyLikePrettier } from './lib/lab-codemod.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PRESETS_TS = resolve(ROOT, 'src/render/planet/presets.ts');
const PLATES_TS = resolve(ROOT, 'src/render/planet/plates.ts');
const BAKE_TS = resolve(ROOT, 'src/render/planet/bake.ts');
const LAB_IDEAL_JSON = resolve(ROOT, 'src/render/planet/lab-ideal.json');

const PLANET_TYPES = ['rocky', 'ocean', 'desert', 'lava', 'ice', 'gas'];

// DOCUMENTED, DELIBERATE exceptions — the ONLY fields this tool will never
// promote into the shared shipping source, because they legitimately need a
// different value in the Lab's Continuum preview than in shipped PRESETS
// (see presets.ts:186-204, the F4 postmortem: Continuum's cloud-shell curve
// saturates at Legacy's shared cloudCover, so the Lab's committed guidepost
// intentionally carries a lower preview-only value). This list is the ENTIRE
// point of this tool existing — everything NOT on it gets promoted for real,
// and anything on it is refused even if the clipboard payload contains it
// (which it always will while the Lab is open, since applyLab(labIdeal) sets
// it in-memory at boot for every session, engine, and archetype view).
// Keep this list in exact sync with the twin allowlist in
// src/render/planet/lab-sync.test.ts — the sync test's own log names any
// field that diverges without being on BOTH lists, so a drifted duplicate is
// self-reporting, not a silent trap.
const KNOWN_LAB_ONLY_OVERRIDES = [
  { scope: 'presets', type: 'ocean', key: 'cloudCover' },
  { scope: 'presets', type: 'ocean', key: 'cloudShadow' },
];

/** Remove KNOWN_LAB_ONLY_OVERRIDES fields from a `presets` input object before
 *  it reaches the shipping-source patcher, and return what was removed so the
 *  caller can still preserve them in lab-ideal.json (the guidepost). */
function extractLabOnlyOverrides(presetsInput) {
  const forShipping = {};
  const preserved = [];
  for (const [type, fields] of Object.entries(presetsInput)) {
    const copy = { ...fields };
    for (const o of KNOWN_LAB_ONLY_OVERRIDES) {
      if (o.scope === 'presets' && o.type === type && o.key in copy) {
        preserved.push({ type, key: o.key, value: copy[o.key] });
        delete copy[o.key];
      }
    }
    forShipping[type] = copy;
  }
  return { forShipping, preserved };
}

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const FROM_STDIN = args.includes('--stdin');
const fileFlagIdx = args.indexOf('--file');
const FILE_ARG = fileFlagIdx >= 0 ? args[fileFlagIdx + 1] : null;

function readInputJson() {
  let raw;
  if (FILE_ARG) {
    raw = readFileSync(resolve(ROOT, FILE_ARG), 'utf8');
  } else if (FROM_STDIN) {
    raw = readFileSync(0, 'utf8'); // fd 0 = stdin
  } else {
    // Matches planet-lab.ts "Copy JSON" — navigator.clipboard.writeText puts
    // the payload on the OS clipboard; pbpaste is the macOS read side.
    try {
      raw = execFileSync('pbpaste', { encoding: 'utf8' });
    } catch {
      throw new Error(
        'Could not read the OS clipboard (pbpaste failed — not macOS, or nothing copied). '
        + 'Use --file <path> or --stdin instead. Run "Copy JSON" in the Lab first if using the clipboard path.',
      );
    }
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Input is not valid JSON (${err.message}). Did you run "Copy JSON" in the Lab and copy the FULL clipboard contents?`);
  }
  return data;
}

function validateShape(data) {
  const problems = [];
  for (const key of ['presets', 'macro', 'bake']) {
    if (!data[key] || typeof data[key] !== 'object') problems.push(`missing top-level "${key}"`);
  }
  if (data.presets) {
    for (const t of PLANET_TYPES) if (!data.presets[t]) problems.push(`presets.${t} missing`);
  }
  if (data.macro) {
    for (const t of PLANET_TYPES) if (!data.macro[t]) problems.push(`macro.${t} missing`);
  }
  if (problems.length) {
    throw new Error(`Lab export is missing expected data:\n  - ${problems.join('\n  - ')}\n`
      + 'This does not look like a full "Copy JSON" payload from planet-lab.ts snapshotLab().');
  }
}

function printChanges(label, changes) {
  if (changes.length === 0) {
    console.log(`  ${label}: no change`);
    return;
  }
  console.log(`  ${label}: ${changes.length} field(s) changed`);
  for (const c of changes) {
    console.log(`    ${c.path}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
  }
}

function main() {
  const input = readInputJson();
  validateShape(input);

  const { forShipping: presetsForShipping, preserved: labOnlyPreserved } = extractLabOnlyOverrides(input.presets);

  const { code: presetsCode, changes: presetsChanges } = patchExportedObject(PRESETS_TS, 'PRESETS', presetsForShipping);
  const { code: macroCode, changes: macroChanges } = patchExportedObject(PLATES_TS, 'MACRO', input.macro);
  const { code: bakeCode, changes: bakeChanges } = patchExportedObject(BAKE_TS, 'DEFAULT_BAKE', input.bake, { flat: true });

  console.log(`[promote-lab] ${WRITE ? 'APPLYING' : 'DRY RUN (pass --write to apply)'}`);
  printChanges('presets.ts PRESETS', presetsChanges);
  printChanges('plates.ts MACRO', macroChanges);
  printChanges('bake.ts DEFAULT_BAKE', bakeChanges);
  if (labOnlyPreserved.length) {
    console.log('  KNOWN LAB-ONLY (never promoted to shipping — kept in lab-ideal.json only):');
    for (const o of labOnlyPreserved) console.log(`    presets.${o.type}.${o.key} = ${JSON.stringify(o.value)}`);
  }

  const totalChanges = presetsChanges.length + macroChanges.length + bakeChanges.length;
  if (totalChanges === 0) {
    console.log('[promote-lab] Nothing to promote to shipping source — the Lab export already matches presets.ts/plates.ts/bake.ts.');
    if (!WRITE) return;
    // Fall through anyway: lab-ideal.json may still need to re-sync (e.g. a
    // stale field nobody had re-promoted) even when shipping source itself
    // is already correct — this is the "fix accidental drift" path.
  }

  if (!WRITE) {
    console.log('\n[promote-lab] Dry run only — no files written. Re-run with --write to apply.');
    return;
  }

  writeFileSync(PRESETS_TS, presetsCode);
  writeFileSync(PLATES_TS, macroCode);
  writeFileSync(BAKE_TS, bakeCode);

  // Read the CANONICAL values back from what we just wrote (not the raw
  // input) — lab-ideal.json is a DERIVED artifact of the shipped source, so
  // the two cannot drift on anything except the documented KNOWN_LAB_ONLY_
  // OVERRIDES above: there is no 4th manual edit left to skip or botch.
  const presetsCanonical = readExportedObject(PRESETS_TS, 'PRESETS');
  const macroCanonical = readExportedObject(PLATES_TS, 'MACRO');
  const bakeCanonical = readExportedObject(BAKE_TS, 'DEFAULT_BAKE');
  const baked = Object.fromEntries(PLANET_TYPES.map((t) => [t, false])); // Lab forces this off at every load anyway

  for (const o of labOnlyPreserved) presetsCanonical[o.type][o.key] = o.value;

  const labIdeal = {
    presets: presetsCanonical,
    macro: macroCanonical,
    bake: bakeCanonical,
    baked,
  };
  writeFileSync(LAB_IDEAL_JSON, `${stringifyLikePrettier(labIdeal)}\n`);

  console.log(`\n[promote-lab] Wrote presets.ts, plates.ts, bake.ts, lab-ideal.json (${totalChanges} shipping field change(s), lab-ideal.json fully re-synced).`);
  console.log('[promote-lab] Next: npx tsc --noEmit && npx vitest run src/render/planet/lab-sync.test.ts');
}

main();
