// ═══════════════════════════════════════════════════════════════════
// TERRAIN BAKE — the Phase-3 "master": the analytic height field sampled onto a
// grid, then ERODED (a grid simulation the live shader can't do), so worlds gain
// the river channels / talus / drainage that read as natural rather than computed
// (the Orogen / Space Engine look). The eroded grid becomes the height master the
// surface shader samples; high-frequency procedural detail is layered on top at
// close range ("detail over master", v2 plan Phase 3).
//
// PURE + deterministic (no Three.js, no GPU) so the erosion is unit-tested. The
// heavy work runs on an explicit Rebuild (v2 plan decision 7: generation need not
// be real-time). Cube faces are eroded independently for now — cross-face droplet
// routing is a later refinement; the seams are hidden by the detail layer.
// ═══════════════════════════════════════════════════════════════════

import type { PlanetVisualType } from '../../data/system-gen';
import { CUBE_FACES, facePoint, cubeToSphere, type Vec3 } from './cube-sphere';
import { generatePlates, macroHeight, type PlateField } from './plates';
import { warpDir, fbm3 } from './simplex';
import { seedFrom, mulberry32 } from './rng';

/** Full analytic master height at a unit direction (macro tectonics + detail). */
export function sampleMaster(field: PlateField, dir: Vec3, detailScale: number, detailAmp: number, warp = 0, seed: Vec3 = [0, 0, 0]): number {
  // Warp the MACRO lookup with the SAME isotropic simplex the live shader uses
  // (baked/unbaked parity).
  const h = macroHeight(field, warpDir(dir, warp, seed));
  // Detail noise must be the SAME isotropic simplex family as the live shader.
  // This was 3D VALUE noise ("needn't match — only has to read as organic"):
  // wrong — value noise's integer lattice painted axis-aligned blocky patches
  // into the baked master, worst over ocean where bathymetry turns millimetre
  // height steps into hard colour separations (ledger P-05: value noise is
  // anisotropic wherever its own structure is visible). Simplex fbm3 is the
  // CPU port already trusted for the warp parity.
  const sx = dir[0] * 1.7 * detailScale, sy = dir[1] * 1.7 * detailScale, sz = dir[2] * 1.7 * detailScale;
  const d = fbm3(sx + 11.3, sy + 47.7, sz + 83.1) * 0.5 + 0.5;
  return Math.min(1, Math.max(0, h + (d - 0.5) * detailAmp));
}

export interface BakeParams {
  res: number;          // per-face grid resolution
  detailScale: number;  // fine-detail frequency
  detailAmp: number;    // fine-detail amplitude
  droplets: number;     // hydraulic erosion droplets per face (0 = none)
  erosionStrength: number; // 0..1 sediment carve rate
  thermalIters: number; // thermal (talus) smoothing passes
  talus: number;        // thermal talus threshold (height diff)
}

export const DEFAULT_BAKE: BakeParams = {
  res: 256, detailScale: 3, detailAmp: 0.35,
  droplets: 40000, erosionStrength: 0.3, thermalIters: 8, talus: 0.006,
};

/** One eroded cube face: a res×res Float32 height grid in [0,1]. */
export interface BakedCube {
  res: number;
  faces: Float32Array[]; // 6, in CUBE_FACES order
}

/** Direction for a face texel — the SAME cube→sphere map the geometry uses, so a
 *  baked texel lines up with the surface vertex that samples it. */
function faceDir(faceId: number, u: number, v: number): Vec3 {
  return cubeToSphere(facePoint(CUBE_FACES[faceId], u, v));
}

/** Sample the analytic master onto all six cube faces (pre-erosion). */
export function bakeFaces(field: PlateField, p: BakeParams, warp = 0, seed: Vec3 = [0, 0, 0]): Float32Array[] {
  const { res } = p;
  const faces: Float32Array[] = [];
  for (let f = 0; f < 6; f++) {
    const grid = new Float32Array(res * res);
    for (let j = 0; j < res; j++) {
      const v = (j + 0.5) / res;
      for (let i = 0; i < res; i++) {
        const u = (i + 0.5) / res;
        grid[j * res + i] = sampleMaster(field, faceDir(f, u, v), p.detailScale, p.detailAmp, warp, seed);
      }
    }
    faces.push(grid);
  }
  return faces;
}

// ── bilinear sample + gradient on a face grid (clamped edges) ──
function sampleGrid(g: Float32Array, res: number, x: number, y: number): number {
  const x0 = Math.min(res - 1, Math.max(0, Math.floor(x)));
  const y0 = Math.min(res - 1, Math.max(0, Math.floor(y)));
  const x1 = Math.min(res - 1, x0 + 1), y1 = Math.min(res - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = g[y0 * res + x0], b = g[y0 * res + x1], c = g[y1 * res + x0], d = g[y1 * res + x1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/**
 * Droplet hydraulic erosion on a single face grid (Beyer/Lague style): rain a
 * droplet, let it run downhill picking up sediment above its carry capacity and
 * depositing below it, evaporating over its life. Carves drainage channels and
 * deposits sediment in basins. Deterministic from `seed`. Mutates `g`.
 */
export function hydraulicErode(g: Float32Array, res: number, seed: number, p: BakeParams): void {
  if (p.droplets <= 0) return;
  const rng = mulberry32(seed >>> 0);
  const maxSteps = 48, inertia = 0.05, capacity = 4 * p.erosionStrength, deposit = 0.3, erode = 0.3 * p.erosionStrength, evap = 0.02, gravity = 4, minSlope = 0.0005;
  for (let n = 0; n < p.droplets; n++) {
    let x = rng() * (res - 1), y = rng() * (res - 1);
    let dx = 0, dy = 0, speed = 1, water = 1, sediment = 0;
    for (let s = 0; s < maxSteps; s++) {
      const xi = Math.floor(x), yi = Math.floor(y);
      if (xi < 0 || yi < 0 || xi >= res - 1 || yi >= res - 1) break;
      const fx = x - xi, fy = y - yi;
      // height gradient (bilinear of the four corner differences)
      const nw = g[yi * res + xi], ne = g[yi * res + xi + 1], sw = g[(yi + 1) * res + xi], se = g[(yi + 1) * res + xi + 1];
      const gx = (ne - nw) * (1 - fy) + (se - sw) * fy;
      const gy = (sw - nw) * (1 - fx) + (se - ne) * fx;
      dx = dx * inertia - gx * (1 - inertia);
      dy = dy * inertia - gy * (1 - inertia);
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const hOld = sampleGrid(g, res, x, y);
      x += dx; y += dy;
      if (x < 0 || y < 0 || x >= res - 1 || y >= res - 1) break;
      const hNew = sampleGrid(g, res, x, y);
      const dh = hNew - hOld;
      const cap = Math.max(-dh, minSlope) * speed * water * capacity;
      if (dh > 0 || sediment > cap) {
        // uphill or over capacity → deposit
        const amt = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * deposit;
        splat(g, res, x - dx, y - dy, amt);
        sediment -= amt;
      } else {
        const amt = Math.min((cap - sediment) * erode, -dh);
        splat(g, res, x - dx, y - dy, -amt);
        sediment += amt;
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * -gravity));
      water *= 1 - evap;
      if (water < 0.01) break;
    }
  }
}

/** Border texels left untouched by erosion so face edges keep the CONTINUOUS
 *  analytic master value (macroHeight is a function of direction, so it matches
 *  across cube-face seams — only per-face erosion would break it). */
const EDGE_MARGIN = 3;

/** Add `amt` (may be negative) bilinearly across the 4 nearest texels — spreads
 *  sediment so it never piles into single-texel spikes, and skips the border. */
function splat(g: Float32Array, res: number, x: number, y: number, amt: number): void {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const add = (xi: number, yi: number, w: number): void => {
    if (xi < EDGE_MARGIN || yi < EDGE_MARGIN || xi >= res - EDGE_MARGIN || yi >= res - EDGE_MARGIN) return;
    const i = yi * res + xi;
    g[i] = Math.min(1, Math.max(0, g[i] + amt * w));
  };
  add(x0, y0, (1 - fx) * (1 - fy));
  add(x0 + 1, y0, fx * (1 - fy));
  add(x0, y0 + 1, (1 - fx) * fy);
  add(x0 + 1, y0 + 1, fx * fy);
}

/**
 * Thermal (talus) erosion: where a cell is higher than a neighbour by more than
 * `talus`, move half the excess downhill. Rounds off unnaturally steep slopes and
 * builds talus aprons. `iters` passes. Mutates `g`.
 */
export function thermalErode(g: Float32Array, res: number, p: BakeParams): void {
  for (let it = 0; it < p.thermalIters; it++) {
    for (let y = EDGE_MARGIN; y < res - EDGE_MARGIN; y++) {
      for (let x = EDGE_MARGIN; x < res - EDGE_MARGIN; x++) {
        const i = y * res + x, h = g[i];
        let lowest = i, drop = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const j = (y + dy) * res + (x + dx);
          const d = h - g[j];
          if (d > drop) { drop = d; lowest = j; }
        }
        if (drop > p.talus) {
          const move = (drop - p.talus) * 0.5;
          g[i] -= move; g[lowest] += move;
        }
      }
    }
  }
}

/** Feather erosion in from every face edge. EDGE_MARGIN keeps the outer texels
 *  at the analytic master (continuous across cube faces), but a hard margin
 *  leaves a STEP where untouched edge meets heavily-eroded interior — visible
 *  as straight seam lines parallel to the cube edges, meeting in a "V" at the
 *  corners (field report, 2026-07-16). Ramping the erosion delta over a band
 *  makes the per-face erosion meet the seamless master smoothly instead. */
function featherEdges(g: Float32Array, pre: Float32Array, res: number): void {
  const B = Math.max(6, Math.round(res / 32)); // feather band (texels)
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const dEdge = Math.min(x, y, res - 1 - x, res - 1 - y);
      if (dEdge >= B) continue;
      const t = dEdge / B, w = t * t * (3 - 2 * t); // smoothstep 0 at edge → 1 inland
      const i = y * res + x;
      g[i] = pre[i] + (g[i] - pre[i]) * w;
    }
  }
}

/** Full bake: sample the master, then erode each face (thermal then hydraulic). */
export function bakeCube(seed: number, type: PlanetVisualType, params: Partial<BakeParams> = {}, warp = 0, noiseSeed: Vec3 = [0, 0, 0]): BakedCube {
  const p: BakeParams = { ...DEFAULT_BAKE, ...params };
  const field = generatePlates(seed, type);
  const faces = bakeFaces(field, p, warp, noiseSeed);
  faces.forEach((g, f) => {
    const pre = g.slice(); // pre-erosion master (seamless) for the edge feather
    thermalErode(g, p.res, p);
    hydraulicErode(g, p.res, (seedFrom('erode') ^ (seed >>> 0) ^ (f * 2654435761)) >>> 0, p);
    featherEdges(g, pre, p.res);
  });
  return { res: p.res, faces };
}
