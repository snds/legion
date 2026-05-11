// ═══════════════════════════════════════════════════════════════════
// PARTICLES — Background Stars, Milky Way, Asteroid Belt
// Uses Points and instanced geometry for large particle counts.
// Designed for future WebGPU compute shader migration.
// ═══════════════════════════════════════════════════════════════════

import {
  Points, BufferGeometry, Float32BufferAttribute, PointsMaterial,
  Color, Mesh, SphereGeometry, MeshBasicMaterial, DoubleSide,
  MathUtils,
} from 'three';

// ── Background Starfield ─────────────────────────────────────────

export function createBackgroundStars(count: number): Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  const starColors = [
    new Color(0xffffff), // white
    new Color(0xaaccff), // blue-white
    new Color(0xffeecc), // yellow-white
    new Color(0xffbb88), // orange
    new Color(0xff8866), // red
    new Color(0x99bbff), // blue
  ];

  for (let i = 0; i < count; i++) {
    // Distribute on a sphere shell
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 80000 + Math.random() * 40000;

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    const c = starColors[Math.floor(Math.random() * starColors.length)];
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;

    sizes[i] = 0.5 + Math.random() * 2;
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.setAttribute('size', new Float32BufferAttribute(sizes, 1));

  const mat = new PointsMaterial({
    size: 100,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: true,
    depthWrite: false,
  });

  const points = new Points(geo, mat);
  points.name = 'background-stars';
  return points;
}

// ── Milky Way Band ───────────────────────────────────────────────

export function createMilkyWay(count: number): Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const r = 20000 + Math.random() * 80000;

    // Concentrate particles in a flat disk
    const spread = 3000 + Math.random() * 8000;
    const ySpread = (Math.random() - 0.5) * spread * 0.15;

    positions[i * 3] = r * Math.cos(theta) + (Math.random() - 0.5) * spread;
    positions[i * 3 + 1] = ySpread;
    positions[i * 3 + 2] = r * Math.sin(theta) + (Math.random() - 0.5) * spread;

    // Warm colors toward center, cooler at edges
    const t = r / 100000;
    const c = new Color().setHSL(0.12 + t * 0.4, 0.3 - t * 0.2, 0.4 + Math.random() * 0.3);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const mat = new PointsMaterial({
    size: 150,
    vertexColors: true,
    transparent: true,
    opacity: 0.25,
    sizeAttenuation: true,
    depthWrite: false,
  });

  const points = new Points(geo, mat);
  points.name = 'milky-way';
  return points;
}

// ── Debris Disk (Asteroid Belt) ──────────────────────────────────

export function createDebrisDisk(
  innerAU: number, outerAU: number, count: number,
): Points {
  const AU_SCALE = 10;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const r = MathUtils.lerp(innerAU * AU_SCALE, outerAU * AU_SCALE, Math.random());
    const theta = Math.random() * Math.PI * 2;
    const yOffset = (Math.random() - 0.5) * 2;

    positions[i * 3] = r * Math.cos(theta);
    positions[i * 3 + 1] = yOffset;
    positions[i * 3 + 2] = r * Math.sin(theta);

    const gray = 0.3 + Math.random() * 0.3;
    colors[i * 3] = gray;
    colors[i * 3 + 1] = gray * 0.9;
    colors[i * 3 + 2] = gray * 0.8;
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const mat = new PointsMaterial({
    size: 0.3,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    sizeAttenuation: true,
  });

  const points = new Points(geo, mat);
  points.name = 'debris-disk';
  return points;
}

// ── Heliopause Boundary ──────────────────────────────────────────

export function createHeliopause(radiusAU: number): Mesh {
  const AU_SCALE = 10;
  const geo = new SphereGeometry(radiusAU * AU_SCALE, 48, 48);
  const mat = new MeshBasicMaterial({
    color: 0x2244aa,
    transparent: true,
    opacity: 0.03,
    side: DoubleSide,
    depthWrite: false,
  });

  const mesh = new Mesh(geo, mat);
  mesh.name = 'heliopause';
  return mesh;
}
