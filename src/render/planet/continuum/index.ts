// ContinuumGlobe — lab-only chunked heightfield planet (engine=continuum).

import {
  Group, IcosahedronGeometry, Mesh, PlaneGeometry, RingGeometry, DataTexture,
  ShaderMaterial, Vector3, Quaternion, BackSide, DoubleSide, AdditiveBlending,
  RedFormat, FloatType, RGBAFormat, UnsignedByteType,
} from 'three';
import type { GenPlanet } from '../../../data/system-gen';
import { channel, range } from '../rng';
import { derivePlanetParams, PRESETS, type PlanetRenderParams } from '../presets';
import { MACRO } from '../plates';
import { LodStage, apparentRadiusPx, stageForPx, dotBrightness } from '../lod';
import type { UpdateCtx } from '../globe';
import { createGeneratorBundle, type GeneratorBundle } from '../generators';
import { ChunkPool } from './chunk-pool';
import { createBodyChunkCache, releaseBodyChunkCache, type BodyChunkCache } from '../../../persistence/body-asset-store';
import { ContinuumClouds } from './cloud-voxels';
import { ContinuumSurfaceVoxels } from './surface-voxels';
import { applyApproachFlightCamera, type ApproachCameraLike } from './approach-camera';
import { earthEquivalentAu } from './body-scale';
import { removeChunkHud, updateChunkHud } from './debug-chunks';
import type { Vec3 } from '../cube-sphere';
import { continuumAtmosFrag, continuumAtmosVert } from './shaders';
import { generateRings, densityLUT, type RingSystem } from '../rings';
import { GIANT_VERT, GIANT_FRAG, RING_VERT, RING_FRAG } from '../shaders';
import { getRealAlbedoTexture, onRealAlbedoReady } from './real-albedo';

/** Same authoring convention as globe.ts's ring mount (rings.test.ts +
 *  globe.test.ts already exercise this LUT resolution / segment count). */
const RING_SEGMENTS = 96;
const LUT_N = 128;

/** Giant band shader (shaders.ts GIANT_FRAG) storm/streak population cap —
 *  MUST equal that shader's own `const int MAX_STORMS`. */
const MAX_GIANT_STORMS = 6;

interface GiantFeature {
  pos: [number, number, number];
  radius: number;
  aspect: number;
  spiral: number;
  color: [number, number, number];
}

/** Unit sphere direction from a sin-latitude (-1..1, matches vDir.y's
 *  convention in GIANT_FRAG) and a longitude in radians. */
function giantDirFromLatLon(latY: number, lon: number): [number, number, number] {
  const r = Math.sqrt(Math.max(0, 1 - latY * latY));
  return [r * Math.cos(lon), latY, r * Math.sin(lon)];
}

/** Seeded storm/streak population for the giant band shader (Audit fix —
 *  replaces the single hardcoded great-spot boolean/position). Per
 *  docs/planet-visual-realism.md §2.1: gas giants get at most one giant
 *  anticyclone (gated by `stormChance`) plus 2-5 medium ovals with
 *  power-law sizes, placed at band-shear latitudes (a boundary between two
 *  adjacent bands). Per §2.2: ice giants instead get a seeded ~30% chance
 *  (`stormChance`) of 1-3 bright transient methane-cloud streaks near
 *  30-40° latitude. */
function buildGiantFeatures(
  seed: number, isIce: boolean, bandCount: number, stormChance: number,
): GiantFeature[] {
  const rng = channel(seed, 'giant-storms');
  const features: GiantFeature[] = [];
  const bandGap = 1 / Math.max(bandCount, 1);
  const shearLat = (): number => {
    const k = Math.max(1, Math.floor(range(rng, 1, Math.max(bandCount, 2))));
    const lat01 = k * bandGap + range(rng, -bandGap * 0.25, bandGap * 0.25);
    // Keep storms inside the ~50°-latitude polar cutoff band.
    return Math.max(-0.82, Math.min(0.82, lat01 * 2 - 1));
  };
  if (!isIce) {
    if (stormChance > 0 && rng() < stormChance) {
      features.push({
        pos: giantDirFromLatLon(shearLat(), range(rng, 0, Math.PI * 2)),
        radius: range(rng, 0.20, 0.26),
        aspect: 1,
        spiral: range(rng, 1.6, 2.6),
        color: [0.72, 0.36, 0.24],
      });
    }
    const mediumCount = Math.floor(range(rng, 2, 6)); // 2..5
    for (let i = 0; i < mediumCount && features.length < MAX_GIANT_STORMS; i++) {
      const sizeT = Math.pow(rng(), 1.8); // power-law: small ovals far more common
      features.push({
        pos: giantDirFromLatLon(shearLat(), range(rng, 0, Math.PI * 2)),
        radius: 0.05 + sizeT * 0.09,
        aspect: 1,
        spiral: range(rng, 0.6, 1.4),
        color: [0.66 + range(rng, -0.05, 0.05), 0.40 + range(rng, -0.05, 0.05), 0.30],
      });
    }
  } else if (stormChance > 0 && rng() < stormChance) {
    const count = Math.floor(range(rng, 1, 4)); // 1..3 bright streaks
    for (let i = 0; i < count && features.length < MAX_GIANT_STORMS; i++) {
      const latDeg = range(rng, 30, 40) * (rng() < 0.5 ? -1 : 1);
      const latY = Math.sin((latDeg * Math.PI) / 180);
      features.push({
        pos: giantDirFromLatLon(latY, range(rng, 0, Math.PI * 2)),
        radius: range(rng, 0.10, 0.20),
        aspect: range(rng, 3, 5),
        spiral: 0,
        color: [0.92, 0.98, 0.98],
      });
    }
  }
  return features;
}

/** Jónsson-model oblateness (§2.1/§2.2): gas giants squash ~6.5-10%
 *  (scale.y 0.90-0.935), ice giants ~2% (0.975-0.985) — seeded within each
 *  class's documented range so same-archetype bodies aren't visual clones. */
function giantOblateness(seed: number, isIce: boolean): number {
  const rng = channel(seed, 'giant-oblateness');
  return isIce ? range(rng, 0.975, 0.985) : range(rng, 0.90, 0.935);
}

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
  /** Structured ring system (Step 0's hasRings) — null when the body has none. */
  readonly rings: RingSystem | null;
  private seed: number;
  private bundle: GeneratorBundle;
  private readonly tiltGroup = new Group();
  private readonly spinGroup = new Group();
  private readonly surfaceGroup = new Group();
  private readonly chunkPool: ChunkPool | null;
  /** (P2-3) null for giants (no chunk pool, nothing to cache). */
  private readonly chunkAssetCache: BodyChunkCache | null;
  private readonly clouds: ContinuumClouds | null;
  private readonly surfaceVoxels: ContinuumSurfaceVoxels | null;
  private readonly atmosMesh: Mesh | null = null;
  private readonly atmosMat: ShaderMaterial | null = null;
  private readonly giantMesh: Mesh | null = null;
  private readonly ringMesh: Mesh | null = null;
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
  /** P2-0 fix #3 — true once the chunk pool's first cover burst has fully
   *  drained at least once. Surface-world reveal (impostor→detail) waits on
   *  this instead of popping the moment the geometric LOD threshold is
   *  crossed, so the one-time cover-build cost happens behind the (already
   *  visible, cheap) impostor rather than as a bare freeze-then-pop. Giants
   *  have no chunk pool / burst and always reveal immediately. */
  private everCoveredOnce = false;
  /** P2-19: this body's OWN approach-flight-camera east-vector hysteresis
   *  memory (see approach-camera.ts's `stickyEast` param doc) — one instance
   *  per globe so two bodies simultaneously satisfying `near` never corrupt
   *  each other's look direction, even outside the `ctx.trackedRoot` gate. */
  private readonly stickyEast = new Vector3(1, 0, 0);
  /** P2-17 — true for a moon-mode body: no clouds/atmosphere/rings, chunk
   *  pool built airless (knife-edge terminator). Immutable for the body's
   *  lifetime, same as `params.isGiant`. */
  private readonly isMoon: boolean;

  constructor(
    readonly planet: GenPlanet,
    readonly radius: number,
    opts?: { isMoon?: boolean },
  ) {
    this.isMoon = !!opts?.isMoon;
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
    // P2-18 — lets continuum/registry.ts bucket moons vs. planets for the
    // real per-frame planetshine driver without any name matching.
    this.root.userData.isMoon = this.isMoon;

    const rng = channel(planet.seed >>> 0, 'orient');
    // P2-20: draw the cosmetic RNG tilt UNCONDITIONALLY (even when a real
    // catalogue tilt overrides the result below) so spinRate's draw always
    // lands on the same RNG-stream position — no seed-derived-variation
    // regression for any body, catalogued or procedural. planet.axialTilt is
    // the catalogue's real authored value (0-180° convention, >90° =
    // retrograde — Uranus 97.77°, Venus 177.36°); undefined for every
    // procedurally-generated body and every moon (no authored tilt to read).
    const rngTiltRad = range(rng, -0.5, 0.5);
    this.tiltGroup.rotation.z =
      planet.axialTilt != null ? (planet.axialTilt * Math.PI) / 180 : rngTiltRad;
    this.spinRate = range(rng, 0.02, 0.12) * (rng() < 0.1 ? -1 : 1);
    this.root.add(this.tiltGroup);
    this.tiltGroup.add(this.spinGroup);
    this.spinGroup.add(this.surfaceGroup);

    if (this.params.isGiant) {
      this.chunkPool = null;
      this.chunkAssetCache = null;
      this.clouds = null;
      this.surfaceVoxels = null;
      // Ported from legacy PlanetGlobe (Audit A1 gap #1 — giant shading):
      // the SAME banded/turbulent/storm shader (shaders.ts GIANT_VERT/FRAG),
      // not a redesign. Was a flat MeshBasicMaterial sphere with a single RGB
      // — no bands, no storm, no lighting response at all.
      this.giantMesh = new Mesh(new IcosahedronGeometry(radius, 5), this.buildGiantMat());
      this.spinGroup.add(this.giantMesh);
      // Oblateness (§2.1/§2.2 — real Jupiter ~6.5% flattened, Saturn ~9.8%,
      // Uranus/Neptune ~2%): scale ONLY the spin group, which for a giant
      // holds nothing but the giant mesh itself — rings mount on the
      // sibling tiltGroup and stay perfectly circular.
      this.spinGroup.scale.y = giantOblateness(planet.seed >>> 0, this.params.type === 'ice');
    } else {
      // (P2-3) Preload is async/fire-and-forget-but-tracked; construction
      // happens well before the camera can reach `near` and start calling
      // ChunkPool.buildOne() (see BodyChunkCache doc comment for the
      // documented sync-build/async-cache design fork this relies on).
      this.chunkAssetCache = createBodyChunkCache(planet.seed);
      void this.chunkAssetCache.preload(this.lastFp);
      this.chunkPool = new ChunkPool(
        radius,
        () => this.bundle,
        () => this.params.displacement,
        this.chunkAssetCache,
        // P2-17 — airless (moon): knife-edge terminator, no soft wrap.
        this.isMoon,
      );
      this.surfaceGroup.add(this.chunkPool.group);
      this.surfaceVoxels = new ContinuumSurfaceVoxels(
        radius,
        () => this.bundle,
        () => this.params.displacement,
      );
      this.spinGroup.add(this.surfaceVoxels.group);
      if (this.isMoon) {
        // P2-17 — moons skip clouds/atmosphere entirely (not just zero
        // density): no weather system, no envelope to scatter light. Cheaper
        // too (no extra shell mesh/material per moon).
        this.clouds = null;
      } else {
        this.clouds = new ContinuumClouds(radius, () => this.bundle);
        this.spinGroup.add(this.clouds.group);
        this.atmosMat = this.buildAtmosMat();
        // detail 7 — dusty rocky limb was still reading as a faceted band at 6.
        this.atmosMesh = new Mesh(new IcosahedronGeometry(radius * 1.028, 7), this.atmosMat);
        this.atmosMesh.name = 'continuum-atmos';
        this.root.add(this.atmosMesh);
      }
    }

    // Rings (Audit A1 gap #2 — Continuum had none at all). Ported from legacy
    // PlanetGlobe: same structured density-band system (rings.ts) + shader
    // (RING_VERT/RING_FRAG), mounted on the tilt group (equatorial, tilted,
    // not spun) exactly as globe.ts does. Moons never get rings (P2-17),
    // even if a caller mistakenly sets `hasRings` on the moon's GenPlanet.
    if (planet.hasRings && !this.isMoon) {
      this.rings = generateRings(planet.seed, this.params.isGiant);
      this.ringMesh = this.buildRings(this.rings);
      this.tiltGroup.add(this.ringMesh);
    } else {
      this.rings = null;
    }

    this.impostorColor = this.baseColor();
    this.impostorMat = this.buildImpostorMat();
    this.impostorMesh = new Mesh(new PlaneGeometry(2, 2), this.impostorMat);
    this.impostorMesh.frustumCulled = false;
    this.root.add(this.impostorMesh);

    // Real-texture wiring (Audit fix — curated Sol bodies/moons only).
    // Non-giants already pick the real photo up through sampleSurface (see
    // generators/index.ts) the moment it's loaded; ready or not at
    // construction time, register the same "rebuild once it lands" hook so a
    // body baked from its procedural fallback before the network load
    // resolved doesn't stay stuck that way for the rest of the session.
    // Giants have no chunk pool to rebuild — wire the GPU texture straight
    // onto the giant material instead (see onRealAlbedoLoaded below).
    if (planet.realTextureBody) {
      onRealAlbedoReady(planet.realTextureBody, () => this.onRealAlbedoLoaded());
    }
  }

  /** Fires once, the moment this body's real photo (continuum/real-albedo.ts)
   *  finishes loading — immediately, inline, if it was already loaded by the
   *  time the constructor above registered the callback. */
  private onRealAlbedoLoaded(): void {
    const name = this.planet.realTextureBody;
    if (!name) return;
    if (this.giantMesh) {
      const tex = getRealAlbedoTexture(name);
      if (!tex) return;
      const u = (this.giantMesh.material as ShaderMaterial).uniforms;
      u.uAlbedoMap.value = tex;
      u.uUseAlbedoMap.value = 1;
      return;
    }
    // Rocky/moon: bump the chunk-bake identity (fingerprint now folds in
    // isRealAlbedoReady — see generators/index.ts's surfaceFingerprint) so
    // body-asset-store.ts's persisted cache can't keep serving pre-photo
    // procedural bytes baked in the brief pending window before this fired,
    // then force every resident chunk/voxel brick to rebuild against it.
    const fp = this.bundle.fingerprint();
    if (fp !== this.lastFp) {
      this.lastFp = fp;
      void this.chunkAssetCache?.preload(fp);
    }
    this.invalidateChunks();
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

  /** P2-24 — `au` is the SAME body-agnostic global camera distance every
   *  registered globe receives (registry.ts / planet-lab.ts derive it once
   *  from `physicalAuFromZoom`). Normalize it to this body's own authored
   *  radius here — the one boundary where that shared value enters a
   *  per-body module — so every downstream approach/LOD/voxel tier this
   *  feeds (this.viewAu → applyApproachFlightCamera's blend; the child
   *  modules' own copies) becomes body-relative instead of comparing the
   *  same absolute AU number for a Mercury-class and a GasGiant-class body
   *  alike (see body-scale.ts doc comment for the full derivation). */
  setViewDistanceAu(au: number): void {
    this.viewAu = earthEquivalentAu(au, this.radius);
    this.clouds?.setViewDistanceAu(au);
    this.surfaceVoxels?.setViewDistanceAu(au);
    this.chunkPool?.setViewDistanceAu(au);
  }

  /** P2-17 — planetshine: diffuse bounce from a nearby lit parent body.
   *  No-op (uBounceStrength stays 0) unless a caller invokes this — a
   *  ContinuumGlobe has no visibility into sibling bodies, so a
   *  body-registry-aware driver must recompute and call this every frame
   *  (see docs comment on ChunkPool.setPlanetshine). Real per-body wiring
   *  for routed catalogue moons is P2-18's job; harmless on non-moon
   *  bodies (they simply never get called). */
  setPlanetshine(dir: readonly [number, number, number], color: readonly [number, number, number], strength: number): void {
    this.chunkPool?.setPlanetshine(dir, color, strength);
  }

  /** P2-18 — this body's representative day-base color, reused as the tint a
   *  nearby moon's real per-frame planetshine driver (registry.ts) bounces
   *  off this body — the same swatch the far-LOD impostor billboard already
   *  shows, i.e. legacy's `uColor`-as-planetshine-tint pattern (objects.ts
   *  updatePlanetShaders) ported to a body with no single surface-material
   *  `uColor` uniform of its own. */
  get bounceColorRGB(): readonly [number, number, number] { return this.impostorColor; }

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
    // (P2-3) Same globe instance, new body identity — rebind the cache to
    // the new seed rather than leaving it silently reading/writing under
    // the stale one (lab-only path: planet-lab.ts / galaxy-lab-panel.ts).
    this.chunkAssetCache?.rebind(seed);
    void this.chunkAssetCache?.preload(this.lastFp);
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
    if (this.giantMesh) {
      const u = (this.giantMesh.material as ShaderMaterial).uniforms;
      (u.uBandA.value as Vector3).set(...this.params.bandColorA);
      (u.uBandB.value as Vector3).set(...this.params.bandColorB);
      u.uBandCount.value = Math.max(1, this.params.bandCount);
      u.uBandContrast.value = this.params.bandContrast;
      u.uTurbulence.value = this.params.bandTurbulence;
    }
    // Only remesh when heightfield / albedo identity moved (cloud-only is live).
    const fp = this.bundle.fingerprint();
    if (fp !== this.lastFp) {
      this.lastFp = fp;
      // (P2-3) New surface identity — old fingerprint's cached albedos are
      // simply unaddressable now (id embeds fingerprint), never deleted
      // (see BodyChunkCache.preload doc comment for why: revert-to-a-prior-
      // fingerprint during lab tuning should still hit).
      void this.chunkAssetCache?.preload(fp);
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

    // Planet-center → camera direction, same (unrotated) world frame as
    // sunDir. Lets fragment shaders tell a near-aligned pose (sun ~
    // ±viewAxis — full-day or full-night disc, no real terminator visible)
    // from a lateral/partial-phase pose (sun ⟂ viewAxis, a real terminator
    // crosses the visible disc) — shared by the atmosphere shell (I1) and the
    // surface night-scatter gate (P2-1b).
    const viewAxis = _viewAxis.copy(ctx.camera.position).sub(_planetWorld);
    if (viewAxis.lengthSq() < 1e-12) viewAxis.set(0, 0, 1); else viewAxis.normalize();

    const near = stage === LodStage.Globe;

    if (near) {
      // C4 — fly parallel to the surface once inside atmosphere. Tied to the
      // geometric `near` threshold (not the reveal gate below) — camera
      // behavior, not presentation.
      //
      // P2-19: EVERY registered ContinuumGlobe gets an update() call each
      // frame regardless of camera focus (registry.ts's updateContinuumGlobes
      // drives the whole active system) — so more than one body can satisfy
      // `near` simultaneously (e.g. a big gas giant is visually "near" from
      // almost anywhere). Only the ACTUALLY-tracked body may touch the shared
      // camera; a bystander body doing so was the confirmed root cause of the
      // far-orbit camera-framing bug (P2-19 finding). `ctx.trackedRoot` is
      // CameraController's own trackedObject, injected by main.ts.
      if (ctx.trackedRoot === this.root) {
        applyApproachFlightCamera(
          ctx.camera as unknown as ApproachCameraLike,
          _planetWorld,
          this.viewAu,
          this.stickyEast,
          worldRadius,
        );
      }

      this.root.updateMatrixWorld(false);
      this.surfaceGroup.worldToLocal(_camLocal.copy(ctx.camera.position));
      this.tiltGroup.worldToLocal(_camTilt.copy(ctx.camera.position));

      if (this.giantMesh) {
        const m = this.giantMesh.material as ShaderMaterial;
        (m.uniforms.uSunDir.value as Vector3).copy(sunDir);
        m.uniforms.uTime.value = (m.uniforms.uTime.value + ctx.dt) % 1000;
      }

      if (this.chunkPool) {
        this.chunkPool.setSunDir(sunDir.x, sunDir.y, sunDir.z);
        this.chunkPool.setSurfaceLook(this.params.roughness, this.params.nightLights);
        const cam: Vec3 = [_camLocal.x, _camLocal.y, _camLocal.z];
        const tilt: Vec3 = [_camTilt.x, _camTilt.y, _camTilt.z];
        // Object-space sun for cloud-shadow ray (matches ContinuumClouds).
        this.spinGroup.getWorldQuaternion(_q);
        _sunObj.copy(sunDir).applyQuaternion(_q.clone().invert());
        this.chunkPool.setSunDirObj(_sunObj.x, _sunObj.y, _sunObj.z);
        this.chunkPool.setViewAxis(viewAxis.x, viewAxis.y, viewAxis.z);

        if (this.clouds && this.cloudsVisible) {
          this.clouds.update(ctx.dt, _sunObj, _camLocal);
        }
        // Schedule and drain the current camera's cover before surface voxels
        // decide whether they may spend a CPU bake this frame.
        this.chunkPool.updateLod(cam, tilt, this.spinGroup.rotation.y, this.lodForced);
        this.lodForced = false;
        this.chunkPool.tick(ctx.dt);
        const stream = this.chunkPool.isStreaming || this.chunkPool.pendingCount > 0;
        // P2-0 fix #3 — the reveal gate below waits for this to go true at
        // least once, so the one-time cover-build burst happens behind the
        // still-visible impostor instead of popping the instant `near` above
        // goes true.
        if (!stream) this.everCoveredOnce = true;
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
    }

    // P2-0 fix #3 — presentation only, decoupled from the simulation/build
    // work above: surface-world reveal waits for the chunk pool's first cover
    // to finish at least once. Giants have no chunk pool / burst and reveal
    // the instant `near` goes true, same as before this fix.
    const revealed = near && (!this.chunkPool || this.everCoveredOnce);

    this.surfaceGroup.visible = revealed;
    if (this.giantMesh) this.giantMesh.visible = revealed;
    if (this.clouds) this.clouds.group.visible = revealed && this.cloudsVisible;
    if (this.atmosMesh) {
      this.atmosMesh.visible = revealed && this.params.hasAtmosphere && this.params.atmosphereDensity > 0.01;
      if (this.atmosMat) {
        (this.atmosMat.uniforms.uSunDir.value as Vector3).copy(sunDir);
        // I1 — atmosMesh hangs off `root`, not the tilt/spin groups, so the
        // hoisted world-space viewAxis above (unrotated) is the right frame.
        (this.atmosMat.uniforms.uViewAxis.value as Vector3).copy(viewAxis);
      }
    }
    if (this.ringMesh) {
      this.ringMesh.visible = revealed;
      const m = this.ringMesh.material as ShaderMaterial;
      (m.uniforms.uSunDir.value as Vector3).copy(sunDir);
      m.uniforms.uPlanetCenter.value.copy(_planetWorld);
      m.uniforms.uPlanetRadius.value = worldRadius;
    }
    this.impostorMesh.visible = !revealed;

    if (!revealed) {
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

    // P2-21: only the body actually revealed (near, detail-visible — not a
    // far/impostor-stage sibling) writes the shared HUD, and it labels the
    // line with its own name — see updateChunkHud's doc comment. With many
    // simultaneous Continuum bodies now normal (a whole routed system), an
    // unconditional every-frame call here was the P2-13/P2-18-found bug: the
    // HUD silently showed whichever body's update() ran last, not the one
    // on screen.
    if (this.chunkPool && revealed) updateChunkHud(this.chunkPool.hud(), this.root.name);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.chunkPool?.dispose();
    // (P2-3) Stop counting this body in the global flush-on-teardown sweep
    // (main.ts visibilitychange/pagehide) — in-flight writes already queued
    // are left to finish on their own; nothing cancels them.
    if (this.chunkAssetCache) releaseBodyChunkCache(this.chunkAssetCache);
    this.clouds?.dispose();
    this.surfaceVoxels?.dispose();
    this.giantMesh?.geometry.dispose();
    (this.giantMesh?.material as ShaderMaterial | undefined)?.dispose();
    this.atmosMesh?.geometry.dispose();
    this.atmosMat?.dispose();
    if (this.ringMesh) {
      this.ringMesh.geometry.dispose();
      const m = this.ringMesh.material as ShaderMaterial;
      m.uniforms.uDensity.value?.dispose?.();
      m.dispose();
    }
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

  /** Photographic-realism giant band material (docs/planet-visual-realism.md
   *  §2.1/§2.2) — seeded irregular bands + polar-cutoff vortex crossfade +
   *  a seeded storm/streak population (buildGiantFeatures) + Jónsson limb
   *  darkening, all in shaders.ts GIANT_VERT/FRAG. Replaces the old single
   *  constant-frequency sin() stripe + one hardcoded great-spot boolean
   *  (Audit A1 gap #1 follow-up). */
  private buildGiantMat(): ShaderMaterial {
    const p = this.params;
    const isIce = p.type === 'ice';
    const features = buildGiantFeatures(this.planet.seed >>> 0, isIce, Math.max(1, p.bandCount), p.stormChance);
    const fill = MAX_GIANT_STORMS - features.length;
    const posArr = features.map((f) => new Vector3(...f.pos)).concat(Array.from({ length: fill }, () => new Vector3()));
    const radiusArr = features.map((f) => f.radius).concat(Array(fill).fill(0));
    const aspectArr = features.map((f) => f.aspect).concat(Array(fill).fill(1));
    const spiralArr = features.map((f) => f.spiral).concat(Array(fill).fill(0));
    const colorArr = features.map((f) => new Vector3(...f.color)).concat(Array.from({ length: fill }, () => new Vector3()));
    // Real-texture wiring (Audit fix — Jupiter/Saturn/Uranus/Neptune): a
    // giant has no chunk pool to bake a real photo into (unlike rocky
    // bodies/moons — see sampleSurface's realAlbedo override), so this
    // whole-sphere shader samples the loaded photo directly via an equirect
    // UV computed from its own vDir (GIANT_FRAG). Dummy 1x1 opaque texture +
    // uUseAlbedoMap=0 keeps every non-curated giant (EE's Jotunheim/
    // Niflheim, no bundled photo) byte-identical to before this uniform
    // existed; `realTextureBody` set + already-loaded (Stage A preload had
    // time to land before construction) flips it on immediately, otherwise
    // onRealAlbedoLoaded() flips it on once the load resolves.
    const dummyAlbedo = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
    dummyAlbedo.needsUpdate = true;
    const realTex = this.planet.realTextureBody ? getRealAlbedoTexture(this.planet.realTextureBody) : undefined;
    return new ShaderMaterial({
      vertexShader: GIANT_VERT, fragmentShader: GIANT_FRAG,
      uniforms: {
        uSunDir: { value: new Vector3(0, 0, 1) },
        uBandA: { value: new Vector3(...p.bandColorA) },
        uBandB: { value: new Vector3(...p.bandColorB) },
        uBandCount: { value: Math.max(1, p.bandCount) },
        uBandContrast: { value: p.bandContrast },
        uTurbulence: { value: p.bandTurbulence },
        uNoiseSeed: { value: new Vector3(...p.noiseSeed) },
        uTime: { value: 0 },
        uTerminator: { value: 0.12 },
        uStormCount: { value: features.length },
        uStormPos: { value: posArr },
        uStormRadius: { value: radiusArr },
        uStormAspect: { value: aspectArr },
        uStormSpiral: { value: spiralArr },
        uStormColor: { value: colorArr },
        uAlbedoMap: { value: realTex ?? dummyAlbedo },
        uUseAlbedoMap: { value: realTex ? 1 : 0 },
      },
    });
  }

  /** Legacy PlanetGlobe's exact ring construction (globe.ts buildRings) —
   *  same geometry/LUT/shader, ported for Audit A1's ring gap. */
  private buildRings(rings: RingSystem): Mesh {
    const geo = new RingGeometry(rings.innerRadius, rings.outerRadius, RING_SEGMENTS, 4);
    const lut = densityLUT(rings, LUT_N);
    const tex = new DataTexture(lut, LUT_N, 1, RedFormat, FloatType);
    tex.needsUpdate = true;
    const mat = new ShaderMaterial({
      vertexShader: RING_VERT, fragmentShader: RING_FRAG,
      transparent: true, side: DoubleSide, depthWrite: false,
      uniforms: {
        uDensity: { value: tex },
        uInner: { value: rings.innerRadius }, uOuter: { value: rings.outerRadius },
        uColor: { value: new Vector3(0.82, 0.78, 0.7) },
        uSunDir: { value: new Vector3(0, 0, 1) },
        uPlanetCenter: { value: new Vector3() },
        uPlanetRadius: { value: this.radius },
      },
    });
    const mesh = new Mesh(geo, mat);
    mesh.scale.setScalar(this.radius); // planet-radii geometry → authoring units
    mesh.rotation.x = -Math.PI / 2;    // XY ring → equatorial XZ plane
    mesh.userData.ringSystem = rings;  // samplable structure for a later gameplay layer
    return mesh;
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
