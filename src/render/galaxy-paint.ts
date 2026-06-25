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
import { applyStroke, rebuildEditState, strokeCentroidXZ, type BrushStroke, type FalloffKind } from './galaxy-paint-ops';
import { PointerSource, type BrushSample, type GestureSink } from './paint-input';
import type { RendererContext } from './renderer';

const RING_ADD = 0x6aa3ff;   // blue — depositing
const RING_ERASE = 0xff6a6a; // red — removing

/** Density brush: a paint pointer (pen, touch, or LEFT mouse) drags stamps along the galactic plane
 *  (scene y=0 ↔ galactocentric y=0). Input arrives already normalized as BrushSamples from PointerSource,
 *  so pen / touch / mouse are one path. Phase 2b records each stamp's PRESSURE alongside the path, so a
 *  firm pen press lays a dense core and a feather touch seeds faint density (mouse resolves to pressure 1
 *  ⇒ desktop is byte-identical). Phase 2d adds erase (removes density), falloff presets, and the opacity
 *  ceiling. Off-plane depth is a later mode; here every stamp lands on the plane. */
export class PaintBrush {
  radiusPc = 1500;
  intensity = 0.8;
  /** 'add' deposits stars, 'erase' removes them — set via setErase(). */
  mode: 'add' | 'erase' = 'add';
  falloff: FalloffKind = 'linear';
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
        if (this.path.length) onStroke({
          brushType: this.mode === 'erase' ? 'density-erase' : 'density-add',
          path: this.path, pressures: this.pressures, radiusPc: this.radiusPc,
          intensity: this.intensity, falloff: this.falloff,
        });
      },
      onStrokeCancel: () => { this.path = []; this.pressures = []; },
    });
  }

  /** Toggle erase mode and recolour the footprint ring (blue = add, red = erase). */
  setErase(on: boolean): void {
    this.mode = on ? 'erase' : 'add';
    if (this.ring) (this.ring.material as LineBasicMaterial).color.setHex(on ? RING_ERASE : RING_ADD);
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
  readonly redo: () => void;
  /** Scrub the paint history to an absolute op-list position (the timeline scrubber). */
  readonly setHistory: (target: number) => void;
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

  // ── The non-destructive paint loop + a SCRUBBABLE history. opList is the canonical timeline of every
  //    stroke ever; `pos` is how many are currently applied (field = replay of opList[0..pos)). Painting
  //    while scrubbed back drops the redo-future (standard branching undo). The op-list being canonical is
  //    exactly what makes a scrubber cheap — any position is just a prefix replay. ──
  const opList: Array<{ stroke: BrushStroke; dirty: Set<string> }> = [];
  const cells = buildout.enumeration.cells;
  let pos = 0;
  let onStatus: (() => void) | null = null; // wired by the HUD below
  // A held Apple Pencil press re-emits as several down/up cycles → several commits → a stacked, blown-out
  // deposit (very bright in add, very dark in erase) while a finger stays clean. Drop a stroke that lands
  // within COALESCE_MS of the previous AND overlaps it AND shares its mode ⇒ one physical press = one dab.
  // Distinct locations (stippling) and continuous drags are untouched.
  const COALESCE_MS = 220;
  let lastMs = -1e9;
  let lastCx = 0;
  let lastCz = 0;
  let lastType: BrushStroke['brushType'] | null = null;
  const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);
  const onStroke = (stroke: BrushStroke): void => {
    if (!stroke.path.length) return;
    const [cx, cz] = strokeCentroidXZ(stroke.path);
    const t = nowMs();
    if (lastType === stroke.brushType && t - lastMs < COALESCE_MS) {
      const dx = cx - lastCx;
      const dz = cz - lastCz;
      if (dx * dx + dz * dz < (stroke.radiusPc * 0.6) ** 2) { lastMs = t; return; } // duplicate press → skip
    }
    lastMs = t; lastCx = cx; lastCz = cz; lastType = stroke.brushType;
    if (pos < opList.length) opList.length = pos; // a new stroke truncates the redo-future
    const dirty = applyStroke(stroke, buildout.editState, cells); // editState is at `pos` → correct
    opList.push({ stroke, dirty });
    pos = opList.length;
    for (const rk of dirty) regenerateRegion(buildout, rk);
    onStatus?.();
  };
  // Scrub to an absolute history position: rebuild the field from that prefix, then re-bake ONLY the
  // regions that differ (the union of dirtied sets crossed between the old and new position).
  const setHistory = (target: number): void => {
    const t = Math.max(0, Math.min(opList.length, Math.round(target)));
    if (t === pos) return;
    const lo = Math.min(pos, t);
    const hi = Math.max(pos, t);
    const affected = new Set<string>();
    for (let i = lo; i < hi; i++) for (const rk of opList[i].dirty) affected.add(rk);
    buildout.editState = rebuildEditState(opList.slice(0, t).map((o) => o.stroke), cells).editState;
    for (const rk of affected) regenerateRegion(buildout, rk);
    pos = t;
    onStatus?.();
  };
  const undo = (): void => setHistory(pos - 1);
  const redo = (): void => setHistory(pos + 1);
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

  // iPad: keep the PAGE itself from selecting text / rubber-band scrolling while painting (the canvas is
  // hardened in PointerSource; this covers the body + HUD). Restored on teardown.
  const prevUserSelect = document.body.style.userSelect;
  const prevOverscroll = document.body.style.overscrollBehavior;
  document.body.style.userSelect = 'none';
  document.body.style.setProperty('-webkit-user-select', 'none');
  document.body.style.overscrollBehavior = 'none';

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
    <div style="display:flex;gap:6px;margin-top:8px;align-items:center">
      <button id="pp-erase" style="flex:1;padding:6px;background:#1c2530;color:#cfd8e3;border:1px solid #34404e;border-radius:5px;cursor:pointer;font:inherit">Add</button>
      <select id="pp-falloff" title="edge falloff" style="flex:1;padding:5px;background:#1c2530;color:#cfd8e3;border:1px solid #34404e;border-radius:5px;font:inherit;cursor:pointer">
        <option value="linear">linear</option><option value="smooth">smooth</option><option value="ease">ease</option><option value="hard">hard</option>
      </select>
    </div>
    <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:baseline">
      <span>History</span><span id="pp-hlbl" style="opacity:0.8">0&nbsp;/&nbsp;0</span></div>
    <input id="pp-hist" type="range" min="0" max="0" step="1" value="0" style="width:100%;accent-color:#6aa3ff" title="scrub the paint history">
    <div style="display:flex;gap:6px;margin-top:6px">
      <button id="pp-undo" style="flex:1;padding:6px;background:#1c2530;color:#cfd8e3;border:1px solid #34404e;border-radius:5px;cursor:pointer;font:inherit">Undo</button>
      <button id="pp-redo" style="flex:1;padding:6px;background:#1c2530;color:#cfd8e3;border:1px solid #34404e;border-radius:5px;cursor:pointer;font:inherit">Redo</button>
    </div>
    <div id="pp-help" style="margin-top:8px;opacity:0.55;font-size:11px">
      pen / 1-finger / left-drag&nbsp;paint<br>2-finger / right-drag&nbsp;orbit&nbsp;·&nbsp;pinch / wheel&nbsp;zoom</div>`;
  document.body.appendChild(hud);
  const rEl = hud.querySelector<HTMLInputElement>('#pp-r')!;
  const iEl = hud.querySelector<HTMLInputElement>('#pp-i')!;
  const undoBtn = hud.querySelector<HTMLButtonElement>('#pp-undo')!;
  const redoBtn = hud.querySelector<HTMLButtonElement>('#pp-redo')!;
  const histEl = hud.querySelector<HTMLInputElement>('#pp-hist')!;
  const eraseBtn = hud.querySelector<HTMLButtonElement>('#pp-erase')!;
  const falloffSel = hud.querySelector<HTMLSelectElement>('#pp-falloff')!;
  rEl.addEventListener('input', () => { brush.radiusPc = +rEl.value; hud.querySelector('#pp-rv')!.textContent = rEl.value; });
  iEl.addEventListener('input', () => { brush.intensity = +iEl.value; hud.querySelector('#pp-iv')!.textContent = (+iEl.value).toFixed(2); });
  eraseBtn.addEventListener('click', () => {
    const erasing = brush.mode === 'add'; // flip
    brush.setErase(erasing);
    eraseBtn.textContent = erasing ? 'Erase' : 'Add';
    eraseBtn.style.color = erasing ? '#ff9a9a' : '#cfd8e3';
    eraseBtn.style.borderColor = erasing ? '#7a3a3a' : '#34404e';
  });
  falloffSel.addEventListener('change', () => { brush.falloff = falloffSel.value as FalloffKind; });
  // Scrub the history. rAF-debounce so a fast drag coalesces to one rebuild per frame (smooth, not janky).
  let pendingHist: number | null = null;
  let histScheduled = false;
  histEl.addEventListener('input', () => {
    pendingHist = +histEl.value;
    if (histScheduled) return;
    histScheduled = true;
    requestAnimationFrame(() => {
      histScheduled = false;
      if (pendingHist !== null) { setHistory(pendingHist); pendingHist = null; }
    });
  });
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  onStatus = (): void => {
    histEl.max = String(opList.length);
    if (pendingHist === null) histEl.value = String(pos); // don't fight the user mid-drag
    hud.querySelector('#pp-hlbl')!.textContent = `${pos} / ${opList.length}`;
    undoBtn.disabled = pos === 0;
    redoBtn.disabled = pos === opList.length;
    undoBtn.style.opacity = pos === 0 ? '0.4' : '1';
    redoBtn.style.opacity = pos === opList.length ? '0.4' : '1';
  };
  onStatus();

  const paint: GalaxyPaint = { scene, camera, cam, brush, undo, redo, setHistory, opList, buildout };
  (globalThis as Record<string, unknown>).__paint = paint;
  console.info(`[galaxy-paint] paint mode — ${buildout.queue.length} regions queued; drag=orbit, shift-drag=pan, wheel=dolly`);

  function loop(): void {
    if (!shouldRun()) {
      cam.dispose();
      brush.dispose();
      hud.remove();
      document.body.style.userSelect = prevUserSelect;
      document.body.style.removeProperty('-webkit-user-select');
      document.body.style.overscrollBehavior = prevOverscroll;
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
