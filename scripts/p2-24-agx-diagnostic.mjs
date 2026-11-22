#!/usr/bin/env node
/**
 * P2-24 — measures the post/exposure chain's (AgX tonemap + auto-exposure +
 * bloom) real pixel-level contribution to a body's on-screen contrast and
 * saturation, at a real-boot (non-Lab) pose, with the contributions of
 * "exposure gain," "bloom/vignette/grade," and "AgX's own curve shape"
 * separated out (a naive raw-vs-final diff confounds all three — exposure
 * gain alone dominates a naive comparison and looks nothing like the AgX
 * curve's actual cost; see the summary note in this file's git history for
 * why the first version of this script was wrong).
 *
 * Reads window.__p24 (temp dev-only expose in main.ts: renderer/scene/
 * camera/postCtx) and drives it through four conditions, ALL using the full
 * EffectComposer chain (bloom/vignette/color-grade included identically in
 * every condition) except for OutputPass's tonemap operator + whether
 * exposure gain is applied — isolating exactly what the task asks about:
 *
 *   1. trueRaw    — composer entirely bypassed: direct renderer.render(scene,
 *                   camera), NoToneMapping. Literal unexposed material/albedo,
 *                   pre-bloom, pre-anything. The task's literal "raw material".
 *   2. postNoAgx  — FULL composite chain (bloom/vignette/grade run normally),
 *                   OutputPass toneMapping=NoToneMapping (no exposure gain,
 *                   no AgX curve — colorspace-only passthrough). Isolates
 *                   bloom/vignette/grade's own contribution vs trueRaw.
 *   3. postLinear — same full chain, OutputPass toneMapping=LinearToneMapping
 *                   at the SAME frozen exposure the AgX condition uses.
 *                   Isolates exposure-gain's own contribution vs postNoAgx.
 *   4. postAgx    — same full chain, OutputPass toneMapping=AgXToneMapping,
 *                   same frozen exposure. Isolates AgX's curve/desaturation
 *                   shape specifically vs postLinear (exposure held constant,
 *                   only the tonemap operator differs).
 *
 * auto-exposure is frozen (autoExposurePass.enabled=false) for the duration
 * of conditions 2-4 so all three share the exact same metered exposure value
 * — otherwise the live adaptation loop would confound the comparison.
 * Restored to enabled afterward. No src/ files are modified by this script.
 *
 *   node scripts/p2-24-agx-diagnostic.mjs --body Earth --zoom 0.09
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

const BASE = String(flag('base', 'http://localhost:5220')).replace(/\/$/, '');
const SYSTEM = String(flag('system', 'sol'));
const BODY = flag('body', null);
const ZOOM = String(flag('zoom', '0.09'));
const SETTLE_TIMEOUT_MS = Number(flag('settle-timeout', 20000));
const EXPOSURE_SETTLE_MS = Number(flag('exposure-settle', 4000));

if (!BODY) {
  console.error('[p2-24-agx-diagnostic] usage: --body <Name> [--system sol] [--zoom 0.09] [--base http://localhost:5220]');
  process.exit(1);
}

const OUT_DIR = join(ROOT, 'refs/continuum/qa/p2-24-agx', BODY.toLowerCase());
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

// Runs synchronously in-page. At this pose (?focusBody=&focusZoom=0.09, the
// same "orbit tier" framing P2-23's capture script used), the tracked body
// is screen-centered but only ~170px across in a 1280x720 frame — the wider
// scene (nebula dust band, asteroid belt, starfield) fills most of the
// canvas and is NOT near-black (confirmed visually: a naive 70%-of-canvas
// box + lum<8 filter kept ~50k/50k sampled points, i.e. it was measuring
// scene composition, not the disc). A small crop fixed on canvas center
// isolates the disc + its atmosphere rim while cropping out the dust band.
function sampleCanvasStats() {
  const canvas = document.querySelector('canvas');
  const off = document.createElement('canvas');
  off.width = canvas.width;
  off.height = canvas.height;
  const octx = off.getContext('2d');
  octx.drawImage(canvas, 0, 0);
  const CROP = 240; // px, centered — covers the ~170px disc + atmosphere/ring margin
  const bx0 = Math.max(0, Math.round(off.width / 2 - CROP / 2));
  const by0 = Math.max(0, Math.round(off.height / 2 - CROP / 2));
  const bw = Math.min(CROP, off.width - bx0);
  const bh = Math.min(CROP, off.height - by0);
  const { data } = octx.getImageData(bx0, by0, bw, bh);
  const STEP = 1;
  const pts = [];
  for (let y = 0; y < bh; y += STEP) {
    for (let x = 0; x < bw; x += STEP) {
      const i = (y * bw + x) * 4;
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum < 15) continue; // exclude residual dust/starfield sliver within the crop
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx > 0 ? (mx - mn) / mx : 0;
      pts.push({ lum, sat });
    }
  }
  pts.sort((a, b) => a.lum - b.lum);
  const n = pts.length;
  if (n < 10) return { n, error: 'too few on-disc pixels sampled' };
  const decile = Math.max(1, Math.floor(n * 0.1));
  const darkPts = pts.slice(0, decile);
  const brightPts = pts.slice(n - decile);
  const avg = (arr, key) => arr.reduce((a, p) => a + p[key], 0) / arr.length;
  return {
    n,
    darkLumAvg: avg(darkPts, 'lum'),
    brightLumAvg: avg(brightPts, 'lum'),
    contrast: avg(brightPts, 'lum') - avg(darkPts, 'lum'),
    darkSatAvg: avg(darkPts, 'sat'),
    brightSatAvg: avg(brightPts, 'sat'),
    overallSatAvg: avg(pts, 'sat'),
  };
}

// All in-page functions below run synchronously (no `await` inside) so no
// intervening requestAnimationFrame can stomp the buffer between a render()
// call and reading its pixels back.
function sampleTrueRaw() {
  const ctx = window.__p24;
  if (!ctx) return { error: 'window.__p24 missing — was the temp diagnostic expose reverted?' };
  const { renderer, scene, camera } = ctx;
  const prevToneMapping = renderer.toneMapping;
  const prevTarget = renderer.getRenderTarget();
  try {
    renderer.toneMapping = 0; // NoToneMapping
    renderer.setRenderTarget(null);
    renderer.autoClear = true;
    renderer.render(scene, camera);
    return sampleCanvasStats();
  } finally {
    renderer.toneMapping = prevToneMapping;
    renderer.setRenderTarget(prevTarget);
  }
}

function freezeExposureAndSample() {
  const ctx = window.__p24;
  if (!ctx) return { error: 'window.__p24 missing' };
  const { renderer, postCtx } = ctx;
  const frozenExposure = renderer.toneMappingExposure;
  postCtx.autoExposurePass.enabled = false; // stop live adaptation for the A/B window
  return { frozenExposure };
}

function renderWithToneMappingAndSample(toneMappingValue) {
  const ctx = window.__p24;
  if (!ctx) return { error: 'window.__p24 missing' };
  const { renderer, postCtx } = ctx;
  const prevToneMapping = renderer.toneMapping;
  try {
    renderer.toneMapping = toneMappingValue;
    postCtx.render();
    return sampleCanvasStats();
  } finally {
    renderer.toneMapping = prevToneMapping;
  }
}

function unfreezeExposure() {
  const ctx = window.__p24;
  if (!ctx) return { error: 'window.__p24 missing' };
  ctx.postCtx.autoExposurePass.enabled = true;
  ctx.renderer.toneMapping = 6; // AgXToneMapping — restore normal display
  ctx.postCtx.render();
  return { ok: true };
}

async function evalFn(page, fn, ...args) {
  return page.evaluate(([sampleSrc, src, a]) => {
    // eslint-disable-next-line no-eval
    (0, eval)(`window.sampleCanvasStats = ${sampleSrc};`);
    // eslint-disable-next-line no-eval
    const f = (0, eval)(`(${src})`);
    return f(...a);
  }, [sampleCanvasStats.toString(), fn.toString(), args]);
}

async function main() {
  const { chromium } = await import('playwright');
  const launchOpts = { headless: true, args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'] };
  let browser;
  try {
    browser = await chromium.launch({ ...launchOpts, channel: 'chrome' });
    console.log('[p2-24-agx-diagnostic] using system Chrome channel');
  } catch (err) {
    console.warn(`[p2-24-agx-diagnostic] system Chrome unavailable (${err.message}); falling back to Playwright Chromium`);
    browser = await chromium.launch(launchOpts);
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[page console error]', msg.text());
  });

  try {
    const url = `${BASE}/?accept=1&system=${SYSTEM}&focusBody=${encodeURIComponent(BODY)}&focusZoom=${ZOOM}`;
    console.log(`[p2-24-agx-diagnostic] navigating to ${url}`);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__legionFocusBody === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => typeof window.__p24 !== 'undefined', null, { timeout: 30000 });
    await page.addStyleTag({ content: HIDE_CHROME_CSS });

    for (let i = 0; i < 16; i++) {
      await page.evaluate(([name, zoom]) => window.__legionFocusBody(name, Number(zoom)), [BODY, ZOOM]);
      await page.waitForTimeout(500);
    }

    console.log(`[p2-24-agx-diagnostic] waiting for chunk-pool cover to settle (timeout ${SETTLE_TIMEOUT_MS}ms)...`);
    const settleText = await waitChunkSettle(page, SETTLE_TIMEOUT_MS);
    console.log('[p2-24-agx-diagnostic] settle status:', settleText);

    const trackedName = await page.evaluate(() => window.__cam?.trackedObject?.userData?.name ?? null);
    let confirmed = trackedName === BODY;
    console.log(`[p2-24-agx-diagnostic] identity check: expected "${BODY}" — camera tracks "${trackedName}" — confirmed=${confirmed}`);
    for (let attempt = 0; attempt < 10 && !confirmed; attempt++) {
      await page.evaluate(([name, zoom]) => window.__legionFocusBody(name, Number(zoom)), [BODY, ZOOM]);
      await waitChunkSettle(page, SETTLE_TIMEOUT_MS);
      await page.waitForTimeout(500);
      const retryName = await page.evaluate(() => window.__cam?.trackedObject?.userData?.name ?? null);
      console.log(`[p2-24-agx-diagnostic] retry #${attempt} identity check: camera tracks "${retryName}"`);
      confirmed = retryName === BODY;
    }
    if (!confirmed) {
      throw new Error(`identity NOT confirmed for "${BODY}" after retries`);
    }

    console.log(`[p2-24-agx-diagnostic] waiting ${EXPOSURE_SETTLE_MS}ms for auto-exposure adaptation to stabilize...`);
    await page.waitForTimeout(EXPOSURE_SETTLE_MS);

    // 1. trueRaw — composer entirely bypassed.
    const trueRaw = await evalFn(page, sampleTrueRaw);
    console.log('[p2-24-agx-diagnostic] 1. trueRaw:', trueRaw);
    await captureCanvasPng(page, join(OUT_DIR, '1-true-raw.png'));

    // Freeze exposure at its naturally-adapted value for a fair 3-way A/B.
    const { frozenExposure } = await evalFn(page, freezeExposureAndSample);
    console.log('[p2-24-agx-diagnostic] frozen exposure:', frozenExposure);

    // 2. postNoAgx — full chain, no tonemap curve, no exposure gain.
    const postNoAgx = await evalFn(page, renderWithToneMappingAndSample, 0);
    console.log('[p2-24-agx-diagnostic] 2. postNoAgx (bloom/vignette/grade only):', postNoAgx);
    await captureCanvasPng(page, join(OUT_DIR, '2-post-no-agx.png'));

    // 3. postLinear — full chain, linear tonemap, SAME frozen exposure.
    const postLinear = await evalFn(page, renderWithToneMappingAndSample, 1);
    console.log('[p2-24-agx-diagnostic] 3. postLinear (+ exposure gain, no AgX curve):', postLinear);
    await captureCanvasPng(page, join(OUT_DIR, '3-post-linear.png'));

    // 4. postAgx — full chain, AgX tonemap, SAME frozen exposure.
    const postAgx = await evalFn(page, renderWithToneMappingAndSample, 6);
    console.log('[p2-24-agx-diagnostic] 4. postAgx (+ AgX curve, matched exposure):', postAgx);
    await captureCanvasPng(page, join(OUT_DIR, '4-post-agx-matched-exposure.png'));

    await evalFn(page, unfreezeExposure);

    const all = [trueRaw, postNoAgx, postLinear, postAgx];
    const okAll = all.every(s => !s.error);
    const d = (a, b, keys) => Object.fromEntries(keys.map(k => [k, b[k] - a[k]]));
    const KEYS = ['contrast', 'darkLumAvg', 'brightLumAvg', 'overallSatAvg', 'darkSatAvg', 'brightSatAvg'];

    const summary = {
      body: BODY,
      system: SYSTEM,
      zoom: ZOOM,
      frozenExposure,
      trueRaw,
      postNoAgx,
      postLinear,
      postAgx,
      delta: okAll ? {
        bloomVignetteGrade: d(trueRaw, postNoAgx, KEYS),      // trueRaw -> postNoAgx
        exposureGainOnly: d(postNoAgx, postLinear, KEYS),      // postNoAgx -> postLinear
        agxCurveOnly: d(postLinear, postAgx, KEYS),            // postLinear -> postAgx, exposure held constant
        fullChain: d(trueRaw, postAgx, KEYS),                  // trueRaw -> postAgx (task's literal ask)
      } : null,
    };
    console.log('[p2-24-agx-diagnostic] SUMMARY:', JSON.stringify(summary, null, 2));
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
