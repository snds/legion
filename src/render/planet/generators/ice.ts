// Shared ice/snow fields — polar sheets + alpine snow (not planet-wide whiteout).

import { fbm3, snoise3 } from '../simplex';
import type { Vec3 } from '../cube-sphere';

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / Math.max(1e-6, e1 - e0));
  return t * t * (3 - 2 * t);
}

/**
 * Permanent polar ice-sheet coverage 0..1.
 * Margin is noise-broken; altitude only nudges the fringe (not mid-latitude
 * continents — a 0.30 alt boost was painting half the land white).
 */
export function iceCapCoverage(
  dir: Vec3,
  height: number,
  seaLevel: number,
  latitudeIce: number,
  noiseSeed: Vec3,
): number {
  if (latitudeIce <= 0) return 0;
  const al = Math.abs(dir[1]);
  const sx = noiseSeed[0], sy = noiseSeed[1], sz = noiseSeed[2];
  const lobes = fbm3(
    dir[0] * 1.6 + sx * 0.4,
    dir[1] * 1.6 + sy * 0.4,
    dir[2] * 1.6 + sz * 0.4,
  ) * 0.12;
  const bays = fbm3(
    dir[0] * 5 + sx,
    dir[1] * 5 + sy,
    dir[2] * 5 + sz,
  ) * 0.055;
  const fine = snoise3(
    dir[0] * 15 + sx * 2.3,
    dir[1] * 15 + sy * 2.3,
    dir[2] * 15 + sz * 2.3,
  ) * 0.018;
  // Highlands hold ice slightly further equatorward — keep this small.
  const alt = 0.08 * clamp01((height - seaLevel) * 2.0);
  const current = 0.04 * Math.sin(Math.atan2(dir[2], dir[0]) + sx * 2)
    * smoothstep(0.35, 0.8, al);
  // Stronger polar gate: latitudeIce 0.3 → line ≈ 0.90 (was 0.835).
  const line = 1 - latitudeIce * 0.35;
  const raw = smoothstep(0, 0.16, al + lobes + bays + fine + alt + current - line);
  // Kill residual mid-latitude sheet bleed.
  return raw * smoothstep(0.45, 0.72, al);
}

/**
 * Snowpack albedo (no mass). Needs cold air AND (alpine OR polar) so temperate
 * lowlands stay green/brown even when snowfall is high.
 */
export function snowCover(
  temp: number,
  lat: number,
  elev: number,
  latitudeIce: number,
  snowfall: number,
): number {
  if (snowfall <= 0) return 0;
  // Colder threshold than before — only truly cold air whitens.
  const line = 0.02 + 0.28 * clamp01(latitudeIce);
  const cold = smoothstep(line + 0.10, line - 0.06, temp);
  const alpine = smoothstep(0.22, 0.55, elev);
  const polar = smoothstep(0.58, 0.88, lat);
  const where = Math.max(alpine, polar);
  return clamp01(Math.pow(cold, 1.15) * where * snowfall);
}
