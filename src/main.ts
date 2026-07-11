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
import { Vector3, Euler, TextureLoader, EquirectangularReflectionMapping, SRGBColorSpace } from 'three';
import { asset } from './core/assets';

import { createRenderer, type RendererContext } from './render/renderer';
import { createScene, registerRenderObject, type SceneContext } from './render/scene';
import { createBlackHole } from './render/blackhole';
import { setMaxAnisotropy } from './render/icons';
import { setBakeRenderer } from './render/texture-baker';
import { VP } from './render/visual-params';
import { createCatalogStars } from './render/star-field';
import { createCatalogSystems, type CatalogSystemsHandle } from './render/catalog-systems';
import { createStarShells, type StarShellsHandle } from './render/star-shells';
import { bakeGalaxyBackdrop } from './render/galaxy-backdrop';
import {
  createSystemMarker, createCosmicMarker, createMarkerStem, updateSunSystem,
  updatePlanetShaders, updateOrbitLineResolution,
} from './render/objects';
import {
  instantiateLocalSystem, initSystemFocus, updateSystemFocus, requestSystemFocus,
  getActiveSystemHandle, getActiveAnchor, loadableSystemId,
  type LocalSystemHandle, type LoadableSystemId,
} from './render/system-loader';
import { updateSystemStar } from './render/star';
import { CameraController } from './core/camera';
import { InputManager } from './core/input';
import { Game } from './core/state';
import { Events } from './core/events';
import { world, createSystemEntity } from './core/world';
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
import { Tooltip, type TooltipData } from './ui/tooltip';
import { initRaycast, setCatalogPicking } from './ui/raycast';
import { Theme } from './ui/theme';
import { initDetailPanel } from './ui/panels/detail';
import { initSettingsPanel } from './ui/panels/settings';
import { initGalaxyLabPanel } from './ui/galaxy-lab-panel';
import { initRosterPanel } from './ui/panels/roster';
import { SelectionPanels } from './ui/panels/selection';
import { initVisibility, updateVisibility } from './render/visibility';
import { createReferenceRing, updateReferenceRing } from './render/reference-ring';
import { createOortCloud, createEclipticGrid } from './render/scene-objects';
import { createGalaxy, getGalaxyOffset, getGalaxyCrossfade, updateGalaxyAnimations, updateGalaxyLOD, updateGalaxyMarkerScale, updateGalaxyFrame, updateStarStreaks, createSectorOrb, setDiscVisual } from './render/galaxy';
import { createGalaxyBuildout, updateGalaxyBuildout, buildoutStatus, type GalaxyBuildout } from './render/sector/galaxy-buildout';
import { createPhysicalGalaxy, type PhysicalGalaxySystem } from './render/galaxy-sim';
import { createSectorPrototype, updateSectorPrototype } from './render/sector/sector-prototype';
import { createSectorManager, updateSectorManager, type SectorManager } from './render/sector/sector-manager';
import { createRegionManager, regionTelemetry, updateRegionManager, type RegionManager } from './render/sector/region-manager';
import { createSectorFill, fillStatus, updateSectorFill, type SectorFill } from './render/sector/sector-fill';
import { setArmDebug } from './render/sector/sector-stars';
import { absWUToGalPc, HOME_GAL_PC } from './render/sector/sector';
import { runSectorTour, type SectorTourHandle } from './render/sector/sector-tour';
import { regionalScenePos, CURATED_SYSTEMS, type CuratedSystem } from './data/curated-systems';
import { Position } from './core/components';
import {
  gameTimeToMyr, driftedRegionalScenePos, driftGalPc, DRIFT_MIN_STEP_MYR,
} from './core/galactic-drift';
import { Broker } from './render/scale-manager';
import { createPostProcessing, type PostProcessingContext } from './render/post-processing';
import { createLensFlare, type LensFlareSystem } from './render/lens-flare';
import { Debug } from './debug/debug-overlay';
import { initVisualEditor } from './ui/panels/visual-editor'; // ADMIN VISUAL EDITOR — REMOVE
import { requestPersistence, startAutosave } from './persistence/save-manager';
import { STAR_SYSTEMS } from './data/star-catalog';
import { COSMIC_OBJECTS } from './data/cosmic-objects';
import { LY_TO_WU, KPC_TO_WU, SOL_GAL_PC, SYSTEM_TIER_SCALE } from './core/metrics';
import { PlanetGlobes, showcaseSystem } from './render/planet';
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

// Phase 5a: camDist (WU) at/above which the sector-particle streaming runs. The
// sector stars sit ≥25pc (≥25 000 WU) out, so they only enter the frustum once
// far = camDist·100 reaches them (camDist ≳ 250); streaming a bit earlier
// pre-generates the residency so it is ready when they appear. Below this the
// streaming is skipped and the sector group hidden — the system tier pays nothing.
const SECTOR_STREAM_MIN_CAMDIST = 30;

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

  // ── N-body micro-benchmark (?nbody-bench, P1) — measure the real all-pairs force-solver ceiling on
  // THIS hardware (laptop + iPad) to ground the "no live N-body at 2-3M" decision with our own numbers. ──
  if (new URLSearchParams(location.search).has('nbody-bench')) {
    const { runNbodyBench } = await import('./render/nbody-bench');
    void runNbodyBench();
    return;
  }

  // ── Independent galaxy PAINT MODE (?paint-mode) — the standalone painting-tool shell: only the
  // full-galaxy build-out + a free-fly camera, none of the system-tier streaming/transitions. ──
  if (new URLSearchParams(location.search).has('paint-mode')) {
    const { bootGalaxyPaint } = await import('./render/galaxy-paint');
    bootGalaxyPaint(renderCtx, () => _hmr.bootGen === myGen);
    return;
  }

  setMaxAnisotropy(renderCtx.maxAnisotropy);
  // Register the renderer with the planet texture baker before the world is
  // populated (populateWorld → createPlanetMesh → generatePlanetTexture).
  setBakeRenderer(renderCtx.renderer);

  // ── 2. Scene ──
  const sceneCtx = createScene();
  const { scene, starLight, camera, layers, renderObjectMap, clock } = sceneCtx;

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
  // Scale-unification U2: teach the camera to resolve a tracked LOCAL-tier body's
  // ABSOLUTE world position directly, instead of the getWorldPosition()+R round-
  // trip that oscillates at the true-scale local group (layers.local.scale =
  // SYSTEM_TIER_SCALE). A local body is a direct child of layers.local, so its
  // authored obj.position is its local-frame coordinate; the true absolute is
  // tierOrigin(0) + anchor + obj.position·SYSTEM_TIER_SCALE. Non-local objects
  // (regional/galactic markers ride their tier 1:1) return null → the camera
  // falls back to the residual read + R, which reconverges fine at 1:1.
  const _trackAnchor = new Vector3();
  camCtrl.setAbsoluteResolver((obj, out) => {
    if (obj.parent !== layers.local) return null;
    getActiveAnchor(_trackAnchor);
    return out.copy(obj.position).multiplyScalar(SYSTEM_TIER_SCALE).add(_trackAnchor);
  });
  // Dev-mode global for console-driven testing (flight mode etc).
  if (import.meta.env?.DEV) {
    (globalThis as Record<string, unknown>).__cam = camCtrl;
  }

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
  // Cinematic flight (shift+dblclick) — Bezier arc with eased timing.
  Events.on('camera:fly-to', (data: { x: number; y: number; z: number; targetZoomLevel: number | null }) => {
    const target = new Vector3(data.x, data.y, data.z);
    camCtrl.flyTo(target, {
      targetZoomLevel: data.targetZoomLevel ?? undefined,
    });
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
  const worldExtras = populateWorld(sceneCtx, systemId, renderCtx.renderer);

  // Catalog Points picking — raycast resolves a Points-hit index back to the
  // CatalogStar record through this handle (single-click info panel).
  setCatalogPicking(worldExtras.catalogSystems);

  // Galaxy LAB panel — the in-game tuning surface, driven by the physical galaxy's control schema. Null under
  // ?proto-buildout (no physical galaxy) → the panel/button simply don't mount.
  initGalaxyLabPanel(worldExtras.physGalaxy?.controls ?? null);

  // Sector tour (Inc 6) — flag-gated node-to-node fly-through. __sectorTour.start() flies
  // the camera between the sector's systems in nearest-neighbour order (looping), so you
  // can watch the cloud thin/thicken as you travel. Targets are the systems' render-frame
  // positions (regional tier root + regionalScenePos), which flyTo rebases to absolute.
  if (worldExtras.protoSector) {
    const _tourRoot = new Vector3();
    const tourFlyTo = (sys: CuratedSystem, zoomLevel: number): void => {
      Broker.getTierRoot('regional', _tourRoot);
      const target = regionalScenePos(sys).add(_tourRoot);
      camCtrl.flyTo(target, { targetZoomLevel: zoomLevel });
    };
    let tourHandle: SectorTourHandle | null = null;
    (globalThis as Record<string, unknown>).__sectorTour = {
      start: () => {
        tourHandle?.stop();
        tourHandle = runSectorTour({
          systems: worldExtras.protoSector!.systems,
          flyTo: tourFlyTo,
          isFlying: () => camCtrl.flying,
        });
      },
      stop: () => { tourHandle?.stop(); tourHandle = null; },
    };
    console.info('[sector-proto] tour ready — call __sectorTour.start() to fly the sector node-to-node');
  }

  // ── 8b. Tab Cycling Through Bobs ──
  // Reads the LIVE system handle — bob entities are re-created on focus swaps
  // (Sol has none; cycling is a no-op there).
  let bobCycleIndex = -1;
  Events.on('camera:focus-bob', () => {
    const bobEids = getActiveSystemHandle()?.bobEids ?? [];
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

  // ── 8b-bis. Dev hooks (system focus) ──
  // __legionFocusSystem('Sol') mirrors double-clicking that curated marker
  // (select + focus + Stage-B lazy load); __legionActiveSystem() reports the
  // loaded local system id. Console-driven verification path.
  (globalThis as Record<string, unknown>).__legionFocusSystem = (name: string): boolean => {
    const idx = STAR_SYSTEMS.findIndex((s) => s.name.toLowerCase() === String(name).toLowerCase());
    if (idx < 0) return false;
    const eid = worldExtras.systemEids[idx];
    const marker = renderObjectMap.get(eid);
    if (!marker) return false;
    const wp = marker.getWorldPosition(new Vector3());
    Game.selectEntity(eid, marker.userData as Record<string, unknown>);
    SelectionPanels.open(marker.userData as TooltipData);
    Events.emit('camera:focus-on', { x: wp.x, y: wp.y, z: wp.z });
    Events.emit('camera:focus-object', { obj: marker });
    const loadable = loadableSystemId(marker.userData.name as string);
    if (loadable) requestSystemFocus(loadable);
    return true;
  };
  (globalThis as Record<string, unknown>).__legionActiveSystem = (): string | null =>
    getActiveSystemHandle()?.systemId ?? null;

  // ── 8c. Layer Visibility ──
  initVisibility(
    layers,
    worldExtras.eclipticGrid,
    worldExtras.oortCloud,
    worldExtras.galaxyArms,
    worldExtras.sectorOrb,
    worldExtras.catalogSystems,
    worldExtras.starShells,
  );

  // ── 8c-bis. Bake the Milky Way backdrop (one-shot, 256-step volume) ──
  // The sky as seen from this system, used as scene.background below the
  // sector tier (zero per-frame cost). Safe now: the volume marches the
  // CI-proven band-not-fog model (galaxy-density.test.ts).
  const galaxyBackdrop = bakeGalaxyBackdrop(renderCtx.renderer, scene, worldExtras.galaxyArms);

  // ── Black-hole set-piece (stellar-phenomena P6) ──────────────────────────
  // A physically-correct Schwarzschild geodesic renderer (real null-geodesic ray
  // tracing — horizon, photon ring, lensing, Novikov–Thorne disk with Doppler
  // beaming) placed as a rare galactic-tier hero object. Deterministic
  // galactocentric position; rides the floating origin via Broker.getResidual and
  // LODs to a clean point of light far out. Absolute scene-WU = (galPc −
  // HOME_GAL_PC)·WU_PER_PC, home at origin — so this sits ≈57 pc from home, just
  // off the disc plane. Lenses the baked Milky-Way cubemap. See
  // src/render/blackhole/ + docs/black-hole-simulation-research.md.
  const blackHole = createBlackHole({
    rsWorld: 12,
    absPos: new Vector3(46_000, 9_000, -32_000),
    background: galaxyBackdrop,
    diskOuter: 12,
    diskTempK: 13_000,
    diskBrightness: 1.2,
    diskNormal: new Vector3(0.3, 1, 0.15).normalize(),
  });
  scene.add(blackHole.group);
  // Backdrop display level: the bake composites the volume AND the baked star
  // particles (whose brightness uEmissionScale does not govern), so the
  // night-sky level is set here, once, display-side. Target: band core reads
  // dim-but-visible (~AgX toe) at normal system-tier exposure — invisible
  // against lit planets, present in sky-dominated framings.
  // Two backdrop sources (user-switchable, VP.photographicSky):
  //  • PHOTO  — NASA SVS Deep Star Maps 2020, galactic-coords equirect (real
  //    Milky Way; band lands on the XZ plane, galactic centre at the image
  //    centre → aligns with Legion's galactic frame). Brighter LDR ⇒ higher base.
  //  • ANALYTIC — the baked volume cube (positionally coherent with the live
  //    galaxy; the original behaviour). Dim HDR ⇒ tiny base.
  // 0.55 read far too bright (the LDR photo + auto-exposure opening up in
  // sky-dominated framings washed the frame). Halved to ~0.28 so the band is
  // dim-but-present; the user's 'Milky Way Backdrop' slider (VP.backdropIntensity,
  // default 1.0) still trims this at runtime.
  const PHOTO_INTENSITY = 0.28;
  const ANALYTIC_INTENSITY = 0.0025;
  let skyBase = ANALYTIC_INTENSITY;
  let skyTexReady = false;

  // Galactic-drift bookkeeping (loop step 6b): last clock the marker/entity
  // positions were derived for, + a reusable output (never aliased).
  let lastDriftAppliedMyr = 0;
  const driftScratch = { x: 0, y: 0, z: 0 };
  // The drift clock. Dev override: set __legionDriftMyr = <Myr> in the console
  // to preview the swirl (markers + disc share it); null/undefined = sim clock.
  const currentDriftMyr = (): number =>
    ((globalThis as Record<string, unknown>).__legionDriftMyr as number | undefined)
      ?? gameTimeToMyr(Game.data.gameTime);
  // Orientation: the photo's galactic centre (image centre) maps to +X. The
  // live analytic galaxy's Sgr A* sits toward −X (its model places home at +X,
  // centre at the origin), so a π yaw points the photo's bulge at Sgr A* and
  // makes the system→galaxy crossfade coherent. (Both disc planes are XZ, so a
  // pure yaw suffices.) NOTE: the HYG foreground catalogue uses the physically-
  // correct +X galactic centre, so it now differs from the backdrop+galaxy by
  // 180° — the live galaxy is the physically-misoriented one; the clean full
  // fix is to reorient the galaxy model to +X, after which this returns to 0.
  scene.backgroundRotation = new Euler(0, Math.PI, 0);
  const skyTex = new TextureLoader().load(asset('milkyway-galactic-4k.jpg'), (t) => {
    t.mapping = EquirectangularReflectionMapping;
    t.colorSpace = SRGBColorSpace;
    skyTexReady = true;
    applySky();
  });
  function applySky(): void {
    const photo = VP.get('photographicSky') && skyTexReady;
    scene.background = photo ? skyTex : galaxyBackdrop;
    skyBase = photo ? PHOTO_INTENSITY : ANALYTIC_INTENSITY;
  }
  scene.background = galaxyBackdrop; // until the photo loads (or if analytic chosen)
  scene.backgroundIntensity = skyBase;
  VP.subscribe((k) => { if (k === 'photographicSky') applySky(); });

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
  // Fixed-timestep simulation (Fiedler, gafferongames.com/post/fix_your_timestep)
  // decoupled from the variable render rate: the sim advances in FIXED_DT quanta
  // so physics/AI are deterministic and reproducible regardless of frame rate or
  // display refresh, while rendering and cosmetic shader clocks run per frame.
  const _localRoot = new Vector3();    // scratch: local-tier root (frame broker, 2c)
  const _sysAnchor = new Vector3();    // scratch: active-system anchor (system focus)
  const _regionalRoot = new Vector3(); // scratch: regional-tier root
  const _focusWU = new Vector3();      // scratch: camera focus, absolute scene-WU (Phase B streaming)
  const _focusGalPc = new Vector3();   // scratch: camera focus → galactocentric pc (Phase B streaming)
  const FIXED_DT = 1 / 60;   // simulation quantum, seconds of real time
  const MAX_FRAME = 0.25;    // clamp frame time to avoid the spiral of death
  const MAX_STEPS = 600;     // hard cap on catch-up steps per frame
  let lastTime = performance.now();
  let accumulator = 0;
  let wallClock = 0;         // monotonic real seconds; never time-warp scaled
  let simStep = 0;           // monotonic fixed-step index (command tick / determinism)
  let gpuStats: { update: () => void } | null = null;

  // Procedural planet globes (docs/procedural-worlds-plan.md P1/P2). Renders a
  // GENERATED system's planets as cube-sphere globes in the system tier. Mounted
  // into layers.local (true scale + floating origin inherited); gated behind
  // ?planetGlobes so the curated Sol view is untouched by default. The showcase
  // system covers every preset + a ringed gas giant for the browser check.
  const planetGlobes = new PlanetGlobes();
  if (new URLSearchParams(location.search).has('planetGlobes')) {
    planetGlobes.mount(showcaseSystem(), layers.local);
  }

  // One deterministic simulation tick.
  function stepSim(dt: number): void {
    const tc = Game.getTimeSpeed().tc;

    // Command tick = monotonic sim step (warp-independent, netcode-deterministic).
    setCommandTick(simStep);

    // Advance game time by one fixed quantum, scaled by time compression.
    if (tc > 0) Game.data.gameTime += dt * tc;

    // AI (staggered evaluation)
    updateAI({ world, gameTime: Game.data.gameTime, dt, timeCompression: tc });

    // ECS systems (orbital, velocity, transit, render-sync)
    const frameCtx: FrameContext = {
      dt,
      gameTime: Game.data.gameTime,
      timeCompression: tc,
      zoomLevel: Game.data.zoomLevel,
      renderMap: renderObjectMap,
    };
    runSystems(world, frameCtx);

    // Steering
    updateSteering(dt, tc);

    simStep++;
  }

  function gameLoop(): void {
    // Self-terminate if a newer boot has started (HMR stacking)
    if (myGen !== _hmr.bootGen) {
      console.warn(`[Legion] Stale game loop (gen ${myGen} vs ${_hmr.bootGen}), stopping`);
      return;
    }
    _hmr.animFrameId = requestAnimationFrame(gameLoop);

    const now = performance.now();
    const frameTime = Math.min((now - lastTime) / 1000, MAX_FRAME);
    lastTime = now;
    wallClock += frameTime;
    const shaderTime = wallClock % 1000; // bounded f32 clock for shader uniforms

    // 1. Fixed-timestep simulation catch-up
    accumulator += frameTime;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_STEPS) {
      stepSim(FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) accumulator = 0; // shed backlog after a long stall

    // 6. Camera (render-rate)
    camCtrl.update(frameTime);

    // 6a-bis. System focus (lazy system loading) — perform any pending local-
    // tier swap while the tier is imperceptible (hidden inside the zoom
    // transition), and refresh the active anchor from the marker's Position.
    updateSystemFocus();

    // 6b. Frame broker (scale-unification Phase 2b) — compute this frame's
    // floating-origin rebase R immediately AFTER the camera update and BEFORE
    // any world-space consumer, so every consumer sees one coherent R per frame
    // (the contract Phase 2c relies on). Then refresh the galaxy group position
    // + disc-volume AABB/origin from the broker. Under the 2b identity policy
    // R≡0, so both are constant (= today's values) — no visual change.
    Broker.beginFrame(Game.data.camFocusTarget ?? undefined);
    updateGalaxyFrame();

    // 6c. Re-root the LOCAL + REGIONAL tiers (and their loose furniture + the
    // star light) from the broker, mirroring the galactic tier. Under the
    // identity policy R≡0 these all write (0,0,0) — a no-op today — but this
    // completes the broker wiring (2b only wired the galactic tier) so 2c-0b's
    // origin flip translates every tier coherently, instead of yanking the
    // camera away while the system stays at absolute (0,0,0).
    Broker.getTierRoot('local', _localRoot);
    // Active-system anchor: the local tier renders the FOCUSED system at its
    // regional marker position (home ⇒ (0,0,0) — byte-identical default).
    // Every downstream _localRoot consumer (layers.local, star light, oort,
    // grid, reference ring, lens flare) follows the same anchored root.
    getActiveAnchor(_sysAnchor);
    _localRoot.add(_sysAnchor);
    layers.local.position.copy(_localRoot);
    starLight.position.copy(_localRoot);
    worldExtras.oortCloud.position.copy(_localRoot);
    worldExtras.eclipticGrid.position.copy(_localRoot);
    // Scale-unification U2: render the system geometry (authored at AU_TO_WU=10)
    // at TRUE scale in the unified frame. Uniform group scale carries positions,
    // meshes, moons, comets, belt and heliopause together, so the zoomed-in view
    // is unchanged while the system occupies its real (tiny) size among the
    // catalogue stars. camDist is scaled in lock-step (state.getCamDist).
    layers.local.scale.setScalar(SYSTEM_TIER_SCALE);
    worldExtras.oortCloud.scale.setScalar(SYSTEM_TIER_SCALE);
    worldExtras.eclipticGrid.scale.setScalar(SYSTEM_TIER_SCALE);
    Broker.getTierRoot('regional', _regionalRoot);
    layers.regional.position.copy(_regionalRoot);
    worldExtras.sectorOrb.position.copy(_regionalRoot);
    // Catalog star layer sits on sceneRoot (cross-tier crossfade) but its
    // positions are regional-frame — ride the same tier root.
    worldExtras.catalogSystems.group.position.copy(_regionalRoot);
    worldExtras.starShells.group.position.copy(_regionalRoot);
    updateSectorPrototype(Game.data.camDist); // sector-cloud prototype: re-root + gate cloud (no-op if off)
    if (worldExtras.sectorMgr) {
      // Phase 5a: stream only at the neighbourhood tier and out — the sector
      // stars sit ≥25pc away (far = camDist·100 must reach them), so below this
      // the work is skipped and the group hidden, keeping the system tier free.
      // The per-sector/region star GENERATOR grid is retired to a toggle (it read
      // as a hard square; star-shells carry the visual). When off, skip all
      // generation entirely — no residency, no draws, no cost.
      const streamOn = VP.get('sectorStarsEnabled') && Game.data.camDist > SECTOR_STREAM_MIN_CAMDIST;
      worldExtras.sectorMgr.group.visible = streamOn;
      if (worldExtras.regionMgr) worldExtras.regionMgr.group.visible = streamOn;
      if (streamOn) {
        // Stream sectors around the camera's FOCUS cell (camFocusTarget is absolute scene-WU).
        const f = Game.data.camFocusTarget;
        _focusWU.set(f?.x ?? 0, f?.y ?? 0, f?.z ?? 0);
        const focusGalPc = absWUToGalPc(_focusWU, _focusGalPc);
        if (worldExtras.regionMgr) {
          // Region manager drives the near sector streaming AND renders the merged mid-field fill.
          updateRegionManager(worldExtras.regionMgr, worldExtras.sectorMgr, focusGalPc, Game.data.camDist);
        } else {
          updateSectorManager(worldExtras.sectorMgr, focusGalPc, Game.data.camDist);
        }
      }
    }
    if (worldExtras.sectorFill) updateSectorFill(worldExtras.sectorFill); // capped corridor fill
    if (worldExtras.galaxyBuildout) updateGalaxyBuildout(worldExtras.galaxyBuildout); // full-galaxy fill
    if (worldExtras.physGalaxy) {
      // Show the physical disc only near galaxy scale (crossfade > 0), so it never draws over the system/surface
      // tiers; when shown, ride the galactic-tier floating origin and advance the star/gas/dust motion, then
      // render the gas alone through the blur (offscreen) and hand it to the post chain to composite this frame.
      const discXf = getGalaxyCrossfade(Game.data.camDist);
      const showDisc = discXf > 0;
      worldExtras.physGalaxy.root.visible = showDisc;
      postCtx.setGalaxyOverlays(showDisc); // prominent-stars + dust-last passes (rendered over the gas)
      if (showDisc) {
        // Fade the disc in along the same crossfade the sky hand-off uses, so
        // it materialises across the pull-back instead of popping in formed.
        worldExtras.physGalaxy.setPresence(discXf);
        worldExtras.physGalaxy.root.position.copy(getGalaxyOffset());
        // Pass the sim's galactic-drift clock so the disc's differential rotation
        // and the drifting system markers stay on ONE clock (LAB warp adds a
        // preview offset on top inside update()).
        worldExtras.physGalaxy.update(
          camera, frameTime, Game.data.camDist > 1e6, currentDriftMyr(),
        );
        const gb = worldExtras.physGalaxy.renderGasBlur(renderCtx.renderer, scene, camera);
        postCtx.setGasBlur(gb?.texture ?? null, gb?.gain ?? 1);
      } else {
        postCtx.setGasBlur(null, 1);
      }
    }

    // 6b. Galactic drift — systems orbit Sgr A* (core/galactic-drift). Epoch
    // positions are re-derived from the sim clock; gated to DRIFT_MIN_STEP_MYR
    // (100 game-years) so this is a no-op at normal time compression. Circular
    // orbits keep y fixed, so marker stems stay valid. The star-graph links are
    // NOT rebuilt (drift is sub-link-width for any realistic session).
    {
      const driftMyr = currentDriftMyr();
      if (Math.abs(driftMyr - lastDriftAppliedMyr) >= DRIFT_MIN_STEP_MYR) {
        lastDriftAppliedMyr = driftMyr;
        // Curated systems: write the ECS Position; renderSync moves the markers.
        for (let i = 0; i < worldExtras.systemEids.length; i++) {
          const eid = worldExtras.systemEids[i];
          driftedRegionalScenePos(CURATED_SYSTEMS[i].solPc, driftMyr, driftScratch);
          Position.x[eid] = driftScratch.x;
          Position.y[eid] = driftScratch.y;
          Position.z[eid] = driftScratch.z;
        }
        // Galactic-tier system markers: absolute galactocentric swing.
        const pcToWuNative = KPC_TO_WU / 1000;
        worldExtras.galaxyArms.traverse((obj) => {
          const sys = obj.userData as { type?: string; solPc?: { x: number; y: number; z: number } };
          if (sys.type !== 'gal_system' || !sys.solPc) return;
          driftGalPc(
            SOL_GAL_PC.x + sys.solPc.x, SOL_GAL_PC.y + sys.solPc.y, SOL_GAL_PC.z + sys.solPc.z,
            driftMyr, driftScratch,
          );
          obj.position.set(
            driftScratch.x * pcToWuNative, driftScratch.y * pcToWuNative, driftScratch.z * pcToWuNative,
          );
          (obj.userData as { _pos?: Vector3 })._pos?.copy(obj.position);
        });
      }
      worldExtras.catalogSystems.updateDrift(driftMyr); // gated internally
    }

    // 7. Audio
    Audio.updateMix(frameTime);
    Ambience.update(frameTime);

    // 8. FPS tracking
    Game.data.fps = Math.round(1 / Math.max(frameTime, 0.001));

    // 8b. Step controls (zoom bar sync)
    updateStepControlsFrame();

    // 8c. HUD (domain label, time display, game clock, status)
    updateHUD();

    // 8d. Layer visibility per zoom tier (+ screen-space label declutter)
    updateVisibility(camera);

    // 8d-i. Reference scale ring (labelled radius on the plane)
    updateReferenceRing(Game.data.zoomDomain, Game.data.camDist, _localRoot);

    // 8d-bis. Sky crossfade (Phase 4): baked-cube intensity fades OUT across
    // camDist 2000→3000 WU exactly as the live volume's uOpacity fades IN
    // (updateGalaxyLOD) — two representations of the same medium handing off,
    // no hard switch, no pop. At sector+ the cube is black (intensity 0).
    scene.backgroundIntensity =
      skyBase * VP.get('backdropIntensity') * (1 - getGalaxyCrossfade(Game.data.camDist));

    // 8e. Selection panels (connection line + production queue tick)
    SelectionPanels.drawConnection(camera);
    if (!Game.data.paused) SelectionPanels.tickQueue(frameTime);

    // 9. Star shader update — procedural star (S1–S2) rendered from the active
    // system's physical record (src/render/star). While it is driving the
    // active star it REPLACES the legacy sun mesh (hides the sun-system
    // subgroup); the legacy updater runs only as a fallback when no procedural
    // star is installed (e.g. no local system).
    if (!updateSystemStar(getActiveSystemHandle()?.groups, frameTime, camera, Game.data.camDist)) {
      updateSunSystem(renderCtx.renderer, frameTime);
    }

    // 9b. Planet shader update (sun direction, rotation, storms, non-focused planet culling)
    // Always pass a focus target so angular culling knows which planet to keep visible.
    // Default to origin (star) when no entity is selected.
    const focusTarget = Game.data.camFocusTarget ?? { x: 0, y: 0, z: 0 };
    updatePlanetShaders(Game.data.gameTime, shaderTime, camera.position, focusTarget, Game.data.zoomDomain);

    // 9b-bis. Procedural planet globes (P1/P2). The star sits at the local-tier
    // root, so it IS each planet's sun position. Refresh world matrices first so
    // LOD reads this frame's floating-origin placement, not last frame's.
    if (planetGlobes.count > 0) {
      camera.updateMatrixWorld();
      layers.local.updateWorldMatrix(true, true);
      planetGlobes.update({
        camera, sunWorldPos: _localRoot, dt: frameTime,
        fovYRad: (camera.fov * Math.PI) / 180, viewportH: window.innerHeight,
      });
    }

    // 9c. Lens flare update (star position → screen space)
    // Star world position = the local-tier root (the sun sits at the local-tier
    // origin), so the flare stays glued to the sun once the floating origin floats.
    lensFlare.update(_localRoot, camera, frameTime);

    // 9d. Galaxy animations (dashed lines, chevron pulses) — bounded shader clock
    updateGalaxyAnimations(shaderTime);

    // 9e. Galaxy LOD — fades local-arm detail / dust / nebula presence
    // by current camera distance so each zoom tier has the right density.
    updateGalaxyLOD(Game.data.camDist);

    // 9e-bis. Screen-constant sizing for galaxy markers/labels/Sgr A* — they
    // ride the ×GALAXY_MODEL_SCALE group, so without this they balloon ×3003.
    updateGalaxyMarkerScale(camera);

    // 9f. Velocity-aware micro-streak on galactic stars. Gated below
    // ~6000 WU/s — invisible during normal orbiting/zooming; ramps in
    // only during high-speed translation (flight-path traversals).
    updateStarStreaks(camCtrl.velocity);

    // 9g. Black-hole set-piece — trace the geodesic into its half-res target and
    // LOD by distance. Runs after the broker/camera update (so its residual is
    // current) and before the post chain (which composites the billboard). Rides
    // the galactic tier's floating origin like the streamed sectors.
    blackHole.update(renderCtx.renderer, camera, renderCtx.renderer.domElement.height);

    // 10. Render (post-processing pipeline) — bounded shader clock
    postCtx.render(shaderTime);

    // 10b. GPU/CPU profiling overlay (opt-in: dev, or ?stats on the live demo)
    if (gpuStats) {
      gpuStats.update();
      renderCtx.renderer.info.reset();
    }

    // 11. Debug
    Debug.update(frameTime);
  }

  // ── Profiling baseline (stats-gl): GPU ms via EXT_disjoint_timer_query_webgl2.
  // Opt-in so the live demo stays clean: enabled in dev or with ?stats in the URL.
  const showStats =
    import.meta.env.DEV || new URLSearchParams(location.search).has('stats');
  if (showStats) {
    try {
      const { default: Stats } = await import('stats-gl');
      const stats = new Stats({ trackGPU: true });
      await stats.init(renderCtx.renderer);
      document.body.appendChild(stats.dom);
      renderCtx.renderer.info.autoReset = false; // reset once per frame in the loop
      gpuStats = stats;
    } catch (err) {
      console.warn('[Legion] stats-gl unavailable:', err);
    }
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
  /** Boot-time local-system handle; the LIVE handle after focus swaps is
   *  getActiveSystemHandle() (system-loader.ts). */
  activeSystem: LocalSystemHandle;
  protoSector: import('./render/sector/sector').Sector | null;
  sectorMgr: SectorManager | null;
  regionMgr: RegionManager | null;
  sectorFill: SectorFill | null;
  galaxyBuildout: GalaxyBuildout | null;
  physGalaxy: PhysicalGalaxySystem | null;
  catalogSystems: CatalogSystemsHandle;
  starShells: StarShellsHandle;
  /** Curated-system entity ids, index-aligned with CURATED_SYSTEMS (drift). */
  systemEids: number[];
}

function populateWorld(ctx: SceneContext, systemId: 'ee' | 'sol', renderer: import('three').WebGLRenderer): WorldExtras {
  // Phase 2b: loose top-level objects (oort/grid/ring/galaxy/sector-orb) ride
  // sceneRoot, not the bare scene, so the frame broker can re-root them in 2c.
  const { sceneRoot, layers, renderObjectMap } = ctx;

  // ── Local system (star / planets / moons / stations / bobs / comets /
  // belt / heliopause) — extracted to system-loader.ts so focus swaps can
  // dispose + re-instantiate the local tier at runtime (lazy system loading).
  const activeSystem = instantiateLocalSystem(ctx, systemId, renderer);

  // ── Star System Markers (Regional View) ──
  const systemEids: number[] = [];
  for (const sCfg of STAR_SYSTEMS) {
    const eid = createSystemEntity(sCfg);
    systemEids.push(eid);

    const marker = createSystemMarker(
      sCfg.name, sCfg.color, sCfg.hasBobs, sCfg.isHome,
      sCfg.distanceLy, sCfg.planetCount, sCfg.bobCount, sCfg.explored,
    );

    // TRUE-GEOMETRY local map (scale-unification Phase 1): sCfg.x/y/z are real
    // regional scene-WU coordinates from the canonical CURATED_SYSTEMS record —
    // each system's actual heliocentric offset from home (ε Eridani at the
    // origin), re-pinned from the 25-pc HYG catalogue. Place directly; the
    // entity Position carries the identical value, so the marker, the
    // render-sync, and the star-graph all agree on real relative ranges.
    marker.position.set(sCfg.x, sCfg.y, sCfg.z);
    // Marker group stays unit-scale; the icon is sized SCREEN-CONSTANT per frame
    // by visibility.ts (updateRegionalMarkers → scaleFixed), fixing the old
    // grow/shrink-with-scene defect (G8) from marker.scale.setScalar(450).

    // Out-of-plane stem: drops to the reference plane (y=0) so the marker's
    // height above/below the plane reads at a glance (Solar-System-Scope style).
    marker.add(createMarkerStem(marker.position.y, sCfg.color));

    layers.regional.add(marker);
    registerRenderObject(renderObjectMap, eid, marker);
  }

  // ── Cosmic Objects (nebulae / megastructures — placeholder) ──
  // Same distance-accurate placement + marker pipeline as the star systems;
  // each carries its own glyph/colour/label and an out-of-plane stem.
  for (const cfg of COSMIC_OBJECTS) {
    const marker = createCosmicMarker(cfg);
    const dir = new Vector3(cfg.x, cfg.y, cfg.z);
    if (dir.lengthSq() > 1e-6) {
      marker.position.copy(dir.normalize().multiplyScalar(cfg.distLy * LY_TO_WU)); // matches systems (unified)
    }
    marker.add(createMarkerStem(marker.position.y, cfg.color));
    layers.regional.add(marker);
  }

  // Link range defaults to NAV_LINK_WU (14 ly in the regional WU frame) — the
  // entity Positions are now real regional scene-WU coords, so the old fictional
  // "15"-unit threshold would yield ZERO edges (closest pair is ~352 WU apart).
  buildStarGraph(systemEids);

  // ── System-focus manager (lazy system loading) ──
  // Stage B swaps need the scene ctx + the curated marker entities (the swap
  // anchor rides the marker's ECS Position, so it follows galactic drift).
  initSystemFocus({
    ctx,
    renderer,
    markerEidFor: (id: LoadableSystemId): number | null => {
      const name = id === 'sol' ? 'Sol' : 'Epsilon Eridani';
      const idx = STAR_SYSTEMS.findIndex((s) => s.name === name);
      return idx >= 0 ? systemEids[idx] ?? null : null;
    },
  }, activeSystem);

  // ── Catalog systems — the full real 25-pc neighbourhood ──
  // Every HYG star (~3k) at its TRUE 3D position in the regional frame,
  // filling the space between the curated markers. Loads async. Mounted on
  // sceneRoot (NOT layers.regional) so it escapes the regional tier's hard
  // visibility gate: visibility.ts drives its uOpacity continuously across
  // every zoom level instead. It still rides the regional tier root — the
  // game loop copies _regionalRoot onto the group each frame (floating origin).
  const catalogSystems = createCatalogSystems();
  sceneRoot.add(catalogSystems.group);

  // ── Star shells — progressive LOD annuli bridging the survey sphere to the
  // galaxy disc (density-field-sampled; crossfaded per camDist by visibility).
  const starShells = createStarShells();
  sceneRoot.add(starShells.group);
  (globalThis as Record<string, unknown>).__catalogSystems = catalogSystems;

  // ── Background ──
  // (Legacy createMilkyWay band deleted: the system-tier Milky Way is now the
  // positionally-coherent baked cubemap of the real galaxy model — main boot.)
  // The REAL sky — 24.9k HYG-catalogue stars at their true galactic directions
  // (real constellations), magnitude-sized, B−V-coloured. Replaces the old
  // random fictional shell. Loads its packed binary asynchronously.
  layers.background.add(createCatalogStars());

  // ── Oort Cloud (visible at heliopause+) ──
  const oortCloud = createOortCloud();
  sceneRoot.add(oortCloud);

  // ── Ecliptic Grid (visible at system+, strategic overlay) ──
  const eclipticGrid = createEclipticGrid();
  sceneRoot.add(eclipticGrid);

  // ── Reference Ring (labelled scale ring on the plane) ──
  sceneRoot.add(createReferenceRing());

  // ── Galaxy (visible at arm/galaxy tiers) ──
  const galaxyGroup = createGalaxy();
  // Galactic-frame catalog representation: the same 3,066 real stars as
  // highlight particles in the galaxy group's native frame (rides its
  // rotation + ×GALAXY_MODEL_SCALE lift + tier visibility, exactly like the
  // curated gal_system markers). Crossfaded against the regional chart by
  // visibility.ts, so the space-agency layer persists at arm/galaxy framing.
  galaxyGroup.add(catalogSystems.galacticGroup);
  galaxyGroup.position.copy(getGalaxyOffset());
  sceneRoot.add(galaxyGroup);

  // Sector-cloud prototype (Inc 1) — flag-gated (?proto-sector), null when off.
  const protoSector = createSectorPrototype();
  if (protoSector) sceneRoot.add(protoSector.group);

  // Phase B sector STREAMING (Inc B1) — flag-gated. Streams a sparse hash of sectors around the
  // camera's galactic cell; one live cloud + N resident star fields. ?proto-regions adds the 1 kpc
  // region/LOD scheduling layer ABOVE it (Inc 2) — it needs a sector manager to drive, so either
  // flag creates one; ?proto-regions also creates the region manager.
  const params = new URLSearchParams(location.search);
  const fillOn = params.has('proto-fill');
  // Phase 5a: the streamed sector particles are now the DEFAULT neighbourhood
  // fill (they carry the dive from the ≤25pc catalogue out toward the galaxy
  // volume, replacing the legacy star-shells). Always created; the game loop
  // gates streaming to the neighbourhood tier so the system tier stays cheap.
  const sectorMgr = createSectorManager(sceneRoot);
  {
    (globalThis as Record<string, unknown>).__sectorMgr = sectorMgr;
    (globalThis as Record<string, unknown>).__armDebug = (on = true) => setArmDebug(Boolean(on));
  }
  // Phase 5a: the region manager is now the DEFAULT mid-field fill — it drives the near sector
  // streaming AND renders one merged Points of coarse procedural stars per resident 1 kpc region
  // (de-duped against the near sectors), bridging the ≤25pc catalogue → near sectors → mid-field →
  // galaxy volume dive. Gated to the neighbourhood tier by the game loop (same as the sector stream).
  const regionMgr = createRegionManager(sceneRoot);
  {
    (globalThis as Record<string, unknown>).__regionMgr = regionMgr;
    (globalThis as Record<string, unknown>).__regionTelemetry = () => regionTelemetry(regionMgr);
  }

  // Galaxy-FILL stress pass (?proto-fill) — pre-generates a corridor of sectors from home to the
  // galactic core, kept resident (the deliberate stress + the impostor measurement gate + the
  // dramatic-core-cloud setup). Generation is capped per frame so it never hard-hangs.
  const sectorFill = fillOn ? createSectorFill(sceneRoot, HOME_GAL_PC.clone(), new Vector3(0, 0, 0)) : null;
  if (sectorFill) {
    (globalThis as Record<string, unknown>).__fill = sectorFill;
    (globalThis as Record<string, unknown>).__fillStatus = () => fillStatus(sectorFill);
    console.info(`[sector-fill] filling ${sectorFill.queue.length} sectors home→core — __fillStatus() for progress`);
  }

  // LEGACY full-galaxy build-out (?proto-buildout) — the whole disc rendered as region-merged sector stars,
  // with the disc emission visual disabled for performance. Superseded by the physical galaxy below; kept
  // reachable for comparison. Enumerates synchronously at boot (~1s).
  const galaxyBuildout = params.has('proto-buildout') ? createGalaxyBuildout(sceneRoot) : null;
  if (galaxyBuildout) {
    setDiscVisual(false);
    (globalThis as Record<string, unknown>).__buildout = galaxyBuildout;
    (globalThis as Record<string, unknown>).__buildoutStatus = () => buildoutStatus(galaxyBuildout);
    console.info(`[galaxy-buildout] ${galaxyBuildout.enumeration.cells.length} cells / ${galaxyBuildout.queue.length} regions — disc disabled; __buildoutStatus()`);
  }

  // PHYSICAL GALAXY (?proto-galaxy) — the globally-sampled density-wave galaxy (stars + dust + raymarched
  // gas) as the in-game galaxy visual, replacing the legacy raymarched disc. Its root rides the galactic-
  // tier floating origin (re-rooted each frame in the loop), at scale 1.0 since the physical positions are
  // ALREADY in the unified frame (1 kpc = 1e6 WU) — no ×GALAXY_MODEL_SCALE. The full tuning panel rides
  // along so the look can keep being refined in-context.
  // PHYSICAL GALAXY — the DEFAULT in-game disc visual (no flag needed). At construction createPhysicalGalaxy
  // applies the committed SAVED_GALAXY_DEFAULTS preset then overlays any per-browser Saved look from localStorage,
  // so tuning in the LAB panel persists across refreshes AND dev-server restarts (localStorage is origin-keyed),
  // while a promoted preset ships canonically. ?proto-buildout opts OUT (that legacy comparison owns the disc
  // view). The legacy createGalaxy() stays untouched (sky-cube bake source + Sgr A* + system markers + grid +
  // labels); setDiscVisual(false) hides only its disc EMISSION. Pass the renderer so update() keeps the gas
  // puffs' uViewportH in sync on resize. The tuning surface is the in-game LAB panel (initGalaxyLabPanel).
  const physGalaxy = params.has('proto-buildout')
    ? null
    : createPhysicalGalaxy({ renderer });
  if (physGalaxy) {
    physGalaxy.root.position.copy(getGalaxyOffset()); // galactic-tier centre; re-rooted per frame in the loop
    sceneRoot.add(physGalaxy.root);
    setDiscVisual(false); // the physical galaxy IS the disc visual now (legacy disc emission hidden)
    (globalThis as Record<string, unknown>).__physGalaxy = physGalaxy;
    console.info('[galaxy] physical galaxy = default disc (canonical preset + localStorage override; tune via LAB)');
  }

  // ── Sector orb (Homeworld-style sensor bubble, visible at sector tier) ──
  // Sits at the home origin in scene space; visibility system shows/hides
  // it per zoom domain.
  // Sector orb radius matches the regional-system spread — encloses the
  // ~16 nearest navigable systems comfortably. Phase 2c-1 Inc 6: the
  // neighbourhood now rides the unified metric (1 ly = LY_TO_WU ≈ 306.6 WU), so
  // the farthest (Ross 154, ~17.6 ly) sits at ~5400 WU; a ~19 ly sensor radius
  // keeps the whole bubble enclosed (was 4200 WU at the retired 220 WU/ly).
  const sectorOrb = createSectorOrb(19.1 * LY_TO_WU);
  sceneRoot.add(sectorOrb);

  return { eclipticGrid, oortCloud, galaxyArms: galaxyGroup, sectorOrb, activeSystem, protoSector, sectorMgr, regionMgr, sectorFill, galaxyBuildout, physGalaxy, catalogSystems, starShells, systemEids };
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
