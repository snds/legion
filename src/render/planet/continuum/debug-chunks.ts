import type { ChunkHudStats } from './chunk-types';

/** Lab HUD for Continuum stream state and chunk residency. */
export function formatChunkHud(s: ChunkHudStats): string {
  const stream = s.streaming || s.coverPending > 0
    ? ` · STREAM cover ${s.coverPending} ${(s.coverAgeMs / 1000).toFixed(1)}s`
    : ` · settled tex~${s.medianTex}`;
  return `chunks ${s.resident} · pending ${s.pending}${stream} · tris ${s.tris}`;
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

export function updateChunkHud(stats: ChunkHudStats | null): void {
  const el = ensureChunkHudEl();
  if (!stats) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.textContent = formatChunkHud(stats);
}

export function removeChunkHud(): void {
  document.getElementById('continuum-chunk-hud')?.remove();
}
