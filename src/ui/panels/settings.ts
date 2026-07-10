// ═══════════════════════════════════════════════════════════════════
// SETTINGS PANEL — Config, tabbed: DISPLAY · KEYBOARD · CREDITS
// Grouped into tabs so the panel doesn't scroll forever. The typeface
// selector is HIDDEN for now (SHOW_TYPEFACE) but kept wired. DISPLAY
// carries a dev-only "Save as default" that promotes the current visual
// settings to the committed src/config/visual-defaults.json.
// ═══════════════════════════════════════════════════════════════════

import { PanelManager } from '../panel-manager';
import { registerPanel } from '../dock';
import { Theme, FONTS } from '../theme';
import { VP, type VisualParams } from '../../render/visual-params';
import { DATA_SOURCES, PERMISSION_LABEL } from '../../data/data-sources';

// Typeface controls are parked, not removed — flip to re-show the selector.
const SHOW_TYPEFACE = false;

// ── Visual-effect sliders (UI 0–100% → VP value 0..max; 0 = off) ──
interface FxDef { id: string; label: string; key: keyof VisualParams; max: number; }
const FX: FxDef[] = [
  { id: 's-chroma', label: 'Chromatic Aberration', key: 'chromaticAberration', max: 0.006 },
  { id: 's-grain',  label: 'Film Grain',           key: 'filmGrainIntensity',  max: 0.12 },
  { id: 's-bloom',  label: 'Bloom',                key: 'bloomStrength',       max: 0.30 },
  { id: 's-vig',    label: 'Vignette',             key: 'vignetteIntensity',   max: 1.0 },
  { id: 's-back',   label: 'Milky Way Backdrop',   key: 'backdropIntensity',   max: 2.0 },
];

// ── Keyboard Shortcuts ───────────────────────────────────────────

const SHORTCUTS: [string, string][] = [
  ['L-Drag',     'Orbit rotate'],
  ['R-Drag',     'Pan'],
  ['Scroll',     'Zoom'],
  ['W / S',      'Pan forward / back'],
  ['A / D',      'Pan left / right'],
  ['Space',      'Pedestal up'],
  ['Ctrl',       'Pedestal down'],
  ['Shift+⏎',   'Return to target'],
  ['Alt+⏎',     'Reset to home'],
  ['H',          'Home position'],
  ['P',          'Pause'],
  [', / .',      'Time slower / faster'],
  ['G',          'Strategic overlay'],
  ['1-6',        'Zoom domain'],
  ['Tab',        'Cycle Bobs'],
  ['I',          'System detail'],
  ['B',          'Bob roster'],
  ['N',          'Alerts'],
  ['Esc',        'Deselect'],
];

// ── Tabs ─────────────────────────────────────────────────────────

type TabId = 'display' | 'keyboard' | 'credits';
const TABS: [TabId, string][] = [
  ['display',  'DISPLAY'],
  ['keyboard', 'KEYBOARD'],
  ['credits',  'CREDITS'],
];
let activeTab: TabId = 'display'; // sticky within the session

// ── Tab bodies ───────────────────────────────────────────────────

function renderDisplayTab(): string {
  let h = '';

  if (SHOW_TYPEFACE) {
    h += `<div class="settings-group-title">TYPEFACE</div>`;
    h += `<div class="settings-row"><select id="s-font" class="settings-select">`;
    FONTS.forEach(f => {
      const sel = f === Theme.getFont() ? ' selected' : '';
      h += `<option value="${f}"${sel} style="font-family:'${f}'">${f}</option>`;
    });
    h += `</select></div>`;
    h += `<div class="settings-preview" id="s-preview">`
      + `<div class="settings-preview-title">PREVIEW</div>`
      + `<div class="settings-preview-body">The quick brown fox jumps over the lazy dog. 0123456789</div>`
      + `</div>`;
  }

  // ── Visual Inflation ──
  h += `<div class="settings-group-title"${SHOW_TYPEFACE ? ' style="margin-top:16px"' : ''}>VISUAL INFLATION</div>`;
  h += `<div class="settings-row" style="display:flex;align-items:center;gap:8px">`;
  h += `<span style="font-size:11px;opacity:0.6">1×</span>`;
  h += `<input type="range" id="s-scale" class="settings-range" min="1" max="2" step="0.05" value="${VP.get('visualInflation')}">`;
  h += `<span style="font-size:11px;opacity:0.6">2×</span>`;
  h += `<span id="s-scale-val" style="font-size:11px;min-width:34px;text-align:right">${VP.get('visualInflation')}×</span>`;
  h += `</div>`;
  h += `<div style="font-size:10px;opacity:0.4;margin-top:2px">Inflates planets &amp; star as you zoom out for legibility (1:1 up close); orbits unchanged</div>`;

  // ── Visual Effects (GPU / post-processing) ──
  h += `<div class="settings-group-title" style="margin-top:16px">VISUAL EFFECTS</div>`;
  FX.forEach(f => {
    const pct = Math.round((VP.get(f.key) as number) / f.max * 100);
    h += `<div class="settings-row" style="display:flex;align-items:center;gap:8px;margin-top:4px">`
      + `<span style="font-size:10px;opacity:0.65;flex:0 0 96px">${f.label}</span>`
      + `<input type="range" id="${f.id}" class="settings-range" min="0" max="100" step="1" value="${pct}" data-max="${f.max}" style="flex:1">`
      + `<span id="${f.id}-val" style="font-size:10px;min-width:30px;text-align:right;opacity:0.6">${pct === 0 ? 'OFF' : pct + '%'}</span>`
      + `</div>`;
  });
  h += `<div class="settings-row" style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">`
    + `<span style="font-size:10px;opacity:0.65">Anti-aliasing (SMAA)</span>`
    + `<input type="checkbox" id="s-smaa"${VP.get('smaaEnabled') ? ' checked' : ''}>`
    + `</div>`;
  h += `<div class="settings-row" style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">`
    + `<span style="font-size:10px;opacity:0.65">Photographic sky (NASA)</span>`
    + `<input type="checkbox" id="s-photosky"${VP.get('photographicSky') ? ' checked' : ''}>`
    + `</div>`;
  h += `<div class="settings-row" style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">`
    + `<span style="font-size:10px;opacity:0.65">Legacy star shells</span>`
    + `<input type="checkbox" id="s-starshells"${VP.get('starShellsEnabled') ? ' checked' : ''}>`
    + `</div>`;
  h += `<div style="font-size:10px;opacity:0.4;margin-top:2px">Drag a slider to 0 to disable it. Backdrop = the Milky Way sky glow.</div>`;

  // ── Persistence ──
  // Save-as-default only exists where the dev write-back endpoint does; the
  // production build keeps localStorage persistence for the allowlisted keys.
  if (import.meta.env.DEV) {
    h += `<button class="settings-reset" id="s-save-default" style="margin-top:14px">SAVE AS DEFAULT</button>`;
    h += `<div style="font-size:10px;opacity:0.4;margin-top:2px">Writes src/config/visual-defaults.json — persists across restarts, browsers and deploys (commit it to keep it).</div>`;
  }
  h += `<button class="settings-reset" id="s-reset" style="margin-top:8px">RESET TO DEFAULTS</button>`;

  return h;
}

function renderKeyboardTab(): string {
  let h = `<div class="settings-group-title">KEYBOARD</div>`;
  SHORTCUTS.forEach(([key, desc]) => {
    h += `<div class="key-row"><kbd>${key}</kbd><span class="key-desc">${desc}</span></div>`;
  });
  return h;
}

function renderCreditsTab(): string {
  // Rendered straight from the DATA_SOURCES registry (src/data/data-sources.ts) —
  // several licenses REQUIRE this attribution to be visible in-app.
  let h = `<div class="settings-group-title">CREDITS · DATA SOURCES</div>`;
  DATA_SOURCES.forEach(s => {
    const badge = s.shipped ? PERMISSION_LABEL[s.permission] : 'NOT SHIPPED';
    const badgeColor = s.permission === 'unverified' || s.permission === 'non-commercial'
      ? 'color:#e0a050' : 'opacity:0.5';
    const title = s.url
      ? `<a href="${s.url}" target="_blank" rel="noopener" style="color:inherit">${s.name}</a>`
      : s.name;
    h += `<div style="margin-top:8px">`
      + `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">`
      + `<span style="font-size:11px">${title}</span>`
      + `<span style="font-size:9px;letter-spacing:0.05em;white-space:nowrap;${badgeColor}">${badge}</span>`
      + `</div>`
      + `<div style="font-size:10px;opacity:0.55;margin-top:1px">${s.provider} · ${s.license}</div>`
      + `<div style="font-size:10px;opacity:0.4;margin-top:1px">${s.creditLine}</div>`
      + `</div>`;
  });
  return h;
}

// ── Render ───────────────────────────────────────────────────────

function render(area: HTMLElement): void {
  let h = `<div class="panel-header">`
    + `<div class="panel-title">CONFIG</div>`
    + `<button class="panel-close">✕</button>`
    + `</div>`;

  h += `<div class="settings-tabs">`;
  TABS.forEach(([id, label]) => {
    h += `<button class="settings-tab${id === activeTab ? ' active' : ''}" data-tab="${id}">${label}</button>`;
  });
  h += `</div>`;

  h += `<div class="panel-body">`;
  if (activeTab === 'display') h += renderDisplayTab();
  else if (activeTab === 'keyboard') h += renderKeyboardTab();
  else h += renderCreditsTab();
  h += `</div>`; // panel-body

  area.innerHTML = h;

  // ── Wire Interactions ──

  const closeBtn = area.querySelector<HTMLElement>('.panel-close');
  if (closeBtn) closeBtn.onclick = () => PanelManager.close();

  area.querySelectorAll<HTMLButtonElement>('.settings-tab').forEach(tab => {
    tab.onclick = () => {
      activeTab = tab.dataset.tab as TabId;
      render(area);
    };
  });

  if (activeTab !== 'display') return; // remaining wiring is DISPLAY-only

  const fontSelect = area.querySelector<HTMLSelectElement>('#s-font');
  if (fontSelect) {
    fontSelect.onchange = () => {
      Theme.setFont(fontSelect.value);
      updatePreview(area, fontSelect.value);
    };
  }

  const scaleSlider = area.querySelector<HTMLInputElement>('#s-scale');
  const scaleVal = area.querySelector<HTMLElement>('#s-scale-val');
  if (scaleSlider) {
    scaleSlider.oninput = () => {
      const v = parseFloat(scaleSlider.value);
      VP.set('visualInflation', v);
      if (scaleVal) scaleVal.textContent = `${v}×`;
    };
  }

  // ── Visual-effect sliders → VP (live; persisted by the store) ──
  FX.forEach(f => {
    const slider = area.querySelector<HTMLInputElement>('#' + f.id);
    const val = area.querySelector<HTMLElement>('#' + f.id + '-val');
    if (!slider) return;
    slider.oninput = () => {
      const pct = parseFloat(slider.value);
      VP.set(f.key, (pct / 100) * f.max);
      if (val) val.textContent = pct === 0 ? 'OFF' : pct + '%';
    };
  });
  const smaa = area.querySelector<HTMLInputElement>('#s-smaa');
  if (smaa) smaa.onchange = () => VP.set('smaaEnabled', smaa.checked);
  const photoSky = area.querySelector<HTMLInputElement>('#s-photosky');
  if (photoSky) photoSky.onchange = () => VP.set('photographicSky', photoSky.checked);
  const starShells = area.querySelector<HTMLInputElement>('#s-starshells');
  if (starShells) starShells.onchange = () => VP.set('starShellsEnabled', starShells.checked);

  const saveDefaultBtn = area.querySelector<HTMLButtonElement>('#s-save-default');
  if (saveDefaultBtn) {
    saveDefaultBtn.onclick = () => {
      void VP.saveAsDefaults().then((where) => {
        saveDefaultBtn.textContent = where === 'committed' ? 'SAVED ✓' : 'SAVE FAILED (dev server?)';
        setTimeout(() => { saveDefaultBtn.textContent = 'SAVE AS DEFAULT'; }, 1400);
      });
    };
  }

  const resetBtn = area.querySelector<HTMLElement>('#s-reset');
  if (resetBtn) {
    resetBtn.onclick = () => {
      Theme.reset();
      VP.reset(); // back to the saved baseline (code defaults + committed overlay)
      // Re-render to sync control state
      render(area);
    };
  }
}

function updatePreview(area: HTMLElement, fontName: string): void {
  const preview = area.querySelector<HTMLElement>('#s-preview');
  if (preview) {
    preview.style.fontFamily = `'${fontName}', monospace`;
  }
}

// ── Register ─────────────────────────────────────────────────────

export function initSettingsPanel(): void {
  registerPanel('settings', render, { anchor: 'bottom' });
}
