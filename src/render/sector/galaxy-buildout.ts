// ═══════════════════════════════════════════════════════════════════
// GALAXY BUILD-OUT — the WHOLE galaxy rendered as sectors (full-galaxy build-out, Inc 4).
//
// Enumerates the populated 250 pc cells across the 3D disc, groups them by 1 kpc region, and
// generates each region as ONE merged Points (region-merge.ts) — capped per frame, inner→out, so
// the home neighbourhood appears first and a multi-second fill never hard-hangs. Each region is
// re-rooted to the floating-origin residual every frame and given a distance-driven size LOD so the
// far side of the galaxy is a faint dusting (cheap) while the near side resolves. The existing disc
// visual is disabled while this runs (galaxy.ts setDiscVisual) for performance. The populated-cell
// Map is the addressable surface the future manipulation tool plugs into.
// ═══════════════════════════════════════════════════════════════════

import { Group, Vector3 } from 'three';
import { Broker } from '../scale-manager';
import { regionForGalPc, type RegionCell } from './region';
import { enumerateGalaxy, type GalaxyEnumeration, type PopulatedCell } from './galaxy-enumerate';
import { buildRegionStarField, disposeRegionStarField, type RegionStarField } from './region-merge';

/** Overview star cap per cell — low so the galaxy-wide point budget stays viable (live-tunable). */
export const DEFAULT_BUILDOUT_STAR_CAP = 32;
// Distance LOD (far galaxy → faint dusting) is now CONTINUOUS per-vertex in the shader (uDepthLODRef,
// set in region-merge), not a per-region uSizeScale — a per-region size step reads as concentric
// banding edge-on. So updateGalaxyBuildout only re-roots; it no longer touches uSizeScale.

interface QueuedRegion { readonly key: string; readonly cell: RegionCell; readonly cells: PopulatedCell[]; }

export interface GalaxyBuildout {
  readonly group: Group;
  readonly enumeration: GalaxyEnumeration;
  /** Regions awaiting generation (inner→out). */
  readonly queue: QueuedRegion[];
  /** Generated regions (regionKey → merged Points). The future tool addresses regions here. */
  readonly generated: Map<string, RegionStarField>;
  starCap: number;
  totalStars: number;
}

export function createGalaxyBuildout(
  parent: Group, opts: { starCap?: number; threshold?: number; yExtentPc?: number } = {},
): GalaxyBuildout {
  const group = new Group();
  group.name = 'galaxy-buildout';
  parent.add(group);
  const enumeration = enumerateGalaxy({ threshold: opts.threshold, yExtentPc: opts.yExtentPc });
  const queue: QueuedRegion[] = [];
  for (const [key, cells] of enumeration.byRegion) {
    queue.push({ key, cell: regionForGalPc(cells[0]!.centerPc), cells });
  }
  // inner→out so the home/core neighbourhood populates first.
  queue.sort((a, b) => regionR2(a.cells[0]!) - regionR2(b.cells[0]!));
  return {
    group, enumeration, queue, generated: new Map(),
    starCap: opts.starCap ?? DEFAULT_BUILDOUT_STAR_CAP, totalStars: 0,
  };
}

function regionR2(c: PopulatedCell): number {
  return c.centerPc.x * c.centerPc.x + c.centerPc.z * c.centerPc.z;
}

const _res = new Vector3();

/** Per frame: generate up to `maxRegionsPerFrame` queued regions, then re-root + distance-LOD every
 *  generated region. Call after Broker.beginFrame (same ordering as the sector re-roots). */
export function updateGalaxyBuildout(b: GalaxyBuildout, maxRegionsPerFrame = 3): void {
  for (let n = 0; n < maxRegionsPerFrame && b.queue.length > 0; n++) {
    const { key, cell, cells } = b.queue.shift()!;
    const field = buildRegionStarField(cell, cells, b.starCap);
    b.group.add(field.points);
    b.generated.set(key, field);
    b.totalStars += field.count;
  }
  for (const field of b.generated.values()) {
    Broker.getResidual(field.regionCenterAbsWU, _res);
    field.points.position.copy(_res); // the shader's per-vertex uDepthLODRef handles the distance LOD
  }
}

export function buildoutStatus(b: GalaxyBuildout): {
  regions: number; queued: number; totalStars: number; cap: number; populatedCells: number;
} {
  return {
    regions: b.generated.size,
    queued: b.queue.length,
    totalStars: b.totalStars,
    cap: b.starCap,
    populatedCells: b.enumeration.cells.length,
  };
}

export function disposeGalaxyBuildout(b: GalaxyBuildout): void {
  for (const f of b.generated.values()) { b.group.remove(f.points); disposeRegionStarField(f); }
  b.generated.clear();
  b.queue.length = 0;
  b.group.parent?.remove(b.group);
}
