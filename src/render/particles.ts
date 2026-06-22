// ═══════════════════════════════════════════════════════════════════
// PARTICLES — Background Stars, Milky Way, Asteroid Belt
// Uses Points and instanced geometry for large particle counts.
// Designed for future WebGPU compute shader migration.
// ═══════════════════════════════════════════════════════════════════

import {
  Points, BufferGeometry, Float32BufferAttribute, PointsMaterial,
  Color, Mesh, SphereGeometry, MeshBasicMaterial, BackSide,
  MathUtils,
} from 'three';

import { AU_TO_WU } from '../core/metrics';

// Heliopause shell radius in world units (120 AU × AU_SCALE 10). Exported so
// the per-frame visibility gate (visibility.ts) and the geometry can never
// drift apart — the orb is shown ONLY when the camera is outside this radius.
export const HELIOPAUSE_RADIUS_WU = 1200;

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

// (Legacy Milky Way band deleted — replaced by the baked cubemap of the
// real galaxy model; see src/render/galaxy-backdrop.ts.)

// ── Debris Disk (Asteroid Belt) ──────────────────────────────────

export function createDebrisDisk(
  innerAU: number, outerAU: number, count: number,
): Points {
  const AU_SCALE = AU_TO_WU;
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

export function createHeliopause(): Mesh {
  const geo = new SphereGeometry(HELIOPAUSE_RADIUS_WU, 48, 48);
  const mat = new MeshBasicMaterial({
    color: 0x2244aa,
    transparent: true,
    opacity: 0.05,
    // BackSide: from OUTSIDE the shell this renders the far wall, reading as a
    // faint translucent bubble (the Oort-sphere boundary pattern). The mesh is
    // gated to camDist >= radius in visibility.ts, so the camera is never
    // inside it — which is what previously (with DoubleSide) tinted the whole
    // interior view a uniform blue. It is now an external-facing element only.
    side: BackSide,
    depthWrite: false,
  });

  const mesh = new Mesh(geo, mat);
  mesh.name = 'heliopause';
  return mesh;
}
