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
  Float32BufferAttribute, Vector3, DoubleSide, AdditiveBlending,
  CanvasTexture, Color,
} from 'three';
import { getStellarRender } from './planet-colors';

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

  const galaxy = new Group();
  galaxy.name = 'galaxy';

  const glowTex = makeGlowTexture();
  const nebulaTex = makeNebulaTexture();
  const coreTex = makeStarCoreTexture();
  const haloTex = makeStarHaloTexture();
  const chevronTex = makeChevronTexture();

  // ── 1. Spiral Arm Particles (120K) ────────────────────────────

  const ARMS = 4;
  const ARM_SPREAD = 0.5;
  const ARM_COUNT = 120000;
  const GAL_RADIUS = 15; // kpc

  const armPts: number[] = [];
  const armCols: number[] = [];

  for (let i = 0; i < ARM_COUNT; i++) {
    const arm = Math.floor(Math.random() * ARMS);
    const armAngle = (Math.PI * 2 / ARMS) * arm;
    const r = 0.3 + Math.random() * GAL_RADIUS;
    const spiralTwist = r * 0.55;
    const spread = ARM_SPREAD * (1 + r * 0.04);
    const theta = armAngle + spiralTwist + (Math.random() - 0.5) * spread;
    const diskHeight = 0.12 + r * 0.01;
    const height = (Math.random() - 0.5) * diskHeight * 2;

    const x = r * Math.cos(theta) * KPC;
    const y = height * KPC;
    const z = r * Math.sin(theta) * KPC;
    armPts.push(x, y, z);

    const dist = Math.sqrt(x * x + z * z);
    const maxR = GAL_RADIUS * KPC;
    const radialFade = dist / maxR;
    const brightness = Math.max(0.08, 0.65 - radialFade * 0.55);
    const warmth = Math.max(0, 0.4 - radialFade * 0.5);
    armCols.push(
      brightness + warmth * 0.35,
      brightness + warmth * 0.12,
      brightness - warmth * 0.05,
    );
  }

  // ── 2. Galactic Bulge (20K) ───────────────────────────────────

  const BULGE_COUNT = 20000;
  for (let i = 0; i < BULGE_COUNT; i++) {
    const r = Math.pow(Math.random(), 0.65) * 2.5;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const x = r * Math.sin(phi) * Math.cos(theta) * KPC;
    const y = r * Math.cos(phi) * KPC * 0.4;
    const z = r * Math.sin(phi) * Math.sin(theta) * KPC;
    armPts.push(x, y, z);
    const b = 0.45 + Math.random() * 0.45;
    armCols.push(b + 0.25, b + 0.1, b);
  }

  // ── 2b. Bright Inner Disk (10K) ──────────────────────────────
  const INNER_DISK = 10000;
  for (let i = 0; i < INNER_DISK; i++) {
    const r = 2 + Math.random() * 4;
    const theta = Math.random() * Math.PI * 2;
    const height = (Math.random() - 0.5) * 0.08;
    const x = r * Math.cos(theta) * KPC;
    const y = height * KPC;
    const z = r * Math.sin(theta) * KPC;
    armPts.push(x, y, z);
    const b = 0.5 + Math.random() * 0.4;
    armCols.push(b + 0.2, b + 0.05, b - 0.08);
  }

  // ── 3. Halo Particles (8K) ────────────────────────────────────
  const HALO_COUNT = 8000;
  for (let i = 0; i < HALO_COUNT; i++) {
    const r = 1 + Math.random() * 18;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const x = r * Math.sin(phi) * Math.cos(theta) * KPC;
    const y = r * Math.cos(phi) * KPC * 0.7;
    const z = r * Math.sin(phi) * Math.sin(theta) * KPC;
    armPts.push(x, y, z);
    const b = 0.06 + Math.random() * 0.08;
    armCols.push(b, b * 1.1, b * 1.2);
  }

  const galGeo = new BufferGeometry();
  galGeo.setAttribute('position', new Float32BufferAttribute(armPts, 3));
  galGeo.setAttribute('color', new Float32BufferAttribute(armCols, 3));
  const starField = new Points(galGeo, new PointsMaterial({
    size: 2.0, vertexColors: true, sizeAttenuation: false,
    transparent: true, opacity: 0.9, depthWrite: false,
  }));
  galaxy.add(starField);

  // ── 3b. Galactic Plane Backdrop ───────────────────────────────
  // Wide, very faint warm disc sitting on the galactic plane.
  // Carries orientation when the camera is too close to register
  // the spiral structure but too far to see individual systems.
  // Hairline radial gradient — bright at center, fades to zero by 14 kpc.
  const planeTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 512;
    const ctx = cv.getContext('2d')!;
    const grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    grad.addColorStop(0.0, 'rgba(255,230,200,0.55)');
    grad.addColorStop(0.15, 'rgba(255,220,180,0.30)');
    grad.addColorStop(0.40, 'rgba(220,170,150,0.10)');
    grad.addColorStop(0.75, 'rgba(120,80,140,0.03)');
    grad.addColorStop(1.0, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);
    return new CanvasTexture(cv);
  })();
  // CircleGeometry (not RingGeometry) — UVs map radially across the disc,
  // so the texture's center→edge gradient lines up with the geometry.
  const planeBackdrop = new Mesh(
    new CircleGeometry(14 * KPC, 96),
    new MeshBasicMaterial({
      map: planeTex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      opacity: 0.85,
    }),
  );
  planeBackdrop.rotation.x = -Math.PI / 2;
  // Slight negative y so it sits cleanly under the disc particles
  planeBackdrop.position.y = -10;
  galaxy.add(planeBackdrop);

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
    const r = 2 + Math.random() * 13;
    const spiralTwist = r * 0.55;
    const theta = armAngle + spiralTwist + (Math.random() - 0.5) * 0.6;
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

    const nebula = new Sprite(new SpriteMaterial({
      map: nebulaTex, color: nebColor,
      transparent: true, blending: AdditiveBlending,
      depthWrite: false, opacity: 0.18 + Math.random() * 0.18,
    }));
    const size = 400 + Math.random() * 900;
    nebula.scale.set(size, size, 1);
    nebula.position.set(x, y, z);
    galaxy.add(nebula);
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
      uOpacity:  { value: 0.55 },
      uRimPower: { value: 2.2 },
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
      uOpacity:  { value: 0.35 },
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
