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

import { Vector3 } from 'three';
import { VP } from './visual-params';
import { Game } from '../core/state';
import { AU_TO_WU, WU_PER_PC } from '../core/metrics';
import { galPos, HOME_SYSTEM } from '../data/curated-systems';

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

// ═══════════════════════════════════════════════════════════════════
// FRAME BROKER — float64 authoritative frame + per-frame floating origin
// (scale-unification Phase 2b). docs/scale-unification-plan.md.
//
// The broker owns the per-frame floating-origin REBASE `R` and the per-tier
// scene-WU origins. Renderables ride a tier group whose scene position is
// `getTierRoot(tier) = tierOrigin − R`; consumers that need the global shift
// read `getSceneRebase() = R`.
//
// PHASE 2b POLICY = IDENTITY. `R ≡ (0,0,0)` and FLOATING_ORIGIN_ACTIVE = false,
// so every value the broker emits is byte-identical to the pre-broker code
// (getTierRoot('galactic') === the old hand-computed getGalaxyOffset() = −HOME_POS).
// The broker is the transform PATH; 2b ships the machinery and proves no visual
// change. Phase 2c flips the policy (R := the camera's float64 authoritative
// position) so the galactic tier can hold real galPos (home ≈ 8.3e6 WU) without
// float32 jitter — a one-line change here plus the GAL_SYSTEMS→galPos data swap.
//
// FRAME-ORDERING CONTRACT (pinned now so 2c inherits a coherent single-R frame):
// once `beginFrame()` is wired into the loop (Phase 2b-2), it MUST run once per
// frame immediately AFTER the camera update and BEFORE any world-space consumer
// (tier group positions, disc-volume uniforms, planet-shader uniforms, camera
// velocity) reads getSceneRebase()/getTierRoot(). Under the 2b identity policy
// ordering is irrelevant (R is constant), but the contract is fixed up front.
// ═══════════════════════════════════════════════════════════════════

/** Phase 2c-0b: ACTIVE. R = the camera's float64 world position each frame
 *  (set by CameraController via setRebase, inside camCtrl.update), so the GPU
 *  only ever sees small residuals around the camera. */
const FLOATING_ORIGIN_ACTIVE = true;

export type FrameTier = 'local' | 'regional' | 'galactic';

class FrameBroker {
  /** Float64 authoritative camera anchor (galactocentric parsecs). Phase 2c populates. */
  readonly camAnchorPc = new Vector3();

  /** Per-tier scene-WU origin. The galactic group origin is Sgr A* (the
   *  galactocentric origin); in the home-centric scene that is −galPos(home) in
   *  the UNIFIED metric (Phase 2c-1: 1 pc = WU_PER_PC), so the curated home lands
   *  at the residual origin and the galaxy body (scaled ×GALAXY_MODEL_SCALE) frames
   *  Sgr A* symmetrically. local/regional sit at the scene origin. */
  private readonly tierOriginWU: Record<FrameTier, Vector3> = {
    local: new Vector3(0, 0, 0),
    regional: new Vector3(0, 0, 0),
    galactic: (() => {
      const g = galPos(HOME_SYSTEM);
      return new Vector3(-g.x * WU_PER_PC, -g.y * WU_PER_PC, -g.z * WU_PER_PC);
    })(),
  };

  /** The per-frame floating-origin rebase. Identity in 2b. */
  private readonly _R = new Vector3(0, 0, 0);

  /**
   * Per-frame hook. When the floating origin is ACTIVE, R is owned by the camera
   * (set via setRebase inside camCtrl.update, BEFORE the tier-root consumers run),
   * so this is a no-op. When inactive, it pins R = (0,0,0).
   */
  beginFrame(_focusWU?: { x: number; y: number; z: number }): void {
    if (!FLOATING_ORIGIN_ACTIVE) this._R.set(0, 0, 0);
  }

  /**
   * Set the floating-origin rebase R to the camera's ABSOLUTE world position for
   * this frame. Called by CameraController.update once the absolute camera pose is
   * computed, immediately before it rebases itself to the residual origin. No-op
   * (pins R=0) when the floating origin is disabled.
   */
  setRebase(worldCamPos: Vector3): void {
    if (FLOATING_ORIGIN_ACTIVE) this._R.copy(worldCamPos);
    else this._R.set(0, 0, 0);
  }

  /** The global floating-origin rebase for this frame (0,0,0 under the 2b policy). */
  getSceneRebase(out = new Vector3()): Vector3 {
    return out.copy(this._R);
  }

  /** Scene-WU origin of a tier's group this frame = tierOrigin − R. A fresh
   *  Vector3 by default (matches the legacy getGalaxyOffset() contract). */
  getTierRoot(tier: FrameTier, out = new Vector3()): Vector3 {
    return out.copy(this.tierOriginWU[tier]).sub(this._R);
  }

  /** Residual scene position of an ABSOLUTE scene-WU point this frame = absWU − R.
   *  For DYNAMIC content whose origin isn't a fixed tier (e.g. streamed sectors):
   *  author the absolute float64 position, get the float32-safe residual here. It
   *  rides the SAME per-frame R as every tier, so adjacent sectors stay seam-
   *  consistent (a point on a shared face renders identically from either side). */
  getResidual(absoluteWU: Vector3, out = new Vector3()): Vector3 {
    return out.copy(absoluteWU).sub(this._R);
  }
}

/** The process-wide frame broker (scale-unification Phase 2b). */
export const Broker = new FrameBroker();
