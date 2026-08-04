import { describe, expect, it } from 'vitest';
import { rootNode, childNodes } from '../cube-sphere';
import { allNodesAtLevel, isDescendant, selectChunkLeaves, uniformLevelForDistance } from './chunk-lod';
import {
  parentNodeKey, nodeFromKey, nodeKey, CHUNK_MESH_GRID, meshGridForLevel,
  texResForLevel, texResCoarseForLevel, texResStreamForLevel,
} from './chunk-types';
import { sampleHeightfieldChunk } from './chunk-sample';
import { meshHeightfieldChunk } from './chunk-mesher';
import {
  canPolishCover, canWarmPrefetch, coverCatchUpNeeded, coverTickLimits,
  selectChunkBuildQuality,
} from './chunk-pool';
import { createGeneratorBundle, sampleSurface } from '../generators';
import type { GenPlanet } from '../../../data/system-gen';

const ocean: GenPlanet = {
  type: 'ocean', kind: 'rocky', au: 1, massEarth: 1, radiusEarth: 1,
  insolation: 1, isGasGiant: false, hasRings: false, inHZ: true, seed: 2002,
};

describe('continuum chunks', () => {
  it('selects a bounded leaf set at 0.8 AU-ish distance', () => {
    const radius = 1;
    const leaves = selectChunkLeaves({
      camLocal: [0, 0, radius * 2.5],
      radius,
    });
    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.length).toBeLessThanOrEqual(120);
    // Orbit band → uniform full-sphere preload
    expect(uniformLevelForDistance(radius * 2.5, radius)).toBe(2);
    expect(leaves.length).toBe(allNodesAtLevel(2).length);
  });

  it('engages view-LOD densify below ~1.55R (B2)', () => {
    expect(uniformLevelForDistance(1.5, 1)).toBe(-1);
    expect(uniformLevelForDistance(1.6, 1)).toBe(2);
    const close = selectChunkLeaves({ camLocal: [0, 0, 1.15], radius: 1 });
    expect(close.length).toBeGreaterThan(0);
    expect(close.length).toBeLessThanOrEqual(128);
    expect(close.some((n) => n.level >= 3)).toBe(true);
  });

  it('parent/child handoff helpers', () => {
    const root = rootNode(0);
    const [c0] = childNodes(root);
    expect(isDescendant(c0, root)).toBe(true);
    expect(parentNodeKey(c0)).toBe(nodeKey(root));
    const back = nodeFromKey(nodeKey(c0));
    expect(back).toEqual(c0);
  });

  it('samples dense albedo bake + meshes a heightfield chunk', () => {
    const bundle = createGeneratorBundle(ocean);
    const chunk = sampleHeightfieldChunk(bundle, rootNode(0));
    const dim = CHUNK_MESH_GRID + 1;
    expect(chunk.heights.length).toBe(dim * dim);
    const texRes = texResForLevel(0);
    expect(chunk.albedoRGBA.length).toBe(texRes * texRes * 4);
    const geo = meshHeightfieldChunk(chunk, 1, 0.04, { skirts: true, seaLevel: 0.5 });
    expect(geo.getAttribute('position').count).toBeGreaterThan(dim * dim);
    expect(geo.getAttribute('uv')).toBeTruthy();
    expect(geo.getAttribute('aColor')).toBeTruthy();
    const rgba = chunk.albedoRGBA;
    let hasBlueish = false;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 2] > rgba[i] && rgba[i + 2] > 40) { hasBlueish = true; break; }
    }
    expect(hasBlueish).toBe(true);
    geo.dispose();
  });

  it('mesh grid densifies at high levels (B2)', () => {
    expect(meshGridForLevel(2)).toBe(CHUNK_MESH_GRID);
    expect(meshGridForLevel(5)).toBeGreaterThan(CHUNK_MESH_GRID);
    expect(meshGridForLevel(8)).toBeGreaterThan(meshGridForLevel(5));
  });

  it('crater macro changes height when coverage rises (A4)', () => {
    const bundle = createGeneratorBundle(ocean);
    const dir: [number, number, number] = [0.6, 0.2, 0.75];
    const len = Math.hypot(...dir);
    const d: [number, number, number] = [dir[0] / len, dir[1] / len, dir[2] / len];
    bundle.refreshParams(bundle.params, {
      ...bundle.macro, craters: 0, craterDepth: 0.12, craterFreq: 6,
    });
    const h0 = sampleSurface(bundle, d).height;
    bundle.refreshParams(bundle.params, {
      ...bundle.macro, craters: 0.85, craterDepth: 0.14, craterFreq: 6,
    });
    const h1 = sampleSurface(bundle, d).height;
    // Not every dir hits a crater — sample several dirs for variance.
    let spread = Math.abs(h1 - h0);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const dd: [number, number, number] = [
        Math.cos(a) * 0.8, 0.15, Math.sin(a) * 0.8,
      ];
      const L = Math.hypot(...dd);
      dd[0] /= L; dd[1] /= L; dd[2] /= L;
      bundle.refreshParams(bundle.params, {
        ...bundle.macro, craters: 0, craterDepth: 0.12,
      });
      const a0 = sampleSurface(bundle, dd).height;
      bundle.refreshParams(bundle.params, {
        ...bundle.macro, craters: 0.9, craterDepth: 0.14, craterFreq: 7,
      });
      const a1 = sampleSurface(bundle, dd).height;
      spread = Math.max(spread, Math.abs(a1 - a0));
    }
    expect(spread).toBeGreaterThan(0.004);
  });

  it('coarse albedo res is cheaper than full (progressive upgrade ladder)', () => {
    for (const L of [0, 1, 2, 4, 7]) {
      expect(texResCoarseForLevel(L)).toBeLessThanOrEqual(texResForLevel(L));
      expect(texResCoarseForLevel(L)).toBeGreaterThanOrEqual(32);
    }
    expect(texResCoarseForLevel(2)).toBeLessThan(texResForLevel(2));
  });

  it('orbit albedo denser (FPS headroom → texel density)', () => {
    expect(texResForLevel(2)).toBeGreaterThanOrEqual(256);
    expect(texResCoarseForLevel(2)).toBeLessThanOrEqual(64);
    expect(texResCoarseForLevel(2)).toBeLessThan(texResForLevel(2));
  });

  it('mid-AU densifies with view-LOD; far mid stays uniform L2', () => {
    expect(uniformLevelForDistance(2.5, 1, 0.6)).toBe(2);
    expect(uniformLevelForDistance(2.5, 1, 0.3)).toBe(-1);
    expect(uniformLevelForDistance(2.5, 1, 0.8)).toBe(2);
    const mid = selectChunkLeaves({
      camLocal: [0, 0, 2.5],
      radius: 1,
      viewAu: 0.3,
    });
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.length).toBeLessThanOrEqual(128);
    expect(mid.some((n) => n.level >= 3)).toBe(true);
  });

  it('collapseToCap never empties and stays under cap', async () => {
    const { collapseLeavesToCap, prefetchApproachLeaves } = await import('./chunk-lod');
    const dense = selectChunkLeaves({
      camLocal: [0, 0, 1.2],
      radius: 1,
      viewAu: 0.12,
    });
    const capped = collapseLeavesToCap(dense, 40);
    expect(capped.length).toBeGreaterThan(0);
    expect(capped.length).toBeLessThanOrEqual(40);
    const warmFar = prefetchApproachLeaves({
      camLocal: [0, 0, 3.0],
      radius: 1,
      viewAu: 0.8,
    });
    expect(warmFar.length).toBeLessThanOrEqual(12);
    const warmNear = prefetchApproachLeaves({
      camLocal: [0, 0, 2.5],
      radius: 1,
      viewAu: 0.4,
    });
    expect(warmNear.length).toBe(0);
  });

  it('upgrade ladder climbs as AU decreases (stepped, not frozen)', async () => {
    const { texResCeilingForAu, texResNextUpgrade } = await import('./chunk-types');
    expect(texResCeilingForAu(2, 0.8)).toBeGreaterThanOrEqual(256);
    expect(texResCeilingForAu(3, 0.3)).toBeGreaterThanOrEqual(128);
    expect(texResNextUpgrade(16, 3, 0.3)).toBeGreaterThan(16);
    expect(texResNextUpgrade(16, 3, 0.3)).toBeLessThanOrEqual(48);
    expect(texResNextUpgrade(48, 3, 0.3)).toBeGreaterThan(48);
    // Never jump straight to full ceiling from stream.
    expect(texResNextUpgrade(16, 2, 0.8)).toBeLessThan(256);
    expect(texResNextUpgrade(16, 3, 0.3)).toBeLessThan(texResCeilingForAu(3, 0.3));
  });

  it('caps all stream texture levels at 24', () => {
    for (let level = 0; level <= 8; level++) {
      expect(texResStreamForLevel(level)).toBeLessThanOrEqual(24);
    }
  });

  it('uses stream-only quality and bans upgrades during cover', () => {
    const quality = selectChunkBuildQuality(2, {
      coverPending: true,
      forceStream: false,
      warm: false,
      streaming: false,
    });
    expect(quality.texRes).toBe(texResStreamForLevel(2));
    expect(quality.meshGrid).toBeLessThanOrEqual(20);
  });

  it('keeps forced stream builds off the full upgrade path', () => {
    const quality = selectChunkBuildQuality(2, {
      coverPending: false,
      forceStream: true,
      warm: false,
      streaming: false,
    });
    expect(quality.texRes).toBe(texResStreamForLevel(2));
  });

  it('enters cover catch-up when projected cover exceeds the SLA', () => {
    expect(coverCatchUpNeeded(96, 30)).toBe(true);
  });

  it('does not enter cover catch-up while projected cover is under the SLA', () => {
    expect(coverCatchUpNeeded(89, 30)).toBe(false);
  });

  it('uses the raised budget and build cap during cover catch-up', () => {
    expect(coverTickLimits(true, true, 96)).toEqual({ budgetMs: 12, maxBuilds: 4 });
  });

  it('skips warm prefetch and polish while cover catch-up is active', () => {
    expect(canWarmPrefetch(true, false, 0, 0, 3, 0.8, 31)).toBe(false);
    expect(canPolishCover(true, 0, false, 4)).toBe(false);
    expect(canWarmPrefetch(false, false, 0, 0, 3, 0.8, 31)).toBe(true);
    expect(canPolishCover(false, 0, false, 4)).toBe(true);
  });

  it('samples an L2 stream leaf within the soft 40ms guard', () => {
    const bundle = createGeneratorBundle(ocean);
    const node = childNodes(childNodes(rootNode(0))[0]!)[0]!;
    const t0 = performance.now();
    const chunk = sampleHeightfieldChunk(bundle, node, {
      texRes: 16,
      meshGrid: 20,
      skipRelief: true,
    });
    const elapsedMs = performance.now() - t0;
    expect(chunk.texRes).toBe(16);
    // Soft enough for normal CI variance, strict enough to catch accidental full bakes.
    expect(elapsedMs).toBeLessThan(40);
  });
});
