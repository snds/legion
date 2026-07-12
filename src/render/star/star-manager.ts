// ═══════════════════════════════════════════════════════════════════
// STAR MANAGER — install + drive the procedural star for the active system
//
// The single seam main.ts hooks. Each frame it is handed the active local
// system's scene groups; it locates the star group (created by objects.ts
// createStarMesh — off-limits to edit), and on first sight / system swap it:
//   1. reads the star's physical record from the group's own userData
//      (spectralType + name) via Step 0's parseSpectral — no galaxy-tier
//      plumbing needed at the local tier;
//   2. hides the legacy 'sun-system' subgroup (augment/replace, no edit to
//      objects.ts or sun.ts);
//   3. builds the procedural star and parents it under the star group, so it
//      inherits the group's position, SYSTEM_TIER_SCALE and floating origin.
// Thereafter it just advances the animation + LOD each frame.
//
// updateSystemStar() returns true while it is driving a star, so main.ts can
// skip the legacy updateSunSystem() call (and its per-frame cubemap render).
// ═══════════════════════════════════════════════════════════════════

import type { Camera, Group, Object3D } from 'three';
import { createProceduralStar, type ProceduralStar } from './procedural-star';
import { starRecordFromSpectral, type StarRecord } from './star-physics';

interface Installed {
  starGroup: Object3D;
  star: ProceduralStar;
  legacySun: Object3D | null;
}

let installed: Installed | null = null;

/** Dev/QA: `?starType=M5V` (or O5V/B2V/A0V/F5V/K7V…) overrides the active
 *  star's spectral type so every class can be verified in the browser even
 *  though only Sol (G) and ε Eri (K) have authored local tiers. No-op headless. */
function starTypeOverride(): string | null {
  if (typeof location === 'undefined') return null;
  try {
    return new URLSearchParams(location.search).get('starType');
  } catch {
    return null;
  }
}

function findStarGroup(groups: readonly Object3D[] | null | undefined): Object3D | null {
  if (!groups) return null;
  for (const g of groups) {
    if (g.userData?.type === 'star') return g;
  }
  return null;
}

/** Derive the render record from the star group's own metadata (+ dev override). */
function recordForGroup(starGroup: Object3D): StarRecord {
  const name = (starGroup.userData?.name as string) ?? 'star';
  const spectral = starTypeOverride() ?? (starGroup.userData?.spectralType as string) ?? 'G2V';
  return starRecordFromSpectral(spectral, name);
}

function bodyRadiusOf(starGroup: Object3D): number {
  const r = starGroup.userData?.bodyRadius;
  return typeof r === 'number' && r > 0 ? r : 0.35;
}

/** Tear down the current install (system swap / HMR / dispose). */
export function disposeSystemStar(): void {
  if (!installed) return;
  installed.starGroup.remove(installed.star.group);
  installed.star.dispose();
  if (installed.legacySun) installed.legacySun.visible = true; // restore on teardown
  installed = null;
}

/**
 * Install (lazily, on star-group change) and update the procedural star for the
 * active system. Returns true while a star is being driven — main.ts uses that
 * to skip the legacy sun updater.
 */
export function updateSystemStar(
  groups: readonly Object3D[] | null | undefined,
  dt: number,
  camera: Camera,
  camDistWU: number,
  timeScale = 1,
): boolean {
  const starGroup = findStarGroup(groups);

  // System swapped (or star disposed): tear the old install down.
  if (installed && installed.starGroup !== starGroup) disposeSystemStar();

  if (!starGroup) return false;

  if (!installed) {
    const legacySun = (starGroup as Group).getObjectByName('sun-system') ?? null;
    if (legacySun) legacySun.visible = false; // replace the legacy mesh
    const star = createProceduralStar({
      record: recordForGroup(starGroup),
      bodyRadiusWU: bodyRadiusOf(starGroup),
    });
    starGroup.add(star.group);
    installed = { starGroup, star, legacySun };
  }

  installed.star.update(dt, camera, camDistWU, timeScale);
  return true;
}

/** Force a record refresh for the active star (e.g. after a dev override
 *  change). Safe to call anytime; no-op when nothing is installed. */
export function refreshSystemStarRecord(): void {
  if (!installed) return;
  installed.star.setRecord(recordForGroup(installed.starGroup));
}
