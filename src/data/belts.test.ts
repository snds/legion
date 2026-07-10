import { describe, it, expect } from 'vitest';
import { EPS_ERI_PLANETS, EPS_ERI_BELTS, SOL_PLANETS, SOL_BELTS } from './star-catalog';
import { generateSystem } from './system-gen';
import type { PlanetConfig, BeltConfig } from '../core/world';

// THE RULE (from observed solar-system formation structure): belts live in
// the gaps — the main belt between the rocky inner system and the innermost
// giant near the snow line, debris belts beyond the outermost planet. A belt
// must NEVER contain any part of a planet's radial excursion [a(1−e), a(1+e)].

function assertNoOrbitCrossing(planets: PlanetConfig[], belts: BeltConfig[]): void {
  for (const b of belts) {
    expect(b.innerAU).toBeLessThan(b.outerAU);
    for (const p of planets) {
      const peri = p.sma * (1 - p.ecc);
      const apo = p.sma * (1 + p.ecc);
      const crosses = apo > b.innerAU && peri < b.outerAU;
      expect(crosses, `${p.name} (${peri.toFixed(2)}–${apo.toFixed(2)} AU) crosses belt ${b.name} (${b.innerAU}–${b.outerAU} AU)`).toBe(false);
    }
  }
}

describe('curated belts — ε Eridani', () => {
  it('no belt crosses any planet orbit (the old 2.5–4.5 belt crossed Jotunheim)', () => {
    assertNoOrbitCrossing(EPS_ERI_PLANETS, EPS_ERI_BELTS);
  });
  it('main belt sits between the outermost rocky (Pax) and the innermost giant (Jotunheim)', () => {
    const main = EPS_ERI_BELTS[0];
    const pax = EPS_ERI_PLANETS.find((p) => p.name === 'Pax')!;
    const jot = EPS_ERI_PLANETS.find((p) => p.name === 'Jotunheim')!;
    expect(main.innerAU).toBeGreaterThan(pax.sma * (1 + pax.ecc));
    expect(main.outerAU).toBeLessThan(jot.sma * (1 - jot.ecc));
  });
  it('outer debris belt sits beyond the outermost planet (Helheim apoapsis)', () => {
    const outer = EPS_ERI_BELTS[1];
    const helheim = EPS_ERI_PLANETS.find((p) => p.name === 'Helheim')!;
    expect(outer.innerAU).toBeGreaterThan(helheim.sma * (1 + helheim.ecc));
  });
});

describe('curated belts — Sol (real observed values)', () => {
  it('no belt crosses any planet orbit', () => {
    assertNoOrbitCrossing(SOL_PLANETS, SOL_BELTS);
  });
  it('main belt between Mars and Jupiter; Kuiper belt in the classical 39.4–47.7 AU band', () => {
    const [main, kuiper] = SOL_BELTS;
    expect(main.innerAU).toBeCloseTo(2.06, 2);
    expect(main.outerAU).toBeCloseTo(3.27, 2);
    expect(kuiper.innerAU).toBeCloseTo(39.4, 1);
    expect(kuiper.outerAU).toBeCloseTo(47.7, 1);
  });
});

describe('generated belts — the rule holds for every generated system', () => {
  const SPECTRA = ['G2V', 'K2V', 'M4V', 'F5IV-V', 'A0V', 'M5.5Ve', 'K5V'];
  it('across 700 systems: belts never cross orbits, mains hug the snow line, debris lies beyond the last planet', () => {
    let mains = 0, debris = 0;
    for (let s = 0; s < 100; s++) {
      for (const spect of SPECTRA) {
        const sys = generateSystem(`belt-test-${s}`, spect);
        const lastAu = sys.planets.length ? sys.planets[sys.planets.length - 1].au : 0;
        for (const b of sys.belts) {
          expect(b.innerAU).toBeLessThan(b.outerAU);
          expect(b.density).toBeGreaterThan(0);
          for (const p of sys.planets) {
            const inside = p.au > b.innerAU && p.au < b.outerAU;
            expect(inside, `planet at ${p.au} AU inside ${b.kind} belt ${b.innerAU}–${b.outerAU} (${spect} seed ${s})`).toBe(false);
          }
          if (b.kind === 'main') {
            mains++;
            const mid = Math.sqrt(b.innerAU * b.outerAU);
            expect(mid).toBeGreaterThanOrEqual(sys.snowAu * 0.25);
            expect(mid).toBeLessThanOrEqual(sys.snowAu * 6);
          } else {
            debris++;
            expect(b.innerAU).toBeGreaterThan(lastAu);
          }
        }
      }
    }
    // The rule must actually FIRE — belts are common, not rare accidents.
    expect(mains).toBeGreaterThan(50);
    expect(debris).toBeGreaterThan(100);
  });

  it('is deterministic — same identity, same belts', () => {
    const a = generateSystem('HD 12345', 'K2V');
    const b = generateSystem('HD 12345', 'K2V');
    expect(a.belts).toEqual(b.belts);
    expect(a.snowAu).toBe(b.snowAu);
  });
});
