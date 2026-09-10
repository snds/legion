// ═══════════════════════════════════════════════════════════════════
// BODY ASSET DB — Dexie.js Metadata Store for Continuum Chunk Cache
// (P2-3) First-launch body-asset persistence: metadata index for
// persisted Continuum albedo chunks. Actual bytes live in OPFS
// (body-asset-worker.ts); this table only tracks WHAT is cached and
// WHEN it was last used, so eviction never has to touch the bytes to
// decide what to evict.
//
// Mirrors save-db.ts's split (Dexie metadata + OPFS bytes) — the same
// substrate `save-worker.ts` already established, extended here rather
// than inventing a fourth ad hoc cache (Audit A2 §5 recommendation).
// ═══════════════════════════════════════════════════════════════════

import Dexie, { type EntityTable } from 'dexie';

// ── Schema ───────────────────────────────────────────────────────

/**
 * One persisted Continuum chunk albedo bake.
 *
 * `id` = `${seed}:${nodeKey}:${fingerprint}` — globally unique, and the
 * natural sort/query key for "everything belonging to this body under
 * its current surface identity" (see body-asset-store.ts BodyChunkCache).
 *
 * `fingerprint` is `surfaceFingerprint()` (generators/index.ts) — the
 * SAME key pipeline C's own chunk-sample.ts already uses to gate
 * remesh-vs-not (`chunkKey()`), so a params edit (lab tuning) or a
 * future algorithm-version bump naturally invalidates via a new id
 * rather than needing an explicit "bump TEXTURE_VERSION" step.
 *
 * `opfsFile` is a short hashed filename (see `hashChunkFileId` in
 * body-asset-store.ts) — `id` itself is NOT filesystem-safe, since
 * `fingerprint` alone runs 500+ characters (Audit A2 §5 note) and would
 * blow past typical filename length limits.
 */
export interface ChunkMetaRecord {
  id: string;
  seed: number;
  fingerprint: string;
  nodeKey: string;
  texRes: number;
  sizeBytes: number;
  opfsFile: string;
  /** Epoch ms — bumped on every write and every cache hit (LRU clock). */
  lastUsed: number;
}

/** Storage-agnostic surface BodyChunkCache talks to — lets tests inject
 *  an in-memory fake instead of touching real IndexedDB (this repo has
 *  no fake-indexeddb/jsdom devDependency, so Dexie itself is untestable
 *  under plain `vitest run`; the real Dexie-backed store below is
 *  exercised through the real-boot verification path instead, same as
 *  save-db.ts/save-worker.ts already are — see body-asset-store.ts). */
export interface BodyChunkMetaStore {
  listBySeedFingerprint(seed: number, fingerprint: string): Promise<ChunkMetaRecord[]>;
  upsert(rec: ChunkMetaRecord): Promise<void>;
  totalBytes(): Promise<number>;
  /** Global LRU candidates, oldest `lastUsed` first, across ALL bodies —
   *  eviction is a single flat byte budget, not a per-body quota (see
   *  design note: per-body × galaxy-count sizing blows up to tens of GB
   *  even compressed; a flat cap is scale-invariant). */
  oldestFirst(limit: number): Promise<ChunkMetaRecord[]>;
  deleteMany(ids: string[]): Promise<void>;
}

// ── Database ─────────────────────────────────────────────────────

class BodyAssetDatabase extends Dexie {
  chunks!: EntityTable<ChunkMetaRecord, 'id'>;

  constructor() {
    super('legion-body-chunks');

    // seed index → per-body queries (future cache-management UI, flagged
    // out of scope for this task); lastUsed index → global LRU eviction.
    this.version(1).stores({
      chunks: 'id, seed, fingerprint, lastUsed',
    });
  }
}

export const bodyAssetDb = new BodyAssetDatabase();

// ── Dexie-backed BodyChunkMetaStore ─────────────────────────────────
//
// This project's `declare module 'dexie'` shim (src/declarations.d.ts) only
// types a minimal surface (get/put/delete/toArray/orderBy().reverse()) —
// matching exactly what save-db.ts already used, not the full real Dexie
// API (.where(), .bulkDelete(), Collection.limit() all exist at runtime,
// just untyped here). Rather than widen a shared ambient declaration for
// this one cache, everything below stays inside that existing typed
// surface and does its filtering/sorting in plain JS. The metadata table
// is small by construction (the byte budget bounds it to ~2,000-3,000
// rows — see BODY_CHUNK_STORE_BYTE_BUDGET) so an in-memory scan here costs
// nothing that matters.

export const dexieBodyChunkMetaStore: BodyChunkMetaStore = {
  async listBySeedFingerprint(seed, fingerprint) {
    const rows = await bodyAssetDb.chunks.toArray();
    return rows.filter((r) => r.seed === seed && r.fingerprint === fingerprint);
  },
  async upsert(rec) {
    await bodyAssetDb.chunks.put(rec);
  },
  async totalBytes() {
    const rows = await bodyAssetDb.chunks.toArray();
    return rows.reduce((sum, r) => sum + r.sizeBytes, 0);
  },
  async oldestFirst(limit) {
    const rows = await bodyAssetDb.chunks.toArray();
    return rows.sort((a, b) => a.lastUsed - b.lastUsed).slice(0, limit);
  },
  async deleteMany(ids) {
    await Promise.all(ids.map((id) => bodyAssetDb.chunks.delete(id)));
  },
};
