// ═══════════════════════════════════════════════════════════════════
// PROCEDURAL STAR — public surface (procedural-worlds-plan.md S1–S2)
//
// Renders the active system's star from its Step 0 physical record: one
// uniform-driven ShaderMaterial (Planckian colour from T_eff, type-gated
// granulation, limb darkening, activity-scaled starspots, flares/prominences),
// HDR emissive ∝ luminosity feeding the shared bloom, deterministic from seed,
// with a clean point-of-light LOD on pull-back.
//
// main.ts drives it through updateSystemStar(); everything else is internal.
// ═══════════════════════════════════════════════════════════════════

export { updateSystemStar, disposeSystemStar, refreshSystemStarRecord } from './star-manager';
export { createProceduralStar, type ProceduralStar } from './procedural-star';
export {
  starRecordFromParams, starRecordFromSpectral, type StarRecord,
  granulationAmp, spotCoverage, flareRate, emissiveGain, rotationRate, differentialRate,
} from './star-physics';
export { kelvinToRGB, kelvinToHex } from './kelvin';
