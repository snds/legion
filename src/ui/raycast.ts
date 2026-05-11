// ═══════════════════════════════════════════════════════════════════
// RAYCAST — Mouse → Three.js Raycasting → Selection & Tooltip
// Provides getHit() for mouse-to-entity resolution and wires
// canvas events: mousemove→tooltip, click→select, dblclick→focus.
//
// Matches the monolithic prototype interaction model:
// - Single click = select object (open detail panel)
// - Double-click = focus camera on object
// - Raycast against all visible objects with userData.type
// - Walk parent chain to find entity data
// ═══════════════════════════════════════════════════════════════════

import { Raycaster, Vector2, Vector3, type PerspectiveCamera, type Object3D } from 'three';
import { Tooltip, type TooltipData } from './tooltip';
import { SelectionPanels } from './panels/selection';
import { Game } from '../core/state';
import { Events } from '../core/events';
import type { LayerGroups } from '../render/scene';

let camera: PerspectiveCamera;
let selectables: Object3D[] = [];
const raycaster = new Raycaster();
const mouseVec = new Vector2();
const worldPos = new Vector3();

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

// ── Initialize ───────────────────────────────────────────────────
// Call once after scene and renderer are ready.

export function initRaycast(
  cam: PerspectiveCamera,
  layers: LayerGroups,
  canvas: HTMLElement,
): void {
  camera = cam;

  // Selectables: all objects in local, regional, galactic layers
  selectables = [layers.local, layers.regional, layers.galactic];

  // ── Mousemove → Tooltip ──
  canvas.addEventListener('mousemove', (e: MouseEvent) => {
    // Don't raycast while dragging
    if (Game.data.dragMoved) {
      Tooltip.hide();
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
    } else {
      Tooltip.hide();
      canvas.style.cursor = 'default';
    }
  });

  // Hide tooltip on mousedown (start of drag)
  canvas.addEventListener('mousedown', () => {
    Tooltip.hide();
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
    }
  });

  // ── Double-Click → Focus Camera on Object ──
  // Snap the camera onto the hit object AND lock the camera into "tracking"
  // mode so it follows the object on subsequent frames (works for both
  // moving ECS bodies — planets, bobs in flight — and static markers).
  canvas.addEventListener('dblclick', (e: MouseEvent) => {
    const hit = getHit(e.clientX, e.clientY);
    if (hit) {
      hit.object.getWorldPosition(worldPos);
      Events.emit('camera:focus-on', { x: worldPos.x, y: worldPos.y, z: worldPos.z });
      Events.emit('camera:focus-object', { obj: hit.object });
      const eid = (hit.data as Record<string, unknown>).eid as number | undefined ?? 0;
      Game.selectEntity(eid, hit.data as unknown as Record<string, unknown>);
      SelectionPanels.open(hit.data);
    }
  });
}
