// Sector-cloud prototype harness (Inc 1) — flag-gated, OFF by default so the
// shipped galaxy is unchanged. Enable with ?proto-sector to spawn the home sector
// with a debug boundary cube + markers at its curated systems, proving the
// component API + the float-safe broker framing (the cube sits on home and tracks
// the camera). Cloud volume + generated stars arrive in Inc 2-4.

import {
  BoxGeometry, EdgesGeometry, LineSegments, LineBasicMaterial,
  Mesh, MeshBasicMaterial, SphereGeometry, Vector3,
} from 'three';
import { WU_PER_PC } from '../../core/metrics';
import { galPos } from '../../data/curated-systems';
import { createHomeSector, galPcToSectorLocalWU, updateSectorFrame, type Sector } from './sector';

let _proto: Sector | null = null;

/** ?proto-sector flag (off by default → zero visual change). */
export function sectorPrototypeEnabled(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('proto-sector');
}

/** Build the prototype home sector + debug wireframe cube + per-system markers, or
 *  null when the flag is off. Add the returned .group to the scene root. */
export function createSectorPrototype(): Sector | null {
  if (!sectorPrototypeEnabled()) return null;
  const sector = createHomeSector();

  // Cyan wireframe cube marking the sector AABB (centred at the group's local origin).
  const edgeWU = sector.edgePc * WU_PER_PC;
  const cube = new LineSegments(
    new EdgesGeometry(new BoxGeometry(edgeWU, edgeWU, edgeWU)),
    new LineBasicMaterial({ color: 0x44ccff, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  sector.group.add(cube);

  // A marker at each contained curated system, placed sector-LOCAL.
  const _p = new Vector3();
  const _g = new Vector3();
  for (const s of sector.systems) {
    const g = galPos(s);
    galPcToSectorLocalWU(sector, _g.set(g.x, g.y, g.z), _p);
    const dot = new Mesh(new SphereGeometry(1500, 8, 8), new MeshBasicMaterial({ color: s.color }));
    dot.position.copy(_p);
    sector.group.add(dot);
  }

  console.info(
    `[sector-proto] home sector "${sector.group.name}" — ${sector.systems.length} curated systems:`,
    sector.systems.map((s) => s.name).join(', '),
  );
  _proto = sector;
  return sector;
}

/** Re-root the prototype sector each frame (no-op if disabled). After Broker.beginFrame. */
export function updateSectorPrototype(): void {
  if (_proto) updateSectorFrame(_proto);
}
