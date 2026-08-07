import { describe, expect, it } from 'vitest';
import type { GenPlanet } from '../../../data/system-gen';
import { createGeneratorBundle, sampleSurface } from './index';
import { iceCapCoverage, snowCover } from './ice';

const ocean: GenPlanet = {
  type: 'ocean', kind: 'rocky', au: 1, massEarth: 1, radiusEarth: 1,
  insolation: 1, isGasGiant: false, hasRings: false, inHZ: true, seed: 2002,
};

describe('generators', () => {
  it('samples deterministic height + climate from seed+dir', () => {
    const b = createGeneratorBundle(ocean);
    const a = sampleSurface(b, [0, 1, 0]);
    const c = sampleSurface(b, [0, 1, 0]);
    expect(a.height).toBe(c.height);
    expect(a.color).toEqual(c.color);
    expect(a.height).toBeGreaterThanOrEqual(0);
    expect(a.height).toBeLessThanOrEqual(1);
  });

  it('fingerprint changes when params change', () => {
    const b = createGeneratorBundle(ocean);
    const fp0 = b.fingerprint();
    const next = { ...b.params, seaLevel: b.params.seaLevel + 0.05 };
    b.refreshParams(next, b.macro);
    expect(b.fingerprint()).not.toBe(fp0);
  });

  it('weather density is in 0..1', () => {
    const b = createGeneratorBundle(ocean);
    const d = b.weather.cloudDensity([1, 0, 0], 1.5);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(1);
  });

  it('ice caps are longitude-asymmetric (not perfect latitude discs)', () => {
    const seed: [number, number, number] = [0.2, 0.4, 0.6];
    const lat = 0.88;
    const h = 0.55;
    const a = iceCapCoverage([Math.sqrt(1 - lat * lat), lat, 0], h, 0.5, 0.55, seed);
    const b = iceCapCoverage([0, lat, Math.sqrt(1 - lat * lat)], h, 0.5, 0.55, seed);
    const c = iceCapCoverage(
      [-Math.sqrt(1 - lat * lat) * 0.7, lat, Math.sqrt(1 - lat * lat) * 0.7],
      h, 0.5, 0.55, seed,
    );
    const spread = Math.max(a, b, c) - Math.min(a, b, c);
    expect(spread).toBeGreaterThan(0.02);
  });

  it('temperate lowlands are not snow-white', () => {
    const b = createGeneratorBundle(ocean);
    // Equatorial land-ish sample: should not be near-white
    const s = sampleSurface(b, [1, 0.05, 0]);
    if (!s.sea) {
      const maxC = Math.max(s.color[0], s.color[1], s.color[2]);
      expect(maxC).toBeLessThan(0.85);
    }
    // Mid-latitude low elev snow should be weak
    const snow = snowCover(0.55, 0.4, 0.05, 0.3, 0.75);
    expect(snow).toBeLessThan(0.15);
  });

  it('moist equatorial land is greener than arid (biome cover responds)', () => {
    const b = createGeneratorBundle(ocean);
    const wet = { ...b.params, moisture: 1.2, lushDepth: 1.2, aridBelts: 0.2, snowfall: 0.2 };
    const dry = { ...b.params, moisture: 0.05, lushDepth: 0.2, aridBelts: 1.2, snowfall: 0.2 };
    b.refreshParams(wet, b.macro);
    const sw = sampleSurface(b, [1, 0.08, 0]);
    b.refreshParams(dry, b.macro);
    const sd = sampleSurface(b, [1, 0.08, 0]);
    if (!sw.sea && !sd.sea) {
      expect(sw.color[1]).toBeGreaterThan(sw.color[0] * 0.85);
      expect(sd.color[0]).toBeGreaterThan(sd.color[1] * 0.9);
      const wetMax = Math.max(...sw.color);
      const dryMax = Math.max(...sd.color);
      expect(wetMax).toBeLessThan(dryMax + 0.05);
    }
  });

  it('default ocean land is not chalk-pale at mid latitudes', () => {
    const b = createGeneratorBundle(ocean);
    const dirs: [number, number, number][] = [
      [1, 0.2, 0], [0.7, 0.3, 0.5], [0.2, 0.15, 0.9],
    ];
    let landSamples = 0;
    let pale = 0;
    for (const d of dirs) {
      const len = Math.hypot(d[0], d[1], d[2]);
      const s = sampleSurface(b, [d[0] / len, d[1] / len, d[2] / len]);
      if (s.sea) continue;
      landSamples++;
      const maxC = Math.max(s.color[0], s.color[1], s.color[2]);
      if (maxC > 0.72) pale++;
    }
    expect(landSamples).toBeGreaterThan(0);
    expect(pale).toBe(0);
  });
});
