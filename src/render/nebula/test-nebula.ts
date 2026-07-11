// ═══════════════════════════════════════════════════════════════════
// TEST NEBULA — one hand-authored canonical object in the galaxy tier.
//
// P1 deliverable: a single nebula placed at a REAL galPos (the Orion Nebula /
// M42 region), riding the galactic tier's floating origin exactly like the
// physGalaxy disc + the sector groups (Broker.getResidual on its absolute
// scene-WU center each frame), gated by zoom LOD so it only shows near galaxy
// scale (getGalaxyCrossfade) and fades on further pull-back.
//
// This is the galaxy-tier WIRING around the reusable primitive (nebula.ts):
// the primitive itself knows nothing of the broker, the crossfade, or Orion.
// P2 will replace this hand-authored instance with data-driven objects from the
// Edenhofer dust map + WISE HII catalog, reusing the identical primitive + the
// same update path.
// ═══════════════════════════════════════════════════════════════════

import { Vector3 } from 'three';
import { Broker } from '../scale-manager';
import { getGalaxyCrossfade } from '../galaxy';
import { createNebula, type NebulaHandle, type NebulaParams } from './nebula';
import { galPosFromGalactic, nebulaCenterAbsWU, pullbackTaper } from './nebula-placement';

// Orion Nebula (M42) — the canonical nearby emission nebula / stellar nursery.
// Galactic coordinates l≈209.01°, b≈-19.38°, d≈412 pc (its real sky position);
// resolved to galactocentric parsecs in the star frame. radiusPc represents the
// broader emission complex (not just the ~6-pc bright core) so it reads at
// galaxy framing — a deliberate, honest stand-in until P2's catalog geometry.
const ORION_LBD = { l: 209.01, b: -19.38, d: 412 } as const;
const ORION_RADIUS_PC = 42;

export const ORION_NEBULA_PARAMS: NebulaParams = {
  name: 'Orion Nebula (M42)',
  galPosPc: galPosFromGalactic(ORION_LBD.l, ORION_LBD.b, ORION_LBD.d),
  radiusPc: ORION_RADIUS_PC,
  shellCount: 5,
  seed: 'orion-m42',
  brightness: 1.15,
  // H-alpha-dominated HII region with a hot [OIII] core and heavy dust lanes —
  // the defaults already encode this; kept explicit as the archetype example.
  colorMix: {
    oiiiStrength: 1.2,
    halphaStrength: 1.0,
    dustStrength: 1.4,
  },
};

export interface TestNebulaHandle extends NebulaHandle {
  /** Re-root + zoom-LOD gate + advance drift for this frame. Call once per frame
   *  AFTER Broker.beginFrame (same ordering as the tier re-roots). */
  update(camDist: number, dtSeconds: number): void;
}

/** Build the hand-authored test nebula. Add `.group` to the scene root; drive it
 *  with `.update(camDist, dt)` each frame (see the main.ts hook). */
export function createTestNebula(): TestNebulaHandle {
  const nebula = createNebula(ORION_NEBULA_PARAMS);
  const centerAbsWU = nebulaCenterAbsWU(ORION_NEBULA_PARAMS.galPosPc);
  const _residual = new Vector3();

  return {
    ...nebula,
    update(camDist: number, dtSeconds: number): void {
      // Zoom LOD: present only near galaxy scale (getGalaxyCrossfade), fading on
      // deep pull-back (pullbackTaper) — size falls off with perspective, this
      // handles the brightness half so it never lingers as a bright speck.
      const presence = getGalaxyCrossfade(camDist) * pullbackTaper(camDist, ORION_RADIUS_PC);
      nebula.setPresence(presence);
      if (presence <= 0.003) return; // hidden — skip the per-frame work
      nebula.advance(dtSeconds);
      // Ride the floating origin: the GPU only ever sees the small residual
      // around the camera (no float32 jitter at ~8e6 WU galactocentric).
      Broker.getResidual(centerAbsWU, _residual);
      nebula.group.position.copy(_residual);
    },
  };
}
