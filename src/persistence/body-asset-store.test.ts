import { describe, expect, it, vi } from 'vitest';
import {
  hashChunkFileId, estimateAlbedoBytes, pickEvictions, BODY_CHUNK_STORE_BYTE_BUDGET,
  BodyChunkCache, type BodyChunkIO,
} from './body-asset-store';
import type { BodyChunkMetaStore, ChunkMetaRecord } from './body-asset-db';

// ── hashChunkFileId ──────────────────────────────────────────────

describe('hashChunkFileId', () => {
  it('is deterministic', () => {
    const id = '12345:3:5:0.031250:0.062500:some-fingerprint';
    expect(hashChunkFileId(id)).toBe(hashChunkFileId(id));
  });

  it('is filesystem-safe (fixed-length hex) even for a 500+ char fingerprint', () => {
    const longFingerprint = 'x'.repeat(600);
    const id = `12345:3:5:0.031250:0.062500:${longFingerprint}`;
    const hash = hashChunkFileId(id);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces different hashes for different node keys under the same body', () => {
    const a = hashChunkFileId('1:0:0:0.0:0.0:fp');
    const b = hashChunkFileId('1:0:1:0.0:0.0:fp');
    expect(a).not.toBe(b);
  });

  it('produces different hashes across fingerprints for the same node (invalidation)', () => {
    const a = hashChunkFileId('1:0:0:0.0:0.0:fp-v1');
    const b = hashChunkFileId('1:0:0:0.0:0.0:fp-v2');
    expect(a).not.toBe(b);
  });
});

// ── estimateAlbedoBytes ──────────────────────────────────────────

describe('estimateAlbedoBytes', () => {
  it('matches the RGBA8 byte layout (texRes² × 4)', () => {
    expect(estimateAlbedoBytes(256)).toBe(256 * 256 * 4);
    expect(estimateAlbedoBytes(384)).toBe(384 * 384 * 4);
  });
});

// ── pickEvictions ─────────────────────────────────────────────────

describe('pickEvictions', () => {
  it('evicts nothing when already under the cap', () => {
    const candidates = [{ id: 'a', sizeBytes: 100 }, { id: 'b', sizeBytes: 100 }];
    expect(pickEvictions(candidates, 150, 1000)).toEqual([]);
  });

  it('evicts oldest-first (front of the array) until back under the cap', () => {
    const candidates = [
      { id: 'oldest', sizeBytes: 400 },
      { id: 'middle', sizeBytes: 400 },
      { id: 'newest', sizeBytes: 400 },
    ];
    // total 1200, cap 1000 → must drop at least 200, oldest-first
    expect(pickEvictions(candidates, 1200, 1000)).toEqual(['oldest']);
  });

  it('evicts multiple entries when one is not enough', () => {
    const candidates = [
      { id: 'a', sizeBytes: 100 },
      { id: 'b', sizeBytes: 100 },
      { id: 'c', sizeBytes: 100 },
    ];
    expect(pickEvictions(candidates, 300, 150)).toEqual(['a', 'b']);
  });

  it('stops early once under budget rather than over-evicting', () => {
    const candidates = [
      { id: 'a', sizeBytes: 900 },
      { id: 'b', sizeBytes: 900 },
    ];
    expect(pickEvictions(candidates, 1000, 500)).toEqual(['a']);
  });

  it('evicts everything offered if still over budget after exhausting candidates', () => {
    const candidates = [{ id: 'a', sizeBytes: 10 }];
    expect(pickEvictions(candidates, 1_000_000, 100)).toEqual(['a']);
  });

  it('default byte budget is a sane, positive, finite cap', () => {
    expect(BODY_CHUNK_STORE_BYTE_BUDGET).toBeGreaterThan(0);
    expect(Number.isFinite(BODY_CHUNK_STORE_BYTE_BUDGET)).toBe(true);
  });
});

// ── BodyChunkCache (in-memory fakes — no IndexedDB/OPFS) ───────────

function makeFakeMeta(): BodyChunkMetaStore & { rows: Map<string, ChunkMetaRecord> } {
  const rows = new Map<string, ChunkMetaRecord>();
  return {
    rows,
    async listBySeedFingerprint(seed, fingerprint) {
      return [...rows.values()].filter((r) => r.seed === seed && r.fingerprint === fingerprint);
    },
    async upsert(rec) { rows.set(rec.id, rec); },
    async totalBytes() { return [...rows.values()].reduce((s, r) => s + r.sizeBytes, 0); },
    async oldestFirst(limit) {
      return [...rows.values()].sort((a, b) => a.lastUsed - b.lastUsed).slice(0, limit);
    },
    async deleteMany(ids) { for (const id of ids) rows.delete(id); },
  };
}

function makeFakeIo(): BodyChunkIO & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async put(fileId, bytes) { files.set(fileId, bytes); },
    async get(fileId) { return files.get(fileId); },
    async delete(fileId) { files.delete(fileId); },
  };
}

describe('BodyChunkCache', () => {
  it('get() misses before preload / for an unknown node', () => {
    const cache = new BodyChunkCache(42, makeFakeMeta(), makeFakeIo());
    expect(cache.get('0:0:0:0.0')).toBeUndefined();
  });

  it('put() then get() round-trips synchronously from the in-memory map', () => {
    const cache = new BodyChunkCache(42, makeFakeMeta(), makeFakeIo());
    const bytes = new Uint8Array([1, 2, 3, 4]);
    cache.put('0:0:0:0.0', 96, bytes);
    expect(cache.get('0:0:0:0.0')).toEqual({ texRes: 96, albedoRGBA: bytes });
  });

  it('never downgrades an existing entry to a lower or equal texRes', () => {
    const cache = new BodyChunkCache(42, makeFakeMeta(), makeFakeIo());
    const hi = new Uint8Array(4);
    const lo = new Uint8Array(4);
    cache.put('n', 256, hi);
    cache.put('n', 128, lo); // worse — ignored
    expect(cache.get('n')!.texRes).toBe(256);
    cache.put('n', 256, lo); // equal — ignored (redundant write)
    expect(cache.get('n')!.albedoRGBA).toBe(hi);
  });

  it('put() persists to meta + io, and preload() on a fresh instance restores it', async () => {
    const meta = makeFakeMeta();
    const io = makeFakeIo();
    const writer = new BodyChunkCache(7, meta, io);
    await writer.preload('fp-1');
    // preload() sanity-checks byteLength === texRes² × 4 (estimateAlbedoBytes)
    // before trusting a stored blob — use a properly-sized fake buffer.
    const bytes = new Uint8Array(estimateAlbedoBytes(128)).fill(9);
    writer.put('face0', 128, bytes);
    await writer.flush();

    expect(meta.rows.size).toBe(1);
    expect(io.files.size).toBe(1);

    const reader = new BodyChunkCache(7, meta, io);
    await reader.preload('fp-1');
    expect(reader.get('face0')).toEqual({ texRes: 128, albedoRGBA: bytes });
  });

  it('preload() only loads rows matching the given fingerprint', async () => {
    const meta = makeFakeMeta();
    const io = makeFakeIo();
    const writer = new BodyChunkCache(7, meta, io);
    await writer.preload('fp-old');
    writer.put('face0', 128, new Uint8Array(4));
    await writer.flush();

    const reader = new BodyChunkCache(7, meta, io);
    await reader.preload('fp-new');
    expect(reader.get('face0')).toBeUndefined();
  });

  it('preload() is scoped per seed — a different body never sees this body\'s chunks', async () => {
    const meta = makeFakeMeta();
    const io = makeFakeIo();
    const writer = new BodyChunkCache(1, meta, io);
    await writer.preload('fp');
    writer.put('face0', 128, new Uint8Array(4));
    await writer.flush();

    const otherBody = new BodyChunkCache(2, meta, io);
    await otherBody.preload('fp');
    expect(otherBody.get('face0')).toBeUndefined();
  });

  it('rebind() clears the in-memory set and moves writes to the new seed', async () => {
    const meta = makeFakeMeta();
    const io = makeFakeIo();
    const cache = new BodyChunkCache(1, meta, io);
    await cache.preload('fp');
    cache.put('face0', 128, new Uint8Array(4));
    await cache.flush();
    expect(cache.get('face0')).toBeDefined();

    cache.rebind(99);
    expect(cache.get('face0')).toBeUndefined(); // dropped on rebind

    cache.put('face0', 128, new Uint8Array(4));
    await cache.flush();
    const rec = [...meta.rows.values()].find((r) => r.nodeKey === 'face0' && r.seed === 99);
    expect(rec).toBeDefined();
  });

  it('flush() awaits an in-flight write, so a caller can rely on it having landed', async () => {
    const meta = makeFakeMeta();
    const io = makeFakeIo();
    const cache = new BodyChunkCache(1, meta, io);
    await cache.preload('fp');
    cache.put('face0', 128, new Uint8Array(4));
    await cache.flush();
    expect(meta.rows.size).toBe(1);
  });

  it('evicts the globally-oldest entries once the byte budget is exceeded', async () => {
    const meta = makeFakeMeta();
    const io = makeFakeIo();
    const cache = new BodyChunkCache(1, meta, io);
    await cache.preload('fp');

    // Seed one old entry directly (as if written in a much earlier session).
    const oldBytes = new Uint8Array(4);
    await io.put('old-file', oldBytes);
    await meta.upsert({
      id: 'old-id', seed: 1, fingerprint: 'fp', nodeKey: 'old-node', texRes: 1,
      sizeBytes: BODY_CHUNK_STORE_BYTE_BUDGET, opfsFile: 'old-file', lastUsed: 1,
    });

    // A fresh write that pushes total bytes over budget should evict "old".
    cache.put('new-node', 96, new Uint8Array(estimateAlbedoBytes(96)));
    await cache.flush();

    expect(meta.rows.has('old-id')).toBe(false);
    expect(io.files.has('old-file')).toBe(false);
    expect([...meta.rows.values()].some((r) => r.nodeKey === 'new-node')).toBe(true);
  });

  it('write failures are caught, logged, and do not throw out of put()', async () => {
    const meta = makeFakeMeta();
    const failingIo: BodyChunkIO = {
      async put() { throw new Error('disk full'); },
      async get() { return undefined; },
      async delete() {},
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new BodyChunkCache(1, meta, failingIo);
    await cache.preload('fp');
    expect(() => cache.put('n', 96, new Uint8Array(4))).not.toThrow();
    await cache.flush();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
