#!/usr/bin/env node
/**
 * P2-23 — real-boot (NOT Lab) still capture for a single catalogue body, with
 * an identity-confirmed camera lock before the screenshot is trusted.
 *
 * P2-22's own final look-QA flagged that `scripts/moon-route-capture.mjs`
 * used bare is unreliable for any body other than Earth: main.ts's
 * unconditional default-homeworld `trackObject(Earth)` call intermittently
 * wins the race against the `?focusBody=` URL hook and silently strands the
 * capture on Earth, with no error signal. This script re-invokes
 * `window.__legionFocusBody(name, zoom)` repeatedly over the page's first
 * few seconds and only captures once the chunk-pool HUD's own body-labelled
 * text (`planet-<Name> — ...`, P2-21's label fix) confirms the tracked body
 * actually matches the requested one.
 *
 *   node scripts/p2-23-mars-capture.mjs --system sol --body Mars --zoom 0.09 --label after-mars
 */
import { mkdirSync } from 'node:fs';
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

const BASE = String(flag('base', 'http://127.0.0.1:5199')).replace(/\/$/, '');
const SYSTEM = String(flag('system', 'sol'));
const BODY = flag('body', null);
const ZOOM = String(flag('zoom', '0.09'));
const LABEL = flag('label', null);
const SETTLE_TIMEOUT_MS = Number(flag('settle-timeout', 20000));

if (!BODY || !LABEL) {
  console.error('[p2-23-mars-capture] usage: --body <Name> --label <slug> [--system sol] [--zoom 0.09]');
  process.exit(1);
}

const OUT_DIR = join(ROOT, 'refs/continuum/qa/p2-23-mars', LABEL);
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

async function main() {
  const { chromium } = await import('playwright');
  const launchOpts = { headless: true, args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'] };
  let browser;
  try {
    browser = await chromium.launch({ ...launchOpts, channel: 'chrome' });
    console.log('[p2-23-mars-capture] using system Chrome channel');
  } catch (err) {
    console.warn(`[p2-23-mars-capture] system Chrome unavailable (${err.message}); falling back to Playwright Chromium`);
    browser = await chromium.launch(launchOpts);
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[page console error]', msg.text());
  });

  try {
    const url = `${BASE}/?system=${SYSTEM}&focusBody=${encodeURIComponent(BODY)}&focusZoom=${ZOOM}`;
    console.log(`[p2-23-mars-capture] navigating to ${url}`);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__legionFocusBody === 'function', null, { timeout: 30000 });
    await page.addStyleTag({ content: HIDE_CHROME_CSS });

    // Identity-confirmed re-invocation (P2-22 lesson): fire the focus hook
    // repeatedly over the page's first several seconds to beat the
    // default-homeworld race (main.ts's unconditional trackObject(Earth)).
    for (let i = 0; i < 16; i++) {
      await page.evaluate(([name, zoom]) => window.__legionFocusBody(name, Number(zoom)), [BODY, ZOOM]);
      await page.waitForTimeout(500);
    }

    console.log(`[p2-23-mars-capture] waiting for chunk-pool cover to settle (timeout ${SETTLE_TIMEOUT_MS}ms)...`);
    const settleText = await waitChunkSettle(page, SETTLE_TIMEOUT_MS);
    console.log('[p2-23-mars-capture] settle status:', settleText);
    await page.waitForTimeout(500);

    // Identity check: read the CAMERA's actual tracked object (window.__cam,
    // main.ts:223) rather than the shared chunk-pool HUD text. The HUD is
    // ONE global DOM element that reflects whichever body's ContinuumGlobe.
    // update() ran LAST that frame (debug-chunks.ts's own documented
    // caveat) — with 2+ simultaneously-revealed bodies (e.g. Earth still
    // visible near the default boot camera position while a non-Earth body
    // is focused) it can stay pinned on the wrong body indefinitely, even
    // though __legionFocusBody() genuinely re-targeted the camera (confirmed
    // via window.__cam.trackedObject.userData.name — 100% reliable, unlike
    // the HUD). This is a capture-tooling fix (P2-22's own documented
    // methodology gap), not a product change.
    const trackedName = await page.evaluate(() => window.__cam?.trackedObject?.userData?.name ?? null);
    let confirmed = trackedName === BODY;
    console.log(`[p2-23-mars-capture] identity check: expected "${BODY}" — camera tracks "${trackedName}" — confirmed=${confirmed}`);
    for (let attempt = 0; attempt < 10 && !confirmed; attempt++) {
      await page.evaluate(([name, zoom]) => window.__legionFocusBody(name, Number(zoom)), [BODY, ZOOM]);
      await waitChunkSettle(page, SETTLE_TIMEOUT_MS);
      await page.waitForTimeout(500);
      const retryName = await page.evaluate(() => window.__cam?.trackedObject?.userData?.name ?? null);
      console.log(`[p2-23-mars-capture] retry #${attempt} identity check: camera tracks "${retryName}"`);
      confirmed = retryName === BODY;
    }
    if (!confirmed) {
      throw new Error(`identity NOT confirmed for "${BODY}" after retries`);
    }

    const staticPath = join(OUT_DIR, 'static.png');
    await captureCanvasPng(page, staticPath);
    console.log(`[p2-23-mars-capture] wrote ${staticPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
