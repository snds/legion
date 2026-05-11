// ═══════════════════════════════════════════════════════════════════
// ROSTER PANEL — Bob Network Management
// Matches the monolithic RosterPanel IIFE. Lists all bobs grouped
// by system, with selection, status display, and destination mode.
// ═══════════════════════════════════════════════════════════════════

import { PanelManager } from '../panel-manager';
import { registerPanel } from '../dock';
import { Game } from '../../core/state';
import { Notifications } from '../notifications';

// ── Mock Bob Data ────────────────────────────────────────────────
// Matches the monolithic ALL_BOBS for visual parity.
// Will be replaced by ECS queries in production.

interface BobEntry {
  name: string;
  callsign: string;
  color: number;
  generation: number;
  focus: string;
  health: number;
  system: string | null;
  currentAction: string;
  transit: { from: string; to: string; progress: number } | null;
}

const ALL_BOBS: BobEntry[] = [
  { name: 'Bob-1', callsign: 'Original',  color: 0x6090cc, generation: 0, focus: 'Sentinel',   health: 94, system: 'Epsilon Eridani', currentAction: 'Patrolling inner system', transit: null },
  { name: 'Bob-2', callsign: 'Riker',     color: 0xcc8044, generation: 1, focus: 'Industrial',  health: 88, system: 'Epsilon Eridani', currentAction: 'Optimizing Kindling refinery', transit: null },
  { name: 'Bob-3', callsign: 'Homer',     color: 0x44aa70, generation: 1, focus: 'Explorer',    health: 91, system: 'Epsilon Eridani', currentAction: 'Surveying debris disk', transit: null },
  { name: 'Bob-4', callsign: 'Icarus',    color: 0x8866aa, generation: 2, focus: 'Research',    health: 86, system: 'Epsilon Eridani', currentAction: 'Propulsion sims near Aegir', transit: null },
  { name: 'Bob-5', callsign: 'Milo',      color: 0x60bb90, generation: 1, focus: 'Explorer',    health: 92, system: 'Sol',             currentAction: 'Monitoring Sol system', transit: null },
  { name: 'Bob-6', callsign: 'Khan',      color: 0xcc4444, generation: 2, focus: 'Sentinel',    health: 78, system: 'Proxima Centauri', currentAction: 'Flare monitoring', transit: null },
  { name: 'Bob-7', callsign: 'Linus',     color: 0x44aacc, generation: 2, focus: 'Research',    health: 95, system: 'Tau Ceti',         currentAction: 'Cataloging debris disk', transit: null },
  { name: 'Bob-8', callsign: 'Verne',     color: 0x8888cc, generation: 3, focus: 'Explorer',    health: 89, system: 'Ross 128',         currentAction: 'First survey in progress', transit: null },
  { name: 'Bob-9', callsign: 'Magellan',  color: 0xddaa44, generation: 3, focus: 'Explorer',    health: 90, system: null,               currentAction: 'In transit to TRAPPIST-1', transit: { from: 'Epsilon Eridani', to: 'TRAPPIST-1', progress: 0.35 } },
];

// ── State ────────────────────────────────────────────────────────

let selectedBobIdx = -1;

// ── Destination Mode (simplified for UI parity) ─────────────────

function enterDestMode(bobIdx: number): void {
  Game.data.destMode = true;
  Game.data.destBobIdx = bobIdx;
  const indicator = document.getElementById('dest-mode-indicator');
  if (indicator) indicator.classList.add('active');
  const label = document.getElementById('dest-label');
  if (label) label.textContent = `SELECT DESTINATION FOR ${ALL_BOBS[bobIdx].name}`;
}

function exitDestMode(): void {
  Game.data.destMode = false;
  Game.data.destBobIdx = -1;
  const indicator = document.getElementById('dest-mode-indicator');
  if (indicator) indicator.classList.remove('active');
}

// ── Render ───────────────────────────────────────────────────────

function render(area: HTMLElement): void {
  // Group bobs by system
  const bySys: Record<string, (BobEntry & { globalIdx: number })[]> = {};
  ALL_BOBS.forEach((b, i) => {
    const key = b.system || 'In Transit';
    if (!bySys[key]) bySys[key] = [];
    bySys[key].push({ ...b, globalIdx: i });
  });

  const uniqueSystems = new Set(ALL_BOBS.filter(b => b.system).map(b => b.system));

  let h = `<div class="panel-header">`
    + `<div class="panel-title">BOB NETWORK</div>`
    + `<div class="panel-subtitle">${ALL_BOBS.length} UNITS · ${uniqueSystems.size} SYSTEMS</div>`
    + `<button class="panel-close">✕</button>`
    + `</div><div class="panel-body">`;

  Object.entries(bySys).forEach(([sys, bobs]) => {
    h += `<div class="roster-section"><div class="roster-section-title">${sys}</div>`;

    bobs.forEach(b => {
      const fc = b.focus.toLowerCase();
      const col = '#' + b.color.toString(16).padStart(6, '0');
      const isSelected = b.globalIdx === selectedBobIdx;
      const inTransit = !!b.transit;

      h += `<div class="roster-item${isSelected ? ' selected' : ''}" data-bidx="${b.globalIdx}">`;
      h += `<div class="roster-dot" style="background:${col}"></div>`;
      h += `<div class="roster-info">`;
      h += `<div class="roster-name">${b.name} "${b.callsign}"</div>`;
      h += `<div class="roster-meta">${b.currentAction}</div>`;
      if (isSelected) {
        h += `<div class="roster-coords">SYS: ${b.system || '—'} · HP: ${b.health}%</div>`;
      }
      h += `</div>`;
      h += `<span class="roster-status ${fc}">${b.focus}</span>`;

      if (!inTransit) {
        const isActive = Game.data.destMode && Game.data.destBobIdx === b.globalIdx;
        h += `<button class="roster-send${isActive ? ' active' : ''}" data-send="${b.globalIdx}">SEND</button>`;
      } else {
        h += `<span style="font-size:8px;color:var(--ui-warning)">${Math.round(b.transit!.progress * 100)}%</span>`;
      }

      h += `</div>`;
    });

    h += `</div>`;
  });

  h += `</div>`;
  area.innerHTML = h;

  // Wire close
  const closeBtn = area.querySelector<HTMLElement>('.panel-close');
  if (closeBtn) closeBtn.onclick = () => PanelManager.close();

  // Wire roster item selection
  area.querySelectorAll<HTMLElement>('.roster-item').forEach(el => {
    el.onclick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.roster-send')) return;
      const idx = parseInt(el.dataset.bidx || '-1');
      selectedBobIdx = idx;
      render(area);
    };
  });

  // Wire send buttons
  area.querySelectorAll<HTMLElement>('.roster-send').forEach(el => {
    el.onclick = () => {
      const idx = parseInt(el.dataset.send || '-1');
      if (Game.data.destMode && Game.data.destBobIdx === idx) {
        exitDestMode();
      } else {
        enterDestMode(idx);
      }
      render(area);
    };
  });
}

// ── Register ─────────────────────────────────────────────────────

export function initRosterPanel(): void {
  registerPanel('roster', render);
}
