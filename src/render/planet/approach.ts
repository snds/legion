// ═══════════════════════════════════════════════════════════════════
// 1:1 APPROACH — a single true-scale world to fly into (planet v2 Phase 0 review).
//
// The scale/FOV phase only shows in the curated game (planets shrink to specks),
// which is a poor review surface. This mounts ONE Earth-radius ocean world at
// the local origin at TRUE scale and hands back a globe you TRACK + dive into, so
// the 1:1 size + telephoto FOV are obvious in one click. It also previews the
// Phase 7 single-planet view. (Surface faceting is the separate Phase 1 fix — this
// is about scale, not surface quality.)
// ═══════════════════════════════════════════════════════════════════

import { Vector3, type Object3D } from 'three';
import type { GenPlanet } from '../../data/system-gen';
import { PlanetGlobe, type UpdateCtx } from './globe';
import { trueRadiusAuthoring } from '../planet-scale';

const FIXED_SUN = new Vector3(0.5, 0.32, 0.8).normalize(); // even key light
const EARTH: GenPlanet = {
  type: 'ocean', kind: 'rocky', au: 1, massEarth: 1, radiusEarth: 1,
  insolation: 1, isGasGiant: false, hasRings: false, inHZ: true, seed: 20260712,
};

export interface ApproachPlanet {
  /** The world to track (camera frames its true radius). */
  readonly root: Object3D;
  update(ctx: { camera: UpdateCtx['camera']; rootWorld: Vector3; dt: number; fovYRad: number; viewportH: number }): void;
  dispose(): void;
}

/** Mount one true-scale Earth-radius ocean world at the origin of `parent`
 *  (the system-tier local group). */
export function createApproachPlanet(parent: Object3D): ApproachPlanet {
  const radius = trueRadiusAuthoring(EARTH.radiusEarth); // true Earth radius, authoring units
  const globe = new PlanetGlobe(EARTH, radius);
  parent.add(globe.root); // at the local origin
  const _sun = new Vector3();
  return {
    root: globe.root,
    update(ctx) {
      _sun.copy(FIXED_SUN).multiplyScalar(1e4).add(ctx.rootWorld);
      globe.update({ camera: ctx.camera, sunWorldPos: _sun, dt: ctx.dt, fovYRad: ctx.fovYRad, viewportH: ctx.viewportH });
    },
    dispose() { parent.remove(globe.root); globe.dispose(); },
  };
}
