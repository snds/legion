// ═══════════════════════════════════════════════════════════════════
// METRICS — the single source of truth for world-unit scale.
//
// See docs/scale-unification-plan.md. Phase 0 of the scale-unification
// migration: every previously-scattered scale constant now lives here.
// The LEGACY values below reproduce CURRENT behaviour byte-identically;
// phases 1–5 migrate consumers onto the unified target metric.
//
// RULE: never reintroduce a private copy of one of these literals (10, 220,
// 333) anywhere in the codebase — import from here. That is the whole point.
// ═══════════════════════════════════════════════════════════════════

// ── Unified target metric (the migration's destination) ──
// 1 parsec = 1000 world-units, EVERYWHERE, with float64 authoritative
// coordinates + a per-frame floating origin. Not yet consumed by the renderer.
export const WU_PER_PC = 1000;
export const LY_PER_PC = 3.2615638;
export const AU_PER_PC = 206264.806;
export const PC_TO_WU = WU_PER_PC;
export const LY_TO_WU = WU_PER_PC / LY_PER_PC;      // 306.6 WU/ly (true)
export const AU_TO_WU_TRUE = WU_PER_PC / AU_PER_PC; // 0.004848 WU/AU (true)

// ── LEGACY compressed scales — CURRENT behaviour (byte-identical) ──
// The three mutually-inconsistent scales the migration replaces (~10⁶× apart).
export const AU_TO_WU = 10;             // system tier: 1 AU = 10 WU (legacy)
export const LY_TO_WU_REGIONAL = 220;   // curated regional map: 1 ly = 220 WU (legacy)
export const KPC_TO_WU = 333;           // galaxy: 1 kpc = 333 WU (legacy)
export const GAL_LY_TO_WU = KPC_TO_WU / 1000; // galaxy-local ly offset = 0.333 WU/ly (legacy)

// Galaxy RENDER-frame rescale (scale-unification Phase 2c-1). The galaxy is
// built in its legacy galaxy-local frame (1 kpc = KPC_TO_WU WU = 0.333 WU/pc);
// scaling the galaxy GROUP by this factor lifts it to the unified 1000 WU/pc
// render frame so the neighbourhood becomes a true speck in the disc. The
// disc-volume density model stays native-333 and is bridged back via the
// shader's `uModelScale` uniform (= this value). = 1e6 / 333 = 3003.003.
export const GALAXY_MODEL_SCALE = (WU_PER_PC * 1000) / KPC_TO_WU;

// ── Galactocentric frame anchor (Phase 1 — float64 authoritative coords) ──
// Sol's position in the galaxy, PARSECS, with Sgr A* at the origin (galactic
// plane = XZ, north galactic pole = +Y). 8.3 kpc = 8300 pc — numerically equal
// to galaxy.ts SOL_GAL_POS (8.3·KPC_TO_WU WU) under the legacy galaxy scale.
// This is the authoritative float64 anchor; a curated system's galactocentric
// position is SOL_GAL_PC + its real heliocentric parsec offset.
export const SOL_GAL_PC = { x: 8300, y: 0, z: 0 } as const;

// Regional-tier scale expressed PER PARSEC: the legacy 1 ly = 220 WU map,
// pre-multiplied by ly/pc so real heliocentric parsec offsets place directly.
// 220 · 3.2615638 = 717.544 WU/pc. (Same regime as LY_TO_WU_REGIONAL — no new
// scale, just the per-parsec form the real catalogue coordinates consume.)
export const REGIONAL_WU_PER_PC = LY_TO_WU_REGIONAL * LY_PER_PC;
