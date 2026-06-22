// ═══════════════════════════════════════════════════════════════════
// ADMIN VISUAL EDITOR — TEMPORARY
// Floating panel with real-time sliders, color pickers, and toggles
// for every major visual aesthetic property.
//
// REMOVAL: Delete this file, remove marked lines in main.ts/dock.ts,
// remove the CSS block in styles.css.
// ═══════════════════════════════════════════════════════════════════

import { VP, type VisualParams } from '../../render/visual-params';

// ── Types ────────────────────────────────────────────────────────

interface SliderDef {
  type: 'slider';
  key: keyof VisualParams;
  label: string;
  min: number;
  max: number;
  step: number;
}

interface ColorDef {
  type: 'color';
  key: keyof VisualParams;
  label: string;
}

interface ToggleDef {
  type: 'toggle';
  key: keyof VisualParams;
  label: string;
}

interface SelectDef {
  type: 'select';
  key: keyof VisualParams;
  label: string;
  options: { label: string; value: number }[];
}

type ControlDef = SliderDef | ColorDef | ToggleDef | SelectDef;

interface CategoryDef {
  title: string;
  collapsed: boolean;
  controls: ControlDef[];
}

// ── Control Definitions ──────────────────────────────────────────

const CATEGORIES: CategoryDef[] = [
  {
    title: 'LIGHTING',
    collapsed: false,
    controls: [
      { type: 'slider', key: 'starLightIntensity', label: 'Star Light Intensity', min: 0, max: 5, step: 0.05 },
      { type: 'color', key: 'starLightColor', label: 'Star Light Color' },
      { type: 'slider', key: 'ambientIntensity', label: 'Ambient Intensity', min: 0, max: 1, step: 0.01 },
      { type: 'color', key: 'ambientColor', label: 'Ambient Color' },
      { type: 'slider', key: 'toneMappingExposure', label: 'Tone Map Exposure', min: 0.1, max: 3, step: 0.05 },
    ],
  },
  {
    title: 'POST-PROCESSING',
    collapsed: false,
    controls: [
      { type: 'slider', key: 'bloomStrength', label: 'Bloom Strength', min: 0, max: 2, step: 0.01 },
      { type: 'slider', key: 'bloomRadius', label: 'Bloom Radius', min: 0, max: 2, step: 0.01 },
      { type: 'slider', key: 'bloomThreshold', label: 'Bloom Threshold', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'vignetteIntensity', label: 'Vignette Intensity', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'vignetteDropoff', label: 'Vignette Dropoff', min: 0, max: 1, step: 0.01 },
      { type: 'toggle', key: 'smaaEnabled', label: 'SMAA Anti-Aliasing' },
    ],
  },
  {
    title: 'SUN SURFACE',
    collapsed: true,
    controls: [
      { type: 'select', key: 'sunPerlinRes', label: 'Perlin Cubemap Res', options: [
        { label: '128', value: 128 }, { label: '256', value: 256 }, { label: '512', value: 512 },
      ]},
      { type: 'slider', key: 'sunFresnelPower', label: 'Fresnel Power', min: 0, max: 5, step: 0.1 },
      { type: 'slider', key: 'sunFresnelInfluence', label: 'Fresnel Influence', min: 0, max: 3, step: 0.05 },
      { type: 'slider', key: 'sunTint', label: 'Tint', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'sunBrightness', label: 'Brightness', min: 0, max: 2, step: 0.01 },
      { type: 'slider', key: 'sunBrightnessOffset', label: 'Brightness Offset', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'SUN GLOW & CORONA',
    collapsed: true,
    controls: [
      { type: 'slider', key: 'sunGlowExpand', label: 'Glow Expand', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'sunGlowInner', label: 'Glow Inner', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'sunGlowOuter', label: 'Glow Outer', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'sunGlowIntensity', label: 'Glow Intensity', min: 0, max: 3, step: 0.05 },
      { type: 'select', key: 'sunRayCount', label: 'Corona Ray Count', options: [
        { label: '128', value: 128 }, { label: '256', value: 256 },
        { label: '512', value: 512 }, { label: '1024', value: 1024 },
      ]},
      { type: 'slider', key: 'sunRayWidth', label: 'Corona Ray Width', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'sunRayLength', label: 'Corona Ray Length', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'sunRayOpacity', label: 'Corona Ray Opacity', min: 0, max: 0.2, step: 0.001 },
      { type: 'slider', key: 'sunNoiseFrequency', label: 'Noise Frequency', min: 1, max: 20, step: 0.5 },
      { type: 'slider', key: 'sunNoiseAmplitude', label: 'Noise Amplitude', min: 0, max: 2, step: 0.05 },
      { type: 'slider', key: 'sunNoiseSpatialFreq', label: 'Noise Spatial Freq', min: 1, max: 20, step: 0.5 },
      { type: 'slider', key: 'sunNoiseTemporalFreq', label: 'Noise Temporal Freq', min: 0, max: 0.2, step: 0.001 },
    ],
  },
  {
    title: 'PLANETS',
    collapsed: true,
    controls: [
      { type: 'select', key: 'planetSegments', label: 'Geometry Segments', options: [
        { label: '16', value: 16 }, { label: '24', value: 24 },
        { label: '32', value: 32 }, { label: '48', value: 48 }, { label: '64', value: 64 },
      ]},
      { type: 'slider', key: 'planetTerminatorSoftness', label: 'Terminator Softness', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'planetTerminatorOffset', label: 'Terminator Offset', min: -1, max: 0, step: 0.01 },
      { type: 'slider', key: 'planetSpecularPower', label: 'Specular Power', min: 1, max: 128, step: 1 },
      { type: 'slider', key: 'planetSpecularOffset', label: 'Specular Offset', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'ATMOSPHERE',
    collapsed: true,
    controls: [
      { type: 'slider', key: 'atmosFresnelPower', label: 'Fresnel Power', min: 1, max: 20, step: 0.5 },
      { type: 'slider', key: 'atmosCenterFalloff', label: 'Center Falloff', min: 0, max: 5, step: 0.1 },
      { type: 'slider', key: 'atmosEdgeThreshold', label: 'Edge Threshold', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'atmosEdgeSoftness', label: 'Edge Softness', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'atmosTwilightBias', label: 'Twilight Bias', min: 0, max: 5, step: 0.1 },
      { type: 'slider', key: 'atmosScale', label: 'Atmos Scale', min: 1, max: 1.2, step: 0.005 },
    ],
  },
  {
    title: 'RING SHADOWS',
    collapsed: true,
    controls: [
      { type: 'slider', key: 'ringShadowAmbient', label: 'Shadow Ambient', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'ringShadowSoftnessFactor', label: 'Shadow Softness', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'ringShadowStrength', label: 'Shadow Strength', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'ASTEROID BELT',
    collapsed: true,
    controls: [
      { type: 'slider', key: 'asteroidCount', label: 'Asteroid Count', min: 100, max: 5000, step: 100 },
      { type: 'slider', key: 'dustCount', label: 'Dust Count', min: 100, max: 3000, step: 100 },
      { type: 'slider', key: 'asteroidLightIntensity', label: 'Light Intensity', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'dustLightIntensity', label: 'Dust Light Intensity', min: 0, max: 1, step: 0.01 },
      { type: 'select', key: 'asteroidDetail', label: 'Geometry Detail', options: [
        { label: '0', value: 0 }, { label: '1', value: 1 }, { label: '2', value: 2 },
        { label: '3', value: 3 }, { label: '4', value: 4 },
      ]},
      { type: 'slider', key: 'asteroidNoiseMagnitude', label: 'Noise Magnitude', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'asteroidCraterProbability', label: 'Crater Probability', min: 0, max: 1, step: 0.05 },
      { type: 'slider', key: 'asteroidMinHue', label: 'Min Hue', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'asteroidMaxHue', label: 'Max Hue', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'asteroidMinSat', label: 'Min Saturation', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'asteroidMaxSat', label: 'Max Saturation', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'SCALE & ZOOM',
    collapsed: true,
    controls: [
      { type: 'slider', key: 'visualInflation', label: 'Visual Inflation (max)', min: 1, max: 2, step: 0.05 },
      { type: 'slider', key: 'transitionZoneInner', label: 'Ramp Start (AU, ≤→1:1)', min: 5, max: 60, step: 5 },
      { type: 'slider', key: 'transitionZoneOuter', label: 'Ramp Full (AU, ≥→max)', min: 60, max: 160, step: 5 },
    ],
  },
  {
    title: 'LENS FLARE',
    collapsed: true,
    controls: [
      { type: 'toggle', key: 'lensFlareEnabled', label: 'Enabled' },
      { type: 'slider', key: 'lensFlareOpacity', label: 'Opacity', min: 0, max: 1, step: 0.01 },
      { type: 'select', key: 'lensFlareStarPoints', label: 'Star Points', options: [
        { label: '3', value: 3 }, { label: '4', value: 4 }, { label: '5', value: 5 },
        { label: '6', value: 6 }, { label: '8', value: 8 },
      ]},
      { type: 'slider', key: 'lensFlareGlareSize', label: 'Glare Size', min: 0, max: 2, step: 0.01 },
      { type: 'slider', key: 'lensFlareFlareSize', label: 'Flare Size', min: 0, max: 0.02, step: 0.0005 },
      { type: 'slider', key: 'lensFlareFlareSpeed', label: 'Flare Speed', min: 0, max: 2, step: 0.05 },
      { type: 'slider', key: 'lensFlareHaloScale', label: 'Halo Scale', min: 0, max: 2, step: 0.05 },
      { type: 'slider', key: 'lensFlareColorR', label: 'Color Gain R', min: 0, max: 255, step: 1 },
      { type: 'slider', key: 'lensFlareColorG', label: 'Color Gain G', min: 0, max: 255, step: 1 },
      { type: 'slider', key: 'lensFlareColorB', label: 'Color Gain B', min: 0, max: 255, step: 1 },
    ],
  },
  {
    title: 'PARTICLES',
    collapsed: true,
    controls: [
      { type: 'slider', key: 'bgStarCount', label: 'BG Star Count', min: 1000, max: 20000, step: 500 },
      { type: 'slider', key: 'bgStarSize', label: 'BG Star Size', min: 10, max: 500, step: 10 },
      { type: 'slider', key: 'bgStarOpacity', label: 'BG Star Opacity', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'milkyWayCount', label: 'Milky Way Count', min: 5000, max: 50000, step: 1000 },
      { type: 'slider', key: 'milkyWaySize', label: 'Milky Way Size', min: 10, max: 500, step: 10 },
      { type: 'slider', key: 'milkyWayOpacity', label: 'Milky Way Opacity', min: 0, max: 1, step: 0.01 },
    ],
  },
];

// ── State ────────────────────────────────────────────────────────

let panel: HTMLElement | null = null;
let visible = false;

// ── Render ───────────────────────────────────────────────────────

function formatValue(val: number, step: number): string {
  if (step >= 1) return val.toFixed(0);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return val.toFixed(Math.min(decimals, 6));
}

function buildControl(def: ControlDef): string {
  const id = `ve-${def.key}`;

  switch (def.type) {
    case 'slider': {
      const val = VP.get(def.key) as number;
      return `<div class="ve-row">
        <label class="ve-label" for="${id}">${def.label}</label>
        <input type="range" id="${id}" class="settings-range ve-range"
          min="${def.min}" max="${def.max}" step="${def.step}" value="${val}"
          data-key="${def.key}">
        <span class="ve-value" id="${id}-val">${formatValue(val, def.step)}</span>
      </div>`;
    }
    case 'color': {
      const val = VP.get(def.key) as string;
      return `<div class="ve-row">
        <label class="ve-label" for="${id}">${def.label}</label>
        <input type="color" id="${id}" class="ve-color" value="${val}" data-key="${def.key}">
        <span class="ve-value" id="${id}-val">${val}</span>
      </div>`;
    }
    case 'toggle': {
      const val = VP.get(def.key) as boolean;
      return `<div class="ve-row">
        <label class="ve-label" for="${id}">${def.label}</label>
        <input type="checkbox" id="${id}" class="ve-toggle" ${val ? 'checked' : ''} data-key="${def.key}">
      </div>`;
    }
    case 'select': {
      const val = VP.get(def.key) as number;
      const opts = def.options.map(o =>
        `<option value="${o.value}"${o.value === val ? ' selected' : ''}>${o.label}</option>`
      ).join('');
      return `<div class="ve-row">
        <label class="ve-label" for="${id}">${def.label}</label>
        <select id="${id}" class="settings-select ve-select" data-key="${def.key}">${opts}</select>
      </div>`;
    }
  }
}

function buildCategory(cat: CategoryDef, idx: number): string {
  const collapsedClass = cat.collapsed ? '' : ' expanded';
  const controls = cat.controls.map(c => buildControl(c)).join('');
  return `<div class="ve-category${collapsedClass}" data-cat="${idx}">
    <div class="ve-cat-header">
      <span class="ve-cat-chevron">&#9654;</span>
      <span class="ve-cat-title">${cat.title}</span>
      <button class="ve-cat-reset" data-cat="${idx}" title="Reset section">RST</button>
    </div>
    <div class="ve-cat-body">${controls}</div>
  </div>`;
}

function buildPanel(): string {
  const cats = CATEGORIES.map((c, i) => buildCategory(c, i)).join('');
  return `<div class="ve-header">
    <span class="ve-title">VISUAL EDITOR</span>
    <div class="ve-actions">
      <button class="ve-btn" id="ve-export" title="Copy JSON to clipboard">EXPORT</button>
      <button class="ve-btn" id="ve-import" title="Paste JSON from clipboard">IMPORT</button>
      <button class="ve-btn" id="ve-reset" title="Reset all to defaults">RESET ALL</button>
      <button class="ve-close" id="ve-close" title="Close (F2)">&#10005;</button>
    </div>
  </div>
  <div class="ve-body">${cats}</div>`;
}

// ── Wire Events ──────────────────────────────────────────────────

function wireEvents(): void {
  if (!panel) return;

  // Category collapse/expand
  panel.querySelectorAll<HTMLElement>('.ve-cat-header').forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't toggle if clicking the reset button
      if ((e.target as HTMLElement).classList.contains('ve-cat-reset')) return;
      const cat = header.parentElement;
      if (cat) cat.classList.toggle('expanded');
    });
  });

  // Section reset buttons
  panel.querySelectorAll<HTMLElement>('.ve-cat-reset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const catIdx = parseInt(btn.dataset.cat ?? '0', 10);
      const cat = CATEGORIES[catIdx];
      if (!cat) return;
      const defaults = VP.getDefaults();
      for (const ctrl of cat.controls) {
        VP.set(ctrl.key, defaults[ctrl.key]);
        syncControl(ctrl.key);
      }
    });
  });

  // Sliders
  panel.querySelectorAll<HTMLInputElement>('.ve-range').forEach(input => {
    input.addEventListener('input', () => {
      const key = input.dataset.key as keyof VisualParams;
      const val = parseFloat(input.value);
      VP.set(key, val as VisualParams[typeof key]);
      const valSpan = panel!.querySelector<HTMLElement>(`#${input.id}-val`);
      if (valSpan) valSpan.textContent = formatValue(val, parseFloat(input.step));
    });
  });

  // Color pickers
  panel.querySelectorAll<HTMLInputElement>('.ve-color').forEach(input => {
    input.addEventListener('input', () => {
      const key = input.dataset.key as keyof VisualParams;
      VP.set(key, input.value as VisualParams[typeof key]);
      const valSpan = panel!.querySelector<HTMLElement>(`#${input.id}-val`);
      if (valSpan) valSpan.textContent = input.value;
    });
  });

  // Toggles
  panel.querySelectorAll<HTMLInputElement>('.ve-toggle').forEach(input => {
    input.addEventListener('change', () => {
      const key = input.dataset.key as keyof VisualParams;
      VP.set(key, input.checked as VisualParams[typeof key]);
    });
  });

  // Selects
  panel.querySelectorAll<HTMLSelectElement>('.ve-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const key = sel.dataset.key as keyof VisualParams;
      VP.set(key, parseFloat(sel.value) as VisualParams[typeof key]);
    });
  });

  // Export
  panel.querySelector('#ve-export')?.addEventListener('click', () => {
    const json = VP.exportJSON();
    navigator.clipboard.writeText(json).then(() => {
      console.info('[VisualEditor] Exported to clipboard');
    }).catch(() => {
      console.info('[VisualEditor] Export:\n', json);
    });
  });

  // Import
  panel.querySelector('#ve-import')?.addEventListener('click', async () => {
    try {
      const json = await navigator.clipboard.readText();
      VP.importJSON(json);
      // Re-render the panel to sync all controls
      if (panel) {
        panel.innerHTML = buildPanel();
        wireEvents();
      }
      console.info('[VisualEditor] Imported from clipboard');
    } catch {
      console.warn('[VisualEditor] Could not read clipboard');
    }
  });

  // Reset all
  panel.querySelector('#ve-reset')?.addEventListener('click', () => {
    VP.reset();
    if (panel) {
      panel.innerHTML = buildPanel();
      wireEvents();
    }
  });

  // Close
  panel.querySelector('#ve-close')?.addEventListener('click', () => {
    toggle();
  });
}

function syncControl(key: keyof VisualParams): void {
  if (!panel) return;
  const id = `ve-${key}`;
  const el = panel.querySelector<HTMLInputElement>(`#${id}`);
  if (!el) return;

  const val = VP.get(key);
  if (el.type === 'range') {
    el.value = String(val);
    const valSpan = panel.querySelector<HTMLElement>(`#${id}-val`);
    if (valSpan) valSpan.textContent = formatValue(val as number, parseFloat(el.step));
  } else if (el.type === 'color') {
    el.value = val as string;
    const valSpan = panel.querySelector<HTMLElement>(`#${id}-val`);
    if (valSpan) valSpan.textContent = val as string;
  } else if (el.type === 'checkbox') {
    el.checked = val as boolean;
  } else if (el.tagName === 'SELECT') {
    (el as unknown as HTMLSelectElement).value = String(val);
  }
}

// ── Public API ───────────────────────────────────────────────────

export function toggle(): void {
  visible = !visible;
  if (!panel) return;
  panel.style.display = visible ? 'flex' : 'none';
}

export function initVisualEditor(): void {
  panel = document.createElement('div');
  panel.id = 'visual-editor';
  panel.className = 've-panel';
  panel.style.display = 'none';
  panel.innerHTML = buildPanel();
  document.body.appendChild(panel);
  wireEvents();

  // Keyboard shortcut: backtick/tilde to toggle
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.code === 'F2') {
      e.preventDefault();
      toggle();
    }
  });

  console.info('[VisualEditor] Initialized — press F2 to toggle');
}
