// ═══════════════════════════════════════════════════════════════════
// ICON SYSTEM — Homeworld-Style LOD Transitions
// Manages the crossfade between 3D meshes and billboard icons as
// the camera moves through zoom tiers.
//
// Ported from the monolithic prototype's IconSystem IIFE.
// Called per frame by the visibility system.
//
// State transitions per zoom tier:
//   Surface  — mesh full + icon overlays at fixed screen size
//   System   — mesh fades from full→0, icon stays at full contrast
//   Helio+   — mesh gone, icon only at fixed screen size
//
// Icons sit at the object's position (as children of the mesh group).
// They maintain constant screen-pixel size via FOV projection math.
// ═══════════════════════════════════════════════════════════════════

import { MathUtils, type Object3D, type Mesh, type Sprite, type SpriteMaterial } from 'three';

// ── Constants ────────────────────────────────────────────────────

const SCREEN_PX = 28;       // target icon size in screen pixels (HW2: small & functional)
const SCREEN_PX_CLOSE = 20; // smaller icons when mesh is fully visible
const ICON_OPACITY = 0.95;  // full contrast for icon-only mode
const ICON_OPACITY_CLOSE = 0.6; // reduced opacity when mesh is visible

// Dynamic FOV factor — the camera FOV adapts with distance now, so the
// projection math used to compute world-size-for-N-screen-pixels has to
// follow. CameraController calls setIconFov() each frame after lerping.
let FOV_FACTOR = 2 * Math.tan(MathUtils.degToRad(27.5)); // default = old 55° behavior

export function setIconFov(fovDeg: number): void {
  FOV_FACTOR = 2 * Math.tan(MathUtils.degToRad(fovDeg * 0.5));
}

// ── Scaling Functions ────────────────────────────────────────────

/**
 * Scale icon to maintain constant screen-pixel size regardless of
 * camera distance. HW2-style: icons stay small and readable,
 * anchored to the 3D object position.
 */
export function scaleFixed(icon: Sprite, camDist: number, screenPx = SCREEN_PX): void {
  if (!icon?.userData) return;
  const aspect = icon.userData.aspect ?? 1.25;
  // World size that produces exactly screenPx pixels on screen
  const worldSize = (screenPx / window.innerHeight) * camDist * FOV_FACTOR;
  icon.scale.set(worldSize, worldSize * aspect, 1);
}

/**
 * World-relative scaling (for regional/galaxy icons that should
 * grow proportionally with the scene, not stay fixed on screen).
 * Has a minimum of the fixed screen size so icons remain readable.
 */
export function scaleWorld(icon: Sprite, camDist: number, factor = 0.035): void {
  if (!icon?.userData) return;
  const aspect = icon.userData.aspect ?? 1.25;
  const fixedSize = (SCREEN_PX / window.innerHeight) * camDist * FOV_FACTOR;
  const worldSize = camDist * factor;
  const s = Math.max(fixedSize, worldSize);
  icon.scale.set(s, s * aspect, 1);
}

// ── Mesh Fading ──────────────────────────────────────────────────

/** Check if a child is a fadeable mesh (not an icon, label, or proxy). */
function isFadeable(child: Object3D): boolean {
  const c = child as Mesh;
  return !!(
    c.isMesh && c.material &&
    !c.userData?.isIcon &&
    !c.userData?.isLabel &&
    !c.userData?._isProxy &&
    (c.material as any).visible !== false
  );
}

/**
 * Apply opacity to all renderable mesh children of an object,
 * excluding icons, labels, and invisible proxies.
 * Stores original material state on first call for clean restore.
 */
export function fadeMeshes(obj: Object3D, opacity: number): void {
  obj.traverse(child => {
    if (!isFadeable(child)) return;
    const c = child as Mesh;
    const mat = c.material as any;

    // Store originals on first touch
    if (mat._origTransparent === undefined) {
      mat._origTransparent = mat.transparent;
      mat._origOpacity = mat.opacity ?? 1;
    }

    if (opacity < 0.99) {
      mat.transparent = true;
      mat.opacity = opacity * mat._origOpacity;
      mat.depthWrite = opacity > 0.1;
    } else {
      mat.transparent = mat._origTransparent;
      mat.opacity = mat._origOpacity;
      mat.depthWrite = true;
    }
    mat.needsUpdate = true;
  });
}

// ── Icon Visibility ──────────────────────────────────────────────

/** Show all icon children, apply opacity and scaling.
 *  `labels` toggles the icons' child label sprites: at tiers where many local
 *  entities collapse to the same screen position (heliopause+), legible labels
 *  superimpose into an unreadable smear — gate them off until the clustering
 *  pass (docs/zoom-overlay-patterns.md Phase 3) lands. */
export function showIcons(
  obj: Object3D, opacity: number, camDist: number, fixedSize = true, screenPx = SCREEN_PX,
  labels = true,
): void {
  obj.traverse(child => {
    if (child.userData?.isIcon) {
      const sprite = child as Sprite;
      sprite.visible = true;
      (sprite.material as SpriteMaterial).opacity = opacity;
      if (fixedSize) scaleFixed(sprite, camDist, screenPx);
      else scaleWorld(sprite, camDist);
      for (const ch of sprite.children) {
        if (ch.userData?.isLabel) ch.visible = labels;
      }
    }
  });
}

/** Hide all icon children. */
export function hideIcons(obj: Object3D): void {
  obj.traverse(child => {
    if (child.userData?.isIcon) {
      child.visible = false;
    }
  });
}

// ── Composite State Functions ────────────────────────────────────
// These combine mesh fading and icon visibility into the states
// described by the GDD visual tier system.

/**
 * Surface / close System: mesh at full detail + icons always visible.
 * Icons overlay the geometry at smaller size and reduced opacity
 * so the 3D mesh dominates the visual.
 */
export function meshFull_iconOn(obj: Object3D, camDist: number): void {
  fadeMeshes(obj, 1);
  showIcons(obj, ICON_OPACITY_CLOSE, camDist, true, SCREEN_PX_CLOSE);
}

/**
 * System → Heliopause transition: mesh fades out while icons persist.
 * fadeAmt: 0 = mesh fully visible, 1 = mesh fully transparent.
 */
export function meshFading(
  obj: Object3D, camDist: number, fadeAmt: number, labels = true,
): void {
  fadeMeshes(obj, 1 - MathUtils.clamp(fadeAmt, 0, 1));
  showIcons(obj, ICON_OPACITY, camDist, true, SCREEN_PX, labels);
}

/**
 * Heliopause+: mesh completely hidden, icon-only display.
 * The icon represents the object at all further zoom tiers.
 */
export function iconOnly(obj: Object3D, camDist: number, labels = true): void {
  fadeMeshes(obj, 0);
  showIcons(obj, ICON_OPACITY, camDist, true, SCREEN_PX, labels);
}
