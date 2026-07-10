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
import { galPos } from '../../data/curated-systems';
import { discModelUniforms } from '../galaxy-density';
import { classifyStarSpect, STELLAR_CLASS_COLOR } from '../planet-colors';
import { sectorCloudVertexShader, sectorCloudFragmentShader } from '../shaders/sector-cloud-volume';
import type { Sector } from './sector';

/** parsec → galaxy-local native WU (matches sector-stars.ts PC_TO_NATIVE). */
const PC_TO_NATIVE = KPC_TO_WU / 1000; // 0.333
/** world WU → native WU (the per-step + per-point scalar). */
const CONV_K = PC_TO_NATIVE / WU_PER_PC; // 0.000333

// Visual calibration (tune live). Emission brightness, wisp scale (native WU; ~3 pc/WU,
// so 12 ≈ 36 pc wisps), and the floor that keeps wisp gaps from going fully dark.
// The cloud is the unresolved-star AGGREGATE — kept SUBTLE so loaded neighbours sum
// additively, densest in the distance, thinning as you move into it (stars resolve).
const SECTOR_CLOUD_EMISSION = 0.15;
const SECTOR_CLOUD_SCALE = 5; // worldFBM scale, native WU (~3 pc/WU → ~15 pc wisps)
const SECTOR_CLOUD_FLOOR = 0.0; // dark wisp gaps → contrast (not fog)
const SECTOR_CLOUD_BOX_FACTOR = 1.3; // cloud box bigger than the sector → cloud breaches the bounds
// Camera-distance fade (the "move through fog" LOD): faint at the camera, full far out.
const SECTOR_CLOUD_FADE_FLOOR = 0.06; // strength right at the camera (≠ 0)
const SECTOR_CLOUD_FADE_FAR_WU = 160_000; // full strength ~160 pc out
const SECTOR_CLOUD_FEATHER_WU = 45_000; // soft box-edge feather (~45 pc)
// Cheap directional tint only (HG forward-scatter) — dramatic self-shadow lighting waits
// for a dense, high-contrast sector (the home neighbourhood is too sparse to light).
const SECTOR_CLOUD_SCATTER = 0.25;
const SECTOR_CLOUD_HG = 0.6;

/** Luminosity (☉) by spectral class — for picking a sector's dominant light.
 *  Mirrors system-gen.ts CLASS_DATA.lum. */
const CLASS_LUM: Record<string, number> = { O: 30000, B: 500, A: 20, F: 3, G: 1, K: 0.3, M: 0.04 };

/** The sector's dominant light = its brightest curated star (by spectral-class
 *  luminosity), as a native-WU position + linear-RGB colour. Falls back to the sector
 *  centre / warm white when the sector holds no curated systems. */
export function dominantLight(sector: Sector): { nativePos: Vector3; color: [number, number, number] } {
  let best: Sector['systems'][number] | null = null;
  let bestLum = -1;
  let bestCls = 'G';
  for (const s of sector.systems) {
    const cls = classifyStarSpect(s.spect);
    const lum = CLASS_LUM[cls] ?? 0;
    if (lum > bestLum) { bestLum = lum; best = s; bestCls = cls; }
  }
  const nativePos = new Vector3();
  if (best) {
    const g = galPos(best);
    nativePos.set(g.x, g.y, g.z).multiplyScalar(PC_TO_NATIVE);
  } else {
    sectorCenterNativeWU(sector, nativePos);
  }
  const hex = STELLAR_CLASS_COLOR[bestCls as keyof typeof STELLAR_CLASS_COLOR] ?? 0xfff4e8;
  const color: [number, number, number] = [
    ((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255,
  ];
  return { nativePos, color };
}
// Motion-adaptive raymarch steps (mirrors the disc's updateGalaxyLOD): full when
// settled, fewer while the camera moves (the log-spacing + jitter + motion hide it).
const SECTOR_CLOUD_STEPS_SETTLED = 16;
const SECTOR_CLOUD_STEPS_MOVING = 8;

// Render across the sector-viewing band, INCLUDING the immersive fly-through (the
// camera-distance fade + the in-shader skip of near/faded samples make immersion cheap
// — the screen-filling near part of the ray is skipped, only the fuller far part marches).
//   • Below MIN: the inner system tier (crisp planets, no fog).
//   • Above MAX: the analytic disc owns the far view.
// NOTE: camDist is a proxy that holds for the single home-centred prototype sector.
// Phase B (streamed sectors the camera flies between) wants a direct 3D AABB test.
export const SECTOR_CLOUD_MIN_CAMDIST = 5_000;
export const SECTOR_CLOUD_MAX_CAMDIST = 700_000;
// Inc 5 composition: the gate is a smooth CROSSFADE, not a hard visible-toggle, so the
// disc↔cloud↔system handoffs have no pop. Fade in over NEAR_MARGIN above MIN (pulling
// back off a system); fade out over FAR_MARGIN below MAX as the analytic disc fades in.
const SECTOR_CLOUD_NEAR_MARGIN = 10_000;
const SECTOR_CLOUD_FAR_MARGIN = 120_000;

function smoothstep01(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Cloud gate opacity [0..1] for a camDist — a smooth crossfade across the band edges
 *  (pure; unit-tested). 0 at the system tier, ramps to 1 across the band, ramps back to
 *  0 as the far disc takes over. This is the seam-free disc↔cloud↔system handoff. */
export function sectorCloudGateOpacity(camDist: number): number {
  const fadeIn = smoothstep01(SECTOR_CLOUD_MIN_CAMDIST, SECTOR_CLOUD_MIN_CAMDIST + SECTOR_CLOUD_NEAR_MARGIN, camDist);
  const fadeOut = 1 - smoothstep01(SECTOR_CLOUD_MAX_CAMDIST - SECTOR_CLOUD_FAR_MARGIN, SECTOR_CLOUD_MAX_CAMDIST, camDist);
  return fadeIn * fadeOut;
}

export interface SectorCloud {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly halfEdgeWU: number;
  /** Per-cloud motion-adaptive state — PER INSTANCE so N streamed clouds don't clobber
   *  each other's step easing (Phase B). */
  prevCamDist: number;
  steps: number;
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
  // The cloud box is larger than the sector so the volume feathers out PAST the sector
  // bounds (no hard cube). The AABB + sampling all use this enlarged extent.
  const edgeWU = sector.edgePc * WU_PER_PC * SECTOR_CLOUD_BOX_FACTOR;
  const halfEdgeWU = edgeWU * 0.5;
  const light = dominantLight(sector);
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
      uFadeNearFloor: { value: SECTOR_CLOUD_FADE_FLOOR },
      uFadeFarWU: { value: SECTOR_CLOUD_FADE_FAR_WU },
      uFeatherWU: { value: SECTOR_CLOUD_FEATHER_WU },
      uLightNativePos: { value: light.nativePos },
      uLightColor: { value: new Vector3(light.color[0], light.color[1], light.color[2]) },
      uScatter: { value: SECTOR_CLOUD_SCATTER },
      uHGg: { value: SECTOR_CLOUD_HG },
      // The shared sampleGalaxy GLSL reads the model-parameter uniforms (uDiscWidth,
      // uArmContrast, uBulgeAmp, uHiiAmp, uDustStrength, …). They MUST be supplied at
      // their calibrated defaults — omitted, GLSL defaults them to 0 and uDiscWidth=0
      // collapses the disc emission to nothing (exp(-|y|/0)).
      ...discModelUniforms(),
    },
  });
  const mesh = new Mesh(new BoxGeometry(edgeWU, edgeWU, edgeWU), material);
  mesh.name = 'sector-cloud';
  mesh.renderOrder = 3; // over the disc (2) + stars (0): premultiplied alpha occludes the Points behind
  // Disable culling: the group re-roots to the floating-origin residual every frame, but
  // three.js caches the frustum AABB from the build-time local AABB → it goes stale. The
  // shader's own ray-AABB clip is the real bound. (Same reason as the embedded stars.)
  mesh.frustumCulled = false;
  return { mesh, material, halfEdgeWU, prevCamDist: 0, steps: SECTOR_CLOUD_STEPS_SETTLED };
}

const _res = new Vector3();
/** Gate the cloud to its viewing band + refresh its per-frame uniforms (residual +
 *  world AABB) + motion-adaptive steps. Call AFTER updateSectorFrame each frame. */
export function updateSectorCloudFrame(sector: Sector, cloud: SectorCloud, camDist: number): void {
  const opacity = sectorCloudGateOpacity(camDist);
  cloud.mesh.visible = opacity > 0.002; // cull when fully faded
  cloud.material.uniforms.uOpacity.value = opacity; // smooth crossfade (no pop)
  // ALWAYS refresh the frame uniforms from THIS frame's residual (set by
  // updateSectorFrame). Refreshing even while hidden costs three vec3 writes but means
  // the first visible frame after re-entry samples correctly — no stale-residual swim.
  _res.copy(sector.group.position);
  (cloud.material.uniforms.uWorldResidual.value as Vector3).copy(_res);
  const h = cloud.halfEdgeWU;
  (cloud.material.uniforms.uBoxMin.value as Vector3).set(_res.x - h, _res.y - h, _res.z - h);
  (cloud.material.uniforms.uBoxMax.value as Vector3).set(_res.x + h, _res.y + h, _res.z + h);
  if (!cloud.mesh.visible) { cloud.prevCamDist = camDist; return; }
  // Motion-adaptive steps (mirrors the disc): full when settled, fewer while moving.
  // State is PER-CLOUD (cloud.prevCamDist/steps) so streamed clouds don't clobber each other.
  const rel = cloud.prevCamDist > 0 ? Math.abs(camDist - cloud.prevCamDist) / camDist : 0;
  cloud.prevCamDist = camDist;
  const motion = Math.min(1, rel / 0.015);
  const target = SECTOR_CLOUD_STEPS_SETTLED - motion * (SECTOR_CLOUD_STEPS_SETTLED - SECTOR_CLOUD_STEPS_MOVING);
  cloud.steps += (target - cloud.steps) * 0.3;
  cloud.material.uniforms.uSteps.value = Math.round(cloud.steps);
}

/** Dispose a cloud's GPU resources (geometry + material). Call when its sector unloads. */
export function disposeSectorCloud(cloud: SectorCloud): void {
  cloud.mesh.geometry.dispose();
  cloud.material.dispose();
}
