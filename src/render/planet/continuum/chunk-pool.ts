import {
  Group, Mesh, LineBasicMaterial, ShaderMaterial, LineSegments, Vector3, DoubleSide,
  DataTexture, RGBAFormat, UnsignedByteType, LinearFilter, LinearMipmapLinearFilter,
  ClampToEdgeWrapping,
  type BufferGeometry, type Texture,
} from 'three';
import { nodeCenterDir, nodeId, type QuadNode, type Vec3 } from '../cube-sphere';
import type { GeneratorBundle } from '../generators';
import { sampleHeightfieldChunk } from './chunk-sample';
import { makeChunkOutlineLines, meshHeightfieldChunk } from './chunk-mesher';
import { isDescendant, prefetchApproachLeaves, selectChunkLeaves, sortLeavesByFacing, uniformLevelForDistance } from './chunk-lod';
import {
  CHUNK_BUILDS_PER_FRAME, CHUNK_BUILD_MS_BUDGET, LOD_FADE_SEC, LOD_HYSTERESIS,
  LOD_MIN_REBUILD_MS, LOD_SPIN_ANGLE, LOD_STICKY_MOVING, LOD_STICKY_PASSES,
  LOD_ZOOM_HYSTERESIS, MAX_RESIDENT_CHUNKS, MAX_WARM_CHUNKS, APPROACH_COVER_AU,
  APPROACH_COVER_SLA_SEC,
  nodeFromKey, nodeKey, parentNodeKey,
  texResCoarseForLevel, texResStreamForLevel, texResNextUpgrade, texResCeilingForAu,
  meshGridForLevel, meshGridStreamForLevel, type ChunkHudStats,
} from './chunk-types';
import { continuumSurfaceFrag, continuumSurfaceVert } from './shaders';
import { estimateCoverSeconds } from './stream-metrics';

interface Resident {
  node: QuadNode;
  mesh: Mesh;
  mat: ShaderMaterial;
  wire: LineSegments | null;
  geo: BufferGeometry;
  albedoTex: Texture;
  texRes: number;
  fingerprint: string;
  lastUsed: number;
  fade: number;
  fadeTarget: number;
  /** Prefetched for a closer zoom — keep resident even when not in desired. */
  warm: boolean;
}

export interface ChunkBuildQualityInput {
  coverPending: boolean;
  forceStream: boolean;
  warm: boolean;
  streaming: boolean;
}

/**
 * First cover must never take an albedo upgrade or full-resolution path.
 * Keeping this pure makes the cover quality contract unit-testable.
 */
export function selectChunkBuildQuality(
  level: number,
  input: ChunkBuildQualityInput,
): { texRes: number; meshGrid: number; allowUpgrade: boolean } {
  const streamOnly = input.coverPending || input.forceStream;
  const stream = streamOnly || input.warm || input.streaming;
  return {
    texRes: stream ? texResStreamForLevel(level) : texResCoarseForLevel(level),
    meshGrid: stream ? meshGridStreamForLevel(level) : meshGridForLevel(level),
    allowUpgrade: !streamOnly,
  };
}

/**
 * Streaming heightfield chunk residency.
 * Parents stay until children ready; dithered fade softens LOD swaps.
 */
export class ChunkPool {
  readonly group = new Group();
  readonly debugGroup = new Group();

  private readonly residents = new Map<string, Resident>();
  private readonly pending: QuadNode[] = [];
  private pendingSet = new Set<string>();
  /** Idle warm queue — approach ladder, built after cover is quiet. */
  private readonly warmPending: QuadNode[] = [];
  private warmPendingSet = new Set<string>();
  private desired: QuadNode[] = [];
  private desiredKeys = new Set<string>();
  private warmKeys = new Set<string>();
  private fingerprint = '';
  private showChunks = false;
  private frame = 0;
  private building = 0;
  private lodCamTilt: Vec3 | null = null;
  private lodCamLocal: Vec3 = [0, 0, 2];
  private lodDist = 0;
  private lodUniformLevel = -2;
  private lodSpinYaw = 0;
  private lodAt = 0;
  private tris = 0;
  /** Ideal keys from the last select (before sticky merge). */
  private prevIdealKeys = new Set<string>();
  /** Passes a leaf has been outside the ideal set. */
  private stickyMiss = new Map<string, number>();
  /** Smoothed camera angular speed (rad / lod-update). */
  private camMoveEMA = 0;
  private moving = false;
  /** True while zooming / backlog — cheap cover only (masks approach hitch). */
  private streaming = false;
  /** Start time for the active visible-cover backlog. */
  private coverStartedAt = 0;
  /** HUD AU from ContinuumGlobe — drives mid-orbit view-LOD. */
  private viewAu = 0.8;
  /** Frames since zoom/move stopped — gates expensive albedo polish. */
  private settledFrames = 0;
  /** EMA throughput for stream-quality cover builds, initialized conservatively. */
  private streamBuildsPerSec = 1;

  private readonly surfaceMat: ShaderMaterial;
  private readonly dummyAlbedo: DataTexture;
  private readonly wireMatCache = new Map<number, LineBasicMaterial>();
  private readonly _sun = new Vector3(0.6, 0.35, 0.72);
  private readonly _sunObj = new Vector3(0.6, 0.35, 0.72);

  constructor(
    private radius: number,
    private getBundle: () => GeneratorBundle,
    private getDisplacement: () => number,
  ) {
    this.group.name = 'continuum-chunks';
    this.debugGroup.name = 'continuum-chunk-debug';
    this.group.add(this.debugGroup);

    // Keep a real sampler bound at compile time so shared-material swaps work.
    this.dummyAlbedo = new DataTexture(
      new Uint8Array([32, 48, 40, 0]), 1, 1, RGBAFormat, UnsignedByteType,
    );
    this.dummyAlbedo.needsUpdate = true;

    this.surfaceMat = new ShaderMaterial({
      vertexShader: continuumSurfaceVert,
      fragmentShader: continuumSurfaceFrag,
      // Linear HDR into composer → AgX OutputPass (C2). Avoid double tonemap.
      toneMapped: false,
      uniforms: {
        uSunDir: { value: this._sun },
        uSunDirObj: { value: this._sunObj },
        uDebugChunks: { value: 0 },
        uFade: { value: 1 },
        uAlbedoMap: { value: this.dummyAlbedo },
        uUseAlbedoMap: { value: 1 },
        uRoughness: { value: 0.4 },
        uNightLights: { value: 0 },
        uCloudCover: { value: 0 },
        uCloudShadow: { value: 0 },
        uCloudTime: { value: 0 },
        uCloudFlow: { value: 0.7 },
        uCloudDetail: { value: 1 },
        uAtmosColor: { value: new Vector3(0.45, 0.62, 0.95) },
        uAtmosDensity: { value: 0 },
        uPlanetRadius: { value: radius },
        uVoxelBlend: { value: 0 },
      },
      side: DoubleSide,
    });
  }

  setShowChunks(on: boolean): void {
    this.showChunks = on;
    const v = on ? 1 : 0;
    this.surfaceMat.uniforms.uDebugChunks.value = v;
    for (const r of this.residents.values()) {
      r.mat.uniforms.uDebugChunks.value = v;
      if (on && !r.wire && r.fingerprint === this.fingerprint) {
        this.attachOutline(r);
      }
      if (r.wire) r.wire.visible = on && r.mesh.visible && r.fade > 0.05;
    }
  }

  get showChunksOn(): boolean { return this.showChunks; }

  setViewDistanceAu(au: number): void {
    this.viewAu = au;
  }

  /** Build queue depth — surface voxels wait until this is quiet. */
  get pendingCount(): number { return this.pending.length; }

  /** Approach stream gate: coarsen LOD + skip polish / voxel bakes. */
  get isStreaming(): boolean { return this.streaming; }

  setSunDir(x: number, y: number, z: number): void {
    this._sun.set(x, y, z);
  }

  setSunDirObj(x: number, y: number, z: number): void {
    this._sunObj.set(x, y, z);
  }

  setSurfaceLook(roughness: number, nightLights: number): void {
    this.surfaceMat.uniforms.uRoughness.value = roughness;
    this.surfaceMat.uniforms.uNightLights.value = nightLights;
    for (const r of this.residents.values()) {
      r.mat.uniforms.uRoughness.value = roughness;
      r.mat.uniforms.uNightLights.value = nightLights;
    }
  }

  /** Live cloud shadow uniforms — shadowStrength 0 when clouds hidden. */
  setCloudLook(opts: {
    cover: number;
    shadow: number;
    time: number;
    flow: number;
    detail: number;
  }): void {
    const apply = (u: ShaderMaterial['uniforms']): void => {
      u.uCloudCover.value = opts.cover;
      u.uCloudShadow.value = opts.shadow;
      u.uCloudTime.value = opts.time;
      u.uCloudFlow.value = opts.flow;
      u.uCloudDetail.value = opts.detail;
    };
    apply(this.surfaceMat.uniforms);
    for (const r of this.residents.values()) apply(r.mat.uniforms);
  }

  /** C3 aerial haze — matches limb atmos color/density. */
  setAerialLook(color: readonly [number, number, number], density: number): void {
    const apply = (u: ShaderMaterial['uniforms']): void => {
      (u.uAtmosColor.value as Vector3).set(color[0], color[1], color[2]);
      u.uAtmosDensity.value = density;
    };
    apply(this.surfaceMat.uniforms);
    for (const r of this.residents.values()) apply(r.mat.uniforms);
  }

  /** World-space planet radius (lab scales the root; must match cameraPosition units). */
  setWorldRadius(worldRadius: number): void {
    this.surfaceMat.uniforms.uPlanetRadius.value = worldRadius;
    for (const r of this.residents.values()) {
      r.mat.uniforms.uPlanetRadius.value = worldRadius;
    }
  }

  /** B4 soft handoff — mute near-camera heightfield when surface voxels engage. */
  setVoxelBlend(blend: number): void {
    this.surfaceMat.uniforms.uVoxelBlend.value = blend;
    for (const r of this.residents.values()) {
      r.mat.uniforms.uVoxelBlend.value = blend;
    }
  }

  invalidate(): void {
    this.fingerprint = this.getBundle().fingerprint();
    this.pending.length = 0;
    this.pendingSet.clear();
    this.warmPending.length = 0;
    this.warmPendingSet.clear();
    this.warmKeys.clear();
    for (const n of this.desired) this.enqueueWithAncestors(n);
    this.updateCoverClock();
    this.lodCamTilt = null;
    this.lodDist = 0;
    this.lodUniformLevel = -2;
    this.prevIdealKeys.clear();
    this.stickyMiss.clear();
  }

  /**
   * Reselect leaves.
   * Orbit / mid-distance: whole-planet uniform LOD — only reselect on ZOOM.
   * Close approach: view-dependent LOD (horizon cull) with sticky leaves.
   */
  updateLod(camLocal: Vec3, camTilt: Vec3, spinYaw: number, force = false): void {
    const now = performance.now();
    this.lodCamLocal = camLocal;
    const dist = Math.hypot(camLocal[0], camLocal[1], camLocal[2]);
    const near = dist / Math.max(this.radius, 1e-6);
    const closeBand = this.viewAu <= 0.5 || near < 2.2;

    if (this.lodCamTilt) {
      const a = norm3(this.lodCamTilt);
      const b = norm3(camTilt);
      const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
      const ang = Math.acos(dot);
      this.camMoveEMA = this.camMoveEMA * 0.7 + ang * 0.3;
    }
    this.moving = this.camMoveEMA > 0.04;
    const zooming = this.lodDist > 0
      && Math.abs(dist - this.lodDist) > this.radius * 0.025;
    // Stay in stream mode until cover catches up (FPS §7: polish never steals cover).
    this.streaming = this.moving || zooming || this.pending.length > 4;

    const uniformLevel = uniformLevelForDistance(dist, this.radius, this.viewAu);
    const orbitMode = uniformLevel >= 0;

    if (orbitMode) {
      // Zoom-sticky: orbiting never rebuilds the leaf set.
      const zoomed = this.lodDist <= 0
        || Math.abs(dist - this.lodDist) > this.radius * LOD_ZOOM_HYSTERESIS
        || uniformLevel !== this.lodUniformLevel;
      if (!force && this.desired.length && !zoomed) {
        // Keep streaming any not-yet-built preload leaves.
        this.lodCamTilt = camTilt;
        this.streaming = this.pending.length > 4;
        this.queueWarmPrefetch();
        return;
      }
      this.lodCamTilt = camTilt;
      this.lodSpinYaw = spinYaw;
      this.lodAt = now;
      this.lodDist = dist;
      this.lodUniformLevel = uniformLevel;
      this.fingerprint = this.getBundle().fingerprint();

      const ideal = selectChunkLeaves({
        camLocal,
        radius: this.radius,
        maxElevation: this.getDisplacement() * 0.5 + 0.01,
        viewAu: this.viewAu,
      });
      this.applyIdeal(ideal);
      this.streaming = this.pending.length > 4;
      this.queueWarmPrefetch();
      return;
    }

    // Close view-LOD — refresh faster near surface so rotate does not hole-punch.
    this.lodUniformLevel = -1;
    const hyst = closeBand ? this.radius * LOD_HYSTERESIS * 0.28 : this.radius * LOD_HYSTERESIS;
    const spinGate = closeBand ? 0.14 : LOD_SPIN_ANGLE;
    const coolMs = closeBand
      ? (this.moving || zooming ? 90 : 60)
      : (this.moving || zooming ? LOD_MIN_REBUILD_MS * 1.5 : LOD_MIN_REBUILD_MS);
    const camMoved = !this.lodCamTilt || Math.hypot(
      camTilt[0] - this.lodCamTilt[0],
      camTilt[1] - this.lodCamTilt[1],
      camTilt[2] - this.lodCamTilt[2],
    ) > hyst;
    let spinDelta = Math.abs(spinYaw - this.lodSpinYaw) % (Math.PI * 2);
    if (spinDelta > Math.PI) spinDelta = Math.PI * 2 - spinDelta;
    const spun = spinDelta > spinGate;
    const cooled = now - this.lodAt >= coolMs;
    const zoomed = this.lodDist <= 0
      || Math.abs(dist - this.lodDist) > this.radius * LOD_ZOOM_HYSTERESIS;
    // Force refresh if cover is incomplete (holes waiting on stale desired).
    const coverHoles = this.pending.length > 12 && cooled;
    if (!force && this.desired.length && !(((camMoved || spun) && cooled) || zoomed || coverHoles)) {
      this.lodCamTilt = camTilt;
      this.streaming = this.moving || this.pending.length > 4;
      this.queueWarmPrefetch();
      return;
    }

    this.lodCamTilt = camTilt;
    this.lodSpinYaw = spinYaw;
    this.lodAt = now;
    this.lodDist = dist;
    this.fingerprint = this.getBundle().fingerprint();

    // Stream only cheapens builds — selection stays full coverage (padded horizon).
    const motionScale = this.streaming ? 1.25 + Math.min(0.8, this.camMoveEMA * 5) : 1;
    const ideal = selectChunkLeaves({
      camLocal,
      radius: this.radius,
      maxElevation: this.getDisplacement() * 0.5 + 0.01,
      motionScale,
      streamPressure: this.streaming,
      viewAu: this.viewAu,
    });
    this.applyIdeal(ideal, true);
    this.streaming = this.moving || zooming || this.pending.length > 4;
    this.queueWarmPrefetch();
  }

  /** Idle warm: bake the next zoom ladder so approach does not hitch. */
  private queueWarmPrefetch(): void {
    if (this.pending.length > 2) return; // cover first
    const warmIdeal = prefetchApproachLeaves({
      camLocal: this.lodCamLocal,
      radius: this.radius,
      maxElevation: this.getDisplacement() * 0.5 + 0.01,
      viewAu: this.viewAu,
    });
    const nextWarm = new Set<string>();
    let warmCount = 0;
    for (const r of this.residents.values()) {
      if (r.warm && r.fingerprint === this.fingerprint) warmCount++;
    }
    const room = Math.max(0, MAX_WARM_CHUNKS - warmCount);
    if (room <= 0 && this.warmPending.length === 0) {
      // Still refresh warmKeys for eviction protection on existing.
      for (const n of warmIdeal) {
        const id = nodeKey(n);
        if (this.residents.has(id)) nextWarm.add(id);
      }
      this.warmKeys = nextWarm;
      for (const r of this.residents.values()) {
        r.warm = nextWarm.has(nodeKey(r.node));
      }
      return;
    }

    this.warmPending.length = 0;
    this.warmPendingSet.clear();
    const ranked = sortLeavesByFacing(warmIdeal, this.lodCamLocal);
    let queued = 0;
    for (const n of ranked) {
      const id = nodeKey(n);
      nextWarm.add(id);
      const r = this.residents.get(id);
      if (r && r.fingerprint === this.fingerprint) {
        r.warm = true;
        r.lastUsed = ++this.frame;
        continue;
      }
      if (this.desiredKeys.has(id) || this.pendingSet.has(id)) continue;
      if (queued >= room) continue;
      if (this.warmPendingSet.has(id)) continue;
      this.warmPending.push(n);
      this.warmPendingSet.add(id);
      queued++;
    }
    this.warmKeys = nextWarm;
    for (const r of this.residents.values()) {
      const id = nodeKey(r.node);
      r.warm = nextWarm.has(id) && !this.desiredKeys.has(id);
    }
  }

  private applyIdeal(ideal: QuadNode[], sticky = false): void {
    const idealKeys = new Set(ideal.map(nodeKey));

    const stickyNodes: QuadNode[] = [];
    const stickyKeys = new Set<string>();
    if (sticky) {
      const stickyLimit = this.moving ? LOD_STICKY_MOVING : LOD_STICKY_PASSES;
      for (const n of this.desired) {
        const id = nodeKey(n);
        if (idealKeys.has(id)) {
          this.stickyMiss.delete(id);
          continue;
        }
        // Hold until a ready ideal descendant/sibling cover exists, or miss budget.
        const miss = (this.stickyMiss.get(id) ?? 0) + 1;
        this.stickyMiss.set(id, miss);
        const stillNeeded = miss <= stickyLimit || this.pending.length > 0;
        if (stillNeeded) {
          stickyNodes.push(n);
          stickyKeys.add(id);
        } else {
          this.stickyMiss.delete(id);
        }
      }
      for (const id of idealKeys) this.stickyMiss.delete(id);
    } else {
      this.stickyMiss.clear();
    }

    this.prevIdealKeys = idealKeys;
    this.desired = sticky ? [...ideal, ...stickyNodes] : ideal;
    this.desiredKeys = sticky
      ? new Set([...idealKeys, ...stickyKeys])
      : idealKeys;

    // Promote warm residents that just became desired.
    for (const id of idealKeys) {
      const r = this.residents.get(id);
      if (r && r.fingerprint === this.fingerprint) {
        if (r.warm || r.fade < 0.05) {
          // Prefetch hit — already baked; snap visible (seamless rotate/zoom).
          r.fade = 1;
          r.fadeTarget = 1;
          r.mat.uniforms.uFade.value = 1;
          r.mesh.visible = true;
        }
        r.warm = false;
        r.lastUsed = ++this.frame;
      }
    }

    this.pending.length = 0;
    this.pendingSet.clear();
    for (const n of ideal) {
      const id = nodeKey(n);
      const r = this.residents.get(id);
      if (r && r.fingerprint === this.fingerprint) {
        r.lastUsed = ++this.frame;
        continue;
      }
      this.enqueueWithAncestors(n);
    }
    this.sortPending();
    this.updateCoverClock();
  }

  /** Queue missing ancestors before the leaf (root → … → leaf). */
  private enqueueWithAncestors(leaf: QuadNode): void {
    const chain: QuadNode[] = [];
    let cur: QuadNode | null = leaf;
    while (cur) {
      const id = nodeKey(cur);
      const r = this.residents.get(id);
      if (r && r.fingerprint === this.fingerprint) break;
      chain.push(cur);
      const pk = parentNodeKey(cur);
      cur = pk ? nodeFromKey(pk) : null;
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = chain[i]!;
      const id = nodeKey(n);
      if (this.pendingSet.has(id)) continue;
      this.pending.push(n);
      this.pendingSet.add(id);
    }
  }

  /** Prefer facing, then coarse — keeps the limb filled under camera motion. */
  private sortPending(): void {
    if (this.pending.length < 2) return;
    const cam = norm3(this.lodCamLocal);
    const score = (n: QuadNode): number => {
      const d = nodeCenterDir(n);
      const facing = d[0] * cam[0] + d[1] * cam[1] + d[2] * cam[2];
      return facing * 40 - n.level;
    };
    this.pending.sort((a, b) => score(b) - score(a));
  }

  tick(dt: number): void {
    this.building = 0;
    const t0 = performance.now();
    const coverBacklog = this.pending.length;
    const catchUp = estimateCoverSeconds(coverBacklog, this.streamBuildsPerSec)
      > APPROACH_COVER_SLA_SEC;
    let streamBuilds = 0;
    if (this.moving || this.streaming || coverBacklog > 0) this.settledFrames = 0;
    else this.settledFrames++;

    // Catch-up: drain stream cover fast. Polish waits until cover is quiet.
    const coverHot = coverBacklog > 0 || this.streaming;
    const budget = catchUp
      ? 12
      : (coverHot ? 8 : CHUNK_BUILD_MS_BUDGET);
    const maxBuilds = catchUp
      ? 4
      : (coverBacklog > 0 ? 3 : CHUNK_BUILDS_PER_FRAME);

    while (this.building < maxBuilds && this.pending.length) {
      if (this.building > 0 && performance.now() - t0 >= budget) break;
      const node = this.pending.shift()!;
      const id = nodeKey(node);
      this.pendingSet.delete(id);
      if (!this.desiredKeys.has(id) && !this.coversDesired(node)) continue;
      // Stream-cheap cover while queue/zoom is hot — never force stream just for AU.
      this.buildOne(node, false, /*forceStream*/ coverHot || catchUp);
      this.building++;
      streamBuilds++;
      if (performance.now() - t0 >= budget) break;
    }

    // Idle warm — orbit only, stream-res, tiny queue.
    if (!catchUp && !coverHot && this.pending.length === 0 && this.building < maxBuilds
      && this.viewAu >= 0.7 && this.settledFrames > 30) {
      while (this.building < maxBuilds && this.warmPending.length && performance.now() - t0 < budget) {
        const node = this.warmPending.shift()!;
        const id = nodeKey(node);
        this.warmPendingSet.delete(id);
        if (this.residents.has(id) && this.residents.get(id)!.fingerprint === this.fingerprint) {
          this.residents.get(id)!.warm = true;
          continue;
        }
        if (this.desiredKeys.has(id)) continue;
        this.buildOne(node, true, true);
        this.building++;
      }
    } else if (this.viewAu < APPROACH_COVER_AU || coverHot) {
      this.warmPending.length = 0;
      this.warmPendingSet.clear();
    }

    // Stepped fidelity climb whenever cover is quiet — closer AU raises the ceiling.
    // Do not require a long settle at mid-AU or fidelity freezes on stream-16 forever.
    const canPolish = !catchUp
      && this.pending.length === 0 && !this.moving && this.settledFrames >= 4;
    if (canPolish && this.building < maxBuilds) {
      while (this.building < maxBuilds && performance.now() - t0 < budget) {
        if (!this.upgradeOneAlbedo()) break;
        this.building++;
      }
    }

    this.streaming = this.moving || this.pending.length > 4;
    const elapsedSec = (performance.now() - t0) / 1000;
    if (streamBuilds > 0 && elapsedSec > 0) {
      const instantRate = streamBuilds / elapsedSec;
      this.streamBuildsPerSec = this.streamBuildsPerSec * 0.7 + instantRate * 0.3;
    }
    this.updateCoverClock();

    this.applyVisibility();
    this.stepFades(dt);
    this.lruEvict();
    this.recountTris();
  }

  /** True if any desired leaf is this node or a descendant of it. */
  private coversDesired(node: QuadNode): boolean {
    for (const n of this.desired) {
      if (nodeKey(n) === nodeKey(node) || isDescendant(n, node)) return true;
    }
    return false;
  }

  hud(): ChunkHudStats {
    const byLevel: Record<number, number> = {};
    for (const r of this.residents.values()) {
      if (!r.mesh.visible || r.fade < 0.05) continue;
      byLevel[r.node.level] = (byLevel[r.node.level] ?? 0) + 1;
    }
    const texRes = this.desired
      .map((n) => this.residents.get(nodeKey(n)))
      .filter((r): r is Resident => r?.fingerprint === this.fingerprint)
      .map((r) => r.texRes)
      .sort((a, b) => a - b);
    return {
      resident: this.residents.size,
      pending: this.pending.length + this.warmPending.length,
      coverPending: this.pending.length,
      warmPending: this.warmPending.length,
      building: this.building,
      byLevel,
      tris: this.tris,
      medianTex: median(texRes),
      coverAgeMs: this.coverStartedAt ? performance.now() - this.coverStartedAt : 0,
      streaming: this.streaming,
      showChunks: this.showChunks,
    };
  }

  dispose(): void {
    for (const id of [...this.residents.keys()]) this.evict(id);
    this.surfaceMat.dispose();
    this.dummyAlbedo.dispose();
    for (const m of this.wireMatCache.values()) m.dispose();
    this.wireMatCache.clear();
  }

  private buildOne(node: QuadNode, warm: boolean, forceStream = false): void {
    const id = nodeKey(node);
    if (this.residents.has(id)) this.evict(id);

    const bundle = this.getBundle();
    const quality = selectChunkBuildQuality(node.level, {
      coverPending: this.pending.length > 0,
      forceStream,
      warm,
      streaming: this.streaming,
    });
    const chunk = sampleHeightfieldChunk(bundle, node, {
      texRes: quality.texRes,
      meshGrid: quality.meshGrid,
      skipRelief: true, // coast/relief is idle polish only — too expensive on approach
    });
    const seaLevel = bundle.params.seaLevel;
    const disp = this.getDisplacement();
    const geo = meshHeightfieldChunk(chunk, this.radius, disp, {
      skirts: true,
      seaLevel,
    });

    const albedoTex = new DataTexture(
      chunk.albedoRGBA as unknown as BufferSource,
      chunk.texRes, chunk.texRes, RGBAFormat, UnsignedByteType,
    );
    albedoTex.magFilter = LinearFilter;
    albedoTex.minFilter = LinearMipmapLinearFilter;
    albedoTex.generateMipmaps = true;
    albedoTex.wrapS = ClampToEdgeWrapping;
    albedoTex.wrapT = ClampToEdgeWrapping;
    albedoTex.flipY = false;
    albedoTex.needsUpdate = true;

    // Own material per chunk. Shared ShaderMaterial + onBeforeRender texture
    // swaps still stamp one albedo across every leaf (see video review).
    const mat = this.surfaceMat.clone();
    mat.uniforms.uSunDir.value = this._sun;
    mat.uniforms.uSunDirObj.value = this._sunObj;
    mat.uniforms.uAlbedoMap.value = albedoTex;
    mat.uniforms.uUseAlbedoMap.value = 1;
    mat.uniforms.uDebugChunks.value = this.showChunks ? 1 : 0;
    mat.uniforms.uRoughness.value = this.surfaceMat.uniforms.uRoughness.value;
    mat.uniforms.uNightLights.value = this.surfaceMat.uniforms.uNightLights.value;
    mat.uniforms.uCloudCover.value = this.surfaceMat.uniforms.uCloudCover.value;
    mat.uniforms.uCloudShadow.value = this.surfaceMat.uniforms.uCloudShadow.value;
    mat.uniforms.uCloudTime.value = this.surfaceMat.uniforms.uCloudTime.value;
    mat.uniforms.uCloudFlow.value = this.surfaceMat.uniforms.uCloudFlow.value;
    mat.uniforms.uCloudDetail.value = this.surfaceMat.uniforms.uCloudDetail.value;
    mat.uniforms.uAtmosColor.value = this.surfaceMat.uniforms.uAtmosColor.value.clone();
    mat.uniforms.uAtmosDensity.value = this.surfaceMat.uniforms.uAtmosDensity.value;
    mat.uniforms.uPlanetRadius.value = this.surfaceMat.uniforms.uPlanetRadius.value;
    mat.uniforms.uVoxelBlend.value = this.surfaceMat.uniforms.uVoxelBlend.value;

    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = true;
    mesh.name = `chunk-${id}`;
    this.group.add(mesh);

    // Fade in only when refining a visible parent; snap in for rotate-into-view.
    let parentCovering = false;
    let pk = parentNodeKey(node);
    while (pk) {
      const pr = this.residents.get(pk);
      if (pr && pr.fingerprint === this.fingerprint && pr.fade > 0.4 && pr.mesh.visible) {
        parentCovering = true;
        break;
      }
      const parent = nodeFromKey(pk);
      if (!parent) break;
      pk = parentNodeKey(parent);
    }

    const isWarmOnly = warm && !this.desiredKeys.has(id);
    const fade0 = isWarmOnly ? 0 : (parentCovering ? 0 : 1);
    mat.uniforms.uFade.value = fade0;
    mesh.visible = !isWarmOnly;

    const resident: Resident = {
      node,
      mesh,
      mat,
      wire: null,
      geo,
      albedoTex,
      texRes: chunk.texRes,
      fingerprint: chunk.fingerprint,
      lastUsed: ++this.frame,
      fade: fade0,
      fadeTarget: isWarmOnly ? 0 : 1,
      warm: isWarmOnly,
    };

    if (this.showChunks && !isWarmOnly) {
      resident.wire = makeChunkOutlineLines(
        chunk, this.radius, disp, seaLevel, node.level, this.wireMatCache,
      );
      resident.wire.visible = true;
      this.debugGroup.add(resident.wire);
    }

    this.residents.set(id, resident);
    if (isWarmOnly) this.warmKeys.add(id);
  }

  /** Replace albedo only — stepped climb toward AU ceiling (facing first). */
  private upgradeOneAlbedo(): boolean {
    const cam = norm3(this.lodCamLocal);
    let best: Resident | null = null;
    let bestScore = -1e9;
    let bestNext = 0;
    for (const n of this.desired) {
      const id = nodeKey(n);
      const r = this.residents.get(id);
      if (!r || r.fingerprint !== this.fingerprint || r.fade < 0.5) continue;
      const next = texResNextUpgrade(r.texRes, n.level, this.viewAu);
      if (next <= r.texRes) continue;
      const d = nodeCenterDir(n);
      const facing = d[0] * cam[0] + d[1] * cam[1] + d[2] * cam[2];
      // Facing leaves first; larger steps next; slight bias to coarser current.
      const score = facing * 80 + (next - r.texRes) * 0.5 - r.texRes * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = r;
        bestNext = next;
      }
    }
    if (!best || bestNext <= best.texRes) return false;

    const bundle = this.getBundle();
    const ceiling = texResCeilingForAu(best.node.level, this.viewAu);
    // Relief/coast only on higher steps once we've been quiet a bit.
    const skipRelief = bestNext < 96 || this.settledFrames < 20 || bestNext < ceiling;
    const chunk = sampleHeightfieldChunk(bundle, best.node, {
      texRes: bestNext,
      meshGrid: meshGridForLevel(best.node.level),
      skipRelief,
    });
    const next = new DataTexture(
      chunk.albedoRGBA as unknown as BufferSource,
      chunk.texRes, chunk.texRes, RGBAFormat, UnsignedByteType,
    );
    next.magFilter = LinearFilter;
    next.minFilter = LinearMipmapLinearFilter;
    next.generateMipmaps = true;
    next.wrapS = ClampToEdgeWrapping;
    next.wrapT = ClampToEdgeWrapping;
    next.flipY = false;
    next.needsUpdate = true;
    best.albedoTex.dispose();
    best.albedoTex = next;
    best.texRes = chunk.texRes;
    best.mat.uniforms.uAlbedoMap.value = next;
    best.lastUsed = ++this.frame;
    return true;
  }

  private attachOutline(r: Resident): void {
    if (r.wire) return;
    const bundle = this.getBundle();
    const chunk = sampleHeightfieldChunk(bundle, r.node);
    const wire = makeChunkOutlineLines(
      chunk, this.radius, this.getDisplacement(), bundle.params.seaLevel,
      r.node.level, this.wireMatCache,
    );
    wire.visible = r.mesh.visible && r.fade > 0.05;
    this.debugGroup.add(wire);
    r.wire = wire;
  }

  /** Mark who should be drawn; fade targets drive soft handoff. */
  private applyVisibility(): void {
    const readyDesired = new Set<string>();
    for (const n of this.desired) {
      const id = nodeKey(n);
      const r = this.residents.get(id);
      if (r && r.fingerprint === this.fingerprint) {
        readyDesired.add(id);
      }
    }

    const keepParents = new Set<string>();
    for (const n of this.desired) {
      const id = nodeKey(n);
      if (readyDesired.has(id)) continue;
      let pk = parentNodeKey(n);
      while (pk) {
        const pr = this.residents.get(pk);
        if (pr && pr.fingerprint === this.fingerprint) {
          keepParents.add(pk);
          break;
        }
        const parent = nodeFromKey(pk);
        if (!parent) break;
        pk = parentNodeKey(parent);
      }
    }

    // Soft parent hold: keep parent while any child is still fading in
    for (const id of readyDesired) {
      const r = this.residents.get(id)!;
      if (r.fade < 0.92) {
        let pk = parentNodeKey(r.node);
        while (pk) {
          const pr = this.residents.get(pk);
          if (pr && pr.fingerprint === this.fingerprint) {
            keepParents.add(pk);
            break;
          }
          const parent = nodeFromKey(pk);
          if (!parent) break;
          pk = parentNodeKey(parent);
        }
      }
    }

    const shouldShow = new Set<string>([...readyDesired, ...keepParents]);
    for (const [, r] of this.residents) {
      const id = nodeKey(r.node);
      if (shouldShow.has(id)) continue;
      if (!this.desiredKeys.has(id)) {
        for (const n of this.desired) {
          if (isDescendant(n, r.node) && !readyDesired.has(nodeKey(n))) {
            shouldShow.add(id);
            break;
          }
        }
      }
    }

    for (const [id, r] of this.residents) {
      const show = shouldShow.has(id) && r.fingerprint === this.fingerprint;
      r.fadeTarget = show ? 1 : 0;
      if (show) {
        r.mesh.visible = true;
        if (r.wire) r.wire.visible = this.showChunks;
      }
      void id;
    }
  }

  private stepFades(dt: number): void {
    const speed = 1 / Math.max(LOD_FADE_SEC, 0.05);
    const step = Math.min(1, Math.max(0, dt)) * speed;
    for (const [id, r] of this.residents) {
      if (r.fade < r.fadeTarget) r.fade = Math.min(r.fadeTarget, r.fade + step);
      else if (r.fade > r.fadeTarget) r.fade = Math.max(r.fadeTarget, r.fade - step);
      r.mat.uniforms.uFade.value = r.fade;

      if (r.fadeTarget <= 0 && r.fade <= 0.02) {
        r.fade = 0;
        r.mat.uniforms.uFade.value = 0;
        r.mesh.visible = false;
        if (r.wire) r.wire.visible = false;
        if (!this.desiredKeys.has(id) && !this.pendingSet.has(id)) {
          // keep briefly in map for parent cover; LRU will reclaim
        }
      }
    }
  }

  private lruEvict(): void {
    if (this.residents.size <= MAX_RESIDENT_CHUNKS) return;
    // Never evict desired or warm-prefetch cover — holes on rotate come from that.
    const ranked = [...this.residents.entries()]
      .filter(([id, r]) => (
        !this.desiredKeys.has(id)
        && !r.warm
        && !this.warmKeys.has(id)
        && r.fadeTarget <= 0
        && r.fade <= 0.02
      ))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const target = this.moving
      ? Math.max(MAX_RESIDENT_CHUNKS, this.residents.size - 2)
      : MAX_RESIDENT_CHUNKS;
    for (const [id] of ranked) {
      if (this.residents.size <= target) break;
      this.evict(id);
    }
    // If still over (too many warm), trim oldest warm not facing.
    if (this.residents.size > MAX_RESIDENT_CHUNKS + MAX_WARM_CHUNKS) {
      const warmRanked = [...this.residents.entries()]
        .filter(([id, r]) => r.warm && !this.desiredKeys.has(id))
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (const [id] of warmRanked) {
        if (this.residents.size <= MAX_RESIDENT_CHUNKS + 32) break;
        this.warmKeys.delete(id);
        this.evict(id);
      }
    }
  }

  private recountTris(): void {
    let t = 0;
    for (const r of this.residents.values()) {
      if (!r.mesh.visible || r.fade < 0.05) continue;
      const idx = r.geo.index;
      t += idx ? idx.count / 3 : 0;
    }
    this.tris = t | 0;
  }

  private updateCoverClock(): void {
    if (this.pending.length > 0) {
      if (!this.coverStartedAt) this.coverStartedAt = performance.now();
    } else {
      this.coverStartedAt = 0;
    }
  }

  private evict(id: string): void {
    const r = this.residents.get(id);
    if (!r) return;
    this.group.remove(r.mesh);
    if (r.wire) {
      this.debugGroup.remove(r.wire);
      r.wire.geometry.dispose();
    }
    r.geo.dispose();
    r.albedoTex.dispose();
    r.mat.dispose();
    this.residents.delete(id);
  }
}

function norm3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
}

export { nodeId };
