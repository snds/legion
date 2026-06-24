// ═══════════════════════════════════════════════════════════════════
// REGION MANAGER — coarse 1 kpc scheduling layer ABOVE the sector manager (region/LOD Inc 2).
//
// Streams a sparse hash of RESIDENT regions (3×3×1 disc-plane block) around the camera's region,
// mirroring the sector manager but at 4× the stride and with a wider hysteresis (a region boundary
// is crossed ~4× less often). A region holds NO GPU resources — it's the organizational unit that
// (a) coordinates which sectors are eligible to stream galaxy-wide, and (b) will carry the density
// metadata + cost budgets the fill / shape-editor / optimization passes consume (Inc 3+).
//
// It DRIVES the existing sector manager: it hands the set of resident region keys to
// updateSectorManager, which restricts its 3×3×1 sector block to those regions (always keeping the
// camera cell). In Inc 2 the region span (3 kpc) dwarfs the sector block (750 pc), so the filter
// never trims anything — streaming is byte-identical to the standalone sector path. The value here
// is the backbone, not a behaviour change; later increments populate + act on the region layer.
// ═══════════════════════════════════════════════════════════════════

import { Vector3 } from 'three';
import {
  emptyRegionBudget, hystereticRegionCell, regionCenterPc, regionForGalPc, regionKey,
  type Region, type RegionCell,
} from './region';
import { updateSectorManager, type SectorManager } from './sector-manager';

export interface RegionManager {
  /** Resident regions (3×3×1 around the camera region), keyed by regionKey. */
  readonly residents: Map<string, Region>;
  /** The committed camera region (hysteretic). */
  cameraRegion: RegionCell | null;
  cameraRegionKey: string | null;
}

/** The 3×3×1 disc-plane block of regions around `region` (i,k ±1; j fixed — disc is oblate). */
export function residentRegionCells(region: RegionCell): RegionCell[] {
  const out: RegionCell[] = [];
  for (let di = -1; di <= 1; di++) {
    for (let dk = -1; dk <= 1; dk++) out.push({ i: region.i + di, j: region.j, k: region.k + dk });
  }
  return out;
}

export function createRegionManager(): RegionManager {
  return { residents: new Map(), cameraRegion: null, cameraRegionKey: null };
}

/** Load a region: just its identity + centre + empty metadata/budget. NO GPU work; the density
 *  metadata (armPhase/densityClass) is sampled in Inc 3. Deterministic — pure of HOME_GAL_PC. */
function loadRegion(cell: RegionCell): Region {
  return { cell, centerPc: regionCenterPc(cell), armPhase: null, densityClass: null, budget: emptyRegionBudget() };
}

/** Per-frame: maintain the 3×3×1 region residency around the camera region, then drive the sector
 *  manager restricted to the resident regions. `camGalPc` is the camera focus in galactocentric pc. */
export function updateRegionManager(
  rmgr: RegionManager, smgr: SectorManager, camGalPc: Vector3, camDist: number,
): void {
  // 1. Hysteretic region pick + 3×3×1 residency diff (cheap — metadata only, no GPU).
  const region = hystereticRegionCell(camGalPc, rmgr.cameraRegion);
  const desired = residentRegionCells(region);
  const desiredKeys = new Set(desired.map(regionKey));
  for (const key of rmgr.residents.keys()) {
    if (!desiredKeys.has(key)) rmgr.residents.delete(key); // ES6-safe delete during iteration
  }
  for (const rc of desired) {
    const key = regionKey(rc);
    if (!rmgr.residents.has(key)) rmgr.residents.set(key, loadRegion(rc));
  }
  rmgr.cameraRegion = region;
  rmgr.cameraRegionKey = regionKey(region);

  // 2. Drive sector streaming, gated to the resident regions (a no-op trim in Inc 2).
  updateSectorManager(smgr, camGalPc, camDist, desiredKeys);
}
