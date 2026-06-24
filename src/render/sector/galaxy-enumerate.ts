// ═══════════════════════════════════════════════════════════════════
// GALAXY ENUMERATION — which 250 pc cells are POPULATED across the whole 3D disc
// (full-galaxy build-out, Inc 1). Pure + deterministic; no GPU, no Three beyond Vector3.
//
// Walks the disc bounding box on the 250 pc cell grid and keeps a cell iff its emission (sampled at
// the cell's nearest-midplane y, so a cell straddling the thin disc is judged at its richest point)
// clears a threshold relative to the solar-circle reference. The single emission threshold yields
// UNEVEN THINNING ON ALL THREE AXES for free: radial (the disc taper + exp(−R/HR) kills the rim),
// vertical (exp(−|y|/HZ) drops off-plane layers — several survive near the bulge, only j≈0 at the
// rim), and azimuthal (the arm modulation thins the inter-arm). Cells are grouped by 1 kpc region
// for the merged renderer, and cached in a Map the future manipulation tool can query.
// ═══════════════════════════════════════════════════════════════════

import { Vector3 } from 'three';
import { DEFAULT_SECTOR_EDGE_PC, type Cell } from './sector';
import {
  classifyArmPhase, classifyDensity, regionForGalPc, regionKey,
  type ArmPhase, type DensityClass,
} from './region';
import { armPhaseAt, emissionAtGalPc, PC_TO_NATIVE, REF_EMISSION } from './sector-stars';

// Defaults chosen by sweeping the real emission field (the disc has high dynamic range): this gives a
// recognizable disc — rim reach to ~14.4 kpc, a clear vertical taper (edge ≈ 12% of the midplane
// layer), ~63k populated cells in ~1560 regions. All three are LIVE-TUNABLE so the rim/thickness can
// be dialed at the visual-assessment step without a rebuild.
/** Rim threshold (× REF_EMISSION). Lower = more diffuse far-field + thicker disc; higher = tighter. */
export const DEFAULT_GALAXY_THRESHOLD = 0.1;
/** Vertical half-extent scanned (pc) — captures the disc's full thickness so the vertical taper shows. */
export const DEFAULT_GALAXY_Y_EXTENT_PC = 1500;
/** Radial truncation (pc) — the disc's DISC_RADIUS taper kills emission well before this. */
const GALAXY_R_MAX_PC = 15000;

export interface PopulatedCell {
  readonly cell: Cell;
  /** True cell centre (galactocentric pc) — where its stars generate (real height, not clamped). */
  readonly centerPc: Vector3;
  /** Emission at the cell's nearest-midplane y (the gate value), relative scalar. */
  readonly emission: number;
  readonly armPhase: ArmPhase;
  readonly densityClass: DensityClass;
  readonly regionKey: string;
}

export interface GalaxyEnumeration {
  readonly cells: PopulatedCell[];
  /** regionKey → its populated cells (the merge unit). */
  readonly byRegion: Map<string, PopulatedCell[]>;
  /** Populated-cell count per vertical layer j (telemetry for the thinning). */
  readonly layerHistogram: Map<number, number>;
}

/** Enumerate the galaxy's populated cells. Pure of HOME_GAL_PC (positional) → bit-identical reloads. */
export function enumerateGalaxy(
  opts: { threshold?: number; yExtentPc?: number } = {},
): GalaxyEnumeration {
  const threshold = opts.threshold ?? DEFAULT_GALAXY_THRESHOLD;
  const yExtentPc = opts.yExtentPc ?? DEFAULT_GALAXY_Y_EXTENT_PC;
  const edge = DEFAULT_SECTOR_EDGE_PC; // 250 pc
  const iMax = Math.ceil(GALAXY_R_MAX_PC / edge);
  const jMax = Math.ceil(yExtentPc / edge);

  const cells: PopulatedCell[] = [];
  const byRegion = new Map<string, PopulatedCell[]>();
  const layerHistogram = new Map<number, number>();

  for (let i = -iMax; i <= iMax; i++) {
    const cx = (i + 0.5) * edge;
    for (let k = -iMax; k <= iMax; k++) {
      const cz = (k + 0.5) * edge;
      const R = Math.hypot(cx, cz);
      if (R > GALAXY_R_MAX_PC) continue; // circular radial bound
      const rNative = R * PC_TO_NATIVE;
      const ridge = armPhaseAt(cx, cz).armRidge;
      const armPhase = classifyArmPhase(ridge, rNative);
      for (let j = -jMax; j <= jMax; j++) {
        // Gate at the cell's TRUE centre height (a 250 pc cell is thin enough that its centre is
        // representative) — so off-plane layers are judged by their real, vertically-attenuated
        // emission and the disc thins vertically. (Contrast region-manager, whose 1 kpc regions
        // straddle the plane and so clamp to the midplane to avoid a false-sparse label.)
        const cy = (j + 0.5) * edge;
        const emission = emissionAtGalPc(cx, cy, cz);
        if (emission / REF_EMISSION < threshold) continue;
        const centerPc = new Vector3(cx, cy, cz);
        const pc: PopulatedCell = {
          cell: { i, j, k },
          centerPc,
          emission,
          armPhase,
          densityClass: classifyDensity(emission / REF_EMISSION),
          regionKey: regionKey(regionForGalPc(centerPc)),
        };
        cells.push(pc);
        const list = byRegion.get(pc.regionKey);
        if (list) list.push(pc); else byRegion.set(pc.regionKey, [pc]);
        layerHistogram.set(j, (layerHistogram.get(j) ?? 0) + 1);
      }
    }
  }
  return { cells, byRegion, layerHistogram };
}
