#!/usr/bin/env node
/**
 * P2-18 — real-boot (NOT Lab) visual + perf verification for a routed
 * Continuum moon. Uses the P2-9 dev hooks (main.ts:363-448, DEV-only):
 * `?system=<sol|ee>&focusBody=<name>&focusZoom=<val>` to track a real body
 * on real boot, exactly the tool the task asked for ("actually view
 * real-boot render, not lab"). Not part of the accept harness — a small
 * standalone script for this task's own evidence, same precedent as
 * scripts/moon-lab-capture.mjs (P2-17.3).
 *
 *   node scripts/moon-route-capture.mjs --system sol --body Moon --zoom 0.03 --label sol-moon
 *   node scripts/moon-route-capture.mjs --system sol --body Io --zoom 0.03 --label jupiter-galileans --perf
 *
 * Captures, per run, under refs/continuum/qa/p2-18-moon-boot/<label>/:
 *   static.png            — settled pose, camera tracked, no input yet
 *   orbit.png             — mid-drag orbit pose (camera actively moving)
 *   post-orbit-static.png — camera held still after the drag ends (P2-0's
 *                           "stops and holds still" lesson — distinct pose
 *                           from static.png, reached via a different path)
 *   perf.json (--perf)    — rAF frame-delta sampler: median/p95/worst
 *                           composite ms over --perf-duration. NOT the
 *                           GPU-timer ?perfcapture=composite bracket — that
 *                           flag re-centers the camera on the world origin
 *                           and untracks (main.ts's setBaselineAu), which
 *                           does not apply to a real per-body close
 *                           approach (Jupiter is not at the origin). This is
 *                           a simpler CPU-side rAF-interval measurement of
 *                           the same real composited frame, still judged
 *                           worst-frame-first per BUDGET.md's own doctrine.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) return true;
  return v;
}

const BASE = String(flag('base', 'http://127.0.0.1:5174')).replace(/\/$/, '');
const SYSTEM = String(flag('system', 'sol'));
const BODY = flag('body', null);
const ZOOM = String(flag('zoom', '0.03'));
const LABEL = flag('label', null);
const DO_PERF = !!flag('perf', false);
const PERF_DURATION_MS = Number(flag('perf-duration', 6000));
const ORBIT_DX = Number(flag('orbit-dx', 220));
const ORBIT_DY = Number(flag('orbit-dy', 40));
const SETTLE_TIMEOUT_MS = Number(flag('settle-timeout', 20000));
// With N>1 simultaneously-registered Continuum globes, the chunk HUD (a
// single global DOM element) reflects whichever body's ContinuumGlobe.update()
// ran LAST in that frame's registry iteration — NOT necessarily the tracked/
// focused body (registry.ts iterates a Set in registration order, so in a
// multi-moon system it's always the last-registered sibling, e.g. Callisto,
// regardless of which body focusBody= is tracking). waitChunkSettle() is a
// best-effort signal only; PRE_WAIT_MS is an unconditional floor so a
// multi-body scene still gets real settle time even when the HUD it can see
// never reflects the actually-tracked body (found in P2-18.2 real-boot
// verification — Io took ~75s of real flight time in this sandbox's
// software-rendering fallback before it visibly settled, since Jupiter is
// far from the default boot camera position; the HUD-only wait exited early
// watching Callisto's perpetually-empty stats instead).
const PRE_WAIT_MS = Number(flag('pre-wait', 0));

if (!BODY || !LABEL) {
  console.error('[moon-route-capture] usage: --system <sol|ee> --body <Name> --label <slug> [--zoom 0.03] [--perf]');
  process.exit(1);
}

const OUT_DIR = join(ROOT, 'refs/continuum/qa/p2-18-moon-boot', LABEL);
mkdirSync(OUT_DIR, { recursive: true });

const HIDE_CHROME_CSS = `
  #hud, #dot-grid, #hover-tip, #dest-mode-indicator,
  #continuum-chunk-hud, #debug-overlay, #paint-hud, #view-scale,
  .gen-lab-panel, .gen-lab-tab, .gen-lab-toggle, [class*="lab-dock"] {
    display: none !important; visibility: hidden !important;
  }
`;

async function captureCanvasPng(page, outPath) {
  const box = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.max(1, r.width), height: Math.max(1, r.height) };
  });
  if (!box) throw new Error('no canvas element');
  await page.screenshot({ path: outPath, type: 'png', clip: box });
}

/** Poll the (single, global) chunk HUD text for a settle signal. Best-effort:
 *  with more than one live body (Jupiter batch) the HUD reflects whichever
 *  body's ContinuumGlobe.update() ran last that frame, not necessarily the
 *  focused one — this is a helpful settle heuristic, not a hard guarantee. */
async function waitChunkSettle(page, timeoutMs = 20000) {
  const start = Date.now();
  let lastText = null;
  let stableSince = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await page.evaluate(() => document.getElementById('continuum-chunk-hud')?.textContent ?? null);
    if (text !== lastText) {
      lastText = text;
      stableSince = Date.now();
    } else if (text && text.includes('settled') && Date.now() - stableSince > 800) {
      return text;
    }
    await page.waitForTimeout(250);
  }
  return lastText;
}

async function dragOrbit(page, dx, dy) {
  const canvas = await page.$('canvas');
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 24 });
  await page.mouse.up();
}

function stats(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    n: sorted.length,
    medianMs: +pick(0.5).toFixed(3),
    p95Ms: +pick(0.95).toFixed(3),
    worstMs: +sorted[sorted.length - 1].toFixed(3),
  };
}

async function samplePerf(page, durationMs) {
  const deltas = await page.evaluate((duration) => new Promise((resolve) => {
    const out = [];
    let last = performance.now();
    const start = last;
    function tick(t) {
      out.push(t - last);
      last = t;
      if (t - start < duration) requestAnimationFrame(tick);
      else resolve(out);
    }
    requestAnimationFrame(tick);
  }), durationMs);
  // Drop the first few frames (rAF warm-up / any residual settle jitter).
  return deltas.slice(5);
}

async function loadPlaywright() {
  return import('playwright');
}

async function main() {
  const { chromium } = await loadPlaywright();
  const launchOpts = {
    headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
  };
  let browser;
  try {
    browser = await chromium.launch({ ...launchOpts, channel: 'chrome' });
    console.log('[moon-route-capture] using system Chrome channel');
  } catch (err) {
    console.warn(`[moon-route-capture] system Chrome unavailable (${err.message}); falling back to Playwright Chromium`);
    browser = await chromium.launch(launchOpts);
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[page console error]', msg.text());
  });

  try {
    const url = `${BASE}/?system=${SYSTEM}&focusBody=${encodeURIComponent(BODY)}&focusZoom=${ZOOM}`;
    console.log(`[moon-route-capture] navigating to ${url}`);
    await page.goto(url, { waitUntil: 'load' });

    await page.waitForFunction(() => typeof window.__legionFocusBody === 'function', null, { timeout: 30000 });
    await page.addStyleTag({ content: HIDE_CHROME_CSS });

    if (PRE_WAIT_MS > 0) {
      console.log(`[moon-route-capture] unconditional pre-wait ${PRE_WAIT_MS}ms (multi-body settle floor)...`);
      await page.waitForTimeout(PRE_WAIT_MS);
    }

    console.log(`[moon-route-capture] waiting for chunk-pool cover to settle (timeout ${SETTLE_TIMEOUT_MS}ms)...`);
    const settleText = await waitChunkSettle(page, SETTLE_TIMEOUT_MS);
    console.log('[moon-route-capture] settle status:', settleText);
    await page.waitForTimeout(500);

    const staticPath = join(OUT_DIR, 'static.png');
    await captureCanvasPng(page, staticPath);
    console.log(`[moon-route-capture] wrote ${staticPath}`);

    console.log(`[moon-route-capture] orbiting camera (dx=${ORBIT_DX}, dy=${ORBIT_DY})...`);
    await dragOrbit(page, ORBIT_DX, ORBIT_DY);
    const orbitPath = join(OUT_DIR, 'orbit.png');
    await captureCanvasPng(page, orbitPath);
    console.log(`[moon-route-capture] wrote ${orbitPath}`);

    // P2-0 lesson: also capture a camera that STOPS and holds still (distinct
    // from static.png's pre-orbit pose) — the drag above already ended, so
    // just wait for the held frame to settle again.
    await page.waitForTimeout(2000);
    const postOrbitPath = join(OUT_DIR, 'post-orbit-static.png');
    await captureCanvasPng(page, postOrbitPath);
    console.log(`[moon-route-capture] wrote ${postOrbitPath}`);

    if (DO_PERF) {
      console.log(`[moon-route-capture] sampling composite frame time for ${PERF_DURATION_MS}ms...`);
      const deltas = await samplePerf(page, PERF_DURATION_MS);
      const report = { label: LABEL, body: BODY, system: SYSTEM, durationMs: PERF_DURATION_MS, ...stats(deltas) };
      const perfPath = join(OUT_DIR, 'perf.json');
      writeFileSync(perfPath, JSON.stringify(report, null, 2));
      console.log('[moon-route-capture] perf:', JSON.stringify(report));
      console.log(`[moon-route-capture] wrote ${perfPath}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
