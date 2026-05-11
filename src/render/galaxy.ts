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
// Reference: Galaxy explorer video — volumetric spiral arms, magenta
// nebula clusters, bright core glow, thin disk with visible height.
// ═══════════════════════════════════════════════════════════════════

import {
  Group, Mesh, Points, Line, Sprite,
  SphereGeometry, RingGeometry, BufferGeometry,
  MeshBasicMaterial, PointsMaterial, SpriteMaterial, LineBasicMaterial,
  Float32BufferAttribute, Vector3, DoubleSide, AdditiveBlending,
  CanvasTexture,
} from 'three';

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
  const tex = new CanvasTexture(cv);
  return tex;
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

// ── Galaxy Builder ───────────────────────────────────────────────

/**
 * Build the complete galaxy group in galactic coordinates (Sgr A* at origin).
 * Caller must offset by getGalaxyOffset() to place home system at scene origin.
 */
export function createGalaxy(): Group {
  const galaxy = new Group();
  galaxy.name = 'galaxy';

  const glowTex = makeGlowTexture();
  const nebulaTex = makeNebulaTexture();

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
    // Disk height: thin near center, slightly thicker at edges
    const diskHeight = 0.12 + r * 0.01;
    const height = (Math.random() - 0.5) * diskHeight * 2;

    const x = r * Math.cos(theta) * KPC;
    const y = height * KPC;
    const z = r * Math.sin(theta) * KPC;
    armPts.push(x, y, z);

    // Color: brighter and warmer toward center, cooler at edges
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
    const r = Math.pow(Math.random(), 0.65) * 2.5; // kpc, concentrated center
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const x = r * Math.sin(phi) * Math.cos(theta) * KPC;
    const y = r * Math.cos(phi) * KPC * 0.4; // oblate
    const z = r * Math.sin(phi) * Math.sin(theta) * KPC;
    armPts.push(x, y, z);
    const b = 0.45 + Math.random() * 0.45;
    armCols.push(b + 0.25, b + 0.1, b);
  }

  // ── 2b. Bright Inner Disk (10K) ──────────────────────────────
  // Dense warm ring 2–6 kpc — the bright band visible edge-on in the reference

  const INNER_DISK = 10000;
  for (let i = 0; i < INNER_DISK; i++) {
    const r = 2 + Math.random() * 4; // kpc
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
    const r = 1 + Math.random() * 18; // kpc, extends beyond disk
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const x = r * Math.sin(phi) * Math.cos(theta) * KPC;
    const y = r * Math.cos(phi) * KPC * 0.7; // more spherical than disk
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

  // ── 4. Core Glow ─────────────────────────────────────────────

  // Primary bright core
  const coreGlow = new Sprite(new SpriteMaterial({
    map: glowTex, color: 0xfff8e0,
    transparent: true, blending: AdditiveBlending,
    depthWrite: false, opacity: 0.75,
  }));
  coreGlow.scale.set(2800, 2800, 1);
  galaxy.add(coreGlow);

  // Secondary larger dim glow for falloff
  const coreHalo = new Sprite(new SpriteMaterial({
    map: glowTex, color: 0xffeedd,
    transparent: true, blending: AdditiveBlending,
    depthWrite: false, opacity: 0.3,
  }));
  coreHalo.scale.set(5000, 5000, 1);
  galaxy.add(coreHalo);

  // Tertiary wide warm wash (fills the inner disk area)
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

    // Vary color between magenta and blue-purple (matching reference)
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
    sectorGrid.add(new Line(
      new BufferGeometry().setFromPoints(ringPts),
      new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.04 }),
    ));
  }
  for (let q = 0; q < 4; q++) {
    const a = (Math.PI / 2) * q;
    sectorGrid.add(new Line(
      new BufferGeometry().setFromPoints([
        new Vector3(0, 0, 0),
        new Vector3(Math.cos(a) * 22 * KPC, 0, Math.sin(a) * 22 * KPC),
      ]),
      new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06 }),
    ));
  }
  galaxy.add(sectorGrid);

  // ── 8. Quadrant Labels ──────────────────────────────────────────

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

  // Arm labels
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

  // ── 9. Known Systems as Galactic Markers ──────────────────────

  const lyToWu = KPC / 1000; // light-years to world units at galactic scale
  const influenceSpheres: Mesh[] = [];

  GAL_SYSTEMS.forEach(sys => {
    const pos = new Vector3(
      SOL_GAL_POS.x + sys.localX * lyToWu,
      sys.localY * lyToWu,
      SOL_GAL_POS.z + sys.localZ * lyToWu,
    );
    const size = sys.hasBobs ? 25 : 12;
    const marker = new Mesh(
      new SphereGeometry(size, 12, 12),
      new MeshBasicMaterial({
        color: sys.color, transparent: true,
        opacity: sys.hasBobs ? 0.9 : 0.25,
      }),
    );
    marker.position.copy(pos);
    marker.userData = { type: 'gal_system', ...sys, _pos: pos };
    galaxy.add(marker);

    // Glow + influence for active systems
    if (sys.hasBobs) {
      const glow = new Sprite(new SpriteMaterial({
        map: glowTex, color: sys.color,
        transparent: true, blending: AdditiveBlending,
        depthWrite: false, opacity: 0.25,
      }));
      glow.scale.set(200, 200, 1);
      marker.add(glow);

      const infR = 60 + sys.bobCount * 30;
      const infSphere = new Mesh(
        new SphereGeometry(infR, 24, 24),
        new MeshBasicMaterial({
          color: sys.color, transparent: true, opacity: 0.04,
          side: DoubleSide, depthWrite: false,
        }),
      );
      infSphere.position.copy(pos);
      galaxy.add(infSphere);
      influenceSpheres.push(infSphere);

      // Influence ring
      const ringPts: Vector3[] = [];
      for (let j = 0; j <= 64; j++) {
        const a = (j / 64) * Math.PI * 2;
        ringPts.push(new Vector3(Math.cos(a) * infR, 0, Math.sin(a) * infR));
      }
      const infRing = new Line(
        new BufferGeometry().setFromPoints(ringPts),
        new LineBasicMaterial({ color: sys.color, transparent: true, opacity: 0.12 }),
      );
      infRing.position.copy(pos);
      galaxy.add(infRing);
    }

    // Label
    const lbl = makeLabelSprite(
      sys.name,
      sys.hasBobs ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)',
      sys.hasBobs ? 40 : 32,
    );
    lbl.scale.set(400, 100, 1);
    lbl.position.set(0, size + 25, 0);
    marker.add(lbl);
  });

  // ── 10. Bob Space Overlay ─────────────────────────────────────

  const bobSystems = GAL_SYSTEMS.filter(s => s.hasBobs);
  if (bobSystems.length > 1) {
    const positions = bobSystems.map(s => new Vector3(
      SOL_GAL_POS.x + s.localX * lyToWu,
      s.localY * lyToWu,
      SOL_GAL_POS.z + s.localZ * lyToWu,
    ));
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        galaxy.add(new Line(
          new BufferGeometry().setFromPoints([positions[i], positions[j]]),
          new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.03 }),
        ));
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

    // Influence sphere
    const sphere = new Mesh(
      new SphereGeometry(infR, 24, 24),
      new MeshBasicMaterial({
        color: ac.color, transparent: true, opacity: 0.06,
        side: DoubleSide, depthWrite: false,
      }),
    );
    sphere.position.copy(pos);
    galaxy.add(sphere);

    // Boundary ring
    const ringPts: Vector3[] = [];
    for (let j = 0; j <= 64; j++) {
      const a = (j / 64) * Math.PI * 2;
      ringPts.push(new Vector3(
        pos.x + Math.cos(a) * infR, 0,
        pos.z + Math.sin(a) * infR,
      ));
    }
    galaxy.add(new Line(
      new BufferGeometry().setFromPoints(ringPts),
      new LineBasicMaterial({ color: ac.color, transparent: true, opacity: 0.15 }),
    ));

    // Label
    const lbl = makeLabelSprite(ac.name, `rgba(255,255,255,0.3)`, 36);
    lbl.scale.set(350, 88, 1);
    lbl.position.set(pos.x, 15, pos.z);
    galaxy.add(lbl);
  });

  // ── 12. Transit Lines ─────────────────────────────────────────

  TRANSIT_BOBS.forEach(tb => {
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

    // Full path (faint)
    galaxy.add(new Line(
      new BufferGeometry().setFromPoints([fromPos, toPos]),
      new LineBasicMaterial({ color: tb.color, transparent: true, opacity: 0.08 }),
    ));

    // Progress marker
    const progressPt = fromPos.clone().lerp(toPos, tb.progress);
    const bobDot = new Mesh(
      new SphereGeometry(10, 8, 8),
      new MeshBasicMaterial({ color: tb.color }),
    );
    bobDot.position.copy(progressPt);
    galaxy.add(bobDot);

    const dotGlow = new Sprite(new SpriteMaterial({
      map: glowTex, color: tb.color,
      transparent: true, blending: AdditiveBlending,
      opacity: 0.15,
    }));
    dotGlow.scale.set(100, 100, 1);
    bobDot.add(dotGlow);
  });

  // ── 13. Sol "You Are Here" Marker ─────────────────────────────

  const solRing = new Mesh(
    new RingGeometry(45, 52, 32),
    new MeshBasicMaterial({
      color: 0xffffff, side: DoubleSide,
      transparent: true, opacity: 0.15,
    }),
  );
  solRing.position.copy(SOL_GAL_POS);
  solRing.rotation.x = -Math.PI / 2;
  galaxy.add(solRing);

  return galaxy;
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
