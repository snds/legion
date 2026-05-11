// ═══════════════════════════════════════════════════════════════════
// HUD — Domain Label, Time Display, Game Clock, System Status
// Per-frame update that syncs the top bar readouts to game state.
// Applies domain color class to #hud for CSS accent switching.
//
// Matches the monolithic prototype's updateHUD() function:
// - Domain label text and color class per zoom tier
// - Time compression display with human-readable formatting
// - Game clock (DAY 001 — YEAR 2347)
// - Bob count and fleet/system status per domain
// ═══════════════════════════════════════════════════════════════════

import { Game, type DomainName } from '../core/state';

// ── DOM References ───────────────────────────────────────────────
// Cached once at init to avoid per-frame getElementById calls.

let elHud: HTMLElement | null = null;
let elDomainLabel: HTMLElement | null = null;
let elTimeCompression: HTMLElement | null = null;
let elGameClock: HTMLElement | null = null;
let elBobCount: HTMLElement | null = null;
let elFleetCount: HTMLElement | null = null;
let lastDomain: DomainName | null = null;

// ── Formatting ───────────────────────────────────────────────────

const DOMAIN_LABELS: Record<DomainName, string> = {
  'surface':       'SURFACE',
  'low-orbit':     'LOW ORBIT',
  'orbit':         'ORBIT',
  'inner-system':  'INNER SYSTEM',
  'outer-system':  'OUTER SYSTEM',
  'heliopause':    'HELIOPAUSE',
  'sector':        'SECTOR',
  'arm':           'ARM',
  'galaxy':        'GALAXY',
};

/**
 * Format time compression value to human-readable string.
 * Matches monolithic fmtTC() exactly.
 */
function fmtTC(tc: number): string {
  if (tc <= 0) return 'PAUSED';
  if (tc <= 1) return '1×';
  if (tc < 60) return Math.round(tc) + '×';
  if (tc < 3600) return Math.round(tc / 60) + ' MIN/S';
  if (tc < 86400) return Math.round(tc / 3600) + ' HR/S';
  if (tc < 86400 * 7) return fmtNum(tc / 86400) + ' DAY/S';
  if (tc < 86400 * 30) return fmtNum(tc / (86400 * 7)) + ' WK/S';
  if (tc < 86400 * 365) return fmtNum(tc / (86400 * 30)) + ' MO/S';
  return fmtNum(tc / (86400 * 365)) + ' YR/S';
}

/** Show integer when whole, one decimal otherwise. */
function fmtNum(n: number): string {
  return n % 1 < 0.05 ? Math.round(n).toString() : n.toFixed(1);
}

/**
 * Format game time (seconds) to game clock string.
 * Matches monolithic fmtGT(): "DAY 001 — YEAR 2347"
 */
function fmtGameTime(seconds: number): string {
  const YEAR_S = 86400 * 365;
  const DAY_S = 86400;
  const year = Math.floor(seconds / YEAR_S);
  const day = Math.floor((seconds % YEAR_S) / DAY_S);
  return `DAY ${String(day + 1).padStart(3, '0')} — YEAR ${2347 + year}`;
}

// ── System Status Per Domain ─────────────────────────────────────
// In the full game these counts come from ECS queries.
// For now, use placeholder values matching the monolithic prototype.

interface DomainStatus {
  bobLabel: string;
  fleetLabel: string;
}

function getDomainStatus(domain: DomainName): DomainStatus {
  // Placeholder counts — will be replaced by ECS queries
  const totalBobs = 4;
  const localBobs = 4;

  switch (domain) {
    case 'galaxy':
    case 'arm':
      return { bobLabel: `BOBS: ${totalBobs}`, fleetLabel: '1 ACTIVE SYS' };
    case 'sector':
      return { bobLabel: `BOBS: ${totalBobs}`, fleetLabel: '1 KNOWN' };
    case 'heliopause':
    case 'outer-system':
    case 'inner-system':
    case 'orbit':
    case 'low-orbit':
    case 'surface':
    default:
      return { bobLabel: `BOBS: ${localBobs}`, fleetLabel: 'ε ERI SYSTEM' };
  }
}

// ── Initialize ───────────────────────────────────────────────────
// Cache DOM references. Call once after DOM ready.

export function initHUD(): void {
  elHud = document.getElementById('hud');
  elDomainLabel = document.getElementById('domain-label');
  elTimeCompression = document.getElementById('time-compression');
  elGameClock = document.getElementById('game-clock');
  elBobCount = document.getElementById('bob-count');
  elFleetCount = document.getElementById('fleet-count');
}

// ── Per-Frame Update ─────────────────────────────────────────────
// Called every frame from the game loop.

export function updateHUD(): void {
  const data = Game.data;
  const domain = data.zoomDomain;

  // Domain label + color class (only update on change)
  if (domain !== lastDomain) {
    lastDomain = domain;
    if (elDomainLabel) {
      elDomainLabel.textContent = DOMAIN_LABELS[domain] || domain.toUpperCase();
    }
    if (elHud) {
      elHud.className = 'domain-' + domain;
    }
  }

  // Time compression
  const speed = Game.getTimeSpeed();
  if (elTimeCompression) {
    elTimeCompression.textContent = fmtTC(speed.tc);
  }

  // Game clock
  if (elGameClock) {
    elGameClock.textContent = fmtGameTime(data.gameTime);
  }

  // System status
  const status = getDomainStatus(domain);
  if (elBobCount) elBobCount.textContent = status.bobLabel;
  if (elFleetCount) elFleetCount.textContent = status.fleetLabel;
}
