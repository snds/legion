// ═══════════════════════════════════════════════════════════════════
// NOTIFICATIONS — Toast + Log Notification System
// Full rewrite matching the monolithic prototype's Notifications IIFE.
//
// Features:
// - Toast stack with progress bar timers (8s default)
// - Freeze/unfreeze timers on game pause
// - Investigate button with callback
// - Persistent log with read/unread state
// - Grouped log panel (by title) with expand/collapse
// - Badge count on dock alert icon
// - Category icons per notification title
// ═══════════════════════════════════════════════════════════════════

import { Events } from '../core/events';
import { Game } from '../core/state';
import { PanelManager } from './panel-manager';
import { registerPanel } from './dock';

// ── Configuration ────────────────────────────────────────────────

const MAX_TOAST = 3;
const TOAST_LIFE = 8000; // ms

// ── Category Icons ───────────────────────────────────────────────

const ICONS: Record<string, string> = {
  'Research Complete': '◇',
  'Anomaly Detected': '△',
  'Fleet Arrival': '→',
  'Hostile Contact': '✕',
  'Trade Route Active': '╍',
  'Bob Drift': '↗',
  'Resource Milestone': '■',
  'Replication Ready': '◎',
  'Transit Complete': '◉',
  'Transit Begun': '⟶',
  'Camera': '◎',
  'Overlay': '◇',
};

// ── Types ────────────────────────────────────────────────────────

interface LogEntry {
  id: number;
  title: string;
  desc: string;
  time: Date;
  gameTime: number;
  onInvestigate?: (() => void) | null;
  read: boolean;
}

interface ActiveToast {
  id: number;
  el: HTMLElement;
  start: number;         // performance.now() at creation
  frozen: boolean;
  frozenAt: number;
  frozenTotal: number;   // accumulated frozen time
  interval: ReturnType<typeof setInterval>;
}

// ── State ────────────────────────────────────────────────────────

let container: HTMLElement | null = null;
let badge: HTMLElement | null = null;
const log: LogEntry[] = [];
let toasts: ActiveToast[] = [];

// ── Badge ────────────────────────────────────────────────────────

function updateBadge(): void {
  if (!badge) return;
  const unread = log.filter(n => !n.read).length;
  badge.textContent = unread > 0 ? String(unread) : '';
  badge.dataset.count = String(unread);
}

// ── Toast Lifecycle ──────────────────────────────────────────────

function dismissToast(id: number): void {
  const i = toasts.findIndex(t => t.id === id);
  if (i === -1) return;
  const toast = toasts[i];
  clearInterval(toast.interval);
  toast.el.classList.add('collapsing');
  setTimeout(() => toast.el.remove(), 250);
  toasts.splice(i, 1);
}

function showToast(entry: LogEntry): void {
  if (!container) return;

  // Enforce max visible — dismiss oldest
  if (toasts.length >= MAX_TOAST) {
    dismissToast(toasts[toasts.length - 1].id);
  }

  const el = document.createElement('div');
  el.className = 'notif-toast';
  el.dataset.id = String(entry.id);

  const timeStr = entry.time.toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  el.innerHTML =
    `<button class="notif-dismiss" data-dismiss="${entry.id}">✕</button>`
    + `<div class="notif-title">${entry.title}</div>`
    + `<div class="notif-desc">${entry.desc}</div>`
    + `<div class="notif-meta">${timeStr}</div>`
    + `<div class="notif-actions">`
    +   `<button class="notif-btn primary" data-investigate="${entry.id}">INVESTIGATE</button>`
    + `</div>`
    + `<div class="notif-timer" style="width:100%"></div>`;

  container.prepend(el);

  // Timer state
  const toast: ActiveToast = {
    id: entry.id,
    el,
    start: performance.now(),
    frozen: Game.data.paused,
    frozenAt: Game.data.paused ? performance.now() : 0,
    frozenTotal: 0,
    interval: setInterval(() => {
      if (toast.frozen) return;
      const elapsed = performance.now() - toast.start - toast.frozenTotal;
      const pct = Math.max(0, 100 - (elapsed / TOAST_LIFE) * 100);
      const timerBar = el.querySelector<HTMLElement>('.notif-timer');
      if (timerBar) timerBar.style.width = pct + '%';
      if (pct <= 0) dismissToast(entry.id);
    }, 50),
  };

  toasts.unshift(toast);

  // Dismiss button
  const dismissBtn = el.querySelector<HTMLElement>('[data-dismiss]');
  if (dismissBtn) {
    dismissBtn.onclick = () => dismissToast(entry.id);
  }

  // Investigate button
  const invBtn = el.querySelector<HTMLElement>('[data-investigate]');
  if (invBtn) {
    invBtn.onclick = () => {
      entry.read = true;
      updateBadge();
      dismissToast(entry.id);
      if (entry.onInvestigate) entry.onInvestigate();
    };
  }
}

// ── Log Panel ────────────────────────────────────────────────────
// Rendered inside PanelManager when the Alerts dock icon is clicked.

function renderLogPanel(area: HTMLElement): void {
  // Group by title
  const groups: Record<string, LogEntry[]> = {};
  log.forEach(n => {
    if (!groups[n.title]) groups[n.title] = [];
    groups[n.title].push(n);
  });
  const titles = Object.keys(groups);
  const unreadCount = log.filter(n => !n.read).length;

  let h = `<div class="panel-header">`
    + `<div class="panel-title">ALERTS</div>`
    + `<div class="panel-subtitle">${log.length} EVENTS · ${unreadCount} UNREAD</div>`
    + `<div class="panel-top-actions">`
    +   `<button class="panel-action-btn" id="nlog-markall">MARK READ</button>`
    +   `<button class="panel-action-btn" id="nlog-clearall">CLEAR</button>`
    + `</div>`
    + `<button class="panel-close">✕</button>`
    + `</div><div class="panel-body">`;

  if (log.length === 0) {
    h += `<div style="color:var(--ui-text-muted);padding:20px;text-align:center;`
      + `text-transform:uppercase;letter-spacing:1px;font-size:10px">NO ALERTS</div>`;
  } else {
    titles.forEach(title => {
      const items = groups[title];
      const icon = ICONS[title] || '·';
      h += `<div class="nlog-stack expanded">`
        + `<div class="nlog-stack-header">`
        +   `<span class="nlog-stack-icon">${icon}</span>`
        +   `<span class="nlog-stack-title">${title}</span>`
        +   `<span class="nlog-stack-count">${items.length}</span>`
        + `</div><div class="nlog-stack-body">`;

      items.forEach(n => {
        const timeStr = n.time.toLocaleTimeString([], {
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        h += `<div class="nlog-item${n.read ? ' read' : ''}" data-nid="${n.id}">`
          + `<span class="${n.read ? 'nlog-read' : 'nlog-unread'}"></span>`
          + `<div class="nlog-item-body">`
          +   `<div class="nlog-item-title">${n.desc}</div>`
          +   `<div class="nlog-item-time">${timeStr}</div>`
          + `</div></div>`;
      });

      h += `</div></div>`;
    });
  }

  h += `</div>`;
  area.innerHTML = h;

  // Wire close
  const closeBtn = area.querySelector<HTMLElement>('.panel-close');
  if (closeBtn) closeBtn.onclick = () => PanelManager.close();

  // Wire actions
  const markBtn = area.querySelector<HTMLElement>('#nlog-markall');
  if (markBtn) markBtn.onclick = () => { markAllRead(); renderLogPanel(area); };

  const clearBtn = area.querySelector<HTMLElement>('#nlog-clearall');
  if (clearBtn) clearBtn.onclick = () => { clearAllLog(); renderLogPanel(area); };

  // Wire stack expand/collapse
  area.querySelectorAll<HTMLElement>('.nlog-stack-header').forEach(el => {
    el.onclick = () => el.parentElement?.classList.toggle('expanded');
  });
}

function markAllRead(): void {
  log.forEach(n => { n.read = true; });
  updateBadge();
}

function clearAllLog(): void {
  log.length = 0;
  updateBadge();
}

// ── Public API ───────────────────────────────────────────────────

export const Notifications = {
  /**
   * Initialize. Call once after DOM ready.
   */
  init(): void {
    container = document.getElementById('notif-stack');
    badge = document.getElementById('notif-badge');

    // Register with dock so N key / dock icon opens log panel
    registerPanel('notifications', renderLogPanel);

    // Subscribe to event bus notifications
    Events.on('ui:notification', ({ title, desc, color, duration }) => {
      Notifications.push(
        title as string,
        desc as string,
        (undefined as unknown) as (() => void) | undefined,
      );
    });

    // Subscribe to pause/unpause for timer freeze
    Events.on('ui:time-speed-changed', ({ index }) => {
      if ((index as number) === 0) {
        Notifications.freezeTimers();
      } else {
        Notifications.unfreezeTimers();
      }
    });
  },

  /**
   * Push a new notification.
   */
  push(title: string, desc: string, onInvestigate?: (() => void) | null): void {
    const entry: LogEntry = {
      id: Date.now() + Math.random(),
      title,
      desc,
      time: new Date(),
      gameTime: Game.data.gameTime,
      onInvestigate: onInvestigate ?? null,
      read: false,
    };
    log.unshift(entry);
    updateBadge();
    showToast(entry);
  },

  /**
   * Freeze all active toast timers (on game pause).
   */
  freezeTimers(): void {
    toasts.forEach(t => {
      if (!t.frozen) {
        t.frozen = true;
        t.frozenAt = performance.now();
      }
    });
  },

  /**
   * Unfreeze all active toast timers (on game unpause).
   */
  unfreezeTimers(): void {
    const now = performance.now();
    toasts.forEach(t => {
      if (t.frozen) {
        t.frozenTotal += (now - t.frozenAt);
        t.frozen = false;
      }
    });
  },

  /** Open the log panel directly. */
  openLogPanel(): void {
    PanelManager.open('notifications', renderLogPanel);
  },

  /** Mark all log entries as read. */
  markAllRead,

  /** Clear the entire log. */
  clearAll: clearAllLog,

  /** Update the dock badge count. */
  updateBadge,

  /** Access the log array (read-only intent). */
  get log(): readonly LogEntry[] {
    return log;
  },
};
