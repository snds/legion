// Camera-local surface voxel bricks (Approach C / B3–B4).
// Samples the same GeneratorBundle height + climate as heightfield chunks.

import {
  BoxGeometry, DataTexture, Group, Mesh, RGBAFormat, ShaderMaterial,
  UnsignedByteType, LinearFilter, ClampToEdgeWrapping, Vector3, DoubleSide,
} from 'three';
import { sampleSurface, type GeneratorBundle } from '../generators';
import type { Vec3 } from '../cube-sphere';
import { continuumSurfaceBrickFrag, continuumSurfaceBrickVert } from './shaders';
import { NEAR_CLOUD_AU } from './cloud-voxels';

/** Engage slightly tighter than cloud bricks (spec §5.2). */
export const NEAR_SURFACE_AU = NEAR_CLOUD_AU * 0.85; // ~0.102
/** Exit hysteresis — tear down only after retreat past this (B4). */
export const SURFACE_EXIT_AU = NEAR_CLOUD_AU * 1.15; // ~0.138
/** Start baking brick maps before engage so handoff is seamless. */
export const SURFACE_WARM_AU = NEAR_SURFACE_AU * 1.55;

export const MAX_SURFACE_BRICKS = 4;
export const SURFACE_BAKE_RES = 48;
/** Cheap first bake while chunks are still streaming. */
export const SURFACE_BAKE_RES_STREAM = 20;
/** Soft CPU budget for one brick bake (ms). */
export const SURFACE_BAKE_MS_BUDGET = 2.5;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Soft blend 0..1 from view distance (enter tight, exit with hysteresis). */
export function surfaceVoxelBlend(viewAu: number, engaged: boolean): number {
  if (!engaged) return 0;
  return clamp01(
    (SURFACE_EXIT_AU - viewAu) / Math.max(1e-6, SURFACE_EXIT_AU - NEAR_SURFACE_AU * 0.5),
  );
}

export function shouldEngageSurfaceVoxels(viewAu: number, wasEngaged: boolean): boolean {
  if (wasEngaged) return viewAu <= SURFACE_EXIT_AU;
  return viewAu <= NEAR_SURFACE_AU;
}

export function shouldWarmSurfaceVoxels(viewAu: number): boolean {
  return viewAu <= SURFACE_WARM_AU;
}

/** Tangent frame matching GLSL brickUv / bake (cross(up, center)). */
export function orthonormalFrame(center: Vec3): { east: Vec3; north: Vec3 } {
  const cl = Math.hypot(center[0], center[1], center[2]) || 1;
  const cx = center[0] / cl, cy = center[1] / cl, cz = center[2] / cl;
  // cross((0,1,0), c) = (c.z, 0, -c.x)
  let ex = cz, ey = 0, ez = -cx;
  let el = Math.hypot(ex, ey, ez);
  if (el < 1e-4) { ex = 1; ey = 0; ez = 0; el = 1; }
  ex /= el; ey /= el; ez /= el;
  // north = cross(c, east)
  let nx = cy * ez - cz * ey;
  let ny = cz * ex - cx * ez;
  let nz = cx * ey - cy * ex;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  return { east: [ex, ey, ez], north: [nx, ny, nz] };
}

/** Bake height (R channel via RGBA) + albedo RGBA for one brick footprint. */
export function bakeSurfaceBrickMaps(
  bundle: GeneratorBundle,
  center: Vec3,
  halfAng: number,
  res: number,
): { heightRGBA: Uint8Array; albedo: Uint8Array } {
  const { east, north } = orthonormalFrame(center);
  const heightRGBA = new Uint8Array(res * res * 4);
  const albedo = new Uint8Array(res * res * 4);
  const cl = Math.hypot(center[0], center[1], center[2]) || 1;
  const c: Vec3 = [center[0] / cl, center[1] / cl, center[2] / cl];
  for (let iy = 0; iy < res; iy++) {
    for (let ix = 0; ix < res; ix++) {
      const u = (ix + 0.5) / res * 2 - 1;
      const v = (iy + 0.5) / res * 2 - 1;
      const ox = east[0] * u * halfAng + north[0] * v * halfAng;
      const oy = east[1] * u * halfAng + north[1] * v * halfAng;
      const oz = east[2] * u * halfAng + north[2] * v * halfAng;
      let dx = c[0] + ox, dy = c[1] + oy, dz = c[2] + oz;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      const s = sampleSurface(bundle, [dx, dy, dz]);
      const i = iy * res + ix;
      const hv = Math.min(255, Math.max(0, Math.round(s.height * 255)));
      const ho = i * 4;
      heightRGBA[ho] = hv;
      heightRGBA[ho + 1] = hv;
      heightRGBA[ho + 2] = hv;
      heightRGBA[ho + 3] = 255;
      const o = i * 4;
      albedo[o] = Math.min(255, Math.max(0, Math.round(s.color[0] * 255)));
      albedo[o + 1] = Math.min(255, Math.max(0, Math.round(s.color[1] * 255)));
      albedo[o + 2] = Math.min(255, Math.max(0, Math.round(s.color[2] * 255)));
      albedo[o + 3] = s.sea ? 255 : 0;
    }
  }
  return { heightRGBA, albedo };
}

interface BrickResident {
  mesh: Mesh;
  mat: ShaderMaterial;
  heightTex: DataTexture;
  albedoTex: DataTexture;
  center: Vector3;
  dirty: boolean;
}

/**
 * Near-cloud rocky relief: a few camera-local bricks raymarched from
 * generator-baked height/albedo. Soft blend + hysteresis teardown (B4).
 */
export class ContinuumSurfaceVoxels {
  readonly group = new Group();
  private readonly bricks: BrickResident[] = [];
  private readonly sharedGeo: BoxGeometry;
  private viewAu = 0.8;
  private engaged = false;
  private blend = 0;
  private bakeCursor = 0;
  private lastFp = '';
  private readonly _cam = new Vector3();
  private readonly _dir = new Vector3();

  constructor(
    private readonly radius: number,
    private readonly getBundle: () => GeneratorBundle,
    private readonly getDisplacement: () => number,
  ) {
    this.group.name = 'continuum-surface-voxels';
    const half = radius * 0.06;
    this.sharedGeo = new BoxGeometry(half * 2, half * 2, half * 2);
    for (let i = 0; i < MAX_SURFACE_BRICKS; i++) {
      const heightTex = new DataTexture(
        new Uint8Array(SURFACE_BAKE_RES * SURFACE_BAKE_RES * 4),
        SURFACE_BAKE_RES, SURFACE_BAKE_RES, RGBAFormat, UnsignedByteType,
      );
      heightTex.magFilter = LinearFilter;
      heightTex.minFilter = LinearFilter;
      heightTex.wrapS = ClampToEdgeWrapping;
      heightTex.wrapT = ClampToEdgeWrapping;
      heightTex.flipY = false;
      heightTex.needsUpdate = true;

      const albedoTex = new DataTexture(
        new Uint8Array(SURFACE_BAKE_RES * SURFACE_BAKE_RES * 4),
        SURFACE_BAKE_RES, SURFACE_BAKE_RES, RGBAFormat, UnsignedByteType,
      );
      albedoTex.magFilter = LinearFilter;
      albedoTex.minFilter = LinearFilter;
      albedoTex.wrapS = ClampToEdgeWrapping;
      albedoTex.wrapT = ClampToEdgeWrapping;
      albedoTex.flipY = false;
      albedoTex.needsUpdate = true;

      const mat = new ShaderMaterial({
        vertexShader: continuumSurfaceBrickVert,
        fragmentShader: continuumSurfaceBrickFrag,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
        uniforms: {
          uSunDir: { value: new Vector3(0.6, 0.35, 0.72) },
          uBlend: { value: 0 },
          uDisplacement: { value: 0.04 },
          uPlanetRadius: { value: radius },
          uSeaLevel: { value: 0.5 },
          uHeightMap: { value: heightTex },
          uAlbedoMap: { value: albedoTex },
          uBrickCenterObj: { value: new Vector3(0, 1, 0) },
          uBrickHalf: { value: half },
        },
      });
      const mesh = new Mesh(this.sharedGeo, mat);
      mesh.visible = false;
      mesh.name = `surface-brick-${i}`;
      mesh.frustumCulled = true;
      this.group.add(mesh);
      this.bricks.push({
        mesh, mat, heightTex, albedoTex,
        center: new Vector3(0, 1, 0),
        dirty: true,
      });
    }
  }

  setViewDistanceAu(au: number): void {
    this.viewAu = au;
  }

  get voxelBlend(): number {
    return this.blend;
  }

  get isEngaged(): boolean {
    return this.engaged;
  }

  invalidate(): void {
    for (const b of this.bricks) b.dirty = true;
  }

  update(
    _dt: number,
    sunDir: Vector3,
    camObjLocal: Vector3,
    opts?: { allowBake?: boolean },
  ): void {
    const was = this.engaged;
    this.engaged = shouldEngageSurfaceVoxels(this.viewAu, this.engaged);
    this.blend = surfaceVoxelBlend(this.viewAu, this.engaged);
    const allowBake = opts?.allowBake !== false;
    const warming = !this.engaged && shouldWarmSurfaceVoxels(this.viewAu);

    if (!this.engaged && !warming) {
      if (was) {
        for (const b of this.bricks) b.mesh.visible = false;
      }
      return;
    }

    const bundle = this.getBundle();
    const fp = bundle.fingerprint();
    if (fp !== this.lastFp) {
      this.lastFp = fp;
      this.invalidate();
    }

    this._cam.copy(camObjLocal);
    const len = this._cam.length() || 1;
    this._dir.copy(this._cam).multiplyScalar(1 / len);

    const halfWorld = this.radius * (0.035 + 0.05 * clamp01(this.viewAu / NEAR_SURFACE_AU));
    const halfAng = halfWorld / this.radius;
    const surfR = this.radius * (1 + 0.5 * this.getDisplacement());

    for (let i = 0; i < this.bricks.length; i++) {
      const ang = (i / this.bricks.length) * Math.PI * 2;
      const ox = Math.cos(ang) * halfWorld * 1.15;
      const oz = Math.sin(ang) * halfWorld * 1.15;
      const tx = this._dir.z, tz = -this._dir.x;
      const tlen = Math.hypot(tx, tz) || 1;
      const px = this._dir.x * surfR + (tx / tlen) * ox;
      const py = this._dir.y * surfR;
      const pz = this._dir.z * surfR + (tz / tlen) * oz;
      const pl = Math.hypot(px, py, pz) || 1;
      const b = this.bricks[i];
      const nx = px / pl, ny = py / pl, nz = pz / pl;
      const dot = b.center.x * nx + b.center.y * ny + b.center.z * nz;
      if (dot < 0.9994) b.dirty = true;
      b.center.set(nx, ny, nz);
      b.mesh.position.set(nx * surfR, ny * surfR, nz * surfR);
      b.mesh.scale.setScalar(halfWorld / (this.radius * 0.06));
      // Hide until first bake lands — masks empty/black brick hitch.
      // Warm phase bakes maps but stays invisible until engage.
      const ready = !b.dirty;
      b.mesh.visible = this.engaged && this.blend > 0.02 && ready;
      b.mat.uniforms.uBlend.value = (this.engaged && ready) ? this.blend : 0;
      b.mat.uniforms.uDisplacement.value = this.getDisplacement();
      b.mat.uniforms.uSeaLevel.value = bundle.params.seaLevel;
      b.mat.uniforms.uBrickHalf.value = halfWorld;
      (b.mat.uniforms.uBrickCenterObj.value as Vector3).set(nx, ny, nz);
      (b.mat.uniforms.uSunDir.value as Vector3).copy(sunDir);
    }

    if (allowBake) this.bakeOne(halfAng);
  }

  private bakeOne(halfAng: number): void {
    const n = this.bricks.length;
    const t0 = performance.now();
    for (let k = 0; k < n; k++) {
      const i = (this.bakeCursor + k) % n;
      const b = this.bricks[i];
      if (!b.dirty) continue;
      this.bakeCursor = (i + 1) % n;
      const bundle = this.getBundle();
      const center: Vec3 = [b.center.x, b.center.y, b.center.z];
      const res = SURFACE_BAKE_RES_STREAM; // keep voxel bake cheap; heightfield owns detail
      const maps = bakeSurfaceBrickMaps(bundle, center, halfAng, res);

      b.heightTex.dispose();
      const heightTex = new DataTexture(
        maps.heightRGBA as unknown as BufferSource,
        res, res, RGBAFormat, UnsignedByteType,
      );
      heightTex.magFilter = LinearFilter;
      heightTex.minFilter = LinearFilter;
      heightTex.wrapS = ClampToEdgeWrapping;
      heightTex.wrapT = ClampToEdgeWrapping;
      heightTex.flipY = false;
      heightTex.needsUpdate = true;
      b.heightTex = heightTex;
      b.mat.uniforms.uHeightMap.value = heightTex;

      b.albedoTex.dispose();
      const albedoTex = new DataTexture(
        maps.albedo as unknown as BufferSource,
        res, res, RGBAFormat, UnsignedByteType,
      );
      albedoTex.magFilter = LinearFilter;
      albedoTex.minFilter = LinearFilter;
      albedoTex.wrapS = ClampToEdgeWrapping;
      albedoTex.wrapT = ClampToEdgeWrapping;
      albedoTex.flipY = false;
      albedoTex.needsUpdate = true;
      b.albedoTex = albedoTex;
      b.mat.uniforms.uAlbedoMap.value = albedoTex;
      b.dirty = false;
      if (performance.now() - t0 > SURFACE_BAKE_MS_BUDGET) break;
      break; // one brick / frame
    }
  }

  dispose(): void {
    for (const b of this.bricks) {
      b.mesh.removeFromParent();
      b.heightTex.dispose();
      b.albedoTex.dispose();
      b.mat.dispose();
    }
    this.sharedGeo.dispose();
    this.bricks.length = 0;
  }
}
