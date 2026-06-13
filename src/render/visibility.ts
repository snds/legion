// ═══════════════════════════════════════════════════════════════════
// LAYER VISIBILITY — Per-Zoom-Tier Visibility Management
// Controls which layer groups and scene objects are visible based
// on the current zoom domain. Matches the monolithic prototype's
// per-frame visibility update across all 6 tiers.
//
// Simplified from the monolithic's fine-grained per-object fading
// to group-level visibility, which covers the visual parity goal.
// Per-object fading and icon system are deferred to optimization.
// ═══════════════════════════════════════════════════════════════════

import { Game, type DomainName, getCamDist } from '../core/state';
import { Events } from '../core/events';
import { Notifications } from '../ui/notifications';
import type { LayerGroups } from './scene';
import type { Group, Points, PointsMaterial, Sprite, SpriteMaterial } from 'three';
import { getGalaxyOffset } from './galaxy';
import { HELIOPAUSE_RADIUS_WU } from './particles';
import {
  updateBodyLOD, iconBiasFor, scaleFixed, setLocalIconTierFade,
} from './icon-system';

// Heliopause icon-set hand-off ramp: 0 below 1800 WU (local body icons full,
// regional star-system markers hidden) → 1 above 3200 WU (local icons gone,
// regional markers full). Spans the heliopause band into early sector so the
// solar-system icons cross-fade into the star-system markers as one motion.
const SWAP_IN = 1800;
const SWAP_OUT = 3200;
const REGIONAL_ICON_PX = 24; // screen-constant marker size (docs §4.6)
function heliopauseSwap(camDist: number): number {
  if (camDist <= SWAP_IN) return 0;
  if (camDist >= SWAP_OUT) return 1;
  const t = (camDist - SWAP_IN) / (SWAP_OUT - SWAP_IN);
  return t * t * (3 - 2 * t);
}

// ── Extra Scene References ───────────────────────────────────────
// Set during init — these are groups outside the standard layers
// that need per-tier visibility control.

interface VisibilityTargets {
  layers: LayerGroups;
  eclipticGrid: Group | null;
  oortCloud: Group | null;
  galaxyArms: Group | null;
  sectorOrb: Group | null;
}

let targets: VisibilityTargets | null = null;
let lastDomain: DomainName | null = null;

// ── Visibility Rules Per Domain ───────────────────────────────────

function applyDomain(domain: DomainName): void {
  if (!targets) return;
  const { layers, eclipticGrid, oortCloud, galaxyArms, sectorOrb } = targets;

  // Asteroid belt is a band inside the local layer. It only reads as
  // meaningful content when the system disc is the subject — surface/
  // low-orbit close-up shots get a distracting horizontal stripe at the
  // top of the frame, so hide it there too.
  const belt = layers.local.getObjectByName('asteroid-belt');
  if (belt) {
    belt.visible =
      domain === 'orbit' || domain === 'inner-system' || domain === 'outer-system';
  }

  // Defaults: everything off, then selectively enable
  layers.local.visible = false;
  layers.regional.visible = false;
  layers.galactic.visible = false;
  if (eclipticGrid) eclipticGrid.visible = false;
  if (oortCloud) oortCloud.visible = false;
  if (galaxyArms) galaxyArms.visible = false;
  if (sectorOrb) sectorOrb.visible = false;

  // Background always visible but opacity changes per tier
  layers.background.visible = true;

  switch (domain) {
    case 'surface':
    case 'low-orbit':
      // Planet-scale views: local layer only, no overlays/grids.
      // Background starfield stays full so the sky reads correctly.
      layers.local.visible = true;
      setBackgroundOpacity(0.85, 0.25);
      break;

    case 'orbit':
      // Out past the first moon — show local objects (stations, ships,
      // moons) but no ecliptic grid yet (it's distracting at this scale).
      layers.local.visible = true;
      setBackgroundOpacity(0.85, 0.25);
      break;

    case 'inner-system':
      // Star + inner planets + their full orbital paths. Ecliptic grid
      // is meaningful here for orientation across multiple orbits.
      layers.local.visible = true;
      if (eclipticGrid) eclipticGrid.visible = true;
      setBackgroundOpacity(0.85, 0.25);
      break;

    case 'outer-system':
      // Everything in the system — primary planets, comets, Oort cloud.
      layers.local.visible = true;
      if (eclipticGrid) eclipticGrid.visible = true;
      if (oortCloud) oortCloud.visible = true;
      setBackgroundOpacity(0.85, 0.20);
      break;

    case 'heliopause':
      // System bubble + the 2-3 nearest navigable neighbors. Both local
      // and regional shown; per-marker proximity ramping handled below.
      layers.local.visible = true;
      layers.regional.visible = true;
      if (oortCloud) oortCloud.visible = true;
      setBackgroundOpacity(0.7, 0.18);
      break;

    case 'sector':
      // ~10-12 nearby systems within the local arm patch + tactical
      // sensor bubble (volumetric orb) showing the sector boundary.
      // Galaxy disc is ALSO enabled here — its opacity is ramped from
      // 0 → 1 across the sector→arm range by updateGalaxyLOD() so the
      // disc fades into view smoothly as we zoom out, rather than
      // popping on at the arm tier boundary.
      layers.local.visible = true;
      layers.regional.visible = true;
      if (sectorOrb) sectorOrb.visible = true;
      if (galaxyArms) galaxyArms.visible = true;
      setBackgroundOpacity(0.5, 0.12);
      break;

    case 'arm':
      // Immersed inside the Orion Spur — galactic particles dominate
      // the field of view, regional system markers float as nav targets.
      // Force a near-in-plane camera angle so the disc surrounds us
      // (galaxy tier left phi at 0.35 = top-down; arm wants horizon-level).
      layers.regional.visible = true;
      layers.galactic.visible = true;
      if (galaxyArms) galaxyArms.visible = true;
      setBackgroundOpacity(0.20, 0.06);
      Game.data.targetPhi = 1.3;
      break;

    case 'galaxy': {
      // Full Milky Way disc. At this tier the camera needs both:
      //   1. focus on the galaxy center (Sgr A*) so the disc is framed
      //      symmetrically — otherwise it sits off to one side.
      //   2. a near-top-down polar angle (phi ≈ 0.35 rad ≈ 20° from
      //      top) so the disc isn't viewed near edge-on. Without this
      //      the paper-thin disc collapses into a horizontal line.
      layers.galactic.visible = true;
      if (galaxyArms) galaxyArms.visible = true;
      setBackgroundOpacity(0.08, 0.02);
      const sgr = getGalaxyOffset();
      Events.emit('camera:focus-on', { x: sgr.x, y: sgr.y, z: sgr.z });
      Game.data.targetPhi = 0.35;
      break;
    }
  }
}

/** Fade background stars at outer zoom tiers. (The legacy 'milky-way' band
 *  was deleted in the same commit as the baked-cubemap backdrop; the second
 *  parameter is kept so per-domain call sites remain untouched until the
 *  Phase-4 crossfade reworks them.) */
function setBackgroundOpacity(starsOp: number, _milkyOp: number): void {
  if (!targets) return;
  targets.layers.background.traverse(child => {
    if ((child as Points).isPoints && (child as Points).material) {
      const mat = (child as Points).material as PointsMaterial & {
        uniforms?: { uOpacity?: { value: number } };
      };
      if (child.name === 'background-stars') {
        // The real-sky field is a ShaderMaterial (uOpacity uniform); the
        // fallback path keeps PointsMaterial.opacity for any other field.
        if (mat.uniforms?.uOpacity) mat.uniforms.uOpacity.value = starsOp;
        else mat.opacity = starsOp;
      }
    }
  });
}

// ── Strategic Overlay ────────────────────────────────────────────
// G key toggle — shows ecliptic grid + distance aids at system/helio.

function applyOverlay(overlayOn: boolean, domain: DomainName): void {
  if (!targets) return;
  const { eclipticGrid } = targets;

  // Overlay (G key) is meaningful at the orbit / inner-system / outer-system
  // / heliopause tiers — anywhere the player is reasoning about orbital paths.
  const isRelevant =
    domain === 'orbit' || domain === 'inner-system' ||
    domain === 'outer-system' || domain === 'heliopause';

  if (eclipticGrid && isRelevant) {
    // outer-system always shows grid; others rely on G toggle
    eclipticGrid.visible = overlayOn || domain === 'outer-system' || domain === 'inner-system';
  }
}

// ── Public API ───────────────────────────────────────────────────

export function initVisibility(
  layers: LayerGroups,
  eclipticGrid: Group | null,
  oortCloud: Group | null,
  galaxyArms: Group | null,
  sectorOrb: Group | null = null,
): void {
  targets = { layers, eclipticGrid, oortCloud, galaxyArms, sectorOrb };
  lastDomain = null;

  // Wire overlay toggle notification
  Events.on('camera:zoom-changed', () => {
    // Domain changed — will be picked up on next updateVisibility()
  });
}

/**
 * Called each frame. Checks if domain changed and applies visibility.
 * Also applies overlay state and per-object icon scaling.
 */
export function updateVisibility(): void {
  const domain = Game.data.zoomDomain;
  const overlayOn = Game.data.overlayMode;

  if (domain !== lastDomain) {
    lastDomain = domain;
    applyDomain(domain);
  }

  applyOverlay(overlayOn, domain);

  // Heliopause orb is external-facing ONLY: show it once the camera is outside
  // the shell (camDist ≥ radius). Inside the shell a translucent sphere wall
  // fills the viewport and tints the whole interior, so it must stay hidden
  // until the player has zoomed out past it.
  updateHeliopauseGate();

  // Heliopause icon-set hand-off: fade local body icons OUT and the regional
  // star-system markers IN across the same camDist window, as one cross-fade.
  const swap = heliopauseSwap(Game.data.camDist);
  setLocalIconTierFade(1 - swap);

  // Per-object icon/mesh state — runs every frame for smooth transitions
  updateIconStates(domain);

  // Regional star-system markers (incl. Sol): screen-constant size + fade-in.
  // Runs whenever the regional layer is visible (heliopause → arm), independent
  // of the local layer (which is off at arm tier).
  updateRegionalMarkers(Game.data.camDist, swap);
}

function updateRegionalMarkers(camDist: number, swap: number): void {
  if (!targets) return;
  const regional = targets.layers.regional;
  if (!regional.visible) return;
  const show = swap > 0.005;
  for (const marker of regional.children) {
    if (marker.userData?.type !== 'system') continue;
    marker.visible = show;
    if (!show) continue;
    marker.traverse(c => {
      if (c.userData?.isIcon) {
        const sp = c as Sprite;
        scaleFixed(sp, camDist, REGIONAL_ICON_PX);
        (sp.material as SpriteMaterial).opacity = swap * 0.95;
      } else if (c.userData?.isStemPart) {
        // Out-of-plane stem line — fade in with the markers, kept dim.
        ((c as unknown as { material: { opacity: number } }).material).opacity = swap * 0.4;
      }
    });
  }
}

let heliopauseMesh: Group | null = null;
function updateHeliopauseGate(): void {
  if (!targets) return;
  const local = targets.layers.local;
  if (!heliopauseMesh) {
    heliopauseMesh = local.getObjectByName('heliopause') as Group | null;
    if (!heliopauseMesh) return;
  }
  heliopauseMesh.visible = local.visible && Game.data.camDist >= HELIOPAUSE_RADIUS_WU;
}

// ── Per-Object Icon State ────────────────────────────────────────
// Iterates local-layer children and applies the Homeworld-style
// mesh/icon crossfade based on zoom domain and camera distance.

function updateIconStates(_domain: DomainName): void {
  if (!targets) return;
  const camDist = Game.data.camDist;

  // Only local-layer objects have mesh+icon pairs
  const local = targets.layers.local;
  if (!local.visible) return;

  // Apparent-size mesh↔icon handoff with per-entity hysteresis (overlay
  // Phase 2). Replaces the per-domain camDist half/full-fade: each body now
  // switches on its OWN on-screen size, so a Dwarf icon-ifies sooner than a
  // GasGiant at equal distance, and parking at a boundary never flickers.
  for (const child of local.children) {
    const hasIcon = child.children?.some(c => c.userData?.isIcon);
    if (!hasIcon) continue;
    const ud = child.userData as Record<string, unknown>;
    const radiusWU = ((ud.bodyRadius as number) ?? 1) * child.scale.x;
    const bias = iconBiasFor(ud.type as string | undefined, ud.planetTypeId as number | undefined);
    const prev = (ud._iconState as number) ?? -1;
    ud._iconState = updateBodyLOD(child, camDist, radiusWU, bias, prev);
  }
}
