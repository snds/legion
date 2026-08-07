// ═══════════════════════════════════════════════════════════════════
// BAKE QUEUE — single-flight worker across all globes.
//
// N planets approaching at once must not spawn N workers (each ~1–4 s of CPU).
// One active bake; the rest wait. Globes cancel themselves out of the wait list
// on dispose / invalidate / manual setBaked.
// ═══════════════════════════════════════════════════════════════════

export interface BakeJob {
  /** Stable id for cancel / dedupe (globe seed + object identity). */
  readonly id: string;
  /** Start the worker; called when this job reaches the front. */
  readonly start: () => void;
}

let active: BakeJob | null = null;
const waiting: BakeJob[] = [];

/** Enqueue a bake. Idempotent for the same id (already active or waiting). */
export function enqueueBake(job: BakeJob): void {
  if (active?.id === job.id) return;
  if (waiting.some((j) => j.id === job.id)) return;
  if (!active) {
    active = job;
    job.start();
    return;
  }
  waiting.push(job);
}

/** Drop a job from the wait list (dispose / invalidate / stand-down). */
export function cancelBake(id: string): void {
  const i = waiting.findIndex((j) => j.id === id);
  if (i >= 0) waiting.splice(i, 1);
  // If this id is active, the caller terminates the worker; call bakeFinished after.
}

/** Worker finished (success or failure) — promote the next waiter. */
export function bakeFinished(id: string): void {
  if (active?.id !== id) return;
  active = null;
  const next = waiting.shift();
  if (next) {
    active = next;
    next.start();
  }
}

/** Test / diagnostics. */
export function bakeQueueState(): { activeId: string | null; waiting: string[] } {
  return { activeId: active?.id ?? null, waiting: waiting.map((j) => j.id) };
}
