// ═══════════════════════════════════════════════════════════════════
// GALAXY LAB PANEL — the in-game control surface for the physical galaxy.
//
// A floating '🌌 LAB' button + dialog that renders the galaxy system's
// declarative control schema (createPhysicalGalaxy().controls). It owns
// ALL DOM; the galaxy owns the schema + persistence logic. Tuning here
// mutates the live galaxy; Save writes the per-browser interim override,
// Copy-JSON emits the payload to promote into SAVED_GALAXY_DEFAULTS
// (galaxy-sim.ts) so a look ships canonically.
// ═══════════════════════════════════════════════════════════════════

import type { GalaxyControls, Ctrl, Toggle } from '../render/galaxy-sim';

let panelEl: HTMLElement | null = null;

/** Mount the LAB button + dialog driving `controls`. Null (e.g. ?proto-buildout, no physical galaxy) → no-op. */
export function initGalaxyLabPanel(controls: GalaxyControls | null): void {
  if (typeof document === 'undefined' || document.getElementById('galaxy-lab-btn') || !controls) return;

  panelEl = buildPanel(controls);
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
    panelEl.style.display = panelEl.style.display === 'none' ? 'block' : 'none';
  };
  document.body.appendChild(btn);
}

function fmt(c: Ctrl, v: number): string {
  return `${Number.isInteger(c.step) && !c.scale ? v : +v.toFixed(2)}${c.unit ?? ''}`;
}

function buildPanel(controls: GalaxyControls): HTMLElement {
  const collapsed = new Set<string>((() => {
    try { return JSON.parse(localStorage.getItem(controls.collapseKey) ?? '[]') as string[]; } catch { return []; }
  })());
  const persistCollapse = (): void => {
    try { localStorage.setItem(controls.collapseKey, JSON.stringify([...collapsed])); } catch { /* ignore */ }
  };

  const panel = document.createElement('div');
  panel.id = 'galaxy-lab';
  panel.style.cssText = 'position:fixed;right:16px;bottom:64px;z-index:9999;display:none;width:224px;'
    + 'max-height:calc(100vh - 96px);overflow:auto;padding:10px 12px;'
    + 'background:rgba(12,15,20,0.94);border:1px solid #2a3340;border-radius:8px;color:#cfd8e3;'
    + 'font:12px/1.5 ui-monospace,SFMono-Regular,monospace;letter-spacing:0.02em;user-select:none;'
    + 'box-shadow:0 8px 32px rgba(0,0,0,0.6)';

  // Sticky header + collapse-all glyph.
  const title = document.createElement('div');
  title.style.cssText = 'position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;'
    + 'margin:-10px -12px 6px;padding:9px 12px 7px;background:rgba(12,15,20,0.98);border-bottom:1px solid #2a3340;'
    + 'font-weight:600;letter-spacing:0.08em;color:#eaf0f7';
  const titleLabel = document.createElement('span'); titleLabel.textContent = '🌌 GALAXY';
  const collapseAll = document.createElement('span');
  collapseAll.style.cssText = 'cursor:pointer;font-weight:400;color:#9fb0c3;font-size:13px;line-height:1;'
    + 'padding:2px 4px;border-radius:4px;user-select:none';
  title.append(titleLabel, collapseAll);
  panel.appendChild(title);

  const refreshers: Array<() => void> = []; // re-sync every input's value+label (used by Revert)

  const addCtrl = (host: HTMLElement, c: Ctrl): void => {
    const row = document.createElement('div');
    row.style.cssText = 'margin-top:6px;display:flex;justify-content:space-between';
    const name = document.createElement('span'); name.textContent = c.label;
    const val = document.createElement('span'); val.style.opacity = '0.8';
    row.append(name, val);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(c.min); input.max = String(c.max); input.step = String(c.step);
    input.style.cssText = 'width:100%;accent-color:#6aa3ff';
    const sync = (): void => { const v = c.get(); input.value = String(v); val.textContent = fmt(c, v); };
    sync();
    input.addEventListener('input', () => {
      c.set(+input.value); val.textContent = fmt(c, +input.value);
      if (c.live) c.live(); else controls.previewRebuild();
    });
    if (!c.live) input.addEventListener('change', () => { controls.rebuild(); });
    host.append(row, input);
    refreshers.push(sync);
  };

  const addToggle = (host: HTMLElement, t: Toggle): void => {
    const row = document.createElement('label');
    row.style.cssText = 'margin-top:6px;display:flex;justify-content:space-between;align-items:center;cursor:pointer';
    const name = document.createElement('span'); name.textContent = t.label;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.style.cssText = 'accent-color:#6aa3ff;width:14px;height:14px;margin:0';
    const sync = (): void => { box.checked = t.get(); };
    sync();
    box.addEventListener('change', () => {
      t.set(box.checked);
      if (t.live) t.live(); else controls.rebuild();
    });
    row.append(name, box);
    host.appendChild(row);
    refreshers.push(sync);
  };

  const sectionEntries: Array<{ key: string; setOpen: (open: boolean) => void; isOpen: () => boolean }> = [];
  const refreshCollapseIcon = (): void => {
    const allClosed = sectionEntries.length > 0 && sectionEntries.every((e) => !e.isOpen());
    collapseAll.textContent = allClosed ? '⊞' : '⊟';
    collapseAll.title = allClosed ? 'Expand all' : 'Collapse all';
  };
  for (const sec of controls.sections) {
    const header = document.createElement('div');
    header.style.cssText = 'margin-top:9px;padding-top:6px;border-top:1px solid #222b36;cursor:pointer;'
      + 'display:flex;justify-content:space-between;color:#9fb0c3;font-size:11px;letter-spacing:0.06em';
    const body = document.createElement('div');
    const caret = document.createElement('span');
    const label = document.createElement('span'); label.textContent = sec.title.toUpperCase();
    header.append(label, caret);
    const setOpen = (open: boolean): void => { body.style.display = open ? '' : 'none'; caret.textContent = open ? '▾' : '▸'; };
    setOpen(!collapsed.has(sec.key));
    sectionEntries.push({ key: sec.key, setOpen, isOpen: () => body.style.display !== 'none' });
    header.addEventListener('click', () => {
      const open = body.style.display === 'none';
      setOpen(open);
      if (open) collapsed.delete(sec.key); else collapsed.add(sec.key);
      persistCollapse();
      refreshCollapseIcon();
    });
    panel.append(header, body);
    for (const c of sec.ctrls) {
      if ('kind' in c) addToggle(body, c); else addCtrl(body, c);
    }
  }
  collapseAll.addEventListener('click', () => {
    const collapse = sectionEntries.some((e) => e.isOpen());
    for (const e of sectionEntries) {
      e.setOpen(!collapse);
      if (collapse) collapsed.add(e.key); else collapsed.delete(e.key);
    }
    persistCollapse();
    refreshCollapseIcon();
  });
  refreshCollapseIcon();

  // ── footer: Re-seed · Save (committed default via dev endpoint) · Revert · Copy JSON ──
  const btn = (text: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = 'flex:1;padding:6px 2px;background:#1c2530;color:#cfd8e3;border:1px solid #34404e;'
      + 'border-radius:5px;cursor:pointer;font:inherit;font-size:11px';
    b.addEventListener('click', onClick);
    return b;
  };
  const flash = (b: HTMLButtonElement, text: string): void => {
    const orig = b.textContent; b.textContent = text;
    setTimeout(() => { b.textContent = orig; }, 1000);
  };

  const footer1 = document.createElement('div');
  footer1.style.cssText = 'margin-top:11px;border-top:1px solid #2a3340;padding-top:8px;display:flex;gap:5px';
  const saveBtn = btn('Save', () => {
    void controls.save().then((where) =>
      flash(saveBtn, where === 'committed' ? 'Committed ✓' : 'Saved (browser only)'));
  });
  const revertBtn = btn('Revert', () => {
    controls.revert();
    for (const r of refreshers) r(); // re-sync inputs to the reverted (canonical) values
    flash(revertBtn, 'Canonical');
  });
  footer1.append(btn('Re-seed', () => { controls.reseed(); }), saveBtn, revertBtn);
  panel.appendChild(footer1);

  const footer2 = document.createElement('div');
  footer2.style.cssText = 'margin-top:5px;display:flex;gap:5px';
  const copyBtn = btn('Copy JSON → promote to SAVED_GALAXY_DEFAULTS', () => {
    const json = JSON.stringify(controls.snapshot(), null, 2);
    void navigator.clipboard?.writeText(json).then(
      () => flash(copyBtn, 'Copied ✓'),
      () => flash(copyBtn, 'Copy failed'),
    );
  });
  copyBtn.style.fontSize = '10px';
  footer2.appendChild(copyBtn);
  panel.appendChild(footer2);

  const help = document.createElement('div');
  help.style.cssText = 'margin-top:7px;opacity:0.5;font-size:10px;line-height:1.4';
  help.textContent = 'Save → committed default (galaxy-defaults.json; every browser/deploy) · Revert → committed look · Copy JSON → inspect/share';
  panel.appendChild(help);

  return panel;
}
