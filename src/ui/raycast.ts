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
  type PerspectiveCamera, type Object3D, type Scene, type Intersection, type Points,
} from 'three';
import { Tooltip, type TooltipData } from './tooltip';
import { SelectionPanels } from './panels/selection';
import { Game, ZOOM_STEPS } from '../core/state';
import { Events } from '../core/events';
import { setOrbitHighlight } from '../render/objects';
import { loadableSystemId, preloadSystem, requestSystemFocus } from '../render/system-loader';
import type { LayerGroups } from '../render/scene';
import type { CatalogSystemsHandle } from '../render/catalog-systems';
import type { CatalogStar } from '../data/star-systems';

let camera: PerspectiveCamera;
let selectables: Object3D[] = [];
const raycaster = new Raycaster();
// Fat, screen-constant hit corridor for Line2 orbit lines (px added to the
// 1px draw width) — pencil-thin lines are otherwise unhoverable. Screen-space,
// so the affordance automatically scales with camera proximity.
(raycaster.params as unknown as Record<string, unknown>).Line2 = { threshold: 8 };
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

// ── Catalog Points Picking ───────────────────────────────────────
// The ~3k-star catalogue renders as ONE THREE.Points — a hit resolves to an
// index, mapped back to the CatalogStar record via this handle (injected by
// main.ts after populateWorld; initRaycast runs before the world exists).

let catalogSystems: CatalogSystemsHandle | null = null;
export function setCatalogPicking(handle: CatalogSystemsHandle | null): void {
  // The catalog group rides sceneRoot (cross-tier crossfade, main.ts), not a
  // raycast layer — register it as its own selectable root. Remove the prior
  // handle's group first so repeated injection never stacks duplicates.
  if (catalogSystems) {
    const i = selectables.indexOf(catalogSystems.group);
    if (i >= 0) selectables.splice(i, 1);
  }
  catalogSystems = handle;
  if (handle) selectables.push(handle.group);
}

/** Synthesized hit payload for a catalogue star — no ECS entity, no marker;
 *  the record IS the data. `point` carries the star's true world position
 *  (the hit object is the whole Points cloud). */
function catalogStarHit(star: CatalogStar, hit: Intersection): HitResult {
  const points = hit.object as Points;
  const pos = new Vector3()
    .fromBufferAttribute(points.geometry.getAttribute('position'), hit.index!)
    .applyMatrix4(points.matrixWorld);
  const data: TooltipData = {
    type: 'catalog_star',
    name: star.name,
    designation: star.desig,
    spectralType: star.spect,
    constellation: star.con,
    distLy: star.distLy,
    mag: star.mag,
    _catalogStar: star,
  };
  return { data, object: hit.object, point: pos };
}

// ── Hit Test ─────────────────────────────────────────────────────

interface HitResult {
  data: TooltipData;
  object: Object3D;
  /** World position for hits without a positioned object (catalog points). */
  point?: Vector3;
}

export function getHit(clientX: number, clientY: number): HitResult | null {
  mouseVec.x = (clientX / window.innerWidth) * 2 - 1;
  mouseVec.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseVec, camera);

  // Catalog Points hit corridor (world units around each point). Scaled with
  // the view distance so points stay reliably clickable at sector zoom
  // (~120 WU at a typical ~5000 WU sector view) without a fat corridor when
  // the camera is close.
  raycaster.params.Points.threshold = Math.max(60, Game.data.camDist * 0.025);

  const hits = raycaster.intersectObjects(selectables, true);
  let pointsHit: Intersection | null = null;
  for (let i = 0; i < hits.length; i++) {
    // Walk parent chain to find entity userData
    let obj: Object3D | null = hits[i].object;
    // Catalog star points: remember the first hit but DEFER — any non-Points
    // hit (curated marker, body) wins the click even when a point is closer
    // along the ray.
    if (obj.userData.type === 'catalog_star_points') {
      if (!pointsHit && hits[i].index != null && isWorldVisible(obj)) pointsHit = hits[i];
      continue;
    }
    while (obj && !obj.userData.type) {
      obj = obj.parent;
    }
    if (!obj || !obj.userData.type) continue;
    if (!isWorldVisible(obj)) continue;
    return { data: obj.userData as TooltipData, object: obj };
  }
  if (pointsHit && catalogSystems) {
    const star = catalogSystems.stars[pointsHit.index!];
    if (star) return catalogStarHit(star, pointsHit);
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
  // Brighten the hovered body's orbit line — when hovering the body (planet/
  // moon) OR the orbit line itself; clear otherwise.
  const t = hit?.data?.type as string | undefined;
  setOrbitHighlight(
    (t === 'planet' || t === 'moon' || t === 'orbit')
      ? ((hit!.data.name as string) ?? null)
      : null,
  );

  // Orbit-line hovers brighten the line but get no bracket reticule (sizing a
  // reticule on an ellipse is meaningless).
  if (t === 'orbit') {
    hoveredObject = null;
    if (hoverIndicator) hoverIndicator.visible = false;
    return;
  }

  if (!hoverIndicator) return;
  if (!hit) {
    if (hoveredObject) {
      hoveredObject = null;
      hoverIndicator.visible = false;
    }
    return;
  }
  hoveredObject = hit.object;
  // Catalog points carry their world position on the hit (the object is the
  // whole Points cloud, whose origin is meaningless for the reticule).
  if (hit.point) _hoverPos.copy(hit.point);
  else hit.object.getWorldPosition(_hoverPos);
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
    case 'catalog_star':
    case 'phenomenon':
    case 'alien':
    case 'alien_civ':
    case 'nebula':
    case 'dyson_sphere':
    case 'dyson_swarm':
    case 'megastructure':
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
    case 'catalog_star':   // catalogue star point (no local tier yet)
    case 'nebula':         // cosmic objects share the local-map framing
    case 'dyson_sphere':
    case 'dyson_swarm':
    case 'megastructure':
      return ZOOM_STEPS[5].val;  // HELIOPAUSE — into the local-map bubble
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
      // Orbit-line hovers brighten the line (via setHoverState) but show no
      // entity tooltip — the line isn't an inspectable entity.
      if ((hit.data.type as string) === 'orbit') Tooltip.hide();
      else Tooltip.show(hit.data, e.clientX, e.clientY);
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
  // Shared by mouse click and touch tap.
  function selectAt(x: number, y: number): void {
    const hit = getHit(x, y);
    // Orbit lines are hover-only affordances: clicking one neither selects
    // nor deselects (their userData has no entity payload).
    if (hit && (hit.data.type as string) === 'orbit') return;
    if (hit) {
      // Pull the real ECS eid out of userData (set by registerRenderObject).
      // Non-ECS objects (stations, galactic markers, alien civs, transit
      // chevrons, Sgr A*, catalog stars) have no eid — fall through to 0.
      const eid = (hit.data as Record<string, unknown>).eid as number | undefined ?? 0;
      Game.selectEntity(eid, hit.data as unknown as Record<string, unknown>);
      SelectionPanels.open(hit.data);
      // Stage A: single-click on a loadable system starts the staged preload
      // (Sol textures + exoplanet sidecar). Catalog stars have no loadable
      // local tier yet — the info panel alone is the payoff.
      const t = hit.data.type as string;
      if (t === 'system' || t === 'gal_system') {
        const sysId = loadableSystemId(hit.data.name as string | undefined);
        if (sysId) preloadSystem(sysId);
      }
    } else {
      // Click on empty space — deselect
      Game.deselectEntity();
      SelectionPanels.close();
      setHoverState(null);
    }
  }

  canvas.addEventListener('mouseup', (e: MouseEvent) => {
    // Only process if no drag occurred (click, not drag)
    if (Game.data.dragMoved) return;
    // Only left or right click
    if (e.button !== 0 && e.button !== 2) return;
    selectAt(e.clientX, e.clientY);
  });

  // ── Double-Click → Focus Camera on Object (zoom unchanged) ──
  // Shift+Double-Click → also warp to a zoom level appropriate for the
  // object's class (planet → ORBIT, star → INNER SYSTEM, system →
  // HELIOPAUSE, phenomenon → ARM, etc.).
  // Shared by mouse double-click and touch double-tap.
  function focusAt(x: number, y: number, fly: boolean): void {
    const hit = getHit(x, y);
    if (!hit) return;
    if ((hit.data.type as string) === 'orbit') return; // hover-only affordance

    // Catalog points carry their world position on the hit — the Points
    // cloud's own origin is meaningless as a focus target.
    if (hit.point) worldPos.copy(hit.point);
    else hit.object.getWorldPosition(worldPos);
    const eid = (hit.data as Record<string, unknown>).eid as number | undefined ?? 0;
    Game.selectEntity(eid, hit.data as unknown as Record<string, unknown>);
    SelectionPanels.open(hit.data);

    if (fly) {
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
      // Plain dblclick → focus at current zoom + track object. A Points cloud
      // is not trackable — the synthesized point already IS the star.
      Events.emit('camera:focus-on', { x: worldPos.x, y: worldPos.y, z: worldPos.z });
      if (!hit.point) Events.emit('camera:focus-object', { obj: hit.object });
    }

    // Stage B: focusing a loadable system swaps the local tier to it — the
    // swap defers until the zoom transition hides the local tier.
    const t = hit.data.type as string;
    if (t === 'system' || t === 'gal_system') {
      const sysId = loadableSystemId(hit.data.name as string | undefined);
      if (sysId) requestSystemFocus(sysId);
    }
  }

  canvas.addEventListener('dblclick', (e: MouseEvent) => {
    focusAt(e.clientX, e.clientY, e.shiftKey);
  });

  // ── Touch: tap = select, double-tap = focus ──
  // input.ts owns touch ORBIT/PINCH (and preventDefault suppresses Safari's
  // synthetic mouse events, so these are the only selection path on touch).
  // A tap is a touchend with no drag/pinch since touchstart (Game.data.
  // dragMoved, maintained by input.ts). Double-tap = two taps within 320 ms
  // and 32 px — fires selectAt on the first tap then focusAt, matching the
  // desktop click→dblclick ordering.
  let lastTap = { t: -1e9, x: 0, y: 0 };
  canvas.addEventListener('touchstart', () => {
    Tooltip.hide();
    setHoverState(null);
  }, { passive: true });
  canvas.addEventListener('touchend', (e: TouchEvent) => {
    if (e.changedTouches.length !== 1 || e.touches.length > 0) return;
    if (Game.data.dragMoved) return; // drag or pinch — not a tap
    const t = e.changedTouches[0];
    const now = performance.now();
    const isDouble =
      now - lastTap.t < 320 &&
      Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 32;
    lastTap = { t: now, x: t.clientX, y: t.clientY };
    if (isDouble) focusAt(t.clientX, t.clientY, false);
    else selectAt(t.clientX, t.clientY);
  });
}
