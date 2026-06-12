// ═══════════════════════════════════════════════════════════════════
// JPL APPROXIMATE EPHEMERIS — Real Keplerian elements for the Sol planets
//
// "Keplerian Elements for Approximate Positions of the Major Planets"
// (Standish & Williams, JPL Solar System Dynamics:
//  https://ssd.jpl.nasa.gov/planets/approx_pos.html), Table 1, w.r.t. the mean
// ecliptic and equinox of J2000. Each planet has 6 elements + 6 secular rates
// (per Julian century). Evaluating at an epoch gives that planet's real orbital
// elements — used to seed Legion's on-rails propagator so Sol's planets sit at
// their true positions and orbital-plane orientations for the game date.
//
// Validity: Table 1 is nominally 1800–2050 AD. Legion's epoch (2347) is ~3
// centuries past, so the secular-rate extrapolation carries a few degrees of
// mean-longitude error for the outer planets — visually negligible at system
// scale, and we seed once at epoch then propagate analytically, so no drift
// accumulates from re-evaluation. (Table 2 with the b/c/s/f terms would extend
// the valid range to 3000 AD if higher fidelity is ever needed.)
//
// See docs/space-engine-techniques-for-legion.md §4.3.
// ═══════════════════════════════════════════════════════════════════

import { centuriesSinceJ2000 } from '../core/time';
import type { PlanetConfig } from '../core/world';

const DEG = Math.PI / 180;

/** Raw table row: [a, aDot, e, eDot, I, IDot, L, LDot, ϖ, ϖDot, Ω, ΩDot].
 *  a in au (rates au/Cy); angles in degrees (rates deg/Cy); ϖ = longitude of
 *  perihelion, Ω = longitude of ascending node, L = mean longitude. */
type Row = readonly [number, number, number, number, number, number, number, number, number, number, number, number];

// Table 1 (1800–2050), verified against the JPL page. "EM Bary" (Earth–Moon
// barycenter) is used for Earth.
const JPL_TABLE: Record<string, Row> = {
  Mercury: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.25032350, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081],
  Venus:   [0.72333566, 0.00000390, 0.00677672, -0.00004107, 3.39467605, -0.00078890, 181.97909950, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418],
  Earth:   [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0.0, 0.0],
  Mars:    [1.52371034, 0.00001847, 0.09339410, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
  Jupiter: [5.20288700, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106],
  Saturn:  [9.53667594, -0.00125060, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794],
  Uranus:  [19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939, 313.23810451, 428.48202785, 170.95427630, 0.40805281, 74.01692503, 0.04240589],
  Neptune: [30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372, -55.12002969, 218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664],
};

export interface OrbitalElements {
  sma: number;          // semi-major axis (au)
  ecc: number;          // eccentricity
  inclination: number;  // i (radians)
  argPeriapsis: number; // ω (radians)
  longAscNode: number;  // Ω (radians)
  meanAnomaly: number;  // M at the requested epoch (radians, wrapped to [-π, π])
}

/** Wrap an angle (radians) to [-π, π]. */
function wrapPi(a: number): number {
  const twoPi = Math.PI * 2;
  let x = a % twoPi;
  if (x > Math.PI) x -= twoPi;
  if (x < -Math.PI) x += twoPi;
  return x;
}

/** Real Keplerian elements for a Sol planet at ephemeris time `et`, or null if
 *  the name isn't a major planet in the table. */
export function solElementsAt(name: string, et: number): OrbitalElements | null {
  const row = JPL_TABLE[name];
  if (!row) return null;
  const T = centuriesSinceJ2000(et);
  const [a0, aDot, e0, eDot, I0, IDot, L0, LDot, peri0, periDot, node0, nodeDot] = row;

  const a = a0 + aDot * T;
  const e = e0 + eDot * T;
  const I = I0 + IDot * T;        // deg
  const L = L0 + LDot * T;        // deg, mean longitude
  const peri = peri0 + periDot * T; // deg, longitude of perihelion ϖ
  const node = node0 + nodeDot * T; // deg, longitude of ascending node Ω

  const argPeri = peri - node;   // ω = ϖ − Ω
  const M = L - peri;            // mean anomaly = L − ϖ

  return {
    sma: a,
    ecc: e,
    inclination: I * DEG,
    argPeriapsis: argPeri * DEG,
    longAscNode: node * DEG,
    meanAnomaly: wrapPi(M * DEG),
  };
}

/**
 * Return copies of the given Sol planet configs with their orbital elements
 * (sma, ecc, inclination, ω, Ω, and start mean anomaly) replaced by the real
 * JPL values at `et`. Visual fields (size, color, texture, …) are preserved.
 * Planets not present in the JPL table pass through unchanged.
 */
export function applySolEphemeris(planets: PlanetConfig[], et: number): PlanetConfig[] {
  return planets.map((cfg) => {
    const el = solElementsAt(cfg.name, et);
    if (!el) return cfg;
    return {
      ...cfg,
      sma: el.sma,
      ecc: el.ecc,
      inclination: el.inclination,
      argPeriapsis: el.argPeriapsis,
      longAscNode: el.longAscNode,
      startAngle: el.meanAnomaly, // seed mean anomaly at the game epoch
    };
  });
}
