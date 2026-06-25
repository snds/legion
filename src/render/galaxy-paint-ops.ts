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

/** One brush stroke (a drag = one stroke; a click = a 1-point path). Galactocentric pc throughout. */
export interface BrushStroke {
  readonly brushType: 'density-add';
  /** Stamp centres sampled along the drag. */
  readonly path: ReadonlyArray<readonly [number, number, number]>;
  readonly radiusPc: number;
  /** Per-stamp strength added to densityFactor at the centre (linear falloff to 0 at the radius). */
  readonly intensity: number;
}

function cellKeyOf(pc: PopulatedCell): string {
  return `${pc.cell.i}|${pc.cell.j}|${pc.cell.k}`;
}

/** Apply one stroke into `editState`'s per-cell density modifiers; returns the dirtied regionKeys
 *  (the regions whose merged Points must re-bake). Falloff is linear from the nearest path point. */
export function applyStroke(stroke: BrushStroke, editState: EditState, cells: PopulatedCell[]): Set<string> {
  const dirty = new Set<string>();
  const r = stroke.radiusPc;
  const r2 = r * r;
  for (const pc of cells) {
    let falloff = 0;
    for (const p of stroke.path) {
      const dx = pc.centerPc.x - p[0];
      const dy = pc.centerPc.y - p[1];
      const dz = pc.centerPc.z - p[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r2) falloff = Math.max(falloff, 1 - Math.sqrt(d2) / r);
    }
    if (falloff <= 0) continue;
    const add = stroke.intensity * falloff;
    const ck = cellKeyOf(pc);
    const m = editState.modifiers.get(ck);
    if (m) m.densityFactor += add;
    else editState.modifiers.set(ck, { densityFactor: 1 + add, displacementPc: [0, 0, 0], dustOpacity: 0 });
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
