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
}

let targets: VisibilityTargets | null = null;
let lastDomain: DomainName | null = null;

// ── Visibility Rules Per Domain ───────────────────────────────────

function applyDomain(domain: DomainName): void {
  if (!targets) return;
  const { layers, eclipticGrid, oortCloud, galaxyArms } = targets;

  // Defaults: everything off, then selectively enable
  layers.local.visible = false;
  layers.regional.visible = false;
  layers.galactic.visible = false;
  if (eclipticGrid) eclipticGrid.visible = false;
  if (oortCloud) oortCloud.visible = false;
  if (galaxyArms) galaxyArms.visible = false;

  // Background always visible but opacity changes per tier
  layers.background.visible = true;

  switch (domain) {
    case 'surface':
      layers.local.visible = true;
      setBackgroundOpacity(0.85, 0.25);
      break;

    case 'system':
      layers.local.visible = true;
      if (eclipticGrid) eclipticGrid.visible = true;
      setBackgroundOpacity(0.85, 0.25);
      break;

    case 'heliopause':
      layers.local.visible = true;
      if (eclipticGrid) eclipticGrid.visible = true;
      if (oortCloud) oortCloud.visible = true;
      setBackgroundOpacity(0.85, 0.25);
      break;

    case 'sector':
      layers.local.visible = true;
      layers.regional.visible = true;
      if (oortCloud) oortCloud.visible = true;
      setBackgroundOpacity(0.6, 0.15);
      break;

    case 'arm':
      layers.regional.visible = true;
      layers.galactic.visible = true;
      if (galaxyArms) galaxyArms.visible = true;
      // Dim background stars so galaxy particles dominate
      setBackgroundOpacity(0.15, 0.04);
      break;

    case 'galaxy':
      layers.galactic.visible = true;
      if (galaxyArms) galaxyArms.visible = true;
      // Very dim — galaxy provides all the visual density now
      setBackgroundOpacity(0.08, 0.02);
      break;
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

  // Overlay only meaningful at system and heliopause tiers
  const isRelevant = domain === 'system' || domain === 'heliopause';

  if (eclipticGrid && isRelevant) {
    eclipticGrid.visible = overlayOn || domain === 'heliopause';
  }
}

// ── Public API ───────────────────────────────────────────────────

export function initVisibility(
  layers: LayerGroups,
  eclipticGrid: Group | null,
  oortCloud: Group | null,
  galaxyArms: Group | null,
): void {
  targets = { layers, eclipticGrid, oortCloud, galaxyArms };
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
      case 'system':
        // Mesh at full opacity + icons as subtle overlays
        meshFull_iconOn(child, camDist);
        break;

      case 'heliopause': {
        // Mesh fades out as camera pulls back (0 at near edge, 1 at far edge)
        // Heliopause range: camDist 409–1399
        const fadeAmt = Math.max(0, (camDist - 409) / 990);
        meshFading(child, camDist, fadeAmt);
        break;
      }

      case 'sector':
        // Mesh gone, icon only
        iconOnly(child, camDist);
        break;

      default:
        // arm/galaxy — local layer is hidden, but in case it's visible
        hideIcons(child);
        break;
    }
  }
}
