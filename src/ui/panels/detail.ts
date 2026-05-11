// ═══════════════════════════════════════════════════════════════════
// DETAIL PANEL — System Overview
// Shows star system information when opened via the dock (I key).
// In the monolithic prototype, the I key toggles SelectionPanels
// (inspector/production). This module provides the system overview
// shown when no entity is selected, and will integrate with the
// full SelectionPanels system in Chunk 9.
// ═══════════════════════════════════════════════════════════════════

import { PanelManager } from '../panel-manager';
import { registerPanel } from '../dock';
import { Game } from '../../core/state';

// ── Planets Data (placeholder matching monolithic catalog) ───────

const PLANETS = [
  { name: 'Ragnarök',  designation: 'ε Eri b',  type: 'Gas Giant',     sma: '3.39 AU' },
  { name: 'Vulcan',    designation: 'ε Eri c',  type: 'Super-Earth',   sma: '0.68 AU' },
  { name: 'Midgard',   designation: 'ε Eri d',  type: 'Terrestrial',   sma: '1.02 AU' },
  { name: 'Jötunheim', designation: 'ε Eri e',  type: 'Ice Giant',     sma: '9.80 AU' },
  { name: 'Niflheim',  designation: 'ε Eri f',  type: 'Dwarf Planet',  sma: '18.20 AU' },
];

// ── Render ───────────────────────────────────────────────────────

function render(area: HTMLElement): void {
  let h = `<div class="panel-header">`
    + `<div class="panel-title">SYSTEM DETAIL</div>`
    + `<div class="panel-subtitle">ε ERIDANI · HD 22049</div>`
    + `<button class="panel-close">✕</button>`
    + `</div>`;

  h += `<div class="panel-body">`;

  // Star section
  h += `<div class="p-section-title">STAR</div>`;
  h += row('DESIGNATION', 'HD 22049');
  h += row('SPECTRAL TYPE', 'K2V');
  h += row('MASS', '0.82 M☉');
  h += row('LUMINOSITY', '0.34 L☉');
  h += row('DISTANCE', '10.5 LY');


  // Planets section
  h += `<div class="p-section-title" style="margin-top:12px">PLANETS</div>`;
  PLANETS.forEach(p => {
    h += `<div class="p-row">`
      + `<span>${p.name}</span>`
      + `<span style="color:var(--ui-text-muted)">${p.type} · ${p.sma}</span>`
      + `</div>`;
  });

  // Resources section
  h += `<div class="p-section-title" style="margin-top:12px">RESOURCES</div>`;
  h += row('METALS', 'ABUNDANT');
  h += row('VOLATILES', 'MODERATE');
  h += row('RARE EARTH', 'TRACE');
  h += row('ENERGY', 'HIGH');

  // Status section
  h += `<div class="p-section-title" style="margin-top:12px">STATUS</div>`;
  h += row('BOBS', '4 IN-SYSTEM');
  h += row('STATIONS', '4 ACTIVE');
  h += row('HELIOPAUSE', '~120 AU');

  h += `</div>`; // panel-body

  area.innerHTML = h;

  const closeBtn = area.querySelector<HTMLElement>('.panel-close');
  if (closeBtn) closeBtn.onclick = () => PanelManager.close();
}

// ── Helper ───────────────────────────────────────────────────────

function row(key: string, val: string): string {
  return `<div class="p-row"><span>${key}</span><span>${val}</span></div>`;
}

// ── Register ─────────────────────────────────────────────────────

export function initDetailPanel(): void {
  registerPanel('detail', render);
}
