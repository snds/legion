// ═══════════════════════════════════════════════════════════════════
// SECTOR TOUR — hands-free node-to-node fly-through of a sector's systems (Inc 6).
//
// Flies the camera between the sector's curated systems in nearest-neighbour order,
// looping, so you can watch the cloud thin/thicken and the stars resolve as the camera
// moves node to node. Abstract over the camera (flyTo / isFlying injected) so this stays
// render-agnostic + the ordering is unit-testable. Flag-gated; driven from main.ts.
// ═══════════════════════════════════════════════════════════════════

import { type CuratedSystem } from '../../data/curated-systems';

function solDist2(a: CuratedSystem, b: CuratedSystem): number {
  const dx = a.solPc.x - b.solPc.x, dy = a.solPc.y - b.solPc.y, dz = a.solPc.z - b.solPc.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Visit order: nearest-neighbour starting at home → a smooth path (no big jumps). */
export function sectorTourOrder(systems: CuratedSystem[]): CuratedSystem[] {
  if (systems.length <= 1) return systems.slice();
  const remaining = systems.slice();
  let idx = remaining.findIndex((s) => s.isHome);
  if (idx < 0) idx = 0;
  const order: CuratedSystem[] = [remaining.splice(idx, 1)[0]!];
  while (remaining.length) {
    const last = order[order.length - 1]!;
    let best = 0;
    let bestD = Infinity;
    for (let j = 0; j < remaining.length; j++) {
      const d = solDist2(last, remaining[j]!);
      if (d < bestD) { bestD = d; best = j; }
    }
    order.push(remaining.splice(best, 1)[0]!);
  }
  return order;
}

export interface SectorTourOpts {
  systems: CuratedSystem[];
  /** Start a flight to this system at the given zoom level (0..1). */
  flyTo: (sys: CuratedSystem, zoomLevel: number) => void;
  /** True while a flight is in progress (camCtrl.flying). */
  isFlying: () => boolean;
  zoomLevel?: number;   // default HELIOPAUSE (0.53) — systems prominent, cloud thinned around you
  dwellMs?: number;     // pause at each stop
  maxFlightMs?: number; // per-hop safety timeout
}

export interface SectorTourHandle { stop: () => void; }

/** Run the looping node-to-node tour (browser-only — uses timers). Returns a stop handle.
 *  One clean beat per system: fly there, dwell, on to the nearest next. The cloud thins as
 *  you arrive (it's the unresolved-star aggregate); pull back any time to watch it thicken. */
export function runSectorTour(opts: SectorTourOpts): SectorTourHandle {
  const order = sectorTourOrder(opts.systems);
  const zoom = opts.zoomLevel ?? 0.53;
  const dwell = opts.dwellMs ?? 2400;
  const maxFlight = opts.maxFlightMs ?? 9000;
  let stopped = false;

  const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
  void (async () => {
    let i = 0;
    while (!stopped && order.length) {
      opts.flyTo(order[i % order.length]!, zoom);
      const t0 = Date.now();
      await sleep(80); // let flyTo set flightState
      while (opts.isFlying() && !stopped && Date.now() - t0 < maxFlight) await sleep(100);
      if (stopped) break;
      await sleep(dwell);
      i++;
    }
  })();

  return { stop: () => { stopped = true; } };
}
