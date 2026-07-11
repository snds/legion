// ═══════════════════════════════════════════════════════════════════
// PLANET GLOBES — public API. Renders a GENERATED system's planets as globes.
//
// docs/procedural-worlds-plan.md P1/P2. Given a GenSystem (Step 0 records) and a
// parent group (the system-tier `layers.local`, scaled by SYSTEM_TIER_SCALE and
// re-rooted by the floating origin each frame), this mounts one PlanetGlobe per
// planet at its orbital position and updates them every frame. Everything rides
// the local tier's transform, so the globes inherit true-scale placement and the
// float-safe floating origin for free (Decision 3 — no bespoke precision work).
//
// The star sits at the local-tier origin, so each planet's sun direction is just
// `normalize(origin − planetWorld)`; the manager passes the star's world position
// (the local root) as sunWorldPos.
// ═══════════════════════════════════════════════════════════════════

import { Vector3, type Object3D } from 'three';
import { AU_TO_WU } from '../../core/metrics';
import { parseSpectral, type GenSystem, type GenPlanet } from '../../data/system-gen';
import { channel, range } from './rng';
import { PlanetGlobe, type UpdateCtx } from './globe';

export { PlanetGlobe } from './globe';
export type { UpdateCtx } from './globe';
export { derivePlanetParams, type PlanetRenderParams } from './presets';
export { generateRings, densityAt, type RingSystem, type RingBand } from './rings';
export * from './cube-sphere';
export * from './lod';

/** Visual radius (local-tier authoring units) from the planet's physical size.
 *  Compressed like the curated catalogue (star-catalog.ts sizes): terrestrials
 *  ~0.2–0.7, giants ~0.65–2.2 — legible at system zoom without dwarfing orbits. */
export function visualRadius(planet: GenPlanet): number {
  const r = planet.radiusEarth;
  const wu = planet.isGasGiant || r >= 3.5
    ? 0.6 + (r - 3.5) * 0.12
    : 0.18 + r * 0.18;
  return Math.max(0.1, Math.min(2.2, wu));
}

/** Orbital position on the ecliptic (XZ plane) at `au`, phase from the seed. */
export function orbitalPosition(planet: GenPlanet, out = new Vector3()): Vector3 {
  const phase = range(channel(planet.seed >>> 0, 'phase'), 0, Math.PI * 2);
  const r = planet.au * AU_TO_WU;
  return out.set(Math.cos(phase) * r, 0, Math.sin(phase) * r);
}

/** Manages the globe set for the currently-mounted generated system. */
export class PlanetGlobes {
  private _globes: PlanetGlobe[] = [];
  private parent: Object3D | null = null;

  get globes(): readonly PlanetGlobe[] { return this._globes; }
  get count(): number { return this._globes.length; }

  /** Build globes for every planet in `gen` and add them to `parent`
   *  (the system-tier local group). Replaces any previously mounted system. */
  mount(gen: GenSystem, parent: Object3D): void {
    this.unmount();
    this.parent = parent;
    for (const planet of gen.planets) {
      const globe = new PlanetGlobe(planet, visualRadius(planet));
      orbitalPosition(planet, globe.root.position);
      parent.add(globe.root);
      this._globes.push(globe);
    }
  }

  /** Per-frame: drive every globe's LOD, lighting and rotation. */
  update(ctx: UpdateCtx): void {
    for (const g of this._globes) g.update(ctx);
  }

  unmount(): void {
    for (const g of this._globes) g.dispose();
    this._globes = [];
    this.parent = null;
  }
}

/**
 * A deterministic VERIFICATION system: one of every render preset plus a ringed
 * gas giant, at spread-out orbits. Used by the main.ts demo hook (behind a URL
 * flag) so the browser check exercises "a few planet types + a gas giant with
 * rings" (procedural-worlds-plan.md P1) without depending on which real catalogue
 * star happens to be focused. Not on any production path.
 */
export function showcaseSystem(): GenSystem {
  const mk = (over: Partial<GenPlanet> & Pick<GenPlanet, 'type' | 'au' | 'seed'>): GenPlanet => ({
    kind: 'rocky', inHZ: false, massEarth: 1, radiusEarth: 1, insolation: 1,
    isGasGiant: false, hasRings: false, ...over,
  });
  const planets: GenPlanet[] = [
    mk({ type: 'lava', au: 0.2, seed: 101, kind: 'rocky', radiusEarth: 1.1, insolation: 12 }),
    mk({ type: 'desert', au: 0.6, seed: 202, kind: 'rocky', radiusEarth: 0.9, insolation: 1.8 }),
    mk({ type: 'ocean', au: 1.0, seed: 303, kind: 'rocky', radiusEarth: 1.0, insolation: 1.0, inHZ: true }),
    mk({ type: 'rocky', au: 1.6, seed: 404, kind: 'super-earth', radiusEarth: 1.7, insolation: 0.4 }),
    mk({ type: 'gas', au: 3.4, seed: 505, kind: 'gas-giant', radiusEarth: 11, massEarth: 300, insolation: 0.09, isGasGiant: true, hasRings: true }),
    mk({ type: 'ice', au: 6.0, seed: 606, kind: 'ice-giant', radiusEarth: 4.2, massEarth: 17, insolation: 0.03, isGasGiant: true, hasRings: true }),
  ];
  return {
    star: parseSpectral('G2V'),
    planets, hzAu: 1, snowAu: 2.7, belts: [],
    habitableCount: planets.filter((p) => p.inHZ).length,
  };
}
