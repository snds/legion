// ═══════════════════════════════════════════════════════════════════
// DEV DEFAULTS WRITE-BACK — the client half of vite.config.ts's
// legion-save-defaults endpoint. "Save as default" POSTs the current
// look and the dev server writes it into src/config/*.json — COMMITTED
// defaults that survive restarts, other browsers, and deploys.
//
// Production builds have no endpoint (and no import.meta.env.DEV), so
// callers fall back to their localStorage path and report 'local'.
// ═══════════════════════════════════════════════════════════════════

export type SaveDefaultsTarget = 'galaxy' | 'visual';

/** Write `json` as the committed default for `target`. Resolves 'committed'
 *  when the dev server persisted the file, 'local' otherwise (prod build,
 *  endpoint unreachable) — callers surface the difference in the UI. */
export async function saveDevDefaults(target: SaveDefaultsTarget, json: unknown): Promise<'committed' | 'local'> {
  if (!import.meta.env.DEV) return 'local';
  try {
    const res = await fetch('/__legion/save-defaults', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, json }),
    });
    return res.ok ? 'committed' : 'local';
  } catch {
    return 'local';
  }
}
