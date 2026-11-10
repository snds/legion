#!/usr/bin/env node
/**
 * Offline reference renders with vork (https://voyager.so/vork).
 *
 * vork is a headless, ray-traced renderer driven by scene JSON. Legion uses it to
 * make physically-lit REFERENCE plates to judge the realtime WebGPU frame against.
 * It never ships in the game and is not a dependency of the build.
 *
 *   node scripts/vork-ref.mjs list
 *   node scripts/vork-ref.mjs check  [id...]            # no GPU needed
 *   node scripts/vork-ref.mjs render [id...] [--profile std/previs] [--res 1920x1080] [--at 0]
 *   node scripts/vork-ref.mjs upstream black-hole [--res 640x360] [--at 6]
 *   Add --cpu to render on the CPU (Linux only, slow; see below).
 *
 * Scenes:  reference/vork/<id>/scene.json   (tracked)
 * Output:  refs/vork/<id>/<profile>.png     (git-ignored, like refs/continuum)
 *
 * Rendering needs Apple Silicon (Metal, macOS 26) or a recent NVIDIA card with
 * hardware ray tracing. On Linux without one, `--cpu` uses Mesa's software
 * Vulkan driver (`apt-get install mesa-vulkan-drivers`): slow, but it works in
 * a cloud session. `check` only loads the scene, so it runs anywhere.
 * Full notes: docs/vork-reference-renderer.md
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCENES = join(ROOT, 'reference/vork');
const OUT = join(ROOT, 'refs/vork');
const CACHE = join(ROOT, 'scripts/.cache/vork-upstream');

// Pinned: the vork Preview License covers one version at a time, and scene
// fields change between releases (see `vork help upgrade`). Bump on purpose.
const VORK_VERSION = '0.4.0';
const UPSTREAM_REPO = 'https://github.com/voyager-so/vork';

// vork exit codes (`vork help errors`).
const EXIT_INVALID_SCENE = 3;
const EXIT_DEVICE = 4;

const [command = 'list', ...rest] = process.argv.slice(2);
const ids = [];
const opts = {};
const SWITCHES = new Set(['cpu']); // options that take no value
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith('--')) ids.push(rest[i]);
  else if (SWITCHES.has(rest[i].slice(2))) opts[rest[i].slice(2)] = true;
  else opts[rest[i].slice(2)] = rest[++i];
}

/** Use a `vork` already on PATH (or $VORK); otherwise fetch the pinned npm build. */
function vorkCommand() {
  const local = process.env.VORK || 'vork';
  const probe = spawnSync(local, ['--version'], { encoding: 'utf8' });
  if (probe.status === 0) {
    if (!probe.stdout.includes(VORK_VERSION)) {
      console.warn(`! ${probe.stdout.trim().split('\n')[0]} found; scenes are written for ${VORK_VERSION}`);
    }
    return [local];
  }
  // ~430 MB platform binary on first use; npm caches it afterwards.
  return ['npx', '-y', `@voyager-so/vork@${VORK_VERSION}`];
}

function vork(args, { cwd = ROOT, quiet = false } = {}) {
  const [bin, ...pre] = vorkCommand();
  return spawnSync(bin, [...pre, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: quiet ? 'pipe' : 'inherit',
    // vork never picks the CPU by itself; it has to be asked for.
    env: opts.cpu ? { ...process.env, VORK_GPU: 'cpu' } : process.env,
  });
}

function sceneIds() {
  if (!existsSync(SCENES)) return [];
  return readdirSync(SCENES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SCENES, d.name, 'scene.json')))
    .map((d) => d.name);
}

/** Optional per-scene defaults: reference/vork/<id>/ref.json → { profile, at }. */
function sceneDefaults(id) {
  const file = join(SCENES, id, 'ref.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

function selected() {
  const all = sceneIds();
  const unknown = ids.filter((id) => !all.includes(id));
  if (unknown.length) {
    console.error(`Unknown scene: ${unknown.join(', ')}. Known: ${all.join(', ') || '(none)'}`);
    process.exit(2);
  }
  return ids.length ? ids : all;
}

function renderArgs(scene, out, defaults = {}) {
  const profile = opts.profile ?? defaults.profile ?? 'std/final';
  const args = ['render', scene, '--profile', profile, '--out', out];
  const at = opts.at ?? defaults.at;
  if (at !== undefined) args.push('--at', String(at));
  if (opts.res) args.push('--set', `resolution=${opts.res}`);
  if (opts.samples) args.push('--set', `samples=${opts.samples}`);
  return { args, profile };
}

function profileSlug(profile) {
  return profile.replace(/^std\//, '').replace(/[^a-z0-9-]/gi, '-');
}

function noGpuHelp() {
  console.error(
    '\nvork found no GPU it can use. Rendering needs Apple Silicon (macOS 26) or a recent\n' +
      'NVIDIA card with hardware ray tracing. On Linux you can render on the CPU instead:\n' +
      'install `mesa-vulkan-drivers`, then add `--cpu`. Scenes can always be checked with\n' +
      '`npm run ref:vork:check`. See docs/vork-reference-renderer.md.',
  );
}

function list() {
  for (const id of sceneIds()) {
    const d = sceneDefaults(id);
    console.log(`${id}${d.rows ? `  → ${d.rows.join(', ')}` : ''}${d.note ? `  — ${d.note}` : ''}`);
  }
}

/**
 * Load each scene without needing a GPU. vork reads and validates the scene before
 * it opens the device, so "invalid scene" (3) is a real failure and "device" (4)
 * means the scene loaded. Custom shader code and camera/program inputs are only
 * validated during a real render, so pass --cpu on Linux for a full check.
 */
function check() {
  const tmp = mkdtempSync(join(tmpdir(), 'vork-check-'));
  let failed = 0;
  for (const id of selected()) {
    const r = vork(
      ['render', join(SCENES, id, 'scene.json'), '--profile', 'std/previs', '--set', 'resolution=64x36', '--out', join(tmp, `${id}.png`)],
      { quiet: true },
    );
    if (r.status === 0) console.log(`ok    ${id} (loaded and rendered)`);
    else if (r.status === EXIT_DEVICE) console.log(`ok    ${id} (loaded; no GPU here, shaders unchecked)`);
    else {
      failed++;
      const reason = (r.stderr || '').split('\n').find((l) => l.startsWith('Error:')) ?? `exit ${r.status}`;
      console.log(`FAIL  ${id}\n      ${reason}`);
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

function render() {
  for (const id of selected()) {
    const { args, profile } = renderArgs(join(SCENES, id, 'scene.json'), '', sceneDefaults(id));
    const out = join(OUT, id, `${profileSlug(profile)}.png`);
    args[args.indexOf('--out') + 1] = out;
    mkdirSync(dirname(out), { recursive: true });
    console.log(`\n▶ ${id} · ${profile} → ${out}`);
    const r = vork(args);
    if (r.status === EXIT_DEVICE) noGpuHelp();
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

/**
 * Render one of vork's own examples in place (e.g. the Schwarzschild black hole).
 * Their example code stays in a git-ignored cache: the vork Preview License does
 * not allow redistributing modified copies, so it is never copied into Legion.
 */
function upstream() {
  const example = ids[0];
  if (!example) {
    console.error('Usage: vork-ref.mjs upstream <example>   e.g. black-hole');
    process.exit(2);
  }
  if (!existsSync(CACHE)) {
    mkdirSync(dirname(CACHE), { recursive: true });
    const clone = spawnSync('git', ['clone', '--depth', '1', '--branch', `v${VORK_VERSION}`, UPSTREAM_REPO, CACHE], { stdio: 'inherit' });
    if (clone.status !== 0) process.exit(clone.status ?? 1);
  }
  const dir = join(CACHE, 'examples', example);
  if (!existsSync(join(dir, 'scene.json'))) {
    console.error(`No scene.json in ${dir}`);
    process.exit(2);
  }
  // Some examples build their geometry buffers first (black-hole: disk + debris).
  if (existsSync(join(dir, 'generate.py'))) {
    const gen = spawnSync('python3', ['generate.py'], { cwd: dir, stdio: 'inherit' });
    if (gen.status !== 0) process.exit(gen.status ?? 1);
  }
  // Curved light paths need the path tracer.
  const { args, profile } = renderArgs(join(dir, 'scene.json'), '', { profile: 'std/path', at: 6 });
  const out = join(OUT, `upstream-${example}`, `${profileSlug(profile)}.png`);
  args[args.indexOf('--out') + 1] = out;
  mkdirSync(dirname(out), { recursive: true });
  console.log(`\n▶ upstream ${example} · ${profile} → ${out}`);
  const r = vork(args);
  if (r.status === EXIT_DEVICE) noGpuHelp();
  process.exit(r.status ?? 1);
}

const commands = { list, check, render, upstream };
if (!commands[command]) {
  console.error(`Unknown command "${command}". Use: ${Object.keys(commands).join(' | ')}`);
  process.exit(2);
}
commands[command]();
