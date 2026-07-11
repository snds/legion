// ═══════════════════════════════════════════════════════════════════
// NEBULA — public surface of the rendering primitive (stellar-phenomena P1).
//
//   createNebula(params)        reusable primitive: nested iso-density shells +
//                               [OIII]→Hα→dust emission ramp (nebula.ts)
//   createTestNebula()          the hand-authored Orion (M42) galaxy-tier object
//   galPosFromGalactic(...)     galactic (l,b,d) → galactocentric pc
// ═══════════════════════════════════════════════════════════════════

export {
  createNebula,
  buildShellSpecs,
  type NebulaParams,
  type NebulaColorMix,
  type NebulaVec3,
  type NebulaHandle,
  type NebulaShellSpec,
} from './nebula';
export {
  galPosFromGalactic,
  nebulaCenterAbsWU,
  pullbackTaper,
} from './nebula-placement';
export {
  createTestNebula,
  ORION_NEBULA_PARAMS,
  type TestNebulaHandle,
} from './test-nebula';
export {
  nbHash3,
  nbValueNoise3,
  nbFbm3,
  nbWarpedFbm3,
} from './nebula-noise';
