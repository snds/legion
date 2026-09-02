#!/usr/bin/env node
/**
 * Unified Legion accept harness (Playwright).
 *
 * Planet Continuum / Legacy lab:
 *   node scripts/legion-accept.mjs --lab planet --engine continuum --type rocky --only stills
 *   node scripts/legion-accept.mjs --lab planet --type ocean,rocky,desert --only stills --skip-qa
 *
 * Review-build demos (star, blackhole, nebula, galaxy, planet, approach):
 *   node scripts/legion-accept.mjs --demo star,blackhole --only stills --skip-qa
 *
 * Continuum shortcut (npm run accept:continuum):
 *   node scripts/continuum-accept.mjs → this file with --lab planet --engine continuum
 *
 * Requires Vite running. Prefers system Chrome; falls back to Playwright Chromium.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TOOLKIT = resolve(ROOT, '../Workspace/03-skills/render-qa-toolkit');

const PLANET_TYPES = ['rocky', 'ocean', 'desert', 'lava', 'ice', 'gas'];
const DEMO_IDS = ['star', 'planet', 'nebula', 'blackhole', 'galaxy', 'approach'];

const args = process.argv.slice(2);
function flag(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) return true;
  return v;
}

/** Labs not yet available in ui/labs.ts → capture via matching review demos. */
const LAB_TO_DEMO = {
  star: 'star',
  blackhole: 'blackhole',
  nebula: 'nebula',
};

const BASE = String(flag('base', 'http://127.0.0.1:5174')).replace(/\/$/, '');
const LAB_RAW = String(flag('lab', '')); // planet | star | blackhole | nebula | ''
const ENGINE = String(flag('engine', 'continuum')); // continuum | legacy
let DEMO_LIST = String(flag('demo', ''))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (!DEMO_LIST.length && LAB_RAW && LAB_TO_DEMO[LAB_RAW]) {
  DEMO_LIST = [LAB_TO_DEMO[LAB_RAW]];
  console.log(`[accept] lab=${LAB_RAW} is not built yet — capturing demo "${DEMO_LIST[0]}" (refs/demos/${DEMO_LIST[0]}/)`);
}
const LAB = LAB_RAW === 'planet' || (!LAB_RAW && !DEMO_LIST.length) ? 'planet' : LAB_RAW;
const TYPE_RAW = String(flag('type', LAB === 'planet' && !DEMO_LIST.length ? 'ocean' : ''));
const TYPES = TYPE_RAW === 'all'
  ? [...PLANET_TYPES]
  : TYPE_RAW.split(',').map((s) => s.trim()).filter(Boolean);
const ONLY = new Set(String(flag('only', DEMO_LIST.length ? 'stills' : 'stills,motion,perf')).split(',').map((s) => s.trim()).filter(Boolean));
const SKIP_QA = Boolean(flag('skip-qa', false));
const HEADLESS = flag('headless', 'false') !== 'false';
const SETTLE_MS = Number(flag('settle-ms', 5000));
const DEMO_SETTLE_MS = Number(flag('demo-settle-ms', 8000));
const MOTION_FPS = Number(flag('motion-fps', 12));

const MODE = DEMO_LIST.length ? 'demo' : 'planet';

function continuumRefs() {
  return join(ROOT, 'refs', 'continuum');
}

function demoRefs(id) {
  return join(ROOT, 'refs', 'demos', id);
}

function stillPrefix(type) {
  return type === 'ocean' ? 'continuum' : `continuum-${type}`;
}

function ensurePlanetDirs(type) {
  const base = continuumRefs();
  const tag = type === 'ocean' ? '' : `${type}/`;
  for (const p of [
    join(base, 'stills'),
    join(base, 'perf'),
    join(base, 'qa'),
    join(base, 'motion', 'approach-surface'),
    join(base, 'motion', 'orbit-0.8au'),
    join(base, 'motion', 'look-orient'),
  ]) mkdirSync(p, { recursive: true });
  if (type !== 'ocean') mkdirSync(join(base, 'stills'), { recursive: true });
  void tag;
}

function ensureDemoDirs(id) {
  mkdirSync(join(demoRefs(id), 'stills'), { recursive: true });
}

async function captureCanvasPng(page, outPath) {
  const box = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return {
      x: Math.max(0, r.x),
      y: Math.max(0, r.y),
      width: Math.max(1, r.width),
      height: Math.max(1, r.height),
    };
  });
  if (!box) throw new Error('no canvas element');
  await page.screenshot({ path: outPath, type: 'png', clip: box });
}

function waitMs(page, ms) {
  return page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms);
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    console.error('Playwright not installed. Run: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
}

async function waitAccept(page, timeout = 60000) {
  await page.waitForFunction(() => {
    const a = window.__continuumAccept;
    return !!(a && a.ready());
  }, null, { timeout });
}

async function waitCanvas(page, timeout = 60000) {
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas');
    return !!(c && c.width > 64 && c.height > 64);
  }, null, { timeout });
}

/** DOM chrome + Continuum lab props (lab-sun). Safe for planet lab and review demos. */
async function hideLabChrome(page) {
  await page.evaluate(() => {
    const api = window.__continuumAccept;
    if (api && typeof api.setLabPropsVisible === 'function') api.setLabPropsVisible(false);

    let style = document.getElementById('accept-chrome-hide');
    if (!style) {
      style = document.createElement('style');
      style.id = 'accept-chrome-hide';
      document.head.appendChild(style);
    }
    // Keep only the WebGL canvas path visible; kill HUD/docks/demo chrome
    // even when nodes are added after first hide (demo director / HUD ticks).
    style.textContent = `
      #hud, #dot-grid, #hover-tip, #dest-mode-indicator,
      #demo-menu-btn, #demo-menu, #demo-caption,
      #continuum-chunk-hud, #debug-overlay, #paint-hud, #view-scale,
      .gen-lab-panel, .gen-lab-tab, .gen-lab-toggle, [class*="lab-dock"] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        opacity: 0 !important;
      }
      body > *:not(#game-container):not(script):not(style):not(link) {
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `;

    const canvas = document.querySelector('#game-container canvas, canvas');
    const hide = (el) => {
      if (!el || !(el instanceof HTMLElement)) return;
      if (canvas && (el === canvas || el.contains(canvas) || canvas.contains(el))) return;
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    };
    [
      'hud', 'dot-grid', 'hover-tip', 'dest-mode-indicator',
      'continuum-chunk-hud', 'debug-overlay', 'view-scale', 'paint-hud',
      'demo-menu-btn', 'demo-menu', 'demo-caption',
    ].forEach((id) => hide(document.getElementById(id)));
    document.querySelectorAll('.gen-lab-panel, .gen-lab-tab, .gen-lab-toggle, [class*="lab-dock"]')
      .forEach(hide);
  });
}

async function poseSun(page, mode) {
  const facing = await page.evaluate(async (mode) => {
    const api = window.__continuumAccept;
    api.setSpin(false);
    api.poseSun(mode);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return api.sunFacing();
  }, mode);
  const want = mode === 'day' ? 1 : mode === 'night' ? -1 : 0;
  if (Math.abs(facing - want) > 0.05) {
    console.warn(`[pose] ${mode} sunFacing=${facing.toFixed(3)} (want ${want})`);
  }
}

async function capturePlanetStill(page, type, { id, au, pose, clouds = true, idleMs = SETTLE_MS }, attempt = 0) {
  const eng = ENGINE === 'legacy' ? '' : '&engine=continuum';
  const url = `${BASE}/?lab=planet${eng}&accept=1&type=${encodeURIComponent(type)}&au=${au}&w=1920&h=1080&dpr=1`;
  console.log(`[still] ${id} → ${url}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    if (ENGINE === 'continuum') {
      await waitAccept(page);
      await waitMs(page, 500);
      await waitAccept(page);
      await page.evaluate(({ au, clouds, type }) => {
        const api = window.__continuumAccept;
        if (typeof api.setArchetype === 'function' && api.archetype() !== type) api.setArchetype(type);
        api.setClouds(clouds);
        api.setSpin(false);
        api.setAu(au);
        if (typeof api.setLabPropsVisible === 'function') api.setLabPropsVisible(false);
      }, { au, clouds, type });
      await waitAccept(page);
      if (pose) await poseSun(page, pose);
      if (id.includes('coast') || id.includes('surface')) {
        await page.evaluate(() => window.__continuumAccept.nudgeYaw(0.7));
      }
      const hud = await page.evaluate(async (idleMs) => {
        return window.__continuumAccept.waitSettled(45000, idleMs);
      }, idleMs);
      console.log(`[still] ${id} settled medianTex=${hud.medianTex} coverAgeMs=${hud.coverAgeMs}`);
    } else {
      await waitCanvas(page);
      await waitMs(page, SETTLE_MS);
    }
    await hideLabChrome(page);
    await waitMs(page, 100);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const out = join(continuumRefs(), 'stills', `${id}.png`);
    await captureCanvasPng(page, out);
    console.log(`[still] wrote ${out}`);
  } catch (err) {
    if (attempt < 2 && /Execution context was destroyed|Target closed|navigation/i.test(String(err))) {
      console.warn(`[still] ${id} retry after ${err.message?.split('\n')[0] || err}`);
      await capturePlanetStill(page, type, { id, au, pose, clouds, idleMs }, attempt + 1);
      return;
    }
    throw err;
  }
}

async function capturePlanetPerf(page, type, au, outName) {
  const url = `${BASE}/?lab=planet&engine=continuum&accept=1&type=${encodeURIComponent(type)}&perfcapture&au=${au}&w=1280&h=720&dpr=2&warmup=90&samples=120`;
  console.log(`[perf] ${outName} → ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitAccept(page);
  await page.evaluate((type) => {
    const api = window.__continuumAccept;
    if (typeof api.setArchetype === 'function' && api.archetype() !== type) api.setArchetype(type);
    if (typeof api.setLabPropsVisible === 'function') api.setLabPropsVisible(false);
  }, type);
  const json = await page.evaluate(async () => window.__continuumAccept.waitPerfCapture(180000));
  const out = join(continuumRefs(), 'perf', outName);
  writeFileSync(out, JSON.stringify(json, null, 2));
  const worst = (json.rows || []).find((r) => r.phase === 'worst');
  console.log(`[perf] wrote ${out} worst.gpuMedianMs=${worst?.gpuMedianMs}`);
}

async function capturePlanetMotion(page, type, {
  id, startAu, endAu = null, durationSec, yawTotal = 0, spin = false,
}) {
  const url = `${BASE}/?lab=planet&engine=continuum&accept=1&type=${encodeURIComponent(type)}&au=${startAu}&w=1920&h=1080&dpr=1`;
  const outDir = join(continuumRefs(), 'motion', type === 'ocean' ? id : join(type, id));
  mkdirSync(outDir, { recursive: true });
  console.log(`[motion] ${id} ${durationSec}s → ${outDir}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitAccept(page);
  await page.evaluate(({ startAu, spin, type }) => {
    const api = window.__continuumAccept;
    if (typeof api.setArchetype === 'function' && api.archetype() !== type) api.setArchetype(type);
    api.setClouds(true);
    api.setSpin(spin);
    api.setAu(startAu);
    if (typeof api.setLabPropsVisible === 'function') api.setLabPropsVisible(false);
  }, { startAu, spin, type });
  await page.evaluate(async () => {
    await window.__continuumAccept.waitSettled(30000, 1500);
  });
  await hideLabChrome(page);
  await waitMs(page, 100);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const frames = Math.max(2, Math.round(durationSec * MOTION_FPS));
  const dt = durationSec / (frames - 1);
  const yawStep = yawTotal / (frames - 1);
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    if (endAu != null) {
      const au = startAu + (endAu - startAu) * t;
      await page.evaluate((au) => window.__continuumAccept.setAu(au), au);
    }
    if (yawStep) {
      await page.evaluate((y) => window.__continuumAccept.nudgeYaw(y), yawStep);
    }
    await waitMs(page, Math.max(8, dt * 1000 * 0.35));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const name = `f_${String(i + 1).padStart(3, '0')}.png`;
    await captureCanvasPng(page, join(outDir, name));
    if (i % Math.max(1, Math.floor(frames / 8)) === 0) process.stdout.write(`  frame ${i + 1}/${frames}\n`);
  }
  console.log(`[motion] ${id} wrote ${frames} frames`);
}

async function captureDemoStill(page, demoId) {
  ensureDemoDirs(demoId);
  const url = `${BASE}/?demo=${encodeURIComponent(demoId)}&accept=1&w=1920&h=1080&dpr=1`;
  console.log(`[demo] ${demoId} → ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitCanvas(page);
  // Demo director eases camera; give it time before capture.
  await waitMs(page, DEMO_SETTLE_MS);
  await hideLabChrome(page);
  await waitMs(page, 100);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const out = join(demoRefs(demoId), 'stills', `${demoId}-beauty.png`);
  await captureCanvasPng(page, out);
  console.log(`[demo] wrote ${out}`);
}

async function runPlanetType(page, type) {
  if (!PLANET_TYPES.includes(type)) {
    console.warn(`[accept] unknown planet type "${type}" — skip`);
    return;
  }
  ensurePlanetDirs(type);
  const prefix = stillPrefix(type);
  console.log(`\n[accept] planet type=${type} engine=${ENGINE} prefix=${prefix}`);

  if (ONLY.has('stills')) {
    await capturePlanetStill(page, type, { id: `${prefix}-0.8-day`, au: 0.8, pose: 'day' });
    await capturePlanetStill(page, type, { id: `${prefix}-0.8-night`, au: 0.8, pose: 'night' });
    const closeId = type === 'ocean' ? `${prefix}-0.3-coast` : `${prefix}-0.3-surface`;
    await capturePlanetStill(page, type, { id: closeId, au: 0.3, pose: 'day', idleMs: SETTLE_MS });
    await capturePlanetStill(page, type, { id: `${prefix}-0.6-clouds`, au: 0.6, pose: 'terminator', clouds: true });
    if (type === 'rocky' || type === 'desert' || type === 'lava') {
      await capturePlanetStill(page, type, {
        id: `${prefix}-0.8-day-noclouds`, au: 0.8, pose: 'day', clouds: false,
      });
    }
  }
  if (ONLY.has('perf') && ENGINE === 'continuum') {
    const perfTag = type === 'ocean' ? 'lab-continuum' : `lab-continuum-${type}`;
    await capturePlanetPerf(page, type, 0.8, `${perfTag}-0.8au.json`);
    await capturePlanetPerf(page, type, 0.3, `${perfTag}-0.3au.json`);
  }
  if (ONLY.has('motion') && ENGINE === 'continuum') {
    await capturePlanetMotion(page, type, {
      id: 'approach-surface', startAu: 0.8, endAu: 0.2, durationSec: 10, spin: false,
    });
    await capturePlanetMotion(page, type, {
      id: 'orbit-0.8au', startAu: 0.8, durationSec: 12, yawTotal: Math.PI * 2, spin: false,
    });
    await capturePlanetMotion(page, type, {
      id: 'look-orient', startAu: 0.35, durationSec: 8, yawTotal: Math.PI * 2, spin: false,
    });
  }
}

function runToolkitQa(prefix) {
  if (!existsSync(join(TOOLKIT, 'qa-suite.py'))) {
    console.warn(`[qa] toolkit not found at ${TOOLKIT} — skip`);
    return;
  }
  const REFS = continuumRefs();
  const jobs = [
    [`${prefix}-0.8-day`, 'stills', 'native_grid,histogram_hdr'],
    [`${prefix}-0.8-night`, 'stills', 'native_grid,histogram_hdr'],
    [prefix === 'continuum' ? `${prefix}-0.3-coast` : `${prefix}-0.3-surface`, 'stills', 'native_grid,histogram_hdr'],
    [`${prefix}-0.6-clouds`, 'stills', 'native_grid,histogram_hdr'],
  ];
  for (const [id, kind, only] of jobs) {
    const out = join(REFS, 'qa', id);
    mkdirSync(out, { recursive: true });
    const cmd = ['python3', 'qa-suite.py', '--config', 'configs/legion.yaml', '--output', out, '--only', only];
    if (kind === 'stills') {
      const img = join(REFS, 'stills', `${id}.png`);
      if (!existsSync(img)) continue;
      cmd.push('--image', img, '--labeled-native');
    }
    console.log(`[qa] ${id}`);
    const r = spawnSync(cmd[0], cmd.slice(1), { cwd: TOOLKIT, stdio: 'inherit' });
    if (r.status !== 0) console.warn(`[qa] ${id} exited ${r.status}`);
  }
}

async function main() {
  if (MODE === 'demo') {
    for (const id of DEMO_LIST) {
      if (!DEMO_IDS.includes(id)) {
        console.warn(`[accept] unknown demo "${id}" — known: ${DEMO_IDS.join(', ')}`);
      }
    }
  } else if (!TYPES.length) {
    console.error('[accept] need --type <archetype|all> or --demo <id[,id…]>');
    process.exit(1);
  }

  const { chromium } = await loadPlaywright();
  const launchOpts = {
    headless: HEADLESS,
    args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
  };
  let browser;
  try {
    browser = await chromium.launch({ ...launchOpts, channel: 'chrome' });
    console.log('[accept] using system Chrome channel');
  } catch (err) {
    console.warn(`[accept] system Chrome unavailable (${err.message}); falling back to Playwright Chromium`);
    browser = await chromium.launch(launchOpts);
  }
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

  try {
    if (MODE === 'demo') {
      for (const id of DEMO_LIST) {
        if (!DEMO_IDS.includes(id)) continue;
        if (ONLY.has('stills')) await captureDemoStill(page, id);
      }
    } else {
      for (const type of TYPES) {
        await runPlanetType(page, type);
        if (!SKIP_QA && ONLY.has('stills')) runToolkitQa(stillPrefix(type));
      }
    }
  } finally {
    await browser.close();
  }

  console.log('\nDone. Planet artifacts: refs/continuum/ · Demo artifacts: refs/demos/<id>/');
  console.log('Star/blackhole/nebula *labs* are not built yet (ui/labs.ts available:false); demos cover those subsystems today.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
