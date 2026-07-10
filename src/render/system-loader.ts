// ═══════════════════════════════════════════════════════════════════
// SYSTEM LOADER — Local-Tier System Lifecycle + Focus Manager
// Owns the star/planets/moons/stations/bobs/comets/belt/heliopause
// population that used to live inline in main.ts populateWorld, so the
// local tier can be disposed and re-instantiated at runtime.
//
// Staged loading for focusable systems (Sol, ε Eridani):
//   Stage A "preload"  (single-click) — warm the HTTP cache for the
//     system's file textures + the exoplanet sidecar. Idempotent,
//     fire-and-forget, low priority.
//   Stage B "activate" (double-click) — dispose the active system and
//     instantiate the new one, DEFERRED to a frame where the local tier
//     is imperceptible, so the swap hides inside the zoom transition.
//
// The active system renders at its regional marker position (the
// "anchor"); home boots at (0,0,0), so the default path is unchanged.
// ═══════════════════════════════════════════════════════════════════

import { Vector3, type Group, type Object3D, type WebGLRenderer } from 'three';
import type { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { removeEntity, entityExists } from 'bitecs';
import {
  world, createStarEntity, createPlanetEntity, createMoonEntity, createBobEntity,
} from '../core/world';
import { Position } from '../core/components';
import { Game } from '../core/state';
import { Events } from '../core/events';
import { GAME_EPOCH_ET } from '../core/time';
import { AU_TO_WU } from '../core/metrics';
import { asset } from '../core/assets';
import { registerRenderObject } from './scene';
import {
  createStarMesh, createPlanetMesh, createMoonMesh, createBobMesh, createOrbitLine,
  unregisterStarMesh, unregisterPlanetMesh, unregisterOrbitLine,
} from './objects';
import { createStationMesh, createCometMesh, STATION_DATA, COMET_DATA } from './scene-objects';
import { createHeliopause } from './particles';
import { createAsteroidBelt } from './asteroid-belt';
import { hasProceduralRecipe } from './procedural-textures';
import {
  EPS_ERI_STAR, EPS_ERI_PLANETS, EPS_ERI_BELTS, SOL_STAR, SOL_PLANETS, SOL_MOONS, SOL_BELTS,
  createInitialBobs,
} from '../data/star-catalog';
import { applySolEphemeris } from '../data/jpl-ephemeris';
import { loadExoplanets } from '../data/exoplanets';
import { setActiveSystemName } from '../ui/hud';

// ── Types ────────────────────────────────────────────────────────

/** Systems with full authored local-tier data (star + planet catalogue). */
export type LoadableSystemId = 'ee' | 'sol';

/** Minimal slice of SceneContext the loader touches — keeps the lifecycle
 *  testable headless (three Groups + a Map work in bare node). */
export interface SystemLoaderCtx {
  layers: { local: Group };
  renderObjectMap: Map<number, Object3D>;
}

export interface LocalSystemHandle {
  systemId: LoadableSystemId;
  /** Every ECS entity this instantiation created (star, planets, moons, bobs). */
  eids: number[];
  /** Bob entities only (tab-cycling). Subset of eids; empty for Sol. */
  bobEids: number[];
  /** Everything it added to layers.local (meshes, orbit lines, belt, shell). */
  groups: Object3D[];
  /** Remove groups + entities + render-map entries, free GPU resources,
   *  unregister shader registries. Clears the selection only if it pointed
   *  at one of this system's own entities. Safe to call once. */
  dispose(): void;
}

// ── Disposal helpers ─────────────────────────────────────────────

interface MaterialLike {
  dispose(): void;
  map?: { dispose(): void } | null;
  uniforms?: Record<string, { value: unknown } | undefined>;
}

/** Dispose a material + the textures it owns. Baked albedo/aux textures for
 *  procedural planets are cache-owned (procedural-textures.ts) and survive the
 *  swap — re-instantiation reuses them; everything else (file textures, icon
 *  canvases, ring textures) is freed. */
function disposeMaterial(mat: MaterialLike, keepBakedTextures: boolean): void {
  mat.map?.dispose?.();
  if (mat.uniforms) {
    const texKeys = keepBakedTextures ? ['uRingTexture'] : ['uDayTexture', 'uAuxTexture', 'uRingTexture'];
    for (const key of texKeys) {
      const t = mat.uniforms[key]?.value as { dispose?: () => void } | null | undefined;
      t?.dispose?.();
    }
  }
  mat.dispose();
}

/** Deep-dispose an object tree's GPU resources (geometries, materials,
 *  textures). The sun's cubemap pipeline is released separately via
 *  unregisterStarMesh → SunSystem.dispose(). */
function disposeObjectTree(root: Object3D): void {
  const keepBaked = hasProceduralRecipe((root.userData?.name as string) ?? '');
  root.traverse((obj) => {
    const o = obj as Object3D & { geometry?: { dispose(): void }; material?: unknown };
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) disposeMaterial(m as MaterialLike, keepBaked);
  });
}

// ── Instantiation ────────────────────────────────────────────────
// Verbatim extraction of the local-system block from main.ts populateWorld
// (star → planets/orbits → moons → EE-only stations/bobs → comets → belt →
// heliopause), returning a disposable handle.

export function instantiateLocalSystem(
  ctx: SystemLoaderCtx, systemId: LoadableSystemId, _renderer: WebGLRenderer | null,
): LocalSystemHandle {
  const { layers, renderObjectMap } = ctx;

  const eids: number[] = [];
  const bobEids: number[] = [];
  const groups: Object3D[] = [];
  const orbitLines: Line2[] = [];
  const bodyGroups: Group[] = []; // planet + moon groups (shader-registry unregister)

  const add = (obj: Object3D): void => {
    layers.local.add(obj);
    groups.push(obj);
  };

  const isSol = systemId === 'sol';
  const star = isSol ? SOL_STAR : EPS_ERI_STAR;
  // Sol planets get their real JPL orbital elements (positions + plane
  // orientations) evaluated at the game epoch; fictional systems keep authored
  // elements. Periods then follow from a^1.5 in the on-rails propagator.
  const planets = isSol ? applySolEphemeris(SOL_PLANETS, GAME_EPOCH_ET) : EPS_ERI_PLANETS;
  const moons = isSol ? SOL_MOONS : [];

  // ── Star ──
  const starEid = createStarEntity(star);
  eids.push(starEid);
  const starLabel = isSol ? 'SOL' : 'ε ERIDANI';
  const starSublabel = isSol ? 'G2V' : 'K2V · HOME';
  const starMesh = createStarMesh(star.color, star.radius, starLabel, starSublabel);
  add(starMesh);
  registerRenderObject(renderObjectMap, starEid, starMesh);

  // ── Planets ──
  const planetEidMap = new Map<string, number>(); // name → eid for moon parent lookup
  for (const pCfg of planets) {
    const eid = createPlanetEntity(pCfg);
    eids.push(eid);
    planetEidMap.set(pCfg.name, eid);

    const mesh = createPlanetMesh(
      pCfg.color, pCfg.size, pCfg.planetType,
      pCfg.hasAtmosphere, pCfg.atmosColor,
      pCfg.name, pCfg.status,
      pCfg.texturePath, pCfg.ringTexturePath,
      pCfg.axialTilt ?? 0, pCfg.dayLength ?? 1,
    );
    add(mesh);
    bodyGroups.push(mesh);
    registerRenderObject(renderObjectMap, eid, mesh);

    // Orbit line — solid low-opacity white; registered for hover brightening.
    // Full elements so the drawn path matches the propagator exactly.
    const orbit = createOrbitLine({
      sma: pCfg.sma,
      ecc: pCfg.ecc,
      inclination: pCfg.inclination ?? 0,
      argPeriapsis: pCfg.argPeriapsis ?? 0,
      longAscNode: pCfg.longAscNode ?? 0,
    }, { bodyName: pCfg.name });
    add(orbit);
    orbitLines.push(orbit);
  }

  // ── Moons ──
  for (const mCfg of moons) {
    const parentEid = planetEidMap.get(mCfg.parentName) ?? 0;
    const eid = createMoonEntity(mCfg, parentEid);
    eids.push(eid);

    const mesh = createMoonMesh(
      mCfg.color, mCfg.size, mCfg.name,
      mCfg.texturePath, mCfg.dayLength ?? 1,
    );
    add(mesh);
    bodyGroups.push(mesh);
    registerRenderObject(renderObjectMap, eid, mesh);
  }

  // ── Stations (orbiting planets — EE only) ──
  if (!isSol) {
    for (const sCfg of STATION_DATA) {
      const stationMesh = createStationMesh(sCfg);
      const parentPlanet = planets[sCfg.parentIdx];
      if (parentPlanet) {
        const AU = AU_TO_WU;
        const angle = sCfg.orbitOffset * Math.PI * 2;
        const r = parentPlanet.sma * AU + 0.5;
        stationMesh.position.set(
          Math.cos(angle) * r,
          0.1,
          Math.sin(angle) * r,
        );
      }
      add(stationMesh);
    }
  }

  // ── Bobs (EE only) ──
  if (!isSol) {
    const homeSystemEid = 0;
    for (const bCfg of createInitialBobs(homeSystemEid)) {
      const eid = createBobEntity(bCfg);
      eids.push(eid);
      bobEids.push(eid);
      const mesh = createBobMesh(bCfg.color, bCfg.name, bCfg.callsign);
      add(mesh);
      registerRenderObject(renderObjectMap, eid, mesh);
    }
  }

  // ── Comets ──
  for (const cCfg of COMET_DATA) {
    const { body, orbLine } = createCometMesh(cCfg);
    // Position comet near perihelion
    const AU = AU_TO_WU;
    const periR = cCfg.sma * (1 - cCfg.ecc) * (AU / 100);
    body.position.set(periR, 0, 0);
    add(body);
    add(orbLine);
  }

  // ── Asteroid Belts (instanced, flat-shaded) ──
  // From the system's data: placement follows observed formation structure
  // (main belt between the rockies and the innermost giant near the snow
  // line; debris belts beyond the outermost planet). The old hardcoded EE
  // belt (2.5–4.5 AU) crossed Jotunheim's 3.4 AU orbit.
  for (const belt of (isSol ? SOL_BELTS : EPS_ERI_BELTS)) {
    const asteroidBelt = createAsteroidBelt(belt.innerAU, belt.outerAU, belt);
    asteroidBelt.group.name = `asteroid-belt-${belt.name.toLowerCase().replace(/\s+/g, '-')}`;
    add(asteroidBelt.group);
  }

  // ── Heliopause ──
  add(createHeliopause());

  return {
    systemId, eids, bobEids, groups,
    dispose(): void {
      // Shader registries first — stops per-frame updates on dead materials.
      unregisterStarMesh(starMesh);
      for (const g of bodyGroups) unregisterPlanetMesh(g);
      for (const line of orbitLines) unregisterOrbitLine(line);

      // Scene graph + GPU resources.
      for (const obj of groups) {
        layers.local.remove(obj);
        disposeObjectTree(obj);
      }

      // ECS entities + render-map entries. Clear the selection only when it
      // points at an entity this system owned (a curated MARKER selection —
      // the normal focus-switch path — must survive the swap).
      // TODO(system-loader): AI blackboards (bobBoards/agentStates) keyed by
      // eid are lazily created and inert after removal; if bitecs ever
      // recycles a bob eid the stale state could leak into a new bob.
      const selected = Game.data.selectedEntity;
      for (const eid of eids) {
        renderObjectMap.delete(eid);
        if (entityExists(world, eid)) removeEntity(world, eid);
      }
      if (selected != null && eids.includes(selected)) Game.deselectEntity();

      groups.length = 0;
      bodyGroups.length = 0;
      orbitLines.length = 0;
      eids.length = 0;
      bobEids.length = 0;
    },
  };
}

// ── Active-System Focus Manager ──────────────────────────────────

/** Curated marker name → loadable system id (full authored local tier). */
const LOADABLE_BY_NAME: Record<string, LoadableSystemId> = {
  'Sol': 'sol',
  'Epsilon Eridani': 'ee',
};

/** systemId for a curated marker name, or null when the system has no
 *  authored local tier (not focus-loadable yet). */
export function loadableSystemId(name: string | undefined): LoadableSystemId | null {
  return name ? LOADABLE_BY_NAME[name] ?? null : null;
}

const SYSTEM_LABEL: Record<LoadableSystemId, { display: string; hud: string }> = {
  ee: { display: 'Epsilon Eridani', hud: 'ε ERI SYSTEM' },
  sol: { display: 'Sol', hud: 'SOL SYSTEM' },
};

// The heliopause icon hand-off completes at this camDist (= visibility.ts
// SWAP_OUT): local body icons are fully faded into the regional markers and
// the meshes subtend sub-pixels — the seam where a local-tier swap is
// invisible. layers.local.visible === false (arm+) also qualifies.
const SWAP_HIDDEN_CAMDIST = 3200;

interface SystemFocusRuntime {
  ctx: SystemLoaderCtx;
  renderer: WebGLRenderer | null;
  /** Regional marker entity for a loadable system (anchor + drift source). */
  markerEidFor: (id: LoadableSystemId) => number | null;
}

let runtime: SystemFocusRuntime | null = null;
let activeHandle: LocalSystemHandle | null = null;
let pendingId: LoadableSystemId | null = null;
let anchorEid: number | null = null;
const anchor = new Vector3();
const preloaded = new Set<LoadableSystemId>();

/** Wire the manager to the live scene (called from populateWorld). Idempotent
 *  across HMR — each boot passes a fresh ctx + boot handle and resets state. */
export function initSystemFocus(rt: SystemFocusRuntime, bootHandle: LocalSystemHandle): void {
  runtime = rt;
  activeHandle = bootHandle;
  pendingId = null;
  anchorEid = null; // boot system renders at the local origin (unchanged)
  anchor.set(0, 0, 0);
  setActiveSystemName(SYSTEM_LABEL[bootHandle.systemId].hud);
}

export function getActiveSystemHandle(): LocalSystemHandle | null {
  return activeHandle;
}

/** Stage A — warm the browser HTTP cache for the system's file assets and
 *  kick the exoplanet sidecar. Idempotent, fire-and-forget, low priority. */
export function preloadSystem(systemId: LoadableSystemId): void {
  if (preloaded.has(systemId)) return;
  preloaded.add(systemId);
  void loadExoplanets(); // powers resolveSystem's real-planet path (idempotent)
  if (systemId !== 'sol') return; // EE assets are procedural (IndexedDB-cached)
  const paths = new Set<string>();
  for (const p of SOL_PLANETS) {
    if (p.texturePath) paths.add(p.texturePath);
    if (p.ringTexturePath) paths.add(p.ringTexturePath);
  }
  for (const m of SOL_MOONS) if (m.texturePath) paths.add(m.texturePath);
  for (const path of paths) {
    // Stage B's TextureLoader.load() then hits a hot cache, so the textures
    // resolve inside the zoom transition — no visible pop-in.
    void fetch(asset(path), { priority: 'low' } as RequestInit)
      .catch(() => { /* warm-up only — Stage B loads normally regardless */ });
  }
}

/** Stage B — request the local-tier swap to `systemId`. No-op if already
 *  active (also cancels a pending swap away). The swap itself is deferred to
 *  updateSystemFocus(). */
export function requestSystemFocus(systemId: LoadableSystemId): void {
  preloadSystem(systemId);
  if (!runtime || !activeHandle) return;
  pendingId = activeHandle.systemId === systemId ? null : systemId;
}

/** Per-frame (main loop): perform a pending swap once the local tier is
 *  imperceptible, and track the active anchor (the marker drifts with sim
 *  time, so the anchor follows its ECS Position). */
export function updateSystemFocus(): void {
  if (pendingId && runtime && activeHandle) {
    // Never swap while the local tier is perceptible: the player may zoom
    // back in before activation — hold the swap until it hides again.
    const local = runtime.ctx.layers.local;
    const hidden = !local.visible || Game.data.camDist >= SWAP_HIDDEN_CAMDIST;
    if (hidden) activateSystem(pendingId);
  }
  if (anchorEid != null) {
    anchor.set(Position.x[anchorEid], Position.y[anchorEid], Position.z[anchorEid]);
  }
}

/** The active system's regional-frame anchor — where the local tier renders.
 *  (0,0,0) until a focus swap (home system / boot state — byte-identical). */
export function getActiveAnchor(out: Vector3): Vector3 {
  return out.copy(anchor);
}

function activateSystem(systemId: LoadableSystemId): void {
  if (!runtime || !activeHandle) return;
  pendingId = null;
  activeHandle.dispose();
  activeHandle = instantiateLocalSystem(runtime.ctx, systemId, runtime.renderer);
  anchorEid = runtime.markerEidFor(systemId);
  if (anchorEid != null) {
    anchor.set(Position.x[anchorEid], Position.y[anchorEid], Position.z[anchorEid]);
  } else {
    anchor.set(0, 0, 0);
  }
  const label = SYSTEM_LABEL[systemId];
  setActiveSystemName(label.hud);
  Events.emit('ui:notification', {
    title: `SYSTEM LOADED: ${label.display.toUpperCase()}`,
    desc: `${label.display} local tier streamed in`,
    color: '#44ff88',
    duration: 4000,
  });
}
