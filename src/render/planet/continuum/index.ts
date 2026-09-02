// ContinuumGlobe — lab-only chunked heightfield planet (engine=continuum).

import {
  Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, PlaneGeometry,
  ShaderMaterial, Vector3, Quaternion, BackSide, AdditiveBlending,
} from 'three';
import type { GenPlanet } from '../../../data/system-gen';
import { channel, range } from '../rng';
import { derivePlanetParams, PRESETS, type PlanetRenderParams } from '../presets';
import { MACRO } from '../plates';
import { LodStage, apparentRadiusPx, stageForPx, dotBrightness } from '../lod';
import type { UpdateCtx } from '../globe';
import { createGeneratorBundle, type GeneratorBundle } from '../generators';
import { ChunkPool } from './chunk-pool';
import { ContinuumClouds } from './cloud-voxels';
import { ContinuumSurfaceVoxels } from './surface-voxels';
import { applyApproachFlightCamera, type ApproachCameraLike } from './approach-camera';
import { removeChunkHud, updateChunkHud } from './debug-chunks';
import type { Vec3 } from '../cube-sphere';
import { continuumAtmosFrag, continuumAtmosVert } from './shaders';

const _planetWorld = new Vector3();
const _worldScale = new Vector3();
const _camLocal = new Vector3();
const _camTilt = new Vector3();
const _tmpSun = new Vector3();
const _sunObj = new Vector3();
const _viewAxis = new Vector3();
const _camRight = new Vector3();
const _camUp = new Vector3();
const _q = new Quaternion();

export type LabEngine = 'legacy' | 'continuum';

/**
 * Scratch Continuum: cube-sphere heightfield chunks + generator providers.
 * No atlas bake / path-trace. Legacy PlanetGlobe remains shipping default.
 */
export class ContinuumGlobe {
  readonly root = new Group();
  params: PlanetRenderParams;
  private seed: number;
  private bundle: GeneratorBundle;
  private readonly tiltGroup = new Group();
  private readonly spinGroup = new Group();
  private readonly surfaceGroup = new Group();
  private readonly chunkPool: ChunkPool | null;
  private readonly clouds: ContinuumClouds | null;
  private readonly surfaceVoxels: ContinuumSurfaceVoxels | null;
  private readonly atmosMesh: Mesh | null = null;
  private readonly atmosMat: ShaderMaterial | null = null;
  private readonly giantMesh: Mesh | null = null;
  private readonly impostorMesh: Mesh;
  private readonly impostorMat: ShaderMaterial;
  private readonly impostorColor: [number, number, number];
  private readonly spinRate: number;
  private spinPaused = false;
  private cloudsVisible = true;
  private showChunks = false;
  private viewAu = 0.8;
  private lodForced = true;
  private lastFp = '';

  constructor(
    readonly planet: GenPlanet,
    readonly radius: number,
  ) {
    this.seed = planet.seed;
    this.params = derivePlanetParams(planet);
    this.bundle = createGeneratorBundle(planet);
    this.lastFp = this.bundle.fingerprint();
    this.root.name = `continuum-${planet.seed}`;
    this.root.userData.type = 'planet-globe';
    this.root.userData.seed = planet.seed;
    this.root.userData.planetType = planet.type;
    this.root.userData.bodyRadius = radius;
    this.root.userData.engine = 'continuum';

    const rng = channel(planet.seed >>> 0, 'orient');
    this.tiltGroup.rotation.z = range(rng, -0.5, 0.5);
    this.spinRate = range(rng, 0.02, 0.12) * (rng() < 0.1 ? -1 : 1);
    this.root.add(this.tiltGroup);
    this.tiltGroup.add(this.spinGroup);
    this.spinGroup.add(this.surfaceGroup);

    if (this.params.isGiant) {
      this.chunkPool = null;
      this.clouds = null;
      this.surfaceVoxels = null;
      const col = this.params.bandColorA ?? [0.55, 0.5, 0.45];
      this.giantMesh = new Mesh(
        new IcosahedronGeometry(radius, 4),
        new MeshBasicMaterial({ color: 0x887766 }),
      );
      (this.giantMesh.material as MeshBasicMaterial).color.setRGB(col[0], col[1], col[2]);
      this.spinGroup.add(this.giantMesh);
    } else {
      this.chunkPool = new ChunkPool(
        radius,
        () => this.bundle,
        () => this.params.displacement,
      );
      this.surfaceGroup.add(this.chunkPool.group);
      this.clouds = new ContinuumClouds(radius, () => this.bundle);
      this.spinGroup.add(this.clouds.group);
      this.surfaceVoxels = new ContinuumSurfaceVoxels(
        radius,
        () => this.bundle,
        () => this.params.displacement,
      );
      this.spinGroup.add(this.surfaceVoxels.group);
      this.atmosMat = this.buildAtmosMat();
      // detail 7 — dusty rocky limb was still reading as a faceted band at 6.
      this.atmosMesh = new Mesh(new IcosahedronGeometry(radius * 1.028, 7), this.atmosMat);
      this.atmosMesh.name = 'continuum-atmos';
      this.root.add(this.atmosMesh);
    }

    this.impostorColor = this.baseColor();
    this.impostorMat = this.buildImpostorMat();
    this.impostorMesh = new Mesh(new PlaneGeometry(2, 2), this.impostorMat);
    this.impostorMesh.frustumCulled = false;
    this.root.add(this.impostorMesh);
  }

  setSpinPaused(p: boolean): void { this.spinPaused = p; }
  get isSpinPaused(): boolean { return this.spinPaused; }

  setCloudsVisible(on: boolean): void {
    this.cloudsVisible = on;
    this.clouds?.setVisible(on);
  }
  get areCloudsVisible(): boolean { return this.cloudsVisible; }

  setShowChunks(on: boolean): void {
    this.showChunks = on;
    this.chunkPool?.setShowChunks(on);
  }
  get showChunksOn(): boolean { return this.showChunks; }

  setViewDistanceAu(au: number): void {
    this.viewAu = au;
    this.clouds?.setViewDistanceAu(au);
    this.surfaceVoxels?.setViewDistanceAu(au);
    this.chunkPool?.setViewDistanceAu(au);
  }

  /** Lab / perf-capture compatibility — Continuum has no eroded atlas bake. */
  setBaked(_on: boolean, _params?: unknown): void {
    if (_on) this.invalidateChunks();
  }

  /** Lab compatibility no-ops (atlas/PT retired). */
  setLiveAuthoring(_on: boolean): void { /* chunk invalidation via refreshParams */ }
  rebuildAtlases(_opts?: unknown): void { this.invalidateChunks(); }
  setLightingMode(_mode: string): void { /* retired */ }
  setDebugFace(_on: boolean): void { /* retired — use setShowChunks */ }
  getPathTraceSamples(): number { return 0; }
  renderOverlays(_renderer: unknown, _camera: unknown): void { /* none */ }

  invalidateChunks(): void {
    this.chunkPool?.invalidate();
    this.surfaceVoxels?.invalidate();
    this.lodForced = true;
  }

  nudgeRotation(yaw: number, pitch: number): void {
    if (yaw) this.spinGroup.rotateY(yaw);
    if (pitch) this.tiltGroup.rotateX(pitch);
  }

  /** Accept harness / HUD stats (null when giant impostor path). */
  hudStats() {
    return this.chunkPool?.hud() ?? null;
  }

  stormsMature(): void {
    // Weather provider regenerates slots; nudge clock by invalidating.
    this.bundle.weather.invalidate();
  }

  reseed(seed: number): void {
    this.seed = seed;
    this.planet.seed = seed;
    this.bundle = createGeneratorBundle({ ...this.planet, seed });
    this.params = this.bundle.params;
    this.lastFp = this.bundle.fingerprint();
    this.invalidateChunks();
  }

  refreshParams(): void {
    // Lab mutates PRESETS in place. Prefer those knobs over seed-jittered derive
    // so Continuum remeshes when Base humidity / lush / drying sliders move.
    const derived = derivePlanetParams(this.planet);
    const base = PRESETS[this.planet.type] ?? PRESETS.rocky;
    this.params = {
      ...derived,
      moisture: base.moisture,
      aridBelts: base.aridBelts,
      rainShadow: base.rainShadow,
      orographic: base.orographic,
      lapseRate: base.lapseRate,
      treeline: base.treeline,
      windBearing: base.windBearing,
      continental: base.continental,
      altitudeDry: base.altitudeDry,
      patchiness: base.patchiness,
      lushDepth: base.lushDepth,
      snowfall: base.snowfall,
      latitudeIce: base.latitudeIce,
      seaLevel: base.seaLevel,
      displacement: base.displacement,
      ridged: base.ridged,
      warp: base.warp,
      roughness: base.roughness,
      nightLights: base.nightLights,
      hasAtmosphere: base.hasAtmosphere,
      atmosphere: base.atmosphere,
      atmosphereDensity: base.atmosphereDensity,
      oceanShallow: base.oceanShallow,
      oceanDeep: base.oceanDeep,
      ramp: base.ramp,
      cloudCover: base.cloudCover,
      cloudShadow: base.cloudShadow,
      cloudFlow: base.cloudFlow,
      cloudTurb: base.cloudTurb,
      cyclones: base.cyclones,
      cloudTerrain: base.cloudTerrain,
      cloudDetail: base.cloudDetail,
      cloudSpeed: base.cloudSpeed,
      cycloneSize: base.cycloneSize,
      cloudWisp: base.cloudWisp,
      cloudRegion: base.cloudRegion,
      lightning: base.lightning,
    };
    this.bundle.refreshParams(this.params, { ...MACRO[this.params.type] });
    if (this.atmosMat) {
      const u = this.atmosMat.uniforms;
      (u.uColor.value as Vector3).set(...this.params.atmosphere);
      u.uDensity.value = this.params.hasAtmosphere ? this.params.atmosphereDensity : 0;
    }
    // Only remesh when heightfield / albedo identity moved (cloud-only is live).
    const fp = this.bundle.fingerprint();
    if (fp !== this.lastFp) {
      this.lastFp = fp;
      this.invalidateChunks();
    }
  }

  update(ctx: UpdateCtx): void {
    if (!this.spinPaused) this.spinGroup.rotateY(this.spinRate * ctx.dt);

    this.root.getWorldPosition(_planetWorld);
    this.root.getWorldScale(_worldScale);
    const worldRadius = this.radius * _worldScale.x;
    const dist = ctx.camera.position.distanceTo(_planetWorld);
    const px = apparentRadiusPx(worldRadius, dist, ctx.fovYRad, ctx.viewportH);
    const stage = stageForPx(px);

    const sunDir = _tmpSun.copy(ctx.sunWorldPos).sub(_planetWorld);
    if (sunDir.lengthSq() < 1e-12) sunDir.set(0, 0, 1); else sunDir.normalize();

    const near = stage === LodStage.Globe;
    this.surfaceGroup.visible = near;
    if (this.giantMesh) this.giantMesh.visible = near;
    if (this.clouds) this.clouds.group.visible = near && this.cloudsVisible;
    if (this.atmosMesh) {
      this.atmosMesh.visible = near && this.params.hasAtmosphere && this.params.atmosphereDensity > 0.01;
      if (this.atmosMat) {
        (this.atmosMat.uniforms.uSunDir.value as Vector3).copy(sunDir);
        // I1 — camera-to-planet direction, same (unrotated) frame as uSunDir
        // (atmosMesh hangs off `root`, not the tilt/spin groups), so the shader
        // can tell a day/night pose (sun ~ ±viewAxis, degenerate false-terminator
        // ring) from a lateral/terminator pose (sun ⟂ viewAxis, real arc).
        const viewAxis = _viewAxis.copy(ctx.camera.position).sub(_planetWorld);
        if (viewAxis.lengthSq() < 1e-12) viewAxis.set(0, 0, 1); else viewAxis.normalize();
        (this.atmosMat.uniforms.uViewAxis.value as Vector3).copy(viewAxis);
      }
    }
    this.impostorMesh.visible = !near;

    if (near) {
      // C4 — fly parallel to the surface once inside atmosphere.
      applyApproachFlightCamera(
        ctx.camera as unknown as ApproachCameraLike,
        _planetWorld,
        this.viewAu,
      );

      this.root.updateMatrixWorld(false);
      this.surfaceGroup.worldToLocal(_camLocal.copy(ctx.camera.position));
      this.tiltGroup.worldToLocal(_camTilt.copy(ctx.camera.position));

      if (this.chunkPool) {
        this.chunkPool.setSunDir(sunDir.x, sunDir.y, sunDir.z);
        this.chunkPool.setSurfaceLook(this.params.roughness, this.params.nightLights);
        const cam: Vec3 = [_camLocal.x, _camLocal.y, _camLocal.z];
        const tilt: Vec3 = [_camTilt.x, _camTilt.y, _camTilt.z];
        // Object-space sun for cloud-shadow ray (matches ContinuumClouds).
        this.spinGroup.getWorldQuaternion(_q);
        _sunObj.copy(sunDir).applyQuaternion(_q.clone().invert());
        this.chunkPool.setSunDirObj(_sunObj.x, _sunObj.y, _sunObj.z);

        if (this.clouds && this.cloudsVisible) {
          this.clouds.update(ctx.dt, _sunObj, _camLocal);
        }
        // Schedule and drain the current camera's cover before surface voxels
        // decide whether they may spend a CPU bake this frame.
        this.chunkPool.updateLod(cam, tilt, this.spinGroup.rotation.y, this.lodForced);
        this.lodForced = false;
        this.chunkPool.tick(ctx.dt);
        const stream = this.chunkPool.isStreaming || this.chunkPool.pendingCount > 0;
        if (this.surfaceVoxels) {
          // Warm/bake voxels when cover quiet; allow one warm bake even with light pending.
          const allowVoxel = !stream || this.chunkPool.pendingCount <= 2;
          this.surfaceVoxels.update(ctx.dt, _sunObj, _camLocal, { allowBake: allowVoxel });
          this.chunkPool.setVoxelBlend(stream ? 0 : this.surfaceVoxels.voxelBlend);
        }
        const shadowOn = this.cloudsVisible ? this.params.cloudShadow : 0;
        const coverOn = this.cloudsVisible ? this.params.cloudCover : 0;
        this.chunkPool.setCloudLook({
          cover: coverOn,
          shadow: shadowOn,
          time: this.clouds?.cloudTime ?? 0,
          flow: this.params.cloudFlow,
          detail: this.params.cloudDetail,
        });
        this.chunkPool.setAerialLook(
          this.params.atmosphere,
          this.params.hasAtmosphere ? this.params.atmosphereDensity : 0,
        );
        this.chunkPool.setWorldRadius(worldRadius);

      } else if (this.clouds && this.cloudsVisible) {
        this.spinGroup.getWorldQuaternion(_q);
        _sunObj.copy(sunDir).applyQuaternion(_q.invert());
        this.clouds.update(ctx.dt, _sunObj, _camLocal);
      }
    } else {
      const e = ctx.camera.matrixWorld.elements;
      _camRight.set(e[0], e[1], e[2]).normalize();
      _camUp.set(e[4], e[5], e[6]).normalize();
      const u = this.impostorMat.uniforms;
      u.uCenter.value.copy(_planetWorld);
      u.uRight.value.copy(_camRight);
      u.uUp.value.copy(_camUp);
      u.uRadius.value = worldRadius;
      u.uSunDir.value.copy(sunDir);
      const b = dotBrightness(px);
      u.uColor.value.set(
        this.impostorColor[0] * b,
        this.impostorColor[1] * b,
        this.impostorColor[2] * b,
      );
    }

    if (this.chunkPool) updateChunkHud(this.chunkPool.hud());
  }

  dispose(): void {
    this.root.removeFromParent();
    this.chunkPool?.dispose();
    this.clouds?.dispose();
    this.surfaceVoxels?.dispose();
    this.giantMesh?.geometry.dispose();
    (this.giantMesh?.material as MeshBasicMaterial | undefined)?.dispose();
    this.atmosMesh?.geometry.dispose();
    this.atmosMat?.dispose();
    this.impostorMesh.geometry.dispose();
    this.impostorMat.dispose();
    removeChunkHud();
  }

  private baseColor(): [number, number, number] {
    const ramp = this.params.ramp;
    if (ramp?.length) return [...ramp[Math.min(2, ramp.length - 1)].color] as [number, number, number];
    return [0.35, 0.4, 0.45];
  }

  private buildAtmosMat(): ShaderMaterial {
    const p = this.params;
    return new ShaderMaterial({
      transparent: true,
      blending: AdditiveBlending,
      side: BackSide,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uSunDir: { value: new Vector3(0.6, 0.35, 0.72) },
        uColor: { value: new Vector3(...p.atmosphere) },
        uDensity: { value: p.hasAtmosphere ? p.atmosphereDensity : 0 },
        uViewAxis: { value: new Vector3(0, 0, 1) },
      },
      vertexShader: continuumAtmosVert,
      fragmentShader: continuumAtmosFrag,
    });
  }

  private buildImpostorMat(): ShaderMaterial {
    return new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uCenter: { value: new Vector3() },
        uRight: { value: new Vector3() },
        uUp: { value: new Vector3() },
        uRadius: { value: 1 },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uColor: { value: new Vector3(...this.impostorColor) },
      },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        uniform vec3 uCenter; uniform vec3 uRight; uniform vec3 uUp; uniform float uRadius;
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          vec3 pos = uCenter + (uRight * vUv.x + uUp * vUv.y) * uRadius * 1.05;
          gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uSunDir; uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float r2 = dot(vUv, vUv);
          if (r2 > 1.0) discard;
          #include <logdepthbuf_fragment>
          float z = sqrt(max(0.0, 1.0 - r2));
          vec3 n = normalize(vec3(vUv, z));
          float ndl = clamp(dot(n, normalize(uSunDir)), 0.0, 1.0) * 0.7 + 0.3;
          float a = smoothstep(1.0, 0.92, r2);
          gl_FragColor = vec4(uColor * ndl, a);
        }`,
    });
  }
}
