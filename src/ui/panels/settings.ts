// ═══════════════════════════════════════════════════════════════════
// SETTINGS PANEL — Config & Keyboard Reference
// Matches the monolithic SettingsPanel: font selector, keyboard
// shortcut reference, and theme reset. Anchored to bottom.
// ═══════════════════════════════════════════════════════════════════

import { PanelManager } from '../panel-manager';
import { registerPanel } from '../dock';
import { Theme, FONTS } from '../theme';
import { VP, type VisualParams } from '../../render/visual-params';

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

// ── Render ───────────────────────────────────────────────────────

function render(area: HTMLElement): void {
  let h = `<div class="panel-header">`
    + `<div class="panel-title">CONFIG</div>`
    + `<button class="panel-close">✕</button>`
    + `</div>`;

  h += `<div class="panel-body">`;

  // ── Font Selector ──
  h += `<div class="settings-group-title">TYPEFACE</div>`;
  h += `<div class="settings-row"><select id="s-font" class="settings-select">`;
  FONTS.forEach(f => {
    const sel = f === Theme.getFont() ? ' selected' : '';
    h += `<option value="${f}"${sel} style="font-family:'${f}'">${f}</option>`;
  });
  h += `</select></div>`;

  // ── Font Preview ──
  h += `<div class="settings-preview" id="s-preview">`
    + `<div class="settings-preview-title">PREVIEW</div>`
    + `<div class="settings-preview-body">The quick brown fox jumps over the lazy dog. 0123456789</div>`
    + `</div>`;

  // ── Visual Scale ──
  h += `<div class="settings-group-title" style="margin-top:16px">VISUAL SCALE</div>`;
  h += `<div class="settings-row" style="display:flex;align-items:center;gap:8px">`;
  h += `<span style="font-size:11px;opacity:0.6">1×</span>`;
  h += `<input type="range" id="s-scale" class="settings-range" min="1" max="8" step="0.5" value="${VP.get('visualScale')}">`;
  h += `<span style="font-size:11px;opacity:0.6">8×</span>`;
  h += `<span id="s-scale-val" style="font-size:11px;min-width:28px;text-align:right">${VP.get('visualScale')}×</span>`;
  h += `</div>`;
  h += `<div style="font-size:10px;opacity:0.4;margin-top:2px">Scales planets &amp; star visually (not orbits)</div>`;

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
  h += `<div style="font-size:10px;opacity:0.4;margin-top:2px">Drag a slider to 0 to disable it. Backdrop = the Milky Way sky glow.</div>`;

  // ── Keyboard Reference ──
  h += `<div class="settings-group-title" style="margin-top:16px">KEYBOARD</div>`;
  SHORTCUTS.forEach(([key, desc]) => {
    h += `<div class="key-row"><kbd>${key}</kbd><span class="key-desc">${desc}</span></div>`;
  });

  // ── Reset ──
  h += `<button class="settings-reset" id="s-reset" style="margin-top:12px">RESET THEME</button>`;

  h += `</div>`; // panel-body

  area.innerHTML = h;

  // ── Wire Interactions ──

  const closeBtn = area.querySelector<HTMLElement>('.panel-close');
  if (closeBtn) closeBtn.onclick = () => PanelManager.close();

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
      VP.set('visualScale', v);
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

  const resetBtn = area.querySelector<HTMLElement>('#s-reset');
  if (resetBtn) {
    resetBtn.onclick = () => {
      Theme.reset();
      // Re-render to sync select state
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
