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
import { VP } from '../visual-params';
import {
  cellCenterPc, cellKey, createSector, DEFAULT_SECTOR_EDGE_PC, hystereticCell,
  updateSectorFrame, type Cell, type Sector,
} from './sector';
import { regionForGalPc, regionKey } from './region';
import {
  buildSectorStarField, disposeSectorStarField, sectorDensityDim,
  SECTOR_STAR_SIZE_SCALE, type SectorStarField,
} from './sector-stars';

const EDGE = DEFAULT_SECTOR_EDGE_PC; // 250 pc
// Deadzone (pc) for the camera-cell pick — the focus must move this far past a boundary before
// the residency re-centres, so sub-pc jitter near a cell edge (home sits ~0.6 pc from one) can't
// thrash load/unload. Well under the edge (250 pc), well over any real focus wobble.
const HYSTERESIS_PC = 20;
// Each sector's stars are generated synchronously (~6k sampleGalaxy calls); loading all 3
// new cells on a crossing in one frame would hitch. Cap loads per frame to amortise it (the
// camera cell always loads first so the cloud stays responsive). Worker pooling is later (B2).
const MAX_LOADS_PER_FRAME = 2;
// Sector-star LOD tied to zoom (camDist WU). Two knobs, because SIZE alone can't
// thin the field — GPUs floor gl_PointSize at ~1px, so once the ~1-2.5px sprites
// hit that, shrinking does nothing. So we ALSO fade BRIGHTNESS:
//   SIZE   — uSizeScale ∝ SECTOR_STAR_LOD_REF/camDist  (full ≤ REF, 0.4 floor)
//   BRIGHT — uDensityDim ∝ SECTOR_STAR_FADE_REF/camDist (full ≤ REF, 0.04 floor)
// so as the camera pulls back the additive pile-up dims to a faint dusting and
// recedes toward the galaxy volume, rather than reading as a hyper-dense blob.
// These are the tuning knobs — raise to keep stars fuller/brighter longer.
const SECTOR_STAR_LOD_REF = 600;
const SECTOR_STAR_FADE_REF = 1500;
// Residency half-extent in cells (disc plane). 1 = 3×3×1 (9 cells, ±375pc); 2 =
// 5×5×1 (25 cells, ±625pc). Phase 5a: widened so the streamed particles reach
// further toward the galaxy volume (the ≤25pc catalogue → sector fill → volume
// dive), instead of ending in an empty band at ±375pc. The one knob to grow
// coverage — cost is ~(2r+1)² sector generations (amortised) + their star draws.
const SECTOR_RESIDENCY_RADIUS = 2;

export interface ResidentSector {
  readonly cell: Cell;
  readonly sector: Sector;
  readonly stars: SectorStarField;
  /** Synchronous star-generation cost at load (ms) — the hitch signal the region budgets sum. */
  readonly generationMs: number;
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

/** The (2·radius+1)²×1 cells around `cell` in the disc plane (i,k ±radius; j fixed).
 *  radius=1 → the 3×3×1 block (9 cells); the manager uses SECTOR_RESIDENCY_RADIUS. */
export function residentCells(cell: Cell, radius = 1): Cell[] {
  const out: Cell[] = [];
  for (let di = -radius; di <= radius; di++) {
    for (let dk = -radius; dk <= radius; dk++) {
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
  const t0 = performance.now();
  const stars = buildSectorStarField(sector); // synchronous Monte-Carlo generation — the hitch cost
  const generationMs = performance.now() - t0;
  sector.group.add(stars.points);
  mgr.group.add(sector.group);
  return { cell, sector, stars, generationMs };
}

function unloadSector(mgr: SectorManager, rs: ResidentSector): void {
  rs.sector.group.remove(rs.stars.points);
  disposeSectorStarField(rs.stars);
  mgr.group.remove(rs.sector.group);
}

const _regionProbe = new Vector3(); // scratch: a desired cell's centre, for its region lookup

/** Per-frame: stream the residency around the camera's cell, move the single live cloud to
 *  the camera's cell, and re-root + update every resident. `camGalPc` is the camera focus in
 *  galactocentric pc (absWUToGalPc(camFocusTarget)); `camDist` drives the cloud gate.
 *
 *  `residentRegionKeys` (Phase B region/LOD, optional): when a region manager drives streaming,
 *  the 3×3×1 desired block is restricted to cells whose 1 kpc region is resident — EXCEPT the
 *  camera cell, which is always kept (it owns the live cloud). Omitted (the standalone path) =
 *  no restriction. In Inc 2 the resident-region span (3 kpc) dwarfs the sector block (750 pc),
 *  so nothing is ever filtered → behaviour is byte-identical to the unfiltered path. */
export function updateSectorManager(
  mgr: SectorManager, camGalPc: Vector3, camDist: number, residentRegionKeys?: Set<string>,
): void {
  // Hysteretic so a focus jitter across a boundary doesn't thrash residency (B4).
  const cell = hystereticCell(camGalPc, mgr.cameraCell, EDGE, HYSTERESIS_PC);
  const camKey = cellKey(cell);

  // 1. Residency diff. Unload residents no longer desired (safe to delete during Map
  //    iteration — ES6 iterators skip removed entries). Then load missing cells: the camera
  //    cell FIRST (so its cloud can attach), capped per frame to amortise the generation hitch.
  let desired = residentCells(cell, SECTOR_RESIDENCY_RADIUS);
  if (residentRegionKeys) {
    desired = desired.filter((c) =>
      cellKey(c) === camKey ||
      residentRegionKeys.has(regionKey(regionForGalPc(cellCenterPc(c, EDGE, _regionProbe)))));
  }
  const desiredKeys = new Set(desired.map(cellKey));
  for (const [key, rs] of mgr.residents) {
    if (!desiredKeys.has(key)) { unloadSector(mgr, rs); mgr.residents.delete(key); }
  }
  const missing = desired.filter((c) => !mgr.residents.has(cellKey(c)));
  missing.sort((a, b) => (cellKey(a) === camKey ? -1 : cellKey(b) === camKey ? 1 : 0));
  for (let n = 0; n < missing.length && n < MAX_LOADS_PER_FRAME; n++) {
    mgr.residents.set(cellKey(missing[n]!), loadSector(mgr, missing[n]!));
  }

  // 2. Track the committed camera cell (the volumetric per-cell cloud was removed —
  //    the far field is the galaxy volume, the near field these true-particle stars).
  if (mgr.cameraCellKey !== camKey && mgr.residents.has(camKey)) {
    mgr.cameraCell = cell;
    mgr.cameraCellKey = camKey;
  }

  // 3. Re-root every resident to the floating-origin residual, and drive the zoom LOD
  //    (size + brightness, see the ref consts) so the field thins to a faint dusting on
  //    pull-back and hands the far side off to the galaxy volume.
  const sizeLOD = Math.min(1, Math.max(0.4, SECTOR_STAR_LOD_REF / camDist));
  const fadeLOD = Math.min(1, Math.max(0.04, SECTOR_STAR_FADE_REF / camDist));
  const formMask = VP.get('sectorFormMask'); // exploration: carve the fill into the spiral-arm form
  let stars = 0;
  for (const rs of mgr.residents.values()) {
    updateSectorFrame(rs.sector);
    const u = rs.stars.material.uniforms;
    u.uSizeScale.value = SECTOR_STAR_SIZE_SCALE * sizeLOD;
    u.uDensityDim.value = sectorDensityDim(rs.stars.data.emissionMean) * fadeLOD;
    u.uFormMask.value = formMask;
    stars += rs.stars.data.count;
  }
  mgr.starCount = stars;
}

/** Tear down the whole manager (dispose every resident). */
export function disposeSectorManager(mgr: SectorManager): void {
  for (const rs of mgr.residents.values()) unloadSector(mgr, rs);
  mgr.residents.clear();
  mgr.group.parent?.remove(mgr.group);
}
