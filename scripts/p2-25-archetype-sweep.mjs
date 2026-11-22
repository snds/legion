#!/usr/bin/env node
/**
 * P2-25 — diagnostic-only archetype sweep for the adversarial visual audit
 * (task "Adversarial diagnostic audit: every planet archetype vs real
 * NASA/ESA/exoplanet references"). Captures one close-orbit still per live
 * catalogue body across both systems, reusing p2-24-agx-diagnostic.mjs's
 * navigation/settle/identity-confirm pattern (focusBody/focusZoom URL nav +
 * window.__legionFocusBody + #continuum-chunk-hud settle polling), post
 * zoom-fix (radius-relative approach/LOD thresholds — body-scale.ts) so one
 * shared focusZoom now frames every body comparably regardless of physical
 * radius. No src/ files are modified by this script.
 *
 *   node scripts/p2-25-archetype-sweep.mjs
 *   node scripts/p2-25-archetype-sweep.mjs --only Earth,Jupiter
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

const BASE = String(flag('base', 'http://localhost:5173')).replace(/\/$/, '');
const ZOOM = String(flag('zoom', '0.05'));
const SETTLE_TIMEOUT_MS = Number(flag('settle-timeout', 20000));
const ONLY = flag('only', null);
const ONLY_SET = ONLY ? new Set(String(ONLY).split(',').map((s) => s.trim())) : null;

const OUT_DIR = join(ROOT, 'refs/continuum/qa/p2-25-archetype-sweep');
mkdirSync(OUT_DIR, { recursive: true });

// (system, name, archetype label for the note — informational only).
const BODIES = [
  ['sol', 'Mercury', 'Rocky-airless (Mercury-class)'],
  ['sol', 'Venus', 'Rocky (thick-atmosphere, not modeled distinctly)'],
  ['sol', 'Earth', 'Oceanic (Earth-class)'],
  ['sol', 'Mars', 'Rocky-thin-atmosphere (Mars-class)'],
  ['sol', 'Jupiter', 'GasGiant (Jupiter-class)'],
  ['sol', 'Saturn', 'GasGiant (Saturn-class)'],
  ['sol', 'Uranus', 'IceGiant'],
  ['sol', 'Neptune', 'IceGiant'],
  ['sol', 'Moon', 'Dwarf-stand-in (hardcoded rocky, real-Luna reference)'],
  ['sol', 'Io', 'Dwarf-stand-in (hardcoded rocky; real body is volcanic)'],
  ['sol', 'Europa', 'Dwarf-stand-in (hardcoded rocky; real body is ice)'],
  ['sol', 'Titan', 'Dwarf-stand-in (hardcoded rocky; real body is hazy-atmosphere)'],
  ['ee', 'Vulcan', 'Rocky-airless (EE)'],
  ['ee', 'Ragnarok', 'Rocky (EE)'],
  ['ee', 'Romulus', 'Oceanic (EE)'],
  ['ee', 'Pax', 'Rocky-thin-atmosphere (EE, Mars-class)'],
  ['ee', 'Jotunheim', 'GasGiant (EE, Jupiter-class)'],
  ['ee', 'Niflheim', 'IceGiant (EE)'],
  ['ee', 'Helheim', 'Dwarf (EE)'],
];

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

async function captureBody(page, system, name, label) {
  const url = `${BASE}/?accept=1&system=${system}&focusBody=${encodeURIComponent(name)}&focusZoom=${ZOOM}`;
  console.log(`[p2-25] ${name} (${label}) → ${url}`);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__legionFocusBody === 'function', null, { timeout: 30000 });
  await page.addStyleTag({ content: HIDE_CHROME_CSS });

  for (let i = 0; i < 16; i++) {
    await page.evaluate(([n, z]) => window.__legionFocusBody(n, Number(z)), [name, ZOOM]);
    await page.waitForTimeout(400);
  }

  await waitChunkSettle(page, SETTLE_TIMEOUT_MS);

  const trackedName = await page.evaluate(() => window.__cam?.trackedObject?.userData?.name ?? null);
  let confirmed = trackedName === name;
  for (let attempt = 0; attempt < 8 && !confirmed; attempt++) {
    await page.evaluate(([n, z]) => window.__legionFocusBody(n, Number(z)), [name, ZOOM]);
    await waitChunkSettle(page, SETTLE_TIMEOUT_MS);
    await page.waitForTimeout(400);
    const retryName = await page.evaluate(() => window.__cam?.trackedObject?.userData?.name ?? null);
    confirmed = retryName === name;
  }
  if (!confirmed) {
    console.warn(`[p2-25] ${name}: identity NOT confirmed after retries — capturing anyway, flag in note`);
  }

  await page.waitForTimeout(1500); // extra settle for exposure/cloud animation
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const out = join(OUT_DIR, `${system}-${name.toLowerCase()}.png`);
  await captureCanvasPng(page, out);
  console.log(`[p2-25] wrote ${out} (identity confirmed=${confirmed})`);
  return { system, name, label, confirmed, file: out };
}

async function main() {
  const { chromium } = await import('playwright');
  const launchOpts = { headless: true, args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'] };
  let browser;
  try {
    browser = await chromium.launch({ ...launchOpts, channel: 'chrome' });
  } catch {
    browser = await chromium.launch(launchOpts);
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('console', (msg) => { if (msg.type() === 'error') console.log('[page console error]', msg.text()); });

  const results = [];
  try {
    for (const [system, name, label] of BODIES) {
      if (ONLY_SET && !ONLY_SET.has(name)) continue;
      try {
        results.push(await captureBody(page, system, name, label));
      } catch (err) {
        console.error(`[p2-25] ${name} FAILED:`, err.message);
        results.push({ system, name, label, error: String(err.message || err) });
      }
    }
  } finally {
    await browser.close();
  }

  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(results, null, 2));
  console.log(`\n[p2-25] Done. ${results.length} bodies → ${OUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
