// ═══════════════════════════════════════════════════════════════════
// PROCEDURAL STAR — one uniform-driven material on a sphere (+ glow + S2
// prominences), built from a star's physical record.
//
// procedural-worlds-plan.md S1–S2. The mesh is a plain sphere at the star's
// authored body radius (WU), so it occupies the same system-layout footprint
// as the star it replaces and rides the local tier's SYSTEM_TIER_SCALE +
// floating origin unchanged (Broker). All appearance comes from the record via
// star-physics; nothing is hand-tuned per star. Deterministic from record.seed.
//
// LOD (the catalogue-ball lesson): as the star's apparent size shrinks on
// pull-back, uDetailFade collapses surface detail to a flat emissive disc and
// the glow/prominences fade — the star becomes a clean point-of-light whose
// brightness is carried by the shared HDR bloom, then the star group's icon
// takes over. Nothing here is screen-constant.
// ═══════════════════════════════════════════════════════════════════

import {
  AdditiveBlending, BackSide, Color, Group, Mesh,
  ShaderMaterial, SphereGeometry, Vector3, type Camera,
} from 'three';
import { SYSTEM_TIER_SCALE } from '../../core/metrics';
import { kelvinToRGB } from './kelvin';
import {
  differentialRate, emissiveGain, flareRate, granulationAmp, rotationRate,
  type StarRecord,
} from './star-physics';
import {
  coronaFragmentShader, coronaVertexShader, starFragmentShader, starVertexShader,
} from './star-shader';
import { createActiveRegions, MAX_FOOTPOINTS, type ActiveRegionField } from './active-regions';

export interface ProceduralStar {
  /** Scene-graph node to parent under the star group (rides local scale). */
  group: Group;
  /** Per-frame: advance animation, refresh LOD/billboards. `timeScale` is the
   *  sim time-compression (tc) so the surface churn accelerates with time-warp. */
  update(dt: number, camera: Camera, camDistWU: number, timeScale?: number): void;
  /** Re-point at a new record (system swap / dev override) without rebuilding. */
  setRecord(record: StarRecord): void;
  /** Free GPU resources. */
  dispose(): void;
}

/** Detail/glow LOD window in world-space apparent radius / camera distance.
 *  Above HI the star fills enough pixels for full detail; below LO it is a
 *  sub-pixel point (flat disc + bloom + icon hand-off). */
const LOD_LO = 0.0006;
const LOD_HI = 0.004;

const _camPos = new Vector3();
const _camObj = new Vector3();

export function createProceduralStar(opts: { record: StarRecord; bodyRadiusWU: number }): ProceduralStar {
  const { bodyRadiusWU } = opts;
  let record = opts.record;

  const group = new Group();
  group.name = 'procedural-star';

  // Magnetic footpoints fed to the surface shader (dark umbra + bright plage),
  // populated from the active-region field below and refreshed on setRecord.
  const spotDirs: Vector3[] = Array.from({ length: MAX_FOOTPOINTS }, () => new Vector3());
  const spotStr: number[] = new Array(MAX_FOOTPOINTS).fill(0);

  // ── Surface ──
  const surfaceMat = new ShaderMaterial({
    vertexShader: starVertexShader,
    fragmentShader: starFragmentShader,
    depthTest: true,
    depthWrite: true,
    uniforms: {
      uTime: { value: 0 },
      uTempK: { value: record.tempK },
      uRadius: { value: record.radiusSolar },
      uLuminosity: { value: record.luminositySolar },
      uGranulationAmp: { value: granulationAmp(record) },
      uActivity: { value: record.activity },
      uRotation: { value: rotationRate(record) },
      uDifferential: { value: differentialRate(record) },
      uEmissiveGain: { value: emissiveGain(record) },
      uFlareRate: { value: flareRate(record) },
      uDetailFade: { value: 1 },
      uSeed: { value: seedUnit(record.seed) },
      uSpotCount: { value: 0 },
      uSpotDir: { value: spotDirs },
      uSpotStr: { value: spotStr },
    },
  });
  const surfaceMesh = new Mesh(new SphereGeometry(bodyRadiusWU, 96, 96), surfaceMat);
  surfaceMesh.renderOrder = 0;
  group.add(surfaceMesh);

  // ── Volumetric corona (raymarched streamers on a bounding shell) ──
  // Rendered on the BACK faces so the fragment always exists across the shell's
  // whole disc (even with the camera close); the shader marches object-space
  // from the camera into the shell. Additive, no depth write. Radius rides the
  // star body so it LODs away with everything else.
  const coronaMat = new ShaderMaterial({
    vertexShader: coronaVertexShader,
    fragmentShader: coronaFragmentShader,
    side: BackSide,
    transparent: true,
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new Color(...kelvinToRGB(record.tempK)) },
      uCamObjPos: { value: new Vector3() },
      uIntensity: { value: 0 },       // set per-frame from the distance envelope
      uReach: { value: 0 },           // 0 hugs the limb, 1 flares outward
      uTime: { value: 0 },
      uActivity: { value: record.activity },
      uSeed: { value: seedUnit(record.seed) },
      uRs: { value: bodyRadiusWU },
      uRb: { value: bodyRadiusWU * CORONA_R },
    },
  });
  const coronaMesh = new Mesh(new SphereGeometry(bodyRadiusWU * CORONA_R, 32, 32), coronaMat);
  coronaMesh.renderOrder = 1;
  coronaMesh.frustumCulled = false;
  group.add(coronaMesh);
  let coronaBase = coronaIntensity(record); // record-driven brightness; enveloped by distance per frame

  // ── Magnetic active regions: coronal loops + flares + CME, anchored to the
  // same footpoints that darken the surface into sunspots (active-regions.ts). ──
  let field: ActiveRegionField = createActiveRegions(record, bodyRadiusWU);
  group.add(field.group);

  function feedSpots(): void {
    for (let i = 0; i < MAX_FOOTPOINTS; i++) {
      if (i < field.footCount) {
        spotDirs[i].set(field.footDir[i * 3], field.footDir[i * 3 + 1], field.footDir[i * 3 + 2]);
        spotStr[i] = field.footStr[i];
      } else {
        spotDirs[i].set(0, 0, 0);
        spotStr[i] = 0;
      }
    }
    surfaceMat.uniforms.uSpotCount.value = field.footCount;
  }
  feedSpots();

  function setRecord(next: StarRecord): void {
    record = next;
    const u = surfaceMat.uniforms;
    u.uTempK.value = record.tempK;
    u.uRadius.value = record.radiusSolar;
    u.uLuminosity.value = record.luminositySolar;
    u.uGranulationAmp.value = granulationAmp(record);
    u.uActivity.value = record.activity;
    u.uRotation.value = rotationRate(record);
    u.uDifferential.value = differentialRate(record);
    u.uEmissiveGain.value = emissiveGain(record);
    u.uFlareRate.value = flareRate(record);
    u.uSeed.value = seedUnit(record.seed);
    const cu = coronaMat.uniforms;
    (cu.uColor.value as Color).setRGB(...kelvinToRGB(record.tempK));
    coronaBase = coronaIntensity(record);
    cu.uActivity.value = record.activity;
    cu.uSeed.value = seedUnit(record.seed);
    // Active regions are seeded from the record → rebuild on a record change.
    group.remove(field.group);
    field.dispose();
    field = createActiveRegions(record, bodyRadiusWU);
    group.add(field.group);
    feedSpots();
  }

  let clock = 0;
  function update(dt: number, camera: Camera, camDistWU: number, timeScale = 1): void {
    // Shader clock advances on wall-clock dt so it lives at 1×, but the rate is
    // amplified (log-compressed, so warp speeds the churn a few× without the
    // domain exploding/aliasing) by the sim time-compression — "warp time to
    // watch it churn." Bounded modulus keeps it float32-safe over long sessions.
    const churn = 1 + 1.3 * Math.log10(Math.max(timeScale, 1));
    clock = (clock + dt * churn) % 4000;
    surfaceMat.uniforms.uTime.value = clock;
    coronaMat.uniforms.uTime.value = clock;

    // LOD: world-space apparent radius / distance → surface-detail fade.
    const worldRadius = bodyRadiusWU * SYSTEM_TIER_SCALE;
    const apparent = worldRadius / Math.max(camDistWU, 1e-6);
    const fade = smoothstep(LOD_LO, LOD_HI, apparent);
    surfaceMat.uniforms.uDetailFade.value = fade;

    // Corona distance envelope (camDist in WU, true scale): a small rim in-system,
    // flaring out through the Kuiper/outer-system, easing away entirely by the
    // heliopause. `baseline` keeps a faint always-on rim while the star is framed;
    // `flare` is the outer-system bump; both vanish past the heliopause.
    const flare = smoothstep(0.04, 0.22, camDistWU) * (1 - smoothstep(0.35, 0.9, camDistWU));
    const baseline = (1 - smoothstep(0.5, 1.2, camDistWU)) * 0.26;
    const env = Math.min(1, flare + baseline);
    coronaMat.uniforms.uIntensity.value = coronaBase * env;
    coronaMat.uniforms.uReach.value = 0.12 + 0.88 * env;

    // Camera position in the corona mesh's OBJECT space (body-radius units), so
    // the fragment can march the shell. worldToLocal needs an up-to-date matrix.
    camera.getWorldPosition(_camPos);
    coronaMesh.updateWorldMatrix(true, false);
    _camObj.copy(_camPos);
    coronaMesh.worldToLocal(_camObj);
    (coronaMat.uniforms.uCamObjPos.value as Vector3).copy(_camObj);

    field.update(clock, camera, fade);
  }

  function dispose(): void {
    surfaceMesh.geometry.dispose();
    surfaceMat.dispose();
    coronaMesh.geometry.dispose();
    coronaMat.dispose();
    field.dispose();
  }

  return { group, update, setRecord, dispose };
}

/** Corona bounding-shell radius, in star-body radii. The march density decays
 *  to ~0 well before this, so the visible corona reaches ~1.8× the disc while
 *  the shell gives the raymarch headroom. */
const CORONA_R = 2.6;

// ── Corona intensity: brighter for hot/active stars, never zero. ──
function coronaIntensity(record: StarRecord): number {
  const hotBoost = record.spectralType === 'O' || record.spectralType === 'B' ? 0.6 : 0;
  return 1.6 + 2.4 * record.activity + hotBoost;
}

/** Map a 32-bit seed to a stable [0,1000) shader offset (float32-safe). */
function seedUnit(seed: number): number {
  return ((seed >>> 0) % 1000000) / 1000;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
