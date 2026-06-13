// ═══════════════════════════════════════════════════════════════════
// GALAXY LAB PANEL — dedicated dev control surface (TEMPORARY)
//
// A floating button + dialog of live sliders for nudging the galaxy
// visuals at the galaxy tier (where headless verification can't reach).
// Self-contained DOM + inline styles so it can be removed in one delete:
// drop this file, its initGalaxyLabPanel() call in main.ts, and re-bake
// the chosen values into galaxy-density.ts. See galaxy-lab.ts.
// ═══════════════════════════════════════════════════════════════════

import {
  GALAXY_TUNE, GALAXY_TUNE_DEFAULTS, applyGalaxyTune, persistGalaxyTune,
  type GalaxyTune,
} from '../render/galaxy-lab';

interface Knob {
  key: keyof GalaxyTune;
  label: string;
  min: number; max: number; step: number;
  group: string;
  hint?: string;
}

const KNOBS: Knob[] = [
  // ── Arms ──
  { key: 'armContrast',  label: 'Arm contrast',       min: 0,      max: 3,    step: 0.05,   group: 'ARMS', hint: 'arm brightness vs inter-arm' },
  { key: 'armSharp',     label: 'Arm definition',     min: 0.5,    max: 6,    step: 0.1,    group: 'ARMS', hint: 'higher = thinner, sharper arms' },
  { key: 'armFloor',     label: 'Arm wispiness',      min: 0,      max: 1,    step: 0.02,   group: 'ARMS', hint: 'lower = more broken/wispy' },
  { key: 'armScale',     label: 'Arm clump scale',    min: 100,    max: 2000, step: 20,     group: 'ARMS', hint: 'size of the FBM clumps (WU)' },
  // ── Disc ──
  { key: 'discWidth',    label: 'Disc thickness',     min: 0.3,    max: 2.5,  step: 0.05,   group: 'DISC', hint: 'vertical flatness (×)' },
  { key: 'bulgeAmp',     label: 'Bulge brightness',   min: 0,      max: 3,    step: 0.05,   group: 'DISC', hint: 'central glow (de-blob)' },
  { key: 'dustStrength', label: 'Dust strength',      min: 0,      max: 4,    step: 0.05,   group: 'DISC', hint: 'dark lanes / inter-arm gaps' },
  { key: 'emission',     label: 'Overall brightness', min: 0.0002, max: 0.01, step: 0.0002, group: 'DISC', hint: 'volume emission scale' },
  // ── Features ──
  { key: 'hiiAmp',       label: 'HII knot glow',      min: 0,      max: 3,    step: 0.05,   group: 'FEATURES', hint: 'in-model star-forming knots' },
  { key: 'nebulaOpacity',label: 'Nebula opacity',     min: 0,      max: 2,    step: 0.05,   group: 'FEATURES', hint: 'billboard nebulae' },
  { key: 'nebulaSize',   label: 'Nebula size',        min: 0.2,    max: 3,    step: 0.05,   group: 'FEATURES', hint: 'billboard nebulae' },
  { key: 'particleSize', label: 'Star particle size', min: 0.2,    max: 3,    step: 0.05,   group: 'FEATURES', hint: 'galaxy star points' },
];

function fmt(v: number): string {
  if (Math.abs(v) < 0.01 && v !== 0) return v.toExponential(1);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

let panelEl: HTMLElement | null = null;

function syncSliders(root: HTMLElement): void {
  for (const k of KNOBS) {
    const slider = root.querySelector<HTMLInputElement>(`#gl-${k.key}`);
    const val = root.querySelector<HTMLElement>(`#gl-${k.key}-val`);
    if (slider) slider.value = String(GALAXY_TUNE[k.key]);
    if (val) val.textContent = fmt(GALAXY_TUNE[k.key]);
  }
}

function buildPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'galaxy-lab';
  panel.style.cssText = [
    'position:fixed', 'right:16px', 'bottom:64px', 'width:300px',
    'max-height:72vh', 'overflow-y:auto', 'z-index:9999', 'display:none',
    'background:rgba(8,10,18,0.94)', 'border:1px solid rgba(120,150,220,0.35)',
    'border-radius:8px', 'padding:12px 14px',
    'font-family:ui-monospace,Menlo,monospace', 'color:#cdd6f0',
    'box-shadow:0 8px 32px rgba(0,0,0,0.6)', 'backdrop-filter:blur(6px)',
  ].join(';');

  let h = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-size:12px;letter-spacing:1px;font-weight:600;color:#aab8e8">🌌 GALAXY LAB</div>
      <button id="gl-close" style="background:none;border:none;color:#8893b8;font-size:14px;cursor:pointer">✕</button>
    </div>
    <div style="font-size:10px;opacity:0.55;line-height:1.4;margin-bottom:10px">
      Zoom all the way out to the galaxy tier to see changes. Tune, then
      <b>Copy values</b> and paste them back to bake into the model.
    </div>`;

  let lastGroup = '';
  for (const k of KNOBS) {
    if (k.group !== lastGroup) {
      h += `<div style="font-size:10px;letter-spacing:1px;color:#7f8cc0;margin:10px 0 4px;border-bottom:1px solid rgba(120,150,220,0.18);padding-bottom:2px">${k.group}</div>`;
      lastGroup = k.group;
    }
    h += `<div style="margin:6px 0">
        <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">
          <span title="${k.hint ?? ''}">${k.label}</span>
          <span id="gl-${k.key}-val" style="opacity:0.7">${fmt(GALAXY_TUNE[k.key])}</span>
        </div>
        <input type="range" id="gl-${k.key}" min="${k.min}" max="${k.max}" step="${k.step}"
          value="${GALAXY_TUNE[k.key]}" style="width:100%;accent-color:#7f9cff;height:14px">
      </div>`;
  }

  h += `<div style="display:flex;gap:6px;margin-top:12px">
      <button id="gl-copy" style="flex:1;font-size:10px;padding:6px;background:rgba(90,120,220,0.25);color:#cdd6f0;border:1px solid rgba(120,150,220,0.4);border-radius:4px;cursor:pointer">Copy values</button>
      <button id="gl-reset" style="flex:1;font-size:10px;padding:6px;background:rgba(60,60,80,0.4);color:#cdd6f0;border:1px solid rgba(120,130,160,0.3);border-radius:4px;cursor:pointer">Reset</button>
    </div>`;

  panel.innerHTML = h;

  // Wire sliders
  for (const k of KNOBS) {
    const slider = panel.querySelector<HTMLInputElement>(`#gl-${k.key}`);
    const val = panel.querySelector<HTMLElement>(`#gl-${k.key}-val`);
    if (!slider) continue;
    slider.oninput = () => {
      const v = parseFloat(slider.value);
      GALAXY_TUNE[k.key] = v;
      if (val) val.textContent = fmt(v);
      applyGalaxyTune();
      persistGalaxyTune();
    };
  }

  // Close
  const closeBtn = panel.querySelector<HTMLButtonElement>('#gl-close');
  if (closeBtn) closeBtn.onclick = () => { panel.style.display = 'none'; };

  // Copy values → clipboard (JSON the user can paste back to me)
  const copyBtn = panel.querySelector<HTMLButtonElement>('#gl-copy');
  if (copyBtn) copyBtn.onclick = () => {
    const json = JSON.stringify(GALAXY_TUNE, null, 2);
    void navigator.clipboard?.writeText(json).then(
      () => { copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy values'; }, 1200); },
      () => { copyBtn.textContent = 'Copy failed'; setTimeout(() => { copyBtn.textContent = 'Copy values'; }, 1200); },
    );
  };

  // Reset to model defaults
  const resetBtn = panel.querySelector<HTMLButtonElement>('#gl-reset');
  if (resetBtn) resetBtn.onclick = () => {
    Object.assign(GALAXY_TUNE, GALAXY_TUNE_DEFAULTS);
    applyGalaxyTune();
    persistGalaxyTune();
    syncSliders(panel);
  };

  return panel;
}

export function initGalaxyLabPanel(): void {
  if (typeof document === 'undefined' || document.getElementById('galaxy-lab-btn')) return;

  panelEl = buildPanel();
  document.body.appendChild(panelEl);

  const btn = document.createElement('button');
  btn.id = 'galaxy-lab-btn';
  btn.textContent = '🌌 LAB';
  btn.title = 'Galaxy Lab — live galaxy tuning';
  btn.style.cssText = [
    'position:fixed', 'right:16px', 'bottom:16px', 'z-index:9999',
    'font-family:ui-monospace,Menlo,monospace', 'font-size:11px',
    'letter-spacing:1px', 'padding:7px 12px', 'cursor:pointer',
    'background:rgba(8,10,18,0.9)', 'color:#aab8e8',
    'border:1px solid rgba(120,150,220,0.4)', 'border-radius:6px',
    'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
  ].join(';');
  btn.onclick = () => {
    if (!panelEl) return;
    const open = panelEl.style.display !== 'none';
    if (open) { panelEl.style.display = 'none'; return; }
    syncSliders(panelEl); // reflect any persisted/reset values
    panelEl.style.display = 'block';
  };
  document.body.appendChild(btn);
}
