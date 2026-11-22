// ═══════════════════════════════════════════════════════════════════
// CONTINUUM REGISTRY — per-frame driver for real-game (non-Lab) globes
//
// P2-0 cold-start fix #1: `ContinuumGlobe.setViewDistanceAu()` — the API that
// throttles the idle "polish" resolution ceiling by real camera distance —
// was previously wired ONLY from the Lab (`planet-lab.ts`) and the accept
// harness (`accept-api.ts`), never from the real game boot. `viewAu` stayed
// pinned at its hardcoded constructor default (0.8) forever in real
// gameplay, so the polish climb had no distance ceiling once the player
// stopped near a planet.
//
// This module is the real-game equivalent of planet-lab.ts's own per-globe
// `setViewDistanceAu` + `update` loop (planet-lab.ts:751-756), generalized to
// any number of concurrently-live real ContinuumGlobe instances instead of
// the Lab's single selected globe. `system-loader.ts` registers a globe when
// it mounts one for a catalogue body and unregisters it on dispose; `main.ts`
// drives `updateContinuumGlobes()` once per frame, unconditionally (works for
// any loadable system, not just Sol/EE — the registry has no per-system
// knowledge at all).
//
// Lab-owned globes (`planet-lab.ts`, `continuum/accept-api.ts`) are NOT
// registered here — they keep their own private update loop, so this
// registry only ever drives real-game globes, never double-updating a Lab
// instance or pulling it into the main loop when the Lab isn't even active.
// ═══════════════════════════════════════════════════════════════════

import { Vector3 } from 'three';
import { Game, physicalAuFromZoom } from '../../../core/state';
import type { UpdateCtx } from '../globe';
import type { ContinuumGlobe } from './index';

const active = new Set<ContinuumGlobe>();

/** Start driving a real-game ContinuumGlobe from the main per-frame loop. */
export function registerContinuumGlobe(globe: ContinuumGlobe): void {
  active.add(globe);
}

/** Stop driving a globe (call before/when disposing it). Safe to call twice. */
export function unregisterContinuumGlobe(globe: ContinuumGlobe): void {
  active.delete(globe);
}

/** Test/HUD hook — how many real-game Continuum globes are currently live. */
export function activeContinuumGlobeCount(): number {
  return active.size;
}

// ── Planetshine (P2-18) ──────────────────────────────────────────
// Real per-frame nearest-parent planetshine for routed Continuum moons.
// Mirrors legacy objects.ts's updatePlanetShaders bounce computation (same
// PLANETSHINE_GAIN/MAX, same nearest-by-distance + inverse-square falloff)
// but keyed off `root.userData.isMoon` (stamped by ContinuumGlobe's own
// constructor) instead of a legacy-only `trackedPlanets` list, so it drives
// ANY registered moon/planet pair generically — no per-body name
// special-casing, and it degrades to a no-op if a moon has no registered
// Continuum parent (setPlanetshine simply never gets called that frame).
const PLANETSHINE_GAIN = 2.5;
const PLANETSHINE_MAX = 0.22;
const _moonWorld = new Vector3();
const _parentWorld = new Vector3();
const _worldScale = new Vector3();
const _bounceVec = new Vector3();

function updatePlanetshine(): void {
  if (active.size < 2) return; // need at least one moon + one planet
  const moons: ContinuumGlobe[] = [];
  const planets: ContinuumGlobe[] = [];
  for (const g of active) {
    (g.root.userData.isMoon ? moons : planets).push(g);
  }
  if (moons.length === 0 || planets.length === 0) return;

  for (const moon of moons) {
    moon.root.getWorldPosition(_moonWorld);
    let nearest: ContinuumGlobe | null = null;
    let bestDsq = Infinity;
    for (const p of planets) {
      p.root.getWorldPosition(_parentWorld);
      const dsq = _parentWorld.distanceToSquared(_moonWorld);
      if (dsq < bestDsq) { bestDsq = dsq; nearest = p; }
    }
    if (!nearest) continue;

    nearest.root.getWorldPosition(_parentWorld);
    nearest.root.getWorldScale(_worldScale);
    _bounceVec.copy(_parentWorld).sub(_moonWorld);
    const dist = Math.max(_bounceVec.length(), 1e-4);
    _bounceVec.multiplyScalar(1 / dist);
    const parentRadius = nearest.radius * _worldScale.x;
    const ratio = parentRadius / dist;
    const strength = Math.min(PLANETSHINE_GAIN * ratio * ratio, PLANETSHINE_MAX);
    moon.setPlanetshine(
      [_bounceVec.x, _bounceVec.y, _bounceVec.z],
      nearest.bounceColorRGB,
      strength,
    );
  }
}

/**
 * Per-frame update for every registered real-game ContinuumGlobe. Mirrors
 * planet-lab.ts's own per-globe `setViewDistanceAu` + `update` pump so the
 * polish LOD ceiling is throttled by the real camera distance in gameplay,
 * not just in the Lab/QA-harness paths. Also drives real planetshine (P2-18)
 * for any registered moon after every body's own update() has run this frame.
 */
export function updateContinuumGlobes(ctx: UpdateCtx): void {
  if (active.size === 0) return;
  const au = physicalAuFromZoom(Game.data.zoomLevel);
  for (const g of active) {
    g.setViewDistanceAu(au);
    g.update(ctx);
  }
  updatePlanetshine();
}
