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

// Global tier-fade applied to LOCAL body icons (planets/moons/stations/bobs).
// 1 at system tiers; ramped to 0 across the heliopause band by visibility.ts so
// the solar-system icons hand off to the regional star-system markers as the
// camera zooms out (docs/zoom-overlay-patterns.md §4.6).
let localTierFade = 1;
export function setLocalIconTierFade(f: number): void {
  localTierFade = Math.min(1, Math.max(0, f));
}

// ── Apparent-size mesh↔icon LOD (overlay Phase 2) ────────────────
// The master signal is the body's APPARENT screen size, not raw camDist — a
// gas giant and a moon at equal distance have wildly different legibility.
// docs/zoom-overlay-patterns.md §4.1.

/** Body radius in screen pixels at the current FOV. Mirrors scaleFixed's math
 *  inverted: scaleFixed makes worldSize = (px/H)·camDist·FOV_FACTOR, so
 *  px = worldRadius/camDist · H / FOV_FACTOR. */
export function apparentPx(radiusWU: number, camDist: number): number {
  if (camDist <= 1e-6) return 1e6;
  return (radiusWU / camDist) * (window.innerHeight / FOV_FACTOR);
}

// Handoff bands (apparent px). 3=MESH, 2=MESH+ICON, 1=ICON_FADE_IN, 0=ICON.
const BAND_MESH = 64;   // > → mesh only
const BAND_ICON = 15;   // > → mesh + icon overlay
const BAND_FADE = 8;    // > → icon fades in over still-full mesh; ≤ → icon only
const HYST = 0.1;       // symmetric ±10% dead band per boundary

export const ICON_STATE = { ICON: 0, FADE_IN: 1, MESH_ICON: 2, MESH: 3 } as const;

function nominalState(ap: number): number {
  return ap > BAND_MESH ? 3 : ap > BAND_ICON ? 2 : ap > BAND_FADE ? 1 : 0;
}

/**
 * Resolve the LOD state from apparent size with hysteresis, and apply the
 * mesh-fade / icon-visibility for that state. Returns the new state to store
 * per-entity (drives the dead band so parking at a boundary never flickers).
 *
 * iconBias multiplies thresholds: >1 icon-ifies sooner (noisy small meshes),
 * <1 holds the mesh longer (big readable art) — applied as effAp = ap / bias.
 */
export function updateBodyLOD(
  obj: Object3D, camDist: number, radiusWU: number, iconBias: number, prevState: number,
  iconGroupScale = 1,
): number {
  const effAp = apparentPx(radiusWU, camDist) / iconBias;

  // Keep prevState while effAp sits in its hysteresis-widened range; else snap.
  const inRange = (s: number): boolean => {
    if (s < 0 || s > 3) return false; // no prior state → snap to nominal
    if (s === 3) return effAp >= BAND_MESH * (1 - HYST);
    if (s === 2) return effAp >= BAND_ICON * (1 - HYST) && effAp <= BAND_MESH * (1 + HYST);
    if (s === 1) return effAp >= BAND_FADE * (1 - HYST) && effAp <= BAND_ICON * (1 + HYST);
    return effAp <= BAND_FADE * (1 + HYST);
  };
  const state = inRange(prevState) ? prevState : nominalState(effAp);

  switch (state) {
    case 3: // MESH — full mesh, no icon (icon on a fullscreen planet is noise).
      fadeMeshes(obj, 1);
      hideIcons(obj);
      break;
    case 2: // MESH+ICON — full mesh, subtle small icon overlay.
      fadeMeshes(obj, 1);
      showIcons(obj, ICON_OPACITY_CLOSE, camDist, true, SCREEN_PX_CLOSE, true, iconGroupScale);
      break;
    case 1: { // ICON_FADE_IN — icon fades in over the still-full mesh (SupCom).
      fadeMeshes(obj, 1);
      const t = MathUtils.clamp((BAND_ICON - effAp) / (BAND_ICON - BAND_FADE), 0, 1);
      showIcons(obj, t * ICON_OPACITY, camDist, true, SCREEN_PX, true, iconGroupScale);
      break;
    }
    default: // ICON — mesh untouched (sub-pixel, shrinks out); icon only, no labels.
      showIcons(obj, ICON_OPACITY, camDist, true, SCREEN_PX, false, iconGroupScale);
      break;
  }
  return state;
}

/** Per-archetype icon bias (docs §4.1). Corrected PlanetType enum. */
export function iconBiasFor(type: string | undefined, planetTypeId: number | undefined): number {
  if (type === 'bob' || type === 'station') return 1.3;
  if (type === 'moon') return 1.1;
  if (type === 'planet') {
    switch (planetTypeId) {
      case 3: return 0.8;  // GasGiant — hold the mesh longer
      case 4: return 0.9;  // IceGiant
      case 5: return 1.15; // Dwarf — icon-ify sooner
      default: return 1.0; // Rocky / Oceanic / Desert
    }
  }
  return 1.0;
}

// ── Scaling Functions ────────────────────────────────────────────

/**
 * Scale icon to maintain constant screen-pixel size regardless of
 * camera distance. HW2-style: icons stay small and readable,
 * anchored to the 3D object position.
 */
export function scaleFixed(
  icon: Sprite, camDist: number, screenPx = SCREEN_PX, groupScale = 1,
): void {
  if (!icon?.userData) return;
  const aspect = icon.userData.aspect ?? 1.25;
  // World size that produces exactly screenPx pixels on screen. `groupScale`
  // compensates for a uniformly-scaled parent tier: the sprite renders inside a
  // group scaled by `groupScale` (the local tier rides SYSTEM_TIER_SCALE), so
  // set the local scale to worldSize/groupScale for the on-screen size to land.
  const worldSize = (screenPx / window.innerHeight) * camDist * FOV_FACTOR / groupScale;
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
  labels = true, groupScale = 1,
): void {
  obj.traverse(child => {
    if (child.userData?.isIcon) {
      const sprite = child as Sprite;
      const op = opacity * localTierFade; // tier-fade hands local icons off at heliopause
      sprite.visible = op > 0.005;
      (sprite.material as SpriteMaterial).opacity = op;
      if (fixedSize) scaleFixed(sprite, camDist, screenPx, groupScale);
      else scaleWorld(sprite, camDist);
      for (const ch of sprite.children) {
        if (ch.userData?.isLabel) ch.visible = labels && sprite.visible;
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
