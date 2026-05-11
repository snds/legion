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
  SphereGeometry, RingGeometry, CircleGeometry, BufferGeometry,
  MeshBasicMaterial, PointsMaterial, SpriteMaterial, ShaderMaterial,
  LineBasicMaterial,
  Float32BufferAttribute, Vector3, DoubleSide, AdditiveBlending, NormalBlending,
  CanvasTexture, Color,
} from 'three';
import { getStellarRender } from './planet-colors';
import { galacticDiscVertexShader, galacticDiscFragmentShader } from './shaders/galactic-disc';

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
  starFieldMat: PointsMaterial | null;
  localArmMat: PointsMaterial | null;
  dustMat: PointsMaterial | null;
  discMat: ShaderMaterial | null;       // continuous diffuse-disc shader
  nebulaMats: SpriteMaterial[];
}

const GALAXY_LOD: GalaxyLODState = {
  starFieldMat: null,
  localArmMat: null,
  dustMat: null,
  discMat: null,
  nebulaMats: [],
};

// 0..1 ramp helper
function smoothRamp(x: number, lo: number, hi: number): number {
  if (x <= lo) return 0;
  if (x >= hi) return 1;
  const t = (x - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
}

/** Call each frame with the current camera distance to tune galaxy LOD. */
export function updateGalaxyLOD(camDist: number): void {
  // Top-level "is the galaxy present at this camera distance" curve.
  // 0 at sector inner edge (~2500 WU) → 1 by the time we're in arm
  // range (~5500 WU). Everything galactic-scale (disc shader, particles,
  // dust, nebulae, phenomena) multiplies through this so the transition
  // from sector → arm is a smooth fade-in instead of a layer flip.
  const discPresence = smoothRamp(camDist, 2500, 5500);

  // Disc shader presence — directly drives uOpacity.
  if (GALAXY_LOD.discMat) {
    GALAXY_LOD.discMat.uniforms.uOpacity.value = discPresence;
  }

  // Main star field: size grows when close (so the disc has grain), and
  // opacity multiplies through discPresence so particles fade in WITH
  // the disc rather than appearing on top of nothing at sector tier.
  if (GALAXY_LOD.starFieldMat) {
    const sizeT = smoothRamp(camDist, 4500, 13000);
    GALAXY_LOD.starFieldMat.size = 4.0 - sizeT * 2.0;
    GALAXY_LOD.starFieldMat.opacity = 0.55 * discPresence;
  }

  // Local Orion Spur detail: fades in as you approach disc-immersion.
  // Off above 11000 (galaxy tier is too far to benefit), peak at 4500.
  if (GALAXY_LOD.localArmMat) {
    const closeFade = 1 - smoothRamp(camDist, 5000, 11000);
    GALAXY_LOD.localArmMat.opacity = closeFade * 0.85 * discPresence;
  }

  // Dust lanes (particle, separate from shader): peak in arm/sector range.
  if (GALAXY_LOD.dustMat) {
    const closeFade = 1 - smoothRamp(camDist, 6000, 11000);
    GALAXY_LOD.dustMat.opacity = closeFade * 0.55 * discPresence;
  }

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
  TRANSIT_CHEVRONS.length = 0;
  GALAXY_LOD.starFieldMat = null;
  GALAXY_LOD.localArmMat = null;
  GALAXY_LOD.dustMat = null;
  GALAXY_LOD.discMat = null;
  GALAXY_LOD.nebulaMats.length = 0;

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
  const ARM_COUNT = 25000;
  const GAL_RADIUS = 15;       // kpc
  // Log-spiral pitch matched to the disc shader's uArmTwist so the
  // particle arms and the procedural arms land in alignment. Pitch
  // tan⁻¹(1/ARM_TWIST) ≈ 13.4° — Milky Way is observed at ~12–14°.
  const ARM_TWIST = 4.2;
  // Bar orientation in galactic plane. Real Milky Way bar is ~25–30°
  // from the Sun→GC line. Particle arms emerge from the bar tips.
  const BAR_ANGLE = Math.PI * 25 / 180;
  const ARM_PHASE_OFFSET = BAR_ANGLE;

  const armPts: number[] = [];
  const armCols: number[] = [];

  for (let i = 0; i < ARM_COUNT; i++) {
    const arm = Math.floor(Math.random() * ARMS);
    const armAngle = (Math.PI * 2 / ARMS) * arm;
    // Arms start at the bar tip radius (~2.7 kpc). Exponential-disc-like
    // radial distribution: pow(u, 1.7) biases particles toward smaller r
    // (matches the Milky Way's ~3 kpc disc scale length and removes the
    // bright outer ring artifact of uniform-r sampling, since 2πr·dr
    // area weighting otherwise over-concentrates the rim).
    const u = Math.random();
    const r = 2.7 + Math.pow(u, 1.7) * (GAL_RADIUS - 2.7);
    const spiralTwist = Math.log(r / 2.7) * ARM_TWIST;
    // Arm spread widens significantly with radius — outer arms feather
    // into the inter-arm population rather than reading as crisp bands.
    const spread = ARM_SPREAD * (1 + r * 0.18);
    const theta = armAngle + spiralTwist + ARM_PHASE_OFFSET + (Math.random() - 0.5) * spread;
    // Thin disc scale height grows with r ("disc flaring" — observed in
    // Gaia data). Inner thin disc ~0.1 kpc, outer puffs to ~0.3 kpc.
    const diskHeight = 0.06 + r * 0.018;
    const height = (Math.random() - 0.5) * diskHeight * 2;

    const x = r * Math.cos(theta) * KPC;
    const y = height * KPC;
    const z = r * Math.sin(theta) * KPC;
    armPts.push(x, y, z);

    // Mostly white/cream with rare warm and rare blue. These are
    // "individual stars" not "warm dust" — the dust is the shader's job.
    const stellarRoll = Math.random();
    let cr: number, cg: number, cb: number;
    if (stellarRoll < 0.7) {
      // White / cream — most stars
      cr = 0.85 + Math.random() * 0.15;
      cg = 0.82 + Math.random() * 0.13;
      cb = 0.78 + Math.random() * 0.12;
    } else if (stellarRoll < 0.9) {
      // Warm K/M
      cr = 0.95 + Math.random() * 0.05;
      cg = 0.65 + Math.random() * 0.15;
      cb = 0.40 + Math.random() * 0.20;
    } else {
      // Hot blue O/B
      cr = 0.70 + Math.random() * 0.10;
      cg = 0.80 + Math.random() * 0.10;
      cb = 1.00;
    }
    armCols.push(cr, cg, cb);
  }

  // ── 2. Galactic Bulge + Bar Star Sprinkle (8K) ────────────────
  // The shader provides the bulge GLOW and bar feature; these particles
  // add resolved-star texture. 60% land in the bar region (elongated
  // ellipsoid at BAR_ANGLE matching the shader's bar geometry), 40% in
  // the spheroidal bulge.

  const BULGE_COUNT = 8000;
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
    // Bulge/bar stars: old population, warm yellow-orange
    const b = 0.55 + Math.random() * 0.35;
    armCols.push(b + 0.18, b + 0.08, b - 0.06);
  }

  // ── 3. Halo Star Sprinkle (3K) ────────────────────────────────
  // Sparse old population above/below the disc plane.
  const HALO_COUNT = 3000;
  for (let i = 0; i < HALO_COUNT; i++) {
    const r = 1 + Math.random() * 18;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const x = r * Math.sin(phi) * Math.cos(theta) * KPC;
    const y = r * Math.cos(phi) * KPC * 0.7;
    const z = r * Math.sin(phi) * Math.sin(theta) * KPC;
    armPts.push(x, y, z);
    const b = 0.20 + Math.random() * 0.10;
    armCols.push(b * 1.05, b, b * 0.92);
  }

  const galGeo = new BufferGeometry();
  galGeo.setAttribute('position', new Float32BufferAttribute(armPts, 3));
  galGeo.setAttribute('color', new Float32BufferAttribute(armCols, 3));
  const starFieldMat = new PointsMaterial({
    size: 1.8, vertexColors: true, sizeAttenuation: false,
    // Lower base opacity so particles read as bright resolved stars
    // ON TOP of the diffuse shader, not AS the disc itself.
    transparent: true, opacity: 0.55, depthWrite: false,
    blending: AdditiveBlending,
  });
  const starField = new Points(galGeo, starFieldMat);
  galaxy.add(starField);
  GALAXY_LOD.starFieldMat = starFieldMat;

  // ── 3c. Orion Spur Local Detail (40K) ─────────────────────────
  // Higher-density particle cloud concentrated around home, oriented
  // along the local arm tangent. Fades in across the ARM tier so that
  // when the camera is immersed in the disc, the immediate surrounding
  // volume has real density and variation rather than the broad-disc
  // sample. Colors lean blue-white (young arm stars) with a warm minority.

  const LOCAL_N = 40000;
  const localPts: number[] = [];
  const localCols: number[] = [];

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

    // Stellar mix: 50% blue-white young, 30% sun-like, 20% warm older
    const r = Math.random();
    if (r < 0.5) {
      // Blue-white young stars (O/B/A class)
      localCols.push(0.78 + Math.random() * 0.22, 0.85 + Math.random() * 0.15, 1.0);
    } else if (r < 0.8) {
      // Sun-like
      localCols.push(1.0, 0.97 + Math.random() * 0.03, 0.85 + Math.random() * 0.12);
    } else {
      // Warm older (K/M)
      localCols.push(1.0, 0.78 + Math.random() * 0.12, 0.55 + Math.random() * 0.15);
    }
  }

  const localGeo = new BufferGeometry();
  localGeo.setAttribute('position', new Float32BufferAttribute(localPts, 3));
  localGeo.setAttribute('color', new Float32BufferAttribute(localCols, 3));
  const localArmMat = new PointsMaterial({
    size: 3.0, vertexColors: true, sizeAttenuation: false,
    transparent: true, opacity: 0.0, depthWrite: false,
    blending: AdditiveBlending,
  });
  const localArmField = new Points(localGeo, localArmMat);
  localArmField.name = 'orion-spur-detail';
  galaxy.add(localArmField);
  GALAXY_LOD.localArmMat = localArmMat;

  // ── 3d. Dust Lane Strands (8K) ────────────────────────────────
  // Sparse, slightly cooler particles tracing the inner edges of the
  // spiral arms — reads as fine filaments of dust against the brighter
  // arm background. Adds the granular "depth" of a real disc when you
  // fly inside it.

  const DUST_N = 8000;
  const dustPts: number[] = [];
  for (let i = 0; i < DUST_N; i++) {
    const arm = Math.floor(Math.random() * ARMS);
    const armAngle = (Math.PI * 2 / ARMS) * arm;
    const r = 2.7 + Math.random() * (GAL_RADIUS - 2.7);
    // Match the arm log-spiral pitch — dust lanes ride the inner edge
    // of each arm (radialOffset shifts them slightly off the arm centerline).
    const spiralTwist = Math.log(r / 2.7) * ARM_TWIST;
    const radialOffset = 0.08 + Math.random() * 0.10;
    const theta = armAngle + spiralTwist + ARM_PHASE_OFFSET - radialOffset;
    const x = r * Math.cos(theta) * KPC;
    const z = r * Math.sin(theta) * KPC;
    const y = (Math.random() - 0.5) * 0.04 * KPC;
    dustPts.push(x, y, z);
  }
  const dustGeo = new BufferGeometry();
  dustGeo.setAttribute('position', new Float32BufferAttribute(dustPts, 3));
  const dustMat = new PointsMaterial({
    color: 0x3a1a14, size: 2.5, sizeAttenuation: false,
    transparent: true, opacity: 0.0, depthWrite: false,
  });
  const dustField = new Points(dustGeo, dustMat);
  dustField.name = 'dust-lanes';
  galaxy.add(dustField);
  GALAXY_LOD.dustMat = dustMat;

  // ── 3b. Procedural Galactic Disc (continuous diffuse) ─────────
  // Replaces the previous radial-gradient backdrop. Custom shader
  // (galactic-disc.ts) renders the disc as a warm sepia volume with
  // logarithmic-spiral structure, FBM cloud variation, and DARK dust
  // lanes that occlude the brightness (NormalBlending so dust can
  // actually subtract, not just add light).
  //
  // ESA Gaia visualization reference: pale gold inner disc, brown
  // dust filaments tracing the inner edge of each arm, soft yellow
  // Gaussian bulge dominating the center.
  const discMat = new ShaderMaterial({
    vertexShader: galacticDiscVertexShader,
    fragmentShader: galacticDiscFragmentShader,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: NormalBlending,
    uniforms: {
      uBulgeColor:     { value: new Color(0xffe2a8) },
      uArmColor:       { value: new Color(0xd9b894) },
      uDustColor:      { value: new Color(0x180b08) },
      uBulgeRadius:    { value: 0.22 },
      uArmTwist:       { value: 5.0 },
      uArmCount:       { value: 4.0 },
      // Rotate arm pattern so the principal arms emerge from the bar tips.
      uArmPhaseOffset: { value: Math.PI * 0.25 },
      // Galactic bar — real Milky Way has a ~5 kpc bar at ~25° from the
      // Sun–GC line. With disc radius 15 kpc, bar half-length 0.18 ≈ 2.7 kpc.
      uBarAngle:       { value: Math.PI * 25 / 180 },
      uBarLength:      { value: 0.20 },
      uBarWidth:       { value: 0.06 },
      uDustStrength:   { value: 0.92 },
      uOpacity:        { value: 1.0 },
      uTime:           { value: 0 },
    },
  });
  const disc = new Mesh(
    new CircleGeometry(15 * KPC, 256),
    discMat,
  );
  disc.rotation.x = -Math.PI / 2;
  // Render disc AFTER the additive particle field so the shader's
  // continuous diffuse layer is the dominant visual, with bright
  // particles still glowing through where they overlap.
  disc.renderOrder = 2;
  galaxy.add(disc);
  GALAXY_LOD.discMat = discMat;

  // ── 4. Core Glow ─────────────────────────────────────────────

  const coreGlow = new Sprite(new SpriteMaterial({
    map: glowTex, color: 0xfff8e0,
    transparent: true, blending: AdditiveBlending,
    depthWrite: false, opacity: 0.75,
  }));
  coreGlow.scale.set(2800, 2800, 1);
  galaxy.add(coreGlow);

  const coreHalo = new Sprite(new SpriteMaterial({
    map: glowTex, color: 0xffeedd,
    transparent: true, blending: AdditiveBlending,
    depthWrite: false, opacity: 0.3,
  }));
  coreHalo.scale.set(5000, 5000, 1);
  galaxy.add(coreHalo);

  const coreWash = new Sprite(new SpriteMaterial({
    map: glowTex, color: 0xffe8cc,
    transparent: true, blending: AdditiveBlending,
    depthWrite: false, opacity: 0.12,
  }));
  coreWash.scale.set(8000, 4000, 1);
  galaxy.add(coreWash);

  // ── 5. Nebula Clusters (along spiral arms) ────────────────────
  const NEBULA_COUNT = 50;
  for (let i = 0; i < NEBULA_COUNT; i++) {
    const arm = Math.floor(Math.random() * ARMS);
    const armAngle = (Math.PI * 2 / ARMS) * arm;
    const r = 2.7 + Math.random() * (GAL_RADIUS - 2.7);
    // Nebulae are star-forming regions concentrated in the arms.
    const spiralTwist = Math.log(r / 2.7) * ARM_TWIST;
    const theta = armAngle + spiralTwist + ARM_PHASE_OFFSET + (Math.random() - 0.5) * 0.5;
    const x = r * Math.cos(theta) * KPC;
    const z = r * Math.sin(theta) * KPC;
    const y = (Math.random() - 0.5) * 0.3 * KPC;

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
