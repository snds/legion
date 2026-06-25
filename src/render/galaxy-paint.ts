// ═══════════════════════════════════════════════════════════════════
// GALAXY PAINT — the independent painting-tool shell (Phase 1a: shell + free-fly camera).
//
// A standalone ?paint-mode boot that shows ONLY the full-galaxy build-out (no system-tier streaming,
// no progressive zoom) so the galaxy can be treated as a 3D painting surface. The floating-origin
// rebase R is PINNED at the galactic centre, which parks the whole galaxy at the scene origin (a
// region at galPc renders at galPc·WU_PER_PC) — float32 at ±15 kpc is ~1 WU ≈ sub-pc, ample for the
// overview — so a plain orbit/dolly/pan camera flies around it with no per-frame origin juggling.
//
// Phase 1b layers the screen→galactocentric raycast, the density brush, the op-list, and the
// per-region re-bake on top of this shell.
// ═══════════════════════════════════════════════════════════════════

import { Group, MathUtils, PerspectiveCamera, Scene, Vector3 } from 'three';
import { WU_PER_PC } from '../core/metrics';
import { Broker } from './scale-manager';
import { HOME_GAL_PC } from './sector/sector';
import {
  createGalaxyBuildout, disposeGalaxyBuildout, updateGalaxyBuildout, type GalaxyBuildout,
} from './sector/galaxy-buildout';
import type { RendererContext } from './renderer';

/** A turntable free-fly camera: drag = orbit, shift/middle-drag = pan the focus, wheel = dolly.
 *  Operates in scene space (the galaxy is centred at the origin via the pinned rebase). */
export class OrbitFlyCamera {
  /** Scene-space orbit centre (starts at the galaxy centre = origin); pan moves it = "fly". */
  readonly target = new Vector3(0, 0, 0);
  distance: number;
  azimuth = 0;          // rad, around +Y
  elevation = 0.5;      // rad above the disc plane (~28°)

  private mode: 'orbit' | 'pan' | null = null;
  private lastX = 0;
  private lastY = 0;
  private readonly _off = new Vector3();
  private readonly _right = new Vector3();
  private readonly _up = new Vector3();
  private readonly cleanup: Array<() => void> = [];

  constructor(readonly cam: PerspectiveCamera, el: HTMLElement, initialDistance: number) {
    this.distance = initialDistance;
    const onDown = (e: PointerEvent): void => {
      this.mode = e.shiftKey || e.button === 1 ? 'pan' : 'orbit';
      this.lastX = e.clientX; this.lastY = e.clientY;
      el.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent): void => {
      if (!this.mode) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX; this.lastY = e.clientY;
      if (this.mode === 'orbit') {
        this.azimuth -= dx * 0.005;
        this.elevation = MathUtils.clamp(this.elevation + dy * 0.005, -1.5, 1.5);
      } else {
        this.cam.updateMatrixWorld();
        this.cam.matrixWorld.extractBasis(this._right, this._up, this._off);
        const s = this.distance * 0.0015; // pan speed scales with zoom
        this.target.addScaledVector(this._right, -dx * s).addScaledVector(this._up, dy * s);
      }
    };
    const onUp = (e: PointerEvent): void => { this.mode = null; el.releasePointerCapture?.(e.pointerId); };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      this.distance = MathUtils.clamp(this.distance * Math.exp(e.deltaY * 0.001), 1e5, 2e8);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    this.cleanup.push(
      () => el.removeEventListener('pointerdown', onDown),
      () => el.removeEventListener('pointermove', onMove),
      () => window.removeEventListener('pointerup', onUp),
      () => el.removeEventListener('wheel', onWheel),
    );
  }

  update(): void {
    // spherical: phi from +Y, so elevation 0 = edge-on (in the X-Z disc plane), π/2 = top-down.
    this._off.setFromSphericalCoords(this.distance, Math.PI / 2 - this.elevation, this.azimuth);
    this.cam.position.copy(this.target).add(this._off);
    this.cam.lookAt(this.target);
  }

  dispose(): void { for (const fn of this.cleanup) fn(); }
}

export interface GalaxyPaint {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly cam: OrbitFlyCamera;
  readonly buildout: GalaxyBuildout;
}

/** Boot the standalone paint shell. `shouldRun` (the boot-gen check) lets the loop self-terminate +
 *  clean up on HMR/reload, mirroring the main engine's generation guard. */
export function bootGalaxyPaint(renderCtx: RendererContext, shouldRun: () => boolean): GalaxyPaint {
  const scene = new Scene();
  const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 100, 2e8);
  const root = new Group();
  root.name = 'paint-root';
  scene.add(root);

  const buildout = createGalaxyBuildout(root);
  const cam = new OrbitFlyCamera(camera, renderCtx.canvas, 3.5e7); // frames the ~30 kpc disc

  // Pin the floating-origin rebase at the galactic centre → the galaxy sits centred at the scene
  // origin (a region at galPc renders at galPc·WU_PER_PC). Fixed, so the orbit camera is plain.
  const galacticCentreAbs = new Vector3().copy(HOME_GAL_PC).multiplyScalar(-WU_PER_PC);

  const onResize = (): void => {
    renderCtx.renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);
  onResize();

  // Hide the main-engine HUD chrome — this standalone tool reuses the page but shows only the galaxy.
  for (const id of ['hud', 'dot-grid', 'hover-tip', 'dest-mode-indicator']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  const paint: GalaxyPaint = { scene, camera, cam, buildout };
  (globalThis as Record<string, unknown>).__paint = paint;
  console.info(`[galaxy-paint] paint mode — ${buildout.queue.length} regions queued; drag=orbit, shift-drag=pan, wheel=dolly`);

  function loop(): void {
    if (!shouldRun()) {
      cam.dispose();
      window.removeEventListener('resize', onResize);
      disposeGalaxyBuildout(buildout);
      return;
    }
    requestAnimationFrame(loop);
    Broker.setRebase(galacticCentreAbs); // R fixed at the galactic centre
    cam.update();
    updateGalaxyBuildout(buildout, 4);
    renderCtx.renderer.render(scene, camera);
  }
  loop();

  return paint;
}
