import {
  BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineSegments,
} from 'three';
import {
  CUBE_FACES, cubeToSphere, facePoint, type QuadNode,
} from '../cube-sphere';
import { type HeightfieldChunk } from './chunk-types';

/** Debug tint by LOD level (outline colour only — never baked into albedo). */
export const LEVEL_TINTS: readonly [number, number, number][] = [
  [0.45, 0.75, 1.00],
  [0.35, 0.90, 0.55],
  [0.95, 0.85, 0.30],
  [0.95, 0.50, 0.25],
  [0.90, 0.40, 0.70],
  [0.70, 0.55, 0.95],
  [0.95, 0.95, 0.95],
];

export function levelTint(level: number): [number, number, number] {
  return LEVEL_TINTS[Math.min(level, LEVEL_TINTS.length - 1)] as [number, number, number];
}

export function debugWireColor(level: number): Color {
  const t = levelTint(level);
  return new Color(t[0], t[1], t[2]);
}

function elevRadius(
  height: number, seaLevel: number, radius: number, displacement: number, drop: number,
): number {
  const hs = seaLevel > 0 ? Math.max(height, seaLevel) : height;
  const elev = (hs - 0.5) * 2 * displacement;
  return radius * (1 + elev) - drop;
}

/**
 * Build a displaced heightfield mesh for a chunk.
 * UV = chunk-local [0,1]² for the dense albedo bake. Normals from heightfield.
 */
export function meshHeightfieldChunk(
  chunk: HeightfieldChunk,
  radius: number,
  displacement: number,
  opts: { skirts?: boolean; seaLevel?: number } = {},
): BufferGeometry {
  const { node, heights, colors, sea, meshGrid } = chunk;
  const face = CUBE_FACES[node.face];
  const grid = meshGrid;
  const dim = grid + 1;
  const skirt = opts.skirts !== false;
  const seaLevel = opts.seaLevel ?? 0.5;
  const skirtDrop = radius * Math.max(0.002, displacement * 0.35);

  const skirtVerts = skirt ? dim * 4 : 0;
  const vertCount = dim * dim + skirtVerts;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const cols = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const aSea = new Float32Array(vertCount);
  const aLevel = new Float32Array(vertCount);

  const dirAt = (ix: number, iy: number): [number, number, number] => {
    const u = node.u0 + node.size * (ix / grid);
    const v = node.v0 + node.size * (iy / grid);
    return cubeToSphere(facePoint(face, u, v)) as [number, number, number];
  };

  const writePos = (vi: number, ix: number, iy: number, drop: number): void => {
    const s = dirAt(ix, iy);
    const hi = iy * dim + ix;
    const r = elevRadius(heights[hi], seaLevel, radius, displacement, drop);
    const o = vi * 3;
    positions[o] = s[0] * r;
    positions[o + 1] = s[1] * r;
    positions[o + 2] = s[2] * r;
    const c = hi * 3;
    cols[o] = colors[c];
    cols[o + 1] = colors[c + 1];
    cols[o + 2] = colors[c + 2];
    uvs[vi * 2] = ix / grid;
    uvs[vi * 2 + 1] = iy / grid;
    aSea[vi] = sea[hi];
    aLevel[vi] = node.level;
  };

  let vi = 0;
  for (let iy = 0; iy < dim; iy++) {
    for (let ix = 0; ix < dim; ix++) writePos(vi++, ix, iy, 0);
  }

  const skirtBase = dim * dim;
  if (skirt) {
    for (let ix = 0; ix < dim; ix++) writePos(skirtBase + ix, ix, 0, skirtDrop);
    for (let ix = 0; ix < dim; ix++) writePos(skirtBase + dim + ix, ix, grid, skirtDrop);
    for (let iy = 0; iy < dim; iy++) writePos(skirtBase + dim * 2 + iy, 0, iy, skirtDrop);
    for (let iy = 0; iy < dim; iy++) writePos(skirtBase + dim * 3 + iy, grid, iy, skirtDrop);
  }

  for (let iy = 0; iy < dim; iy++) {
    for (let ix = 0; ix < dim; ix++) {
      const i = iy * dim + ix;
      const o = i * 3;
      // Ocean is a flat sea-level shell — heightfield normals faceted the specular
      // into hard chunk/grid lines. Use radial normals on sea verts.
      if (sea[i] > 0) {
        const len = Math.hypot(positions[o], positions[o + 1], positions[o + 2]) || 1;
        normals[o] = positions[o] / len;
        normals[o + 1] = positions[o + 1] / len;
        normals[o + 2] = positions[o + 2] / len;
        continue;
      }
      const ix0 = Math.max(0, ix - 1), ix1 = Math.min(grid, ix + 1);
      const iy0 = Math.max(0, iy - 1), iy1 = Math.min(grid, iy + 1);
      const iL = iy * dim + ix0, iR = iy * dim + ix1;
      const iD = iy0 * dim + ix, iU = iy1 * dim + ix;
      const dxx = positions[iR * 3] - positions[iL * 3];
      const dxy = positions[iR * 3 + 1] - positions[iL * 3 + 1];
      const dxz = positions[iR * 3 + 2] - positions[iL * 3 + 2];
      const dyx = positions[iU * 3] - positions[iD * 3];
      const dyy = positions[iU * 3 + 1] - positions[iD * 3 + 1];
      const dyz = positions[iU * 3 + 2] - positions[iD * 3 + 2];
      let nx = dxy * dyz - dxz * dyy;
      let ny = dxz * dyx - dxx * dyz;
      let nz = dxx * dyy - dxy * dyx;
      if (nx * positions[o] + ny * positions[o + 1] + nz * positions[o + 2] < 0) {
        nx = -nx; ny = -ny; nz = -nz;
      }
      const len = Math.hypot(nx, ny, nz) || 1;
      normals[o] = nx / len;
      normals[o + 1] = ny / len;
      normals[o + 2] = nz / len;
    }
  }
  if (skirt) {
    for (let k = 0; k < skirtVerts; k++) {
      const i = skirtBase + k;
      const o = i * 3;
      const len = Math.hypot(positions[o], positions[o + 1], positions[o + 2]) || 1;
      normals[o] = positions[o] / len;
      normals[o + 1] = positions[o + 1] / len;
      normals[o + 2] = positions[o + 2] / len;
    }
  }

  const facesIn = (i0: number, i1: number, i2: number): boolean => {
    const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3], by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3], cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    return nx * (ax + bx + cx) + ny * (ay + by + cy) + nz * (az + bz + cz) < 0;
  };
  const flip = facesIn(0, dim, 1);

  const indices: number[] = [];
  for (let iy = 0; iy < grid; iy++) {
    for (let ix = 0; ix < grid; ix++) {
      const a = iy * dim + ix, b = a + 1, c = a + dim, d = c + 1;
      if (flip) indices.push(a, b, c, b, d, c);
      else indices.push(a, c, b, b, c, d);
    }
  }

  if (skirt) {
    const sb = skirtBase;
    for (let ix = 0; ix < grid; ix++) {
      const a = ix, b = ix + 1, s0 = sb + ix, s1 = sb + ix + 1;
      if (flip) indices.push(a, s0, b, b, s0, s1);
      else indices.push(a, b, s0, b, s1, s0);
    }
    const top = grid * dim;
    const st = sb + dim;
    for (let ix = 0; ix < grid; ix++) {
      const a = top + ix, b = top + ix + 1, s0 = st + ix, s1 = st + ix + 1;
      if (flip) indices.push(a, b, s0, b, s1, s0);
      else indices.push(a, s0, b, b, s0, s1);
    }
    const sl = sb + dim * 2;
    for (let iy = 0; iy < grid; iy++) {
      const a = iy * dim, b = (iy + 1) * dim, s0 = sl + iy, s1 = sl + iy + 1;
      if (flip) indices.push(a, b, s0, b, s1, s0);
      else indices.push(a, s0, b, b, s0, s1);
    }
    const sr = sb + dim * 3;
    for (let iy = 0; iy < grid; iy++) {
      const a = iy * dim + grid, b = (iy + 1) * dim + grid, s0 = sr + iy, s1 = sr + iy + 1;
      if (flip) indices.push(a, s0, b, b, s0, s1);
      else indices.push(a, b, s0, b, s1, s0);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('normal', new BufferAttribute(normals, 3));
  geo.setAttribute('uv', new BufferAttribute(uvs, 2));
  geo.setAttribute('aColor', new BufferAttribute(cols, 3));
  geo.setAttribute('aSea', new BufferAttribute(aSea, 1));
  geo.setAttribute('aLevel', new BufferAttribute(aLevel, 1));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

export function meshChunkOutline(
  chunk: HeightfieldChunk,
  radius: number,
  displacement: number,
  seaLevel: number,
): BufferGeometry {
  const { node, heights, meshGrid } = chunk;
  const face = CUBE_FACES[node.face];
  const grid = meshGrid;
  const dim = grid + 1;
  const nEdge = dim * 4;
  const positions = new Float32Array(nEdge * 3);

  const put = (vi: number, ix: number, iy: number): void => {
    const u = node.u0 + node.size * (ix / grid);
    const v = node.v0 + node.size * (iy / grid);
    const s = cubeToSphere(facePoint(face, u, v));
    const h = heights[iy * dim + ix];
    const r = elevRadius(h, seaLevel, radius, displacement, 0) * 1.0015;
    const o = vi * 3;
    positions[o] = s[0] * r;
    positions[o + 1] = s[1] * r;
    positions[o + 2] = s[2] * r;
  };

  let vi = 0;
  for (let ix = 0; ix < dim; ix++) put(vi++, ix, 0);
  for (let iy = 0; iy < dim; iy++) put(vi++, grid, iy);
  for (let ix = grid; ix >= 0; ix--) put(vi++, ix, grid);
  for (let iy = grid; iy >= 0; iy--) put(vi++, 0, iy);

  const indices: number[] = [];
  for (let i = 0; i < nEdge; i++) indices.push(i, (i + 1) % nEdge);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

export function makeChunkOutlineLines(
  chunk: HeightfieldChunk,
  radius: number,
  displacement: number,
  seaLevel: number,
  level: number,
  matCache: Map<number, LineBasicMaterial>,
): LineSegments {
  let mat = matCache.get(level);
  if (!mat) {
    mat = new LineBasicMaterial({
      color: debugWireColor(level),
      transparent: true,
      opacity: 0.75,
      depthTest: true,
    });
    matCache.set(level, mat);
  }
  return new LineSegments(meshChunkOutline(chunk, radius, displacement, seaLevel), mat);
}

export type { QuadNode };
