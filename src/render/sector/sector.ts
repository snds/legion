// ═══════════════════════════════════════════════════════════════════
// SECTOR — reusable galaxy-chunk component (sector-cloud prototype, Inc 1)
//
// A Sector is a cube of galactocentric space holding navigable systems (named +
// generated) and, later, a cloud volume + embedded stars. This first increment
// is the SKELETON: the component API + the float-safe frame, with zero default
// visual change (the prototype harness is flag-gated). See
// docs/sector-cloud-prototype.md.
//
// FRAME: a sector's authoritative center is float64 galactocentric PARSECS (like
// curated-systems galPos). Its absolute scene-WU center is (center − home)·
// WU_PER_PC (home at the scene origin, matching regionalScenePos). Each frame the
// group rides the floating origin via Broker.getResidual — the SAME per-frame R
// as every tier — so the GPU only ever sees small residuals (no float32 jitter at
// 8e6+ WU) and adjacent sectors stay seam-consistent.
// ═══════════════════════════════════════════════════════════════════

import { Group, Vector3 } from 'three';
import { WU_PER_PC } from '../../core/metrics';
import { CURATED_SYSTEMS, galPos, HOME_SYSTEM, type CuratedSystem } from '../../data/curated-systems';
import { Broker } from '../scale-manager';

/** Default sector edge length, parsecs (docs/sector-cloud-prototype.md §10). */
export const DEFAULT_SECTOR_EDGE_PC = 250;

/** Home's galactocentric position (pc) — the origin sectors are measured from,
 *  identical to the anchor galPos/regionalScenePos already use. */
export const HOME_GAL_PC: Readonly<Vector3> = (() => {
  const g = galPos(HOME_SYSTEM);
  return new Vector3(g.x, g.y, g.z);
})();

export interface Sector {
  /** Cube center, galactocentric parsecs (float64 authoritative). */
  readonly centerPc: Vector3;
  /** Cube edge length, parsecs. */
  readonly edgePc: number;
  /** Absolute scene-WU center (home at origin) = (centerPc − HOME_GAL_PC)·WU_PER_PC. */
  readonly centerAbsWU: Vector3;
  /** Curated systems whose galPos falls inside the cube. */
  readonly systems: CuratedSystem[];
  /** Scene group; children are authored sector-LOCAL (small magnitudes about the
   *  centre). Positioned per frame by updateSectorFrame. */
  readonly group: Group;
}

function galPcVec(sys: CuratedSystem, out = new Vector3()): Vector3 {
  const g = galPos(sys);
  return out.set(g.x, g.y, g.z);
}

const _g = new Vector3();

/** Build a sector CENTERED on an arbitrary galactocentric point (pc). Used by the
 *  prototype so the home sector cleanly contains the whole neighbourhood; the
 *  grid-aligned variant (cellForGalPc/createGridSector) is for Phase B streaming. */
export function createSector(centerPc: Vector3, edgePc = DEFAULT_SECTOR_EDGE_PC): Sector {
  const half = edgePc * 0.5;
  const centerAbsWU = new Vector3()
    .subVectors(centerPc, HOME_GAL_PC)
    .multiplyScalar(WU_PER_PC);
  const systems = CURATED_SYSTEMS.filter((s) => {
    galPcVec(s, _g);
    return (
      Math.abs(_g.x - centerPc.x) <= half &&
      Math.abs(_g.y - centerPc.y) <= half &&
      Math.abs(_g.z - centerPc.z) <= half
    );
  });
  const group = new Group();
  group.name = `sector@${centerPc.x.toFixed(0)},${centerPc.y.toFixed(0)},${centerPc.z.toFixed(0)}`;
  return { centerPc: centerPc.clone(), edgePc, centerAbsWU, systems, group };
}

/** The home sector (centred on ε Eridani / galPos(home)). */
export function createHomeSector(edgePc = DEFAULT_SECTOR_EDGE_PC): Sector {
  return createSector(HOME_GAL_PC.clone(), edgePc);
}

/** Sector-LOCAL scene position (WU) of a galactocentric point — children are
 *  authored in this small-magnitude frame, relative to the sector centre. */
export function galPcToSectorLocalWU(sector: Sector, galPc: Vector3, out = new Vector3()): Vector3 {
  return out.subVectors(galPc, sector.centerPc).multiplyScalar(WU_PER_PC);
}

/** Inverse of centerAbsWU: an ABSOLUTE scene-WU position (home at the origin, e.g.
 *  Game.data.camFocusTarget) → galactocentric parsecs. Used by the streaming manager to
 *  find which cell the camera occupies. galPc = HOME_GAL_PC + absWU / WU_PER_PC. */
export function absWUToGalPc(absWU: Vector3, out = new Vector3()): Vector3 {
  return out.copy(absWU).divideScalar(WU_PER_PC).add(HOME_GAL_PC);
}

const _r = new Vector3();
/** Re-root the sector group to this frame's floating-origin residual. Call once
 *  per frame AFTER Broker.beginFrame (same ordering as the tier re-roots). */
export function updateSectorFrame(sector: Sector): void {
  Broker.getResidual(sector.centerAbsWU, _r);
  sector.group.position.copy(_r);
}

// ── Grid model (Phase B streaming; provided + tested now) ─────────────
// Sectors stream as a SPARSE hash of populated integer cells, cell = floor(galPc /
// edge). The disc is ~50:1 oblate, so only a few vertical layers are ever populated
// (docs §10). These helpers are the storage/index math; the prototype above is
// centre-based for a clean single-sector demo.

export interface Cell { readonly i: number; readonly j: number; readonly k: number; }

/** Integer cell a galactocentric position (pc) falls in. */
export function cellForGalPc(galPc: Vector3, edgePc = DEFAULT_SECTOR_EDGE_PC): Cell {
  return {
    i: Math.floor(galPc.x / edgePc),
    j: Math.floor(galPc.y / edgePc),
    k: Math.floor(galPc.z / edgePc),
  };
}

/** Cube centre (galactocentric pc) of an integer cell. */
export function cellCenterPc(cell: Cell, edgePc = DEFAULT_SECTOR_EDGE_PC, out = new Vector3()): Vector3 {
  return out.set((cell.i + 0.5) * edgePc, (cell.j + 0.5) * edgePc, (cell.k + 0.5) * edgePc);
}

/** Stable string key for a cell (sparse-hash + deterministic-seed key, Phase B). */
export function cellKey(cell: Cell): string {
  return `${cell.i}|${cell.j}|${cell.k}`;
}
