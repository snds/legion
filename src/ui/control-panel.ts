// ═══════════════════════════════════════════════════════════════════
// CONTROL PANEL — a generic, schema-driven tuning surface.
//
// Generalises the galaxy LAB panel into a reusable component the generator labs
// (star / planet / black hole / nebula) all share: a floating, collapsible panel
// that renders a declarative schema of sliders, toggles, selects and colour
// swatches, plus a footer of actions (Reseed / Save / Copy JSON…). The panel
// owns ALL its DOM; the caller owns the data (get/set closures) and reacts via
// each control's own side effects + the optional onChange hook.
//
// Dynamic schemas are supported: pass `sections` as a function and call
// `refresh()` to re-render (e.g. when a lab's selected archetype changes the
// editable parameter set).
// ═══════════════════════════════════════════════════════════════════

export interface SliderCtrl {
  kind?: 'slider';
  label: string;
  min: number;
  max: number;
  step: number;
  /** Displayed value = real / scale (e.g. show millions). */
  scale?: number;
  unit?: string;
  get(): number;
  set(v: number): void;
  /** Fired on release (the input's `change` event) — for expensive labs that
   *  preview cheaply during drag (set) and commit a full rebuild on release. */
  commit?(): void;
}
/** A read-only display row — a labelled value with no input (e.g. the planet
 *  lab's archetype, which reflects the selected world rather than being edited). */
export interface InfoCtrl {
  kind: 'info';
  label: string;
  get(): string;
}
/** A segmented example picker — a row of highlighted buttons for choosing WHICH
 *  single example a "gallery" lab shows in isolation (planet archetype, star
 *  spectral type, nebula kind…). Reusable across every generator lab. */
export interface PickerCtrl {
  kind: 'picker';
  label?: string;
  options: readonly { value: string; label: string; icon?: string }[];
  get(): string;
  set(v: string): void;
}
export interface ToggleCtrl {
  kind: 'toggle';
  label: string;
  get(): boolean;
  set(v: boolean): void;
}
export interface SelectCtrl {
  kind: 'select';
  label: string;
  options: readonly string[];
  get(): string;
  set(v: string): void;
}
/** Linear-RGB colour, components 0..1 (matches the shaders' colour params). */
export interface ColorCtrl {
  kind: 'color';
  label: string;
  get(): readonly [number, number, number];
  set(v: [number, number, number]): void;
}
export type LabCtrl = SliderCtrl | ToggleCtrl | SelectCtrl | ColorCtrl | InfoCtrl | PickerCtrl;

export interface LabSection {
  title: string;
  key: string;
  ctrls: LabCtrl[];
}
export interface LabAction {
  label: string;
  /** Return a string to flash as confirmation (e.g. "Saved ✓"). */
  onClick(): void | string | Promise<string | void>;
  /** Smaller, secondary styling. */
  minor?: boolean;
}

export interface LabSchema {
  title: string;
  /** localStorage key for per-section collapse state. */
  collapseKey: string;
  /** Static list, or a provider re-evaluated on refresh() (dynamic schemas). */
  sections: LabSection[] | (() => LabSection[]);
  actions?: LabAction[];
  /** Fired after ANY control set — the lab uses this to rebuild its example(s). */
  onChange?(): void;
}

export interface ControlPanelHandle {
  el: HTMLElement;
  /** Re-render sections (for dynamic schemas) + re-sync every input. */
  refresh(): void;
  /** Re-sync input values/labels to the current get() results (no re-render). */
  sync(): void;
  /** Swap the ENTIRE schema (title + sections + actions + collapseKey) — the
   *  context switch for the unified lab flyout (galaxy → planet → black hole …). */
  setContext(schema: LabSchema): void;
  /** Show / hide the flyout (no-op if it has no toggle button). */
  setOpen(open: boolean): void;
  isOpen(): boolean;
  destroy(): void;
}

export interface ControlPanelOpts {
  anchor?: string;
  /** When set, the panel is a flyout: it starts hidden and a toggle button is
   *  mounted (bottom-right) that shows/hides it. This is the single LAB button. */
  toggle?: { label: string; title?: string };
  /** When set, the panel is DOCKED to the right edge (full height) and collapses
   *  to the right via a chevron, leaving a re-open tab. Its width is published as
   *  the `--lab-dock-w` CSS variable so the HUD reflows around it. */
  dock?: { width?: number; open?: boolean; storeKey?: string };
}

const linToHex = (c: readonly [number, number, number]): string => {
  const to = (x: number): string => {
    const s = Math.round(Math.max(0, Math.min(1, Math.sqrt(x))) * 255); // approx linear→sRGB
    return s.toString(16).padStart(2, '0');
  };
  return `#${to(c[0])}${to(c[1])}${to(c[2])}`;
};
const hexToLin = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  return [srgb[0] ** 2, srgb[1] ** 2, srgb[2] ** 2]; // approx sRGB→linear
};

/** Mount a control panel driven by `schema` at a fixed screen anchor. */
export function mountControlPanel(
  schema: LabSchema,
  opts: ControlPanelOpts = {},
): ControlPanelHandle {
  // Mutable so setContext() can swap the whole lab context in-place.
  let activeSchema = schema;

  const dockW = opts.dock?.width ?? 264;
  const panel = document.createElement('div');
  panel.className = 'gen-lab-panel';
  // Flex COLUMN so the header docks to the top and the footer docks to the bottom
  // while only the middle (body) scrolls. Two layouts: a floating flyout, or a
  // full-height panel DOCKED to the right edge (slides off to collapse).
  panel.style.cssText = opts.dock
    ? [
        'position:fixed', 'top:0', 'right:0', 'height:100vh', `width:${dockW}px`, 'z-index:9998',
        'display:flex', 'flex-direction:column', 'background:rgba(12,15,20,0.97)',
        'border-left:1px solid #2a3340', 'color:#cfd8e3',
        'font:12px/1.5 ui-monospace,SFMono-Regular,monospace', 'letter-spacing:0.02em',
        'user-select:none', 'box-shadow:-8px 0 32px rgba(0,0,0,0.5)',
        'transition:transform 0.18s ease', 'will-change:transform',
      ].join(';')
    : [
        'position:fixed', opts.anchor ?? 'right:16px;top:64px', 'z-index:9998',
        'width:250px', 'max-height:calc(100vh - 96px)',
        'display:flex', 'flex-direction:column',
        'background:rgba(12,15,20,0.95)',
        'border:1px solid #2a3340', 'border-radius:8px', 'color:#cfd8e3',
        'font:12px/1.5 ui-monospace,SFMono-Regular,monospace', 'letter-spacing:0.02em',
        'user-select:none', 'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
      ].join(';');

  // ── Docked header: title + collapse-all glyph ──
  const title = document.createElement('div');
  title.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:8px;'
    + 'padding:9px 12px 7px;background:rgba(12,15,20,0.98);border-bottom:1px solid #2a3340;'
    + 'border-radius:8px 8px 0 0;font-weight:600;letter-spacing:0.08em;color:#eaf0f7';
  const titleLabel = document.createElement('span');
  titleLabel.textContent = activeSchema.title;
  const collapseAll = document.createElement('span');
  collapseAll.title = 'Collapse / expand all sections';
  collapseAll.style.cssText = 'cursor:pointer;font-weight:400;color:#9fb0c3;font-size:13px;line-height:1;'
    + 'padding:2px 5px;border-radius:4px;user-select:none';
  const headerRight = document.createElement('span');
  headerRight.style.cssText = 'display:flex;align-items:center;gap:2px';
  headerRight.appendChild(collapseAll);
  let dockChevron: HTMLSpanElement | null = null;
  if (opts.dock) {
    dockChevron = document.createElement('span');
    dockChevron.textContent = '»';
    dockChevron.title = 'Collapse panel';
    dockChevron.style.cssText = 'cursor:pointer;font-weight:400;color:#9fb0c3;font-size:16px;line-height:1;'
      + 'padding:2px 6px;border-radius:4px;user-select:none';
    headerRight.appendChild(dockChevron);
  }
  title.append(titleLabel, headerRight);
  panel.appendChild(title);

  let collapsed = new Set<string>();
  const loadCollapse = (): void => {
    try { collapsed = new Set(JSON.parse(localStorage.getItem(activeSchema.collapseKey) ?? '[]') as string[]); }
    catch { collapsed = new Set(); }
  };
  loadCollapse();
  const persistCollapse = (): void => {
    try { localStorage.setItem(activeSchema.collapseKey, JSON.stringify([...collapsed])); } catch { /* ignore */ }
  };

  // Body scrolls; header/footer stay docked (flex-none).
  const body = document.createElement('div');
  body.style.cssText = 'flex:1 1 auto;overflow-y:auto;overflow-x:hidden;padding:0 12px 4px;min-height:0';
  panel.appendChild(body);
  const footer = document.createElement('div');
  footer.style.cssText = 'flex:0 0 auto';
  panel.appendChild(footer);

  const syncers: Array<() => void> = [];

  const fmt = (c: SliderCtrl, v: number): string => {
    const shown = c.scale ? v / c.scale : v;
    // Show the value at its real precision (trim trailing zeros) so sub-step
    // manual entries like 0.005 read as themselves, not rounded to 0.01.
    const s = Number.isInteger(shown) ? String(shown) : parseFloat(shown.toFixed(4)).toString();
    return `${s}${c.unit ?? ''}`;
  };

  const changed = (): void => { activeSchema.onChange?.(); };

  const addSlider = (host: HTMLElement, c: SliderCtrl): void => {
    const row = document.createElement('div');
    row.style.cssText = 'margin-top:6px;display:flex;justify-content:space-between';
    const name = document.createElement('span'); name.textContent = c.label;
    const val = document.createElement('span');
    val.style.cssText = 'opacity:0.8;cursor:text;border-bottom:1px dotted transparent';
    val.title = 'Click to type an exact value';
    val.addEventListener('mouseenter', () => { val.style.borderBottomColor = '#5a6a7c'; });
    val.addEventListener('mouseleave', () => { val.style.borderBottomColor = 'transparent'; });
    row.append(name, val);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(c.min); input.max = String(c.max); input.step = String(c.step);
    input.style.cssText = 'width:100%;accent-color:#6aa3ff';
    const sync = (): void => { const v = c.get(); input.value = String(v); val.textContent = fmt(c, v); };
    sync();
    input.addEventListener('input', () => { c.set(+input.value); val.textContent = fmt(c, +input.value); changed(); });
    if (c.commit) input.addEventListener('change', () => { c.commit!(); });

    // Click the value to type an EXACT number — allows finer-than-step precision
    // (e.g. 0.005 on a 0.01-step control). Enter/blur commits, Escape cancels.
    val.addEventListener('click', () => {
      const edit = document.createElement('input');
      edit.type = 'text'; edit.inputMode = 'decimal';
      edit.value = String(c.scale ? c.get() / c.scale : c.get());
      edit.style.cssText = 'width:60px;text-align:right;background:#1c2530;color:#eaf0f7;'
        + 'border:1px solid #5a86b8;border-radius:3px;font:inherit;padding:0 3px';
      val.replaceWith(edit); edit.focus(); edit.select();
      let done = false;
      const restore = (commit: boolean): void => {
        if (done) return; done = true;
        if (commit) {
          let n = parseFloat(edit.value);
          if (Number.isFinite(n)) {
            if (c.scale) n *= c.scale;
            n = Math.min(c.max, Math.max(c.min, n));
            c.set(n); input.value = String(n); changed(); c.commit?.();
          }
        }
        val.textContent = fmt(c, c.get());
        edit.replaceWith(val);
      };
      edit.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); restore(true); }
        else if (e.key === 'Escape') { e.preventDefault(); restore(false); }
      });
      edit.addEventListener('blur', () => restore(true));
    });

    host.append(row, input);
    syncers.push(sync);
  };

  const addPicker = (host: HTMLElement, c: PickerCtrl): void => {
    if (c.label) {
      const l = document.createElement('div');
      l.style.cssText = 'margin-top:6px;color:#9fb0c3;font-size:11px';
      l.textContent = c.label;
      host.appendChild(l);
    }
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:5px;display:flex;flex-wrap:wrap;gap:4px';
    const btns: Array<{ b: HTMLButtonElement; v: string }> = [];
    const paint = (): void => {
      const cur = c.get();
      for (const { b, v } of btns) {
        const on = v === cur;
        b.style.background = on ? '#26405c' : '#1c2530';
        b.style.borderColor = on ? '#5a86b8' : '#34404e';
        b.style.color = on ? '#eaf0f7' : '#cfd8e3';
      }
    };
    for (const o of c.options) {
      const b = document.createElement('button');
      b.textContent = o.icon ? `${o.icon} ${o.label}` : o.label;
      b.style.cssText = 'flex:1 1 auto;padding:5px 6px;border:1px solid #34404e;border-radius:5px;'
        + 'background:#1c2530;color:#cfd8e3;font:inherit;font-size:10.5px;cursor:pointer;white-space:nowrap';
      b.addEventListener('click', () => { c.set(o.value); paint(); changed(); });
      wrap.appendChild(b); btns.push({ b, v: o.value });
    }
    paint();
    host.appendChild(wrap);
    syncers.push(paint);
  };

  const addInfo = (host: HTMLElement, c: InfoCtrl): void => {
    const row = document.createElement('div');
    row.style.cssText = 'margin-top:6px;display:flex;justify-content:space-between;align-items:center';
    const name = document.createElement('span'); name.textContent = c.label;
    const val = document.createElement('span');
    val.style.cssText = 'color:#eaf0f7;font-weight:600;letter-spacing:0.04em';
    const sync = (): void => { val.textContent = c.get(); };
    sync();
    row.append(name, val); host.appendChild(row);
    syncers.push(sync);
  };

  const addToggle = (host: HTMLElement, c: ToggleCtrl): void => {
    const row = document.createElement('label');
    row.style.cssText = 'margin-top:6px;display:flex;justify-content:space-between;align-items:center;cursor:pointer';
    const name = document.createElement('span'); name.textContent = c.label;
    const box = document.createElement('input');
    box.type = 'checkbox'; box.style.cssText = 'accent-color:#6aa3ff;width:14px;height:14px;margin:0';
    const sync = (): void => { box.checked = c.get(); };
    sync();
    box.addEventListener('change', () => { c.set(box.checked); changed(); });
    row.append(name, box); host.appendChild(row);
    syncers.push(sync);
  };

  const addSelect = (host: HTMLElement, c: SelectCtrl): void => {
    const row = document.createElement('div');
    row.style.cssText = 'margin-top:6px;display:flex;justify-content:space-between;align-items:center;gap:8px';
    const name = document.createElement('span'); name.textContent = c.label;
    const sel = document.createElement('select');
    sel.style.cssText = 'flex:1;min-width:0;background:#1c2530;color:#cfd8e3;border:1px solid #34404e;'
      + 'border-radius:4px;padding:3px 4px;font:inherit;font-size:11px;cursor:pointer';
    for (const o of c.options) {
      const opt = document.createElement('option'); opt.value = o; opt.textContent = o; sel.appendChild(opt);
    }
    const sync = (): void => { sel.value = c.get(); };
    sync();
    sel.addEventListener('change', () => { c.set(sel.value); changed(); });
    row.append(name, sel); host.appendChild(row);
    syncers.push(sync);
  };

  const addColor = (host: HTMLElement, c: ColorCtrl): void => {
    const row = document.createElement('label');
    row.style.cssText = 'margin-top:6px;display:flex;justify-content:space-between;align-items:center;cursor:pointer';
    const name = document.createElement('span'); name.textContent = c.label;
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.style.cssText = 'width:34px;height:18px;padding:0;border:1px solid #34404e;border-radius:4px;background:none;cursor:pointer';
    const sync = (): void => { inp.value = linToHex(c.get()); };
    sync();
    inp.addEventListener('input', () => { c.set(hexToLin(inp.value)); changed(); });
    row.append(name, inp); host.appendChild(row);
    syncers.push(sync);
  };

  const sectionKeys: string[] = [];
  const updateCollapseAllGlyph = (): void => {
    const allClosed = sectionKeys.length > 0 && sectionKeys.every((k) => collapsed.has(k));
    collapseAll.textContent = allClosed ? '⊞' : '⊟';
  };

  const renderSections = (): void => {
    body.innerHTML = '';
    syncers.length = 0;
    sectionKeys.length = 0;
    const sections = typeof activeSchema.sections === 'function' ? activeSchema.sections() : activeSchema.sections;
    for (const sec of sections) {
      sectionKeys.push(sec.key);
      const header = document.createElement('div');
      header.style.cssText = 'margin-top:9px;padding-top:6px;border-top:1px solid #222b36;cursor:pointer;'
        + 'display:flex;justify-content:space-between;color:#9fb0c3;font-size:11px;letter-spacing:0.06em';
      const secBody = document.createElement('div');
      const caret = document.createElement('span');
      const label = document.createElement('span'); label.textContent = sec.title.toUpperCase();
      header.append(label, caret);
      const setOpen = (open: boolean): void => { secBody.style.display = open ? '' : 'none'; caret.textContent = open ? '▾' : '▸'; };
      setOpen(!collapsed.has(sec.key));
      header.addEventListener('click', () => {
        const open = secBody.style.display === 'none';
        setOpen(open);
        if (open) collapsed.delete(sec.key); else collapsed.add(sec.key);
        persistCollapse();
        updateCollapseAllGlyph();
      });
      body.append(header, secBody);
      for (const c of sec.ctrls) {
        if ('kind' in c && c.kind === 'toggle') addToggle(secBody, c);
        else if ('kind' in c && c.kind === 'select') addSelect(secBody, c);
        else if ('kind' in c && c.kind === 'color') addColor(secBody, c);
        else if ('kind' in c && c.kind === 'info') addInfo(secBody, c);
        else if ('kind' in c && c.kind === 'picker') addPicker(secBody, c);
        else addSlider(secBody, c as SliderCtrl);
      }
    }
    updateCollapseAllGlyph();
  };

  // Collapse-all toggle: if anything is open, close everything; else open all.
  collapseAll.addEventListener('click', () => {
    const anyOpen = sectionKeys.some((k) => !collapsed.has(k));
    if (anyOpen) sectionKeys.forEach((k) => collapsed.add(k));
    else collapsed.clear();
    persistCollapse();
    renderSections();
  });

  const renderFooter = (): void => {
    footer.innerHTML = '';
    if (!activeSchema.actions?.length) { footer.style.cssText = 'flex:0 0 auto'; return; }
    // Docked at the bottom of the flyout — its own opaque strip so buttons stay
    // reachable while the body scrolls.
    footer.style.cssText = 'flex:0 0 auto;border-top:1px solid #2a3340;padding:8px 12px;'
      + 'background:rgba(12,15,20,0.98);border-radius:0 0 8px 8px;display:flex;flex-wrap:wrap;gap:5px';
    for (const a of activeSchema.actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      b.style.cssText = `flex:${a.minor ? '1 1 100%' : '1'};padding:6px 2px;background:#1c2530;color:#cfd8e3;`
        + `border:1px solid #34404e;border-radius:5px;cursor:pointer;font:inherit;font-size:${a.minor ? '10' : '11'}px`;
      b.addEventListener('click', () => {
        const r = a.onClick();
        const flash = (text: string): void => {
          const orig = b.textContent; b.textContent = text;
          setTimeout(() => { b.textContent = orig; }, 1100);
        };
        if (r instanceof Promise) void r.then((t) => { if (t) flash(t); });
        else if (typeof r === 'string') flash(r);
      });
      footer.appendChild(b);
    }
  };

  renderSections();
  renderFooter();
  document.body.appendChild(panel);

  let btn: HTMLButtonElement | null = null;  // flyout toggle
  let tab: HTMLDivElement | null = null;     // dock re-open handle
  let dockOpen = true;

  // Dock collapse: slide the panel off the right edge and drop --lab-dock-w to 0
  // so the HUD reflows back; a thin tab at the edge re-opens it.
  function setDockOpen(open: boolean): void {
    dockOpen = open;
    panel.style.transform = open ? 'translateX(0)' : 'translateX(100%)';
    document.documentElement.style.setProperty('--lab-dock-w', open ? `${dockW}px` : '0px');
    if (tab) tab.style.display = open ? 'none' : 'flex';
    if (opts.dock?.storeKey) { try { localStorage.setItem(opts.dock.storeKey, open ? '1' : '0'); } catch { /* ignore */ } }
  }
  function setOpen(open: boolean): void {
    if (opts.dock) { setDockOpen(open); return; }
    panel.style.display = open ? 'flex' : 'none';
  }

  if (opts.dock) {
    // Re-open handle: a prominent labelled tab on the right edge, shown only when
    // the panel is collapsed. Reads as "« LAB" so it's obviously the way back.
    tab = document.createElement('div');
    tab.className = 'gen-lab-tab';
    tab.title = 'Open lab panel';
    tab.innerHTML = '<span style="font-size:16px;line-height:1">«</span>'
      + '<span style="writing-mode:vertical-rl;text-orientation:upright;letter-spacing:1px;'
      + 'font-size:10px;font-weight:600">LAB</span>';
    tab.style.cssText = [
      'position:fixed', 'right:0', 'top:50%', 'transform:translateY(-50%)', 'z-index:10000',
      'display:none', 'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:8px',
      'width:30px', 'padding:16px 0', 'cursor:pointer',
      'background:rgba(20,40,64,0.96)', 'color:#cfe0ff',
      'border:1px solid rgba(120,170,255,0.55)', 'border-right:none', 'border-radius:9px 0 0 9px',
      'font-family:ui-monospace,Menlo,monospace', 'box-shadow:-5px 0 22px rgba(0,0,0,0.55)',
      'transition:background 0.15s ease',
    ].join(';');
    tab.addEventListener('mouseenter', () => { tab!.style.background = 'rgba(30,56,86,0.98)'; });
    tab.addEventListener('mouseleave', () => { tab!.style.background = 'rgba(20,40,64,0.96)'; });
    tab.addEventListener('click', () => setDockOpen(true));
    document.body.appendChild(tab);
    dockChevron?.addEventListener('click', () => setDockOpen(false));

    let initOpen = opts.dock.open ?? true;
    if (opts.dock.storeKey) { try { const v = localStorage.getItem(opts.dock.storeKey); if (v !== null) initOpen = v === '1'; } catch { /* ignore */ } }
    panel.style.transition = 'none';           // no slide on first paint
    setDockOpen(initOpen);
    requestAnimationFrame(() => { panel.style.transition = 'transform 0.18s ease'; });
  } else if (opts.toggle) {
    // ── Flyout toggle button (the single LAB button) ──
    panel.style.display = 'none';
    btn = document.createElement('button');
    btn.className = 'gen-lab-toggle';
    btn.textContent = opts.toggle.label;
    if (opts.toggle.title) btn.title = opts.toggle.title;
    btn.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:9999',
      'font:11px/1 ui-monospace,Menlo,monospace', 'letter-spacing:1px', 'padding:7px 12px',
      'cursor:pointer', 'background:rgba(8,10,18,0.9)', 'color:#aab8e8',
      'border:1px solid rgba(120,150,220,0.4)', 'border-radius:6px',
      'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
    ].join(';');
    btn.addEventListener('click', () => setOpen(panel.style.display === 'none'));
    document.body.appendChild(btn);
  }

  const sync = (): void => { for (const s of syncers) s(); };
  return {
    el: panel,
    refresh: () => { renderSections(); renderFooter(); },
    sync,
    setContext: (next: LabSchema) => {
      activeSchema = next;
      titleLabel.textContent = next.title;
      loadCollapse();          // per-context collapse state
      renderSections();
      renderFooter();
    },
    setOpen,
    isOpen: () => (opts.dock ? dockOpen : panel.style.display !== 'none'),
    destroy: () => {
      panel.remove(); btn?.remove(); tab?.remove();
      if (opts.dock) document.documentElement.style.setProperty('--lab-dock-w', '0px');
    },
  };
}
