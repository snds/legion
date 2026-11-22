// ═══════════════════════════════════════════════════════════════════
// BODY ASSET WORKER — Off-Thread OPFS I/O for Continuum Chunk Cache
// (P2-3) Same shape as save-worker.ts: gzip via fflate, write/read via
// OPFS createSyncAccessHandle (Worker-only API), separate directory so
// this cache can be wiped independently of save slots / legacy texture
// cache.
//
// Payload is raw albedo bytes only (Uint8Array RGBA8, texRes²×4) — NOT
// a full HeightfieldChunk. Mesh heights/colors/sea are cheap to
// regenerate live (bounded by buildOne's own coarse/stream quality
// tier, ≤64px equivalent — tens of ms) and are never persisted; only
// the polish-tier albedo bake is expensive enough to be worth the I/O
// round-trip (see design note — chunk-pool.ts upgradeOneAlbedo is the
// ~0.022×texRes² ms cost this cache exists to avoid paying twice).
// ═══════════════════════════════════════════════════════════════════

import { gzipSync, gunzipSync } from 'fflate';

export interface PutRequest {
  type: 'put';
  fileId: string;
  bytes: Uint8Array;
}

export interface GetRequest {
  type: 'get';
  fileId: string;
}

export interface DeleteRequest {
  type: 'delete';
  fileId: string;
}

export type WorkerRequest = PutRequest | GetRequest | DeleteRequest;

export interface PutResponse {
  type: 'put-complete';
  fileId: string;
  sizeBytes: number;
}

export interface GetResponse {
  type: 'get-complete';
  fileId: string;
  bytes: Uint8Array | null;
}

export interface DeleteResponse {
  type: 'delete-complete';
  fileId: string;
}

export interface ErrorResponse {
  type: 'error';
  message: string;
  fileId?: string;
}

export type WorkerResponse = PutResponse | GetResponse | DeleteResponse | ErrorResponse;

// ── Worker Logic ─────────────────────────────────────────────────

async function getChunkDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('legion-body-chunks', { create: true });
}

async function handlePut(req: PutRequest): Promise<PutResponse> {
  const compressed = gzipSync(req.bytes, { level: 6 });
  const dir = await getChunkDir();
  const fileHandle = await dir.getFileHandle(`${req.fileId}.chunk`, { create: true });
  const accessHandle = await (fileHandle as any).createSyncAccessHandle();
  accessHandle.truncate(0);
  accessHandle.write(compressed);
  accessHandle.flush();
  accessHandle.close();
  return { type: 'put-complete', fileId: req.fileId, sizeBytes: compressed.byteLength };
}

async function handleGet(req: GetRequest): Promise<GetResponse> {
  const dir = await getChunkDir();
  let fileHandle: FileSystemFileHandle;
  try {
    fileHandle = await dir.getFileHandle(`${req.fileId}.chunk`);
  } catch {
    return { type: 'get-complete', fileId: req.fileId, bytes: null };
  }
  const accessHandle = await (fileHandle as any).createSyncAccessHandle();
  const size = accessHandle.getSize();
  const buffer = new Uint8Array(size);
  accessHandle.read(buffer, { at: 0 });
  accessHandle.close();
  const bytes = gunzipSync(buffer);
  return { type: 'get-complete', fileId: req.fileId, bytes };
}

async function handleDelete(req: DeleteRequest): Promise<DeleteResponse> {
  const dir = await getChunkDir();
  try {
    await dir.removeEntry(`${req.fileId}.chunk`);
  } catch {
    // Already gone — deleting a missing file is not an error for a cache.
  }
  return { type: 'delete-complete', fileId: req.fileId };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    let response: WorkerResponse;
    switch (req.type) {
      case 'put':
        response = await handlePut(req);
        break;
      case 'get':
        response = await handleGet(req);
        break;
      case 'delete':
        response = await handleDelete(req);
        break;
      default:
        response = { type: 'error', message: 'Unknown request type', fileId: (req as { fileId?: string }).fileId };
    }
    self.postMessage(response);
  } catch (err) {
    const error: ErrorResponse = {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      fileId: 'fileId' in req ? req.fileId : undefined,
    };
    self.postMessage(error);
  }
};
