// ═══════════════════════════════════════════════════════════════════
// MAIN — Game Loop & System Orchestration
// Entry point that initializes all systems and runs the game loop.
//
// System execution order per frame:
//   1. Input processing
//   2. AI evaluation (staggered)
//   3. ECS systems (orbital, velocity, transit, render sync)
//   4. Steering behaviors
//   5. Camera update
//   6. Audio mix update
//   7. Ambient layer update
//   8. Render
//   9. Debug overlay
//
// Fixed-timestep simulation with variable rendering ensures
// deterministic game logic regardless of frame rate.
// ═══════════════════════════════════════════════════════════════════

import './styles.css';
import { Vector3 } from 'three';

import { createRenderer, type RendererContext } from './render/renderer';
import { createScene, registerRenderObject, type SceneContext } from './render/scene';
import { setMaxAnisotropy } from './render/icons';
import {
  createBackgroundStars, createMilkyWay,
  createHeliopause,
} from './render/particles';
import { createAsteroidBelt } from './render/asteroid-belt';
import {
  createStarMesh, createPlanetMesh, createMoonMesh, createBobMesh,
  createSystemMarker, createOrbitLine, updateSunSystem,
  updatePlanetShaders, updateOrbitLineResolution,
} from './render/objects';
import { CameraController } from './core/camera';
import { InputManager } from './core/input';
import { Game } from './core/state';
import { Events } from './core/events';
import { world, Strings, createStarEntity, createPlanetEntity, createMoonEntity, createBobEntity, createSystemEntity } from './core/world';
import { runSystems, type FrameContext } from './core/systems';
import { setCommandTick } from './network/commands';
import { Bus } from './network/command-bus';
import { updateAI } from './simulation/ai/ai-manager';
import { buildStarGraph } from './simulation/pathfinding';
import { updateSteering } from './simulation/steering';
import { Audio } from './audio/audio-manager';
import { registerDefaultSFX, initSFXEvents } from './audio/sfx';
import { Music } from './audio/music';
import { Ambience } from './audio/ambience';
import { Notifications } from './ui/notifications';
import { initStepControls, updateStepControlsFrame } from './ui/step-controls';
import { PanelManager } from './ui/panel-manager';
import { initDock } from './ui/dock';
import { initHUD, updateHUD } from './ui/hud';
import { Tooltip } from './ui/tooltip';
import { initRaycast } from './ui/raycast';
import { Theme } from './ui/theme';
import { initDetailPanel } from './ui/panels/detail';
import { initSettingsPanel } from './ui/panels/settings';
import { initRosterPanel } from './ui/panels/roster';
import { SelectionPanels } from './ui/panels/selection';
import { initVisibility, updateVisibility } from './render/visibility';
import {
  createStationMesh, createCometMesh, createOortCloud,
  createEclipticGrid,
  STATION_DATA, COMET_DATA, type StationConfig,
} from './render/scene-objects';
import { createGalaxy, getGalaxyOffset, updateGalaxyAnimations, updateGalaxyLOD, createSectorOrb } from './render/galaxy';
import { createPostProcessing, type PostProcessingContext } from './render/post-processing';
import { createLensFlare, type LensFlareSystem } from './render/lens-flare';
import { Debug } from './debug/debug-overlay';
import { initVisualEditor } from './ui/panels/visual-editor'; // ADMIN VISUAL EDITOR — REMOVE
import { requestPersistence, startAutosave } from './persistence/save-manager';
import {
  STAR_SYSTEMS, EPS_ERI_STAR, EPS_ERI_PLANETS,
  SOL_STAR, SOL_PLANETS, SOL_MOONS,
  createInitialBobs,
} from './data/star-catalog';
import { PlanetState, Identity, EntityType, BobState, Personality, StarSystem } from './core/components';

// ── HMR State ──
// Use window globals so dispose() from the OLD module can clean up
// even after Vite replaces the module-level vars with fresh ones.
// `bootGen` is a monotonic counter — each boot() increments it,
// and the game loop self-terminates if its generation is stale.
interface HmrState {
  animFrameId: number;
  renderer: import('three').WebGLRenderer | null;
  bootGen: number;
  resizeHandler: (() => void) | null;
}
const _hmr: HmrState = ((globalThis as Record<string, unknown>).__legion_hmr as HmrState) ?? {
  animFrameId: 0,
  renderer: null,
  bootGen: 0,
  resizeHandler: null,
};
(globalThis as Record<string, unknown>).__legion_hmr = _hmr;

// ── Bootstrap ────────────────────────────────────────────────────

async function boot(): Promise<void> {
  // Increment boot generation — any older game loop will self-terminate
  const myGen = ++_hmr.bootGen;

  // ── 0. Cleanup stale state from prior boot (HMR/reload) ──
  if (_hmr.animFrameId) {
    cancelAnimationFrame(_hmr.animFrameId);
    _hmr.animFrameId = 0;
  }
  if (_hmr.resizeHandler) {
    window.removeEventListener('resize', _hmr.resizeHandler);
    _hmr.resizeHandler = null;
  }
  if (_hmr.renderer) {
    _hmr.renderer.dispose();
    _hmr.renderer.forceContextLoss();
    _hmr.renderer = null;
  }
  const container = document.getElementById('game-container')!;
  for (const stale of container.querySelectorAll('canvas')) stale.remove();

  console.info(`[Legion] Booting (gen ${myGen})...`);

  // ── 1. Renderer ──
  const renderCtx = await createRenderer(container);
  _hmr.renderer = renderCtx.renderer;
  console.info(`[Legion] Renderer: ${renderCtx.backend.toUpperCase()}`);

  setMaxAnisotropy(renderCtx.maxAnisotropy);

  // ── 2. Scene ──
  const sceneCtx = createScene();
  const { scene, camera, layers, renderObjectMap, clock } = sceneCtx;

  // ── 2b. Post-Processing ──
  const postCtx = createPostProcessing(renderCtx.renderer, scene, camera);

  // Sync post-processing size and orbit line resolution on window resize
  _hmr.resizeHandler = () => {
    postCtx.resize(window.innerWidth, window.innerHeight);
    updateOrbitLineResolution(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', _hmr.resizeHandler);

  // ── 2c. Lens Flare ──
  const lensFlare = createLensFlare(postCtx);

  // ── 3. Camera ──
  const camCtrl = new CameraController(camera);

  // ── 4. Input ──
  const input = new InputManager(renderCtx.canvas);

  // ── 4b. Camera Events ──
  // Single-shot focus to a world position (clears any active tracking)
  Events.on('camera:focus-on', (pos: { x: number; y: number; z: number }) => {
    camCtrl.focusOn(pos.x, pos.y, pos.z);
  });
  // Lock camera to follow an Object3D — used by dblclick handler so the
  // camera tracks moving planets, bobs in flight, etc. Works for static
  // objects too (galactic markers, stations) — just keeps focus centered.
  Events.on('camera:focus-object', (data: { obj: import('three').Object3D }) => {
    camCtrl.trackObject(data.obj);
  });

  // ── 5. UI Systems ──
  Notifications.init();
  initStepControls();
  PanelManager.init();
  Theme.apply();
  initDetailPanel();
  initSettingsPanel();
  initRosterPanel();
  SelectionPanels.init();
  initDock();
  initHUD();
  Tooltip.init();
  initRaycast(camera, layers, renderCtx.canvas, scene);
  Debug.init(renderCtx.renderer);
  initVisualEditor(); // ADMIN VISUAL EDITOR — REMOVE

  // ── 6. Audio (deferred until user interaction) ──
  registerDefaultSFX();
  initSFXEvents();
  Music.registerDefaultTrackSets();
  Ambience.registerDefaults();
  Ambience.initEvents();

  const initAudio = async () => {
    await Audio.init();
    await Audio.resume();
    await Music.init();
    document.removeEventListener('click', initAudio);
    document.removeEventListener('keydown', initAudio);
  };
  document.addEventListener('click', initAudio, { once: true });
  document.addEventListener('keydown', initAudio, { once: true });

  // ── 7. Persistence ──
  await requestPersistence();
  startAutosave(60000);

  // ── 8. World Population ──
  const params = new URLSearchParams(window.location.search);
  const systemId = (params.get('system') === 'sol' ? 'sol' : 'ee') as 'ee' | 'sol';
  const worldExtras = populateWorld(sceneCtx, systemId);

  // ── 8b. Tab Cycling Through Bobs ──
  let bobCycleIndex = -1;
  Events.on('camera:focus-bob', () => {
    const bobEids = worldExtras.bobEids;
    if (bobEids.length === 0) return;
    bobCycleIndex = (bobCycleIndex + 1) % bobEids.length;
    const eid = bobEids[bobCycleIndex];
    const mesh = renderObjectMap.get(eid);
    if (mesh) {
      const wp = mesh.getWorldPosition(new Vector3());
      camCtrl.focusOn(wp.x, wp.y, wp.z);
      const userData = mesh.userData as Record<string, unknown>;
      Game.selectEntity(eid, userData);
    }
  });

  // ── 8c. Layer Visibility ──
  initVisibility(
    layers,
    worldExtras.eclipticGrid,
    worldExtras.oortCloud,
    worldExtras.galaxyArms,
    worldExtras.sectorOrb,
  );

  // ── 8d. Default focus: home habitable planet ──
  // Without this, the camera starts pointed at the star, making the
  // close-in tiers (surface, low-orbit, orbit) frame the inside of
  // the sun rather than a planet.
  const homePlanetName = systemId === 'sol' ? 'Earth' : 'Romulus';
  scene.traverse((obj) => {
    if (obj.userData?.type === 'planet' && obj.userData?.name === homePlanetName) {
      camCtrl.trackObject(obj);
    }
  });

  // ── 9. Star Graph ──
  const systemEids: number[] = [];
  // Collect all system entity IDs from the ECS
  // (In production, use a defineQuery for StarSystem)
  for (const sys of STAR_SYSTEMS) {
    // Systems were created in populateWorld, find their eids
    // For now, store them during creation
  }

  // ── 10. Notifications ──
  const systemName = systemId === 'sol' ? 'Sol' : 'Epsilon Eridani';
  Events.emit('ui:notification', {
    title: 'SYSTEM ONLINE',
    desc: `${renderCtx.backend.toUpperCase()} renderer — ${systemName} system loaded`,
    color: '#44ff88',
    duration: 5000,
  });

  // ── Game Loop ──
  const starOrigin = new Vector3(0, 0, 0); // Star is always at origin
  let lastTime = performance.now();
  let elapsedTime = 0;

  function gameLoop(): void {
    // Self-terminate if a newer boot has started (HMR stacking)
    if (myGen !== _hmr.bootGen) {
      console.warn(`[Legion] Stale game loop (gen ${myGen} vs ${_hmr.bootGen}), stopping`);
      return;
    }
    _hmr.animFrameId = requestAnimationFrame(gameLoop);

    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1); // cap at 100ms
    lastTime = now;
    elapsedTime += dt;

    const tc = Game.getTimeSpeed().tc;
    const gameTime = Game.data.gameTime;

    // Update command tick
    setCommandTick(Math.floor(gameTime));

    // 1. Advance game time
    if (tc > 0) {
      Game.data.gameTime += dt * tc;
    }

    // 3. AI (staggered evaluation)
    updateAI({
      world,
      gameTime: Game.data.gameTime,
      dt,
      timeCompression: tc,
    });

    // 4. ECS Systems
    const frameCtx: FrameContext = {
      dt,
      gameTime: Game.data.gameTime,
      timeCompression: tc,
      zoomLevel: Game.data.zoomLevel,
      renderMap: renderObjectMap,
    };
    runSystems(world, frameCtx);

    // 5. Steering
    updateSteering(dt, tc);

    // 5b. (Removed — camera now tracks via CameraController.trackedObject
    //      driven by 'camera:focus-object'. Single-click selection no
    //      longer hijacks the camera; only double-click triggers focus.)

    // 6. Camera
    camCtrl.update(dt);

    // 7. Audio
    Audio.updateMix(dt);
    Ambience.update(dt);

    // 8. FPS tracking
    Game.data.fps = Math.round(1 / Math.max(dt, 0.001));

    // 8b. Step controls (zoom bar sync)
    updateStepControlsFrame();

    // 8c. HUD (domain label, time display, game clock, status)
    updateHUD();

    // 8d. Layer visibility per zoom tier
    updateVisibility();

    // 8e. Selection panels (connection line + production queue tick)
    SelectionPanels.drawConnection(camera);
    if (!Game.data.paused) SelectionPanels.tickQueue(dt);

    // 9. Sun shader update (animated cubemap + uniforms)
    updateSunSystem(renderCtx.renderer, dt);

    // 9b. Planet shader update (sun direction, rotation, storms, non-focused planet culling)
    // Always pass a focus target so angular culling knows which planet to keep visible.
    // Default to origin (star) when no entity is selected.
    const focusTarget = Game.data.camFocusTarget ?? { x: 0, y: 0, z: 0 };
    updatePlanetShaders(Game.data.gameTime, camera.position, focusTarget, Game.data.zoomDomain);

    // 9c. Lens flare update (star position → screen space)
    lensFlare.update(starOrigin, camera, dt);

    // 9d. Galaxy animations (dashed lines, chevron pulses)
    updateGalaxyAnimations(elapsedTime);

    // 9e. Galaxy LOD — fades local-arm detail / dust / nebula presence
    // by current camera distance so each zoom tier has the right density.
    updateGalaxyLOD(Game.data.camDist);

    // 10. Render (post-processing pipeline)
    postCtx.render(elapsedTime);

    // 10. Debug
    Debug.update(dt);
  }

  // Start the loop
  gameLoop();
  console.info(`[Legion] Game loop started (gen ${myGen})`);
}

// ── World Population ─────────────────────────────────────────────

interface WorldExtras {
  eclipticGrid: import('three').Group;
  oortCloud: import('three').Group;
  galaxyArms: import('three').Group;
  sectorOrb: import('three').Group;
  bobEids: number[];
}

function populateWorld(ctx: SceneContext, systemId: 'ee' | 'sol'): WorldExtras {
  const { scene, layers, renderObjectMap } = ctx;

  const isSol = systemId === 'sol';
  const star = isSol ? SOL_STAR : EPS_ERI_STAR;
  const planets = isSol ? SOL_PLANETS : EPS_ERI_PLANETS;
  const moons = isSol ? SOL_MOONS : [];

  // ── Star ──
  const starEid = createStarEntity(star);
  const starLabel = isSol ? 'SOL' : 'ε ERIDANI';
  const starSublabel = isSol ? 'G2V' : 'K2V · HOME';
  const starMesh = createStarMesh(star.color, star.radius, starLabel, starSublabel);
  layers.local.add(starMesh);
  registerRenderObject(renderObjectMap, starEid, starMesh);

  // ── Planets ──
  const planetEidMap = new Map<string, number>(); // name → eid for moon parent lookup
  for (const pCfg of planets) {
    const eid = createPlanetEntity(pCfg);
    planetEidMap.set(pCfg.name, eid);

    const mesh = createPlanetMesh(
      pCfg.color, pCfg.size, pCfg.planetType,
      pCfg.hasAtmosphere, pCfg.atmosColor,
      pCfg.name, pCfg.status,
      pCfg.texturePath, pCfg.ringTexturePath,
      pCfg.axialTilt ?? 0, pCfg.dayLength ?? 1,
    );
    layers.local.add(mesh);
    registerRenderObject(renderObjectMap, eid, mesh);

    // Orbit line
    const orbit = createOrbitLine(pCfg.sma, pCfg.ecc);
    layers.local.add(orbit);
  }

  // ── Moons ──
  for (const mCfg of moons) {
    const parentEid = planetEidMap.get(mCfg.parentName) ?? 0;
    const eid = createMoonEntity(mCfg, parentEid);

    const mesh = createMoonMesh(
      mCfg.color, mCfg.size, mCfg.name,
      mCfg.texturePath, mCfg.dayLength ?? 1,
    );
    layers.local.add(mesh);
    registerRenderObject(renderObjectMap, eid, mesh);
  }

  // ── Stations (orbiting planets — EE only) ──
  if (!isSol) {
    for (const sCfg of STATION_DATA) {
      const stationMesh = createStationMesh(sCfg);
      const parentPlanet = planets[sCfg.parentIdx];
      if (parentPlanet) {
        const AU = 10;
        const angle = sCfg.orbitOffset * Math.PI * 2;
        const r = parentPlanet.sma * AU + 0.5;
        stationMesh.position.set(
          Math.cos(angle) * r,
          0.1,
          Math.sin(angle) * r,
        );
      }
      layers.local.add(stationMesh);
    }
  }

  // ── Bobs (EE only) ──
  const bobEids: number[] = [];
  if (!isSol) {
    const homeSystemEid = 0;
    for (const bCfg of createInitialBobs(homeSystemEid)) {
      const eid = createBobEntity(bCfg);
      bobEids.push(eid);
      const mesh = createBobMesh(bCfg.color, bCfg.name, bCfg.callsign);
      layers.local.add(mesh);
      registerRenderObject(renderObjectMap, eid, mesh);
    }
  }

  // ── Comets ──
  for (const cCfg of COMET_DATA) {
    const { body, orbLine } = createCometMesh(cCfg);
    // Position comet near perihelion
    const AU = 10;
    const periR = cCfg.sma * (1 - cCfg.ecc) * (AU / 100);
    body.position.set(periR, 0, 0);
    layers.local.add(body);
    layers.local.add(orbLine);
  }

  // ── Star System Markers (Regional View) ──
  const systemEids: number[] = [];
  for (const sCfg of STAR_SYSTEMS) {
    const eid = createSystemEntity(sCfg);
    systemEids.push(eid);

    const marker = createSystemMarker(sCfg.name, sCfg.color, sCfg.hasBobs, sCfg.isHome);

    // Regional scale chosen so the nearest neighbors land at ~1500-2500 WU
    // (visible inside the heliopause camDist 1000-2800 frustum) and all 16
    // systems fit within the sector camDist 2800-5500 viewport.
    const REGIONAL_SCALE = 250;
    marker.position.set(
      sCfg.x * REGIONAL_SCALE,
      sCfg.y * REGIONAL_SCALE * 0.3,
      sCfg.z * REGIONAL_SCALE,
    );
    marker.scale.setScalar(450);  // larger so the icons read at sector camDist 3-5k

    layers.regional.add(marker);
    registerRenderObject(renderObjectMap, eid, marker);
  }

  buildStarGraph(systemEids, 15);

  // ── Background ──
  layers.background.add(createBackgroundStars(8000));
  layers.background.add(createMilkyWay(25000));

  // ── Debris Disk ──
  // ── Asteroid Belt (instanced, flat-shaded) ──
  const beltInner = isSol ? 2.1 : 2.5;
  const beltOuter = isSol ? 3.3 : 4.5;
  const asteroidBelt = createAsteroidBelt(beltInner, beltOuter);
  asteroidBelt.group.name = 'asteroid-belt';
  layers.local.add(asteroidBelt.group);

  // ── Heliopause ──
  layers.local.add(createHeliopause(120));

  // ── Oort Cloud (visible at heliopause+) ──
  const oortCloud = createOortCloud();
  scene.add(oortCloud);

  // ── Ecliptic Grid (visible at system+, strategic overlay) ──
  const eclipticGrid = createEclipticGrid();
  scene.add(eclipticGrid);

  // ── Galaxy (visible at arm/galaxy tiers) ──
  const galaxyGroup = createGalaxy();
  galaxyGroup.position.copy(getGalaxyOffset());
  scene.add(galaxyGroup);

  // ── Sector orb (Homeworld-style sensor bubble, visible at sector tier) ──
  // Sits at the home origin in scene space; visibility system shows/hides
  // it per zoom domain.
  // Sector orb radius matches the regional-system spread — encloses the
  // ~16 nearest navigable systems comfortably.
  const sectorOrb = createSectorOrb(3000);
  scene.add(sectorOrb);

  return { eclipticGrid, oortCloud, galaxyArms: galaxyGroup, sectorOrb, bobEids };
}

// ── Start ────────────────────────────────────────────────────────

boot().catch((err) => {
  console.error('[Legion] Fatal boot error:', err);
  document.body.innerHTML = `
    <div style="color:#ff4444;font-family:monospace;padding:40px;text-align:center">
      <h2>Boot Failed</h2>
      <p>${err instanceof Error ? err.message : String(err)}</p>
      <p style="color:#666">Check console for details. WebGPU/WebGL 2 required.</p>
    </div>
  `;
});

// ── HMR Cleanup ──
// Vite HMR re-runs this module on changes; cancel old loop + dispose renderer
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    // Read from the shared global — survives module replacement
    const hmr = (globalThis as Record<string, unknown>).__legion_hmr as HmrState | undefined;
    if (!hmr) return;

    // Cancel the old render loop
    if (hmr.animFrameId) {
      cancelAnimationFrame(hmr.animFrameId);
      hmr.animFrameId = 0;
    }

    // Remove resize listener
    if (hmr.resizeHandler) {
      window.removeEventListener('resize', hmr.resizeHandler);
      hmr.resizeHandler = null;
    }

    // Dispose the WebGL renderer (releases GPU context)
    if (hmr.renderer) {
      hmr.renderer.dispose();
      hmr.renderer.forceContextLoss();
      hmr.renderer = null;
    }

    // Remove stale canvases
    const container = document.getElementById('game-container');
    if (container) {
      for (const canvas of container.querySelectorAll('canvas')) {
        canvas.remove();
      }
    }
  });
}
