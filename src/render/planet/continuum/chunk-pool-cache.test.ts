// (P2-3) Integration coverage for ChunkPool's ChunkAssetCache wiring —
// drives the REAL public tick()/updateLod() build loop (not the private
// buildOne/upgradeOneAlbedo methods directly) against an in-memory fake
// cache, so this exercises the same code path a real BodyChunkCache hit
// would. The actual OPFS/Dexie-backed store is verified separately
// through a real ?system=sol boot (see task note) — this file only
// covers the cache CONTRACT (persist gate, hit swap-in), same split as
// body-asset-store.test.ts covers the store's own pure logic.
//
// Driving the real close-view-LOD scheduler across ~65 facing leaves to a
// full polish settle costs real wall-clock CPU (~10s per full-settle run,
// matching this project's own documented per-chunk bake costs — see
// chunk-types.ts CHUNK_TEX_RES comment) — these tests use a generous
// per-test timeout rather than a synthetic/mocked scheduler, so what's
// actually verified is the SAME build loop production code runs.

import { describe, expect, it } from 'vitest';
import { ChunkPool, type ChunkAssetCache } from './chunk-pool';
import { createGeneratorBundle } from '../generators';
import { APPROACH_FIDELITY_MIN_TEX_AT_03AU } from './chunk-types';
import type { GenPlanet } from '../../../data/system-gen';
import type { Vec3 } from '../cube-sphere';

const rocky: GenPlanet = {
  type: 'rocky', kind: 'rocky', au: 1, massEarth: 1, radiusEarth: 1,
  insolation: 1, isGasGiant: false, hasRings: false, inHZ: false, seed: 1001,
};

class FakeAssetCache implements ChunkAssetCache {
  readonly store = new Map<string, { texRes: number; albedoRGBA: Uint8Array }>();
  readonly puts: Array<{ nodeKey: string; texRes: number }> = [];

  get(nodeKey: string) { return this.store.get(nodeKey); }

  put(nodeKey: string, texRes: number, albedoRGBA: Uint8Array): void {
    this.puts.push({ nodeKey, texRes });
    const existing = this.store.get(nodeKey);
    if (!existing || existing.texRes < texRes) this.store.set(nodeKey, { texRes, albedoRGBA });
  }
}

/** Close view-LOD camera position (matches chunk.test.ts's own close-band
 *  fixture: `camLocal: [0, 0, 1.15], radius: 1`). */
const CLOSE_CAM: Vec3 = [0, 0, 1.15];

function newPool(cache?: ChunkAssetCache): ChunkPool {
  return new ChunkPool(1, () => createGeneratorBundle(rocky), () => 0.04, cache);
}

function settle(pool: ChunkPool, count: number): void {
  pool.updateLod(CLOSE_CAM, CLOSE_CAM, 0, true);
  for (let i = 0; i < count; i++) pool.tick(1 / 60);
}

/** Ticks enough for cover to fully drain + most facing leaves to cross the
 *  polish floor (empirically ~80-110 ticks for this fixture — see task
 *  note debug run). Kept well short of full-ceiling convergence so the
 *  "warm start" comparison test still has a real cold/warm gap to assert
 *  (a cold pool eventually also reaches this median on its own — see
 *  `WARM_COMPARE_TICKS` below, chosen to stay well before that catch-up). */
const FULL_SETTLE_TICKS = 110;
/** Ticks for the cold-vs-warm comparison — enough for a cold pool to
 *  finish its initial cover build (all leaves resident) but nowhere near
 *  enough to have started polishing past stream/coarse quality. */
const WARM_COMPARE_TICKS = 60;

describe('ChunkPool ChunkAssetCache wiring', () => {
  it('only persists builds at/above the SLA fidelity floor, never cheap stream/coarse ones', () => {
    const cache = new FakeAssetCache();
    const pool = newPool(cache);
    settle(pool, FULL_SETTLE_TICKS);

    expect(cache.puts.length).toBeGreaterThan(0);
    for (const p of cache.puts) {
      expect(p.texRes).toBeGreaterThanOrEqual(APPROACH_FIDELITY_MIN_TEX_AT_03AU);
    }
    pool.dispose();
  }, 30_000);

  it('never calls put() with a lower texRes than what is already cached for that node (monotonic)', () => {
    const cache = new FakeAssetCache();
    const pool = newPool(cache);
    settle(pool, FULL_SETTLE_TICKS);

    const seenMax = new Map<string, number>();
    for (const p of cache.puts) {
      const prevMax = seenMax.get(p.nodeKey) ?? 0;
      expect(p.texRes).toBeGreaterThanOrEqual(prevMax);
      seenMax.set(p.nodeKey, p.texRes);
    }
    pool.dispose();
  }, 30_000);

  it('a pre-populated cache reaches polish-tier fidelity far sooner than a cold pool — no re-climb', () => {
    // First pool "plays" a full session and populates the cache.
    const cache = new FakeAssetCache();
    const coldPool = newPool(cache);
    settle(coldPool, FULL_SETTLE_TICKS);
    expect(cache.puts.length).toBeGreaterThan(0);
    coldPool.dispose();

    // A genuinely cold pool at WARM_COMPARE_TICKS: cover has fully drained
    // (all leaves resident) but polish has not caught up yet — this is the
    // "just reloaded, no cache" baseline.
    const coldBaseline = newPool();
    settle(coldBaseline, WARM_COMPARE_TICKS);
    const coldMedian = coldBaseline.hud().medianTex;
    coldBaseline.dispose();
    expect(coldMedian).toBeLessThan(APPROACH_FIDELITY_MIN_TEX_AT_03AU);

    // Second pool "reloads" sharing the SAME (already-populated) cache —
    // BodyChunkCache.preload() would have already loaded these entries into
    // memory before the camera can reach `near`, so from ChunkPool's point
    // of view this cache is already warm at construction time. buildOne's
    // cache-hit swap-in means it never has to re-pay the climb.
    const warmPool = newPool(cache);
    settle(warmPool, WARM_COMPARE_TICKS);
    const warmMedian = warmPool.hud().medianTex;
    warmPool.dispose();

    expect(warmMedian).toBeGreaterThan(coldMedian);
    expect(warmMedian).toBeGreaterThanOrEqual(APPROACH_FIDELITY_MIN_TEX_AT_03AU);
  }, 45_000);

  it('with no assetCache supplied, behaves exactly as before this task (no crash, live generation only)', () => {
    const pool = newPool();
    settle(pool, 30);
    expect(pool.hud().resident).toBeGreaterThan(0);
    pool.dispose();
  }, 15_000);
});
