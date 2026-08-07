import { describe, expect, it } from 'vitest';
import { formatChunkHud } from './debug-chunks';
import { ChunkPool } from './chunk-pool';
import { createGeneratorBundle } from '../generators';
import type { ChunkHudStats } from './chunk-types';
import type { GenPlanet } from '../../../data/system-gen';

const ocean: GenPlanet = {
  type: 'ocean', kind: 'rocky', au: 1, massEarth: 1, radiusEarth: 1,
  insolation: 1, isGasGiant: false, hasRings: false, inHZ: true, seed: 2002,
};

const base: ChunkHudStats = {
  resident: 12,
  pending: 4,
  coverPending: 0,
  warmPending: 4,
  building: 0,
  byLevel: {},
  tris: 1024,
  medianTex: 64,
  coverAgeMs: 0,
  streaming: false,
  showChunks: false,
};

describe('formatChunkHud', () => {
  it('shows active cover stream state', () => {
    expect(formatChunkHud({
      ...base, coverPending: 3, coverAgeMs: 1250, streaming: true,
    })).toBe('chunks 12 · pending 4 · STREAM cover 3 1.3s · tris 1024');
  });

  it('shows settled texture fidelity', () => {
    expect(formatChunkHud(base)).toBe('chunks 12 · pending 4 · settled tex~64 · tris 1024');
  });
});

describe('ChunkPool.hud', () => {
  it('reports cover clock and median tex on idle pool', () => {
    const pool = new ChunkPool(1, () => createGeneratorBundle(ocean), () => 0.04);
    const hud = pool.hud();
    expect(hud.coverPending).toBe(0);
    expect(hud.coverAgeMs).toBe(0);
    expect(hud.medianTex).toBe(0);
    expect(hud.streaming).toBe(false);
    expect(formatChunkHud(hud)).toBe('chunks 0 · pending 0 · settled tex~0 · tris 0');
    pool.dispose();
  });
});
