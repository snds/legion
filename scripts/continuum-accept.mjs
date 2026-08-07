#!/usr/bin/env node
/**
 * Automate Continuum Task 6/8 captures in native Chrome (Playwright).
 *
 * Usage:
 *   npm run accept:continuum -- --base http://127.0.0.1:5174
 *   npm run accept:continuum -- --only stills,perf
 *   npm run accept:continuum -- --only motion --skip-qa
 *
 * Requires: Vite lab running, `npx playwright` available.
 * Browser: prefers the system Chrome channel (`channel: 'chrome'`) for capture
 * fidelity closest to what a human reviewer sees; falls back to the Playwright
 * -managed Chromium (`npx playwright install chrome` not required in that case)
 * when system Chrome isn't installed — see `main()` below. Either way a
 * `[accept] using system Chrome channel` / `[accept] system Chrome unavailable`
 * line is logged so you know which one ran.
 * Writes under refs/continuum/{stills,motion,perf}/ then optionally runs toolkit QA.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REFS = join(ROOT, 'refs', 'continuum');
const TOOLKIT = resolve(ROOT, '../Workspace/03-skills/render-qa-toolkit');

const args = process.argv.slice(2);
function flag(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) return true;
  return v;
}
const BASE = String(flag('base', 'http://127.0.0.1:5174')).replace(/\/$/, '');
const ONLY = new Set(String(flag('only', 'stills,motion,perf')).split(',').map((s) => s.trim()).filter(Boolean));
const SKIP_QA = Boolean(flag('skip-qa', false));
const HEADLESS = flag('headless', 'false') !== 'false';
const SETTLE_MS = Number(flag('settle-ms', 5000));
const MOTION_FPS = Number(flag('motion-fps', 12));

function ensureDirs() {
  for (const p of [
    join(REFS, 'stills'),
    join(REFS, 'perf'),
    join(REFS, 'qa'),
    join(REFS, 'motion', 'approach-surface'),
    join(REFS, 'motion', 'orbit-0.8au'),
    join(REFS, 'motion', 'look-orient'),
  ]) mkdirSync(p, { recursive: true });
}

function writeDataUrlPng(dataUrl, outPath) {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error(`bad png data url for ${outPath}`);
  writeFileSync(outPath, Buffer.from(m[1], 'base64'));
}

/** Full-page PNG cropped to the WebGL canvas box (avoids black toDataURL). */
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
    console.error('Playwright not installed. Run: npm i -D playwright && npx playwright install chrome');
    process.exit(1);
  }
}

async function waitAccept(page, timeout = 60000) {
  await page.waitForFunction(() => {
    const a = window.__continuumAccept;
    return !!(a && a.ready());
  }, null, { timeout });
}

/**
 * Hide lab chrome so screenshots/motion frames are planet-only (never touch
 * canvas ancestors). F9: the old version had two leaks —
 *   1. `body > div` missed chrome mounted as `<button>` (the "🚩 Planet Lab"
 *      switcher `#demo-menu-btn`, the `.gen-lab-toggle` flyout button).
 *   2. The `right > 40px` skip was meant to spare "not a right-dock panel"
 *      elements, but `#hud`'s CSS reads `right: var(--lab-dock-w, 0px)` —
 *      with the generator-lab panel docked open (the normal accept state)
 *      that's 200-340px, so the game HUD/dock/top-bar was NEVER hidden.
 * Fixed by dropping the position-guess heuristic: on these lab-only accept
 * routes, ANY fixed/absolute element parented to <body> that doesn't touch
 * the canvas is chrome by definition, so it's unconditionally hidden. Known
 * ids/classes stay as an explicit belt-and-suspenders list in case a future
 * chrome root isn't fixed/absolute (e.g. static-flow markup).
 */
async function hideLabChrome(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const hide = (el) => {
      if (!el || !(el instanceof HTMLElement)) return;
      if (canvas && (el === canvas || el.contains(canvas) || canvas.contains(el))) return;
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    };
    // Explicit known chrome: game HUD (top bar/docks/notif stack/pause overlay
    // all nest inside #hud), continuum chunk HUD, F3 debug/FPS overlay, the
    // Planet Lab switcher button + its menu + demo caption, dest-mode crosshair.
    [
      'hud', 'continuum-chunk-hud', 'debug-overlay',
      'demo-menu-btn', 'demo-menu', 'demo-caption', 'dest-mode-indicator',
    ].forEach((id) => hide(document.getElementById(id)));
    // Generator-lab dock panel (mountControlPanel): panel body, collapsed
    // re-open tab, and flyout toggle button (all `.gen-lab-*`, not `div`-only).
    document.querySelectorAll('.gen-lab-panel, .gen-lab-tab, .gen-lab-toggle, [class*="lab-dock"]')
      .forEach(hide);
    // Safety net for anything not caught above: every fixed/absolute element
    // parented directly to <body> — no exemption by edge distance, since that
    // heuristic is what caused the #hud leak above.
    document.querySelectorAll('body > *').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'absolute') return;
      hide(el);
    });
  });
}

async function poseSun(page, mode) {
  // poseSun moves the world-space sun direction to match the CURRENT camera
  // view (see accept-api.ts). A prior version sampled 36 planet yaws and
  // scored sunFacing() per step, but yaw only rotates the surface mesh — the
  // camera and sun stay fixed in world space, so sun·viewDir never changed
  // across samples and the search always landed on the same (wrong) pose.
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

async function captureStill(page, { id, au, pose, clouds = true, idleMs = SETTLE_MS }, attempt = 0) {
  const url = `${BASE}/?lab=planet&engine=continuum&accept=1&au=${au}&w=1920&h=1080&dpr=1`;
  console.log(`[still] ${id} → ${url}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await waitAccept(page);
    await waitMs(page, 500); // let Vite HMR settle after navigation
    await waitAccept(page);
    await page.evaluate(({ au, clouds }) => {
      const api = window.__continuumAccept;
      api.setClouds(clouds);
      api.setSpin(false);
      api.setAu(au);
    }, { au, clouds });
    if (pose) await poseSun(page, pose);
    // Coast: extra yaw search not available without albedo; nudge for variety then settle.
    if (id.includes('coast')) {
      await page.evaluate(() => window.__continuumAccept.nudgeYaw(0.7));
    }
    const hud = await page.evaluate(async (idleMs) => {
      return window.__continuumAccept.waitSettled(45000, idleMs);
    }, idleMs);
    console.log(`[still] ${id} settled medianTex=${hud.medianTex} coverAgeMs=${hud.coverAgeMs}`);
    await hideLabChrome(page);
    await waitMs(page, 100);
    // Two frames so composer presents before screenshot.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const out = join(REFS, 'stills', `${id}.png`);
    await captureCanvasPng(page, out);
    console.log(`[still] wrote ${out}`);
  } catch (err) {
    if (attempt < 2 && /Execution context was destroyed|Target closed|navigation/i.test(String(err))) {
      console.warn(`[still] ${id} retry after ${err.message?.split('\n')[0] || err}`);
      await captureStill(page, { id, au, pose, clouds, idleMs }, attempt + 1);
      return;
    }
    throw err;
  }
}

async function capturePerf(page, au, outName) {
  const url = `${BASE}/?lab=planet&engine=continuum&accept=1&perfcapture&au=${au}&w=1280&h=720&dpr=2&warmup=90&samples=120`;
  console.log(`[perf] ${outName} → ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitAccept(page);
  const json = await page.evaluate(async () => window.__continuumAccept.waitPerfCapture(180000));
  const out = join(REFS, 'perf', outName);
  writeFileSync(out, JSON.stringify(json, null, 2));
  const worst = (json.rows || []).find((r) => r.phase === 'worst');
  console.log(`[perf] wrote ${out} worst.gpuMedianMs=${worst?.gpuMedianMs}`);
}

async function captureMotionFrames(page, {
  id, startAu, endAu = null, durationSec, yawTotal = 0, spin = false,
}) {
  const url = `${BASE}/?lab=planet&engine=continuum&accept=1&au=${startAu}&w=1920&h=1080&dpr=1`;
  const outDir = join(REFS, 'motion', id);
  mkdirSync(outDir, { recursive: true });
  console.log(`[motion] ${id} ${durationSec}s → ${outDir}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitAccept(page);
  await page.evaluate(({ startAu, spin }) => {
    const api = window.__continuumAccept;
    api.setClouds(true);
    api.setSpin(spin);
    api.setAu(startAu);
  }, { startAu, spin });
  await page.evaluate(async () => {
    await window.__continuumAccept.waitSettled(30000, 1500);
  });
  // F9: motion frames leaked lab chrome (HUD/dock/Planet Lab switcher) because
  // this capture never hid it — only captureStill did. Hide once before the
  // frame loop; same settle as stills (100ms + two rAFs) so the first frame
  // isn't captured mid-transition from chrome visible → hidden.
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

function runToolkitQa() {
  if (!existsSync(join(TOOLKIT, 'qa-suite.py'))) {
    console.warn(`[qa] toolkit not found at ${TOOLKIT} — skip`);
    return;
  }
  const jobs = [
    ['continuum-0.8-day', 'stills', 'native_grid,histogram_hdr'],
    ['continuum-0.8-night', 'stills', 'native_grid,histogram_hdr'],
    ['continuum-0.3-coast', 'stills', 'native_grid,histogram_hdr'],
    ['continuum-0.6-clouds', 'stills', 'native_grid,histogram_hdr'],
    ['lab-continuum-0.8au', 'perf', 'frame_budget,pass_attribution'],
    ['lab-continuum-0.3au', 'perf', 'frame_budget,pass_attribution'],
    ['approach-surface', 'frames', 'temporal_delta,motion_stress'],
    ['orbit-0.8au', 'frames', 'temporal_delta,motion_stress'],
    ['look-orient', 'frames', 'temporal_delta,motion_stress'],
  ];
  for (const [id, kind, only] of jobs) {
    const out = join(REFS, 'qa', id);
    mkdirSync(out, { recursive: true });
    const cmd = ['python3', 'qa-suite.py', '--config', 'configs/legion.yaml', '--output', out, '--only', only];
    if (kind === 'stills') {
      const img = join(REFS, 'stills', `${id}.png`);
      if (!existsSync(img)) continue;
      cmd.push('--image', img, '--labeled-native');
    } else if (kind === 'perf') {
      const perf = join(REFS, 'perf', `${id}.json`);
      if (!existsSync(perf)) continue;
      cmd.push('--perf', perf);
    } else {
      const frames = join(REFS, 'motion', id);
      if (!existsSync(frames)) continue;
      cmd.push('--frames', frames);
    }
    console.log(`[qa] ${id}`);
    const r = spawnSync(cmd[0], cmd.slice(1), { cwd: TOOLKIT, stdio: 'inherit' });
    if (r.status !== 0) console.warn(`[qa] ${id} exited ${r.status}`);
  }
}

async function main() {
  ensureDirs();
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
    if (ONLY.has('stills')) {
      await captureStill(page, { id: 'continuum-0.8-day', au: 0.8, pose: 'day' });
      await captureStill(page, { id: 'continuum-0.8-night', au: 0.8, pose: 'night' });
      await captureStill(page, { id: 'continuum-0.3-coast', au: 0.3, pose: 'day', idleMs: SETTLE_MS });
      await captureStill(page, { id: 'continuum-0.6-clouds', au: 0.6, pose: 'terminator', clouds: true });
    }
    if (ONLY.has('perf')) {
      await capturePerf(page, 0.8, 'lab-continuum-0.8au.json');
      await capturePerf(page, 0.3, 'lab-continuum-0.3au.json');
    }
    if (ONLY.has('motion')) {
      await captureMotionFrames(page, {
        id: 'approach-surface', startAu: 0.8, endAu: 0.2, durationSec: 10, spin: false,
      });
      await captureMotionFrames(page, {
        id: 'orbit-0.8au', startAu: 0.8, durationSec: 12, yawTotal: Math.PI * 2, spin: false,
      });
      await captureMotionFrames(page, {
        id: 'look-orient', startAu: 0.35, durationSec: 8, yawTotal: Math.PI * 2, spin: false,
      });
    }
  } finally {
    await browser.close();
  }

  if (!SKIP_QA) runToolkitQa();
  console.log('\nDone. Artifacts under refs/continuum/. Human scorecard vs se-planet still required for NORTHSTAR sign-off.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
