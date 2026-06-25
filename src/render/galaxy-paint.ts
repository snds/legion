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
  BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineLoop, MathUtils, Object3D,
  PerspectiveCamera, Plane, Raycaster, Scene, Vector2, Vector3,
} from 'three';
import { WU_PER_PC } from '../core/metrics';
import { Broker } from './scale-manager';
import { HOME_GAL_PC } from './sector/sector';
import {
  createGalaxyBuildout, disposeGalaxyBuildout, regenerateRegion, updateGalaxyBuildout,
  type GalaxyBuildout,
} from './sector/galaxy-buildout';
import { applyStroke, rebuildEditState, type BrushStroke } from './galaxy-paint-ops';
import { PointerSource, type BrushSample, type GestureSink } from './paint-input';
import type { RendererContext } from './renderer';

/** Density brush: a paint pointer (pen, touch, or LEFT mouse) drags stamps along the galactic plane
 *  (scene y=0 ↔ galactocentric y=0). Input arrives already normalized as BrushSamples from PointerSource,
 *  so pen / touch / mouse are one path. Phase 2b records each stamp's PRESSURE alongside the path, so a
 *  firm pen press lays a dense core and a feather touch seeds faint density (mouse resolves to pressure 1
 *  ⇒ desktop is byte-identical). Off-plane depth is a later mode; here every stamp lands on the plane. */
export class PaintBrush {
  radiusPc = 1500;
  intensity = 0.8;
  private path: Array<[number, number, number]> = [];
  private pressures: number[] = [];
  private readonly raycaster = new Raycaster();
  private readonly plane = new Plane(new Vector3(0, 1, 0), 0); // scene y=0 = the galactic mid-plane
  private readonly _ndc = new Vector2();
  private readonly _hit = new Vector3();
  private readonly source: PointerSource;
  /** Phase 2c: a footprint ring on the plane that follows hover (preview) + the active stroke. */
  private readonly ring: LineLoop | null;

  constructor(
    cam: PerspectiveCamera, el: HTMLCanvasElement, onStroke: (s: BrushStroke) => void,
    gesture?: GestureSink, previewParent?: Object3D,
  ) {
    this.ring = previewParent ? makePreviewRing() : null;
    if (this.ring && previewParent) previewParent.add(this.ring);

    // Raycast a sample (canvas-relative CSS px, already rect-corrected by PointerSource) onto the plane.
    const project = (sx: number, sy: number): boolean => {
      const rect = el.getBoundingClientRect();
      this._ndc.set((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(this._ndc, cam);
      return this.raycaster.ray.intersectPlane(this.plane, this._hit) !== null;
    };
    // Park the footprint ring at the current _hit, sized to the brush radius (WU = pc·WU_PER_PC).
    const showRing = (): void => {
      if (!this.ring) return;
      this.ring.position.copy(this._hit);
      this.ring.scale.setScalar(this.radiusPc * WU_PER_PC);
      this.ring.visible = true;
    };
    // Record a stamp's galPc + pressure (aligned 1:1) so the deposit can vary along the drag.
    const push = (s: BrushSample): void => {
      if (!project(s.x, s.y)) return;
      this.path.push([this._hit.x / WU_PER_PC, this._hit.y / WU_PER_PC, this._hit.z / WU_PER_PC]);
      this.pressures.push(s.pressure);
      showRing(); // the ring follows the active stroke too
    };
    // Phase 2a/2b: passthrough (no coalesce / resample / stabilize) ⇒ byte-identical to the old mouse path.
    // The gesture sink (Phase 2e) routes a 2nd touch finger to two-finger navigation.
    this.source = new PointerSource(el, { gesture }, {
      onHover: (s) => { if (this.ring) { if (project(s.x, s.y)) showRing(); else this.ring.visible = false; } },
      onStrokeBegin: (s) => { this.path = []; this.pressures = []; push(s); },
      onStrokeSample: (s) => push(s),
      onStrokeEnd: () => {
        if (this.path.length) onStroke({ brushType: 'density-add', path: this.path, pressures: this.pressures, radiusPc: this.radiusPc, intensity: this.intensity });
      },
      onStrokeCancel: () => { this.path = []; this.pressures = []; },
    });
  }

  dispose(): void {
    this.source.dispose();
    if (this.ring) {
      this.ring.removeFromParent();
      this.ring.geometry.dispose();
      (this.ring.material as LineBasicMaterial).dispose();
    }
  }
}

/** A 64-segment unit circle laid flat in the XZ plane (LineLoop) — the brush footprint ring. Scaled to
 *  the brush radius (WU) + parked at the hover/stroke point; depthTest off so it floats over the stars. */
function makePreviewRing(): LineLoop {
  const SEG = 64;
  const pos = new Float32Array(SEG * 3);
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    pos[i * 3] = Math.cos(a);
    pos[i * 3 + 2] = Math.sin(a);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const mat = new LineBasicMaterial({ color: 0x6aa3ff, transparent: true, opacity: 0.6, depthTest: false });
  const ring = new LineLoop(geo, mat);
  ring.renderOrder = 999;
  ring.visible = false;
  return ring;
}

const ORBIT_SPEED = 0.005; // rad per screen px, shared by mouse-drag and two-finger orbit

/** A turntable free-fly camera. Mouse: right-drag = orbit, shift/middle-drag = pan, wheel = dolly.
 *  Touch (via the gesture sink): two-finger drag = orbit, pinch = dolly. Operates in scene space
 *  (the galaxy is centred at the origin via the pinned rebase). */
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
        this.orbitBy(dx, dy);
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
      this.dolly(Math.exp(e.deltaY * 0.001));
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

  /** Orbit by a screen-px delta — shared by the mouse drag and the two-finger gesture. */
  orbitBy(dxPx: number, dyPx: number): void {
    this.azimuth -= dxPx * ORBIT_SPEED;
    this.elevation = MathUtils.clamp(this.elevation + dyPx * ORBIT_SPEED, -1.5, 1.5);
  }

  /** Scale the orbit distance — shared by the wheel and the pinch. factor < 1 zooms in. */
  dolly(factor: number): void {
    this.distance = MathUtils.clamp(this.distance * factor, 1e5, 2e8);
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
  // Two-finger touch navigation (Phase 2e): a 2nd finger cancels the in-progress paint and drives the
  // SAME camera state the mouse path mutates — drag → orbit, pinch → dolly. One code path, two adapters.
  const gesture: GestureSink = {
    onGestureUpdate: (d) => {
      cam.orbitBy(d.orbitDx, d.orbitDy);
      if (d.pinchRatio > 0) cam.dolly(1 / d.pinchRatio); // spread apart (ratio>1) ⇒ zoom in
    },
  };
  const brush = new PaintBrush(camera, renderCtx.canvas, onStroke, gesture, scene);

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
      pen / 1-finger / left-drag&nbsp;paint<br>2-finger / right-drag&nbsp;orbit&nbsp;·&nbsp;pinch / wheel&nbsp;zoom</div>`;
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
