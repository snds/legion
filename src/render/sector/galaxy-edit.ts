// ═══════════════════════════════════════════════════════════════════
// GALAXY EDIT — the non-destructive edit seam for the galaxy painting tool (Phase 0).
//
// The build-out's star generation stays a PURE function of (galPc, seed). Brush edits are layered on
// top WITHOUT mutating it, via two sparse channels read at bake time:
//   • per-CELL modifier (bulk brushes — density/displacement/dust): Map<cellKey, CellModifier>.
//   • per-STAR override (individually moved/deleted stars): Map<regionKey, Map<starId, StarOverride>>.
// starId = fnv1a(cellKey + index) — the stable position-in-the-generation-stream id (no id baked into
// geometry; a moved star simply re-keys into its new cell). With an EMPTY EditState the seam is the
// identity, so the production build-out + streaming paths are byte-identical (the editState is opt-in).
//
// The op-list of brush strokes (the canonical, serialized truth) is layered on top of this in later
// phases; this module is the bake-time application the strokes ultimately drive.
// ═══════════════════════════════════════════════════════════════════

/** 32-bit FNV-1a hash → a stable star id from its cell + index in the generation stream. */
export function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable id for a generated star: a pure function of its cell + index, independent of edit order. */
export function computeStarId(cellKey: string, index: number): number {
  return fnv1a32(`${cellKey}:${index}`);
}

/** Bulk, continuous edit for a whole 250 pc cell (density/movement/dust brushes write this). */
export interface CellModifier {
  /** Multiplies the cell's star count (white brush > 1 adds, black < 1 removes). */
  densityFactor: number;
  /** Bulk displacement applied to every star in the cell (pc). */
  displacementPc: readonly [number, number, number];
  /** Volumetric dust opacity over the cell, [0, 0.85] (dims/reddens the stars behind it). */
  dustOpacity: number;
}

/** Per-resolved-star edit (only for individually moved/deleted stars — the sparse exception). */
export interface StarOverride {
  /** Absolute galactocentric pc if moved; null = the star is deleted; undefined = position unchanged. */
  position?: readonly [number, number, number] | null;
  /** Brightness multiplier (additive brush brightening/dimming). */
  brightness?: number;
}

/** The derived edit fields read at bake time. Rebuilt by replaying the op-list (never the source of
 *  truth itself). Empty = the build-out renders exactly as generated. */
export interface EditState {
  readonly modifiers: Map<string, CellModifier>;          // cellKey → bulk modifier
  readonly overrides: Map<string, Map<number, StarOverride>>; // regionKey → (starId → override)
}

export function emptyEditState(): EditState {
  return { modifiers: new Map(), overrides: new Map() };
}

/** True iff this cell/region has ANY edit — lets the generator skip all per-star edit work (and stay
 *  byte-identical) on the overwhelming majority of unedited cells. */
export function cellHasEdits(editState: EditState, cellKey: string, regionKey: string): boolean {
  if (editState.modifiers.has(cellKey)) return true;
  const ov = editState.overrides.get(regionKey);
  return ov !== undefined && ov.size > 0;
}

/** The bake-time context handed to the star generator for an edited cell. */
export interface EditContext {
  readonly editState: EditState;
  readonly cellKey: string;
  readonly regionKey: string;
}
