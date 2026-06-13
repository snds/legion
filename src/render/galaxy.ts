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
  Group, Mesh, Points, Line, Sprite,
  SphereGeometry, RingGeometry, CircleGeometry, BoxGeometry, BufferGeometry,
  MeshBasicMaterial, PointsMaterial, SpriteMaterial, ShaderMaterial,
  LineBasicMaterial,
  Float32BufferAttribute, Vector3, DoubleSide, BackSide, AdditiveBlending, NormalBlending,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor,
  CanvasTexture, Color,
} from 'three';
import { getStellarRender } from './planet-colors';
import { galacticStarsVertexShader, galacticStarsFragmentShader } from './shaders/galactic-stars';
import { galacticDiscVolumeVertexShader, galacticDiscVolumeFragmentShader } from './shaders/galactic-disc-volume';
import {
  armPattern as mArmPattern, taper as mTaper, flare as mFlare, warpY as mWarpY,
  A_STARS as M_A_STARS, HR_THIN as M_HR_THIN, HZ_THIN as M_HZ_THIN,
  BAR_ANGLE as M_BAR_ANGLE, PITCH as M_PITCH, ARM_REF_R as M_ARM_REF_R,
  DISC_RADIUS_WU as M_DISC_RADIUS,
} from './galaxy-density';

// ── Stellar Population Sampling ──────────────────────────────────
//
// Each "star particle" stands for ~10⁶ real stars. To match how a
// galaxy actually reads visually, sampling is biased toward giants
// and supergiants (which dominate the integrated light even though
// dwarfs dominate the count). Color taken from MK Planckian table,
// size from luminosity class.
//
// Returns: [r, g, b, sizePx]
// Stellar colors pulled closer to white — real stars on a black sky
// register as mostly white pinpricks with subtle hue tints rather than
// the saturated red/blue dots the previous palette gave. Tints below
// match what Gaia DR3 visualization renders use.
function sampleStellarPopulation(): [number, number, number, number] {
  const r = Math.random();
  // M giants — warm pastel
  if (r < 0.05) return [1.0, 0.85 + Math.random() * 0.07, 0.72 + Math.random() * 0.08, 4.5 + Math.random() * 2.0];
  // K giants — pale amber
  if (r < 0.14) return [1.0, 0.92 + Math.random() * 0.05, 0.82 + Math.random() * 0.08, 3.5 + Math.random() * 1.3];
  // O/B supergiants — pale ice blue
  if (r < 0.17) return [0.88 + Math.random() * 0.06, 0.93 + Math.random() * 0.05, 1.0, 4.0 + Math.random() * 2.0];
  // A/F bright main sequence — near-white, slight cool tint
  if (r < 0.27) return [0.97 + Math.random() * 0.03, 0.98 + Math.random() * 0.02, 1.0, 2.6 + Math.random() * 0.9];
  // G/K main sequence — near-white with warm tint (sun-like)
  if (r < 0.55) return [1.0, 0.98 + Math.random() * 0.02, 0.92 + Math.random() * 0.05, 1.8 + Math.random() * 0.7];
  // M dwarfs — pale warm
  return [1.0, 0.88 + Math.random() * 0.05, 0.78 + Math.random() * 0.08, 1.1 + Math.random() * 0.5];
}

// Halo / bulge — older, slightly warmer pastel
function sampleHaloPopulation(): [number, number, number, number] {
  const r = Math.random();
  if (r < 0.10) return [1.0, 0.90 + Math.random() * 0.05, 0.80 + Math.random() * 0.08, 2.8 + Math.random() * 1.4];
  if (r < 0.45) return [1.0, 0.96 + Math.random() * 0.03, 0.90 + Math.random() * 0.05, 1.8 + Math.random() * 0.6];
  return [1.0, 0.88 + Math.random() * 0.05, 0.78 + Math.random() * 0.08, 1.2 + Math.random() * 0.5];
}

// ── Scale Constants ──────────────────────────────────────────────

/** World units per kiloparsec. Galaxy radius ~15 kpc → ~5000 WU. */
export const KPC = 333;

/** Sol's galactic position: 8.3 kpc from center in the galactic plane. */
export const SOL_GAL_POS = new Vector3(8.3 * KPC, 0, 0);

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

function makeNebulaTexture(size = 128): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(220,80,180,0.5)');
  grad.addColorStop(0.3, 'rgba(180,40,160,0.25)');
  grad.addColorStop(0.6, 'rgba(140,30,140,0.08)');
  grad.addColorStop(1, 'rgba(100,20,120,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
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
  localArmMat: ShaderMaterial | null;
  dustMat: PointsMaterial | null;
  discMats: ShaderMaterial[];           // stacked disc star layers
  nebulaMats: SpriteMaterial[];
  volumeMat: ShaderMaterial | null;     // disc volume — Phase-4 crossfade target
  volumeMesh: Mesh | null;
}

const GALAXY_LOD: GalaxyLODState = {
  starFieldMat: null,
  localArmMat: null,
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
    uPixelRatio:     { value: Math.min(window.devicePixelRatio, 2) },
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
  return smoothRamp(camDist, 2800, 3800);
}

export function updateGalaxyLOD(camDist: number): void {
  // Crossfade the live volume in across the heliopause→sector window; hide
  // the mesh entirely below it so the march cost is zero at system tiers.
  const xf = getGalaxyCrossfade(camDist);
  if (GALAXY_LOD.volumeMat) GALAXY_LOD.volumeMat.uniforms.uOpacity.value = xf;
  if (GALAXY_LOD.volumeMesh) GALAXY_LOD.volumeMesh.visible = xf > 0.001;

  // Top-level "is the galaxy present at this camera distance" curve.
  // 0 at sector inner edge (~2500 WU) → 1 by the time we're in arm
  // range (~5500 WU). Everything galactic-scale (disc shader, particles,
  // dust, nebulae, phenomena) multiplies through this so the transition
  // from sector → arm is a smooth fade-in instead of a layer flip.
  const discPresence = smoothRamp(camDist, 2500, 5500);

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
    // Stars get bigger when camera is close: scale 1.5× at sector camDist,
    // back down to 0.8× at galaxy max.
    const sizeT = smoothRamp(camDist, 4500, 13000);
    u.uSizeScale.value = (1.5 - sizeT * 0.7) * discPresence;
  }

  // Local Orion Spur detail: SECTOR-tier feature only. Peaks at sector
  // camDist 3000–4500, falls off by mid-arm (6500 WU) so it doesn't
  // appear as a bright stellar cloud streaking through the galaxy view
  // at arm/galaxy tiers where you're meant to see the whole disc.
  if (GALAXY_LOD.localArmMat) {
    const closeFade = 1 - smoothRamp(camDist, 4500, 6500);
    const u = GALAXY_LOD.localArmMat.uniforms;
    u.uSizeScale.value = closeFade * 1.2 * discPresence;
  }

  // (dust-strand particles deleted; their LOD ramp removed with them)

  // Nebulae: prominent at arm scale, fading at galaxy and at sector.
  if (GALAXY_LOD.nebulaMats.length > 0) {
    const boost = 1 + (1 - smoothRamp(camDist, 6000, 13000)) * 1.8;
    for (const m of GALAXY_LOD.nebulaMats) {
      const base = (m.userData?._baseOpacity as number | undefined) ?? m.opacity;
      if (m.userData) m.userData._baseOpacity = base;
      m.opacity = Math.min(0.9, base * boost * discPresence);
    }
  }
}

// ── Galaxy Data ──────────────────────────────────────────────────

interface GalSystem {
  name: string;
  color: number;
  hasBobs: boolean;
  bobCount: number;
  isHome?: boolean;
  localX: number;
  localY: number;
  localZ: number;
}

/** Known star systems with local coords (light-years from Sol). */
export const GAL_SYSTEMS: GalSystem[] = [
  { name: 'Sol', color: 0xfff4e0, hasBobs: true, bobCount: 1, localX: 0, localY: 0, localZ: 0 },
  { name: 'Epsilon Eridani', color: 0xffc77d, hasBobs: true, bobCount: 4, isHome: true, localX: 3.7, localY: -7.8, localZ: 5.0 },
  { name: 'Proxima Centauri', color: 0xffaa88, hasBobs: true, bobCount: 1, localX: -1.6, localY: -1.2, localZ: -3.5 },
  { name: 'Tau Ceti', color: 0xffecc0, hasBobs: true, bobCount: 1, localX: 5.0, localY: -8.5, localZ: -5.0 },
  { name: 'Ross 128', color: 0xffa070, hasBobs: true, bobCount: 1, localX: -6.0, localY: 4.0, localZ: 7.0 },
  { name: 'TRAPPIST-1', color: 0xff7040, hasBobs: false, bobCount: 0, localX: -20.0, localY: -5.0, localZ: -32.0 },
  { name: 'Sirius', color: 0xd0e0ff, hasBobs: false, bobCount: 0, localX: -3.0, localY: -4.0, localZ: -6.0 },
  { name: 'Procyon', color: 0xfff0cc, hasBobs: false, bobCount: 0, localX: 5.0, localY: 2.0, localZ: -8.0 },
  { name: 'Wolf 359', color: 0xff9060, hasBobs: false, bobCount: 0, localX: -4.0, localY: 5.0, localZ: 2.0 },
  { name: 'Luyten', color: 0xffbb80, hasBobs: false, bobCount: 0, localX: -8.0, localY: -3.0, localZ: -5.0 },
  { name: 'Lacaille 9352', color: 0xffaa70, hasBobs: false, bobCount: 0, localX: 2.0, localY: -6.0, localZ: 8.0 },
  { name: '61 Cygni', color: 0xffc080, hasBobs: false, bobCount: 0, localX: 6.0, localY: 3.0, localZ: -7.0 },
];

const ALIEN_CIVS = [
  { name: 'Others', color: 0xef4444, localX: -45, localY: 2, localZ: -60, influenceRadius: 35 },
  { name: 'Deltans', color: 0x3ddc84, localX: 18, localY: -4, localZ: 28, influenceRadius: 8 },
  { name: 'Pav', color: 0xf4c430, localX: 55, localY: 6, localZ: -20, influenceRadius: 22 },
];

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
  GALAXY_LOD.localArmMat = null;
  GALAXY_LOD.dustMat = null;
  GALAXY_LOD.discMats.length = 0;
  GALAXY_LOD.nebulaMats.length = 0;
  GALAXY_LOD.volumeMat = null;
  GALAXY_LOD.volumeMesh = null;

  const galaxy = new Group();
  galaxy.name = 'galaxy';

  const glowTex = makeGlowTexture();
  const nebulaTex = makeNebulaTexture();
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

  // ── 3c. Orion Spur Local Detail (40K) ─────────────────────────
  // Higher-density particle cloud concentrated around home, oriented
  // along the local arm tangent. Fades in across the ARM tier so that
  // when the camera is immersed in the disc, the immediate surrounding
  // volume has real density and variation rather than the broad-disc
  // sample. Colors lean blue-white (young arm stars) with a warm minority.

  // Local-arm detail layer is a SECTOR-tier feature only — it represents
  // the player's immediate stellar neighborhood and should be visually
  // subtle, not the dominant element at arm tier. Was 80000 which read
  // as a bright streak across the disc at arm tier.
  const LOCAL_N = 18000;
  const localPts: number[] = [];
  const localCols: number[] = [];
  const localSizes: number[] = [];

  // Orion Spur tangent at Sol — roughly galactic longitude 80°.
  const armDirAngle = Math.PI * 80 / 180;
  const ax = Math.cos(armDirAngle), az = Math.sin(armDirAngle);
  const px = -az, pz = ax;  // perpendicular in disc plane

  const SPUR_LEN = 3.0;     // kpc along arm
  const SPUR_WIDTH = 0.7;   // kpc perpendicular
  const SPUR_HEIGHT = 0.18; // kpc above/below disc

  for (let i = 0; i < LOCAL_N; i++) {
    // Gaussian-ish along arm via sum of uniforms (cheap CLT)
    const u = ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * 2;
    const v = ((Math.random() + Math.random()) / 2 - 0.5) * 2;
    const w = (Math.random() - 0.5) * 2;
    const along = u * SPUR_LEN;
    const perp = v * SPUR_WIDTH * (1 - Math.abs(u) * 0.25);
    const up = w * SPUR_HEIGHT * (1 - Math.abs(u) * 0.3);

    // Position is relative to Sol's galactic coords (8.3, 0, 0) kpc.
    const x = (8.3 + ax * along + px * perp) * KPC;
    const y = up * KPC;
    const z = (0   + az * along + pz * perp) * KPC;
    localPts.push(x, y, z);

    // Orion Spur stellar population — young arm stars, slightly bluer
    // and more uniform-luminosity than the general disc sample.
    const [cr, cg, cb, sz] = sampleStellarPopulation();
    localCols.push(cr, cg, cb);
    localSizes.push(sz);
  }

  const localGeo = new BufferGeometry();
  localGeo.setAttribute('position', new Float32BufferAttribute(localPts, 3));
  localGeo.setAttribute('color', new Float32BufferAttribute(localCols, 3));
  localGeo.setAttribute('aSize', new Float32BufferAttribute(localSizes, 1));
  const localArmMat = new ShaderMaterial({
    vertexShader: galacticStarsVertexShader,
    fragmentShader: galacticStarsFragmentShader,
    uniforms: makeStarUniforms(0.0),  // size driven by LOD updater
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  STREAK_MATS.push(localArmMat);
  const localArmField = new Points(localGeo, localArmMat);
  localArmField.name = 'orion-spur-detail';
  galaxy.add(localArmField);
  GALAXY_LOD.localArmMat = localArmMat;

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

  const DISC_RADIUS_WU = 15 * KPC;   // 5000 WU
  // Y half-extent ~1.2 kpc — wide enough for ±1 kpc warp + dust thickness,
  // narrow enough that march steps land within the disc material rather
  // than skipping over empty space above/below.
  const DISC_Y_HALF_WU = 400;

  // The galaxy group is positioned at getGalaxyOffset() in scene space
  // (so Sgr A* lands at Sgr's galactic coords = the group's local origin,
  // and home/ε-Eridani lands at scene origin). The box mesh sits at
  // group-local (0,0,0), so its world center equals the group's world
  // position. uBoxMin/uBoxMax must be in world coords for the shader's
  // ray-AABB intersection to align with the camera in world space.
  const galaxyWorldCenter = getGalaxyOffset();
  const boxMin = galaxyWorldCenter.clone().add(new Vector3(-DISC_RADIUS_WU, -DISC_Y_HALF_WU, -DISC_RADIUS_WU));
  const boxMax = galaxyWorldCenter.clone().add(new Vector3( DISC_RADIUS_WU,  DISC_Y_HALF_WU,  DISC_RADIUS_WU));

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
      uEmissionScale: { value: 0.002 },
      uOpacity: { value: 1.0 }, // pinned — Phase-4 crossfade is the only ramp
      uJitter: { value: 1.0 },  // live: break step banding. Bake sets 0 (smooth).
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
  // NOT pushed to GALAXY_LOD.discMats: the volume no longer participates in
  // the discPresence opacity ramp — the medium has ONE set of constants
  // (docs/galaxy-visual-redesign.md §4.5); the Phase-4 crossfade will be the
  // only permitted transition.

  // (Core-glow sprite trio deleted: the bulge/bar glow now comes from the
  // model's Hernquist+bar emission inside the volume — the sprites were a
  // chief cause of the interior tan-wash.)

  // ── 5. Nebula Clusters (along spiral arms) ────────────────────
  const NEBULA_COUNT = 50;
  for (let i = 0; i < NEBULA_COUNT; i++) {
    // Star-forming regions sit on the MODEL's m=2 arm crests, slightly
    // DOWNSTREAM of the dust lane (density-wave anatomy), alternating arms.
    const R = 1400 + Math.random() * 3000;
    const lnTerm = Math.log(R / M_ARM_REF_R) / Math.tan(M_PITCH);
    const theta = lnTerm + (i % 2) * Math.PI + 0.10 + (Math.random() - 0.5) * 0.18;
    const x = R * Math.cos(theta);
    const z = R * Math.sin(theta);
    const y = (Math.random() - 0.5) * 100 + mWarpY(x, z);

    const hueShift = Math.random();
    const nebR = 0.65 + hueShift * 0.3;
    const nebG = 0.08 + (1 - hueShift) * 0.15;
    const nebB = 0.55 + (1 - hueShift) * 0.35;
    const nebColor = (Math.floor(nebR * 255) << 16)
      | (Math.floor(nebG * 255) << 8)
      | Math.floor(nebB * 255);

    const nebMat = new SpriteMaterial({
      map: nebulaTex, color: nebColor,
      transparent: true, blending: AdditiveBlending,
      depthWrite: false, opacity: 0.18 + Math.random() * 0.18,
    });
    const nebula = new Sprite(nebMat);
    const size = 400 + Math.random() * 900;
    nebula.scale.set(size, size, 1);
    nebula.position.set(x, y, z);
    galaxy.add(nebula);
    GALAXY_LOD.nebulaMats.push(nebMat);
  }

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
  };
  const sgrGlow = new Sprite(new SpriteMaterial({
    map: glowTex, color: 0xffffaa,
    transparent: true, blending: AdditiveBlending,
    depthWrite: false, opacity: 0.35,
  }));
  sgrGlow.scale.set(300, 300, 1);
  sgrA.add(sgrGlow);
  const sgrLabel = makeLabelSprite('SGR A*', 'rgba(255,255,255,0.35)', 48);
  sgrLabel.position.set(0, 50, 0);
  sgrA.add(sgrLabel);
  const mwLabel = makeLabelSprite('MILKY WAY', 'rgba(255,255,255,0.5)', 56);
  mwLabel.position.set(0, 110, 0);
  mwLabel.scale.set(800, 200, 1);
  sgrA.add(mwLabel);
  galaxy.add(sgrA);

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

  GAL_SYSTEMS.forEach(sys => {
    const pos = new Vector3(
      SOL_GAL_POS.x + sys.localX * lyToWu,
      sys.localY * lyToWu,
      SOL_GAL_POS.z + sys.localZ * lyToWu,
    );

    const stellar = getStellarRender(sys.name);
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
    marker.userData = { type: 'gal_system', ...sys, _pos: pos };
    galaxy.add(marker);

    // Colored bloom halo — larger for active systems so eye is drawn to them.
    const halo = new Sprite(new SpriteMaterial({
      map: haloTex, color: stellar.halo,
      transparent: true, blending: AdditiveBlending,
      depthWrite: false, opacity: isActive ? 0.85 : 0.35,
    }));
    halo.scale.set(haloScale, haloScale, 1);
    marker.add(halo);

    // Crisp white-hot core — small, additive, always on top.
    const coreScale = isActive ? 110 : 60;
    const core = new Sprite(new SpriteMaterial({
      map: coreTex, color: stellar.core,
      transparent: true, blending: AdditiveBlending,
      depthWrite: false, opacity: isActive ? 1.0 : 0.65,
    }));
    core.scale.set(coreScale, coreScale, 1);
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

  const bobSystems = GAL_SYSTEMS.filter(s => s.hasBobs);
  if (bobSystems.length > 1) {
    const positions = bobSystems.map(s => new Vector3(
      SOL_GAL_POS.x + s.localX * lyToWu,
      s.localY * lyToWu,
      SOL_GAL_POS.z + s.localZ * lyToWu,
    ));
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

    const sphere = new Mesh(
      new SphereGeometry(infR, 24, 24),
      new MeshBasicMaterial({
        color: ac.color, transparent: true, opacity: 0.05,
        side: DoubleSide, depthWrite: false,
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
    const fromSys = GAL_SYSTEMS.find(s => s.name === tb.from);
    const toSys = GAL_SYSTEMS.find(s => s.name === tb.to);
    if (!fromSys || !toSys) return;

    const fromPos = new Vector3(
      SOL_GAL_POS.x + fromSys.localX * lyToWu,
      fromSys.localY * lyToWu,
      SOL_GAL_POS.z + fromSys.localZ * lyToWu,
    );
    const toPos = new Vector3(
      SOL_GAL_POS.x + toSys.localX * lyToWu,
      toSys.localY * lyToWu,
      SOL_GAL_POS.z + toSys.localZ * lyToWu,
    );

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

    // Outer diffuse cloud — additive bloom, large
    const cloud = new Sprite(new SpriteMaterial({
      map: nebulaTex, color: p.color,
      transparent: true, blending: AdditiveBlending,
      depthWrite: false, opacity: 0.55,
    }));
    cloud.scale.set(p.scale * 2.4, p.scale * 2.4, 1);
    cloud.position.copy(pos);
    galaxy.add(cloud);

    // Inner brighter core — smaller, more saturated
    const core = new Sprite(new SpriteMaterial({
      map: glowTex, color: p.coreColor,
      transparent: true, blending: AdditiveBlending,
      depthWrite: false, opacity: 0.7,
    }));
    core.scale.set(p.scale * 0.6, p.scale * 0.6, 1);
    core.position.copy(pos);
    galaxy.add(core);

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

  // ── 12c. Satellite Galaxies (LMC + SMC) ────────────────────────
  //
  // Large and Small Magellanic Clouds — the Milky Way's two largest
  // dwarf-irregular companions. Real distances 50 / 62 kpc; here scaled
  // to ~25 / 32 kpc so they fit inside the galaxy-tier viewport while
  // preserving their actual sky-plane positions (galactic-anti-center,
  // far below the disc plane). Both are dwarf-irregular morphology
  // (no spiral structure), so represented as warm diffuse blobs with
  // a brighter core and a recognizable label.
  //
  // Galactic coords used: LMC l=280°, b=-33°; SMC l=302°, b=-44°.

  interface Satellite {
    name: string;
    label: string;
    galX: number; galY: number; galZ: number;  // kpc relative to Sgr A*
    sizeKpc: number;
    color: number;
    coreColor: number;
  }
  const SATELLITES: Satellite[] = [
    {
      name: 'lmc', label: 'LMC',
      // Sun at (8.3, 0, 0). LMC sky position l=280° b=-33° d_compressed=18 kpc.
      // Cartesian offset from Sun: (d·cosB·cos(l-180), d·sinB, d·cosB·sin(l-180))
      galX: 8.3 + 18 * Math.cos(-33 * Math.PI / 180) * Math.cos((280 - 180) * Math.PI / 180),
      galY:       18 * Math.sin(-33 * Math.PI / 180),
      galZ:       18 * Math.cos(-33 * Math.PI / 180) * Math.sin((280 - 180) * Math.PI / 180),
      sizeKpc: 4.3,
      color: 0xffd9a8,
      coreColor: 0xfff0d0,
    },
    {
      name: 'smc', label: 'SMC',
      // SMC l=302° b=-44° d_compressed=22 kpc.
      galX: 8.3 + 22 * Math.cos(-44 * Math.PI / 180) * Math.cos((302 - 180) * Math.PI / 180),
      galY:       22 * Math.sin(-44 * Math.PI / 180),
      galZ:       22 * Math.cos(-44 * Math.PI / 180) * Math.sin((302 - 180) * Math.PI / 180),
      sizeKpc: 3.0,
      color: 0xffe0aa,
      coreColor: 0xfff0d6,
    },
  ];

  SATELLITES.forEach(sat => {
    const pos = new Vector3(sat.galX * KPC, sat.galY * KPC, sat.galZ * KPC);
    const sizeWU = sat.sizeKpc * KPC;

    // Outer diffuse halo
    const cloud = new Sprite(new SpriteMaterial({
      map: nebulaTex, color: sat.color,
      transparent: true, blending: AdditiveBlending,
      depthWrite: false, opacity: 0.55,
    }));
    cloud.scale.set(sizeWU * 2.0, sizeWU * 1.4, 1);  // slight elongation
    cloud.position.copy(pos);
    galaxy.add(cloud);

    // Brighter inner core
    const core = new Sprite(new SpriteMaterial({
      map: glowTex, color: sat.coreColor,
      transparent: true, blending: AdditiveBlending,
      depthWrite: false, opacity: 0.75,
    }));
    core.scale.set(sizeWU * 0.7, sizeWU * 0.55, 1);
    core.position.copy(pos);
    galaxy.add(core);

    // Star sprinkle inside the dwarf galaxy — a few hundred small particles
    // distributed in an irregular blob.
    const SAT_STARS = 1200;
    const satPts: number[] = [];
    const satCols: number[] = [];
    const satSizes: number[] = [];
    for (let i = 0; i < SAT_STARS; i++) {
      let lx = 0, ly = 0, lz = 0;
      for (let attempt = 0; attempt < 6; attempt++) {
        lx = Math.random() * 2 - 1;
        ly = Math.random() * 2 - 1;
        lz = Math.random() * 2 - 1;
        if (lx * lx + ly * ly + lz * lz <= 1) break;
      }
      // Elongated ellipsoid (real LMC/SMC are flattened, partially-disrupted dwarfs)
      satPts.push(
        pos.x + lx * sat.sizeKpc * KPC * 0.7,
        pos.y + ly * sat.sizeKpc * KPC * 0.25,
        pos.z + lz * sat.sizeKpc * KPC * 0.55,
      );
      // Use the same stellar-population sampler for variation.
      const [cr, cg, cb, sz] = sampleStellarPopulation();
      satCols.push(cr, cg, cb);
      satSizes.push(sz * 0.8);  // dwarf-galaxy stars dimmer on average
    }
    const satGeo = new BufferGeometry();
    satGeo.setAttribute('position', new Float32BufferAttribute(satPts, 3));
    satGeo.setAttribute('color', new Float32BufferAttribute(satCols, 3));
    satGeo.setAttribute('aSize', new Float32BufferAttribute(satSizes, 1));
    const satMat = new ShaderMaterial({
      vertexShader: galacticStarsVertexShader,
      fragmentShader: galacticStarsFragmentShader,
      uniforms: makeStarUniforms(0.8),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const satField = new Points(satGeo, satMat);
    galaxy.add(satField);
    STREAK_MATS.push(satMat);

    // Invisible raycast hit target — clickable as a galactic landmark.
    const hit = new Mesh(
      new SphereGeometry(sizeWU * 0.9, 12, 12),
      new MeshBasicMaterial({ color: sat.color, transparent: true, opacity: 0.0001, depthWrite: false }),
    );
    hit.position.copy(pos);
    hit.userData = {
      type: 'phenomenon',
      name: sat.label === 'LMC' ? 'Large Magellanic Cloud' : 'Small Magellanic Cloud',
      subtype: 'Satellite Galaxy',
      description: `Dwarf irregular galaxy, ${sat.label === 'LMC' ? '~50' : '~62'} kpc from Sol`,
    };
    galaxy.add(hit);

    // Label
    const lbl = makeLabelSprite(sat.label, 'rgba(255,255,255,0.65)', 44);
    lbl.scale.set(500, 125, 1);
    lbl.position.set(pos.x, pos.y + sizeWU * 0.9, pos.z);
    galaxy.add(lbl);
  });

  // ── 12d. Sagittarius Dwarf Tidal Stream ────────────────────────
  //
  // The Sagittarius dwarf spheroidal (Sgr dSph) has been disrupted by
  // the Milky Way over the past several Gyr, leaving leading and
  // trailing tidal streams that wrap completely around the disc.
  // Gaia DR2/DR3 detections show the streams cover 360°+ of sky and
  // sit at distances 16–50 kpc from the Sun.
  //
  // Modeled here as a parametric path through (x,y,z) space with two
  // wraps and slight vertical oscillation, sprinkled with ~3000
  // old-population stellar particles (red giant branch dominant).

  const STREAM_N = 6000;
  const streamPts: number[] = [];
  const streamCols: number[] = [];
  const streamSizes: number[] = [];
  for (let i = 0; i < STREAM_N; i++) {
    const t = i / STREAM_N;
    // Two complete wraps around the galaxy (the real stream wraps
    // multiple times; two reads cleanly visually).
    const angle = t * Math.PI * 4 + Math.PI * 0.3;
    // Radius oscillates between perigalacticon (~16 kpc) and
    // apogalacticon (~50 kpc); compressed slightly to fit.
    const r = 22 + 12 * Math.sin(t * Math.PI * 2);
    // Stream is highly inclined ~80° from galactic plane — passes
    // above and below as it wraps.
    const yOsc = 8 * Math.sin(t * Math.PI * 3 + 0.7);
    // Scatter perpendicular to the path
    const scatter = 0.6 + Math.random() * 0.4;
    const xk = r * Math.cos(angle) + (Math.random() - 0.5) * scatter;
    const zk = r * Math.sin(angle) + (Math.random() - 0.5) * scatter;
    const yk = yOsc + (Math.random() - 0.5) * scatter * 0.5;
    streamPts.push(xk * KPC, yk * KPC, zk * KPC);
    // Stream stars are old population, slightly warmer than disc.
    const c = 0.7 + Math.random() * 0.2;
    streamCols.push(c, c * 0.92, c * 0.78);
    streamSizes.push(1.4 + Math.random() * 0.9);
  }
  const streamGeo = new BufferGeometry();
  streamGeo.setAttribute('position', new Float32BufferAttribute(streamPts, 3));
  streamGeo.setAttribute('color', new Float32BufferAttribute(streamCols, 3));
  streamGeo.setAttribute('aSize', new Float32BufferAttribute(streamSizes, 1));
  const streamMat = new ShaderMaterial({
    vertexShader: galacticStarsVertexShader,
    fragmentShader: galacticStarsFragmentShader,
    uniforms: makeStarUniforms(0.55),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const streamField = new Points(streamGeo, streamMat);
  STREAK_MATS.push(streamMat);
  streamField.name = 'sgr-stream';
  galaxy.add(streamField);

  // Sgr dSph core — clickable landmark at perigalacticon
  const sgrCorePos = new Vector3(
    22 * KPC * Math.cos(Math.PI * 0.3),
    8 * KPC * Math.sin(0.7),
    22 * KPC * Math.sin(Math.PI * 0.3),
  );
  const sgrCore = new Sprite(new SpriteMaterial({
    map: nebulaTex, color: 0xffd9b0,
    transparent: true, blending: AdditiveBlending,
    depthWrite: false, opacity: 0.55,
  }));
  sgrCore.scale.set(700, 500, 1);
  sgrCore.position.copy(sgrCorePos);
  galaxy.add(sgrCore);
  const sgrCoreHit = new Mesh(
    new SphereGeometry(500, 12, 12),
    new MeshBasicMaterial({ color: 0xffd9b0, transparent: true, opacity: 0.0001, depthWrite: false }),
  );
  sgrCoreHit.position.copy(sgrCorePos);
  sgrCoreHit.userData = {
    type: 'phenomenon',
    name: 'Sagittarius Dwarf Spheroidal',
    subtype: 'Disrupted Dwarf Galaxy',
    description: 'Tidal stream wraps the Milky Way disc; remnant core at ~24 kpc',
  };
  galaxy.add(sgrCoreHit);
  const sgrLbl = makeLabelSprite('SGR DSPH', 'rgba(255,255,255,0.55)', 36);
  sgrLbl.scale.set(420, 105, 1);
  sgrLbl.position.set(sgrCorePos.x, sgrCorePos.y + 200, sgrCorePos.z);
  galaxy.add(sgrLbl);

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
  const home = GAL_SYSTEMS.find(s => s.isHome);
  const lyToWu = KPC / 1000;
  const homeGalX = SOL_GAL_POS.x + (home ? home.localX * lyToWu : 0);
  const homeGalY = home ? home.localY * lyToWu : 0;
  const homeGalZ = SOL_GAL_POS.z + (home ? home.localZ * lyToWu : 0);
  return new Vector3(-homeGalX, -homeGalY, -homeGalZ);
}
