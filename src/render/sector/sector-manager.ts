// ═══════════════════════════════════════════════════════════════════
// SECTOR MANAGER — streams sectors around the camera (Phase B, B1).
//
// Generalises the single prototype sector to a sparse hash of RESIDENT cells around the
// camera's galactic cell. Each resident renders its embedded stars (cheap, deterministic
// from the cell). Exactly ONE cloud is live-marched — the camera's current cell (the perf
// budget, docs §6); neighbours are stars-only (the MID-tier impostor is B3).
//
// Residency is 3×3×1 in the DISC PLANE (X-Z = i,k vary; Y = j fixed) — the disc is ~50:1
// oblate, so one vertical layer suffices. The cloud hops to the camera's cell as you cross
// a boundary (a small rebuild). Unloaded cells dispose their GPU resources (or they leak).
// ═══════════════════════════════════════════════════════════════════

import { Group, Vector3 } from 'three';
import {
  cellCenterPc, cellKey, createSector, DEFAULT_SECTOR_EDGE_PC, hystereticCell,
  updateSectorFrame, type Cell, type Sector,
} from './sector';
import { buildSectorCloud, disposeSectorCloud, updateSectorCloudFrame, type SectorCloud } from './sector-cloud';
import { buildSectorStarField, disposeSectorStarField, type SectorStarField } from './sector-stars';

const EDGE = DEFAULT_SECTOR_EDGE_PC; // 250 pc
// Deadzone (pc) for the camera-cell pick — the focus must move this far past a boundary before
// the residency re-centres, so sub-pc jitter near a cell edge (home sits ~0.6 pc from one) can't
// thrash load/unload. Well under the edge (250 pc), well over any real focus wobble.
const HYSTERESIS_PC = 20;
// Each sector's stars are generated synchronously (~6k sampleGalaxy calls); loading all 3
// new cells on a crossing in one frame would hitch. Cap loads per frame to amortise it (the
// camera cell always loads first so the cloud stays responsive). Worker pooling is later (B2).
const MAX_LOADS_PER_FRAME = 2;

interface ResidentSector {
  readonly cell: Cell;
  readonly sector: Sector;
  readonly stars: SectorStarField;
  cloud: SectorCloud | null; // non-null ONLY for the camera's current cell (the 1 live volume)
}

export interface SectorManager {
  readonly group: Group;
  readonly residents: Map<string, ResidentSector>;
  /** The committed camera cell (hysteretic — only re-centres past HYSTERESIS_PC). */
  cameraCell: Cell | null;
  cameraCellKey: string | null;
  /** Total resolved star Points across residents (telemetry). */
  starCount: number;
}

/** The 3×3×1 cells around `cell` in the disc plane (i,k ±1; j fixed). The 9 desired residents. */
export function residentCells(cell: Cell): Cell[] {
  const out: Cell[] = [];
  for (let di = -1; di <= 1; di++) {
    for (let dk = -1; dk <= 1; dk++) {
      out.push({ i: cell.i + di, j: cell.j, k: cell.k + dk });
    }
  }
  return out;
}

export function createSectorManager(parent: Group): SectorManager {
  const group = new Group();
  group.name = 'sector-manager';
  parent.add(group);
  return { group, residents: new Map(), cameraCell: null, cameraCellKey: null, starCount: 0 };
}

const _cellCenter = new Vector3();
function loadSector(mgr: SectorManager, cell: Cell): ResidentSector {
  const sector = createSector(cellCenterPc(cell, EDGE, _cellCenter), EDGE);
  const stars = buildSectorStarField(sector);
  sector.group.add(stars.points);
  mgr.group.add(sector.group);
  return { cell, sector, stars, cloud: null };
}

function detachCloud(rs: ResidentSector): void {
  if (!rs.cloud) return;
  rs.sector.group.remove(rs.cloud.mesh);
  disposeSectorCloud(rs.cloud);
  rs.cloud = null;
}

function unloadSector(mgr: SectorManager, rs: ResidentSector): void {
  detachCloud(rs);
  rs.sector.group.remove(rs.stars.points);
  disposeSectorStarField(rs.stars);
  mgr.group.remove(rs.sector.group);
}

/** Per-frame: stream the residency around the camera's cell, move the single live cloud to
 *  the camera's cell, and re-root + update every resident. `camGalPc` is the camera focus in
 *  galactocentric pc (absWUToGalPc(camFocusTarget)); `camDist` drives the cloud gate. */
export function updateSectorManager(mgr: SectorManager, camGalPc: Vector3, camDist: number): void {
  // Hysteretic so a focus jitter across a boundary doesn't thrash residency (B4).
  const cell = hystereticCell(camGalPc, mgr.cameraCell, EDGE, HYSTERESIS_PC);
  const camKey = cellKey(cell);

  // 1. Residency diff. Unload residents no longer desired (safe to delete during Map
  //    iteration — ES6 iterators skip removed entries). Then load missing cells: the camera
  //    cell FIRST (so its cloud can attach), capped per frame to amortise the generation hitch.
  const desired = residentCells(cell);
  const desiredKeys = new Set(desired.map(cellKey));
  for (const [key, rs] of mgr.residents) {
    if (!desiredKeys.has(key)) { unloadSector(mgr, rs); mgr.residents.delete(key); }
  }
  const missing = desired.filter((c) => !mgr.residents.has(cellKey(c)));
  missing.sort((a, b) => (cellKey(a) === camKey ? -1 : cellKey(b) === camKey ? 1 : 0));
  for (let n = 0; n < missing.length && n < MAX_LOADS_PER_FRAME; n++) {
    mgr.residents.set(cellKey(missing[n]!), loadSector(mgr, missing[n]!));
  }

  // 2. Move the single live cloud to the camera's current cell (rebuild on crossing) — but
  //    only once that cell is actually loaded (it loads first above, so usually this frame).
  if (mgr.cameraCellKey !== camKey) {
    const cur = mgr.residents.get(camKey);
    if (cur) {
      const prev = mgr.cameraCellKey ? mgr.residents.get(mgr.cameraCellKey) : undefined;
      if (prev) detachCloud(prev);
      if (!cur.cloud) { cur.cloud = buildSectorCloud(cur.sector); cur.sector.group.add(cur.cloud.mesh); }
      mgr.cameraCell = cell;
      mgr.cameraCellKey = camKey;
    }
  }

  // 3. Re-root every resident to the floating-origin residual; update the live cloud.
  let stars = 0;
  for (const rs of mgr.residents.values()) {
    updateSectorFrame(rs.sector);
    stars += rs.stars.data.count;
    if (rs.cloud) updateSectorCloudFrame(rs.sector, rs.cloud, camDist);
  }
  mgr.starCount = stars;
}

/** Tear down the whole manager (dispose every resident). */
export function disposeSectorManager(mgr: SectorManager): void {
  for (const rs of mgr.residents.values()) unloadSector(mgr, rs);
  mgr.residents.clear();
  mgr.group.parent?.remove(mgr.group);
}
