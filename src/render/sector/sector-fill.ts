// ═══════════════════════════════════════════════════════════════════
// SECTOR FILL — the galaxy-fill stress pass (region/LOD arc, flag-gated ?proto-fill).
//
// Deliberately pre-generates a CORRIDOR of sectors from home toward the galactic core and KEEPS
// them all resident (unlike the streaming manager, which holds only 3×3×1). Three jobs, per the
// design synthesis:
//   1. STRESS — accumulating ~150 always-drawn star fields (the dense core sectors max out at
//      MAX_STARS) is the forcing function for the optimization arc (draw-call batching, instancing,
//      worker generation). The per-sector generation cost is timed, so the hitch is measured.
//   2. MEASUREMENT GATE — once the corridor exists you can fly the far [700k→2e6] WU band and
//      confirm the disc already covers it (no impostor needed), turning Approach B into a no-op.
//   3. DRAMATIC CLOUD — the corridor ends in the core, where the live streaming cloud (which samples
//      the ~50× density model) surfaces rich wisps with zero new rendering.
//
// Generation is capped per frame so a multi-second fill never hard-hangs the tab. Sectors are
// re-rooted to the floating origin every frame, same as the streamed ones.
// ═══════════════════════════════════════════════════════════════════

import { Group, Vector3 } from 'three';
import {
  cellCenterPc, cellForGalPc, createSector, DEFAULT_SECTOR_EDGE_PC, updateSectorFrame, type Cell,
  type Sector,
} from './sector';
import { REGION_EDGE_PC, regionForGalPc, regionKey } from './region';
import { buildSectorStarField, disposeSectorStarField, type SectorStarField } from './sector-stars';

interface FillSector {
  readonly sector: Sector;
  readonly stars: SectorStarField;
  readonly generationMs: number;
}

export interface SectorFill {
  readonly group: Group;
  /** Sectors still to generate (drained capped-per-frame). */
  readonly queue: Cell[];
  /** Generated + kept resident. */
  readonly done: FillSector[];
  totalGenMs: number;
  peakGenMs: number;
  totalStars: number;
}

/** Plan the corridor: walk the home→core line, collect each region it crosses, and emit that
 *  region's 4×4 disc-plane sectors at the home disc layer (so the swath is ~1 kpc wide and tiles
 *  the streamed sectors). Deduped; deterministic. */
export function planCorridorSectors(fromGalPc: Vector3, toGalPc: Vector3): Cell[] {
  const sj = cellForGalPc(fromGalPc).j; // the disc-plane sector layer (home's), used throughout
  const sub = Math.round(REGION_EDGE_PC / DEFAULT_SECTOR_EDGE_PC); // 4 sectors per region per axis
  const regionsSeen = new Set<string>();
  const cellsSeen = new Set<string>();
  const out: Cell[] = [];
  const p = new Vector3();
  const STEPS = 96;
  for (let s = 0; s <= STEPS; s++) {
    p.lerpVectors(fromGalPc, toGalPc, s / STEPS);
    const rc = regionForGalPc(p);
    const rk = regionKey(rc);
    if (regionsSeen.has(rk)) continue;
    regionsSeen.add(rk);
    for (let di = 0; di < sub; di++) {
      for (let dk = 0; dk < sub; dk++) {
        const cell: Cell = { i: rc.i * sub + di, j: sj, k: rc.k * sub + dk };
        const ck = `${cell.i}|${cell.j}|${cell.k}`;
        if (!cellsSeen.has(ck)) { cellsSeen.add(ck); out.push(cell); }
      }
    }
  }
  return out;
}

export function createSectorFill(parent: Group, fromGalPc: Vector3, toGalPc: Vector3): SectorFill {
  const group = new Group();
  group.name = 'sector-fill';
  parent.add(group);
  return {
    group,
    queue: planCorridorSectors(fromGalPc, toGalPc),
    done: [],
    totalGenMs: 0,
    peakGenMs: 0,
    totalStars: 0,
  };
}

const _cc = new Vector3();

/** Per frame: generate up to `maxPerFrame` queued sectors (the capped fill), then re-root ALL
 *  generated sectors to the floating-origin residual so the accumulated corridor stays put. */
export function updateSectorFill(fill: SectorFill, maxPerFrame = 2): void {
  for (let n = 0; n < maxPerFrame && fill.queue.length > 0; n++) {
    const cell = fill.queue.shift()!;
    const sector = createSector(cellCenterPc(cell, DEFAULT_SECTOR_EDGE_PC, _cc), DEFAULT_SECTOR_EDGE_PC);
    const t0 = performance.now();
    const stars = buildSectorStarField(sector);
    const generationMs = performance.now() - t0;
    sector.group.add(stars.points);
    fill.group.add(sector.group);
    fill.done.push({ sector, stars, generationMs });
    fill.totalGenMs += generationMs;
    fill.peakGenMs = Math.max(fill.peakGenMs, generationMs);
    fill.totalStars += stars.data.count;
  }
  for (const fs of fill.done) updateSectorFrame(fs.sector);
}

export function fillStatus(fill: SectorFill): {
  generated: number; remaining: number; totalStars: number; totalGenMs: number; peakGenMs: number;
} {
  return {
    generated: fill.done.length,
    remaining: fill.queue.length,
    totalStars: fill.totalStars,
    totalGenMs: Math.round(fill.totalGenMs),
    peakGenMs: Math.round(fill.peakGenMs * 10) / 10,
  };
}

export function disposeSectorFill(fill: SectorFill): void {
  for (const fs of fill.done) {
    fs.sector.group.remove(fs.stars.points);
    disposeSectorStarField(fs.stars);
    fill.group.remove(fs.sector.group);
  }
  fill.done.length = 0;
  fill.queue.length = 0;
  fill.group.parent?.remove(fill.group);
}
