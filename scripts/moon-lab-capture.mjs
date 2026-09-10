#!/usr/bin/env node
/**
 * P2-17.3 — one-shot visual proof for the synthetic Continuum test moon.
 * Not part of the accept harness (that's tuned for the 6 named planet
 * archetypes) — a small standalone script for this task's own evidence.
 *
 *   node scripts/moon-lab-capture.mjs --base http://localhost:5199
 *
 * Captures two stills of ?lab=planet&engine=continuum&type=rocky&moon=1:
 *   terminator.png — poseSun('terminator'), checks the airless knife-edge
 *   day.png        — poseSun('day'), sanity check the lit face still reads
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const BASE = String(flag('base', 'http://127.0.0.1:5199')).replace(/\/$/, '');
const OUT_DIR = join(ROOT, 'refs/continuum/qa/p2-17-moon-lab');
mkdirSync(OUT_DIR, { recursive: true });

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
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const url = `${BASE}/?lab=planet&engine=continuum&type=rocky&moon=1`;
  console.log(`[moon-lab-capture] navigating to ${url}`);
  await page.goto(url, { waitUntil: 'load' });

  await page.waitForFunction(() => {
    const a = window.__continuumAccept;
    return !!(a && a.ready());
  }, null, { timeout: 60000 });

  await page.evaluate(() => window.__continuumAccept.setLabPropsVisible(false));

  // Hide lab dock/HUD chrome — canvas only.
  await page.addStyleTag({
    content: `
      #hud, #dot-grid, #hover-tip, #dest-mode-indicator,
      #continuum-chunk-hud, #debug-overlay, #paint-hud, #view-scale,
      .gen-lab-panel, .gen-lab-tab, .gen-lab-toggle, [class*="lab-dock"] {
        display: none !important; visibility: hidden !important;
      }
    `,
  });

  console.log('[moon-lab-capture] waiting for chunk-pool cover to settle...');
  const hud = await page.evaluate(() => window.__continuumAccept.waitSettled(30000, 1500));
  console.log('[moon-lab-capture] settled:', JSON.stringify(hud));

  for (const [pose, name] of [['terminator', 'terminator.png'], ['day', 'day.png']]) {
    await page.evaluate((p) => window.__continuumAccept.poseSun(p), pose);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.waitForTimeout(300); // let a few frames settle at the new pose
    const outPath = join(OUT_DIR, name);
    await captureCanvasPng(page, outPath);
    console.log(`[moon-lab-capture] wrote ${outPath}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
