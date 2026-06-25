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

import {
  Group, MathUtils, PerspectiveCamera, Plane, Raycaster, Scene, Vector2, Vector3,
} from 'three';
import { WU_PER_PC } from '../core/metrics';
import { Broker } from './scale-manager';
import { HOME_GAL_PC } from './sector/sector';
import {
  createGalaxyBuildout, disposeGalaxyBuildout, regenerateRegion, updateGalaxyBuildout,
  type GalaxyBuildout,
} from './sector/galaxy-buildout';
import { applyStroke, rebuildEditState, type BrushStroke } from './galaxy-paint-ops';
import { PointerSource } from './paint-input';
import type { RendererContext } from './renderer';

/** Density brush: a paint pointer (pen, touch, or LEFT mouse) drags stamps along the galactic plane
 *  (scene y=0 ↔ galactocentric y=0). Input arrives already normalized as BrushSamples from PointerSource,
 *  so pen / touch / mouse are one path and each sample carries pressure + tilt for Phase 2b/2f. Off-plane
 *  depth is a later mode; here every stamp lands on the plane. Emits a BrushStroke on release. */
export class PaintBrush {
  radiusPc = 1500;
  intensity = 0.8;
  private path: Array<[number, number, number]> = [];
  private readonly raycaster = new Raycaster();
  private readonly plane = new Plane(new Vector3(0, 1, 0), 0); // scene y=0 = the galactic mid-plane
  private readonly _ndc = new Vector2();
  private readonly _hit = new Vector3();
  private readonly source: PointerSource;

  constructor(cam: PerspectiveCamera, el: HTMLCanvasElement, onStroke: (s: BrushStroke) => void) {
    // Raycast a canvas-relative CSS-px point (already rect-corrected by PointerSource) onto the plane.
    const push = (sx: number, sy: number): void => {
      const rect = el.getBoundingClientRect();
      this._ndc.set((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(this._ndc, cam);
      if (this.raycaster.ray.intersectPlane(this.plane, this._hit)) {
        this.path.push([this._hit.x / WU_PER_PC, this._hit.y / WU_PER_PC, this._hit.z / WU_PER_PC]);
      }
    };
    // Phase 2a: passthrough (no coalesce / resample / stabilize) ⇒ byte-identical to the old mouse path.
    this.source = new PointerSource(el, {}, {
      onStrokeBegin: (s) => { this.path = []; push(s.x, s.y); },
      onStrokeSample: (s) => push(s.x, s.y),
      onStrokeEnd: () => {
        if (this.path.length) onStroke({ brushType: 'density-add', path: this.path, radiusPc: this.radiusPc, intensity: this.intensity });
      },
      onStrokeCancel: () => { this.path = []; },
    });
  }

  dispose(): void { this.source.dispose(); }
}

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
      if (e.button === 0) return; // LEFT is the brush — the camera navigates on RIGHT / MIDDLE
      this.mode = e.shiftKey || e.button === 1 ? 'pan' : 'orbit';
      this.lastX = e.clientX; this.lastY = e.clientY;
    };
    const onCtx = (e: Event): void => e.preventDefault(); // right-drag orbit shouldn't open the menu
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
    const onUp = (): void => { this.mode = null; };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      this.distance = MathUtils.clamp(this.distance * Math.exp(e.deltaY * 0.001), 1e5, 2e8);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onCtx);
    this.cleanup.push(
      () => el.removeEventListener('pointerdown', onDown),
      () => el.removeEventListener('pointermove', onMove),
      () => window.removeEventListener('pointerup', onUp),
      () => el.removeEventListener('wheel', onWheel),
      () => el.removeEventListener('contextmenu', onCtx),
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
  readonly brush: PaintBrush;
  readonly undo: () => void;
  readonly opList: Array<{ stroke: BrushStroke; dirty: Set<string> }>;
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

  // ── The non-destructive paint loop: stroke → op-list → edit field → per-region re-bake ──
  const opList: Array<{ stroke: BrushStroke; dirty: Set<string> }> = [];
  const cells = buildout.enumeration.cells;
  let onStatus: (() => void) | null = null; // wired by the HUD below
  const onStroke = (stroke: BrushStroke): void => {
    const dirty = applyStroke(stroke, buildout.editState, cells);
    opList.push({ stroke, dirty });
    for (const rk of dirty) regenerateRegion(buildout, rk);
    onStatus?.();
  };
  const undo = (): void => {
    const last = opList.pop();
    if (!last) return;
    const rebuilt = rebuildEditState(opList.map((o) => o.stroke), cells);
    buildout.editState = rebuilt.editState;        // the op-list is canonical; rebuild the field from it
    for (const rk of last.dirty) regenerateRegion(buildout, rk); // re-bake exactly what the stroke touched
    onStatus?.();
  };
  const brush = new PaintBrush(camera, renderCtx.canvas, onStroke);

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

  // ── Minimal vanilla-DOM HUD (Photoshop-style panel arrives in Phase 8) ──
  const hud = document.createElement('div');
  hud.id = 'paint-hud';
  hud.style.cssText = 'position:fixed;top:14px;left:14px;z-index:100000;width:210px;padding:12px 14px;'
    + 'background:rgba(12,15,20,0.88);border:1px solid #2a3340;border-radius:8px;color:#cfd8e3;'
    + 'font:12px/1.7 ui-monospace,SFMono-Regular,monospace;letter-spacing:0.02em;user-select:none';
  hud.innerHTML = `
    <div style="font-weight:600;letter-spacing:0.08em;margin-bottom:10px;color:#eaf0f7">GALAXY&nbsp;PAINT</div>
    <div>Brush radius&nbsp;<span id="pp-rv">1500</span>&nbsp;pc</div>
    <input id="pp-r" type="range" min="250" max="6000" step="50" value="1500" style="width:100%;accent-color:#6aa3ff">
    <div style="margin-top:6px">Intensity&nbsp;<span id="pp-iv">0.80</span></div>
    <input id="pp-i" type="range" min="0" max="3" step="0.05" value="0.8" style="width:100%;accent-color:#6aa3ff">
    <button id="pp-undo" style="margin-top:10px;width:100%;padding:6px;background:#1c2530;color:#cfd8e3;
      border:1px solid #34404e;border-radius:5px;cursor:pointer;font:inherit">Undo&nbsp;(0)</button>
    <div id="pp-help" style="margin-top:8px;opacity:0.55;font-size:11px">
      left-drag&nbsp;paint&nbsp;·&nbsp;right-drag&nbsp;orbit<br>shift+right&nbsp;pan&nbsp;·&nbsp;wheel&nbsp;zoom</div>`;
  document.body.appendChild(hud);
  const rEl = hud.querySelector<HTMLInputElement>('#pp-r')!;
  const iEl = hud.querySelector<HTMLInputElement>('#pp-i')!;
  const undoBtn = hud.querySelector<HTMLButtonElement>('#pp-undo')!;
  rEl.addEventListener('input', () => { brush.radiusPc = +rEl.value; hud.querySelector('#pp-rv')!.textContent = rEl.value; });
  iEl.addEventListener('input', () => { brush.intensity = +iEl.value; hud.querySelector('#pp-iv')!.textContent = (+iEl.value).toFixed(2); });
  undoBtn.addEventListener('click', undo);
  onStatus = (): void => { undoBtn.textContent = `Undo (${opList.length})`; };

  const paint: GalaxyPaint = { scene, camera, cam, brush, undo, opList, buildout };
  (globalThis as Record<string, unknown>).__paint = paint;
  console.info(`[galaxy-paint] paint mode — ${buildout.queue.length} regions queued; drag=orbit, shift-drag=pan, wheel=dolly`);

  function loop(): void {
    if (!shouldRun()) {
      cam.dispose();
      brush.dispose();
      hud.remove();
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
