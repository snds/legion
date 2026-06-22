// ═══════════════════════════════════════════════════════════════════
// EXOPLANETS — real confirmed planets for nearby hosts (NASA Exoplanet Archive)
//
// Loads public/exoplanets-v1.json (built by scripts/build-exoplanets.mjs from
// the Archive's pscomppars within 30 pc; public domain). Indexes hosts by
// cross-match key so a navigable catalogue star (star-systems.ts) can resolve
// its REAL planets where they exist, overriding the generated set
// (system-gen.ts). Curated home systems never reach this path.
//
// Key format MUST match build-exoplanets.mjs `hostKeys`:
//   hip:<digits> · hd:<digits> · gj:<number+optional ab, lowercased> · name:<lower>
// ═══════════════════════════════════════════════════════════════════

import { asset } from '../core/assets';

export interface RealPlanet {
  n: string;            // planet letter / name ("b", "c", …)
  rade: number | null;  // radius, Earth radii
  masse: number | null; // mass, Earth masses
  per: number | null;   // orbital period, days
  smax: number | null;  // semi-major axis, AU
  method: string;       // discovery method
}
interface Host { name: string; keys: string[]; planets: RealPlanet[]; }

let index: Map<string, Host> | null = null;
let loadPromise: Promise<void> | null = null;

/** Fetch + index the real-planet sidecar (idempotent). Safe if the file is
 *  missing — resolution simply finds nothing and the generated set is used. */
export function loadExoplanets(): Promise<void> {
  if (index) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = fetch(asset('exoplanets-v1.json'))
    .then((r) => (r.ok ? r.json() : { hosts: [] }))
    .then((j: { hosts: Host[] }) => {
      index = new Map();
      for (const h of j.hosts) for (const k of h.keys) if (!index.has(k)) index.set(k, h);
    })
    .catch((e) => { console.warn('[Exoplanets] load failed:', e); index = new Map(); });
  return loadPromise;
}

/** Cross-match keys for a catalogue star, from its name + designations. Pure;
 *  mirrors the build-side `hostKeys`. Exported for testing. */
export function starKeys(name: string, desig: string): string[] {
  const out = new Set<string>();
  if (name) out.add('name:' + name.toLowerCase().replace(/\s+/g, ' ').trim());
  for (const d of (desig || '').split('·').map((s) => s.trim())) {
    const gj = d.match(/^(?:Gl|GJ|Gliese|NN)\s*([\dAB.]+)/i);
    if (gj) out.add('gj:' + gj[1].toLowerCase().replace(/\s+/g, ''));
    const hd = d.match(/^HD\s*(\d+)/i); if (hd) out.add('hd:' + hd[1]);
    const hip = d.match(/^HIP\s*(\d+)/i); if (hip) out.add('hip:' + hip[1]);
  }
  return [...out];
}

/** Real planets for a star, or null if the archive has none / isn't loaded. */
export function realPlanetsFor(name: string, desig: string): RealPlanet[] | null {
  if (!index) return null;
  for (const k of starKeys(name, desig)) {
    const h = index.get(k);
    if (h) return h.planets;
  }
  return null;
}
