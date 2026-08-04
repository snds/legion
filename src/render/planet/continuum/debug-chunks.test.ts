import { describe, expect, it } from 'vitest';
import { formatChunkHud } from './debug-chunks';
import type { ChunkHudStats } from './chunk-types';

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
