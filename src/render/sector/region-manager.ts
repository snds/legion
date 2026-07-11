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

import { Group, Vector3 } from 'three';
import { VP } from '../visual-params';
import { Broker } from '../scale-manager';
import { armPattern } from '../galaxy-density';
import {
  classifyArmPhase, classifyDensity, emptyRegionBudget, hystereticRegionCell, regionCenterPc,
  regionForGalPc, regionKey, REGION_EDGE_PC, type ArmPhase, type DensityClass, type Region, type RegionCell,
} from './region';
import { emissionAtGalPc, PC_TO_NATIVE, REF_EMISSION } from './sector-stars';
import { updateSectorManager, type SectorManager } from './sector-manager';
import { enumerateRegionCells } from './galaxy-enumerate';
import { buildRegionStarField, disposeRegionStarField, type RegionStarField } from './region-merge';

// Per-cell star cap for the streamed MID-field region-merge (Phase 5a). Coarser than the near sector
// manager (the mid-field is many pc away — a sparse resolved sampling over the disc volume, not the
// resolved close-up), so this is well under the near full-res budget. Tuning knob.
const REGION_FILL_STAR_CAP = 240;
// Region-merge builds per frame (each enumerates + generates one 1 kpc region's cells) — amortise the
// hitch when the residency shifts, like the sector loads.
const MAX_REGION_BUILDS_PER_FRAME = 1;

export interface RegionManager {
  /** Scene group holding the merged mid-field region star Points (one per populated resident region). */
  readonly group: Group;
  /** Resident regions (3×3×1 around the camera region), keyed by regionKey. */
  readonly residents: Map<string, Region>;
  /** regionKey → its merged Points (null = enumerated but empty, so we don't re-enumerate each frame). */
  readonly fields: Map<string, RegionStarField | null>;
  /** The committed camera region (hysteretic). */
  cameraRegion: RegionCell | null;
  cameraRegionKey: string | null;
  /** The near sector-manager cell the fields' de-dup exclusion was built against; a change rebuilds them. */
  lastSectorCellKey: string | null;
}

/** The 3×3×1 disc-plane block of regions around `region` (i,k ±1; j fixed — disc is oblate). */
export function residentRegionCells(region: RegionCell): RegionCell[] {
  const out: RegionCell[] = [];
  for (let di = -1; di <= 1; di++) {
    for (let dk = -1; dk <= 1; dk++) out.push({ i: region.i + di, j: region.j, k: region.k + dk });
  }
  return out;
}

export function createRegionManager(parent: Group): RegionManager {
  const group = new Group();
  group.name = 'region-fill';
  parent.add(group);
  return {
    group, residents: new Map(), fields: new Map(),
    cameraRegion: null, cameraRegionKey: null, lastSectorCellKey: null,
  };
}

const _res = new Vector3();

/** Load a region: identity + centre + density metadata sampled ONCE from the shared analytic model
 *  at the region centre (emission → densityClass vs the solar-circle reference; arm ridge + radius
 *  → armPhase). NO GPU work. Deterministic — pure of HOME_GAL_PC (the model is positional). */
function loadRegion(cell: RegionCell): Region {
  const centerPc = regionCenterPc(cell);
  // Density is sampled at the region's NEAREST approach to the midplane, not its geometric centre:
  // a 1 kpc-tall region straddling the thin (~300 pc) disc has its y-centre off-plane, which would
  // misread an in-disc region (e.g. home, j=-1, centre y=-500) as sparse. The clamp gives the
  // richest disc content the region's x,z column actually contains. armPhase uses x,z only (R,θ).
  const yMin = cell.j * REGION_EDGE_PC;
  const yMidplane = Math.max(yMin, Math.min(yMin + REGION_EDGE_PC, 0));
  const emission = emissionAtGalPc(centerPc.x, yMidplane, centerPc.z);
  const rNative = Math.hypot(centerPc.x, centerPc.z) * PC_TO_NATIVE; // cylindrical radius, native WU
  const armRidge = armPattern(rNative, Math.atan2(centerPc.z, centerPc.x));
  return {
    cell,
    centerPc,
    armPhase: classifyArmPhase(armRidge, rNative),
    densityClass: classifyDensity(emission / REF_EMISSION),
    budget: emptyRegionBudget(),
  };
}

/** Per-frame: maintain the 3×3×1 region residency around the camera region, then drive the sector
 *  manager restricted to the resident regions. `camGalPc` is the camera focus in galactocentric pc. */
export function updateRegionManager(
  rmgr: RegionManager, smgr: SectorManager, camGalPc: Vector3, camDist: number,
): void {
  // 1. Hysteretic region pick + 3×3×1 residency diff (cheap — metadata only, no GPU).
  const region = hystereticRegionCell(camGalPc, rmgr.cameraRegion);
  const newKey = regionKey(region);
  const desired = residentRegionCells(region);
  const desiredKeys = new Set(desired.map(regionKey));
  for (const key of rmgr.residents.keys()) {
    if (!desiredKeys.has(key)) rmgr.residents.delete(key); // ES6-safe delete during iteration
  }
  for (const rc of desired) {
    const key = regionKey(rc);
    if (!rmgr.residents.has(key)) rmgr.residents.set(key, loadRegion(rc));
  }
  if (rmgr.cameraRegionKey !== newKey) {
    const r = rmgr.residents.get(newKey);
    console.info(`[region-lod] entered ${newKey} — arm:${r?.armPhase} density:${r?.densityClass}`);
  }
  rmgr.cameraRegion = region;
  rmgr.cameraRegionKey = newKey;

  // 2. Drive sector streaming, gated to the resident regions (a no-op trim in Inc 2).
  updateSectorManager(smgr, camGalPc, camDist, desiredKeys);

  // 3. Aggregate per-region cost budgets from the resident sectors (the optimization levers).
  //    cloudCostMs (GPU) is reserved for the optimization arc; star generation + count are CPU-cheap
  //    to attribute here — each sector belongs to exactly one resident region (the no-op-filter
  //    invariant guarantees the lookup hits).
  for (const r of rmgr.residents.values()) { r.budget.generationMs = 0; r.budget.starCount = 0; }
  for (const rs of smgr.residents.values()) {
    const r = rmgr.residents.get(regionKey(regionForGalPc(rs.sector.centerPc)));
    if (!r) continue;
    r.budget.generationMs += rs.generationMs;
    r.budget.starCount += rs.stars.data.count;
  }

  // 4. MID-FIELD region-merge fill (Phase 5a). Each populated resident region is collapsed into ONE
  //    Points draw of coarse procedural stars, EXCLUDING the cells the near sector manager already
  //    draws full-res (no double-density). The per-vertex distance LOD (uDepthLODRef in region-merge)
  //    shrinks the far side smoothly; beyond the residency the galaxy volume takes over. If the near
  //    residency shifts (camera cell changed), rebuild so the exclusion stays correct.
  const nearKeys = new Set(smgr.residents.keys());
  if (rmgr.lastSectorCellKey !== smgr.cameraCellKey) {
    for (const f of rmgr.fields.values()) if (f) { rmgr.group.remove(f.points); disposeRegionStarField(f); }
    rmgr.fields.clear();
    rmgr.lastSectorCellKey = smgr.cameraCellKey;
  }
  for (const [key, f] of rmgr.fields) {
    if (!rmgr.residents.has(key)) { if (f) { rmgr.group.remove(f.points); disposeRegionStarField(f); } rmgr.fields.delete(key); }
  }
  let built = 0;
  for (const [key, region] of rmgr.residents) {
    if (rmgr.fields.has(key)) continue;
    if (built >= MAX_REGION_BUILDS_PER_FRAME) break;
    built++;
    const cells = enumerateRegionCells(region.cell, { exclude: nearKeys });
    if (cells.length === 0) { rmgr.fields.set(key, null); continue; } // known-empty — don't re-enumerate
    const field = buildRegionStarField(region.cell, cells, REGION_FILL_STAR_CAP);
    rmgr.group.add(field.points);
    rmgr.fields.set(key, field);
  }
  const formMask = VP.get('sectorFormMask'); // exploration: carve the region fill into the spiral-arm form
  for (const f of rmgr.fields.values()) {
    if (!f) continue;
    f.points.position.copy(Broker.getResidual(f.regionCenterAbsWU, _res));
    f.material.uniforms.uFormMask.value = formMask;
  }
}

/** Aggregated telemetry across resident regions — the read-out the fill pass + optimizer consume
 *  (and a debug HUD, later). cloudCostMs / draw-call / memory metrics arrive with the GPU-timing
 *  work in the optimization arc. */
export interface RegionTelemetry {
  regions: number;
  cameraRegionKey: string | null;
  cameraArmPhase: ArmPhase | null;
  cameraDensityClass: DensityClass | null;
  totalStarCount: number;
  totalGenerationMs: number;
}

export function regionTelemetry(rmgr: RegionManager): RegionTelemetry {
  let totalStarCount = 0;
  let totalGenerationMs = 0;
  for (const r of rmgr.residents.values()) {
    totalStarCount += r.budget.starCount;
    totalGenerationMs += r.budget.generationMs;
  }
  const cam = rmgr.cameraRegionKey ? rmgr.residents.get(rmgr.cameraRegionKey) : undefined;
  return {
    regions: rmgr.residents.size,
    cameraRegionKey: rmgr.cameraRegionKey,
    cameraArmPhase: cam?.armPhase ?? null,
    cameraDensityClass: cam?.densityClass ?? null,
    totalStarCount,
    totalGenerationMs,
  };
}
