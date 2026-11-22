import type { ChunkHudStats } from './chunk-types';

/** Lab HUD for Continuum stream state and chunk residency. `label`
 *  (P2-21 — see `updateChunkHud`'s doc comment for why) prefixes the line
 *  with which body the stats below it belong to; omitted keeps the original
 *  unlabeled format (Lab, and every existing `formatChunkHud` test call). */
export function formatChunkHud(s: ChunkHudStats, label?: string): string {
  const stream = s.streaming || s.coverPending > 0
    ? ` · STREAM cover ${s.coverPending} ${(s.coverAgeMs / 1000).toFixed(1)}s`
    : ` · settled tex~${s.medianTex}`;
  const prefix = label ? `${label} — ` : '';
  return `${prefix}chunks ${s.resident} · pending ${s.pending}${stream} · tris ${s.tris}`;
}

export function ensureChunkHudEl(): HTMLDivElement {
  let el = document.getElementById('continuum-chunk-hud') as HTMLDivElement | null;
  if (el) return el;
  el = document.createElement('div');
  el.id = 'continuum-chunk-hud';
  el.style.cssText = [
    'position:fixed', 'left:12px', 'bottom:12px', 'z-index:40',
    'font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace',
    'color:#c8d2e0', 'background:rgba(0,0,0,0.45)', 'padding:6px 10px',
    'border-radius:4px', 'pointer-events:none', 'display:none',
    'letter-spacing:0.02em',
  ].join(';');
  document.body.appendChild(el);
  return el;
}

/**
 * `label` (P2-21 — found in P2-13, confirmed again in P2-18): this HUD is
 * ONE shared, global DOM element, but every active real-game ContinuumGlobe
 * calls this every frame — with 2+ simultaneous bodies (Jupiter + 4
 * Galileans, a whole routed Sol system, etc.), the text silently reflects
 * whichever body's `update()` happened to run LAST that frame, not
 * necessarily the one on screen. The caller (`continuum/index.ts`) now (a)
 * only calls this for a `revealed` (actually near/on-screen, detail-visible)
 * body — far/impostor-stage bodies no longer overwrite it — and (b) passes
 * its own `root.name` as `label`, so even if two bodies are simultaneously
 * revealed, the line always says whose stats you're reading instead of
 * silently being ambiguous. `label` is optional, so a call site with no
 * collision risk (or that doesn't care) can omit it and keep the original
 * unlabeled text.
 */
export function updateChunkHud(stats: ChunkHudStats | null, label?: string): void {
  // ContinuumGlobe is now reachable from system-loader.ts (P2-1), whose own
  // lifecycle test deliberately runs headless/no-DOM (bare Node, per its own
  // "testable headless" doc comment) — a debug HUD is a dev-only nicety, so
  // no-op instead of throwing when there's no document to mount it in.
  if (typeof document === 'undefined') return;
  const el = ensureChunkHudEl();
  if (!stats) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.textContent = formatChunkHud(stats, label);
}

export function removeChunkHud(): void {
  if (typeof document === 'undefined') return;
  document.getElementById('continuum-chunk-hud')?.remove();
}
