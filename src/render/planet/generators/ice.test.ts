import { describe, it, expect } from 'vitest';
import { snowCover } from './ice';

describe('P2-23 — snowCover cold-direction regression', () => {
  it('is near-1 for a genuinely COLD temp and near-0 for a WARM temp, at the same elevation/latitude', () => {
    // Reversed-argument smoothstep bug (fixed P2-23) made `cold` invert:
    // ≈1 for warm temp, ≈0 for cold temp. Pin the correct direction.
    const elev = 0.5; // inside the "alpine" gate so `where` > 0
    const lat = 0;
    const latitudeIce = 0.2;
    const snowfall = 0.8;
    const cold = snowCover(0.02, lat, elev, latitudeIce, snowfall);
    const warm = snowCover(0.9, lat, elev, latitudeIce, snowfall);
    expect(cold).toBeGreaterThan(0.5);
    expect(warm).toBeLessThan(0.05);
  });

  it('stays 0 at typical equatorial daylight temp regardless of snowfall', () => {
    // The regression this guards: a warm, moderate-elevation equatorial
    // sample (temp ~0.7-0.75, elev ~0.5) must not read as snowy just
    // because a cold world's `snowfall` value is elevated.
    const result = snowCover(0.74, 0, 0.5, 0.35, 1.05);
    expect(result).toBe(0);
  });
});
