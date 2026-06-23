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
// Phase 2c-1 Inc 6: the neighbourhood + galaxy now ride the unified metric, so
// the ly/kpc readouts divide by the unified scales (1 ly = LY_TO_WU ≈ 306.6 WU;
// 1 kpc = 1e6 WU) — was the legacy 220 / 333 which read "108108 kpc" at galaxy.
import { AU_TO_WU as WU_PER_AU, LY_TO_WU as WU_PER_LY, KPC_TO_WU_UNIFIED as WU_PER_KPC } from '../core/metrics';
import { formatGameClock } from '../core/time';

// ── DOM References ───────────────────────────────────────────────
// Cached once at init to avoid per-frame getElementById calls.

let elHud: HTMLElement | null = null;
let elDomainLabel: HTMLElement | null = null;
let elTimeCompression: HTMLElement | null = null;
let elGameClock: HTMLElement | null = null;
let elBobCount: HTMLElement | null = null;
let elFleetCount: HTMLElement | null = null;
let elViewScale: HTMLElement | null = null;
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

// View-radius readout — the real distance the camera sits from the system
// centre, so the player understands the scale they are viewing (Solar-System-
// Scope "DISTANCE …" cue). The zoom tiers use mutually-INCONSISTENT compressed
// WU scales, so the conversion is per-regime, switching unit at the heliopause
// (the real edge of the solar system: AU inside, light-years beyond):
//   • system tiers   1 AU  = 10  WU   (planets placed at sma·10)
//   • stellar tiers  1 ly  = 220 WU   (star map placed at distLy·220)
//   • galactic       1 kpc = 333 WU   (KPC_WU)
// WU_PER_AU / WU_PER_LY / WU_PER_KPC are imported from metrics.ts (single source).
function fmtScale(v: number): string {
  if (v >= 100) return Math.round(v).toString();
  if (v >= 10) return v.toFixed(0);
  return v.toFixed(1);
}
function viewScale(domain: DomainName, camDist: number): string {
  if (domain === 'galaxy') return `${fmtScale(camDist / WU_PER_KPC)} kpc`;
  if (domain === 'sector' || domain === 'arm') return `${fmtScale(camDist / WU_PER_LY)} ly`;
  return `${fmtScale(camDist / WU_PER_AU)} AU`; // surface … heliopause
}

/**
 * Format elapsed game-seconds to the game clock string "DAY ddd — YEAR yyyy",
 * computed from the real Gregorian calendar (leap years included) via the et
 * master clock (src/core/time.ts), anchored at GAME_EPOCH (2347-01-01).
 */
function fmtGameTime(gameSeconds: number): string {
  return formatGameClock(gameSeconds);
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

  // View-radius readout — created here (no markup dependency), pinned top-centre
  // just under the date. Updated every frame in updateHUD().
  if (typeof document !== 'undefined' && !document.getElementById('view-scale')) {
    elViewScale = document.createElement('div');
    elViewScale.id = 'view-scale';
    elViewScale.style.cssText = [
      'position:fixed', 'top:74px', 'left:50%', 'transform:translateX(-50%)',
      'font-family:ui-monospace,Menlo,monospace', 'font-size:11px',
      'letter-spacing:2px', 'color:rgba(170,190,230,0.55)',
      'pointer-events:none', 'z-index:40', 'white-space:nowrap',
    ].join(';');
    document.body.appendChild(elViewScale);
  } else {
    elViewScale = document.getElementById('view-scale');
  }
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

  // View-radius readout — every frame (camDist changes continuously).
  if (elViewScale) elViewScale.textContent = `◎ ${viewScale(domain, data.camDist)}`;
}
