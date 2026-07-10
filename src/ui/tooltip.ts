// ═══════════════════════════════════════════════════════════════════
// TOOLTIP — Hover Tooltip Display
// Positions a tooltip near the cursor showing entity data.
// Flips horizontally when near viewport edge.
// Matches the monolithic Tooltip IIFE exactly.
// ═══════════════════════════════════════════════════════════════════

// ── Entity Data Shape ────────────────────────────────────────────
// Matches userData shapes set on Three.js meshes by object factories.

export interface TooltipData {
  type: string;
  // Planet
  commonName?: string;
  designation?: string;
  planetType?: string;
  sma?: number;
  ecc?: number;
  // Bob
  name?: string;
  callsign?: string;
  focus?: string;
  health?: number;
  currentAction?: string;
  // Station
  stationType?: string;
  // System / gal_system
  spectralType?: string;
  distLy?: number;
  bobCount?: number;
  hasBobs?: boolean;
  status?: string;
  // Catalog star (synthesized by raycast from the CatalogStar record)
  constellation?: string;
  mag?: number;
  [key: string]: unknown;
}

// ── DOM ──────────────────────────────────────────────────────────

let el: HTMLElement | null = null;

// ── HTML Builder ─────────────────────────────────────────────────

function row(key: string, val: string): string {
  return `<div class="ht-row"><span>${key}</span><span>${val}</span></div>`;
}

function buildHTML(d: TooltipData): string {
  let h = '';

  if (d.type === 'planet') {
    h = `<div class="ht-name">${d.commonName ?? ''}</div>`
      + `<div class="ht-type">${d.designation ?? ''} · ${d.planetType ?? ''}</div>`
      + row('SMA', (d.sma ?? 0) + ' AU')
      + row('ECC', (d.ecc ?? 0).toFixed(3));

  } else if (d.type === 'bob') {
    h = `<div class="ht-name">${d.name ?? ''} "${d.callsign ?? ''}"</div>`
      + `<div class="ht-type">${d.focus ?? ''}</div>`
      + row('HEALTH', (d.health ?? 100) + '%')
      + row('ACTION', d.currentAction ?? 'IDLE');

  } else if (d.type === 'station') {
    h = `<div class="ht-name">${d.name ?? ''}</div>`
      + `<div class="ht-type">${d.stationType ?? ''}</div>`;

  } else if (d.type === 'system' || d.type === 'gal_system') {
    h = `<div class="ht-name">${d.name ?? ''}</div>`
      + `<div class="ht-type">${d.designation ?? ''} · ${d.spectralType ?? ''}</div>`
      + row('DIST', ((d.distLy ?? 0)).toFixed(1) + ' LY');
    if (d.bobCount != null) h += row('BOBS', String(d.bobCount));
    if (d.hasBobs === false) h += row('STATUS', 'UNEXPLORED');

  } else if (d.type === 'catalog_star') {
    h = `<div class="ht-name">${d.name ?? ''}</div>`
      + `<div class="ht-type">${d.spectralType || '—'}${d.constellation ? ' · ' + d.constellation : ''}</div>`
      + row('DIST', ((d.distLy ?? 0)).toFixed(1) + ' LY')
      + row('MAG', (d.mag ?? 0).toFixed(1));

  } else if (d.type === 'star') {
    h = `<div class="ht-name">${d.name ?? ''}</div>`
      + `<div class="ht-type">${d.spectralType ?? ''}</div>`;
  }

  h += `<div class="ht-hint">CLICK INSPECT · DBL-CLICK FOCUS</div>`;
  return h;
}

// ── Public API ───────────────────────────────────────────────────

export const Tooltip = {
  init(): void {
    el = document.getElementById('hover-tip');
  },

  /**
   * Show tooltip near cursor with entity data.
   * Flips left when approaching the right viewport edge.
   */
  show(data: TooltipData, clientX: number, clientY: number): void {
    if (!el) return;
    el.innerHTML = buildHTML(data);

    let tx = clientX + 16;
    let ty = clientY - 10;

    // Flip when near right edge (260 = max-width in CSS)
    if (tx + 260 > window.innerWidth - 20) {
      tx = clientX - 260 - 16;
    }
    // Clamp to top
    if (ty < 10) ty = 10;

    el.style.left = tx + 'px';
    el.style.top = ty + 'px';
    el.classList.add('visible');
  },

  hide(): void {
    if (!el) return;
    el.classList.remove('visible');
  },
};
