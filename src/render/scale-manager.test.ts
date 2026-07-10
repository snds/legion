// Visual-inflation curve (scale-unification Phase 2a, decision 2). Bodies are
// true 1:1 when close to a target and inflate as you pull back, reaching the
// configured max by outer-system/Oort framing — the INVERSE of the prior model.

import { describe, it, expect, beforeEach } from 'vitest';
import { getEffectiveScale } from './scale-manager';
import { VP } from './visual-params';
import { Game } from '../core/state';
import { AU_TO_WU_TRUE } from '../core/metrics';

// Scale-unification U2: the system tier renders at TRUE scale, so the inflation
// ramp window (authored in AU) converts with AU_TO_WU_TRUE (1 AU ≈ 0.004848 WU),
// not the legacy 1 AU = 10 WU. START ≈ 0.097 WU, FULL ≈ 0.485 WU.
const START = 20 * AU_TO_WU_TRUE;  // ramp start (transitionZoneInner default)
const FULL = 100 * AU_TO_WU_TRUE;  // ramp full  (transitionZoneOuter default)
const at = (camDist: number): number => {
  Game.data.camDist = camDist;
  return getEffectiveScale();
};

describe('visual inflation curve (Phase 2a)', () => {
  beforeEach(() => {
    VP.set('visualInflation', 1.25);
    VP.set('transitionZoneInner', 20);
    VP.set('transitionZoneOuter', 100);
  });

  it('is true 1:1 scale when close to a target', () => {
    expect(at(0)).toBe(1.0);
    expect(at(START * 0.5)).toBe(1.0);
    expect(at(START)).toBe(1.0); // at the ramp start it is still 1:1
  });

  it('reaches the configured max at outer-system and plateaus beyond', () => {
    expect(at(FULL)).toBeCloseTo(1.25, 10);
    expect(at(3000)).toBeCloseTo(1.25, 10);   // heliopause
    expect(at(50000)).toBeCloseTo(1.25, 10);  // sector / galaxy — still capped
  });

  it('ramps with smoothstep between close and full', () => {
    // midpoint: smoothstep(0.5) = 0.5 → 1.0 + 0.25·0.5 = 1.125
    expect(at((START + FULL) / 2)).toBeCloseTo(1.125, 6);
  });

  it('is monotonically non-decreasing as the camera pulls back (inverted model)', () => {
    let prev = -Infinity;
    for (let d = 0; d <= FULL * 1.2; d += FULL / 24) {
      const v = at(d);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    // The inversion: closer is now SMALLER inflation than farther (old model was the reverse).
    expect(at(START + (FULL - START) * 0.25)).toBeLessThan(at(START + (FULL - START) * 0.75));
  });

  it('honors the user-configurable ceiling, and 1.0 disables inflation entirely', () => {
    VP.set('visualInflation', 1.5);
    expect(at(0)).toBe(1.0);
    expect(at(FULL)).toBeCloseTo(1.5, 10);

    VP.set('visualInflation', 1.0);
    expect(at(0)).toBe(1.0);
    expect(at(FULL)).toBe(1.0);
    expect(at(600)).toBe(1.0);
  });
});
