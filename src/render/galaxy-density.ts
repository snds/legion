// ═══════════════════════════════════════════════════════════════════
// GALAXY DENSITY MODEL — the single analytic source of truth
//
// ONE shared model of the Milky Way's emission (starlight) and extinction
// (dust) fields, consumed by:
//   • the volume shader (src/render/shaders/galaxy-density.glsl.ts — a GLSL
//     chunk generated FROM this module's constants, functions mirrored 1:1),
//   • the star-particle spawner (population statistics),
//   • the vitest calibration suite (galaxy-density.test.ts), which numerically
//     integrates rays from the home system and PROVES the model produces a
//     thin bright band from inside — not fog — before any pixel changes.
//
// ⚠ STRUCTURAL EDITS MUST TOUCH BOTH FILES IN THE SAME COMMIT. Scalar
// constants are interpolated into the GLSL chunk automatically (cannot
// drift); function bodies are mirrored by hand (the test's sample table
// locks this file; the Phase-2 GPU harness checks the GLSL side).
//
// Coordinates: galaxy-local — Sgr A* at origin, disc in the X–Z plane,
// +Y vertical. Units: world units (KPC_WU per kiloparsec).
// Parameters: verifier-corrected set, docs/galaxy-visual-redesign.md §3.1
// (Bland-Hawthorn & Gerhard 2016; McMillan 2017; Gaia DR3; CCM89 reddening).
// ═══════════════════════════════════════════════════════════════════

// ── Geometry ─────────────────────────────────────────────────────
export const KPC_WU = 333;                       // must equal galaxy.ts KPC (frozen)
export const DISC_RADIUS_WU = 4995;              // 15 kpc truncation (smooth taper)
/** Home system (ε Eridani) in galaxy-local WU: SOL_GAL_POS + GAL_SYSTEMS local
 *  offset (ly→WU). Frozen — marker space depends on it. */
export const HOME_POS: readonly [number, number, number] = [
  8.3 * KPC_WU + 3.7 * (KPC_WU / 1000),          // 2765.132
  -7.8 * (KPC_WU / 1000),                        // −2.597
  5.0 * (KPC_WU / 1000),                         // 1.665
];

// ── Stellar emission ─────────────────────────────────────────────
export const HR_THIN = 866;        // thin-disc radial scale length (2.6 kpc)
export const HZ_THIN = 100;        // thin-disc vertical scale height (300 pc)
export const THICK_WEIGHT = 0.11;  // thick disc: ~11% of thin local density
export const HR_THICK = 1000;      // 3.0 kpc
export const HZ_THICK = 300;       // 900 pc
export const BULGE_A = 233;        // Hernquist a (0.7 kpc) — analytic-MW choice
export const BULGE_SQUASH = 100 / 60; // boxy: vertical compressed to h≈60 WU
export const BULGE_AMP = 0.30;
export const BAR_AMP = 0.25;
export const BAR_ANGLE = (28 * Math.PI) / 180;   // bar major axis vs Sun line
export const BAR_LEN = 1100;       // Gaussian sigma along bar (half-len 1665)
export const BAR_W = 520;          // in-plane minor sigma (axis ratio ~2.1)
export const BAR_H = 80;           // vertical sigma
export const PITCH = (13.4 * Math.PI) / 180;     // spiral pitch (repo ARM_TWIST)
export const ARM_REF_R = 866;      // log-spiral reference radius
export const A_STARS = 0.45;       // stellar arm contrast (m=2 major dominant)

// ── Dust extinction ──────────────────────────────────────────────
export const HR_DUST = 866;        // 2.6 kpc compromise (D&S 2.26 / LAMOST 3.19)
export const HZ_DUST = 30;         // thin rift layer (~90 pc) — 3× thinner than stars
export const HZ_DUST2 = 60;        // optional thicker component
export const DUST2_WEIGHT = 0.2;
export const KAPPA_MID = 0.005;    // κ_V at (R₀, midplane): 1.8 mag/kpc verified
export const KAPPA_RGB: readonly [number, number, number] = [0.75, 1.0, 1.32]; // CCM89 R_V=3.1
export const DUST_SHARP = 4;       // dust-lane cos^k sharpening
export const LANE_OFFSET = 0.15;   // rad — lane sits on the INNER edge of the arm crest
export const CLUMP_SCALE = 40;     // fBm clump scale (~120 pc)

// ── Warp / flare / taper ─────────────────────────────────────────
export const WARP_ONSET = 3330;    // R ≳ 10 kpc
export const WARP_RIM_AMP = 370;   // ~1.1 kpc at the rim
export const R_FLARE = 4350;       // h_z ≈ 0.3 → 0.5 kpc at truncation (mild flare)
export const TAPER_IN = 4400;
export const TAPER_OUT = 5300;

// ── Population colors (linear RGB, Planckian-derived; §3.2) ──────
export const COL_DISC: readonly [number, number, number] = [0.85, 0.92, 1.0];  // ~7000 K arm ridge
export const COL_OLD: readonly [number, number, number] = [1.0, 0.90, 0.75];   // ~5000 K interarm/thick
export const COL_BULGE: readonly [number, number, number] = [1.0, 0.78, 0.58]; // ~4300 K old bulge
export const COL_HII: readonly [number, number, number] = [1.0, 0.45, 0.65];   // emission nebulae

// ── Authored features ────────────────────────────────────────────
// Great Rift: discrete dust ellipsoids ~280 WU from home along the
// Cygnus→Sagittarius arc (galactic longitudes ~65°→0°, in-plane). ADDED to κ.
// dir(l) = −X̂·cos l + Ẑ·sin l from home (l=0 toward the Galactic Center).
function riftCloudList(): { c: [number, number, number]; r: [number, number, number]; k: number }[] {
  const longs = [65, 50, 38, 26, 14, 4];
  return longs.map((ldeg, i) => {
    const l = (ldeg * Math.PI) / 180;
    const d = 265 + 12 * i;
    return {
      c: [
        HOME_POS[0] - d * Math.cos(l),
        0,
        HOME_POS[2] + d * Math.sin(l),
      ] as [number, number, number],
      r: [85, 22, 55] as [number, number, number],
      k: 0.014,
    };
  });
}
export const RIFT_CLOUDS = riftCloudList();

// HII knots: authored on spiral-arm crests (crest-downstream of the dust lane).
function hiiKnotList(): { c: [number, number, number]; r: number; amp: number }[] {
  const radii = [1500, 1900, 2300, 2700, 3100, 3500, 2100, 2900];
  return radii.map((R, i) => {
    // m=2 crest: cos(2(θ − lnTerm)) = 1 ⇒ θ = lnTerm (+ π for the second arm)
    const lnTerm = Math.log(R / ARM_REF_R) / Math.tan(PITCH);
    const theta = lnTerm + (i % 2 === 0 ? 0 : Math.PI) + 0.06; // slightly downstream
    return {
      c: [R * Math.cos(theta), 0, R * Math.sin(theta)] as [number, number, number],
      r: 60,
      amp: 0.012,
    };
  });
}
export const HII_KNOTS = hiiKnotList();

// ── Shared helpers (mirrored 1:1 in the GLSL chunk) ──────────────

/** Deterministic 3D value-noise hash (canonical GLSL one-liner). */
function hash3(ix: number, iy: number, iz: number): number {
  const s = Math.sin(ix * 127.1 + iy * 311.7 + iz * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function smooth(t: number): number { return t * t * (3 - 2 * t); }

function valueNoise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  const c000 = hash3(ix, iy, iz),         c100 = hash3(ix + 1, iy, iz);
  const c010 = hash3(ix, iy + 1, iz),     c110 = hash3(ix + 1, iy + 1, iz);
  const c001 = hash3(ix, iy, iz + 1),     c101 = hash3(ix + 1, iy, iz + 1);
  const c011 = hash3(ix, iy + 1, iz + 1), c111 = hash3(ix + 1, iy + 1, iz + 1);
  const x00 = c000 + (c100 - c000) * fx, x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx, x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

/** 3-octave fBm in [0,1] — the dust clump field (MUST vary in y). */
export function fbm3(x: number, y: number, z: number): number {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < 3; i++) {
    v += a * valueNoise3(x * f, y * f, z * f);
    a *= 0.5; f *= 2;
  }
  return v / 0.875; // normalize Σ amplitudes
}

/** m=1 integrated-sign warp: disc bends up/down beyond WARP_ONSET. */
export function warpY(x: number, z: number): number {
  const R = Math.hypot(x, z);
  if (R <= WARP_ONSET) return 0;
  const t = (R - WARP_ONSET) / (DISC_RADIUS_WU - WARP_ONSET);
  return t * t * WARP_RIM_AMP * Math.sin(Math.atan2(z, x));
}

/** Thin-disc flare: h_z grows outward (G4 asymmetry budget). */
export function flare(R: number): number {
  return Math.exp(Math.max(0, R - HOME_POS[0]) / R_FLARE);
}

/** Smooth outer truncation of all fields. */
export function taper(R: number): number {
  const t = Math.min(1, Math.max(0, (R - TAPER_IN) / (TAPER_OUT - TAPER_IN)));
  return 1 - t * t * (3 - 2 * t);
}

/** Spiral features emerge at the BAR TIPS (half-length ~1665 WU): a
 *  log-spiral winds infinitely tight at small R, so any spiral modulation
 *  inside the bar region reads as a central curl. Shared by the arm pattern
 *  AND the dust lane. */
export function spiralInnerFade(R: number): number {
  const t = Math.min(1, Math.max(0, (R - 1500) / 600)); // 0 at R≤1500 → 1 at R≥2100
  return t * t * (3 - 2 * t);
}

/** Two-major + two-minor log-spiral arm pattern in [0,1]. */
export function armPattern(R: number, theta: number): number {
  const lnTerm = Math.log(Math.max(R, 50) / ARM_REF_R) / Math.tan(PITCH);
  const p2 = Math.cos(2 * (theta - lnTerm));
  const p4 = Math.cos(4 * (theta - lnTerm));
  return Math.max(0, 0.667 * p2 + 0.333 * p4) * spiralInnerFade(R);
}

/** Dust-lane mask: sharpened crest displaced LANE_OFFSET toward the arm's
 *  inner (concave) edge — density-wave anatomy. In [0,1]. */
export function dustLane(R: number, theta: number): number {
  const lnTerm = Math.log(Math.max(R, 50) / ARM_REF_R) / Math.tan(PITCH);
  const c = 0.5 + 0.5 * Math.cos(2 * (theta - lnTerm) - LANE_OFFSET);
  return Math.pow(c, DUST_SHARP);
}

function hernquist(r: number, a: number): number {
  const x = Math.max(r, 0.05 * a) / a;
  return 1 / (x * Math.pow(1 + x, 3));
}

function barField(x: number, yw: number, z: number): number {
  const cb = Math.cos(BAR_ANGLE), sb = Math.sin(BAR_ANGLE);
  const u = x * cb + z * sb;
  const v = -x * sb + z * cb;
  return Math.exp(-((u / BAR_LEN) ** 2) - ((v / BAR_W) ** 2) - ((yw / BAR_H) ** 2));
}

// Dust normalization: κ_V(home midplane, mean clump/lane) = KAPPA_MID exactly.
// Mean of the clump multiplier mix(0.4,1.6,fbm≈0.5)=1.0; mean lane term 0.25+0.5.
export const DUST_NORM =
  Math.exp(-HOME_POS[0] / HR_DUST) * (1 + DUST2_WEIGHT) * 1.0 * 0.75;

export interface GalaxySample {
  /** emission (linear RGB radiance density per WU) */
  j: [number, number, number];
  /** dust extinction coefficient κ_V (per WU); per-channel via KAPPA_RGB */
  kappaV: number;
}

/** THE model. p in galaxy-local WU. Mirrored in galaxy-density.glsl.ts. */
export function sampleGalaxy(px: number, py: number, pz: number): GalaxySample {
  const R = Math.hypot(px, pz);
  const theta = Math.atan2(pz, px);
  const yw = py - warpY(px, pz);
  const tap = taper(R);

  // EMISSION — double-exponential thin disc (arm-modulated) + thick + bulge + bar
  const hzT = HZ_THIN * flare(R);
  const thin = Math.exp(-R / HR_THIN) * Math.exp(-Math.abs(yw) / hzT);
  const thick = THICK_WEIGHT * Math.exp(-R / HR_THICK) * Math.exp(-Math.abs(yw) / HZ_THICK);
  const bulge = BULGE_AMP * hernquist(
    Math.hypot(px, yw * BULGE_SQUASH, pz), BULGE_A,
  );
  const bar = BAR_AMP * barField(px, yw, pz);
  const armS = 1 + A_STARS * armPattern(R, theta);

  let jr = (COL_DISC[0] * thin * armS + COL_OLD[0] * thick + COL_BULGE[0] * (bulge + bar)) * tap;
  let jg = (COL_DISC[1] * thin * armS + COL_OLD[1] * thick + COL_BULGE[1] * (bulge + bar)) * tap;
  let jb = (COL_DISC[2] * thin * armS + COL_OLD[2] * thick + COL_BULGE[2] * (bulge + bar)) * tap;

  for (const k of HII_KNOTS) {
    const dx = px - k.c[0], dy = py - k.c[1], dz = pz - k.c[2];
    const d2 = (dx * dx + dy * dy + dz * dz) / (k.r * k.r);
    if (d2 < 9) {
      const e = k.amp * Math.exp(-d2);
      jr += COL_HII[0] * e; jg += COL_HII[1] * e; jb += COL_HII[2] * e;
    }
  }

  // EXTINCTION — thinner, clumpy, lane-concentrated, + authored rift clouds
  let dust = Math.exp(-R / HR_DUST) *
    (Math.exp(-Math.abs(yw) / HZ_DUST) + DUST2_WEIGHT * Math.exp(-Math.abs(yw) / HZ_DUST2));
  // Clump fBm only where dust is non-negligible (perf: most raymarch steps
  // land above the 30-WU slab where the base is ~0; threshold is far below
  // any visible κ so results are unchanged).
  if (dust > 1e-5) {
    dust *= 0.4 + 1.2 * fbm3(px / CLUMP_SCALE, py / CLUMP_SCALE, pz / CLUMP_SCALE);
    // Lane modulation fades inside the bar (same window as the arms) — an
    // unfaded lane carves a tight dark curl into the central glow.
    const lf = spiralInnerFade(R);
    dust *= (1 - lf) + lf * (0.25 + dustLane(R, theta));
  }
  dust *= tap;

  let kappaV = (KAPPA_MID * dust) / DUST_NORM;
  for (const cl of RIFT_CLOUDS) {
    const dx = (px - cl.c[0]) / cl.r[0];
    const dy = (py - cl.c[1]) / cl.r[1];
    const dz = (pz - cl.c[2]) / cl.r[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 9) kappaV += cl.k * Math.exp(-d2);
  }

  return { j: [jr, jg, jb], kappaV };
}
