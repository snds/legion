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
import type { Group, Points, PointsMaterial } from 'three';
import { getGalaxyOffset } from './galaxy';
import {
  meshFull_iconOn, meshFading, iconOnly, hideIcons,
} from './icon-system';

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

/** Fade background stars and milky way band at outer zoom tiers. */
function setBackgroundOpacity(starsOp: number, milkyOp: number): void {
  if (!targets) return;
  targets.layers.background.traverse(child => {
    if ((child as Points).isPoints && (child as Points).material) {
      const mat = (child as Points).material as PointsMaterial;
      if (child.name === 'background-stars') {
        mat.opacity = starsOp;
      } else if (child.name === 'milky-way') {
        mat.opacity = milkyOp;
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

  // Per-object icon/mesh state — runs every frame for smooth transitions
  updateIconStates(domain);
}

// ── Per-Object Icon State ────────────────────────────────────────
// Iterates local-layer children and applies the Homeworld-style
// mesh/icon crossfade based on zoom domain and camera distance.

function updateIconStates(domain: DomainName): void {
  if (!targets) return;
  const camDist = Game.data.camDist;

  // Only local-layer objects have mesh+icon pairs
  const local = targets.layers.local;
  if (!local.visible) return;

  for (const child of local.children) {
    // Only process groups that have icon children
    const hasIcon = child.children?.some(c => c.userData?.isIcon);
    if (!hasIcon) continue;

    switch (domain) {
      case 'surface':
      case 'low-orbit':
      case 'orbit':
      case 'inner-system':
        // Close-in tiers — mesh at full opacity, icons as subtle overlays.
        meshFull_iconOn(child, camDist);
        break;

      case 'outer-system': {
        // Slight mesh fade across the outer-system tier so distant bodies
        // start handing off to icons. Range matches getCamDist (120..1000).
        const fadeAmt = Math.max(0, Math.min(1, (camDist - 120) / 880));
        meshFading(child, camDist, fadeAmt * 0.5); // half-fade only
        break;
      }

      case 'heliopause': {
        // Mesh fades out as camera pulls back. Range: camDist 1000..6000.
        // Labels OFF: local entities collapse to ~the same screen position at
        // this distance, so legible labels superimpose into a smear. Clustered
        // labels return with the decluttering pass (zoom-overlay doc Phase 3).
        const fadeAmt = Math.max(0, Math.min(1, (camDist - 1000) / 5000));
        meshFading(child, camDist, fadeAmt, false);
        break;
      }

      case 'sector':
        // Mesh gone, icon only. Labels off (same stacking rationale).
        iconOnly(child, camDist, false);
        break;

      default:
        // arm / galaxy — local layer is hidden anyway; belt-and-suspenders.
        hideIcons(child);
        break;
    }
  }
}
