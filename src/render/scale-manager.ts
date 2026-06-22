// ═══════════════════════════════════════════════════════════════════
// SCALE MANAGER — Configurable Visual Inflation for Celestial Bodies
//
// Visual-inflation model (scale-unification Phase 2a, decision 2): bodies
// render at TRUE 1:1 scale when you are CLOSE to a target (surface/orbit/
// inner-system), then gently inflate as you pull back so a planet stays
// legible at outer-system framing — reaching the configured maximum (~1.25×)
// by ~the Oort-cloud distance, and holding it beyond.
//
// This INVERTS the prior model (which inflated close-in and dropped to 1× far
// out). Inflation multiplies VISUAL MESH SIZE only (obj.scale), never orbital
// positions — the position/size split in systems.ts (renderSyncSystem) is the
// invariant this must preserve.
//
// Keyed on camDist for now; once the unified metric + frame broker land
// (Phase 2b/2c) and raw-WU magnitudes shift, this can be re-keyed on apparent
// angular size (per-body legibility) — see docs/scale-unification-plan.md.
// ═══════════════════════════════════════════════════════════════════

import { VP } from './visual-params';
import { Game } from '../core/state';
import { AU_TO_WU } from '../core/metrics';

/**
 * Effective visual inflation factor for the current camera distance.
 *  • camDist ≤ ramp start  → 1.0   (close to a target: true 1:1 scale)
 *  • camDist ≥ ramp full   → max   (outer-system / Oort and beyond)
 *  • between                → smoothstep 1.0 → max (no visual pop)
 *
 * The ramp window is `transitionZoneInner`…`transitionZoneOuter` (AU, dev-
 * tunable), and `visualInflation` is the user-configurable ceiling (settings
 * panel). AU_TO_WU is the legacy system-tier scale; Phase 3 re-derives the
 * window when the unified metric changes camDist magnitudes.
 */
export function getEffectiveScale(): number {
  const maxInflation = VP.get('visualInflation');
  const camDist = Game.data.camDist;

  const rampStart = VP.get('transitionZoneInner') * AU_TO_WU; // ≤ → true scale
  const rampFull = VP.get('transitionZoneOuter') * AU_TO_WU;  // ≥ → full inflation

  if (camDist <= rampStart) return 1.0;
  if (camDist >= rampFull) return maxInflation;

  // smoothstep for a pop-free ramp from 1.0 (close) up to maxInflation (far)
  const t = (camDist - rampStart) / (rampFull - rampStart);
  const smooth = t * t * (3 - 2 * t);
  return 1.0 + (maxInflation - 1.0) * smooth;
}
