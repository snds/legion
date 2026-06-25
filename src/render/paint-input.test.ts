// Paint input (Phase 2a) — the pure normalization helpers. The PointerSource class is DOM-bound and
// exercised live in ?paint-mode; here we lock the math the brush feel hangs on: the pressure sentinel,
// the response curve, the tilt fallback conversion, and the resample/stabilize passthrough invariants.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRESSURE, resolvePressure, tiltToAltAz, passesSpacing, applyStabilize, type BrushSample,
} from './paint-input';

const sample = (x: number, y: number): BrushSample => ({
  x, y, pressure: 1, altitude: null, azimuth: null, twist: 0, hover: false, kind: 'pen', t: 0,
});

describe('resolvePressure', () => {
  it('returns the model default for every non-pen device and the 0.5 "no sensor" sentinel', () => {
    expect(resolvePressure('mouse', 0.5, 1, DEFAULT_PRESSURE)).toBe(1); // mouse → full strength
    expect(resolvePressure('touch', 0.5, 1, DEFAULT_PRESSURE)).toBe(1);
    expect(resolvePressure('pen', 0.5, 1, DEFAULT_PRESSURE)).toBe(1);   // 0.5 sentinel → default, not mid-pressure
    expect(resolvePressure('pen', 0, 0, DEFAULT_PRESSURE)).toBe(1);     // pointerup (pressure 0) → default
  });

  it('curves a real pen force (buttons held, not the sentinel) through the response curve', () => {
    const p = resolvePressure('pen', 0.8, 1, DEFAULT_PRESSURE);
    expect(p).toBeCloseTo(DEFAULT_PRESSURE.curve(0.8), 6);
    expect(p).toBeGreaterThan(0.05);
    expect(p).toBeLessThan(1);
  });
});

describe('DEFAULT_PRESSURE.curve', () => {
  it('floors at 0.05, tops at 1.0, and is monotonic (fine control lives in the low end)', () => {
    expect(DEFAULT_PRESSURE.curve(0)).toBeCloseTo(0.05, 6);
    expect(DEFAULT_PRESSURE.curve(1)).toBeCloseTo(1.0, 6);
    expect(DEFAULT_PRESSURE.curve(0.25)).toBeLessThan(DEFAULT_PRESSURE.curve(0.75));
    expect(DEFAULT_PRESSURE.curve(0.5)).toBeLessThan(0.5); // gamma>1 ⇒ soft toe below the diagonal
  });
});

describe('tiltToAltAz (pre-18.2 fallback)', () => {
  it('maps the cardinal tilts: upright at zero, 45° tilt → π/4 altitude in the right azimuth', () => {
    const upright = tiltToAltAz(0, 0);
    expect(upright.altitude).toBeCloseTo(Math.PI / 2, 6);
    expect(upright.azimuth).toBeCloseTo(0, 6);

    const tiltedX = tiltToAltAz(45, 0);
    expect(tiltedX.altitude).toBeCloseTo(Math.PI / 4, 6);
    expect(tiltedX.azimuth).toBeCloseTo(0, 6);

    const tiltedY = tiltToAltAz(0, 45);
    expect(tiltedY.altitude).toBeCloseTo(Math.PI / 4, 6);
    expect(tiltedY.azimuth).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe('passesSpacing', () => {
  it('always accepts with no prior or spacing 0 (Phase 2a passthrough); gates by arc length otherwise', () => {
    expect(passesSpacing(null, 10, 10, 6)).toBe(true);          // no prior
    expect(passesSpacing(sample(0, 0), 100, 0, 0)).toBe(true);  // spacing off
    expect(passesSpacing(sample(0, 0), 3, 0, 6)).toBe(false);   // 3px < 6px ⇒ skip
    expect(passesSpacing(sample(0, 0), 8, 0, 6)).toBe(true);    // 8px ≥ 6px ⇒ accept
  });
});

describe('applyStabilize', () => {
  it('passes through at factor 0 or no prior; pulls toward the previous sample otherwise', () => {
    const prev = sample(0, 0);
    const cand = sample(10, 0);
    expect(applyStabilize(prev, cand, 0)).toBe(cand);    // off ⇒ identity (same ref)
    expect(applyStabilize(null, cand, 0.5)).toBe(cand);  // no prior ⇒ identity
    const s = applyStabilize(prev, cand, 0.4);
    expect(s.x).toBeCloseTo(6, 6);                        // 10 + (0 - 10)*0.4 = 6
    expect(s.y).toBeCloseTo(0, 6);
    expect(s.pressure).toBe(cand.pressure);               // only position is smoothed
  });
});
