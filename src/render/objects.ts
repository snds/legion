// ═══════════════════════════════════════════════════════════════════
// OBJECT FACTORIES — 3D Mesh Creation for ECS Entities
// Creates Three.js Object3D groups for each entity type.
// Each factory returns a group containing the mesh + icon + label.
// The group gets registered in the renderObjectMap via its ECS eid.
//
// Mesh LOD: close → geometry, far → icon billboard.
// The visibility system handles crossfading between them.
//
// P2-5: the legacy planet/moon rendering pipeline (createPlanetMesh,
// createMoonMesh, updatePlanetShaders, and their shader/procedural-texture
// dependencies) was deleted from this file once every catalogue planet and
// moon was routed to the ContinuumGlobe pipeline (planet-continuum-adapter.ts)
// with independently-verified parity. This file now holds only the
// non-planet factories that were always live in production: the star,
// Von Neumann probes ("bobs"), regional markers, and orbit lines.
// ═══════════════════════════════════════════════════════════════════

import {
  Group, Mesh, SphereGeometry, MeshStandardMaterial, MeshBasicMaterial,
  DoubleSide, Color, BufferGeometry, Float32BufferAttribute, EllipseCurve,
  Vector2, LineSegments, LineBasicMaterial,
  type WebGLRenderer,
} from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { createIcon, type IconShape } from './icons';
import type { CosmicObject } from '../data/cosmic-objects';
import { AU_TO_WU } from '../core/metrics';
import { createSunSystem, type SunSystem } from './sun';

// ── Color Helpers ────────────────────────────────────────────────

function numToHex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}

// ── Star ─────────────────────────────────────────────────────────

/** Stored reference to the active sun system for per-frame updates */
let activeSunSystem: SunSystem | null = null;

/** Sun systems by star group — lets a disposed star release its cubemap
 *  pipeline and stop the per-frame update (system-loader dispose path). */
const sunSystemByStar = new Map<Group, SunSystem>();

export function createStarMesh(color: number, radius: number, name = 'ε ERIDANI', spectralInfo = 'K2V · HOME'): Group {
  const group = new Group();
  group.name = 'star';
  group.userData.type = 'star';
  group.userData.name = name;
  group.userData.spectralType = spectralInfo;
  group.userData.bodyRadius = radius;

  // Procedural sun shader system (surface + glow + corona rays)
  const sunSys = createSunSystem(radius);
  activeSunSystem = sunSys;
  sunSystemByStar.set(group, sunSys);
  group.add(sunSys.group);

  // Star icon — visible at heliopause+ when mesh too small to see
  const icon = createIcon({
    shape: 'star',
    color: numToHex(color),
    label: name.toUpperCase(),
    sublabel: spectralInfo,
    glowColor: numToHex(color),
    size: 200,
  });
  icon.visible = false;
  icon.userData.isIcon = true;
  group.add(icon);

  return group;
}

/** Call each frame to update the sun's animated cubemap and shader uniforms */
export function updateSunSystem(renderer: WebGLRenderer, dt: number): void {
  activeSunSystem?.update(renderer, dt);
}

/** Unregister a star group created by createStarMesh: dispose its sun-shader
 *  system (cubemap RT, geometries, materials, VP subscription) and stop the
 *  per-frame update if it was the active sun (system-loader dispose path). */
export function unregisterStarMesh(group: Group): void {
  const sunSys = sunSystemByStar.get(group);
  if (!sunSys) return;
  sunSystemByStar.delete(group);
  sunSys.dispose();
  if (activeSunSystem === sunSys) activeSunSystem = null;
}

// ── Bob (Von Neumann Probe) ──────────────────────────────────────

export function createBobMesh(
  color: number, name: string, callsign: string,
): Group {
  const group = new Group();
  group.name = `bob-${name}`;
  group.userData.type = 'bob';
  group.userData.name = name;
  group.userData.callsign = callsign;

  // Von Neumann probe body — octahedron (angular, industrial feel)
  const bodyGeo = new SphereGeometry(0.035, 4, 3); // low-poly faceted
  bodyGeo.computeVertexNormals(); // flat normals on low-poly = angular NASA aesthetic
  const probeColor = new Color(color);
  const bodyMat = new MeshStandardMaterial({
    color: 0x889099,                          // titanium gray base
    roughness: 0.35,                           // brushed metal finish
    metalness: 0.85,                           // strongly metallic
    emissive: probeColor,
    emissiveIntensity: 0.15,                   // subtle self-illumination
    flatShading: true,                         // industrial faceted look
  });
  const body = new Mesh(bodyGeo, bodyMat);
  group.add(body);

  // Antenna / sensor mast — thin accent line
  const antGeo = new SphereGeometry(0.006, 3, 2);
  const antMat = new MeshStandardMaterial({
    color: probeColor,
    roughness: 0.2,
    metalness: 0.9,
    emissive: probeColor,
    emissiveIntensity: 0.6,                    // bright identifier beacon
  });
  const antenna = new Mesh(antGeo, antMat);
  antenna.position.set(0, 0.045, 0);
  group.add(antenna);

  // Composite: use body as primary for raycasting
  const mesh = body;

  // Icon billboard
  const icon = createIcon({
    shape: 'diamond',
    color: numToHex(color),
    label: callsign.toUpperCase(),
    sublabel: name,
    glowColor: numToHex(color),
  });
  icon.visible = false;
  icon.userData.isIcon = true;
  group.add(icon);

  return group;
}

// ── Star System Marker (Regional View) ───────────────────────────

export function createSystemMarker(
  name: string, color: number, hasBobs: boolean, isHome: boolean,
  distLy = 0, planetCount = 0, bobCount = 0, explored = false,
): Group {
  const group = new Group();
  group.name = `system-${name}`;
  group.userData.type = 'system';
  group.userData.name = name;
  group.userData.hasBobs = hasBobs;
  group.userData.isHome = isHome;
  // Inspector fields read by the selection panel (selection.ts SYSTEM block)
  // and tooltip — without these the panel showed em-dashes for systems.
  group.userData.distLy = distLy;
  group.userData.planets = planetCount;
  group.userData.bobCount = bobCount;
  group.userData.explored = explored;
  group.userData.isRegionalMarker = true; // visibility.ts scales/fades/declutters these

  // Context-driven STYLE: shape + colour communicate the system's status at a
  // glance, so neighbours read as distinct points of interest rather than a row
  // of identical glyphs. Colour-by-context (home / your presence / explored /
  // uncharted); explored systems keep their spectral colour.
  let shape: IconShape, col: string, sub: string;
  if (isHome) {
    shape = 'star'; col = '#ffd479'; sub = `HOME · ${distLy} LY`;
  } else if (hasBobs) {
    shape = 'diamond'; col = '#5ad1ff'; sub = `${bobCount} BOB${bobCount === 1 ? '' : 'S'} · ${distLy} LY`;
  } else if (explored) {
    shape = 'hex'; col = numToHex(color); sub = `EXPLORED · ${distLy} LY`;
  } else {
    shape = 'circle'; col = '#8a97b5'; sub = `UNCHARTED · ${distLy} LY`;
  }

  const icon = createIcon({
    shape,
    color: col,
    glowColor: col,
    label: name.toUpperCase(),
    sublabel: sub,
    outlineWidth: isHome ? 4 : 3,
  });
  icon.userData.isIcon = true; // screen-constant sizing + fade driven by visibility.ts
  group.add(icon);

  return group;
}

/**
 * Out-of-plane STEM for a regional marker (Solar-System-Scope style): a thin
 * vertical line from the marker down to the reference plane (y = 0) plus a
 * small base tick where it meets the plane — reads the marker's height above
 * (galactic north) or below (south) the plane at a glance.
 *
 * Added as a child of the marker GROUP; `height` is the marker's world-space y
 * (group-local, since the group is unit-scaled). Opacity is driven per frame by
 * visibility.ts (faded in with the heliopause swap). Tagged userData.isStemPart.
 */
export function createMarkerStem(height: number, color: number): LineSegments {
  const t = 40; // base-tick half-length (WU)
  const pos = [
    0, 0, 0,            0, -height, 0,        // vertical stem to the plane
    -t, -height, 0,     t, -height, 0,        // base tick (X)
    0, -height, -t,     0, -height, t,        // base tick (Z)
  ];
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const mat = new LineBasicMaterial({
    color: new Color(color), transparent: true, opacity: 0, depthWrite: false,
  });
  const seg = new LineSegments(geo, mat);
  seg.userData.isStemPart = true;
  return seg;
}

// ── Cosmic Object Marker (nebulae / megastructures) ──────────────

const COSMIC_SHAPE: Record<CosmicObject['type'], IconShape> = {
  nebula: 'nebula',
  dyson_sphere: 'dyson',
  dyson_swarm: 'swarm',
  megastructure: 'mega',
};

/** Regional-map marker for a non-system cosmic object — its own glyph + colour
 *  + label, riding the same pipeline as the star-system markers (screen-constant
 *  size, swap fade, stem, declutter, selection). */
export function createCosmicMarker(cfg: CosmicObject): Group {
  const group = new Group();
  group.name = `cosmic-${cfg.name}`;
  group.userData.type = cfg.type;
  group.userData.name = cfg.name;
  group.userData.distLy = cfg.distLy;
  group.userData.subtitle = cfg.subtitle;
  group.userData.eid = -1; // no ECS entity — selection reads userData directly
  group.userData.isRegionalMarker = true;

  const col = numToHex(cfg.color);
  const icon = createIcon({
    shape: COSMIC_SHAPE[cfg.type] ?? 'circle',
    color: col,
    glowColor: col,
    label: cfg.name.toUpperCase(),
    sublabel: `${cfg.subtitle} · ${cfg.distLy} LY`,
    outlineWidth: 3,
  });
  icon.userData.isIcon = true;
  group.add(icon);
  return group;
}

// ── Alien Influence Marker ───────────────────────────────────────

export function createAlienMarker(
  name: string, color: number, radius: number,
): Group {
  const group = new Group();
  group.name = `alien-${name}`;
  group.userData.type = 'alien';
  group.userData.name = name;
  group.userData.influenceRadius = radius;

  // Influence sphere
  const geo = new SphereGeometry(radius, 24, 24);
  const mat = new MeshBasicMaterial({
    color: new Color(color),
    transparent: true,
    opacity: 0.06,
    side: DoubleSide,
    depthWrite: false,
  });
  group.add(new Mesh(geo, mat));

  // Center icon — no child labels (same placeholder-position stacking
  // rationale as createSystemMarker).
  const icon = createIcon({
    shape: 'triangle',
    color: numToHex(color),
  });
  group.add(icon);

  return group;
}

// ── Orbit Line ───────────────────────────────────────────────────

/** Tracked orbit line materials for resolution updates on window resize */
const trackedOrbitMaterials: LineMaterial[] = [];

// Orbit-line styling: planetary bodies get SOLID low-opacity white; other
// system bodies (comets etc.) use their own colors. Hovering a body brightens
// its orbit line via the registry below.
const ORBIT_BASE_OPACITY = 0.08;  // subtle at rest (bloom lifts perceived brightness)
const ORBIT_HOVER_OPACITY = 0.55;
const orbitLineByBody = new Map<string, LineMaterial>();

export interface OrbitLineOptions {
  /** Body name — registers the line for hover brightening. */
  bodyName?: string;
  /** Line color (default: white for planetary bodies). */
  color?: number;
  /** Resting opacity (default ORBIT_BASE_OPACITY). */
  opacity?: number;
}

export interface OrbitLineElements {
  sma: number;          // AU
  ecc: number;
  inclination: number;  // i (radians)
  argPeriapsis: number; // ω (radians)
  longAscNode: number;  // Ω (radians)
}

export function createOrbitLine(el: OrbitLineElements, opts: OrbitLineOptions = {}): Line2 {
  const AU_SCALE = AU_TO_WU;
  const a = el.sma * AU_SCALE;
  const b = a * Math.sqrt(1 - el.ecc * el.ecc);
  // Perifocal-plane ellipse with the focus (star) at the local origin.
  const curve = new EllipseCurve(
    -a * el.ecc, 0,  // center offset by focal distance
    a, b,
    0, Math.PI * 2,
    false, 0,
  );

  // Rotate perifocal → reference frame by R = R_z(Ω)·R_x(i)·R_z(ω) and apply
  // the same Y-up axis mapping the propagator uses (systems.ts orbitalSystem:
  // world (X,Y,Z) = (px, pz, py)). The line MUST share the propagator's exact
  // transform or bodies with real i/Ω/ω drift off their drawn paths — the
  // user-visible "planet offset from its orbit line" bug.
  const cosO = Math.cos(el.longAscNode), sinO = Math.sin(el.longAscNode);
  const cosw = Math.cos(el.argPeriapsis), sinw = Math.sin(el.argPeriapsis);
  const cosi = Math.cos(el.inclination),  sini = Math.sin(el.inclination);

  const points = curve.getPoints(128);
  const positions: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const xp = points[i].x;
    const yp = points[i].y;
    const px = xp * (cosO * cosw - sinO * sinw * cosi) + yp * (-cosO * sinw - sinO * cosw * cosi);
    const py = xp * (sinO * cosw + cosO * sinw * cosi) + yp * (-sinO * sinw + cosO * cosw * cosi);
    const pz = xp * (sinw * sini) + yp * (cosw * sini);
    positions.push(px, pz, py);
  }

  const geo = new LineGeometry();
  geo.setPositions(positions);

  const mat = new LineMaterial({
    color: opts.color ?? 0xffffff,  // planetary bodies: solid low-opacity white
    linewidth: 1,
    transparent: true,
    opacity: opts.opacity ?? ORBIT_BASE_OPACITY,
    depthWrite: false,
    resolution: new Vector2(window.innerWidth, window.innerHeight),
  });
  mat.userData.baseOpacity = opts.opacity ?? ORBIT_BASE_OPACITY;

  trackedOrbitMaterials.push(mat);
  if (opts.bodyName) orbitLineByBody.set(opts.bodyName, mat);

  const line = new Line2(geo, mat);
  line.name = 'orbit-line';
  // Raycast identity: lets the hover system brighten the line when the LINE
  // itself is hovered (raycaster.params.Line2.threshold gives it a fat,
  // screen-constant hit corridor despite the 1px draw width).
  if (opts.bodyName) line.userData = { type: 'orbit', name: opts.bodyName };
  line.computeLineDistances();
  return line;
}

/**
 * Brighten the orbit line of the hovered body (null clears). Called by the
 * raycast hover handler so hovering a planet/moon highlights its path.
 */
let highlightedOrbit: string | null = null;
export function setOrbitHighlight(bodyName: string | null): void {
  if (bodyName === highlightedOrbit) return;
  if (highlightedOrbit) {
    const prev = orbitLineByBody.get(highlightedOrbit);
    if (prev) prev.opacity = (prev.userData.baseOpacity as number) ?? ORBIT_BASE_OPACITY;
  }
  highlightedOrbit = bodyName;
  if (bodyName) {
    const mat = orbitLineByBody.get(bodyName);
    if (mat) mat.opacity = ORBIT_HOVER_OPACITY;
  }
}

/** Update orbit line resolution on window resize */
export function updateOrbitLineResolution(w: number, h: number): void {
  for (const mat of trackedOrbitMaterials) {
    mat.resolution.set(w, h);
  }
}

/** Unregister an orbit line from the resize + hover-highlight registries
 *  (system-loader dispose path). The caller disposes geometry/material. */
export function unregisterOrbitLine(line: Line2): void {
  const mat = line.material as LineMaterial;
  const idx = trackedOrbitMaterials.indexOf(mat);
  if (idx >= 0) trackedOrbitMaterials.splice(idx, 1);
  const bodyName = (line.userData as { name?: string }).name;
  if (bodyName && orbitLineByBody.get(bodyName) === mat) {
    orbitLineByBody.delete(bodyName);
    if (highlightedOrbit === bodyName) highlightedOrbit = null;
  }
}
