// ═══════════════════════════════════════════════════════════════════
// STAR PHYSICS — record adapter + type-gated shader parameters
//
// Turns Step 0's physical record (StellarParams from data/system-gen.ts:
// tempK / radiusSolar / luminositySolar / activity / spectralType) into the
// handful of scalars the surface shader is driven by. Every mapping is a
// pure function of the record — physically-driven, never per-star art tuning
// (procedural-worlds-plan.md Decision 2), and deterministic from the star
// seed (Decision 3).
//
// The load-bearing gates (procedural-star-research.md §3):
//   • granulation amplitude scales UP toward M, ≈0 for O/B (early types have
//     no surface convection — smooth photospheres);
//   • starspot coverage and flare rate scale with magnetic `activity`
//     (young/fast M–K dwarfs are flare-prone; O/B and old dwarfs are quiet);
//   • bloom rides luminosity so an O star blows out and an M dwarf barely
//     glows through the shared HDR bloom pass.
// ═══════════════════════════════════════════════════════════════════

import { parseSpectral, seedFrom, type SpectralLetter, type StellarParams } from '../../data/system-gen';

/**
 * The slice of the Step 0 physical record the renderer consumes, plus a
 * stable per-star `seed`. Kept structural (not the whole StellarParams) so the
 * star module has one narrow, testable contract and doesn't couple to fields
 * it never reads.
 */
export interface StarRecord {
  /** Effective temperature, K — drives base colour (kelvinToRGB) + granule tint. */
  tempK: number;
  /** Radius in solar units — limb-darkening softness + relative disc feel. */
  radiusSolar: number;
  /** Luminosity in solar units — HDR emissive magnitude → bloom ∝ luminosity. */
  luminositySolar: number;
  /** Magnetic activity ∈[0,1] — spot coverage + flare/prominence rate. */
  activity: number;
  /** Render-facing main-sequence letter O/B/A/F/G/K/M — granulation gate. */
  spectralType: SpectralLetter;
  /** Stable per-star seed — deterministic spot/flare placement + phase. */
  seed: number;
}

/** Build a StarRecord from a full Step 0 StellarParams + a stable seed. */
export function starRecordFromParams(p: StellarParams, seed: number): StarRecord {
  return {
    tempK: p.tempK,
    radiusSolar: p.radiusSolar,
    luminositySolar: p.luminositySolar,
    activity: p.activity,
    spectralType: p.spectralType,
    seed,
  };
}

/**
 * Derive a StarRecord straight from a catalogued spectral string ("G2V") and a
 * stable identity key (star name). parseSpectral() is Step 0's own entry point
 * — it returns the deterministic physical record — so this reads the Step 0
 * fields exactly as resolveSystem()/generateSystem() would, without needing the
 * galaxy-tier catalogue plumbed down to the local render tier.
 */
export function starRecordFromSpectral(spectral: string, identity: string): StarRecord {
  // parseSpectral tolerates trailing junk ("G2V · HOME"); isolate the leading
  // token for a clean, stable seed key regardless of label decoration.
  const token = (spectral.match(/(?:sd|d|esd|D)?\s*[OBAFGKMD]\s*[0-9]?(?:\.[0-9])?\s*(?:[IV]+|D)?/i)?.[0] ?? spectral).trim();
  const p = parseSpectral(token);
  return starRecordFromParams(p, seedFrom(`${identity}|${token}|star`));
}

// ── Type-gated convection (granulation) ──────────────────────────
// Amplitude of the boiling-granule pattern by convective class. O/B have
// radiative envelopes → featureless photospheres; the pattern deepens through
// F/G/K to its most vigorous on M dwarfs (research §3). Activity nudges it a
// little (a churned photosphere is slightly rougher) but convection is a
// structural property, so the floor is set by type, not activity.
const GRANULATION_BY_LETTER: Record<SpectralLetter, number> = {
  O: 0.0, B: 0.02, A: 0.12, F: 0.4, G: 0.55, K: 0.78, M: 1.0,
};

/** Granulation amplitude ∈[0,1] for the surface fBm. ≈0 for O/B. */
export function granulationAmp(record: StarRecord): number {
  const base = GRANULATION_BY_LETTER[record.spectralType] ?? 0.5;
  return clamp01(base * (0.85 + 0.15 * record.activity));
}

// ── Activity-driven starspots ────────────────────────────────────
// Cool active dwarfs can be heavily spotted; hot stars essentially never.
// Coverage is capped so a maximally-active M dwarf still reads as a star, not
// a checkerboard.
const SPOT_CEIL_BY_LETTER: Record<SpectralLetter, number> = {
  O: 0.0, B: 0.0, A: 0.02, F: 0.08, G: 0.14, K: 0.22, M: 0.34,
};

/** Fractional starspot coverage ∈[0,~0.34], scaled by activity. */
export function spotCoverage(record: StarRecord): number {
  const ceil = SPOT_CEIL_BY_LETTER[record.spectralType] ?? 0.1;
  return clamp01(ceil * record.activity);
}

// ── Activity-gated flares / prominences (S2) ─────────────────────
// Flare-proneness follows activity, weighted toward the cool convective types
// whose strong fields reconnect violently. O/B stay ≈0 regardless of activity.
const FLARE_WEIGHT_BY_LETTER: Record<SpectralLetter, number> = {
  O: 0.0, B: 0.0, A: 0.1, F: 0.35, G: 0.55, K: 0.85, M: 1.0,
};

/**
 * Flare/prominence rate ∈[0,1] — drives limb-eruption frequency and the
 * in-shader flare tendril strength. A young M dwarf sits near 1; a quiet old
 * G/K dwarf near 0; O/B ≈0.
 */
export function flareRate(record: StarRecord): number {
  const w = FLARE_WEIGHT_BY_LETTER[record.spectralType] ?? 0.3;
  return clamp01(w * record.activity);
}

// ── Rotation + differential rotation ─────────────────────────────
// A slow visual spin so the surface lives without smearing; faster for the
// small, typically fast-rotating cool dwarfs. Radians / second of shader time.
export function rotationRate(record: StarRecord): number {
  // Smaller radius ⇒ visibly faster surface advection; keep it gentle.
  const sizeFactor = clamp(1.0 / Math.max(record.radiusSolar, 0.1), 0.3, 3.0);
  return 0.015 * sizeFactor;
}

/** Differential-rotation strength ∈[0,~0.5]: equator leads the poles. More
 *  pronounced on convective (active) stars; ≈0 on rigid early types. */
export function differentialRate(record: StarRecord): number {
  return clamp(0.15 + 0.35 * record.activity * GRANULATION_BY_LETTER[record.spectralType], 0, 0.6);
}

// ── Luminosity → HDR emissive (bloom ∝ luminosity) ───────────────
// Stellar L spans ~1e-3 (M) to ~3e4 (O) L☉ — far too wide to feed a linear
// HDR gain. Compress logarithmically around the Sun (1 L☉ → the mid gain) so
// an M dwarf still glows, the Sun reads familiar, and an O star blows the
// shared threshold-free bloom out hard. This is what makes the distant star
// hand off to a point-of-light of the RIGHT brightness (research §4/§6).
const EMISSIVE_AT_SOLAR = 3.0;

/** HDR emissive multiplier for the surface, monotonically increasing in L. */
export function emissiveGain(record: StarRecord): number {
  const l = Math.max(record.luminositySolar, 1e-4);
  // log10(L) maps [-4 .. +4.5] → a bounded, smooth gain; Sun (log10=0) at mid.
  const g = EMISSIVE_AT_SOLAR * (1.0 + 0.42 * Math.log10(l));
  return clamp(g, 0.6, 9.0);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
