// ═══════════════════════════════════════════════════════════════════
// SCENE OBJECTS — Stations, Comets, Oort Cloud, Ecliptic Grid
// Additional 3D content factories matching the monolithic prototype.
// Called from populateWorld() to fill out the scene.
// ═══════════════════════════════════════════════════════════════════

import {
  Group, Mesh, Points, Line,
  CylinderGeometry, TorusGeometry, BoxGeometry, SphereGeometry,
  BufferGeometry,
  MeshStandardMaterial, MeshBasicMaterial, PointsMaterial,
  LineBasicMaterial,
  Float32BufferAttribute, BackSide,
  EllipseCurve,
} from 'three';
import { createIcon } from './icons';

const AU = 10; // world units per AU (same as objects.ts)

// ── Station Data ─────────────────────────────────────────────────

export interface StationConfig {
  name: string;
  stationType: string;
  parentIdx: number;
  capacity: number;
  status: string;
  modules: string[];
  orbitOffset: number;
}

export const STATION_DATA: StationConfig[] = [
  { name: 'Kindling Station',        stationType: 'Mining Hub',     parentIdx: 0, capacity: 72, status: 'Operational', modules: ['Ore Processing', 'Smelter', 'Cargo', 'Drone Bay'], orbitOffset: 0.18 },
  { name: 'Aegir Forge',             stationType: 'Shipyard',       parentIdx: 3, capacity: 45, status: 'Operational', modules: ['Assembly', 'Hull Fab', 'Drive Workshop'], orbitOffset: 0.22 },
  { name: 'Hearthstone Elevator',    stationType: 'Space Elevator', parentIdx: 1, capacity: 88, status: 'Operational', modules: ['Mass Driver', 'Cargo Lift', 'Hab Ring'], orbitOffset: 0.12 },
  { name: 'Duskfall Survey Relay',   stationType: 'Sensor Array',   parentIdx: 2, capacity: 30, status: 'Operational', modules: ['Deep Scan', 'Comm Relay', 'Nav Beacon'], orbitOffset: 0.15 },
];

/**
 * Create a station mesh group (cylinder body + torus ring + box arm).
 * Matches monolithic station construction.
 */
export function createStationMesh(cfg: StationConfig): Group {
  const g = new Group();
  g.name = `station-${cfg.name}`;

  // Central cylinder
  const body = new Mesh(
    new CylinderGeometry(0.06, 0.06, 0.02, 8),
    new MeshStandardMaterial({ color: 0xbbbbaa, metalness: 0.5, roughness: 0.4 }),
  );
  g.add(body);

  // Torus ring
  const ring = new Mesh(
    new TorusGeometry(0.12, 0.008, 8, 24),
    new MeshStandardMaterial({ color: 0x889098, metalness: 0.4, roughness: 0.5 }),
  );
  ring.rotation.x = Math.PI / 2;
  g.add(ring);

  // Box arm
  const arm = new Mesh(
    new BoxGeometry(0.06, 0.024, 0.024),
    new MeshStandardMaterial({ color: 0xccccbb, roughness: 0.6 }),
  );
  arm.position.z = 0.1;
  g.add(arm);

  // Invisible proxy sphere for raycasting
  // colorWrite:false + depthWrite:false = writes nothing to screen but stays raycastable
  const proxy = new Mesh(
    new SphereGeometry(0.25, 8, 8),
    new MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  );
  proxy.userData = {
    type: 'station',
    ...cfg,
    angle: Math.random() * Math.PI * 2,
    _meshRef: g,
  };
  g.add(proxy);

  // Copy userData to group for tooltip/inspector
  g.userData = proxy.userData;

  // Hex icon — visible at system+ when mesh too small
  const icon = createIcon({
    shape: 'hex',
    color: '#889098',
    label: cfg.name.toUpperCase(),
    sublabel: cfg.stationType.toUpperCase(),
  });
  icon.visible = false;
  icon.userData.isIcon = true;
  g.add(icon);

  return g;
}

// ── Oort Cloud ───────────────────────────────────────────────────

const OORT_IN_VIS_R = 1300;
const OORT_OUT_VIS_R = 3000;

/**
 * Create the Oort cloud particle shell + inner/outer boundary spheres.
 */
export function createOortCloud(): Group {
  const group = new Group();
  group.name = 'oort-cloud';

  // Inner boundary sphere (BackSide — visible when camera outside)
  const innerSphere = new Mesh(
    new SphereGeometry(OORT_IN_VIS_R, 48, 32),
    new MeshBasicMaterial({
      color: 0x8888cc, transparent: true, opacity: 0,
      side: BackSide, depthWrite: false,
    }),
  );
  innerSphere.name = 'oort-inner';
  group.add(innerSphere);

  // Outer boundary sphere
  const outerSphere = new Mesh(
    new SphereGeometry(OORT_OUT_VIS_R, 48, 32),
    new MeshBasicMaterial({
      color: 0x6666aa, transparent: true, opacity: 0,
      side: BackSide, depthWrite: false,
    }),
  );
  outerSphere.name = 'oort-outer';
  group.add(outerSphere);

  // Particle shell
  const count = 600;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = OORT_IN_VIS_R + Math.pow(Math.random(), 0.6) * (OORT_OUT_VIS_R - OORT_IN_VIS_R);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) * 0.4; // squashed
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const b = 0.25 + Math.random() * 0.25;
    colors[i * 3] = b * 0.8;
    colors[i * 3 + 1] = b * 0.85;
    colors[i * 3 + 2] = b;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const pts = new Points(geo, new PointsMaterial({
    size: 1.5, vertexColors: true, sizeAttenuation: true,
    transparent: true, opacity: 0.3,
  }));
  pts.name = 'oort-particles';
  group.add(pts);

  return group;
}

// ── Ecliptic Grid ────────────────────────────────────────────────

/**
 * Create a dot grid on the ecliptic plane.
 * Matches the monolithic eclipticGrid.
 */
export function createEclipticGrid(): Group {
  const group = new Group();
  group.name = 'ecliptic-grid';
  group.visible = false; // shown at system zoom+

  const dotPositions: number[] = [];
  const dotColors: number[] = [];

  for (let gx = -20 * AU; gx <= 20 * AU; gx += AU) {
    for (let gz = -20 * AU; gz <= 20 * AU; gz += AU) {
      const dist = Math.sqrt(gx * gx + gz * gz);
      if (dist < AU * 0.3 || dist > 20 * AU) continue;
      dotPositions.push(gx, 0, gz);
      const fade = Math.max(0.1, 1 - dist / (20 * AU));
      dotColors.push(fade * 0.3, fade * 0.35, fade * 0.4);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(dotPositions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(dotColors, 3));
  const pts = new Points(geo, new PointsMaterial({
    size: 0.4, vertexColors: true, sizeAttenuation: true,
    transparent: true, opacity: 0.5, depthWrite: false,
  }));
  group.add(pts);

  return group;
}

// ── Comets ───────────────────────────────────────────────────────

export interface CometConfig {
  name: string;
  sma: number;
  ecc: number;
  inc: number;
  omega: number;
  Omega: number;
  color: number;
}

export const COMET_DATA: CometConfig[] = [
  { name: 'C/2347-A1', sma: 800, ecc: 0.97, inc: 1.2, omega: 0.8, Omega: 2.1, color: 0x99ccff },
  { name: 'C/2347-B2', sma: 1200, ecc: 0.95, inc: 0.4, omega: 1.5, Omega: 4.2, color: 0xaaddee },
  { name: 'C/2347-C3', sma: 2500, ecc: 0.99, inc: 2.4, omega: 3.1, Omega: 0.7, color: 0x88bbdd },
];



/**
 * Create a comet body mesh (small glowing sphere).
 * Returns { body, orbLine } — body is added to local, orbLine to local.
 */
export function createCometMesh(cfg: CometConfig): { body: Mesh; orbLine: Line } {
  // Comet body — small emissive sphere
  const body = new Mesh(
    new SphereGeometry(0.02, 8, 8),
    new MeshBasicMaterial({
      color: cfg.color, transparent: true, opacity: 1,
    }),
  );
  body.name = `comet-${cfg.name}`;
  body.userData = {
    type: 'comet',
    name: cfg.name,
    sma: cfg.sma,
    ecc: cfg.ecc,
    _meshRef: body,
  };

  // Orbit ellipse line
  const perihelion = cfg.sma * (1 - cfg.ecc);
  const aphelion = cfg.sma * (1 + cfg.ecc);
  const a = cfg.sma * (AU / 100);     // scale down for visibility
  const b = a * Math.sqrt(1 - cfg.ecc * cfg.ecc);
  const centerX = -(cfg.ecc * a);

  const curve = new EllipseCurve(centerX, 0, a, b, 0, Math.PI * 2, false, 0);
  const pts = curve.getPoints(128);
  const lineGeo = new BufferGeometry();
  const linePositions: number[] = [];
  for (const p of pts) {
    // Rotate by Omega around Y, then tilt by inc
    const cx = p.x * Math.cos(cfg.Omega) - p.y * Math.sin(cfg.Omega);
    const cz = p.x * Math.sin(cfg.Omega) + p.y * Math.cos(cfg.Omega);
    const cy = cz * Math.sin(cfg.inc);
    const fz = cz * Math.cos(cfg.inc);
    linePositions.push(cx, cy, fz);
  }
  lineGeo.setAttribute('position', new Float32BufferAttribute(linePositions, 3));
  const orbLine = new Line(lineGeo, new LineBasicMaterial({
    color: cfg.color, transparent: true, opacity: 0.12,
  }));
  orbLine.name = `comet-orbit-${cfg.name}`;

  return { body, orbLine };
}

// Galaxy construction moved to src/render/galaxy.ts
