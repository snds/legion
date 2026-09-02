import {
  CUBE_FACES, cubeToSphere, facePoint, type QuadNode, type Vec3,
} from '../cube-sphere';
import { sampleSurface, type GeneratorBundle } from '../generators';
import {
  CHUNK_MESH_GRID, chunkKey, meshGridForLevel, texResForLevel, type HeightfieldChunk,
} from './chunk-types';

/**
 * Orbit-readable relief from the height bake (A4).
 * Soft-capped: rocky/desert land (seaLevel≈0) used to paint isoline / contour
 * rings once polish enabled relief — high MACRO.normalStrength × laplacian on
 * ridged heightfields. Cap strength and keep shade deltas small.
 */
function applyMacroReliefShading(
  albedoRGBA: Uint8Array,
  texH: Float32Array,
  texRes: number,
  normalStrength: number,
): void {
  // Hard ceiling — desert/lava guideposts sit at 0.24–0.26; full strength reads
  // as topographic contour lines on Continuum chunk albedo.
  const ns = Math.min(0.10, Math.max(0.03, normalStrength)) * 0.34;
  const tmp = new Uint8Array(albedoRGBA.length);
  tmp.set(albedoRGBA);
  for (let iy = 0; iy < texRes; iy++) {
    for (let ix = 0; ix < texRes; ix++) {
      const i = iy * texRes + ix;
      const sea = tmp[i * 4 + 3] > 127;
      const x0 = Math.max(0, ix - 1), x1 = Math.min(texRes - 1, ix + 1);
      const y0 = Math.max(0, iy - 1), y1 = Math.min(texRes - 1, iy + 1);
      const hx = texH[iy * texRes + x1] - texH[iy * texRes + x0];
      const hy = texH[y1 * texRes + ix] - texH[y0 * texRes + ix];
      // UV-normalized slope (resolution-stable across polish climb).
      const slope = Math.hypot(hx, hy) * texRes * 0.5;
      let shade = 1 - Math.min(0.12, slope * ns * 1.15);
      const lap = texH[iy * texRes + x0] + texH[iy * texRes + x1]
        + texH[y0 * texRes + ix] + texH[y1 * texRes + ix] - 4 * texH[i];
      // Land only — sea relief painted trenches into the albedo (orbit mush).
      if (!sea) {
        if (lap > 0.012) shade *= 1 - Math.min(0.06, lap * 1.6);
        else if (lap < -0.012) shade *= 1 + Math.min(0.04, -lap * 1.2);
      } else {
        // Flat open-ocean shading: keep coasts readable, hide bathymetry.
        shade = 1;
      }
      const o = i * 4;
      albedoRGBA[o] = Math.min(255, Math.max(0, Math.round(tmp[o] * shade)));
      albedoRGBA[o + 1] = Math.min(255, Math.max(0, Math.round(tmp[o + 1] * shade)));
      albedoRGBA[o + 2] = Math.min(255, Math.max(0, Math.round(tmp[o + 2] * shade)));
      albedoRGBA[o + 3] = tmp[o + 3];
    }
  }
}

/**
 * Soften outer albedo texels so ClampToEdge + mixed-LOD neighbors do not read
 * as hard rectangular tile frames (rocky/desert full-land Continuum leaves).
 */
function featherChunkBorder(albedoRGBA: Uint8Array, texRes: number): void {
  if (texRes < 8) return;
  const B = Math.max(3, Math.round(texRes / 18));
  const src = new Uint8Array(albedoRGBA);
  for (let iy = 0; iy < texRes; iy++) {
    for (let ix = 0; ix < texRes; ix++) {
      const dEdge = Math.min(ix, iy, texRes - 1 - ix, texRes - 1 - iy);
      if (dEdge >= B) continue;
      const t = dEdge / B;
      const inland = t * t * (3 - 2 * t); // 0 at edge → 1 inland
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = Math.min(texRes - 1, Math.max(0, ix + dx));
          const y = Math.min(texRes - 1, Math.max(0, iy + dy));
          const o = (y * texRes + x) * 4;
          r += src[o]; g += src[o + 1]; b += src[o + 2]; a += src[o + 3];
          n++;
        }
      }
      const o = (iy * texRes + ix) * 4;
      const edge = 1 - inland;
      albedoRGBA[o] = Math.round(src[o] * inland + (r / n) * edge);
      albedoRGBA[o + 1] = Math.round(src[o + 1] * inland + (g / n) * edge);
      albedoRGBA[o + 2] = Math.round(src[o + 2] * inland + (b / n) * edge);
      albedoRGBA[o + 3] = Math.round(src[o + 3] * inland + (a / n) * edge);
    }
  }
}

function sampleDir(
  bundle: GeneratorBundle,
  face: (typeof CUBE_FACES)[number],
  node: QuadNode,
  u: number,
  v: number,
  key: string,
): ReturnType<typeof sampleSurface> {
  const dir = cubeToSphere(facePoint(face, u, v)) as Vec3;
  return sampleSurface(bundle, dir, key);
}

/**
 * 2×2 supersample only on coast-neighbourhood texels — kills stair-steps
 * without paying 4× bake cost everywhere.
 */
function refineCoastSupersample(
  bundle: GeneratorBundle,
  node: QuadNode,
  face: (typeof CUBE_FACES)[number],
  albedoRGBA: Uint8Array,
  texH: Float32Array,
  texRes: number,
  key: string,
): void {
  const seaOf = (i: number): boolean => albedoRGBA[i * 4 + 3] > 127;
  for (let iy = 1; iy < texRes - 1; iy++) {
    for (let ix = 1; ix < texRes - 1; ix++) {
      const i = iy * texRes + ix;
      const s0 = seaOf(i);
      const border = s0 !== seaOf(i - 1) || s0 !== seaOf(i + 1)
        || s0 !== seaOf(i - texRes) || s0 !== seaOf(i + texRes);
      if (!border) continue;
      let r = 0, g = 0, b = 0, a = 0, h = 0;
      const offs = [-0.25, 0.25];
      const denom = Math.max(1, texRes - 1);
      for (const dy of offs) {
        for (const dx of offs) {
          const u = node.u0 + node.size * ((ix + dx) / denom);
          const v = node.v0 + node.size * ((iy + dy) / denom);
          const s = sampleDir(bundle, face, node, u, v, key);
          r += s.color[0]; g += s.color[1]; b += s.color[2];
          a += s.sea ? 1 : 0;
          h += s.height;
        }
      }
      const o = i * 4;
      albedoRGBA[o] = Math.min(255, Math.max(0, Math.round((r / 4) * 255)));
      albedoRGBA[o + 1] = Math.min(255, Math.max(0, Math.round((g / 4) * 255)));
      albedoRGBA[o + 2] = Math.min(255, Math.max(0, Math.round((b / 4) * 255)));
      albedoRGBA[o + 3] = Math.min(255, Math.max(0, Math.round((a / 4) * 255)));
      texH[i] = h / 4;
    }
  }
}

/**
 * Sample mesh heightfield + denser albedo bake for one cube-sphere node.
 * Texture samples are the visual master for colour/coasts; mesh carries displacement.
 */
export function sampleHeightfieldChunk(
  bundle: GeneratorBundle,
  node: QuadNode,
  opts?: { meshGrid?: number; texRes?: number; skipRelief?: boolean },
): HeightfieldChunk {
  const meshGrid = opts?.meshGrid ?? meshGridForLevel(node.level) ?? CHUNK_MESH_GRID;
  const texRes = opts?.texRes ?? texResForLevel(node.level);
  const face = CUBE_FACES[node.face];
  const fp = bundle.fingerprint();
  const key = chunkKey(node, fp);

  const albedoRGBA = new Uint8Array(texRes * texRes * 4);
  const texH = new Float32Array(texRes * texRes);
  // Corner-shared UVs (ix/(N-1)): adjacent leaves sample the exact shared edge so
  // ClampToEdge + LinearFilter do not leave a half-texel gap (hard tile frames).
  // Must stay aligned with mesh bilinear indexing in the height→vert path below.
  const uvAt = (i: number): number => (texRes <= 1 ? 0.5 : i / (texRes - 1));
  let ti = 0;
  for (let iy = 0; iy < texRes; iy++) {
    for (let ix = 0; ix < texRes; ix++) {
      const u = node.u0 + node.size * uvAt(ix);
      const v = node.v0 + node.size * uvAt(iy);
      const s = sampleDir(bundle, face, node, u, v, key);
      texH[ti] = s.height;
      const o = ti * 4;
      albedoRGBA[o] = Math.min(255, Math.max(0, Math.round(s.color[0] * 255)));
      albedoRGBA[o + 1] = Math.min(255, Math.max(0, Math.round(s.color[1] * 255)));
      albedoRGBA[o + 2] = Math.min(255, Math.max(0, Math.round(s.color[2] * 255)));
      albedoRGBA[o + 3] = s.sea ? 255 : 0;
      ti++;
    }
  }

  if (!opts?.skipRelief) {
    refineCoastSupersample(bundle, node, face, albedoRGBA, texH, texRes, key);
    applyMacroReliefShading(albedoRGBA, texH, texRes, bundle.macro.normalStrength);
  }

  // Extra sea-alpha soften after supersample for LinearFilter + fwidth AA.
  if (texRes >= 24) {
    const seaTmp = new Uint8Array(texRes * texRes);
    for (let i = 0; i < seaTmp.length; i++) seaTmp[i] = albedoRGBA[i * 4 + 3];
    for (let iy = 1; iy < texRes - 1; iy++) {
      for (let ix = 1; ix < texRes - 1; ix++) {
        const i = iy * texRes + ix;
        const avg = (
          seaTmp[i] + seaTmp[i - 1] + seaTmp[i + 1]
          + seaTmp[i - texRes] + seaTmp[i + texRes]
        ) / 5;
        if (avg > 8 && avg < 247) {
          albedoRGBA[i * 4 + 3] = Math.round(avg);
        }
      }
    }
  }

  // Feather on polish / mid-res+ only — stream 16² cover stays cheap (F6).
  // Ocean coasts already AA via sea-alpha; land needs this against LOD frames.
  if (!opts?.skipRelief || texRes >= 48) {
    featherChunkBorder(albedoRGBA, texRes);
  }

  const dim = meshGrid + 1;
  const n = dim * dim;
  const heights = new Float32Array(n);
  const colors = new Float32Array(n * 3);
  const sea = new Uint8Array(n);
  let i = 0;
  for (let iy = 0; iy < dim; iy++) {
    for (let ix = 0; ix < dim; ix++) {
      const fx = (ix / meshGrid) * (texRes - 1);
      const fy = (iy / meshGrid) * (texRes - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(texRes - 1, x0 + 1), y1 = Math.min(texRes - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const h00 = texH[y0 * texRes + x0], h10 = texH[y0 * texRes + x1];
      const h01 = texH[y1 * texRes + x0], h11 = texH[y1 * texRes + x1];
      heights[i] = h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty)
        + h01 * (1 - tx) * ty + h11 * tx * ty;

      const nx = Math.min(texRes - 1, Math.round((ix / meshGrid) * (texRes - 1)));
      const ny = Math.min(texRes - 1, Math.round((iy / meshGrid) * (texRes - 1)));
      const to = (ny * texRes + nx) * 4;
      colors[i * 3] = albedoRGBA[to] / 255;
      colors[i * 3 + 1] = albedoRGBA[to + 1] / 255;
      colors[i * 3 + 2] = albedoRGBA[to + 2] / 255;
      sea[i] = albedoRGBA[to + 3] > 127 ? 1 : 0;
      i++;
    }
  }

  return {
    node, key, fingerprint: fp, meshGrid, texRes,
    heights, colors, sea, albedoRGBA,
  };
}
