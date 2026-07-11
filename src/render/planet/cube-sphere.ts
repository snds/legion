// ═══════════════════════════════════════════════════════════════════
// CUBE-SPHERE QUADTREE — near-uniform sphere tessellation without pole pinch
//
// The canonical globe topology (procedural-planet-research.md §2): project a
// cube's six faces onto a sphere so vertices stay near-uniform (no
// equirectangular pole crowding), then displace by GPU noise. Each face is the
// root of a QUADTREE — a node splits into four children as the camera nears, so
// silhouette/tessellation detail follows the view without paying for it on the
// far side. This module is PURE MATH (no Three.js, no GPU): face frames, the
// cube→sphere map, node subdivision, node centre/bounds, and the split rule.
// The geometry builder (globe.ts) consumes active nodes; the tests pin the map
// and the quadtree invariants.
// ═══════════════════════════════════════════════════════════════════

export type Vec3 = readonly [number, number, number];

/** The six cube faces, each with an outward normal + two in-plane axes (u,v).
 *  A face point is `normal + (2u-1)·axisU + (2v-1)·axisV` for u,v ∈ [0,1]. */
export interface CubeFace {
  readonly id: number;
  readonly normal: Vec3;
  readonly axisU: Vec3;
  readonly axisV: Vec3;
}

export const CUBE_FACES: readonly CubeFace[] = [
  { id: 0, normal: [ 1, 0, 0], axisU: [0, 0, -1], axisV: [0, 1, 0] }, // +X
  { id: 1, normal: [-1, 0, 0], axisU: [0, 0,  1], axisV: [0, 1, 0] }, // -X
  { id: 2, normal: [0,  1, 0], axisU: [1, 0,  0], axisV: [0, 0, 1] }, // +Y
  { id: 3, normal: [0, -1, 0], axisU: [1, 0,  0], axisV: [0, 0, -1] }, // -Y
  { id: 4, normal: [0, 0,  1], axisU: [1, 0,  0], axisV: [0, 1, 0] }, // +Z
  { id: 5, normal: [0, 0, -1], axisU: [-1, 0, 0], axisV: [0, 1, 0] }, // -Z
];

/** A quadtree node: a square patch [u0,u0+size]×[v0,v0+size] on `face`. */
export interface QuadNode {
  readonly face: number;
  readonly level: number;
  readonly u0: number;
  readonly v0: number;
  readonly size: number;
}

export function rootNode(face: number): QuadNode {
  return { face, level: 0, u0: 0, v0: 0, size: 1 };
}

/** A stable string id for caching a node's geometry. */
export function nodeId(n: QuadNode): string {
  return `${n.face}:${n.level}:${n.u0.toFixed(6)}:${n.v0.toFixed(6)}`;
}

/** The four children of a node (NW, NE, SW, SE), each half the size. */
export function childNodes(n: QuadNode): [QuadNode, QuadNode, QuadNode, QuadNode] {
  const s = n.size / 2;
  const mk = (du: number, dv: number): QuadNode => ({
    face: n.face, level: n.level + 1, u0: n.u0 + du * s, v0: n.v0 + dv * s, size: s,
  });
  return [mk(0, 1), mk(1, 1), mk(0, 0), mk(1, 0)];
}

/** Point on the unit cube face for face-local (u,v) ∈ [0,1]². */
export function facePoint(face: CubeFace, u: number, v: number): Vec3 {
  const a = 2 * u - 1;
  const b = 2 * v - 1;
  return [
    face.normal[0] + a * face.axisU[0] + b * face.axisV[0],
    face.normal[1] + a * face.axisU[1] + b * face.axisV[1],
    face.normal[2] + a * face.axisU[2] + b * face.axisV[2],
  ];
}

/**
 * Map a cube-surface point onto the UNIT sphere. The naive `normalize` crowds
 * vertices toward face centres; this is the standard area-preserving-ish
 * correction (Cube-to-sphere, Philip Rideout / acko.net "spheres vs cubes") that
 * spreads them evenly. Input is any point on the cube surface (|coord|≤1 on the
 * face); output has length 1.
 */
export function cubeToSphere(p: Vec3): Vec3 {
  const x = p[0], y = p[1], z = p[2];
  const x2 = x * x, y2 = y * y, z2 = z * z;
  return [
    x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3),
    y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3),
    z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3),
  ];
}

/** Unit-sphere direction for a node's centre (u,v = mid-patch). */
export function nodeCenterDir(n: QuadNode): Vec3 {
  const face = CUBE_FACES[n.face];
  return cubeToSphere(facePoint(face, n.u0 + n.size / 2, n.v0 + n.size / 2));
}

/** Approximate angular half-size (radians) a node subtends on the unit sphere —
 *  used by the split rule. A patch of cube-side `2·size` maps to roughly this
 *  arc; good enough to drive LOD, exact enough for the tests. */
export function nodeAngularRadius(n: QuadNode): number {
  const face = CUBE_FACES[n.face];
  const c = nodeCenterDir(n);
  const corner = cubeToSphere(facePoint(face, n.u0, n.v0));
  // angle between centre dir and a corner dir
  const dot = c[0] * corner[0] + c[1] * corner[1] + c[2] * corner[2];
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

export interface SelectParams {
  /** Camera position in the planet's LOCAL frame (planet centre at origin). */
  readonly camLocal: Vec3;
  /** Planet radius in that same local frame. */
  readonly radius: number;
  /** Split when a node's projected size exceeds this (larger ⇒ fewer splits). */
  readonly detail: number;
  /** Hard cap on subdivision depth (system-zoom never needs deep trees). */
  readonly maxLevel: number;
}

/**
 * Select the active leaf set of one face's quadtree for the current view. A node
 * splits while its world-space extent, divided by camera distance to the node,
 * exceeds `detail` and we're under `maxLevel`. Distance-based screen-error LOD —
 * Ulrich chunked-LOD, the standard planet approach. Pure + deterministic, so the
 * test can pin exactly which nodes are active for a given camera.
 */
export function selectFace(face: number, p: SelectParams): QuadNode[] {
  const out: QuadNode[] = [];
  const walk = (n: QuadNode): void => {
    if (n.level >= p.maxLevel || !shouldSplit(n, p)) {
      out.push(n);
      return;
    }
    for (const c of childNodes(n)) walk(c);
  };
  walk(rootNode(face));
  return out;
}

/** All six faces' active leaves. */
export function selectSphere(p: SelectParams): QuadNode[] {
  const out: QuadNode[] = [];
  for (let f = 0; f < 6; f++) out.push(...selectFace(f, p));
  return out;
}

function shouldSplit(n: QuadNode, p: SelectParams): boolean {
  const dir = nodeCenterDir(n);
  const cx = dir[0] * p.radius, cy = dir[1] * p.radius, cz = dir[2] * p.radius;
  const dx = p.camLocal[0] - cx, dy = p.camLocal[1] - cy, dz = p.camLocal[2] - cz;
  const dist = Math.max(1e-6, Math.sqrt(dx * dx + dy * dy + dz * dz));
  // world extent of this patch ≈ arc-length on the sphere
  const extent = 2 * nodeAngularRadius(n) * p.radius;
  return extent / dist > p.detail;
}
