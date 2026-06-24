// ═══════════════════════════════════════════════════════════════════
// REGION — coarse organizational index over the 250 pc sector grid (Phase B, region/LOD
// backbone, Inc 1). NON-VISUAL: a region renders NOTHING of its own — the galaxy disc remains
// the sole far-field representation (the sector cloud fades out exactly where the disc fades in,
// so there is no rendering gap to fill). A region is the coarse SCHEDULING unit that lets sector
// streaming + the later fill / shape-editor / optimization passes be coherent across the WHOLE
// galaxy instead of only near home.
//
// A region is a 1 kpc sparse-hash cube in galactocentric PARSECS — exactly the sector grid math
// (cellForGalPc / cellCenterPc / hystereticCell in sector.ts) at 4× the stride, so a region spans
// a 4×4 disc-plane subgrid of 250 pc sectors. Everything is a pure function of the integer cell —
// NO HOME_GAL_PC dependence — so region identity + seeds are stable anywhere and bit-identical
// across reload. Metadata + budget fields are declared now (populated by later increments).
// ═══════════════════════════════════════════════════════════════════

import { Vector3 } from 'three';
import { cellCenterPc, cellForGalPc, hystereticCell, type Cell } from './sector';

/** Region edge, parsecs. 1 kpc = 4 × the 250 pc sector edge → 4×4 sectors per region (disc plane). */
export const REGION_EDGE_PC = 1000;

/** Hysteresis deadzone (pc) for the camera-region pick. Far larger than the sector deadzone
 *  (20 pc) so a region never flips faster than sectors cross it — a region boundary is 4× rarer. */
export const REGION_HYSTERESIS_PC = 150;

/** A coarse integer region cell. Structurally the sector Cell, but a distinct type so region
 *  cells and sector cells can't be silently interchanged. */
export interface RegionCell extends Cell {}

/** Integer region a galactocentric position (pc) falls in (1 kpc stride). */
export function regionForGalPc(galPc: Vector3): RegionCell {
  return cellForGalPc(galPc, REGION_EDGE_PC);
}

/** Cube centre (galactocentric pc) of a region cell. */
export function regionCenterPc(region: RegionCell, out = new Vector3()): Vector3 {
  return cellCenterPc(region, REGION_EDGE_PC, out);
}

/** Hysteretic region selection — keep `current` until the focus moves > REGION_HYSTERESIS_PC
 *  past its slab (a genuine move still jumps straight to the right region). See hystereticCell. */
export function hystereticRegionCell(galPc: Vector3, current: RegionCell | null): RegionCell {
  return hystereticCell(galPc, current, REGION_EDGE_PC, REGION_HYSTERESIS_PC);
}

/** Residency Map key for a region (the `R:` prefix keeps it distinct from a sector cellKey). */
export function regionKey(region: RegionCell): string {
  return `R:${region.i}|${region.j}|${region.k}`;
}

/** Deterministic content-seed key for a region — a pure function of the integer cell, with NO
 *  HOME_GAL_PC term, so a region's generated metadata is identical wherever/whenever it loads. */
export function regionSeedKey(region: RegionCell): string {
  return `region:${region.i}|${region.j}|${region.k}`;
}

// ── Metadata + budget (declared now; populated when the region manager loads regions) ──
// Where a region sits relative to the spiral structure (sampled once from the density model at
// load) and how dense it is — the levers the shape-editor + optimizer consume.
export type ArmPhase = 'core' | 'crest' | 'inner' | 'outer' | 'gap';
export type DensityClass = 'core' | 'dense' | 'nominal' | 'sparse' | 'void';

/** Per-region cost telemetry (accumulated as its sectors stream). Feeds the optimization budget. */
export interface RegionBudget {
  /** Summed synchronous star-generation cost of the region's loaded sectors (ms). */
  generationMs: number;
  /** Resolved star Points across the region's loaded sectors. */
  starCount: number;
  /** Live raymarch cost of the region's cloud, if it owns the camera cell (ms). */
  cloudCostMs: number;
}

export function emptyRegionBudget(): RegionBudget {
  return { generationMs: 0, starCount: 0, cloudCostMs: 0 };
}

/** A resident region: its identity + float64 centre, the metadata sampled at load, and budgets.
 *  Holds NO GPU resources itself (sectors do); it coordinates which sectors are eligible to stream. */
export interface Region {
  readonly cell: RegionCell;
  readonly centerPc: Vector3;
  /** Populated at load from the density model (null until then). */
  armPhase: ArmPhase | null;
  densityClass: DensityClass | null;
  budget: RegionBudget;
}
