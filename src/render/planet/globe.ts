// ═══════════════════════════════════════════════════════════════════
// PLANET GLOBE — one planet's renderable, built from its Step 0 record.
//
// Assembles the pieces into a single Object3D and owns its per-frame update:
//   root ─ tiltGroup(axial tilt) ─ spinGroup(daily rotation) ─ surface/giant
//        ├─ rings (equatorial, tilted, not spun — Decision 5 structure)
//        ├─ atmosphere shell (P2)
//        └─ impostor billboard (far LOD — analytic ray-sphere, one draw)
//
// Surface worlds get the cube-sphere QUADTREE (selectSphere → per-leaf meshes,
// GPU-displaced by ONE shared material); giants get the banded-cloud sphere.
// LOD hands off globe↔impostor by apparent pixel size, dimming the impostor
// below a pixel so far planets fade instead of piling up. Deterministic: every
// look derives from planet.seed; rotation is the only time-varying, cosmetic bit.
// ═══════════════════════════════════════════════════════════════════

import {
  Group, Mesh, BufferGeometry, BufferAttribute, ShaderMaterial,
  IcosahedronGeometry, RingGeometry, PlaneGeometry, DataTexture,
  Vector3, Quaternion, BackSide, DoubleSide, AdditiveBlending, RedFormat, FloatType,
  LinearFilter, ClampToEdgeWrapping,
  type Object3D, type Texture,
} from 'three';
import type { GenPlanet } from '../../data/system-gen';
import {
  CUBE_FACES, facePoint, cubeToSphere, selectSphere, nodeId,
  type QuadNode, type Vec3,
} from './cube-sphere';
import { derivePlanetParams, type PlanetRenderParams } from './presets';
import {
  generatePlates, macroParams, macroHeight, packContSeeds, packContSize, packPlateSeeds, packPlateMotion,
  type PlateField,
} from './plates';
import { warpDir } from './simplex';
import { bakeCube, type BakeParams } from './bake';
import { generateRings, densityLUT, type RingSystem } from './rings';
import { channel, range } from './rng';
import { stageForPx, apparentRadiusPx, dotBrightness, LodStage } from './lod';
import {
  SURFACE_VERT, SURFACE_FRAG, GIANT_VERT, GIANT_FRAG, CLOUD_VERT, CLOUD_FRAG,
  ATMOS_VERT, ATMOS_FRAG, RING_VERT, RING_FRAG, IMPOSTOR_VERT, IMPOSTOR_FRAG,
} from './shaders';

/** Per-frame context handed to every globe. */
export interface UpdateCtx {
  camera: { position: Vector3; matrixWorld: { elements: number[] | Float32Array } };
  sunWorldPos: Vector3;
  dt: number;
  fovYRad: number;
  viewportH: number;
}

const NODE_RES = 16;    // grid resolution per quadtree leaf
// Planet v2 Phase 1: subdivide by SCREEN error, deep near the camera. DETAIL is
// the target on-screen angular size of a leaf (radians) — 0.02 ≈ 1.1°. Only
// camera-facing leaves reach MAX_LEVEL, so total count stays bounded by screen
// coverage. (The "missing faces" that looked like LOD cracks were actually
// inverted winding on the ±Y cube faces — see buildNodeGeometry — not
// under-sampling, so no need for heavy over-tessellation here.)
const MAX_LEVEL = 9;
const DETAIL = 0.02;
const MAX_LEAF_CACHE = 1400; // evict beyond this so deep dives don't grow unbounded
const RING_SEGMENTS = 96;
const LUT_N = 128;

const _camRight = new Vector3();
const _camUp = new Vector3();
const _planetWorld = new Vector3();
const _camLocal = new Vector3();
const _qTmp = new Quaternion();
const _worldScale = new Vector3();

/** smoothstep(0,1,t) — storm birth/death easing, so they never pop. */
function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export class PlanetGlobe {
  readonly root = new Group();
  params: PlanetRenderParams; // mutable: the lab re-derives + refreshes uniforms live
  readonly rings: RingSystem | null;

  private readonly tiltGroup = new Group();
  private readonly spinGroup = new Group();
  private readonly surfaceGroup = new Group(); // holds quadtree leaf meshes
  private readonly surfaceMat: ShaderMaterial | null = null;
  private readonly giantMesh: Mesh | null = null;
  private readonly atmosMesh: Mesh | null = null;
  private cloudMesh: Mesh | null = null;
  private readonly ringMesh: Mesh | null = null;
  private readonly impostorMesh: Mesh;
  private readonly impostorMat: ShaderMaterial;
  private readonly impostorColor: Vec3;
  private readonly spinRate: number;
  private activeIds = '';
  private readonly nodeGeoCache = new Map<string, BufferGeometry>();
  private atlasTex: DataTexture | null = null; // stacked 6-face eroded height atlas
  private useBake = false;
  private seed: number; // mutable so the lab can reseed IN PLACE (keep the root)

  // ── CPU weather: cyclone placement/lifecycle (ocean-gated, respawning) ──
  private cloudClock = 0;                       // raw seconds; shader scales by uCloudSpeed
  private plateField: PlateField | null = null; // cached exact land field for storm gating
  private cycRng: (() => number) | null = null;
  private cycStorms: { lon: number; lat: number; drift: number; born: number; life: number }[] = [];

  constructor(
    readonly planet: GenPlanet,
    /** Visual radius in local-tier AUTHORING units (before SYSTEM_TIER_SCALE). */
    readonly radius: number,
  ) {
    this.seed = planet.seed;
    this.params = derivePlanetParams(planet);
    this.root.name = `globe-${planet.seed}`;
    this.root.userData.type = 'planet-globe';
    this.root.userData.seed = planet.seed;
    this.root.userData.planetType = planet.type;
    this.root.userData.bodyRadius = radius; // lets the camera focus/approach frame this globe

    // tilt → spin → surface
    const rng = channel(planet.seed >>> 0, 'orient');
    this.tiltGroup.rotation.z = range(rng, -0.5, 0.5);   // axial tilt (rad)
    this.spinRate = range(rng, 0.02, 0.12) * (rng() < 0.1 ? -1 : 1); // rad/s, rare retrograde
    this.root.add(this.tiltGroup);
    this.tiltGroup.add(this.spinGroup);
    this.spinGroup.add(this.surfaceGroup);

    if (this.params.isGiant) {
      this.giantMesh = new Mesh(new IcosahedronGeometry(radius, 5), this.buildGiantMat());
      this.spinGroup.add(this.giantMesh);
    } else {
      this.surfaceMat = this.buildSurfaceMat();
      this.rebuildQuadtree(this.rootSelection()); // initial coarse mesh
    }

    // Rings (structured density bands) — Step 0's hasRings.
    if (planet.hasRings) {
      this.rings = generateRings(planet.seed, this.params.isGiant);
      this.ringMesh = this.buildRings(this.rings);
      this.tiltGroup.add(this.ringMesh); // equatorial plane, tilted, not spun
    } else {
      this.rings = null;
    }

    // Atmosphere shell (P2).
    if (this.params.hasAtmosphere) {
      this.atmosMesh = new Mesh(new IcosahedronGeometry(radius * 1.035, 6), this.buildAtmosMat());
      this.root.add(this.atmosMesh);
    }
    // Cloud shell (surface worlds): lives in the SPIN frame — the same object
    // space the surface samples for its cloud shadows, so they always align.
    if (!this.params.isGiant) {
      this.cloudMesh = new Mesh(new IcosahedronGeometry(radius * 1.03, 5), this.buildCloudMat());
      this.spinGroup.add(this.cloudMesh);
    }

    // Distant impostor (analytic ray-sphere billboard).
    this.impostorColor = this.baseColor();
    this.impostorMat = this.buildImpostorMat();
    this.impostorMesh = new Mesh(new PlaneGeometry(2, 2), this.impostorMat);
    this.impostorMesh.frustumCulled = false;
    this.root.add(this.impostorMesh);
  }

  // ── material builders ──────────────────────────────────────────────
  private buildSurfaceMat(): ShaderMaterial {
    const p = this.params;
    const at = new Float32Array(6);
    const col = new Float32Array(6 * 3);
    p.ramp.slice(0, 6).forEach((s, i) => {
      at[i] = s.at; col[i * 3] = s.color[0]; col[i * 3 + 1] = s.color[1]; col[i * 3 + 2] = s.color[2];
    });
    return new ShaderMaterial({
      vertexShader: SURFACE_VERT, fragmentShader: SURFACE_FRAG,
      uniforms: {
        uNoiseSeed: { value: new Vector3(...p.noiseSeed) },
        uRidged: { value: p.ridged }, uWarp: { value: p.warp },
        uDisplacement: { value: p.displacement },
        uNormalStrength: { value: macroParams(p.type).normalStrength },
        uDetailScale: { value: macroParams(p.type).detailScale },
        uCoastAmp: { value: macroParams(p.type).coastAmp },
        uCoastFreq: { value: macroParams(p.type).coastFreq },
        uRangeVar: { value: macroParams(p.type).rangeVar },
        uCraters: { value: macroParams(p.type).craters },
        uCraterFreq: { value: macroParams(p.type).craterFreq },
        uCraterDepth: { value: macroParams(p.type).craterDepth },
        uCanyons: { value: macroParams(p.type).canyons },
        uCanyonFreq: { value: macroParams(p.type).canyonFreq },
        uCanyonDepth: { value: macroParams(p.type).canyonDepth },
        uCloudCover: { value: p.cloudCover },
        uCloudShadow: { value: p.cloudShadow },
        uCloudFlow: { value: p.cloudFlow },
        uCloudTurb: { value: p.cloudTurb },
        uCloudTerrain: { value: p.cloudTerrain },
        uCloudDetail: { value: p.cloudDetail },
        uCloudSpeed: { value: p.cloudSpeed },
        uCloudWisp: { value: p.cloudWisp },
        uCloudRegion: { value: p.cloudRegion },
        uCycSize: { value: p.cycloneSize },
        uCycPos: { value: [new Vector3(0, 0, 1), new Vector3(0, 0, 1), new Vector3(0, 0, 1)] },
        uCycStr: { value: [0, 0, 0] },
        uLightning: { value: p.lightning },
        uCloudTime: { value: 0 },
        uSunDirObj: { value: new Vector3(0, 0, 1) },
        // Baked master (Phase 3): ONE stacked atlas (res × 6·res); the leaf picks
        // its face row via the per-vertex aFace attribute (no per-leaf uniforms).
        uUseBake: { value: 0 },
        uHeightAtlas: { value: null as Texture | null },
        uHeightRes: { value: 256 },
        ...this.plateUniforms(),
        uSunDir: { value: new Vector3(0, 0, 1) },
        uSeaLevel: { value: p.seaLevel },
        uOceanShallow: { value: new Vector3(...p.oceanShallow) },
        uOceanDeep: { value: new Vector3(...p.oceanDeep) },
        uLatitudeIce: { value: p.latitudeIce },
        uMoisture: { value: p.moisture },
        uAridBelts: { value: p.aridBelts },
        uRainShadow: { value: p.rainShadow },
        uOrographic: { value: p.orographic },
        uLapseRate: { value: p.lapseRate },
        uTreeline: { value: p.treeline },
        uWindBearing: { value: p.windBearing },
        uContinental: { value: p.continental },
        uAltitudeDry: { value: p.altitudeDry },
        uPatchiness: { value: p.patchiness },
        uLushDepth: { value: p.lushDepth },
        uSnowfall: { value: p.snowfall },
        uRoughness: { value: p.roughness },
        uEmissive: { value: new Vector3(...p.emissive) },
        uEmissiveStrength: { value: p.emissiveStrength },
        uNightLights: { value: p.nightLights },
        uTerminator: { value: p.hasAtmosphere ? 0.1 : 0.03 },
        uAtmosTint: { value: new Vector3(...p.atmosphere) },
        uRampCount: { value: Math.min(6, p.ramp.length) },
        uRampAt: { value: at },
        uRampColor: { value: col },
      },
    });
  }

  /** Tectonic uniforms for the surface material — the continent + plate macro
   *  structure, deterministic from the body seed (plates.ts). */
  private plateUniforms(): Record<string, { value: unknown }> {
    const f = generatePlates(this.seed, this.params.type);
    return {
      uContCount: { value: f.continentCount },
      uContSeed: { value: packContSeeds(f) },
      uContSize: { value: packContSize(f) },
      uPlateCount: { value: f.plateCount },
      uPlateSeed: { value: packPlateSeeds(f) },
      uPlateMotion: { value: packPlateMotion(f) },
      uPlateUplift: { value: f.uplift },
      uRangeWidth: { value: f.rangeWidth },
    };
  }

  // ── CPU cyclone engine ─────────────────────────────────────────────
  // Storms are placed and gated HERE (not per-fragment): the CPU has the exact
  // macroHeight land field + the live simplex warp, so it can test the storm's
  // whole footprint (eye + a ring) against open water — a storm never spawns
  // squeezed between nearby landmasses, decays on landfall as it drifts, and a
  // spent storm respawns over fresh ocean (weather comes and goes).

  /** Ocean-ness 0..1 of the LIVE (warped) terrain at an object-space direction. */
  private oceanAt(dir: Vec3): number {
    if (!this.plateField) this.plateField = generatePlates(this.seed, this.params.type);
    const m = macroHeight(this.plateField, warpDir(dir, this.params.warp, this.params.noiseSeed as Vec3));
    const sea = this.params.seaLevel;
    const t = Math.min(1, Math.max(0, (m - (sea - 0.04)) / 0.1)); // smoothstep band
    return 1 - t * t * (3 - 2 * t);
  }

  /** Min ocean-ness over the storm's footprint: the eye + 6 ring samples at
   *  1.35× the storm radius — the whole body must sit over open water. */
  private stormGate(lon: number, la: number): number {
    const cl = Math.sqrt(Math.max(1 - la * la, 0));
    const c: Vec3 = [Math.cos(lon) * cl, la, Math.sin(lon) * cl];
    const up: Vec3 = Math.abs(c[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
    let ux = up[1] * c[2] - up[2] * c[1], uy = up[2] * c[0] - up[0] * c[2], uz = up[0] * c[1] - up[1] * c[0];
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const vx = c[1] * uz - c[2] * uy, vy = c[2] * ux - c[0] * uz, vz = c[0] * uy - c[1] * ux;
    const R = 1.35 * this.params.cycloneSize, cR = Math.cos(R), sR = Math.sin(R);
    let gate = this.oceanAt(c);
    for (let k = 0; k < 6 && gate > 0; k++) {
      const a = (k / 6) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const d: Vec3 = [
        c[0] * cR + (ux * ca + vx * sa) * sR,
        c[1] * cR + (uy * ca + vy * sa) * sR,
        c[2] * cR + (uz * ca + vz * sa) * sR,
      ];
      gate = Math.min(gate, this.oceanAt(d));
    }
    return gate;
  }

  /** Roll storm candidates (slot parity fixes the hemisphere) until one sits over
   *  open water; keep the wettest candidate if none fully clears. */
  private spawnStorm(slot: number, bornT: number): { lon: number; lat: number; drift: number; born: number; life: number } {
    const rng = this.cycRng!;
    let best = { lon: 0, lat: 0.3, drift: 1, g: -1 };
    for (let k = 0; k < 12; k++) {
      const lon = rng() * Math.PI * 2;
      const lat = (0.12 + 0.38 * rng()) * (slot % 2 === 0 ? 1 : -1);
      const drift = 0.7 + 0.6 * rng();
      const g = this.stormGate(lon, lat);
      if (g > best.g) best = { lon, lat, drift, g };
      if (g >= 0.6) break;
    }
    // Staggered lifespans so the three storms never grow and die in lockstep —
    // that synchrony reads as the whole storm system blinking at once.
    const life = 16 + 10 * rng() + slot * 3;
    return { lon: best.lon, lat: best.lat, drift: best.drift, born: bornT, life };
  }

  /** Per-frame: drift each storm westward, gate it against the live coastline,
   *  respawn it once it has fully died over land. Pushes uCycPos/uCycStr. */
  private updateStorms(): void {
    const p = this.params;
    const mats = [this.surfaceMat, this.cloudMesh ? (this.cloudMesh.material as ShaderMaterial) : null];
    const T = this.cloudClock * p.cloudSpeed;
    if (!this.cycRng) this.cycRng = channel(this.seed >>> 0, 'cyclones');
    if (this.cycStorms.length === 0) for (let i = 0; i < 3; i++) this.cycStorms.push(this.spawnStorm(i, T));
    for (let i = 0; i < 3; i++) {
      let str = 0, x = 0, y = 0, z = 1;
      if (p.cyclones > 0) {
        let s = this.cycStorms[i];
        // Fixed LIFECYCLE rather than an ad-hoc respawn test. The old rule
        // ("respawn once the gate is low and age > 2") thrashed: the guard was
        // shorter than the 4-unit fade-in, so a storm sitting over a poor gate
        // could respawn before it had ever become visible — flicker. A storm
        // now lives a set span, and only respawns when that span is up.
        if (T - s.born >= s.life) s = this.cycStorms[i] = this.spawnStorm(i, T);
        const age = T - s.born;
        const lon = s.lon - age * 0.03 * s.drift;   // westward drift
        const gate = this.stormGate(lon, s.lat);    // smooth landfall decay
        // Smooth birth AND death, so storms grow and dissipate instead of
        // popping in and out at a new location.
        const grow = smoothstep01(age / 3.5);
        const fade = 1 - smoothstep01((age - (s.life - 3.5)) / 3.5);
        str = p.cyclones * gate * grow * fade * Math.sign(s.lat);
        const cl = Math.sqrt(Math.max(1 - s.lat * s.lat, 0));
        x = Math.cos(lon) * cl; y = s.lat; z = Math.sin(lon) * cl;
      }
      for (const m of mats) {
        if (!m) continue;
        ((m.uniforms.uCycPos.value as Vector3[])[i]).set(x, y, z);
        (m.uniforms.uCycStr.value as number[])[i] = str;
      }
    }
  }

  /** Dev/verification hook: age every live storm past its fade-in so it renders at
   *  full strength immediately (the lab's __labStorms global). */
  stormsMature(): void { for (const s of this.cycStorms) s.born = -999; }

  /** Bake the eroded height master into 6 face textures (Phase 3). Heavy — run on
   *  demand (the lab's Bake / Rebuild), never per-frame. Disposes any prior set. */
  bake(params: Partial<BakeParams> = {}): void {
    if (this.params.isGiant || !this.surfaceMat) return;
    // Warp the bake with the SAME simplex + noiseSeed the live shader uses, so a
    // baked world's coasts/ranges land exactly where the live view drew them.
    const cube = bakeCube(this.seed, this.params.type, params, this.params.warp, this.params.noiseSeed);
    const res = cube.res;
    // Stack the 6 faces vertically into one atlas (res wide × 6·res tall); face f
    // owns rows [f·res, (f+1)·res). The shader maps (aFace, faceUV) into it.
    const atlas = new Float32Array(res * res * 6);
    for (let f = 0; f < 6; f++) atlas.set(cube.faces[f], f * res * res);
    this.atlasTex?.dispose();
    const tex = new DataTexture(atlas as Float32Array<ArrayBuffer>, res, res * 6, RedFormat, FloatType);
    tex.minFilter = tex.magFilter = LinearFilter;
    tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.atlasTex = tex;
    this.surfaceMat.uniforms.uHeightAtlas.value = tex;
    this.surfaceMat.uniforms.uHeightRes.value = res;
    this.useBake = true;
    this.surfaceMat.uniforms.uUseBake.value = 1;
  }

  /** Toggle between the baked master and the live analytic terrain. */
  setBaked(on: boolean, params: Partial<BakeParams> = {}): void {
    if (on) { this.bake(params); return; }
    this.useBake = false;
    if (this.surfaceMat) this.surfaceMat.uniforms.uUseBake.value = 0;
  }

  /** Re-jitter the terrain from a new seed IN PLACE (keeps the root, so a camera
   *  tracking this globe isn't stranded). Geometry is seed-independent, so only
   *  the shader params + plate field change; callers re-apply the bake if active. */
  reseed(seed: number): void {
    this.seed = seed >>> 0;
    // A new seed IS a new world: storms and their RNG stream must re-derive.
    // (refreshParams deliberately does not do this — see the note there.)
    this.cycStorms = []; this.cycRng = null;
    this.refreshParams();
  }

  /**
   * Re-derive params (presets + live MACRO) and push them into the EXISTING
   * materials' uniforms — no teardown, no shader recompile. Terrain + tectonics
   * are entirely GPU-uniform-driven and the cube-sphere geometry is independent
   * of them, so the lab can tune live without rebuilding the globe (which caused
   * a vanish + a heavy per-fragment recompile on every slider tick). Structural
   * changes (planet type, atmosphere on/off) still need a full rebuild.
   */
  refreshParams(): void {
    this.params = derivePlanetParams({ ...this.planet, seed: this.seed });
    const p = this.params;
    if (this.surfaceMat) {
      const u = this.surfaceMat.uniforms;
      (u.uNoiseSeed.value as Vector3).set(...p.noiseSeed);
      u.uRidged.value = p.ridged; u.uWarp.value = p.warp;
      u.uDisplacement.value = p.displacement;
      u.uNormalStrength.value = macroParams(p.type).normalStrength;
      u.uDetailScale.value = macroParams(p.type).detailScale;
      u.uCoastAmp.value = macroParams(p.type).coastAmp;
      u.uCoastFreq.value = macroParams(p.type).coastFreq;
      u.uRangeVar.value = macroParams(p.type).rangeVar;
      u.uCraters.value = macroParams(p.type).craters;
      u.uCraterFreq.value = macroParams(p.type).craterFreq;
      u.uCraterDepth.value = macroParams(p.type).craterDepth;
      u.uCanyons.value = macroParams(p.type).canyons;
      u.uCanyonFreq.value = macroParams(p.type).canyonFreq;
      u.uCanyonDepth.value = macroParams(p.type).canyonDepth;
      u.uCloudCover.value = p.cloudCover;
      u.uCloudShadow.value = p.cloudShadow;
      u.uCloudFlow.value = p.cloudFlow;
      u.uCloudTurb.value = p.cloudTurb;
      u.uCloudTerrain.value = p.cloudTerrain;
      u.uCloudDetail.value = p.cloudDetail;
      u.uCloudSpeed.value = p.cloudSpeed;
      u.uCloudWisp.value = p.cloudWisp;
      u.uCloudRegion.value = p.cloudRegion;
      u.uCycSize.value = p.cycloneSize;
      if (this.cloudMesh) {
        const cm = (this.cloudMesh.material as ShaderMaterial).uniforms;
        cm.uCloudCover.value = p.cloudCover;
        cm.uCloudFlow.value = p.cloudFlow;
        cm.uCloudTurb.value = p.cloudTurb;
        cm.uCloudTerrain.value = p.cloudTerrain;
        cm.uCloudDetail.value = p.cloudDetail;
        cm.uCloudSpeed.value = p.cloudSpeed;
        cm.uCloudWisp.value = p.cloudWisp;
        cm.uCloudRegion.value = p.cloudRegion;
        cm.uCycSize.value = p.cycloneSize;
        cm.uLightning.value = p.lightning;
        (cm.uNoiseSeed.value as Vector3).set(...p.noiseSeed);
      }
      // Storm placement depends on the (possibly retuned) terrain and seed —
      // drop the cached field, storms, and rng so everything re-derives fresh.
      // Drop the cached plate field so storm gating re-derives against the new
      // terrain — but DO NOT wipe the storms themselves. Every slider now
      // live-updates, so wiping here made each slider tick destroy all storms
      // and restart their fade-in from zero: they flashed on and off while
      // tuning. Existing storms simply re-gate against the new terrain.
      this.plateField = null;
      u.uSeaLevel.value = p.seaLevel;
      (u.uOceanShallow.value as Vector3).set(...p.oceanShallow);
      (u.uOceanDeep.value as Vector3).set(...p.oceanDeep);
      u.uLatitudeIce.value = p.latitudeIce; u.uMoisture.value = p.moisture; u.uRoughness.value = p.roughness;
      u.uAridBelts.value = p.aridBelts; u.uRainShadow.value = p.rainShadow;
      u.uOrographic.value = p.orographic; u.uLapseRate.value = p.lapseRate;
      u.uTreeline.value = p.treeline;
      u.uWindBearing.value = p.windBearing; u.uContinental.value = p.continental;
      u.uAltitudeDry.value = p.altitudeDry; u.uPatchiness.value = p.patchiness;
      u.uLushDepth.value = p.lushDepth;
      u.uSnowfall.value = p.snowfall;
      u.uLightning.value = p.lightning;
      (u.uEmissive.value as Vector3).set(...p.emissive); u.uEmissiveStrength.value = p.emissiveStrength;
      u.uNightLights.value = p.nightLights; u.uTerminator.value = p.hasAtmosphere ? 0.1 : 0.03;
      (u.uAtmosTint.value as Vector3).set(...p.atmosphere);
      const at = u.uRampAt.value as Float32Array;
      const col = u.uRampColor.value as Float32Array;
      at.fill(0); col.fill(0);
      p.ramp.slice(0, 6).forEach((s, i) => { at[i] = s.at; col[i * 3] = s.color[0]; col[i * 3 + 1] = s.color[1]; col[i * 3 + 2] = s.color[2]; });
      u.uRampCount.value = Math.min(6, p.ramp.length);
      Object.assign(u, this.plateUniforms());
    }
    if (this.giantMesh) {
      const u = (this.giantMesh.material as ShaderMaterial).uniforms;
      (u.uBandA.value as Vector3).set(...p.bandColorA);
      (u.uBandB.value as Vector3).set(...p.bandColorB);
      u.uBandCount.value = Math.max(1, p.bandCount);
      u.uTurbulence.value = p.bandTurbulence;
    }
    if (this.atmosMesh) {
      const u = (this.atmosMesh.material as ShaderMaterial).uniforms;
      (u.uColor.value as Vector3).set(...p.atmosphere);
      u.uDensity.value = p.atmosphereDensity;
    }
    const c = this.baseColor();
    (this.impostorMat.uniforms.uColor.value as Vector3).set(c[0], c[1], c[2]);
  }

  private buildGiantMat(): ShaderMaterial {
    const p = this.params;
    const rng = channel(this.planet.seed >>> 0, 'storm');
    const storm = p.stormChance > 0 && rng() < p.stormChance ? 1 : 0;
    return new ShaderMaterial({
      vertexShader: GIANT_VERT, fragmentShader: GIANT_FRAG,
      uniforms: {
        uSunDir: { value: new Vector3(0, 0, 1) },
        uBandA: { value: new Vector3(...p.bandColorA) },
        uBandB: { value: new Vector3(...p.bandColorB) },
        uBandCount: { value: Math.max(1, p.bandCount) },
        uTurbulence: { value: p.bandTurbulence },
        uStorm: { value: storm },
        uNoiseSeed: { value: new Vector3(...p.noiseSeed) },
        uTime: { value: 0 },
        uTerminator: { value: 0.12 },
      },
    });
  }

  private buildAtmosMat(): ShaderMaterial {
    const p = this.params;
    return new ShaderMaterial({
      vertexShader: ATMOS_VERT, fragmentShader: ATMOS_FRAG,
      transparent: true, blending: AdditiveBlending, side: BackSide, depthWrite: false,
      uniforms: {
        uSunDir: { value: new Vector3(0, 0, 1) },
        uColor: { value: new Vector3(...p.atmosphere) },
        uDensity: { value: p.atmosphereDensity },
      },
    });
  }

  private buildCloudMat(): ShaderMaterial {
    const p = this.params;
    return new ShaderMaterial({
      vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG,
      transparent: true, depthWrite: false,
      uniforms: {
        uSunDir: { value: new Vector3(0, 0, 1) },
        uTerminator: { value: 0.08 },
        uNoiseSeed: { value: new Vector3(...p.noiseSeed) },
        uCloudCover: { value: p.cloudCover },
        uCloudFlow: { value: p.cloudFlow },
        uCloudTurb: { value: p.cloudTurb },
        uCloudTerrain: { value: p.cloudTerrain },
        uCloudDetail: { value: p.cloudDetail },
        uCloudSpeed: { value: p.cloudSpeed },
        uCloudWisp: { value: p.cloudWisp },
        uCloudRegion: { value: p.cloudRegion },
        uCycSize: { value: p.cycloneSize },
        uCycPos: { value: [new Vector3(0, 0, 1), new Vector3(0, 0, 1), new Vector3(0, 0, 1)] },
        uCycStr: { value: [0, 0, 0] },
        uLightning: { value: p.lightning },
        uCloudTime: { value: 0 },
        // plateMacro inputs (orographic/climate coupling samples the real terrain)
        ...this.plateUniforms(),
        uCoastAmp: { value: macroParams(p.type).coastAmp },
        uCoastFreq: { value: macroParams(p.type).coastFreq },
        uRangeVar: { value: macroParams(p.type).rangeVar },
      },
    });
  }

  private buildImpostorMat(): ShaderMaterial {
    return new ShaderMaterial({
      vertexShader: IMPOSTOR_VERT, fragmentShader: IMPOSTOR_FRAG,
      transparent: true, depthWrite: false,
      uniforms: {
        uCenter: { value: new Vector3() },
        uRight: { value: new Vector3(1, 0, 0) },
        uUp: { value: new Vector3(0, 1, 0) },
        uRadius: { value: 1 },
        uSunDir: { value: new Vector3(0, 0, 1) },
        uColor: { value: new Vector3(...this.impostorColor) },
        uNoiseSeed: { value: new Vector3(...this.params.noiseSeed) },
      },
    });
  }

  private buildRings(rings: RingSystem): Mesh {
    // Geometry authored in PLANET-RADII (inner..outer), so the shader's
    // length(position.xy) matches uInner/uOuter directly; the mesh scale below
    // lifts it to authoring units. (Scaling the geometry instead would break
    // that unit match and the rings would vanish.)
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

  private baseColor(): Vec3 {
    const p = this.params;
    if (p.isGiant) return [(p.bandColorA[0] + p.bandColorB[0]) / 2, (p.bandColorA[1] + p.bandColorB[1]) / 2, (p.bandColorA[2] + p.bandColorB[2]) / 2];
    const mid = p.ramp[Math.floor(p.ramp.length / 2)]?.color ?? [0.5, 0.5, 0.5];
    return mid;
  }

  // ── cube-sphere quadtree ────────────────────────────────────────────
  private rootSelection(): QuadNode[] {
    // 6 face roots — the coarse initial mesh before the first LOD update.
    const nodes: QuadNode[] = [];
    for (let f = 0; f < 6; f++) nodes.push({ face: f, level: 0, u0: 0, v0: 0, size: 1 });
    return nodes;
  }

  private rebuildQuadtree(nodes: QuadNode[]): void {
    const ids = nodes.map(nodeId).sort().join('|');
    if (ids === this.activeIds || !this.surfaceMat) return;
    this.activeIds = ids;
    // Clear current leaf meshes (geometry is cached, not disposed).
    for (let i = this.surfaceGroup.children.length - 1; i >= 0; i--) {
      this.surfaceGroup.remove(this.surfaceGroup.children[i]);
    }
    for (const n of nodes) {
      let geo = this.nodeGeoCache.get(nodeId(n));
      if (!geo) { geo = buildNodeGeometry(n, this.radius, NODE_RES); this.nodeGeoCache.set(nodeId(n), geo); }
      const leaf = new Mesh(geo, this.surfaceMat);
      // The leaf's undisplaced bounding sphere doesn't include the vertex-shader
      // displacement; at true scale + deep transforms that mis-cull can drop
      // whole patches ("missing faces"). The globe as a whole is culled by its
      // LOD stage, so per-leaf frustum culling only costs correctness here.
      leaf.frustumCulled = false;
      this.surfaceGroup.add(leaf);
    }
    // Evict cold cached leaves beyond the cap (never the active set).
    if (this.nodeGeoCache.size > MAX_LEAF_CACHE) {
      const active = new Set(nodes.map(nodeId));
      for (const [id, geo] of this.nodeGeoCache) {
        if (this.nodeGeoCache.size <= MAX_LEAF_CACHE) break;
        if (!active.has(id)) { geo.dispose(); this.nodeGeoCache.delete(id); }
      }
    }
  }

  // ── per-frame update ────────────────────────────────────────────────
  update(ctx: UpdateCtx): void {
    this.spinGroup.rotateY(this.spinRate * ctx.dt);

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
    if (this.atmosMesh) this.atmosMesh.visible = near;
    if (this.cloudMesh) this.cloudMesh.visible = near;
    if (this.ringMesh) this.ringMesh.visible = near;
    this.impostorMesh.visible = !near;

    if (near) {
      // Refresh quadtree from the camera's position in surface-local space.
      if (this.surfaceMat) {
        this.surfaceGroup.worldToLocal(_camLocal.copy(ctx.camera.position));
        const sel = selectSphere({
          camLocal: [_camLocal.x, _camLocal.y, _camLocal.z] as Vec3,
          radius: this.radius, detail: DETAIL, maxLevel: MAX_LEVEL,
        });
        this.rebuildQuadtree(sel);
        setSun(this.surfaceMat, sunDir);
      }
      if (this.giantMesh) { const m = this.giantMesh.material as ShaderMaterial; setSun(m, sunDir); m.uniforms.uTime.value = (m.uniforms.uTime.value + ctx.dt) % 1000; }
      if (this.atmosMesh) setSun(this.atmosMesh.material as ShaderMaterial, sunDir);
      // ONE weather clock (both materials + CPU storms). Wraps to keep f32 uniform
      // precision; storms reset on wrap so (T - born) never goes negative.
      this.cloudClock += ctx.dt;
      if (this.cloudClock >= 10000) { this.cloudClock %= 10000; this.cycStorms = []; }
      if (this.cloudMesh) {
        const m = this.cloudMesh.material as ShaderMaterial;
        setSun(m, sunDir);
        m.uniforms.uCloudTime.value = this.cloudClock;
      }
      if (this.surfaceMat) {
        // Sun in the surface's OBJECT space (cloud-shadow shell ray) + the shared
        // drift clock, so the ground shadow moves with the cloud overhead.
        const su = this.surfaceMat.uniforms;
        this.surfaceGroup.getWorldQuaternion(_qTmp);
        (su.uSunDirObj.value as Vector3).copy(sunDir).applyQuaternion(_qTmp.invert());
        su.uCloudTime.value = this.cloudClock;
      }
      if (!this.params.isGiant && this.params.cloudCover > 0) this.updateStorms();
      if (this.ringMesh) {
        const m = this.ringMesh.material as ShaderMaterial;
        setSun(m, sunDir);
        m.uniforms.uPlanetCenter.value.copy(_planetWorld);
        m.uniforms.uPlanetRadius.value = worldRadius;
      }
    } else {
      // Billboard the impostor to face the camera; dim below a pixel.
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
      u.uColor.value.set(this.impostorColor[0] * b, this.impostorColor[1] * b, this.impostorColor[2] * b);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of this.nodeGeoCache.values()) g.dispose();
    this.nodeGeoCache.clear();
    this.atlasTex?.dispose();
    this.surfaceMat?.dispose();
    this.giantMesh?.geometry.dispose();
    (this.giantMesh?.material as ShaderMaterial | undefined)?.dispose();
    this.atmosMesh?.geometry.dispose();
    (this.atmosMesh?.material as ShaderMaterial | undefined)?.dispose();
    this.cloudMesh?.geometry.dispose();
    (this.cloudMesh?.material as ShaderMaterial | undefined)?.dispose();
    if (this.ringMesh) {
      this.ringMesh.geometry.dispose();
      const m = this.ringMesh.material as ShaderMaterial;
      m.uniforms.uDensity.value?.dispose?.();
      m.dispose();
    }
    this.impostorMesh.geometry.dispose();
    this.impostorMat.dispose();
  }
}

const _tmpSun = new Vector3();
function setSun(m: ShaderMaterial, dir: Vector3): void {
  (m.uniforms.uSunDir.value as Vector3).copy(dir);
}

/** Build one quadtree leaf's grid geometry (smooth cube-sphere patch; the
 *  vertex shader adds displacement). Exported for the geometry test. */
export function buildNodeGeometry(node: QuadNode, radius: number, res: number): BufferGeometry {
  const face = CUBE_FACES[node.face];
  const dim = res + 1;
  const positions = new Float32Array(dim * dim * 3);
  const normals = new Float32Array(dim * dim * 3);
  const faceUV = new Float32Array(dim * dim * 2); // face-local (u,v) ∈ [0,1] → bake lookup
  // Per-vertex (constant per leaf) so the baked path never depends on a shared-
  // material per-leaf uniform — the leaf carries its own face index + axes.
  const aFace = new Float32Array(dim * dim);
  const aFaceU = new Float32Array(dim * dim * 3);
  const aFaceV = new Float32Array(dim * dim * 3);
  let k = 0, k2 = 0, k1 = 0;
  for (let iy = 0; iy <= res; iy++) {
    for (let ix = 0; ix <= res; ix++) {
      const u = node.u0 + node.size * (ix / res);
      const v = node.v0 + node.size * (iy / res);
      const s = cubeToSphere(facePoint(face, u, v));
      positions[k] = s[0] * radius; positions[k + 1] = s[1] * radius; positions[k + 2] = s[2] * radius;
      normals[k] = s[0]; normals[k + 1] = s[1]; normals[k + 2] = s[2];
      faceUV[k2] = u; faceUV[k2 + 1] = v;
      aFace[k1] = node.face;
      aFaceU[k] = face.axisU[0]; aFaceU[k + 1] = face.axisU[1]; aFaceU[k + 2] = face.axisU[2];
      aFaceV[k] = face.axisV[0]; aFaceV[k + 1] = face.axisV[1]; aFaceV[k + 2] = face.axisV[2];
      k += 3; k2 += 2; k1 += 1;
    }
  }
  // Wind triangles so the FRONT face points OUTWARD on every cube face. Half the
  // cube faces parametrise with opposite handedness, so a fixed winding faces
  // INWARD on them → a FrontSide material culls those patches: they vanish and
  // you see the interior through the gap (the "transparent/missing faces" bug).
  // Decide the flip from the ACTUAL built geometry (robust to the cube→sphere
  // warp): does the first triangle's face normal point inward from the centre?
  const facesIn = (i0: number, i1: number, i2: number): boolean => {
    const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3], by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3], cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    return nx * (ax + bx + cx) + ny * (ay + by + cy) + nz * (az + bz + cz) < 0;
  };
  const flip = facesIn(0, dim, 1); // default winding of the first quad = (a, c, b)
  const indices: number[] = [];
  for (let iy = 0; iy < res; iy++) {
    for (let ix = 0; ix < res; ix++) {
      const a = iy * dim + ix, b = a + 1, c = a + dim, d = c + 1;
      if (flip) indices.push(a, b, c, b, d, c);
      else indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('normal', new BufferAttribute(normals, 3));
  geo.setAttribute('faceUV', new BufferAttribute(faceUV, 2));
  geo.setAttribute('aFace', new BufferAttribute(aFace, 1));
  geo.setAttribute('aFaceU', new BufferAttribute(aFaceU, 3));
  geo.setAttribute('aFaceV', new BufferAttribute(aFaceV, 3));
  geo.setIndex(indices);
  return geo;
}

export type { Object3D };
