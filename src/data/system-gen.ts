// ═══════════════════════════════════════════════════════════════════
// SYSTEM GENERATOR — deterministic system details from a catalogue star
//
// Turns a real catalogue star (its spectral type) — or a procedural seed —
// into a plausible planetary system, DETERMINISTICALLY: the same star always
// yields the same system, so the galaxy is stable across sessions without
// storing 3,000+ systems. Grounded in real Kepler occurrence trends, not
// random: M dwarfs host many small planets and few giants; F/G/K host fewer
// planets overall but more gas/ice giants; hot/short-lived O/B/A and stellar
// remnants are sparse. (Refs: Kepler occurrence by spectral type — M dwarfs
// up to ~0.8–1.2 small planets/star; giants commoner around FGK.)
//
// This is the GENERATED layer. Where a host star has KNOWN planets (NASA
// Exoplanet Archive, public-domain — Phase 2b) those real planets override
// the generated set. The curated home systems (star-catalog.ts) are untouched.
// ═══════════════════════════════════════════════════════════════════

export type StellarClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M' | 'D' | '?';

export interface StellarParams {
  cls: StellarClass;   // O B A F G K M, or D = white dwarf
  subtype: number;     // 0–9 within the class (0 = hottest)
  lumClass: string;    // 'V' main sequence, 'III' giant, 'I' supergiant, 'D' dwarf remnant…
  teffK: number;       // effective temperature, kelvin
  lumSun: number;      // luminosity, solar units (rough, for the habitable zone)
  colorHex: number;    // representative star colour
}

export type PlanetKind = 'rocky' | 'super-earth' | 'neptune' | 'ice-giant' | 'gas-giant' | 'dwarf';

export interface GenPlanet {
  kind: PlanetKind;
  au: number;          // semi-major axis, AU
  inHZ: boolean;       // within the (rough) habitable zone
}

/** A generated asteroid/debris belt. Placement is CONSTRAINED (formation
 *  physics, below); density is free to vary per system. */
export interface GenBelt {
  kind: 'main' | 'debris';
  innerAU: number;
  outerAU: number;
  density: number;     // vs the Sol-main-belt baseline
}

export interface GenSystem {
  star: StellarParams;
  planets: GenPlanet[];
  hzAu: number;        // habitable-zone centre, AU
  snowAu: number;      // snow/ice line, AU (2.7·√L — where volatiles condense)
  belts: GenBelt[];
  habitableCount: number;
}

// ── Deterministic PRNG (seed from the star's stable identity) ──
// Exported as the project's canonical deterministic-generation primitives
// (FNV-1a string→seed + mulberry32). Reused by the sector star generator.
export function seedFrom(key: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Representative per-class data (main-sequence anchors). teff/lum are coarse —
// enough for colour + a believable habitable-zone distance, not astrophysics.
const CLASS_DATA: Record<Exclude<StellarClass, '?'>, { teff: number; lum: number; rgb: number }> = {
  O: { teff: 35000, lum: 30000, rgb: 0x9bb0ff },
  B: { teff: 15000, lum: 500,   rgb: 0xaabfff },
  A: { teff: 8500,  lum: 20,    rgb: 0xcad7ff },
  F: { teff: 6700,  lum: 3.0,   rgb: 0xf6f4ff },
  G: { teff: 5700,  lum: 1.0,   rgb: 0xfff3e8 },
  K: { teff: 4500,  lum: 0.30,  rgb: 0xffd6a8 },
  M: { teff: 3200,  lum: 0.04,  rgb: 0xffb069 },
  D: { teff: 12000, lum: 0.001, rgb: 0xeef2ff }, // white dwarf remnant
};

// Mean planet count + giant fraction by class — encodes the Kepler trend.
const MEAN_PLANETS: Record<Exclude<StellarClass, '?'>, number> =
  { O: 0.2, B: 0.4, A: 0.8, F: 1.6, G: 2.2, K: 2.6, M: 2.9, D: 0.3 };
const GIANT_FRAC: Record<Exclude<StellarClass, '?'>, number> =
  { O: 0.30, B: 0.30, A: 0.28, F: 0.24, G: 0.18, K: 0.12, M: 0.05, D: 0.10 };

/** Parse a catalogued spectral type ("M5Ve", "G2V", "K1III", "DA", "sdM4") into
 *  coarse stellar parameters. Unknown/blank → a sensible K-dwarf default. */
export function parseSpectral(spect: string): StellarParams {
  const s = (spect || '').trim();
  const m = s.match(/(?:sd|d|esd|D)?\s*([OBAFGKMD])\s*([0-9](?:\.[0-9])?)?\s*([IV]+|D)?/i);
  let cls = (m?.[1]?.toUpperCase() ?? 'K') as Exclude<StellarClass, '?'>;
  if (!CLASS_DATA[cls]) cls = 'K';
  const subtype = m?.[2] ? parseFloat(m[2]) : 5;
  const lumClass = /^D/i.test(s) ? 'D' : (m?.[3]?.toUpperCase() ?? 'V');
  const base = CLASS_DATA[cls];
  // Nudge teff across the subclass (0 hottest → 9 coolest), ±~15% within the band.
  const teffK = Math.round(base.teff * (1 - (subtype / 9) * 0.18));
  // Giants/supergiants are far more luminous than the main-sequence anchor.
  const lumMul = lumClass.includes('I') ? 60 : lumClass === 'III' ? 12 : lumClass === 'D' ? 0.001 : 1;
  return {
    cls: lumClass === 'D' ? 'D' : cls,
    subtype, lumClass, teffK,
    lumSun: +(base.lum * lumMul).toPrecision(3),
    colorHex: base.rgb,
  };
}

/** Classify a planet by measured radius (Earth radii) — the standard exoplanet
 *  size bins. Used to map real NASA Exoplanet Archive planets into the same
 *  taxonomy as the generated ones. Falls back to a crude mass→radius if radius
 *  is unknown, else a sub-Neptune default. */
export function classifyByRadius(rade: number | null, masse: number | null): PlanetKind {
  const r = rade ?? (masse != null ? Math.cbrt(masse) : null);
  if (r == null) return 'neptune';
  if (r < 1.5) return 'rocky';
  if (r < 2.5) return 'super-earth';
  if (r < 6) return 'neptune';
  if (r < 10) return 'ice-giant';
  return 'gas-giant';
}

/** Deterministically generate a system for a star, keyed by a stable id
 *  (its name/designation) + its spectral type. */
export function generateSystem(idKey: string, spect: string): GenSystem {
  const star = parseSpectral(spect);
  const rng = mulberry32(seedFrom(idKey + '|' + spect));
  const k = (star.cls === 'D' ? 'D' : star.cls) as Exclude<StellarClass, '?'>;

  // Habitable zone centre ≈ √(L/L☉) AU (equilibrium-temperature scaling).
  const hzAu = +Math.sqrt(Math.max(star.lumSun, 1e-4)).toPrecision(3);

  // Planet count: mean by class, dispersed, never negative.
  const mean = MEAN_PLANETS[k] ?? 1.5;
  const count = Math.max(0, Math.min(8, Math.round(mean + (rng() * 2 - 1) * 1.6)));

  const planets: GenPlanet[] = [];
  let au = (0.05 + rng() * 0.25) * Math.max(0.3, Math.sqrt(star.lumSun + 0.04)); // innermost
  for (let i = 0; i < count; i++) {
    const giant = rng() < (GIANT_FRAC[k] ?? 0.15);
    let kind: PlanetKind;
    if (giant) {
      kind = au < hzAu * 2.5 ? 'gas-giant' : (rng() < 0.6 ? 'ice-giant' : 'neptune');
    } else {
      const r = rng();
      kind = au > hzAu * 3 ? 'dwarf' : r < 0.5 ? 'rocky' : r < 0.85 ? 'super-earth' : 'neptune';
    }
    const inHZ = au >= hzAu * 0.75 && au <= hzAu * 1.5 && (kind === 'rocky' || kind === 'super-earth');
    planets.push({ kind, au: +au.toPrecision(3), inHZ });
    // Next orbit: a randomised Titius–Bode-like spacing (1.4–2.1×) — WIDENED
    // when the step crosses the snow line: a giant forming at the ice line
    // suppresses accretion inside its orbit, leaving the Mars→Jupiter-style
    // gap (3.4× in Sol) that the main asteroid belt then occupies.
    const snow = 2.7 * Math.sqrt(Math.max(star.lumSun, 1e-4));
    let spacing = 1.4 + rng() * 0.7;
    if (au < snow && au * spacing > snow * 0.6) spacing *= 1.35 + rng() * 0.75;
    au *= spacing;
  }

  const snowAu = snowLineAu(star.lumSun);
  const belts = genBelts(planets.map((p) => p.au), snowAu, rng);

  return { star, planets, hzAu, snowAu, belts, habitableCount: planets.filter((p) => p.inHZ).length };
}

/** Snow/ice line ≈ 2.7·√(L/L☉) AU — the volatile condensation front. */
export function snowLineAu(lumSun: number): number {
  return +(2.7 * Math.sqrt(Math.max(lumSun, 1e-4))).toPrecision(3);
}

/**
 * Belt placement — follows observed formation structure. The MAIN belt is a
 * failed planet: it can only live in a wide gap between two orbits near the
 * snow line, where the outer neighbour's resonances stopped accretion (Sol:
 * 2.06–3.27 AU between Mars and Jupiter). DEBRIS belts (Kuiper analogues)
 * live beyond the outermost planet. Count/density/width vary; WHERE a belt
 * lives does not. Belts never cross a planet's orbit by construction
 * (inner/outer are clamped fractions of the neighbour orbits). Shared by the
 * generator AND the real-exoplanet path (star-systems.resolveSystem), which
 * places belts against the REAL observed orbits.
 */
export function genBelts(planetAus: number[], snowAu: number, rng: () => number): GenBelt[] {
  const belts: GenBelt[] = [];
  let bestGap: { inner: number; outer: number; score: number } | null = null;
  for (let i = 0; i < planetAus.length - 1; i++) {
    const a1 = planetAus[i], a2 = planetAus[i + 1];
    if (a2 / a1 < 1.8) continue;                 // gap too tight for a stable belt
    const inner = a1 * 1.25, outer = a2 * 0.75;  // clearance off both orbits
    if (outer / inner < 1.12) continue;
    const mid = Math.sqrt(inner * outer);
    if (mid < snowAu * 0.25 || mid > snowAu * 6) continue; // belts form near the ice line
    // Prefer wide gaps centred near the snow line.
    const score = (outer / inner) / (1 + Math.abs(Math.log(mid / snowAu)));
    if (!bestGap || score > bestGap.score) bestGap = { inner, outer, score };
  }
  let main: GenBelt | null = null;
  if (bestGap && rng() < 0.85) {
    main = {
      kind: 'main',
      innerAU: +bestGap.inner.toPrecision(3),
      outerAU: +bestGap.outer.toPrecision(3),
      density: +(0.5 + rng() * 0.8).toPrecision(2),
    };
  } else {
    // No qualifying inter-planet gap. If the system never reached its ice
    // line (or has no planets at all), planetesimals still pile up THERE —
    // the observed exo-belt case: rings at the snow line around stars whose
    // planets sit well inside it, and the bare A-star debris rings
    // (Fomalhaut, Vega) around sparse systems.
    const aLast = planetAus.length ? planetAus[planetAus.length - 1] : 0;
    if (aLast < snowAu * 0.8 && rng() < 0.6) {
      const inner = Math.max(snowAu * 0.8, aLast * 1.4);
      const outer = snowAu * 1.6;
      if (outer / inner >= 1.15) {
        main = {
          kind: 'main',
          innerAU: +inner.toPrecision(3),
          outerAU: +outer.toPrecision(3),
          density: +(0.3 + rng() * 0.7).toPrecision(2),
        };
      }
    }
  }
  if (main) belts.push(main);
  if (planetAus.length > 0 && rng() < 0.55) {
    let inner = planetAus[planetAus.length - 1] * (1.5 + rng() * 0.5);
    // A snow-line main belt can lie beyond the outermost planet — keep the
    // debris ring clear of it.
    if (main && main.outerAU * 1.25 > inner) inner = main.outerAU * 1.25;
    belts.push({
      kind: 'debris',
      innerAU: +inner.toPrecision(3),
      outerAU: +(inner * (1.4 + rng() * 0.5)).toPrecision(3),
      density: +(0.15 + rng() * 0.3).toPrecision(2),
    });
  }
  return belts;
}
