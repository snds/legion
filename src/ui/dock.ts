// ═══════════════════════════════════════════════════════════════════
// DOCK — Wires dock icon clicks and keyboard shortcuts to panels.
// Panel render functions are registered here; actual panel content
// is implemented in dedicated modules (chunks 7–9).
//
// Placeholder renders are used until real panel modules exist.
// Each panel module will call Dock.registerPanel() to replace them.
// ═══════════════════════════════════════════════════════════════════

import { PanelManager, type PanelRenderFn } from './panel-manager';
import { Events } from '../core/events';

// ── Panel Registry ───────────────────────────────────────────────
// Maps panel id → { render, opts }. Panels register themselves
// so the dock doesn't need to import every panel module.

interface PanelEntry {
  render: PanelRenderFn;
  opts?: { anchor?: 'center' | 'bottom' };
}

const registry = new Map<string, PanelEntry>();

/**
 * Register a panel render function. Called by panel modules
 * during their init phase.
 */
export function registerPanel(
  id: string,
  render: PanelRenderFn,
  opts?: { anchor?: 'center' | 'bottom' },
): void {
  registry.set(id, { render, opts });
}

// ── Placeholder Renderers ────────────────────────────────────────
// Used until real panel modules register themselves.

function placeholder(id: string, label: string): PanelRenderFn {
  return (area: HTMLElement) => {
    area.innerHTML = `
      <div class="panel-header">
        <div class="panel-title">${label}</div>
        <div class="panel-subtitle">COMING SOON</div>
        <button class="panel-close">✕</button>
      </div>
      <div class="panel-body" style="padding:20px;color:var(--ui-text-muted);font-size:10px;text-transform:uppercase;letter-spacing:1px;text-align:center;">
        ${label} panel — not yet implemented
      </div>`;
    const closeBtn = area.querySelector('.panel-close');
    if (closeBtn) (closeBtn as HTMLElement).onclick = () => PanelManager.close();
  };
}

// ── Toggle Helper ────────────────────────────────────────────────

function togglePanel(id: string): void {
  const entry = registry.get(id);
  if (!entry) return;
  PanelManager.toggle(id, entry.render, entry.opts);
}

// ── Initialize ───────────────────────────────────────────────────
// Call once after DOM ready. Registers default placeholders,
// wires dock icon clicks, and binds keyboard shortcuts.

export function initDock(): void {
  // Register placeholders (real modules will overwrite these)
  if (!registry.has('detail'))        registerPanel('detail', placeholder('detail', 'DETAIL'));
  if (!registry.has('roster'))        registerPanel('roster', placeholder('roster', 'ROSTER'));
  if (!registry.has('notifications')) registerPanel('notifications', placeholder('notifications', 'ALERTS'));
  if (!registry.has('settings'))      registerPanel('settings', placeholder('settings', 'SETTINGS'), { anchor: 'bottom' });

  // ── Dock Icon Clicks ──
  document.querySelectorAll<HTMLElement>('.dock-icon[data-panel]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.panel;
      if (!id) return;
      togglePanel(id);
    });
  });

  // ── Keyboard Shortcuts ──
  window.addEventListener('keydown', (e) => {
    // Skip if typing in an input
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    switch (e.code) {
      case 'KeyI':
        togglePanel('detail');
        break;
      case 'KeyB':
        togglePanel('roster');
        break;
      case 'KeyN':
        togglePanel('notifications');
        break;
      case 'Comma':
        togglePanel('settings');
        break;
      case 'Escape':
        PanelManager.closeAll();
        break;
    }
  });
}
