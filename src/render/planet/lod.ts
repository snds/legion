// ═══════════════════════════════════════════════════════════════════
// PLANET LOD — dot → impostor → globe hand-off (no fixed-size pile-up)
//
// procedural-worlds-plan.md P1: "LOD hand-off dot → globe with size+brightness
// falloff (no fixed-size pile-up)". A planet's apparent size is its TRUE angular
// size, so a far planet shrinks toward a sub-pixel dot instead of clamping to a
// fixed sprite (the "oversized ball" failure the catalogue tier already fought).
//
// Three stages, chosen purely by apparent pixel radius:
//   • DOT      — sub-pixel/small: a point whose size = true angular size, dimmed
//                as it falls below a pixel so a swarm of far planets doesn't glow.
//   • IMPOSTOR — small but resolvable: one analytic ray-sphere fragment draw
//                (procedural-planet-research.md §1, jsulpis realtime-planet-shader).
//   • GLOBE    — large: the full cube-sphere quadtree mesh + atmosphere.
//
// All pure functions of (worldRadius, distance, fov, viewportHeight) so the tests
// pin the thresholds and the brightness falloff exactly.
// ═══════════════════════════════════════════════════════════════════

export enum LodStage {
  Dot = 0,
  Impostor = 1,
  Globe = 2,
}

/** Apparent radius of a sphere in PIXELS. `apparent = R/dist` (radians, small-
 *  angle) projected through the vertical FOV onto the viewport height. */
export function apparentRadiusPx(
  worldRadius: number, distance: number, fovYRad: number, viewportH: number,
): number {
  if (distance <= 1e-9) return viewportH; // effectively on top of it
  const angular = Math.atan(worldRadius / distance); // half-angle, radians
  const halfFov = fovYRad / 2;
  return (angular / halfFov) * (viewportH / 2);
}

/** Pixel thresholds for the stage hand-off. Hysteresis-free (single crossing);
 *  the small gap between DOT→IMPOSTOR and IMPOSTOR→GLOBE avoids a hard pop. */
export const LOD_DOT_MAX_PX = 2.5;      // ≤ this ⇒ a dot
export const LOD_IMPOSTOR_MAX_PX = 28;  // between ⇒ analytic impostor; above ⇒ full globe

export function stageForPx(px: number): LodStage {
  if (px <= LOD_DOT_MAX_PX) return LodStage.Dot;
  if (px <= LOD_IMPOSTOR_MAX_PX) return LodStage.Impostor;
  return LodStage.Globe;
}

export function stageFor(
  worldRadius: number, distance: number, fovYRad: number, viewportH: number,
): LodStage {
  return stageForPx(apparentRadiusPx(worldRadius, distance, fovYRad, viewportH));
}

/**
 * Brightness for the DOT stage. A planet smaller than a pixel can't get brighter
 * by staying a full pixel — its energy falls with the SQUARE of its shrinking
 * apparent radius, so distant planets fade out instead of forming a fixed-size
 * glowing pile. Clamped to [0,1]; = 1 once it's at least a pixel across.
 */
export function dotBrightness(px: number): number {
  if (px >= 1) return 1;
  const t = Math.max(0, px);
  return t * t;
}

/** Point-sprite pixel size for the DOT stage — its true apparent diameter,
 *  floored so it never fully vanishes (it dims via dotBrightness instead). */
export function dotSizePx(px: number): number {
  return Math.max(0.75, Math.min(LOD_DOT_MAX_PX * 2, px * 2));
}
