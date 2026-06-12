// ═══════════════════════════════════════════════════════════════════
// GALAXY DENSITY CALIBRATION TESTS — band, not fog, proven in CI
//
// Numerically integrates the TS mirror of the galaxy model along rays from
// the HOME system and asserts the §6.1 observational ratios
// (docs/galaxy-visual-redesign.md). These assertions encode exactly the
// failure mode of the first (reverted) backdrop attempt: if the medium reads
// as direction-independent fog from inside, these ratios collapse and CI
// fails — BEFORE any shader exists.
//
// Conventions: galactic longitude l (l=0 toward the Galactic Center, i.e. the
// −X̂ direction from home; l=90° toward +Ẑ); latitude b vertical (+Y).
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { HOME_POS, KAPPA_RGB, sampleGalaxy } from './galaxy-density';

const MAX_T = 7000;  // WU — past the far rim from home
const DT = 4;        // WU integration step

function dir(lDeg: number, bDeg: number): [number, number, number] {
  const l = (lDeg * Math.PI) / 180;
  const b = (bDeg * Math.PI) / 180;
  // in-plane basis from home: l=0 → −X̂ (toward GC), l=90° → +Ẑ
  const x = -Math.cos(l) * Math.cos(b);
  const z = Math.sin(l) * Math.cos(b);
  const y = Math.sin(b);
  return [x, y, z];
}

/** Emission–absorption integral along a ray from home; returns mean-RGB
 *  luminance plus the total V-band dust optical depth. */
function integrate(lDeg: number, bDeg: number): { lum: number; tau: number } {
  const d = dir(lDeg, bDeg);
  let Tr = 1, Tg = 1, Tb = 1;
  let Ir = 0, Ig = 0, Ib = 0;
  let tau = 0;
  for (let t = DT / 2; t < MAX_T; t += DT) {
    const s = sampleGalaxy(
      HOME_POS[0] + d[0] * t,
      HOME_POS[1] + d[1] * t,
      HOME_POS[2] + d[2] * t,
    );
    Ir += Tr * s.j[0] * DT;
    Ig += Tg * s.j[1] * DT;
    Ib += Tb * s.j[2] * DT;
    const k = s.kappaV * DT;
    Tr *= Math.exp(-k * KAPPA_RGB[0]);
    Tg *= Math.exp(-k * KAPPA_RGB[1]);
    Tb *= Math.exp(-k * KAPPA_RGB[2]);
    tau += k;
    if (Tr < 0.002 && Tg < 0.002 && Tb < 0.002 && t > 3000) break;
  }
  return { lum: (Ir + Ig + Ib) / 3, tau };
}

/** Band profile scan: peak luminance over |b| ≤ 6° (the visible band core —
 *  exactly at b=0 the authored rift dims the mid-line, as in the real sky). */
function bandPeak(lDeg: number): number {
  let peak = 0;
  for (let b = 0; b <= 6; b += 1) peak = Math.max(peak, integrate(lDeg, b).lum);
  return peak;
}

/** ISOPHOTAL half-width: the latitude where the profile drops below a fixed
 *  multiple of the polar sky level. This is how the band edge reads on real
 *  surface-brightness maps (and to the eye): "the band" is where the sky is
 *  visibly brighter than the polar background. Photometric FWHM is the wrong
 *  metric here — a brighter GC peak RAISES its half-level and paradoxically
 *  narrows its measured width, inverting the expected GC>anticenter order. */
const BAND_ISOPHOTE = 6; // ×pole — ≈2 mag above the polar sky (dark-sky visual band edge)
function halfWidth(lDeg: number): number {
  const pole = integrate(0, 90).lum;
  const level = BAND_ISOPHOTE * pole;
  let bPeak = 0;
  let peak = 0;
  for (let b = 0; b <= 8; b += 0.5) {
    const v = integrate(lDeg, b).lum;
    if (v > peak) { peak = v; bPeak = b; }
  }
  if (peak < level) return 0;
  for (let b = bPeak; b <= 60; b += 0.5) {
    if (integrate(lDeg, b).lum < level) return b;
  }
  return 60;
}

describe('galaxy density model — interior-view calibration (§6.1)', () => {
  it('polar dust optical depth τ_V ∈ [0.05, 0.2] (A_V ≈ 0.1–0.2 mag)', () => {
    const { tau } = integrate(0, 90);
    expect(tau).toBeGreaterThanOrEqual(0.05);
    expect(tau).toBeLessThanOrEqual(0.2);
  });

  it('band(GC)/pole intensity ratio ∈ [8, 30] — the band exists', () => {
    const ratio = bandPeak(0) / integrate(0, 90).lum;
    expect(ratio).toBeGreaterThanOrEqual(8);
    expect(ratio).toBeLessThanOrEqual(30);
  });

  it('GC/anticenter band ratio ∈ [2, 4] — brighter toward Sagittarius', () => {
    const ratio = bandPeak(0) / bandPeak(180);
    expect(ratio).toBeGreaterThanOrEqual(2);
    expect(ratio).toBeLessThanOrEqual(4);
  });

  it('band FWHM toward GC ∈ [25°, 35°] — wide over the bulge', () => {
    const fwhm = 2 * halfWidth(0);
    expect(fwhm).toBeGreaterThanOrEqual(25);
    expect(fwhm).toBeLessThanOrEqual(35);
  });

  it('band width toward anticenter < 20° and strictly thinner than toward GC', () => {
    const wGC = 2 * halfWidth(0);
    const wAC = 2 * halfWidth(180);
    expect(wAC).toBeLessThan(20);
    expect(wAC).toBeLessThan(wGC);
  });

  it('NOT fog: in-plane intensity varies strongly with longitude', () => {
    // A fog field is direction-independent; the real band must vary ≥2×
    // around the in-plane circle.
    const samples = [0, 45, 90, 135, 180, 225, 270, 315].map(l => bandPeak(l));
    const ratio = Math.max(...samples) / Math.min(...samples);
    expect(ratio).toBeGreaterThanOrEqual(2);
  });
});

describe('galaxy density model — sample-table regression lock', () => {
  // Canonical fixed-point record of this module's output. The GLSL chunk is
  // validated against THESE values by the Phase-2 GPU harness; any structural
  // edit that shifts them must update both mirrors in the same commit.
  const POINTS: [number, number, number][] = [
    [HOME_POS[0], HOME_POS[1], HOME_POS[2]],
    [0, 0, 0],
    [1500, 50, 800],
    [-2500, -120, 1200],
    [4200, 300, -900],
  ];

  it('matches the recorded sample table (update deliberately, in both mirrors)', () => {
    const got = POINTS.map(p => {
      const s = sampleGalaxy(p[0], p[1], p[2]);
      return {
        j: s.j.map(v => Number(v.toExponential(6))),
        kappaV: Number(s.kappaV.toExponential(6)),
      };
    });
    expect(got).toMatchSnapshot();
  });
});
