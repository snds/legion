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
  AdditiveBlending, BackSide, Color, DoubleSide, Group, Mesh, PlaneGeometry,
  ShaderMaterial, SphereGeometry, Vector3, type Camera,
} from 'three';
import { SYSTEM_TIER_SCALE } from '../../core/metrics';
import { mulberry32 } from '../../data/system-gen';
import { kelvinToRGB } from './kelvin';
import {
  differentialRate, emissiveGain, flareRate, granulationAmp, rotationRate,
  spotCoverage, type StarRecord,
} from './star-physics';
import {
  starFragmentShader, starGlowFragmentShader, starGlowVertexShader, starVertexShader,
} from './star-shader';

export interface ProceduralStar {
  /** Scene-graph node to parent under the star group (rides local scale). */
  group: Group;
  /** Per-frame: advance animation, refresh LOD/billboards. */
  update(dt: number, camera: Camera, camDistWU: number): void;
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

export function createProceduralStar(opts: { record: StarRecord; bodyRadiusWU: number }): ProceduralStar {
  const { bodyRadiusWU } = opts;
  let record = opts.record;

  const group = new Group();
  group.name = 'procedural-star';

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
      uSpotCoverage: { value: spotCoverage(record) },
      uActivity: { value: record.activity },
      uRotation: { value: rotationRate(record) },
      uDifferential: { value: differentialRate(record) },
      uEmissiveGain: { value: emissiveGain(record) },
      uFlareRate: { value: flareRate(record) },
      uDetailFade: { value: 1 },
      uSeed: { value: seedUnit(record.seed) },
    },
  });
  const surfaceMesh = new Mesh(new SphereGeometry(bodyRadiusWU, 96, 96), surfaceMat);
  surfaceMesh.renderOrder = 0;
  group.add(surfaceMesh);

  // ── Additive glow shell (scene-scaled — shrinks with the star) ──
  const glowMat = new ShaderMaterial({
    vertexShader: starGlowVertexShader,
    fragmentShader: starGlowFragmentShader,
    side: BackSide,
    transparent: true,
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new Color(...kelvinToRGB(record.tempK)) },
      uIntensity: { value: glowIntensity(record) },
      uDetailFade: { value: 1 },
    },
  });
  const glowMesh = new Mesh(new SphereGeometry(bodyRadiusWU * 1.6, 48, 48), glowMat);
  glowMesh.renderOrder = 1;
  glowMesh.frustumCulled = false;
  group.add(glowMesh);

  // ── S2 prominences: billboarded limb eruptions ──
  const prominences = createProminences(record, bodyRadiusWU);
  group.add(prominences.group);

  function setRecord(next: StarRecord): void {
    record = next;
    const u = surfaceMat.uniforms;
    u.uTempK.value = record.tempK;
    u.uRadius.value = record.radiusSolar;
    u.uLuminosity.value = record.luminositySolar;
    u.uGranulationAmp.value = granulationAmp(record);
    u.uSpotCoverage.value = spotCoverage(record);
    u.uActivity.value = record.activity;
    u.uRotation.value = rotationRate(record);
    u.uDifferential.value = differentialRate(record);
    u.uEmissiveGain.value = emissiveGain(record);
    u.uFlareRate.value = flareRate(record);
    u.uSeed.value = seedUnit(record.seed);
    (glowMat.uniforms.uColor.value as Color).setRGB(...kelvinToRGB(record.tempK));
    glowMat.uniforms.uIntensity.value = glowIntensity(record);
    prominences.setRecord(record);
  }

  let clock = 0;
  function update(dt: number, camera: Camera, camDistWU: number): void {
    // Bounded shader clock (float32-safe over long sessions, like sun.ts).
    clock = (clock + dt) % 1000;
    surfaceMat.uniforms.uTime.value = clock;

    // LOD: world-space apparent radius / distance → detail + glow fade.
    const worldRadius = bodyRadiusWU * SYSTEM_TIER_SCALE;
    const apparent = worldRadius / Math.max(camDistWU, 1e-6);
    const fade = smoothstep(LOD_LO, LOD_HI, apparent);
    surfaceMat.uniforms.uDetailFade.value = fade;
    glowMat.uniforms.uDetailFade.value = fade;

    camera.getWorldPosition(_camPos);
    prominences.update(clock, _camPos, fade);
  }

  function dispose(): void {
    surfaceMesh.geometry.dispose();
    surfaceMat.dispose();
    glowMesh.geometry.dispose();
    glowMat.dispose();
    prominences.dispose();
  }

  return { group, update, setRecord, dispose };
}

// ── Glow intensity: brighter for hot/active stars, never zero. ──
function glowIntensity(record: StarRecord): number {
  const hotBoost = record.spectralType === 'O' || record.spectralType === 'B' ? 0.25 : 0;
  return 0.6 + 0.9 * record.activity + hotBoost;
}

/** Map a 32-bit seed to a stable [0,1000) shader offset (float32-safe). */
function seedUnit(seed: number): number {
  return ((seed >>> 0) % 1000000) / 1000;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ── Billboarded limb prominences (S2) ────────────────────────────
// A deterministic set of camera-facing plasma tongues anchored to seeded
// surface points. Count and eruption strength scale with flareRate (frequent
// on young M dwarfs, none on O/B or quiet dwarfs). Each pulses on its own
// seeded schedule; billboarding + additive blend makes those near the limb
// read as arcs erupting off the edge. Radius rides the star body, so they
// shrink on pull-back with everything else.

interface Prominences {
  group: Group;
  setRecord(record: StarRecord): void;
  update(time: number, camWorldPos: Vector3, detailFade: number): void;
  dispose(): void;
}

const MAX_PROMINENCES = 10;
const _anchor = new Vector3();

const prominenceFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  // A soft upward tongue: bright, narrow base flaring out and fading with height.
  vec2 p = vUv - vec2(0.5, 0.0);
  float height = clamp(vUv.y, 0.0, 1.0);
  float width = mix(0.16, 0.42, height);
  float across = 1.0 - smoothstep(0.0, width, abs(p.x));
  float along = (1.0 - height) * smoothstep(0.0, 0.15, height); // fade at top + base
  float a = across * along * uOpacity;
  gl_FragColor = vec4(uColor * (0.6 + across), a);
}
`;
const prominenceVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

function createProminences(record0: StarRecord, bodyRadiusWU: number): Prominences {
  const group = new Group();
  group.name = 'star-prominences';

  const mat = new ShaderMaterial({
    vertexShader: prominenceVert,
    fragmentShader: prominenceFrag,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    uniforms: {
      uColor: { value: new Color(1.5, 0.55, 0.2) },
      uOpacity: { value: 0 },
    },
  });
  // Shared geometry (unit quad, pivot at base y=0 → grows outward).
  const geo = new PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);

  interface Tongue { mesh: Mesh; dir: Vector3; phase: number; rate: number; size: number; }
  const tongues: Tongue[] = [];

  function rebuild(record: StarRecord): void {
    for (const t of tongues) group.remove(t.mesh);
    tongues.length = 0;
    const rate = flareRate(record);
    const count = Math.round(rate * MAX_PROMINENCES);
    (mat.uniforms.uColor.value as Color).setRGB(...kelvinToRGB(Math.min(record.tempK, 6000)));
    const rng = mulberry32(record.seed ^ 0x9e3779b9);
    for (let i = 0; i < count; i++) {
      // Uniform point on the sphere.
      const u = rng() * 2 - 1;
      const theta = rng() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      const dir = new Vector3(r * Math.cos(theta), u, r * Math.sin(theta));
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      tongues.push({
        mesh, dir,
        phase: rng() * Math.PI * 2,
        rate: 0.15 + rng() * 0.4,
        size: bodyRadiusWU * (0.5 + rng() * 0.9),
      });
      group.add(mesh);
    }
  }

  rebuild(record0);

  function update(time: number, camWorldPos: Vector3, detailFade: number): void {
    for (const t of tongues) {
      // Seeded eruption schedule ∈[0,1]: mostly quiescent, occasional bursts.
      const cycle = Math.sin(time * t.rate + t.phase) * 0.5 + 0.5;
      const burst = Math.pow(cycle, 4); // sharp, infrequent peaks
      const scale = t.size * burst * detailFade;
      if (scale < 1e-5) { t.mesh.visible = false; continue; }
      t.mesh.visible = true;
      // Anchor just below the surface so the base is hidden behind the limb.
      _anchor.copy(t.dir).multiplyScalar(bodyRadiusWU * 0.96);
      t.mesh.position.copy(_anchor);
      // Billboard: face the camera, base pointing radially outward.
      t.mesh.lookAt(camWorldPos);
      t.mesh.scale.set(scale, scale * 1.6, scale);
    }
    // Global opacity rides the current flare strength.
    mat.uniforms.uOpacity.value = 0.9 * detailFade;
  }

  return {
    group,
    setRecord: rebuild,
    update,
    dispose() {
      geo.dispose();
      mat.dispose();
      tongues.length = 0;
    },
  };
}
