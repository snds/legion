import { describe, it, expect } from 'vitest';
import {
  apparentRadiusPx, stageForPx, stageFor, dotBrightness, dotSizePx,
  LodStage, LOD_DOT_MAX_PX, LOD_IMPOSTOR_MAX_PX,
} from './lod';

const FOV = (55 * Math.PI) / 180;
const H = 1080;

describe('apparent size', () => {
  it('shrinks monotonically with distance', () => {
    let prev = Infinity;
    for (const d of [10, 50, 100, 1000, 10000]) {
      const px = apparentRadiusPx(1, d, FOV, H);
      expect(px).toBeLessThan(prev);
      prev = px;
    }
  });

  it('grows with radius at a fixed distance', () => {
    expect(apparentRadiusPx(2, 100, FOV, H)).toBeGreaterThan(apparentRadiusPx(1, 100, FOV, H));
  });
});

describe('stage hand-off', () => {
  it('classifies dot / impostor / globe by pixel size', () => {
    expect(stageForPx(1)).toBe(LodStage.Dot);
    expect(stageForPx(LOD_DOT_MAX_PX + 1)).toBe(LodStage.Impostor);
    expect(stageForPx(LOD_IMPOSTOR_MAX_PX + 1)).toBe(LodStage.Globe);
  });

  it('a close planet resolves to the full globe', () => {
    expect(stageFor(1, 5, FOV, H)).toBe(LodStage.Globe);
  });

  it('a very distant planet collapses to a dot', () => {
    expect(stageFor(1, 500000, FOV, H)).toBe(LodStage.Dot);
  });
});

describe('no fixed-size pile-up (brightness falloff)', () => {
  it('sub-pixel planets fade with the square of apparent size', () => {
    expect(dotBrightness(1)).toBe(1);
    expect(dotBrightness(0.5)).toBeCloseTo(0.25, 5);
    expect(dotBrightness(0.1)).toBeCloseTo(0.01, 5);
    expect(dotBrightness(0)).toBe(0);
  });

  it('a farther dot is dimmer than a nearer one', () => {
    const nearPx = apparentRadiusPx(1, 200000, FOV, H);
    const farPx = apparentRadiusPx(1, 800000, FOV, H);
    expect(dotBrightness(farPx)).toBeLessThan(dotBrightness(nearPx));
  });

  it('dot size never collapses to zero nor balloons', () => {
    expect(dotSizePx(0)).toBeGreaterThan(0);
    expect(dotSizePx(1000)).toBeLessThanOrEqual(LOD_DOT_MAX_PX * 2);
  });
});
