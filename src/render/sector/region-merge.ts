// ═══════════════════════════════════════════════════════════════════
// REGION-MERGE — collapse a 1 kpc region's populated 250 pc sectors into ONE Points draw
// (full-galaxy build-out, Inc 3). Per-sector Points would be ~13k+ draws (infeasible); merging at
// the region keeps it to ~region-count draws (~1.5k for the whole galaxy).
//
// FLOAT SAFETY (load-bearing): the merge offset is computed in PARSEC space — (sectorCentrePc −
// regionCentrePc) is ≤ ±500 pc — and only scaled to WU at the end, so region-local coords stay
// ≤ ±500k WU (float32 ULP ≈ 0.03 WU, sub-millipc). The Points is re-rooted each frame to the
// floating-origin residual of the region centre (16 sectors move as one), keeping GPU coords small.
// ═══════════════════════════════════════════════════════════════════

import {
  AdditiveBlending, BufferGeometry, Float32BufferAttribute, Points, ShaderMaterial, Vector3,
} from 'three';
import { WU_PER_PC } from '../../core/metrics';
import { sectorStarsVertexShader, sectorStarsFragmentShader } from '../shaders/galactic-stars';
import { cellKey, DEFAULT_SECTOR_EDGE_PC, HOME_GAL_PC } from './sector';
import { regionCenterPc, type RegionCell } from './region';
import type { PopulatedCell } from './galaxy-enumerate';
import type { EditState } from './galaxy-edit';
import {
  armDebugUniform, generateSectorStarsFast, sectorDensityDim, SECTOR_STAR_SIZE_SCALE,
} from './sector-stars';

export interface RegionStarField {
  readonly points: Points;
  readonly material: ShaderMaterial;
  /** Absolute scene-WU centre — the build-out re-roots points.position to its residual each frame. */
  readonly regionCenterAbsWU: Vector3;
  readonly count: number;
}

const EDGE = DEFAULT_SECTOR_EDGE_PC;
const _rcPc = new Vector3();

/** Generate every populated cell of a region (capped) and merge into one region-local Points.
 *  `editState` (optional) layers the non-destructive paint edits on top — omitted = the base galaxy. */
export function buildRegionStarField(
  regionCell: RegionCell, cells: PopulatedCell[], starCap: number, editState?: EditState,
): RegionStarField {
  regionCenterPc(regionCell, _rcPc);
  const regionCenterAbsWU = new Vector3().subVectors(_rcPc, HOME_GAL_PC).multiplyScalar(WU_PER_PC);

  // Pass 1: generate each cell's stars (FAST path — from the known emission, no integral) + sum.
  // The overdraw-taming dim is computed PER CELL (250 pc) and baked into colour below, NOT applied as
  // one per-region uniform — a single per-region dim steps at every 1 kpc boundary and reads as radial
  // banding edge-on; per-cell is 4× finer + continuous across region seams.
  const parts: { data: ReturnType<typeof generateSectorStarsFast>; cx: number; cy: number; cz: number; dim: number }[] = [];
  let total = 0;
  for (const pc of cells) {
    const editCtx = editState ? { editState, cellKey: cellKey(pc.cell), regionKey: pc.regionKey } : undefined;
    const data = generateSectorStarsFast(pc.centerPc, pc.emission, starCap, EDGE, editCtx);
    parts.push({ data, cx: pc.centerPc.x, cy: pc.centerPc.y, cz: pc.centerPc.z, dim: sectorDensityDim(pc.emission) });
    total += data.count;
  }

  // Pass 2: concatenate, offsetting each sector's local positions into region-local WU (parsec-space).
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const sizes = new Float32Array(total);
  const crests = new Float32Array(total);
  let o = 0;
  for (const { data, cx, cy, cz, dim } of parts) {
    const offX = (cx - _rcPc.x) * WU_PER_PC;
    const offY = (cy - _rcPc.y) * WU_PER_PC;
    const offZ = (cz - _rcPc.z) * WU_PER_PC;
    for (let i = 0; i < data.count; i++) {
      const s = (o + i) * 3;
      const t = i * 3;
      positions[s] = data.positions[t]! + offX;
      positions[s + 1] = data.positions[t + 1]! + offY;
      positions[s + 2] = data.positions[t + 2]! + offZ;
      colors[s] = data.colors[t]! * dim; // per-cell overdraw dim baked in (no per-region banding)
      colors[s + 1] = data.colors[t + 1]! * dim;
      colors[s + 2] = data.colors[t + 2]! * dim;
      sizes[o + i] = data.sizes[i]!;
      crests[o + i] = data.crests[i]!;
    }
    o += data.count;
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
  geo.setAttribute('aCrest', new Float32BufferAttribute(crests, 1));

  const material = new ShaderMaterial({
    vertexShader: sectorStarsVertexShader,
    fragmentShader: sectorStarsFragmentShader,
    uniforms: {
      uSizeScale: { value: SECTOR_STAR_SIZE_SCALE },
      uPixelRatio: { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1 },
      uCamVelocity: { value: new Vector3() },
      uStreakStrength: { value: 0.0 },
      uMaxStretch: { value: 0.4 },
      uDensityDim: { value: 1.0 }, // per-cell overdraw dim is baked into colour (continuous, no banding)
      uArmDebug: armDebugUniform, // shared — __armDebug recolours the whole galaxy
      uDepthLODRef: { value: 80_000 }, // continuous per-vertex distance LOD — no per-region size shells
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const points = new Points(geo, material);
  points.name = `region-stars@${regionCell.i},${regionCell.j},${regionCell.k}`;
  // Re-rooted to the residual every frame (the cached world AABB would be stale), so don't frustum-cull.
  points.frustumCulled = false;
  return { points, material, regionCenterAbsWU, count: total };
}

export function disposeRegionStarField(field: RegionStarField): void {
  field.points.geometry.dispose();
  field.material.dispose();
}
