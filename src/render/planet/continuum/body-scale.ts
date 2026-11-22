// ═══════════════════════════════════════════════════════════════════
// BODY SCALE — per-body radius normalization for AU-gated approach/LOD tiers.
//
// Confirmed bug: every Continuum per-body camera-distance tier (atmosphere-
// flight blend in approach-camera.ts, chunk-approach cover/texture resolution
// in chunk-types.ts/chunk-pool.ts/chunk-lod.ts, cloud-voxel activation in
// cloud-voxels.ts, surface-voxel activation/exit/warm in surface-voxels.ts)
// gates on the raw camera-to-body distance in AU (`viewAu`) against a FIXED
// constant shared by every body, regardless of that body's own size. A tiny
// Mercury-class body and a huge GasGiant-class body were fed the exact same
// `viewAu` number (registry.ts / planet-lab.ts compute ONE global value from
// `physicalAuFromZoom(Game.data.zoomLevel)` and hand it to every registered
// globe) and compared against the same absolute-AU thresholds, so the two
// never reached the same *visual* framing (body-relative distance) at the
// same nominal tier.
//
// Fix: every one of those fixed *_AU constants was originally tuned by eye
// against an Earth-radius body — specifically `visualRadius()`'s own output
// for `radiusEarth = 1` (the Lab's `ocean` exemplar): 0.18 + 1·0.18 = 0.36
// authoring world-units (the SAME "1 AU = AU_TO_WU authoring units" space
// `orbitalPosition()` places bodies in, so this is directly comparable to
// `viewAu` once divided through — see the derivation below). Rather than
// hunt down and individually convert every one of the many downstream *_AU
// comparisons scattered across chunk-pool.ts/chunk-lod.ts/chunk-types.ts,
// each per-body module normalizes the raw incoming `viewAu` ONCE, at its own
// `setViewDistanceAu(au)` setter (the single boundary where the shared,
// body-agnostic global AU value enters a per-body module) — into "the AU
// value this body would report if it had Earth's reference radius":
//
//   normalized = viewAu · (EARTH_REF_VISUAL_RADIUS / thisBody.radius)
//
// This is algebraically identical to comparing `viewAu / thisBody.radius`
// (a body-relative radii-multiple) against `constant / EARTH_REF_VISUAL_RADIUS`
// (the equivalent radii-multiple threshold) — it just keeps the existing
// fixed *_AU constants and every downstream comparison against them
// unchanged, so the fix is one small, auditable seam instead of a scattered
// rewrite. A body exactly Earth's authored size gets factor 1 — BYTE-
// IDENTICAL behavior to before this fix (the required no-regression case at
// PERF_BASELINE_AU=0.8). A body twice Earth's authored radius reaches every
// tier at roughly twice the real `viewAu` distance (comparable visual
// framing); a body half Earth's size reaches every tier at roughly half the
// real `viewAu` distance. See docs/planet-visual-realism.md §4.2 for the
// LOD/resolution ladder this feeds, and lod.ts's `apparentRadiusPx` /
// approach-camera.ts's P2-19 `worldRadius`-normalized swing math for the
// existing radius-relative pattern this extends.
// ═══════════════════════════════════════════════════════════════════

/** `visualRadius()` (planet/index.ts) evaluated at `radiusEarth = 1` — the
 *  Lab's own Earth-class (`ocean` exemplar) reference size, in the same
 *  authoring world-units every body's `radius` constructor arg uses. This is
 *  the calibration anchor: every existing fixed `*_AU` threshold was tuned
 *  against a body this size, so `earthEquivalentAu` is an identity transform
 *  (factor 1) exactly when `bodyRadius === EARTH_REF_VISUAL_RADIUS`. */
export const EARTH_REF_VISUAL_RADIUS = 0.36;

/**
 * Rescale a real camera-to-body distance (`viewAu`, AU) by this body's own
 * authoring-unit radius relative to the Earth reference above, so every
 * downstream comparison against a fixed `*_AU` constant becomes body-size-
 * relative instead of absolute. `bodyRadius <= 0` (defensive — shouldn't
 * happen for a real body) falls back to the identity (no normalization)
 * rather than dividing by zero/negative.
 */
export function earthEquivalentAu(viewAu: number, bodyRadius: number): number {
  if (!(bodyRadius > 1e-9)) return viewAu;
  return viewAu * (EARTH_REF_VISUAL_RADIUS / bodyRadius);
}
