// ═══════════════════════════════════════════════════════════════════
// GALAXY PAINT OPS — the brush-stroke op-list + its replay into the edit field (Phase 1b).
//
// A BrushStroke is the canonical, serializable unit of a paint (Phase 3 saves/loads these). Replaying
// a stroke writes per-cell CellModifiers into the EditState (the derived field the bake reads); undo
// rebuilds the field by replaying the remaining ops. Pure data — no Three, no GPU — so it's testable
// and is exactly what the main engine will re-derive from on export.
// ═══════════════════════════════════════════════════════════════════

import { emptyEditState, type EditState } from './sector/galaxy-edit';
import type { PopulatedCell } from './sector/galaxy-enumerate';

/** The in-stamp ramp shape (centre→edge). Default 'linear' = the original 1−d/r. */
export type FalloffKind = 'linear' | 'smooth' | 'ease' | 'hard';

/** Ceiling on a cell's densityFactor so heavy additive scrubbing can't run away (perf + a sane
 *  "fully saturated" point). 8× the base density. Erase has no floor beyond 0. */
export const MAX_DENSITY_FACTOR = 8;

/** One brush stroke (a drag = one stroke; a click = a 1-point path). Galactocentric pc throughout. */
export interface BrushStroke {
  /** density-add deposits stars (densityFactor up); density-erase removes them (multiplies down toward 0). */
  readonly brushType: 'density-add' | 'density-erase';
  /** Stamp centres sampled along the drag. */
  readonly path: ReadonlyArray<readonly [number, number, number]>;
  /** Per-stamp pen pressure 0..1, aligned 1:1 with `path`. Absent (or a non-pen device, which resolves
   *  to pressure 1) ⇒ treated as 1 everywhere, so the deposit is byte-identical to the no-pressure path. */
  readonly pressures?: ReadonlyArray<number>;
  readonly radiusPc: number;
  /** Base strength at a stamp centre (× that stamp's pressure × falloff ramp). */
  readonly intensity: number;
  /** In-stamp falloff shape. Absent ⇒ 'linear' (byte-identical to the pre-2d deposit). */
  readonly falloff?: FalloffKind;
}

function cellKeyOf(pc: PopulatedCell): string {
  return `${pc.cell.i}|${pc.cell.j}|${pc.cell.k}`;
}

/** Falloff ramp at normalized distance t∈[0,1) (1 at centre → 0 at the radius). 'hard' is a flat disc. */
function rampAt(t: number, kind: FalloffKind): number {
  if (t >= 1) return 0;
  switch (kind) {
    case 'hard': return 1;
    case 'smooth': return 1 - t * t * (3 - 2 * t); // 1 − smoothstep: soft shoulders both ends
    case 'ease': return (1 - t) * (1 - t);         // ease-out: strong centre, soft edge
    default: return 1 - t;                          // linear
  }
}

/** Apply one stroke into `editState`'s per-cell density modifiers; returns the dirtied regionKeys
 *  (the regions whose merged Points must re-bake). A cell takes its STRONGEST stamp (nearest = max ramp),
 *  weighted by that stamp's pen pressure. ADD accumulates (clamped at MAX_DENSITY_FACTOR); ERASE
 *  multiplies the existing factor down toward 0 (so it scales whatever's there — base or painted). */
export function applyStroke(stroke: BrushStroke, editState: EditState, cells: PopulatedCell[]): Set<string> {
  const dirty = new Set<string>();
  const r = stroke.radiusPc;
  const r2 = r * r;
  const pressures = stroke.pressures;
  const falloff = stroke.falloff ?? 'linear';
  const erase = stroke.brushType === 'density-erase';
  for (const pc of cells) {
    let bestT = Infinity; // nearest stamp ⇒ strongest ramp (all ramps decrease in t)
    let bestPressure = 1;
    for (let i = 0; i < stroke.path.length; i++) {
      const p = stroke.path[i];
      const dx = pc.centerPc.x - p[0];
      const dy = pc.centerPc.y - p[1];
      const dz = pc.centerPc.z - p[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r2) continue;
      const t = Math.sqrt(d2) / r;
      if (t < bestT) { bestT = t; bestPressure = pressures?.[i] ?? 1; }
    }
    if (bestT === Infinity) continue;
    const ramp = rampAt(bestT, falloff);
    if (ramp <= 0) continue;
    const strength = stroke.intensity * ramp * bestPressure;
    const ck = cellKeyOf(pc);
    const m = editState.modifiers.get(ck);
    const base = m ? m.densityFactor : 1;
    const df = erase ? base * Math.max(0, 1 - strength) : Math.min(base + strength, MAX_DENSITY_FACTOR);
    if (m) m.densityFactor = df;
    else editState.modifiers.set(ck, { densityFactor: df, displacementPc: [0, 0, 0], dustOpacity: 0 });
    dirty.add(pc.regionKey);
  }
  return dirty;
}

/** Rebuild the whole EditState by replaying an op-list (used by undo). Returns the rebuilt state +
 *  the union of dirtied regions (so the caller re-bakes exactly what changed). */
export function rebuildEditState(ops: readonly BrushStroke[], cells: PopulatedCell[]): {
  editState: EditState; dirty: Set<string>;
} {
  const editState = emptyEditState();
  const dirty = new Set<string>();
  for (const op of ops) {
    for (const rk of applyStroke(op, editState, cells)) dirty.add(rk);
  }
  return { editState, dirty };
}
