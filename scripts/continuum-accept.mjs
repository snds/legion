#!/usr/bin/env node
/**
 * Continuum planet accept shortcut → scripts/legion-accept.mjs
 *
 *   npm run accept:continuum -- --type rocky --only stills
 *   npm run accept:continuum -- --type all --only stills --skip-qa
 *
 * Full surface (demos, multi-lab): scripts/legion-accept.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, 'legion-accept.mjs');
const forwarded = process.argv.slice(2);
const hasLab = forwarded.includes('--lab');
const hasDemo = forwarded.includes('--demo');
const args = [
  target,
  ...(hasLab || hasDemo ? [] : ['--lab', 'planet', '--engine', 'continuum']),
  ...forwarded,
];
const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
