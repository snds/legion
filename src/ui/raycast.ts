// ═══════════════════════════════════════════════════════════════════
// RAYCAST — Mouse → Three.js Raycasting → Selection & Tooltip
// Provides getHit() for mouse-to-entity resolution and wires
// canvas events: mousemove→tooltip+hover, click→select, dblclick→focus,
// shift+dblclick→focus + warp to a zoom level appropriate to the object.
//
// Hover state is shown by a single shared bracketed reticule sprite
// that snaps to the hovered object's world position and resizes to a
// constant screen-pixel diameter.
// ═══════════════════════════════════════════════════════════════════

import {
  Raycaster, Vector2, Vector3, CanvasTexture, Sprite, SpriteMaterial,
  type PerspectiveCamera, type Object3D, type Scene,
} from 'three';
import { Tooltip, type TooltipData } from './tooltip';
import { SelectionPanels } from './panels/selection';
import { Game, ZOOM_STEPS } from '../core/state';
import { Events } from '../core/events';
import { setOrbitHighlight } from '../render/objects';
import type { LayerGroups } from '../render/scene';

let camera: PerspectiveCamera;
let selectables: Object3D[] = [];
const raycaster = new Raycaster();
const mouseVec = new Vector2();
const worldPos = new Vector3();

// Single shared hover reticule — created lazily on first hover.
let hoverIndicator: Sprite | null = null;
let hoveredObject: Object3D | null = null;
const _hoverPos = new Vector3();
const HOVER_SCREEN_PX = 72;     // diameter in pixels at any camDist
const HOVER_SCREEN_PX_LARGE = 110; // bigger ring for system-class targets

// ── Visibility Check ─────────────────────────────────────────────
// Walk ancestors — if any parent group is hidden, skip this object.

function isWorldVisible(obj: Object3D): boolean {
  let o: Object3D | null = obj;
  while (o) {
    if (o.visible === false) return false;
    o = o.parent;
  }
  return true;
}

// ── Hit Test ─────────────────────────────────────────────────────

interface HitResult {
  data: TooltipData;
  object: Object3D;
}

export function getHit(clientX: number, clientY: number): HitResult | null {
  mouseVec.x = (clientX / window.innerWidth) * 2 - 1;
  mouseVec.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseVec, camera);

  const hits = raycaster.intersectObjects(selectables, true);
  for (let i = 0; i < hits.length; i++) {
    // Walk parent chain to find entity userData
    let obj: Object3D | null = hits[i].object;
    while (obj && !obj.userData.type) {
      obj = obj.parent;
    }
    if (!obj || !obj.userData.type) continue;
    if (!isWorldVisible(obj)) continue;
    return { data: obj.userData as TooltipData, object: obj };
  }
  return null;
}

// ── Hover Reticule ───────────────────────────────────────────────
//
// Four-bracket corner reticule on a single CanvasTexture sprite. Lives
// permanently in the scene; visibility and position track the current
// hovered object. Sized via FOV math so it stays at HOVER_SCREEN_PX
// regardless of camera distance.

function makeHoverReticule(): Sprite {
  const SIZE = 256;
  const cv = document.createElement('canvas');
  cv.width = SIZE; cv.height = SIZE;
  const ctx = cv.getContext('2d')!;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const C = SIZE / 2;
  const R = SIZE * 0.40;
  const B = SIZE * 0.10;
  // top-left, top-right, bottom-right, bottom-left brackets
  const corners: [number, number, number, number][] = [
    [C - R, C - R, +1, +1],
    [C + R, C - R, -1, +1],
    [C + R, C + R, -1, -1],
    [C - R, C + R, +1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * B, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * B);
    ctx.stroke();
  }
  // Faint center dot
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.arc(C, C, 3.5, 0, Math.PI * 2);
  ctx.fill();

  const tex = new CanvasTexture(cv);
  const mat = new SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,        // always render in front
    depthWrite: false,
  });
  const sprite = new Sprite(mat);
  sprite.renderOrder = 10000;
  sprite.visible = false;
  return sprite;
}

function setHoverState(hit: HitResult | null): void {
  // Brighten the hovered body's orbit line (planets/moons); clear otherwise.
  const t = hit?.data?.type as string | undefined;
  setOrbitHighlight(
    (t === 'planet' || t === 'moon') ? ((hit!.data.name as string) ?? null) : null,
  );

  if (!hoverIndicator) return;
  if (!hit) {
    if (hoveredObject) {
      hoveredObject = null;
      hoverIndicator.visible = false;
    }
    return;
  }
  hoveredObject = hit.object;
  hit.object.getWorldPosition(_hoverPos);
  hoverIndicator.position.copy(_hoverPos);

  // Size the reticule to a constant screen-pixel diameter regardless
  // of camera FOV or distance.
  const camDist = camera.position.distanceTo(_hoverPos);
  const fovHalfRad = (camera.fov * 0.5) * Math.PI / 180;
  const targetPx = pixelsForType(hit.data.type as string);
  const worldSize = (targetPx / window.innerHeight) * camDist * 2 * Math.tan(fovHalfRad);
  hoverIndicator.scale.set(worldSize, worldSize, 1);
  hoverIndicator.visible = true;
}

function pixelsForType(type: string): number {
  switch (type) {
    case 'star':
    case 'gal_system':
    case 'system':
    case 'phenomenon':
    case 'alien':
    case 'alien_civ':
      return HOVER_SCREEN_PX_LARGE;
    default:
      return HOVER_SCREEN_PX;
  }
}

// ── Context-Aware Zoom Warp ──────────────────────────────────────
//
// Shift+double-click on an object means: focus AND zoom to the natural
// framing for that object class. Without shift, double-click only
// focuses — the camera stays at the user's current zoom tier.

function warpZoomForType(type: string): number | null {
  switch (type) {
    // Things you'd want to see in your hand — orbit tier
    case 'planet':
    case 'moon':
    case 'bob':
    case 'station':
    case 'comet':
      return ZOOM_STEPS[2].val;  // ORBIT
    // Mid-tier system view — see the whole star system
    case 'star':
      return ZOOM_STEPS[3].val;  // INNER SYSTEM
    case 'system':         // regional system marker
    case 'gal_system':     // galactic system marker
      return ZOOM_STEPS[5].val;  // HELIOPAUSE — into the system bubble
    // Large-scale targets
    case 'alien':
    case 'alien_civ':
      return ZOOM_STEPS[6].val;  // SECTOR
    case 'phenomenon':
    case 'bob_transit':
      return ZOOM_STEPS[7].val;  // ARM
    default:
      return null;
  }
}

// ── Initialize ───────────────────────────────────────────────────
// Call once after scene and renderer are ready.

export function initRaycast(
  cam: PerspectiveCamera,
  layers: LayerGroups,
  canvas: HTMLElement,
  scene: Scene,
): void {
  camera = cam;

  // Selectables: all objects in local, regional, galactic layers
  selectables = [layers.local, layers.regional, layers.galactic];

  // Shared hover reticule lives in the scene root, on top of everything.
  hoverIndicator = makeHoverReticule();
  scene.add(hoverIndicator);

  // ── Mousemove → Tooltip + Hover ──
  canvas.addEventListener('mousemove', (e: MouseEvent) => {
    // Don't raycast while dragging
    if (Game.data.dragMoved) {
      Tooltip.hide();
      setHoverState(null);
      return;
    }

    // Don't raycast in destination mode
    if (Game.data.destMode) {
      canvas.style.cursor = 'crosshair';
      return;
    }

    const hit = getHit(e.clientX, e.clientY);
    if (hit) {
      Tooltip.show(hit.data, e.clientX, e.clientY);
      canvas.style.cursor = 'pointer';
      setHoverState(hit);
    } else {
      Tooltip.hide();
      canvas.style.cursor = 'default';
      setHoverState(null);
    }
  });

  // Hide tooltip on mousedown (start of drag)
  canvas.addEventListener('mousedown', () => {
    Tooltip.hide();
    setHoverState(null);
  });

  // ── Click → Select (single click without drag) ──
  canvas.addEventListener('mouseup', (e: MouseEvent) => {
    // Only process if no drag occurred (click, not drag)
    if (Game.data.dragMoved) return;
    // Only left or right click
    if (e.button !== 0 && e.button !== 2) return;

    const hit = getHit(e.clientX, e.clientY);
    if (hit) {
      // Pull the real ECS eid out of userData (set by registerRenderObject).
      // Non-ECS objects (stations, galactic markers, alien civs, transit
      // chevrons, Sgr A*) have no eid — fall through to 0 as placeholder.
      const eid = (hit.data as Record<string, unknown>).eid as number | undefined ?? 0;
      Game.selectEntity(eid, hit.data as unknown as Record<string, unknown>);
      SelectionPanels.open(hit.data);
    } else {
      // Click on empty space — deselect
      Game.deselectEntity();
      SelectionPanels.close();
      setHoverState(null);
    }
  });

  // ── Double-Click → Focus Camera on Object (zoom unchanged) ──
  // Shift+Double-Click → also warp to a zoom level appropriate for the
  // object's class (planet → ORBIT, star → INNER SYSTEM, system →
  // HELIOPAUSE, phenomenon → ARM, etc.).
  canvas.addEventListener('dblclick', (e: MouseEvent) => {
    const hit = getHit(e.clientX, e.clientY);
    if (!hit) return;

    hit.object.getWorldPosition(worldPos);
    const eid = (hit.data as Record<string, unknown>).eid as number | undefined ?? 0;
    Game.selectEntity(eid, hit.data as unknown as Record<string, unknown>);
    SelectionPanels.open(hit.data);

    if (e.shiftKey) {
      // Shift+dblclick → cinematic FLY to the object. Bezier-eased
      // trajectory (arcs over the disc plane), looks at target throughout,
      // hands back to orbit mode at the appropriate tier camDist on
      // arrival. Star streaks engage automatically during the high-
      // velocity middle of the flight via uStreakStrength gating.
      const target = warpZoomForType(hit.data.type as string);
      Events.emit('camera:fly-to', {
        x: worldPos.x, y: worldPos.y, z: worldPos.z,
        targetZoomLevel: target,
      });
    } else {
      // Plain dblclick → focus at current zoom + track object.
      Events.emit('camera:focus-on', { x: worldPos.x, y: worldPos.y, z: worldPos.z });
      Events.emit('camera:focus-object', { obj: hit.object });
    }
  });
}
