// ═══════════════════════════════════════════════════════════════════
// STAR SYSTEMS — the navigable nearby catalogue (real stars)
//
// Loads public/star-systems-v1.json — every HYG v3.8 star within 25 pc
// (~81.6 ly), with its real proper name / catalogue designations
// (Gliese · HD · HIP) / spectral type / constellation / distance / 3D
// position. Built by scripts/build-star-catalog.mjs (CC BY-SA 4.0).
//
// This is the real-data layer beneath the galactic map: the curated home
// systems (src/data/star-catalog.ts) stay hand-authored + photorealistic;
// these ~3k catalogue stars become navigable systems whose details are
// GENERATED on demand from their spectral type (src/data/system-gen.ts,
// Phase 2). Stars beyond this volume are procedurally generated.
//
// Positions are in PARSECS on the game axes (galactic plane in XZ, NGP +Y),
// matching star-field.ts. Consumers scale to world units for the tier.
// ═══════════════════════════════════════════════════════════════════

import { asset } from '../core/assets';

export interface CatalogStar {
  name: string;    // proper name, else Bayer/Flamsteed, else a catalogue designation
  desig: string;   // catalogue designations joined by " · " (e.g. "Gl 559A · HD 128620 · HIP 71683")
  spect: string;   // spectral type as catalogued (e.g. "G2V", "M5Ve", "K1V"); may be ""
  con: string;     // constellation abbreviation (e.g. "Cen"); may be ""
  distLy: number;  // distance from Sol in light-years
  x: number; y: number; z: number; // parsecs, game axes
  mag: number;     // apparent magnitude
  ci: number;      // B−V colour index
}

interface RawStar {
  n: string; d: string; s: string; con: string;
  ly: number; x: number; y: number; z: number; m: number; ci: number;
}

let catalog: CatalogStar[] | null = null;
let loadPromise: Promise<CatalogStar[]> | null = null;

/** Fetch + cache the navigable nearby catalogue (idempotent). */
export function loadStarSystems(): Promise<CatalogStar[]> {
  if (catalog) return Promise.resolve(catalog);
  if (loadPromise) return loadPromise;
  loadPromise = fetch(asset('star-systems-v1.json'))
    .then((r) => { if (!r.ok) throw new Error(`star systems ${r.status}`); return r.json(); })
    .then((j: { stars: RawStar[] }) => {
      catalog = j.stars.map((s) => ({
        name: s.n, desig: s.d, spect: s.s, con: s.con,
        distLy: s.ly, x: s.x, y: s.y, z: s.z, mag: s.m, ci: s.ci,
      }));
      return catalog;
    })
    .catch((e) => { console.warn('[StarSystems] catalogue load failed:', e); catalog = []; return catalog; });
  return loadPromise;
}

/** The loaded catalogue (empty until loadStarSystems() resolves). */
export function getStarSystems(): readonly CatalogStar[] {
  return catalog ?? [];
}
