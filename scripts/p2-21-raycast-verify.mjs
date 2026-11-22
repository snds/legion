#!/usr/bin/env node
/**
 * P2-21 — real-boot (NOT Lab) raycast/tooltip/selection verification for a
 * Continuum-routed body. One-off evidence script for this task, same
 * precedent as scripts/moon-route-capture.mjs (P2-18): real game boot via
 * the DEV-only `?system=<sol|ee>&focusBody=<name>&focusZoom=<n>` hook, then
 * simulate a mousemove (hover → tooltip) and a click (select → inspector
 * panel) at the tracked body's screen position and dump what actually
 * rendered — not a code-review guess.
 *
 *   node scripts/p2-21-raycast-verify.mjs --system sol --body Mercury --zoom 0.03
 *   node scripts/p2-21-raycast-verify.mjs --system sol --body Io --zoom 0.03
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

const BASE = String(flag('base', 'http://localhost:5174')).replace(/\/$/, '');
const SYSTEM = String(flag('system', 'sol'));
const BODY = flag('body', null);
const ZOOM = String(flag('zoom', '0.03'));
const SETTLE_TIMEOUT_MS = Number(flag('settle-timeout', 20000));

if (!BODY) {
  console.error('[p2-21-raycast-verify] usage: --system <sol|ee> --body <Name> [--zoom 0.03]');
  process.exit(1);
}

const OUT_DIR = join(ROOT, 'refs/continuum/qa/p2-21-raycast-verify');
mkdirSync(OUT_DIR, { recursive: true });

async function waitChunkSettle(page, timeoutMs) {
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

/** Sol now boots with 9+ simultaneous continuum globes (all planets + several
 *  moons) — camera trackObject()'s zoom-lerp to a specific body's ORBIT tier
 *  takes real wall-clock time on top of chunk streaming, and the single
 *  chunk-pool HUD (this task's item 2) can't be trusted as a settle signal
 *  in a multi-body scene. Poll the ACTUAL raycast-selected body at
 *  canvas-center (click → inspector panel title, which renderInspector
 *  fills from `d.commonName || d.callsign || d.name` UNCONDITIONALLY, before
 *  any per-type branch — so it works for planets, moons, and stars alike)
 *  until it reports the body we asked to track, instead of guessing a fixed
 *  wait. */
async function clickAndReadTitle(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const el = document.getElementById('inspector-card');
    return el?.querySelector('.panel-title')?.textContent ?? null;
  });
}

/** trackObject()'s camera framing doesn't always land the body dead-center
 *  (moon/planet parallax, in-flight easing at capture time) — scan a small
 *  grid around canvas-center and click each point, reading the inspector
 *  panel title (which `renderInspector` fills from
 *  `d.commonName || d.callsign || d.name` UNCONDITIONALLY, before any
 *  per-type branch, so it works for planets, moons, and stars alike) until
 *  one lands on the body we asked to track. Retried across `roundsMs` of
 *  real wall-clock time so a still-in-flight camera gets a chance to settle. */
async function waitForBodyUnderCursor(page, cx, cy, bodyName, timeoutMs) {
  const start = Date.now();
  let lastTitle = null;
  const offsets = [
    [0, 0], [-120, 0], [120, 0], [0, -80], [0, 80],
    [-200, -60], [200, -60], [-200, 60], [200, 60],
    [-60, -140], [60, -140], [-60, 140], [60, 140],
  ];
  while (Date.now() - start < timeoutMs) {
    for (const [dx, dy] of offsets) {
      const title = await clickAndReadTitle(page, cx + dx, cy + dy);
      lastTitle = title;
      // Title textContent is "<icon-glyph><name>" (renderInspector
      // concatenates the icon span + displayName with no separator).
      if (title && title.includes(bodyName)) return { ok: true, lastTitle, offset: [dx, dy] };
    }
    await page.waitForTimeout(1500);
  }
  return { ok: false, lastTitle };
}

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

async function main() {
  const { chromium } = await import('playwright');
  const launchOpts = {
    headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
  };
  let browser;
  try {
    browser = await chromium.launch({ ...launchOpts, channel: 'chrome' });
    console.log('[p2-21-raycast-verify] using system Chrome channel');
  } catch (err) {
    console.warn(`[p2-21-raycast-verify] system Chrome unavailable (${err.message}); falling back to Playwright Chromium`);
    browser = await chromium.launch(launchOpts);
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[page console error]', msg.text());
  });

  try {
    const url = `${BASE}/?system=${SYSTEM}&focusBody=${encodeURIComponent(BODY)}&focusZoom=${ZOOM}`;
    console.log(`[p2-21-raycast-verify] navigating to ${url}`);
    await page.goto(url, { waitUntil: 'load' });

    await page.waitForFunction(() => typeof window.__legionFocusBody === 'function', null, { timeout: 30000 });

    // Re-invoke explicitly (belt-and-suspenders with the ?focusBody= URL
    // hook — Sol boots with 9+ simultaneous continuum globes now, so give
    // the camera a fresh, unambiguous track call right before we wait).
    const focusOk = await page.evaluate(({ body, zoom }) => window.__legionFocusBody(body, Number(zoom)), { body: BODY, zoom: ZOOM });
    console.log(`[p2-21-raycast-verify] __legionFocusBody("${BODY}") →`, focusOk);

    // Pause sim time ('p' — input.ts) so orbital motion doesn't move the
    // tracked body out from under a fixed screen coordinate while the
    // camera's own (real-time, tc-independent) zoom-lerp is still settling —
    // otherwise "where on screen is BODY" is a moving target across the
    // whole poll window below.
    await page.keyboard.press('p');

    console.log(`[p2-21-raycast-verify] waiting for chunk-pool cover to settle (timeout ${SETTLE_TIMEOUT_MS}ms)...`);
    const settleText = await waitChunkSettle(page, SETTLE_TIMEOUT_MS);
    console.log('[p2-21-raycast-verify] settle status:', settleText);

    const canvas = await page.$('canvas');
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Camera zoom-lerp to the tracked body's ORBIT tier needs real
    // wall-clock time beyond chunk streaming, independently confirmed here
    // (not guessed) by polling the actual raycast-selected body at
    // canvas-center until it matches what we asked to track.
    const lockOn = await waitForBodyUnderCursor(page, cx, cy, BODY, 60000);
    console.log(`[p2-21-raycast-verify] camera lock-on poll for "${BODY}":`, JSON.stringify(lockOn));
    if (!lockOn.ok) {
      console.warn(`[p2-21-raycast-verify] WARNING: never saw "${BODY}" under the cursor within timeout — proceeding with last-seen state (${lockOn.lastTitle}) for evidence anyway.`);
    }
    const [hx, hy] = lockOn.ok ? [cx + lockOn.offset[0], cy + lockOn.offset[1]] : [cx, cy];
    await page.waitForTimeout(500);

    // ── Hover → tooltip ──
    await page.mouse.move(hx, hy);
    await page.waitForTimeout(300);
    // Nudge to force a mousemove event (Playwright's first .move() to a
    // point can be a no-op if the cursor started exactly there).
    await page.mouse.move(hx + 1, hy + 1);
    await page.waitForTimeout(300);

    const tooltipState = await page.evaluate(() => {
      const el = document.getElementById('hover-tip');
      return {
        visible: !!el && el.classList.contains('visible'),
        html: el ? el.innerHTML : null,
      };
    });
    console.log('[p2-21-raycast-verify] tooltip state:', JSON.stringify(tooltipState, null, 2));

    const hoverPngPath = join(OUT_DIR, `${SYSTEM}-${BODY}-hover.png`);
    await page.screenshot({ path: hoverPngPath, fullPage: false });
    console.log(`[p2-21-raycast-verify] wrote ${hoverPngPath}`);

    // ── Click → select ──
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);

    const selectionState = await page.evaluate(() => {
      const insp = document.getElementById('inspector-card');
      const icon = insp?.querySelector('.sel-icon-shape')?.textContent ?? null;
      const title = insp?.querySelector('.panel-title')?.textContent ?? null;
      const subtitle = insp?.querySelector('.panel-subtitle')?.textContent ?? null;
      return {
        open: !!insp && insp.classList.contains('open'),
        icon,
        title,
        subtitle,
        html: insp ? insp.innerHTML : null,
        selectedDataType: window.__legionSelectedType ?? null,
      };
    });
    console.log('[p2-21-raycast-verify] selection state:', JSON.stringify(selectionState, null, 2));

    const selectPngPath = join(OUT_DIR, `${SYSTEM}-${BODY}-select.png`);
    await page.screenshot({ path: selectPngPath, fullPage: false });
    console.log(`[p2-21-raycast-verify] wrote ${selectPngPath}`);

    const reportPath = join(OUT_DIR, `${SYSTEM}-${BODY}.json`);
    writeFileSync(reportPath, JSON.stringify({ system: SYSTEM, body: BODY, settleText, lockOn, tooltipState, selectionState }, null, 2));
    console.log(`[p2-21-raycast-verify] wrote ${reportPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
