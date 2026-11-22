// ═══════════════════════════════════════════════════════════════════
// BODY ASSET STORE — Continuum Chunk Cache Orchestration (P2-3)
//
// Main-thread facade over body-asset-db.ts (metadata) + body-asset-
// worker.ts (OPFS bytes). Owns:
//   - the worker lifecycle (mirrors save-manager.ts's getWorker/
//     sendToWorker pattern)
//   - a per-body in-memory read cache (BodyChunkCache) so
//     ChunkPool.buildOne()'s hot, synchronous, budget-limited build
//     loop can do a plain Map lookup instead of an async round-trip —
//     see design note for why this shape was chosen over making the
//     chunk build path itself async
//   - global-byte-budget LRU eviction (pure decision logic factored out
//     as `pickEvictions` so it is unit-testable without IndexedDB/OPFS)
//   - tracked, awaitable pending writes + a flush hook, so this cache
//     does NOT repeat Audit A2 §2's reproduced bug (fire-and-forget
//     Dexie writes that don't reliably commit before page teardown)
// ═══════════════════════════════════════════════════════════════════

import {
  dexieBodyChunkMetaStore, type BodyChunkMetaStore, type ChunkMetaRecord,
} from './body-asset-db';
import type { WorkerRequest, WorkerResponse } from './body-asset-worker';

// ── Pure helpers (unit-testable, no DOM/IndexedDB/OPFS) ──────────

/** Deterministic 64-bit-ish FNV-1a hash, hex-encoded — `id` embeds the
 *  body's `surfaceFingerprint()`, which runs 500+ characters (Audit A2
 *  §5), so it cannot be used as an OPFS filename directly. */
export function hashChunkFileId(id: string): string {
  const fnv1a = (str: string, seed: number): number => {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };
  const a = fnv1a(id, 0x811c9dc5).toString(16).padStart(8, '0');
  const b = fnv1a(id, 0x9e3779b9).toString(16).padStart(8, '0');
  return `${a}${b}`;
}

/** Raw RGBA8 byte size for a texRes²-square albedo bake — the only
 *  thing this store persists (see body-asset-worker.ts header). */
export function estimateAlbedoBytes(texRes: number): number {
  return texRes * texRes * 4;
}

/**
 * Global store cap, independent of catalogue body count (see design
 * note: a per-body quota × ~3,066 catalogue bodies balloons to tens of
 * GB even compressed — the wrong model at galaxy scale). At the
 * measured ~22-39% land-type / ~3-9% ocean-type gzip ratio (real
 * measurement, see task note), 256 MB holds on the order of 2,000-3,000
 * persisted chunks — comfortably more than a full multi-body
 * exploration session needs today (≤15 bodies reachable via
 * system-loader.ts) with headroom for the eventual galaxy-scale target,
 * without any redesign.
 */
export const BODY_CHUNK_STORE_BYTE_BUDGET = 256 * 1024 * 1024;

interface EvictionCandidate {
  id: string;
  sizeBytes: number;
}

/**
 * Greedy oldest-first eviction: walk `candidatesOldestFirst` (already
 * sorted by ascending `lastUsed`) and pick just enough of the FRONT to
 * bring `currentTotalBytes` back under `capBytes`. Pure so the eviction
 * policy itself (LRU by visit recency — see design note for why
 * recency was chosen over distance-from-player) is verifiable without
 * a real store.
 */
export function pickEvictions(
  candidatesOldestFirst: readonly EvictionCandidate[],
  currentTotalBytes: number,
  capBytes: number,
): string[] {
  const evicted: string[] = [];
  let total = currentTotalBytes;
  for (const c of candidatesOldestFirst) {
    if (total <= capBytes) break;
    evicted.push(c.id);
    total -= c.sizeBytes;
  }
  return evicted;
}

// ── Worker-backed byte I/O ────────────────────────────────────────

export interface BodyChunkIO {
  put(fileId: string, bytes: Uint8Array): Promise<void>;
  get(fileId: string): Promise<Uint8Array | undefined>;
  delete(fileId: string): Promise<void>;
}

// Correlates in-flight requests by `fileId` — same shape as save-
// manager.ts's slotId-keyed callback map. Safe because a given fileId
// (== hash of seed:nodeKey:fingerprint) only ever has one in-flight
// request at a time in practice: preload() reads each node once at
// startup, and put() only fires for a node after preload has already
// populated (or missed) it, never concurrently with its own read.
let worker: Worker | null = null;
const pendingReqs = new Map<string, {
  resolve: (msg: WorkerResponse) => void;
  reject: (err: Error) => void;
}>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./body-asset-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const fileId = msg.fileId ?? '';
      const cb = pendingReqs.get(fileId);
      if (!cb) return;
      pendingReqs.delete(fileId);
      if (msg.type === 'error') cb.reject(new Error(msg.message));
      else cb.resolve(msg);
    };
  }
  return worker;
}

function sendToWorker(req: WorkerRequest): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    pendingReqs.set(req.fileId, { resolve, reject });
    getWorker().postMessage(req);
  });
}

export const workerBodyChunkIO: BodyChunkIO = {
  async put(fileId, bytes) {
    await sendToWorker({ type: 'put', fileId, bytes });
  },
  async get(fileId) {
    const res = await sendToWorker({ type: 'get', fileId });
    if (res.type !== 'get-complete') throw new Error(`unexpected worker response type: ${res.type}`);
    return res.bytes ?? undefined;
  },
  async delete(fileId) {
    await sendToWorker({ type: 'delete', fileId });
  },
};

// ── Per-body cache facade ─────────────────────────────────────────

export interface CachedAlbedo {
  texRes: number;
  albedoRGBA: Uint8Array;
}

/**
 * Per-body cache facade Continuum's ChunkPool talks to.
 *
 * DESIGN FORK (flagged, not silently picked): ChunkPool.buildOne() /
 * upgradeOneAlbedo() run inside a synchronous, per-frame, ms-budgeted
 * build loop (tick()) — there is no natural place in that loop to
 * `await` an OPFS round-trip without either blocking the frame or
 * threading promises through the whole LOD scheduler (a much bigger,
 * riskier change than this task's "cache layer only" scope allows).
 *
 * Chosen shape: `preload(fingerprint)` is called once, async,
 * fire-and-forget-but-tracked, as soon as a body's identity is known
 * (ContinuumGlobe construction) — well before the camera can reach
 * `near` stage and start calling buildOne(). It populates a plain
 * in-memory Map. `get()`/`put()` are then synchronous Map operations
 * ChunkPool can call from its hot path with zero added latency.
 *
 * Failure mode if preload hasn't finished by the time a chunk first
 * builds: that one build proceeds live (cache miss), exactly as if no
 * cache existed — never worse than today, never a correctness risk.
 * Later ticks (LOD refinement, polish upgrades, a second visit to the
 * same node) still benefit once preload lands. This was chosen over
 * making the build path itself async specifically to keep this task
 * from reaching into chunk-pool.ts's LOD/budget scheduling logic.
 */
export class BodyChunkCache {
  private readonly mem = new Map<string, CachedAlbedo>();
  private fingerprint = '';
  private readonly pending = new Map<string, Promise<void>>();

  constructor(
    private seed: number,
    private readonly meta: BodyChunkMetaStore = dexieBodyChunkMetaStore,
    private readonly io: BodyChunkIO = workerBodyChunkIO,
  ) {}

  /** Lab-only escape hatch: `ContinuumGlobe.reseed()` mutates a body's
   *  identity in place (same globe instance, new seed) rather than
   *  reconstructing it. Rebinding here (instead of requiring the caller
   *  to construct + inject a whole new cache instance) keeps that path
   *  working without giving ChunkPool a settable `assetCache` field —
   *  it only ever holds one `ChunkAssetCache` reference for its whole
   *  lifetime; this mutates what that reference points AT internally.
   *  Drops the in-memory set (old seed's entries are no longer
   *  addressable under the new seed) — caller must re-`preload()`. */
  rebind(seed: number): void {
    this.seed = seed;
    this.fingerprint = '';
    this.mem.clear();
  }

  /** Load every persisted chunk for this body under the CURRENT
   *  fingerprint into memory. Safe to call again (e.g. fingerprint
   *  changed via lab tuning) — replaces the in-memory set; stale-
   *  fingerprint OPFS/Dexie rows are deliberately left in place rather
   *  than eagerly deleted (see design note: active pruning would punish
   *  the lab's live-tuning "revert to a prior param set" workflow,
   *  which legitimately re-hits an old fingerprint; the global byte
   *  cap + LRU already bounds the cost of leaving them). */
  async preload(fingerprint: string): Promise<void> {
    this.fingerprint = fingerprint;
    this.mem.clear();
    let rows: ChunkMetaRecord[];
    try {
      rows = await this.meta.listBySeedFingerprint(this.seed, fingerprint);
    } catch (err) {
      console.warn('[BodyChunkCache] preload metadata read failed', err);
      return;
    }
    await Promise.all(rows.map(async (r) => {
      try {
        const bytes = await this.io.get(r.opfsFile);
        if (bytes && bytes.byteLength === r.texRes * r.texRes * 4) {
          this.mem.set(r.nodeKey, { texRes: r.texRes, albedoRGBA: bytes });
        }
      } catch (err) {
        console.warn('[BodyChunkCache] preload chunk read failed', r.nodeKey, err);
      }
    }));
  }

  /** Synchronous hot-path read — undefined on miss (not yet preloaded,
   *  never built at this node, or evicted). */
  get(nodeKey: string): CachedAlbedo | undefined {
    return this.mem.get(nodeKey);
  }

  /** Fire-and-forget (tracked) write-back. Only worth calling for
   *  polish-tier builds — see chunk-pool.ts's persistence gate
   *  (APPROACH_FIDELITY_MIN_TEX_AT_03AU); this method itself has no
   *  opinion on which resolutions are "worth it" so it stays reusable. */
  put(nodeKey: string, texRes: number, albedoRGBA: Uint8Array): void {
    const existing = this.mem.get(nodeKey);
    if (existing && existing.texRes >= texRes) return; // never downgrade / redundant write
    this.mem.set(nodeKey, { texRes, albedoRGBA });

    const id = `${this.seed}:${nodeKey}:${this.fingerprint}`;
    const fileId = hashChunkFileId(id);
    const sizeBytes = albedoRGBA.byteLength;
    const write = this.writeThrough(id, fileId, nodeKey, texRes, sizeBytes, albedoRGBA)
      .catch((err) => { console.warn('[BodyChunkCache] write failed', nodeKey, err); })
      .finally(() => { this.pending.delete(id); });
    this.pending.set(id, write);
  }

  private async writeThrough(
    id: string, fileId: string, nodeKey: string, texRes: number,
    sizeBytes: number, albedoRGBA: Uint8Array,
  ): Promise<void> {
    await this.io.put(fileId, albedoRGBA);
    const rec: ChunkMetaRecord = {
      id, seed: this.seed, fingerprint: this.fingerprint, nodeKey, texRes,
      sizeBytes, opfsFile: fileId, lastUsed: Date.now(),
    };
    await this.meta.upsert(rec);
    await this.enforceBudget();
  }

  private async enforceBudget(): Promise<void> {
    let total = await this.meta.totalBytes();
    let guard = 0;
    while (total > BODY_CHUNK_STORE_BYTE_BUDGET && guard++ < 32) {
      const oldest = await this.meta.oldestFirst(64);
      if (!oldest.length) break;
      const evictIds = pickEvictions(oldest, total, BODY_CHUNK_STORE_BYTE_BUDGET);
      if (!evictIds.length) break;
      const fileById = new Map(oldest.map((r) => [r.id, r.opfsFile]));
      await this.meta.deleteMany(evictIds);
      await Promise.all(evictIds.map((evictId) => {
        const file = fileById.get(evictId);
        return file ? this.io.delete(file) : Promise.resolve();
      }));
      total = await this.meta.totalBytes();
    }
  }

  /** Await all in-flight writes — call on visibilitychange/pagehide so
   *  a session's last few polish upgrades actually land (Audit A2 §2:
   *  the ONE reproduced bug class this cache must not repeat). */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.pending.values()]);
  }
}

// ── Lifecycle registry ─────────────────────────────────────────────

const liveCaches = new Set<BodyChunkCache>();

/** Construct + register a body's chunk cache (real Dexie/OPFS backing).
 *  Call `releaseBodyChunkCache` on dispose so the flush-all sweep below
 *  doesn't accumulate dead references across system-loader.ts swaps. */
export function createBodyChunkCache(seed: number): BodyChunkCache {
  const cache = new BodyChunkCache(seed);
  liveCaches.add(cache);
  return cache;
}

export function releaseBodyChunkCache(cache: BodyChunkCache): void {
  liveCaches.delete(cache);
}

/** Await every live body's pending writes. Wire to visibilitychange
 *  (hidden) / pagehide — see main.ts. */
export async function flushAllBodyChunkWrites(): Promise<void> {
  await Promise.allSettled([...liveCaches].map((c) => c.flush()));
}
