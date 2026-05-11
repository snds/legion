// ═══════════════════════════════════════════════════════════════════
// PANEL MANAGER — Dock-Driven Panel System
// Manages the left panel area: open/close/toggle with stack
// navigation, dock icon active-state sync, and anchor modes.
//
// Matches the monolithic prototype's PanelManager pattern:
// - Opening a new panel pushes the current one onto a stack
// - Closing pops the stack (restoring the previous panel)
// - closeAll() clears everything
// - Dock icons auto-sync their .active class
// ═══════════════════════════════════════════════════════════════════

export type PanelRenderFn = (container: HTMLElement) => void;

interface StackEntry {
  id: string;
  html: string;
  anchor: 'center' | 'bottom';
}

// ── Panel Manager Singleton ──────────────────────────────────────

class PanelManagerImpl {
  private area: HTMLElement | null = null;
  private stack: StackEntry[] = [];
  private activeId: string | null = null;
  private activeAnchor: 'center' | 'bottom' = 'center';

  /**
   * Bind to the #panel-area element. Call once after DOM ready.
   */
  init(): void {
    this.area = document.getElementById('panel-area');
  }

  /**
   * Open a panel by id. If another panel is already open,
   * push it onto the stack so close() can restore it.
   */
  open(id: string, renderFn: PanelRenderFn, opts: { anchor?: 'center' | 'bottom' } = {}): void {
    if (!this.area) return;
    if (this.activeId === id) return;

    // Push current panel onto stack
    if (this.activeId) {
      this.stack.push({
        id: this.activeId,
        html: this.area.innerHTML,
        anchor: this.activeAnchor,
      });
    }

    this.activeId = id;
    this.activeAnchor = opts.anchor || 'center';
    this.area.classList.toggle('anchor-bottom', this.activeAnchor === 'bottom');
    this.area.innerHTML = '';
    renderFn(this.area);
    this.area.classList.add('open');
    this.syncDock();
  }

  /**
   * Close the current panel. If there's a stacked panel,
   * restore it; otherwise clear everything.
   */
  close(): void {
    if (!this.area) return;

    if (this.stack.length > 0) {
      const prev = this.stack.pop()!;
      this.activeId = prev.id;
      this.activeAnchor = prev.anchor;
      this.area.classList.toggle('anchor-bottom', this.activeAnchor === 'bottom');
      this.area.innerHTML = prev.html;
      this.area.classList.add('open');
      this.rebind();
    } else {
      this.activeId = null;
      this.area.classList.remove('open');
      this.area.innerHTML = '';
    }
    this.syncDock();
  }

  /**
   * Close all panels and clear the stack.
   */
  closeAll(): void {
    if (!this.area) return;
    this.stack.length = 0;
    this.activeId = null;
    this.area.classList.remove('open');
    this.area.innerHTML = '';
    this.syncDock();
  }

  /**
   * Toggle a panel: close if it's already open, open otherwise.
   */
  toggle(id: string, renderFn: PanelRenderFn, opts?: { anchor?: 'center' | 'bottom' }): void {
    if (this.activeId === id) {
      this.close();
    } else {
      this.open(id, renderFn, opts);
    }
  }

  /**
   * Check if a specific panel is currently active.
   */
  isOpen(id: string): boolean {
    return this.activeId === id;
  }

  /**
   * Get the currently active panel id (or null).
   */
  getActiveId(): string | null {
    return this.activeId;
  }

  // ── Private Helpers ──

  /**
   * Sync dock icon .active class to match the currently open panel.
   */
  private syncDock(): void {
    document.querySelectorAll<HTMLElement>('.dock-icon[data-panel]').forEach((el) => {
      el.classList.toggle('active', el.dataset.panel === this.activeId);
    });
  }

  /**
   * Rebind the close button after restoring a stacked panel's HTML.
   * The original event listeners are lost when HTML is serialized,
   * so we reattach the close button handler.
   */
  private rebind(): void {
    if (!this.area) return;
    const closeBtn = this.area.querySelector<HTMLElement>('.panel-close');
    if (closeBtn) {
      closeBtn.onclick = () => this.close();
    }
  }
}

// ── Singleton Export ──────────────────────────────────────────────

export const PanelManager = new PanelManagerImpl();
