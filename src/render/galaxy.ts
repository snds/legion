// ═══════════════════════════════════════════════════════════════════
// GALAXY — Milky Way Visualization
// Full galactic-scale content: spiral arm particles, bulge, halo,
// nebula clusters, core glow, Sgr A*, sector grid, quadrant labels,
// arm labels, alien territories, transit lines, influence spheres.
//
// Scale: 1 kpc = 333 world units → 15 kpc radius ≈ 5000 WU
// Sol sits at 8.3 kpc from galactic center in the Orion-Cygnus arm.
// The galaxy group is built in galactic coordinates (Sgr A* at origin),
// then offset by the caller so the home system maps to scene (0,0,0).
//
// Star markers are halo+core sprite stacks (no flat opaque discs).
// Influence rings + bob-space lines + transit paths are animated
// dashed lines driven by uTime via a shared ShaderMaterial factory.
// Transit progress carries a chevron token along the path.
// ═══════════════════════════════════════════════════════════════════

import {
  Group, Mesh, Points, Line, LineSegments, Sprite,
  SphereGeometry, RingGeometry, CircleGeometry, BoxGeometry, BufferGeometry, EdgesGeometry,
  MeshBasicMaterial, PointsMaterial, SpriteMaterial, ShaderMaterial,
  LineBasicMaterial,
  Float32BufferAttribute, Vector3, DoubleSide, BackSide, AdditiveBlending, NormalBlending,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor,
  CanvasTexture, Color, Camera,
} from 'three';
import { getStellarRenderSpect } from './planet-colors';
import { CURATED_SYSTEMS, galPos, distanceLy, type CuratedSystem } from '../data/curated-systems';
import { galacticStarsVertexShader, galacticStarsFragmentShader } from './shaders/galactic-stars';
import { sampleStellarPopulation, sampleHaloPopulation } from './stellar-population';
import { galacticDiscVolumeVertexShader, galacticDiscVolumeFragmentShader } from './shaders/galactic-disc-volume';
import {
  armPattern as mArmPattern, taper as mTaper, flare as mFlare, warpY as mWarpY,
  A_STARS as M_A_STARS, HR_THIN as M_HR_THIN, HZ_THIN as M_HZ_THIN,
  BAR_ANGLE as M_BAR_ANGLE,
  DISC_RADIUS_WU as M_DISC_RADIUS,
} from './galaxy-density';
import { KPC_TO_WU, GALAXY_MODEL_SCALE } from '../core/metrics';
import { Broker } from './scale-manager';
import {
  GALAXY_TUNE, galaxyLabVolumeUniforms, registerVolumeMat,
  clearGalaxyLabTargets, applyGalaxyTune,
} from './galaxy-lab';

// ── Stellar Population Sampling ──────────────────────────────────
//
// Each "star particle" stands for ~10⁶ real stars. To match how a
// galaxy actually reads visually, sampling is biased toward giants
// and supergiants (which dominate the integrated light even though
// dwarfs dominate the count). Color taken from MK Planckian table,
// size from luminosity class. The IMF-weighted samplers now live in
// stellar-population.ts (shared with the per-sector embedded stars); imported above.

// ── Scale Constants ──────────────────────────────────────────────

/** World units per kiloparsec. Galaxy radius ~15 kpc → ~5000 WU. */
export const KPC = KPC_TO_WU;

/** Sol's galactic position: 8.3 kpc from center in the galactic plane. */
export const SOL_GAL_POS = new Vector3(8.3 * KPC, 0, 0);

// ── Galactic disc-volume frame (scale-unification Phase 2b) ──────────
// The disc volume's world-space AABB + origin are refreshed each frame from the
// frame broker (updateGalaxyFrame), tracking the galactic tier root rather than a
// build-time snapshot. Under the 2b identity policy the root is constant
// (= −HOME_POS), so the per-frame write is idempotent — byte-identical to today;
// Phase 2c makes the root move per frame (and the AABB follows in lockstep).
// Half-extents are fixed — they are the disc BoxGeometry's size.
const DISC_RADIUS_WU = 15 * KPC;   // 4995 WU galaxy-LOCAL — disc box half-width/-depth
const DISC_Y_HALF_WU = 400;        // disc box half-height (~1.2 kpc, warp headroom)
// World-space disc half-extents (Phase 2c-1): the BoxGeometry is built at the
// galaxy-LOCAL size above and rides the group's ×GALAXY_MODEL_SCALE scale, so the
// world AABB the disc shader ray-clips against is the local half-extent × that scale.
const _discBoxHalf = new Vector3(DISC_RADIUS_WU, DISC_Y_HALF_WU, DISC_RADIUS_WU)
  .multiplyScalar(GALAXY_MODEL_SCALE);
const _galCenter = new Vector3();
let _galaxyGroup: Group | null = null;

// ── Texture Factories ────────────────────────────────────────────

function makeGlowTexture(size = 128): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,240,0.6)');
  grad.addColorStop(0.5, 'rgba(255,220,180,0.15)');
  grad.addColorStop(1, 'rgba(255,200,150,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(cv);
}

/** Tight, slightly Gaussian dot — for the crisp core of a star marker. */
function makeStarCoreTexture(size = 64): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(cv);
}

/** Bright, soft, additive halo — large diffuse falloff for stellar bloom. */
function makeStarHaloTexture(size = 256): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.15, 'rgba(255,255,255,0.32)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.08)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.02)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(cv);
}

/** Forward-pointing chevron, for transit tokens riding a dashed path. */
function makeChevronTexture(size = 64): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.2);
  ctx.lineTo(size * 0.8, size * 0.65);
  ctx.lineTo(size * 0.6, size * 0.65);
  ctx.lineTo(size * 0.5, size * 0.85);
  ctx.lineTo(size * 0.4, size * 0.65);
  ctx.lineTo(size * 0.2, size * 0.65);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return new CanvasTexture(cv);
}

function makeLabelSprite(
  text: string, color = 'rgba(255,255,255,0.5)', fontSize = 48,
): Sprite {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 256;
  const ctx = cv.getContext('2d')!;
  ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.toUpperCase(), 512, 128);
  const sp = new Sprite(new SpriteMaterial({
    map: new CanvasTexture(cv),
    transparent: true, depthTest: false, depthWrite: false,
  }));
  sp.scale.set(600, 150, 1);
  sp.userData._galSC = true; // screen-constant under the ×S group (Phase 2c-1)
  return sp;
}

// ── Animated Dashed Line Shader ──────────────────────────────────
// Reads the `lineDistance` attribute populated by Line.computeLineDistances().
// Fragment discards the gap segments; uTime scrolls the dash along the path.
// Tracked in DASHED_MATERIALS so the per-frame updater can tick them all.

const DASHED_MATERIALS: ShaderMaterial[] = [];

interface DashedOpts {
  color: number;
  opacity?: number;
  dash?: number;
  gap?: number;
  speed?: number;
}

function createDashedMaterial(opts: DashedOpts): ShaderMaterial {
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new Color(opts.color) },
      uOpacity: { value: opts.opacity ?? 0.6 },
      uDash: { value: opts.dash ?? 18 },
      uGap: { value: opts.gap ?? 24 },
      uTime: { value: 0 },
      uSpeed: { value: opts.speed ?? 12 },
    },
    vertexShader: /* glsl */ `
      attribute float lineDistance;
      varying float vLineDistance;
      void main() {
        vLineDistance = lineDistance;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uDash;
      uniform float uGap;
      uniform float uTime;
      uniform float uSpeed;
      varying float vLineDistance;
      void main() {
        float total = uDash + uGap;
        float d = mod(vLineDistance - uTime * uSpeed, total);
        if (d > uDash) discard;
        // Soft endcap on each dash segment for less aliasing
        float edge = min(d, uDash - d);
        float a = smoothstep(0.0, 1.5, edge);
        gl_FragColor = vec4(uColor, uOpacity * a);
      }
    `,
  });
  DASHED_MATERIALS.push(mat);
  return mat;
}

/** Build a dashed Line from a list of points. */
function dashedLine(points: Vector3[], opts: DashedOpts): Line {
  const geo = new BufferGeometry().setFromPoints(points);
  const line = new Line(geo, createDashedMaterial(opts));
  line.computeLineDistances();
  return line;
}

/** Per-frame tick — call once per render frame with elapsed seconds. */
export function updateGalaxyAnimations(t: number): void {
  for (const m of DASHED_MATERIALS) {
    m.uniforms.uTime.value = t;
  }
  for (const ch of TRANSIT_CHEVRONS) {
    // Pulse the chevron alpha gently
    const pulse = 0.65 + 0.35 * Math.sin(t * 2.0 + ch.userData.phase);
    (ch.material as SpriteMaterial).opacity = ch.userData.baseOpacity * pulse;
  }
}

// ── Galaxy LOD State + Updater ───────────────────────────────────
//
// Tied to camera distance, the galaxy layer crossfades between
// presentations so every zoom tier has meaningful structure:
//
//   camDist >  12000  (galaxy tier)
//     Main starField dominant. Nebula sprites faint backdrops.
//     Local detail and dust lanes invisible (would only add noise
//     at this scale).
//
//   camDist 6000..12000  (arm tier)
//     Local Orion Spur detail layer fades in from 0 → 0.85.
//     Dust lanes fade in from 0 → 0.55.
//     Nebulae open from background → recognizable features.
//     Main starField particle size grows so the disc has volume.
//
//   camDist 3000..6000  (sector tier)
//     Local detail at full, dust at full, nebulae fully visible.
//     starField at max size — you're inside the disc.
//
//   camDist < 3000  (heliopause and inward)
//     Galactic layer hidden by visibility.ts, all these materials
//     irrelevant.

interface GalaxyLODState {
  starFieldMat: ShaderMaterial | null;
  dustMat: PointsMaterial | null;
  discMats: ShaderMaterial[];           // stacked disc star layers
  nebulaMats: LineBasicMaterial[]; // nebula wireframe-cube outlines (Phase 2c-1 follow-up)
  volumeMat: ShaderMaterial | null;     // disc volume — Phase-4 crossfade target
  volumeMesh: Mesh | null;
}

const GALAXY_LOD: GalaxyLODState = {
  starFieldMat: null,
  dustMat: null,
  discMats: [],
  nebulaMats: [],
  volumeMat: null,
  volumeMesh: null,
};

// Shared world-space camera velocity vector. Every star material's
// uCamVelocity uniform points at THIS Vector3 — updating it via
// .copy() each frame propagates to all star shaders in one assignment.
const STAR_CAM_VELOCITY = new Vector3();
// Tracked star materials whose uStreakStrength gets driven each frame.
const STREAK_MATS: ShaderMaterial[] = [];

/** Common uniforms for any galactic-stars ShaderMaterial. Each material
 *  gets its own uSizeScale (driven by per-layer LOD) but all share the
 *  same camera-velocity vector by reference. */
function makeStarUniforms(initialSize = 1.0) {
  return {
    uSizeScale:      { value: initialSize },
    uPixelRatio:     { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1 },
    uCamVelocity:    { value: STAR_CAM_VELOCITY },
    uStreakStrength: { value: 0.0 },
    uMaxStretch:     { value: 0.4 },
  };
}

/** Push the camera velocity into the shared vector + drive the streak
 *  strength on every tracked star material. Called per-frame from main.ts. */
export function updateStarStreaks(camVelocity: Vector3): void {
  STAR_CAM_VELOCITY.copy(camVelocity);
  // Threshold gate: completely off below ~6000 WU/s (well above any
  // normal navigation/orbit speed). Ramps in across 6000→25000 WU/s,
  // which is the velocity range of an active flight-path traversal.
  // User constraint: streaks should be subtle/minor at all times.
  const speed = camVelocity.length();
  const strength = Math.min(1.0, Math.max(0.0, (speed - 6000) / 19000));
  for (const m of STREAK_MATS) {
    m.uniforms.uStreakStrength.value = strength;
  }
}

// 0..1 ramp helper
function smoothRamp(x: number, lo: number, hi: number): number {
  if (x <= lo) return 0;
  if (x >= hi) return 1;
  const t = (x - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
}

/** Call each frame with the current camera distance to tune galaxy LOD. */
/** Phase-4 crossfade (docs/galaxy-visual-redesign.md §5.4): 0 at/below
 *  camDist 2800 (system tiers + heliopause — baked-cube sky), 1 at/above
 *  3800 (live volume). The window sits INSIDE the sector tier, where the
 *  galaxy group is already visible — placing it earlier (spec's advisory
 *  2000→3000) made the group's nebula sprites/labels leak into heliopause.
 *  THE only permitted opacity ramp on the volume; main.ts drives
 *  scene.backgroundIntensity with (1 − this). */
export function getGalaxyCrossfade(camDist: number): number {
  // Phase 2c-1: the live volume takes over from the home-baked cube backdrop as
  // you pull back into the galaxy domain (focus shifts to Sgr A* at camDist
  // ~2.1e6). Below this the cube — a valid snapshot from home — carries the band.
  return smoothRamp(camDist, 6e5, 2e6);
}

// Motion-adaptive disc-raymarch step count (perf): full when settled, fewer
// while the camera zooms — the through-disc transition is where frames drop, and
// the coarser march is hidden by the motion. Eased to avoid a quality pop.
const DISC_STEPS_SETTLED = 24;
const DISC_STEPS_MOVING = 12;
let _discPrevCamDist = 0;
let _discSteps = DISC_STEPS_SETTLED;

export function updateGalaxyLOD(camDist: number): void {
  // Crossfade the live volume in across the heliopause→sector window; hide
  // the mesh entirely below it so the march cost is zero at system tiers.
  const xf = getGalaxyCrossfade(camDist);
  if (GALAXY_LOD.volumeMat) {
    GALAXY_LOD.volumeMat.uniforms.uOpacity.value = xf;
    // Relative camDist change per frame → 0 (settled) .. 1 (fast zoom). The
    // step count eases between full + reduced so the disc stays band-free when
    // you stop but the through-disc zoom transition costs ~half the raymarch.
    const rel = _discPrevCamDist > 0 ? Math.abs(camDist - _discPrevCamDist) / camDist : 0;
    _discPrevCamDist = camDist;
    const motion = Math.min(1, rel / 0.015);
    const target = DISC_STEPS_SETTLED - motion * (DISC_STEPS_SETTLED - DISC_STEPS_MOVING);
    _discSteps += (target - _discSteps) * 0.3;
    GALAXY_LOD.volumeMat.uniforms.uSteps.value = Math.round(_discSteps);
  }
  if (GALAXY_LOD.volumeMesh) GALAXY_LOD.volumeMesh.visible = xf > 0.001;

  // Top-level "is the galaxy present at this camera distance" curve (Phase
  // 2c-1 magnitudes). Fades the whole galactic body in across the spur→galaxy
  // pull-back (~4e5 → ~2e6 WU) so it's full by the time the focus reaches Sgr A*
  // and you frame the disc. Everything galactic-scale multiplies through this.
  const discPresence = smoothRamp(camDist, 4e5, 2e6);

  // Disc shader presence — drives uOpacity on every layer of the
  // stacked-thickness disc (each layer has its own ShaderMaterial
  // with a baked-in uLayerOpacity Gaussian weight).
  for (const m of GALAXY_LOD.discMats) {
    m.uniforms.uOpacity.value = discPresence;
  }

  // Main star field uses custom shader — size & opacity via uniforms.
  // The discPresence ramp drives BOTH a global scale on per-particle
  // size (so individual stars grow as you fly in) AND a multiplicative
  // overall presence (so stars fade in along with the disc shader).
  if (GALAXY_LOD.starFieldMat) {
    const u = GALAXY_LOD.starFieldMat.uniforms;
    // Stars get bigger when camera is close: 1.5× immersed in the spur,
    // back down to 0.8× at the full-galaxy frame. ×GALAXY_TUNE.particleSize (lab).
    const sizeT = smoothRamp(camDist, 2e6, 2e7);
    u.uSizeScale.value = (1.5 - sizeT * 0.7) * discPresence * GALAXY_TUNE.particleSize;
  }

  // (Orion-spur detail particles removed — read as a bug-like dense star patch
  //  when zooming out; the spiral arms + disc volume carry the local structure.)

  // Nebula wireframe-cube outlines: thin position/extent markers (Phase 2c-1
  // follow-up — the volumetric sprites were intrusive). Modest opacity, fading
  // with the galaxy presence so they vanish at the neighbourhood tier.
  for (const m of GALAXY_LOD.nebulaMats) {
    m.opacity = Math.min(0.7, 0.25 * discPresence * GALAXY_TUNE.nebulaOpacity);
  }
}

// Reference camDist at which the galaxy markers/labels were authored (the old
// galaxy-tier framing distance). Screen-constant sizing reproduces the SAME
// screen fraction each element had then, preserving the visual hierarchy.
const GAL_SC_REF = 12000;
const _gscPos = new Vector3();

/**
 * Screen-constant sizing for galaxy markers, labels, and Sgr A* (Phase 2c-1).
 * The galaxy group renders ×GALAXY_MODEL_SCALE larger, so every WU-fixed sprite
 * balloons ×S. Tagged elements (`userData._galSC`) are re-sized each frame to a
 * constant screen fraction using the TRUE camera→element distance — markers are
 * spread ~millions of WU apart, so the global camDist would mis-size them. The
 * `/ GALAXY_MODEL_SCALE` cancels the group scale; `_galSCuniform` scales all
 * three axes (the Sgr A* sphere) vs sprites' x/aspect. Base scale is captured
 * lazily on first run (after createGalaxy set each element's authored size).
 */
export function updateGalaxyMarkerScale(camera: Camera): void {
  if (!_galaxyGroup) return;
  _galaxyGroup.traverse((o) => {
    if (!o.userData?._galSC) return;
    if (!o.userData._galSCbase) o.userData._galSCbase = o.scale.clone();
    const b = o.userData._galSCbase as Vector3;
    o.getWorldPosition(_gscPos);
    const dist = camera.position.distanceTo(_gscPos);
    const lx = (b.x / GAL_SC_REF) * dist / GALAXY_MODEL_SCALE;
    if (o.userData._galSCuniform) o.scale.setScalar(lx);
    else o.scale.set(lx, lx * (b.y / b.x), 1);
  });
}

// ── Galaxy Data ──────────────────────────────────────────────────

// Galactic-tier star markers now come from CURATED_SYSTEMS (real galactocentric
// positions) — see the marker loop in createGalaxy. The fictional GAL_SYSTEMS
// list + GalSystem type were retired in Phase 2c-1 Inc 4.

const ALIEN_CIVS = [
  { name: 'Others', color: 0xef4444, localX: -45, localY: 2, localZ: -60, influenceRadius: 35 },
  { name: 'Deltans', color: 0x3ddc84, localX: 18, localY: -4, localZ: 28, influenceRadius: 8 },
  { name: 'Pav', color: 0xf4c430, localX: 55, localY: 6, localZ: -20, influenceRadius: 22 },
];

// from/to are looked up in CURATED_SYSTEMS. TRAPPIST-1 (iconic Bobiverse lore,
// kept in the roster) isn't in the 25-pc curated catalogue, so this transit's
// galaxy line silently doesn't draw (graceful skip below) — the roster narrative
// is preserved. To restore the visual, add TRAPPIST-1's real position.
const TRANSIT_BOBS = [
  { name: 'Magellan', color: 0xddaa44, from: 'Epsilon Eridani', to: 'TRAPPIST-1', progress: 0.35 },
];

// Track chevron sprites so the per-frame tick can pulse them.
const TRANSIT_CHEVRONS: Sprite[] = [];

// ── Galaxy Builder ───────────────────────────────────────────────

/**
 * Build the complete galaxy group in galactic coordinates (Sgr A* at origin).
 * Caller must offset by getGalaxyOffset() to place home system at scene origin.
 */
export function createGalaxy(): Group {
  // Reset per-frame trackers (createGalaxy may be called more than once under HMR)
  DASHED_MATERIALS.length = 0;
  STREAK_MATS.length = 0;
  TRANSIT_CHEVRONS.length = 0;
  GALAXY_LOD.starFieldMat = null;
  GALAXY_LOD.dustMat = null;
  GALAXY_LOD.discMats.length = 0;
  GALAXY_LOD.nebulaMats.length = 0;
  GALAXY_LOD.volumeMat = null;
  GALAXY_LOD.volumeMesh = null;
  clearGalaxyLabTargets(); // re-registered below (TEMPORARY)

  const galaxy = new Group();
  galaxy.name = 'galaxy';
  // Phase 2c-1: the galaxy is authored in its native 333-WU/kpc local frame;
  // scaling the GROUP lifts the whole body (particle arms, disc box, nebulae,
  // grid — every galaxy-local position) to the unified 1000-WU/pc render frame
  // in one transform. Point/line pixel sizes are unaffected; sprite/label/Sgr-A*
  // WU sizes balloon ×S and are made screen-constant in Inc 5. The disc density
  // model stays native-333 and is bridged via the shader's uModelScale (= S).
  galaxy.scale.setScalar(GALAXY_MODEL_SCALE);
  _galaxyGroup = galaxy; // tracked for the per-frame frame-broker updater (2b)

  const glowTex = makeGlowTexture();
  const coreTex = makeStarCoreTexture();
  const haloTex = makeStarHaloTexture();
  const chevronTex = makeChevronTexture();

  // ── 1. Foreground Stellar Sprinkle ────────────────────────────
  // With the procedural disc shader providing the continuous diffuse
  // structure, the particle field is no longer the dominant visual.
  // It now plays the role of "individual resolvable stars" sitting on
  // top of the diffuse background — sparse, small, mostly white pinpricks.
  // Counts massively reduced from the original 158K → ~38K total.

  const ARMS = 4;
  const ARM_SPREAD = 0.42;
  const ARM_COUNT = 50000;
  const GAL_RADIUS = 15;       // kpc
  // Log-spiral pitch matched to the disc shader's uArmTwist so the
  // particle arms and the procedural arms land in alignment. Pitch
  // tan⁻¹(1/ARM_TWIST) ≈ 13.4° — Milky Way is observed at ~12–14°.
  const ARM_TWIST = 4.2;
  // Bar orientation — SINGLE SOURCE: the shared analytic model (28°).
  const BAR_ANGLE = M_BAR_ANGLE;
  const ARM_PHASE_OFFSET = BAR_ANGLE;
  // Galactic warp — must match the disc shader's uWarp* uniforms so
  // particles ride the same warped plane as the procedural disc.
  const WARP_AMP_KPC = 1.0;       // amplitude at r=15 kpc (matches shader 333 WU / KPC=333)
  const WARP_INNER_KPC = 7.5;     // onset radius
  const WARP_ANGLE = Math.PI * 0.7;
  const warpY = (rk: number, xk: number, zk: number): number => {
    if (rk <= WARP_INNER_KPC) return 0;
    const amp = (rk - WARP_INNER_KPC) / (GAL_RADIUS - WARP_INNER_KPC) * WARP_AMP_KPC;
    const theta = Math.atan2(zk, xk);
    return amp * Math.sin(theta - WARP_ANGLE);
  };

  const armPts: number[] = [];
  const armCols: number[] = [];
  const armSizes: number[] = [];

  // Disc stars are REJECTION-SAMPLED against the shared analytic model
  // (galaxy-density.ts) — the same functions the volume shader marches — so
  // resolved stars and the unresolved glow agree BY CONSTRUCTION: two dominant
  // arms, the 28° bar phase, arm fade-out inside the bar region (this is what
  // kills the old inner 'curl'), exponential disc, flaring slab, outer taper,
  // and the model warp. (docs/galaxy-visual-redesign.md §7 Phase 5)
  const R_PEAK_P = M_HR_THIN * Math.exp(-1); // peak of the R·exp(−R/hR) weight
  let placed = 0;
  let guard = 0;
  while (placed < ARM_COUNT && guard++ < ARM_COUNT * 40) {
    const R = Math.random() * M_DISC_RADIUS;
    // area-weighted exponential disc: accept ∝ R·exp(−R/hR)
    if (Math.random() > (R * Math.exp(-R / M_HR_THIN)) / R_PEAK_P) continue;
    const theta = Math.random() * Math.PI * 2;
    // exact model arm modulation (two-major pattern incl. inner fade)
    if (Math.random() > (1 + M_A_STARS * mArmPattern(R, theta)) / (1 + M_A_STARS)) continue;
    if (Math.random() > mTaper(R)) continue;
    const x = R * Math.cos(theta);
    const z = R * Math.sin(theta);
    // Laplacian slab (matches exp(−|y|/hz)), flaring with R, on the model warp
    const hz = M_HZ_THIN * mFlare(R);
    const y = -hz * Math.log(1 - Math.random()) * (Math.random() < 0.5 ? -1 : 1)
      + mWarpY(x, z);
    armPts.push(x, y, z);

    // Per-particle Planckian color + luminosity-class size.
    const [cr, cg, cb, sz] = sampleStellarPopulation();
    armCols.push(cr, cg, cb);
    armSizes.push(sz);
    placed++;
  }

  // ── 2. Galactic Bulge + Bar Star Sprinkle (8K) ────────────────
  // The shader provides the bulge GLOW and bar feature; these particles
  // add resolved-star texture. 60% land in the bar region (elongated
  // ellipsoid at BAR_ANGLE matching the shader's bar geometry), 40% in
  // the spheroidal bulge.

  const BULGE_COUNT = 16000;
  const BAR_LEN = 2.7;     // kpc half-length, matches shader uBarLength*15
  const BAR_WID = 0.7;     // kpc half-width
  const BAR_THICK = 0.35;  // kpc half-thickness
  const cBar = Math.cos(BAR_ANGLE);
  const sBar = Math.sin(BAR_ANGLE);
  for (let i = 0; i < BULGE_COUNT; i++) {
    let x: number, y: number, z: number;
    if (Math.random() < 0.6) {
      // Bar — rejection-sample inside unit ellipsoid then scale and rotate
      // into the galactic plane at BAR_ANGLE.
      let lx = 0, ly = 0, lz = 0;
      for (let attempt = 0; attempt < 8; attempt++) {
        lx = Math.random() * 2 - 1;
        ly = Math.random() * 2 - 1;
        lz = Math.random() * 2 - 1;
        if (lx * lx + ly * ly + lz * lz <= 1) break;
      }
      const along = lx * BAR_LEN;
      const perp = lz * BAR_WID;
      x = (cBar * along - sBar * perp) * KPC;
      z = (sBar * along + cBar * perp) * KPC;
      y = ly * BAR_THICK * KPC;
    } else {
      // Spheroidal bulge — oblate
      const r = Math.pow(Math.random(), 0.65) * 2.2;
      const t = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      x = r * Math.sin(phi) * Math.cos(t) * KPC;
      y = r * Math.cos(phi) * KPC * 0.35;
      z = r * Math.sin(phi) * Math.sin(t) * KPC;
    }
    armPts.push(x, y, z);
    // Bulge/bar stars: old halo-like population
    const [cr, cg, cb, sz] = sampleHaloPopulation();
    armCols.push(cr, cg, cb);
    armSizes.push(sz);
  }

  // ── 3. Halo Star Sprinkle (3K) ────────────────────────────────
  // Sparse old population above/below the disc plane.
  const HALO_COUNT = 6000;
  for (let i = 0; i < HALO_COUNT; i++) {
    const r = 1 + Math.random() * 18;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const x = r * Math.sin(phi) * Math.cos(theta) * KPC;
    const y = r * Math.cos(phi) * KPC * 0.7;
    const z = r * Math.sin(phi) * Math.sin(theta) * KPC;
    armPts.push(x, y, z);
    // Halo stars are dim and old — boost slightly via population helper
    // but multiplied down to keep them as background sprinkle.
    const [cr, cg, cb, sz] = sampleHaloPopulation();
    armCols.push(cr * 0.35, cg * 0.32, cb * 0.30);
    armSizes.push(sz * 0.7);
  }

  const galGeo = new BufferGeometry();
  galGeo.setAttribute('position', new Float32BufferAttribute(armPts, 3));
  galGeo.setAttribute('color', new Float32BufferAttribute(armCols, 3));
  galGeo.setAttribute('aSize', new Float32BufferAttribute(armSizes, 1));
  // Custom stars shader: per-particle size + circular soft-falloff sprite.
  const starFieldMat = new ShaderMaterial({
    vertexShader: galacticStarsVertexShader,
    fragmentShader: galacticStarsFragmentShader,
    uniforms: makeStarUniforms(1.0),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const starField = new Points(galGeo, starFieldMat);
  galaxy.add(starField);
  GALAXY_LOD.starFieldMat = starFieldMat;
  STREAK_MATS.push(starFieldMat);


  // (Dust-lane strand particles deleted — the volume's per-channel dust
  // extinction is the principled version; docs §5.3.)

  // ── 3b. Volumetric Galactic Disc — Single Ray-Marched Box ─────
  //
  // Replaces the previous 9-disc + 8-dust stacked-plane assembly with
  // ONE BoxGeometry + raymarch fragment shader. The fragment marches
  // 24 steps from the camera-side AABB face through the box, sampling
  // disc emission and dust extinction at each step, with Beer-Lambert
  // compositing. Looks correct from any angle (including edge-on);
  // dust silhouettes light from behind in true 3D; one draw call.
  //
  // Box dimensions: 30 kpc wide × 1.0 kpc tall × 30 kpc deep. The Y
  // span is wider than the disc's vertical scale-height (uDiscThickness
  // ~0.3 kpc) to accommodate the galactic warp displacement at the
  // disc edge (~1 kpc) without clipping the volume.

  // DISC_RADIUS_WU (5000 WU) / DISC_Y_HALF_WU (400, ~1.2 kpc — warp + dust
  // headroom) are module consts now, shared with updateGalaxyFrame so the
  // per-frame AABB can never drift from the disc BoxGeometry size.

  // The galaxy group is positioned at getGalaxyOffset() in scene space
  // (so Sgr A* lands at Sgr's galactic coords = the group's local origin,
  // and home/ε-Eridani lands at scene origin). The box mesh sits at
  // group-local (0,0,0), so its world center equals the group's world
  // position. uBoxMin/uBoxMax must be in world coords for the shader's
  // ray-AABB intersection to align with the camera in world space.
  const galaxyWorldCenter = getGalaxyOffset();
  // World half-extents (= local box × group scale) for frame-0 correctness; the
  // per-frame updateGalaxyFrame refreshes these from the same scaled _discBoxHalf.
  const boxMin = galaxyWorldCenter.clone().sub(_discBoxHalf);
  const boxMax = galaxyWorldCenter.clone().add(_discBoxHalf);

  // v2: the shader marches the SHARED analytic galaxy model (galaxy-density
  // chunk — CI-calibrated, band-not-fog proven by vitest). Look uniforms are
  // gone: structure lives in the model; uEmissionScale is the ONLY brightness
  // knob (absolute level is auto-exposure's job). Premultiplied compositing:
  // emission adds over the sky while dust coverage occludes the additive star
  // Points rendered behind — the principled replacement for the deleted
  // core-glow sprites.
  const discVolumeMat = new ShaderMaterial({
    vertexShader: galacticDiscVolumeVertexShader,
    fragmentShader: galacticDiscVolumeFragmentShader,
    transparent: true,
    depthWrite: false,
    // BackSide ensures something always renders even when the camera is
    // INSIDE the box (the shader ray-clips to the AABB regardless).
    side: BackSide,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
    uniforms: {
      uBoxMin: { value: boxMin },
      uBoxMax: { value: boxMax },
      uGalaxyOrigin: { value: galaxyWorldCenter.clone() },
      uEmissionScale: { value: GALAXY_TUNE.emission },
      uOpacity: { value: 1.0 }, // pinned — Phase-4 crossfade is the only ramp
      uJitter: { value: 1.0 },  // live: break step banding. Bake sets 0 (smooth).
      uSteps: { value: 24 }, // active raymarch steps (≤ STEPS=24 loop bound); motion-adaptive
      uModelScale: { value: GALAXY_MODEL_SCALE }, // Phase 2c-1: group renders ×S larger;
                                   // the shader divides world rays back into the native-333 model.
      // Galaxy Lab live-tuning uniforms (TEMPORARY) — defaults = model constants.
      ...galaxyLabVolumeUniforms(),
    },
  });

  const discVolume = new Mesh(
    new BoxGeometry(2 * DISC_RADIUS_WU, 2 * DISC_Y_HALF_WU, 2 * DISC_RADIUS_WU),
    discVolumeMat,
  );
  discVolume.name = 'galactic-disc-volume'; // bake harness swaps a 256-step material onto this
  discVolume.renderOrder = 2;
  galaxy.add(discVolume);
  GALAXY_LOD.volumeMat = discVolumeMat;
  GALAXY_LOD.volumeMesh = discVolume;
  registerVolumeMat(discVolumeMat); // Galaxy Lab live tuning (TEMPORARY)
  // NOT pushed to GALAXY_LOD.discMats: the volume no longer participates in
  // the discPresence opacity ramp — the medium has ONE set of constants
  // (docs/galaxy-visual-redesign.md §4.5); the Phase-4 crossfade will be the
  // only permitted transition.

  // (Core-glow sprite trio deleted: the bulge/bar glow now comes from the
  // model's Hernquist+bar emission inside the volume — the sprites were a
  // chief cause of the interior tan-wash.)

  // ── 5. Nebula marker helper (outlined cubes) ──────────────────
  // Only the NAMED nebulae get a marker now (section 12b) — the 50 procedural
  // arm clusters were dropped as too busy. A nebula is a thin WIREFRAME CUBE
  // marking its position + extent; shared unit-cube edges, per-cube scale/
  // colour/material (LOD-faded by updateGalaxyLOD to vanish at neighbourhood
  // tier). The volumetric-cloud technique that preceded this is the candidate
  // for per-sector local-neighbourhood generation — see docs (kept in history).
  const nebCubeEdges = new EdgesGeometry(new BoxGeometry(1, 1, 1));
  const addNebulaCube = (cx: number, cy: number, cz: number, size: number, color: number): void => {
    const mat = new LineBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false });
    const cube = new LineSegments(nebCubeEdges, mat);
    cube.scale.setScalar(size);
    cube.position.set(cx, cy, cz);
    galaxy.add(cube);
    GALAXY_LOD.nebulaMats.push(mat);
  };

  // ── 6. Sagittarius A* ─────────────────────────────────────────

  const sgrA = new Mesh(
    new SphereGeometry(20, 16, 16),
    new MeshBasicMaterial({ color: 0xffffcc }),
  );
  sgrA.position.set(0, 0, 0);
  sgrA.userData = {
    type: 'phenomenon',
    name: 'Sagittarius A*',
    subtype: 'Supermassive Black Hole',
    description: 'Galactic core — 4.3 million solar masses',
    _galSC: true, _galSCuniform: true, // screen-constant point under the ×S group
  };
  galaxy.add(sgrA);
  // Glow + labels are SIBLINGS (not children) of the sphere: each is screen-
  // constant under the ×S group, and a screen-constant element can't ride a
  // screen-constant parent (the scales would compound). Positions are galaxy-
  // local at Sgr A* (origin), so they sit at the centre regardless.
  const sgrGlow = new Sprite(new SpriteMaterial({
    map: glowTex, color: 0xffffaa,
    transparent: true, blending: AdditiveBlending,
    depthWrite: false, opacity: 0.35,
  }));
  sgrGlow.scale.set(300, 300, 1);
  sgrGlow.userData._galSC = true;
  galaxy.add(sgrGlow);
  const sgrLabel = makeLabelSprite('SGR A*', 'rgba(255,255,255,0.35)', 48);
  sgrLabel.position.set(0, 50, 0);
  galaxy.add(sgrLabel);
  const mwLabel = makeLabelSprite('MILKY WAY', 'rgba(255,255,255,0.5)', 56);
  mwLabel.position.set(0, 110, 0);
  mwLabel.scale.set(800, 200, 1);
  galaxy.add(mwLabel);

  // ── 7. Sector Grid ────────────────────────────────────────────

  const sectorGrid = new Group();
  sectorGrid.name = 'sector-grid';
  for (let r = 5; r <= 20; r += 5) {
    const ringPts: Vector3[] = [];
    for (let j = 0; j <= 128; j++) {
      const a = (j / 128) * Math.PI * 2;
      ringPts.push(new Vector3(Math.cos(a) * r * KPC, 0, Math.sin(a) * r * KPC));
    }
    // Sector rings stay as soft solid lines (orientation reference, not active state)
    sectorGrid.add(new Line(
      new BufferGeometry().setFromPoints(ringPts),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uColor: { value: new Color(0xffffff) }, uOpacity: { value: 0.045 } },
        vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: 'uniform vec3 uColor;uniform float uOpacity;void main(){gl_FragColor=vec4(uColor,uOpacity);}',
      }),
    ));
  }
  for (let q = 0; q < 4; q++) {
    const a = (Math.PI / 2) * q;
    sectorGrid.add(new Line(
      new BufferGeometry().setFromPoints([
        new Vector3(0, 0, 0),
        new Vector3(Math.cos(a) * 22 * KPC, 0, Math.sin(a) * 22 * KPC),
      ]),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uColor: { value: new Color(0xffffff) }, uOpacity: { value: 0.06 } },
        vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: 'uniform vec3 uColor;uniform float uOpacity;void main(){gl_FragColor=vec4(uColor,uOpacity);}',
      }),
    ));
  }
  galaxy.add(sectorGrid);

  // ── 8. Quadrant + Arm Labels ───────────────────────────────────

  const qR = 10 * KPC;
  [
    { name: 'ALPHA', x: qR, z: qR },
    { name: 'BETA', x: -qR, z: qR },
    { name: 'GAMMA', x: -qR, z: -qR },
    { name: 'DELTA', x: qR, z: -qR },
  ].forEach(q => {
    const lbl = makeLabelSprite(q.name, 'rgba(255,255,255,0.06)', 60);
    lbl.position.set(q.x, 10, q.z);
    galaxy.add(lbl);
  });

  [
    { name: 'ORION–CYGNUS', x: 8 * KPC, z: 1.5 * KPC },
    { name: 'PERSEUS', x: 11 * KPC, z: 3 * KPC },
    { name: 'SAGITTARIUS', x: 5 * KPC, z: -2 * KPC },
  ].forEach(a => {
    const lbl = makeLabelSprite(a.name, 'rgba(255,255,255,0.04)', 48);
    lbl.scale.set(500, 125, 1);
    lbl.position.set(a.x, 5, a.z);
    galaxy.add(lbl);
  });

  // ── 9. Known Systems as Halo+Core Star Markers ────────────────
  //
  // Replaces the previous flat MeshBasicMaterial disc with a real-star
  // vocabulary: invisible raycast mesh + colored bloom halo + crisp
  // white core, Planckian-tinted by MK class. Active systems get a
  // larger halo, brighter core, and an animated dashed influence ring.

  const lyToWu = KPC / 1000;

  // Galaxy-LOCAL position (WU) of a curated system from its REAL galactocentric
  // parsecs (Phase 2c-1 Inc 4): galPos()·(KPC/1000) = the native 0.333 WU/pc
  // frame; the galaxy group's ×GALAXY_MODEL_SCALE lifts it to the unified
  // 1000 WU/pc. Sol lands at SOL_GAL_POS; home (ε Eri) sits just off it in the spur.
  const pcToWuNative = KPC / 1000; // 0.333 WU/pc in the native-333 frame (galPos is PARSECS)
  const galLocalPos = (sys: CuratedSystem): Vector3 => {
    const g = galPos(sys);
    return new Vector3(g.x * pcToWuNative, g.y * pcToWuNative, g.z * pcToWuNative);
  };

  CURATED_SYSTEMS.forEach(sys => {
    const pos = galLocalPos(sys);

    const stellar = getStellarRenderSpect(sys.spect);
    const isActive = sys.hasBobs;

    // Visible bloom halo sizes the hit target — at galactic camera distances
    // (~7000–12500 WU) a tiny mesh is unclickable. Sphere radius ≈ half the
    // visible halo so clicks land anywhere on the glow.
    const haloScale = isActive ? 360 + sys.bobCount * 30 : 140;
    const hitRadius = Math.max(40, haloScale * 0.55);
    const marker = new Mesh(
      new SphereGeometry(hitRadius, 12, 12),
      new MeshBasicMaterial({ color: stellar.core, transparent: true, opacity: 0.0001, depthWrite: false }),
    );
    marker.position.copy(pos);
    // Alias the curated fields to the keys the tooltip/selection panels read
    // (designation/spectralType/distLy) so galactic markers show real data.
    marker.userData = {
      type: 'gal_system', ...sys,
      designation: sys.desig, spectralType: sys.spect, distLy: distanceLy(sys),
      _pos: pos,
    };
    galaxy.add(marker);

    // Colored bloom halo — larger for active systems so eye is drawn to them.
    const halo = new Sprite(new SpriteMaterial({
      map: haloTex, color: stellar.halo,
      transparent: true, blending: AdditiveBlending,
      depthWrite: false, opacity: isActive ? 0.85 : 0.35,
    }));
    halo.scale.set(haloScale, haloScale, 1);
    halo.userData._galSC = true; // screen-constant under the ×S group (Phase 2c-1)
    marker.add(halo);

    // Crisp white-hot core — small, additive, always on top.
    const coreScale = isActive ? 110 : 60;
    const core = new Sprite(new SpriteMaterial({
      map: coreTex, color: stellar.core,
      transparent: true, blending: AdditiveBlending,
      depthWrite: false, opacity: isActive ? 1.0 : 0.65,
    }));
    core.scale.set(coreScale, coreScale, 1);
    core.userData._galSC = true; // screen-constant under the ×S group (Phase 2c-1)
    marker.add(core);

    if (isActive) {
      // Animated dashed influence ring (replaces the solid LineBasicMaterial ring)
      const infR = 60 + sys.bobCount * 30;
      const ringPts: Vector3[] = [];
      for (let j = 0; j <= 96; j++) {
        const a = (j / 96) * Math.PI * 2;
        ringPts.push(new Vector3(Math.cos(a) * infR, 0, Math.sin(a) * infR));
      }
      const infRing = dashedLine(ringPts, {
        color: stellar.halo, opacity: 0.45, dash: 12, gap: 16, speed: 6,
      });
      infRing.position.copy(pos);
      galaxy.add(infRing);

      // Translucent influence disc (gives the ring weight without being heavy)
      const discGeo = new RingGeometry(infR * 0.05, infR, 64);
      const disc = new Mesh(discGeo, new MeshBasicMaterial({
        color: stellar.halo, side: DoubleSide,
        transparent: true, opacity: 0.025, depthWrite: false,
      }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.copy(pos);
      galaxy.add(disc);
    }

    // Label
    const lbl = makeLabelSprite(
      sys.name,
      isActive ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)',
      isActive ? 40 : 32,
    );
    lbl.scale.set(400, 100, 1);
    lbl.position.set(0, (isActive ? 28 : 18), 0);
    marker.add(lbl);
  });

  // ── 10. Bob Space Overlay (dashed) ────────────────────────────

  const bobSystems = CURATED_SYSTEMS.filter(s => s.hasBobs);
  if (bobSystems.length > 1) {
    const positions = bobSystems.map(s => galLocalPos(s));
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        galaxy.add(dashedLine([positions[i], positions[j]], {
          color: 0xffffff, opacity: 0.12, dash: 8, gap: 14, speed: 4,
        }));
      }
    }
  }

  // ── 11. Alien Civilizations ─────────────────────────────────────

  ALIEN_CIVS.forEach(ac => {
    const pos = new Vector3(
      SOL_GAL_POS.x + ac.localX * lyToWu,
      ac.localY * lyToWu,
      SOL_GAL_POS.z + ac.localZ * lyToWu,
    );
    const infR = ac.influenceRadius * lyToWu;

    // Outlined (wireframe) sphere — the territory boundary, not a filled volume.
    // The fill stacked heavy where civs overlap; the wireframe reads as a light
    // boundary. Still the raycast hit target (raycasting uses the triangles).
    const sphere = new Mesh(
      new SphereGeometry(infR, 16, 10),
      new MeshBasicMaterial({
        color: ac.color, transparent: true, opacity: 0.16,
        wireframe: true, depthWrite: false,
      }),
    );
    sphere.position.copy(pos);
    sphere.userData = {
      type: 'alien_civ',
      name: ac.name,
      faction: ac.name,
      influenceRadius: ac.influenceRadius,
      color: ac.color,
    };
    galaxy.add(sphere);

    // Dashed boundary — distinct from Bob influence (different dash cadence)
    const ringPts: Vector3[] = [];
    for (let j = 0; j <= 96; j++) {
      const a = (j / 96) * Math.PI * 2;
      ringPts.push(new Vector3(
        pos.x + Math.cos(a) * infR, 0,
        pos.z + Math.sin(a) * infR,
      ));
    }
    galaxy.add(dashedLine(ringPts, {
      color: ac.color, opacity: 0.5, dash: 20, gap: 14, speed: 3,
    }));

    const lbl = makeLabelSprite(ac.name, `rgba(255,255,255,0.3)`, 36);
    lbl.scale.set(350, 88, 1);
    lbl.position.set(pos.x, 15, pos.z);
    galaxy.add(lbl);
  });

  // ── 12. Transit Lines + Chevron Tokens ─────────────────────────

  TRANSIT_BOBS.forEach((tb, i) => {
    const fromSys = CURATED_SYSTEMS.find(s => s.name === tb.from);
    const toSys = CURATED_SYSTEMS.find(s => s.name === tb.to);
    if (!fromSys || !toSys) return;

    const fromPos = galLocalPos(fromSys);
    const toPos = galLocalPos(toSys);

    // Animated dashed transit path
    galaxy.add(dashedLine([fromPos, toPos], {
      color: tb.color, opacity: 0.7, dash: 14, gap: 10, speed: 22,
    }));

    // Chevron token at current progress
    const progressPt = fromPos.clone().lerp(toPos, tb.progress);

    // Invisible hit target so the chevron is clickable at galactic scale
    const chevHit = new Mesh(
      new SphereGeometry(120, 8, 8),
      new MeshBasicMaterial({ color: tb.color, transparent: true, opacity: 0.0001, depthWrite: false }),
    );
    chevHit.position.copy(progressPt);
    chevHit.userData = {
      type: 'bob_transit',
      name: tb.name,
      from: tb.from,
      to: tb.to,
      progress: tb.progress,
    };
    galaxy.add(chevHit);

    const chevron = new Sprite(new SpriteMaterial({
      map: chevronTex, color: tb.color,
      transparent: true, depthWrite: false,
    }));
    chevron.scale.set(80, 80, 1);
    chevron.position.copy(progressPt);
    chevron.userData.baseOpacity = 0.85;
    chevron.userData.phase = i * 1.7;
    galaxy.add(chevron);
    TRANSIT_CHEVRONS.push(chevron);

    // Faint glow under chevron
    const dotGlow = new Sprite(new SpriteMaterial({
      map: haloTex, color: tb.color,
      transparent: true, blending: AdditiveBlending,
      depthWrite: false, opacity: 0.35,
    }));
    dotGlow.scale.set(180, 180, 1);
    dotGlow.position.copy(progressPt);
    galaxy.add(dotGlow);
  });

  // ── 12b. Named Galactic Phenomena ─────────────────────────────
  //
  // Recognizable nebulae and stellar nurseries placed at approximate
  // galactic positions. Each gets:
  //   • a colored additive sprite cluster (the visual)
  //   • a large invisible hit sphere (clickable + tooltip)
  //   • a label at galactic scale
  //   • userData.type = 'phenomenon' for selection/inspector wiring
  //
  // Positions are in galactic kpc relative to Sgr A* at origin.
  // Sol sits at (8.3, 0, 0) kpc. The galaxy group is later offset so
  // home (ε Eridani, co-located with Sol at this scale) lands at scene
  // origin; phenomena ride along.

  interface Phenomenon {
    name: string;
    kind: 'Nebula' | 'Stellar Nursery' | 'Supernova Remnant' | 'Molecular Cloud';
    color: number;
    coreColor: number;
    galX: number; galY: number; galZ: number;  // kpc relative to Sgr A*
    scale: number;  // visual size in WU
  }
  const PHENOMENA: Phenomenon[] = [
    {
      name: 'Orion Nebula', kind: 'Stellar Nursery',
      color: 0xff5544, coreColor: 0xffaa77,
      galX: 7.92, galY: -0.12, galZ: -0.19, scale: 400,
    },
    {
      name: 'Eagle Nebula', kind: 'Stellar Nursery',
      color: 0x3388ff, coreColor: 0x99ccff,
      galX: 6.3, galY: 0.05, galZ: -1.4, scale: 550,
    },
    {
      name: 'Crab Nebula', kind: 'Supernova Remnant',
      color: 0x33ccaa, coreColor: 0xaaffee,
      galX: 6.4, galY: 0.18, galZ: 1.5, scale: 320,
    },
    {
      name: 'Lagoon Nebula', kind: 'Stellar Nursery',
      color: 0xff4499, coreColor: 0xffaadd,
      galX: 7.0, galY: -0.08, galZ: -1.2, scale: 480,
    },
    {
      name: 'Carina Nebula', kind: 'Stellar Nursery',
      color: 0xff8833, coreColor: 0xffd088,
      galX: 5.6, galY: -0.05, galZ: 2.1, scale: 620,
    },
    {
      name: 'Rosette Nebula', kind: 'Nebula',
      color: 0xee3366, coreColor: 0xffaacc,
      galX: 7.5, galY: 0.10, galZ: -1.6, scale: 360,
    },
    {
      name: 'Pipe Nebula', kind: 'Molecular Cloud',
      color: 0x664488, coreColor: 0xaa88cc,
      galX: 8.2, galY: -0.02, galZ: 0.13, scale: 280,
    },
    {
      name: 'NGC 6334', kind: 'Stellar Nursery',
      color: 0xffaa44, coreColor: 0xffddaa,
      galX: 6.1, galY: -0.05, galZ: -1.7, scale: 500,
    },
  ];

  PHENOMENA.forEach(p => {
    const pos = new Vector3(p.galX * KPC, p.galY * KPC, p.galZ * KPC);

    // Outlined cube marking the nebula's position + extent (replaces the
    // intrusive cloud + core sprites; ~2.4× scale matched the old visible cloud).
    addNebulaCube(pos.x, pos.y, pos.z, p.scale * 2.4, p.color);

    // Invisible raycast hit sphere — sized to the visible cloud so the
    // entire bloom is clickable at galactic scale.
    const hit = new Mesh(
      new SphereGeometry(p.scale * 0.9, 12, 12),
      new MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.0001, depthWrite: false }),
    );
    hit.position.copy(pos);
    hit.userData = {
      type: 'phenomenon',
      name: p.name,
      subtype: p.kind,
      description: `${p.kind} — galactic position ${p.galX.toFixed(1)}, ${p.galY.toFixed(2)}, ${p.galZ.toFixed(1)} kpc`,
    };
    galaxy.add(hit);

    // Label — fades in at galactic scale, hairline at arm scale
    const lbl = makeLabelSprite(p.name, 'rgba(255,255,255,0.55)', 36);
    lbl.scale.set(420, 105, 1);
    lbl.position.set(pos.x, pos.y + 25, pos.z);
    galaxy.add(lbl);
  });

  // ── 13. Sol "You Are Here" Reticule ────────────────────────────
  // Four-bracket corner reticule + faint ring, evokes a tactical HUD
  // marker rather than a flat solid ring.

  const reticule = new Group();
  reticule.position.copy(SOL_GAL_POS);

  // Outer dashed ring
  const reticulePts: Vector3[] = [];
  const RET_R = 60;
  for (let j = 0; j <= 96; j++) {
    const a = (j / 96) * Math.PI * 2;
    reticulePts.push(new Vector3(Math.cos(a) * RET_R, 0, Math.sin(a) * RET_R));
  }
  reticule.add(dashedLine(reticulePts, {
    color: 0xffffff, opacity: 0.35, dash: 8, gap: 6, speed: 5,
  }));

  // Four bracket marks at cardinal points
  const BRACKET = 14;
  const positions: [number, number][] = [[RET_R, 0], [-RET_R, 0], [0, RET_R], [0, -RET_R]];
  for (const [bx, bz] of positions) {
    const dirX = bx !== 0 ? Math.sign(bx) : 0;
    const dirZ = bz !== 0 ? Math.sign(bz) : 0;
    // Inward-pointing L
    const bracketPts = [
      new Vector3(bx + (dirZ !== 0 ? -BRACKET : 0), 0, bz + (dirX !== 0 ? -BRACKET : 0)),
      new Vector3(bx, 0, bz),
      new Vector3(bx + (dirZ !== 0 ? BRACKET : 0), 0, bz + (dirX !== 0 ? BRACKET : 0)),
    ];
    reticule.add(new Line(
      new BufferGeometry().setFromPoints(bracketPts),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uColor: { value: new Color(0xffffff) }, uOpacity: { value: 0.55 } },
        vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: 'uniform vec3 uColor;uniform float uOpacity;void main(){gl_FragColor=vec4(uColor,uOpacity);}',
      }),
    ));
  }
  galaxy.add(reticule);

  // Sync persisted Galaxy Lab values onto the freshly built targets
  // (volume uniforms get them via galaxyLabVolumeUniforms(); this also
  // applies persisted nebula sizes + emission). TEMPORARY.
  applyGalaxyTune();

  return galaxy;
}

// ── Sector Volumetric Orb (Homeworld-style sensor bubble) ────────
//
// Translucent sphere centered on the home system showing the player's
// known navigable "sector." Fresnel-rimmed inner volume + cardinal
// latitude/longitude wireframes for spatial reference. Visible only
// at the sector zoom tier.
//
// Default radius (8000 WU on the regional scale) covers roughly the
// nearest 10-12 navigable systems out of STAR_SYSTEMS.

const SECTOR_ORB_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const SECTOR_ORB_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uRimColor;
  uniform float uOpacity;
  uniform float uRimPower;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float ndv = abs(dot(normalize(vNormal), normalize(vView)));
    float rim = pow(1.0 - ndv, uRimPower);
    vec3 color = mix(uColor, uRimColor, rim);
    float alpha = (rim * 0.85 + 0.05) * uOpacity;
    gl_FragColor = vec4(color, alpha);
  }
`;

export function createSectorOrb(radius = 8000): Group {
  const orb = new Group();
  orb.name = 'sector-orb';

  // Inner volumetric shell — fresnel-rimmed, additive, faint everywhere
  // and slightly more present at the silhouette/limb.
  const innerMat = new ShaderMaterial({
    transparent: true,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uColor:    { value: new Color(0x1c4080) },
      uRimColor: { value: new Color(0x4488ff) },
      uOpacity:  { value: 0.22 },     // dropped — was washing out markers inside
      uRimPower: { value: 2.4 },
    },
    vertexShader: SECTOR_ORB_VERT,
    fragmentShader: SECTOR_ORB_FRAG,
  });
  orb.add(new Mesh(new SphereGeometry(radius, 64, 32), innerMat));

  // Outer thin shell — slightly larger, only the limb is visible, sells
  // the "sensor boundary" edge.
  const outerMat = new ShaderMaterial({
    transparent: true,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uColor:    { value: new Color(0x2a5cb8) },
      uRimColor: { value: new Color(0x88bbff) },
      uOpacity:  { value: 0.18 },
      uRimPower: { value: 3.5 },
    },
    vertexShader: SECTOR_ORB_VERT,
    fragmentShader: SECTOR_ORB_FRAG,
  });
  orb.add(new Mesh(new SphereGeometry(radius * 1.015, 64, 32), outerMat));

  // Wireframe cardinals — equator + two perpendicular meridians.
  // Cheap visual anchors so the orb reads as a measured volume.
  const lineMat = new LineBasicMaterial({
    color: 0x5588dd, transparent: true, opacity: 0.35, depthWrite: false,
  });
  const SEG = 128;
  const equator: Vector3[] = [];
  const merX: Vector3[] = [];
  const merZ: Vector3[] = [];
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    equator.push(new Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    merX.push(new Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
    merZ.push(new Vector3(0, Math.sin(a) * radius, Math.cos(a) * radius));
  }
  orb.add(new Line(new BufferGeometry().setFromPoints(equator), lineMat));
  orb.add(new Line(new BufferGeometry().setFromPoints(merX), lineMat));
  orb.add(new Line(new BufferGeometry().setFromPoints(merZ), lineMat));

  return orb;
}

// ── Offset Helper ────────────────────────────────────────────────

/**
 * Returns the vector to subtract from galaxy group position so that
 * the home system (ε Eridani, co-located with Sol at galactic scale)
 * aligns with the scene origin (0,0,0).
 */
export function getGalaxyOffset(): Vector3 {
  // Scale-unification Phase 2b: the galactic tier root now comes from the frame
  // broker (the single float64 source). Under the 2b identity policy this returns
  // exactly −HOME_POS — byte-identical to the prior hand-computed offset from
  // GAL_SYSTEMS' home entry — and Phase 2c re-roots it per frame for the galPos()
  // re-pin. Thin facade so its 3 consumers (group position, disc-volume AABB,
  // Sgr A* camera focus) are unchanged.
  return Broker.getTierRoot('galactic');
}

/**
 * Per-frame (scale-unification Phase 2b): refresh the galaxy group position and
 * the disc-volume's WORLD-space AABB/origin uniforms from the frame broker, so
 * they track the galactic tier root instead of a build-time snapshot. Under the
 * 2b identity policy the root is constant (−HOME_POS) → the writes are idempotent
 * and there is no visual change; Phase 2c makes the root move per frame and the
 * AABB follows in lockstep (fixing the build-time-static uniform the floating
 * origin would otherwise leave stale). Call once per frame AFTER Broker.beginFrame()
 * and BEFORE the galaxy is consumed (visibility Sgr A* focus, the render).
 */
export function updateGalaxyFrame(): void {
  if (!_galaxyGroup) return;
  Broker.getTierRoot('galactic', _galCenter); // galaxy world center this frame
  _galaxyGroup.position.copy(_galCenter);
  const mat = GALAXY_LOD.volumeMat;
  if (mat) {
    (mat.uniforms.uGalaxyOrigin.value as Vector3).copy(_galCenter);
    (mat.uniforms.uBoxMin.value as Vector3).copy(_galCenter).sub(_discBoxHalf);
    (mat.uniforms.uBoxMax.value as Vector3).copy(_galCenter).add(_discBoxHalf);
  }
}
