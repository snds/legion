// ═══════════════════════════════════════════════════════════════════
// SECTOR CLOUD — the renderable raymarched volume for one sector (Inc 3).
//
// A BackSide box (the sector AABB) with the sector-cloud shader, composited
// premultiplied over the disc + stars (same blend recipe as the disc volume).
// The box lives in sector.group, so it rides the floating origin; its world AABB
// and the residual it needs for native sampling are refreshed each frame from the
// group's current position (set by updateSectorFrame, which runs first).
// ═══════════════════════════════════════════════════════════════════

import {
  BackSide, BoxGeometry, CustomBlending, Mesh, OneFactor, OneMinusSrcAlphaFactor,
  ShaderMaterial, Vector3,
} from 'three';
import { KPC_TO_WU, WU_PER_PC } from '../../core/metrics';
import { galaxyLabVolumeUniforms } from '../galaxy-lab';
import { sectorCloudVertexShader, sectorCloudFragmentShader } from '../shaders/sector-cloud-volume';
import type { Sector } from './sector';

/** parsec → galaxy-local native WU (matches sector-stars.ts PC_TO_NATIVE). */
const PC_TO_NATIVE = KPC_TO_WU / 1000; // 0.333
/** world WU → native WU (the per-step + per-point scalar). */
const CONV_K = PC_TO_NATIVE / WU_PER_PC; // 0.000333

// Visual calibration (tune live). Emission brightness, wisp scale (native WU; ~3 pc/WU,
// so 12 ≈ 36 pc wisps), and the floor that keeps wisp gaps from going fully dark.
const SECTOR_CLOUD_EMISSION = 0.4;
const SECTOR_CLOUD_SCALE = 6; // worldFBM scale, native WU (~3 pc/WU → ~18 pc wisps)
const SECTOR_CLOUD_FLOOR = 0.12;
// Motion-adaptive raymarch steps (mirrors the disc's updateGalaxyLOD): full when
// settled, fewer while the camera moves (the log-spacing + jitter + motion hide it).
const SECTOR_CLOUD_STEPS_SETTLED = 16;
const SECTOR_CLOUD_STEPS_MOVING = 8;

// Render only across the "viewing the sector from OUTSIDE the box" camDist band. The
// 250 pc box's half-extent is 125,000 WU, so when the camera is focused on home,
// camDist ≈ camera-to-box-centre distance — MIN > 125,000 keeps the camera outside
// the box (the raymarch covers only the box's screen footprint, not full-screen).
//   • Below MIN: system tier (crisp planets) AND the immersive in-box case — both
//     need the cloud off (the immersive full-screen march wants a half-res pass
//     first; spec §perf — deferred to a later increment).
//   • Above MAX: the analytic disc owns the far view.
// NOTE: camDist is a proxy for "camera outside this box" that holds for the single
// home-centred prototype sector. Phase B (streamed sectors the camera flies between)
// must replace it with a direct 3D AABB containment test.
export const SECTOR_CLOUD_MIN_CAMDIST = 150_000;
export const SECTOR_CLOUD_MAX_CAMDIST = 700_000;

export interface SectorCloud {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly halfEdgeWU: number;
}

/** Native-WU centre of a sector (absolute galactocentric, the stable sampling anchor). */
export function sectorCenterNativeWU(sector: Sector, out = new Vector3()): Vector3 {
  return out.copy(sector.centerPc).multiplyScalar(PC_TO_NATIVE);
}

/** Shader's native-sampling formula (for tests): pNative = centreNative + pLocal·CONV_K.
 *  pLocal is the sector-local WU offset (= worldPoint − residual). */
export function sectorLocalWUToNative(sector: Sector, localWU: Vector3, out = new Vector3()): Vector3 {
  return out.copy(localWU).multiplyScalar(CONV_K).add(sectorCenterNativeWU(sector, _tmp));
}
const _tmp = new Vector3();

/** Build the sector's raymarched cloud volume (add .mesh to sector.group). */
export function buildSectorCloud(sector: Sector): SectorCloud {
  const edgeWU = sector.edgePc * WU_PER_PC;
  const halfEdgeWU = edgeWU * 0.5;
  const material = new ShaderMaterial({
    vertexShader: sectorCloudVertexShader,
    fragmentShader: sectorCloudFragmentShader,
    transparent: true,
    depthWrite: false,
    side: BackSide,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
    uniforms: {
      uBoxMin: { value: new Vector3() },
      uBoxMax: { value: new Vector3() },
      uSectorCenterNativeWU: { value: sectorCenterNativeWU(sector) },
      uWorldResidual: { value: new Vector3() },
      uConvK: { value: CONV_K },
      uEmissionScale: { value: SECTOR_CLOUD_EMISSION },
      uOpacity: { value: 1.0 },
      uJitter: { value: 1.0 },
      uSteps: { value: SECTOR_CLOUD_STEPS_SETTLED },
      uCloudScale: { value: SECTOR_CLOUD_SCALE },
      uCloudFloor: { value: SECTOR_CLOUD_FLOOR },
      // The shared sampleGalaxy GLSL reads the model-parameter uniforms (uDiscWidth,
      // uArmContrast, uBulgeAmp, uHiiAmp, uDustStrength, …). They MUST be supplied at
      // their calibrated defaults — omitted, GLSL defaults them to 0 and uDiscWidth=0
      // collapses the disc emission to nothing (exp(-|y|/0)).
      ...galaxyLabVolumeUniforms(),
    },
  });
  const mesh = new Mesh(new BoxGeometry(edgeWU, edgeWU, edgeWU), material);
  mesh.name = 'sector-cloud';
  mesh.renderOrder = 3; // over the disc (2) + stars (0): premultiplied alpha occludes the Points behind
  // Disable culling: the group re-roots to the floating-origin residual every frame, but
  // three.js caches the frustum AABB from the build-time local AABB → it goes stale. The
  // shader's own ray-AABB clip is the real bound. (Same reason as the embedded stars.)
  mesh.frustumCulled = false;
  return { mesh, material, halfEdgeWU };
}

const _res = new Vector3();
let _cloudPrevCamDist = 0;
let _cloudSteps = SECTOR_CLOUD_STEPS_SETTLED;
/** Gate the cloud to its viewing band + refresh its per-frame uniforms (residual +
 *  world AABB) + motion-adaptive steps. Call AFTER updateSectorFrame each frame. */
export function updateSectorCloudFrame(sector: Sector, cloud: SectorCloud, camDist: number): void {
  const visible = camDist >= SECTOR_CLOUD_MIN_CAMDIST && camDist <= SECTOR_CLOUD_MAX_CAMDIST;
  cloud.mesh.visible = visible;
  // ALWAYS refresh the frame uniforms from THIS frame's residual (set by
  // updateSectorFrame). Refreshing even while hidden costs three vec3 writes but means
  // the first visible frame after re-entry samples correctly — no stale-residual swim.
  _res.copy(sector.group.position);
  (cloud.material.uniforms.uWorldResidual.value as Vector3).copy(_res);
  const h = cloud.halfEdgeWU;
  (cloud.material.uniforms.uBoxMin.value as Vector3).set(_res.x - h, _res.y - h, _res.z - h);
  (cloud.material.uniforms.uBoxMax.value as Vector3).set(_res.x + h, _res.y + h, _res.z + h);
  if (!visible) { _cloudPrevCamDist = camDist; return; }
  // Motion-adaptive steps (mirrors the disc): full when settled, fewer while moving.
  const rel = _cloudPrevCamDist > 0 ? Math.abs(camDist - _cloudPrevCamDist) / camDist : 0;
  _cloudPrevCamDist = camDist;
  const motion = Math.min(1, rel / 0.015);
  const target = SECTOR_CLOUD_STEPS_SETTLED - motion * (SECTOR_CLOUD_STEPS_SETTLED - SECTOR_CLOUD_STEPS_MOVING);
  _cloudSteps += (target - _cloudSteps) * 0.3;
  cloud.material.uniforms.uSteps.value = Math.round(_cloudSteps);
}
