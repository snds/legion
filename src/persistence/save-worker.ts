// ═══════════════════════════════════════════════════════════════════
// SAVE WORKER — Off-Thread OPFS File I/O
// Runs in a Web Worker to keep the main thread free during saves.
//
// Pipeline: JSON stringify → fflate gzip → OPFS write
// Reverse: OPFS read → fflate gunzip → JSON parse
//
// OPFS provides 2-4× faster I/O than IndexedDB for large files.
// The synchronous access handle (createSyncAccessHandle) is only
// available in Web Workers, which is why this runs here.
// ═══════════════════════════════════════════════════════════════════

import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';

// ── Message Types ────────────────────────────────────────────────

export interface SaveRequest {
  type: 'save';
  slotId: string;
  data: string;           // JSON string of game state
}

export interface LoadRequest {
  type: 'load';
  slotId: string;
}

export interface DeleteRequest {
  type: 'delete';
  slotId: string;
}

export interface ListRequest {
  type: 'list';
}

export type WorkerRequest = SaveRequest | LoadRequest | DeleteRequest | ListRequest;

export interface SaveResponse {
  type: 'save-complete';
  slotId: string;
  sizeBytes: number;
  durationMs: number;
}

export interface LoadResponse {
  type: 'load-complete';
  slotId: string;
  data: string;
  durationMs: number;
}

export interface DeleteResponse {
  type: 'delete-complete';
  slotId: string;
}

export interface ListResponse {
  type: 'list-complete';
  files: Array<{ name: string; size: number }>;
}

export interface ErrorResponse {
  type: 'error';
  message: string;
  slotId?: string;
}

export type WorkerResponse = SaveResponse | LoadResponse | DeleteResponse | ListResponse | ErrorResponse;

// ── Worker Logic ─────────────────────────────────────────────────

async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

async function getSavesDir(): Promise<FileSystemDirectoryHandle> {
  const root = await getOPFSRoot();
  return root.getDirectoryHandle('legion-saves', { create: true });
}

async function handleSave(req: SaveRequest): Promise<SaveResponse> {
  const start = performance.now();

  // Compress
  const jsonBytes = strToU8(req.data);
  const compressed = gzipSync(jsonBytes, { level: 6 });

  // Write to OPFS
  const dir = await getSavesDir();
  const fileHandle = await dir.getFileHandle(`${req.slotId}.sav`, { create: true });
  const accessHandle = await (fileHandle as any).createSyncAccessHandle();

  accessHandle.truncate(0);
  accessHandle.write(compressed);
  accessHandle.flush();
  accessHandle.close();

  const duration = performance.now() - start;

  return {
    type: 'save-complete',
    slotId: req.slotId,
    sizeBytes: compressed.byteLength,
    durationMs: Math.round(duration),
  };
}

async function handleLoad(req: LoadRequest): Promise<LoadResponse> {
  const start = performance.now();

  const dir = await getSavesDir();
  const fileHandle = await dir.getFileHandle(`${req.slotId}.sav`);
  const accessHandle = await (fileHandle as any).createSyncAccessHandle();

  const size = accessHandle.getSize();
  const buffer = new Uint8Array(size);
  accessHandle.read(buffer, { at: 0 });
  accessHandle.close();

  // Decompress
  const decompressed = gunzipSync(buffer);
  const jsonStr = strFromU8(decompressed);

  const duration = performance.now() - start;

  return {
    type: 'load-complete',
    slotId: req.slotId,
    data: jsonStr,
    durationMs: Math.round(duration),
  };
}

async function handleDelete(req: DeleteRequest): Promise<DeleteResponse> {
  const dir = await getSavesDir();
  await dir.removeEntry(`${req.slotId}.sav`);

  return {
    type: 'delete-complete',
    slotId: req.slotId,
  };
}

async function handleList(): Promise<ListResponse> {
  const dir = await getSavesDir();
  const files: Array<{ name: string; size: number }> = [];

  for await (const [name, handle] of (dir as any).entries()) {
    if (handle.kind === 'file' && name.endsWith('.sav')) {
      const file = await (handle as FileSystemFileHandle).getFile();
      files.push({ name: name.replace('.sav', ''), size: file.size });
    }
  }

  return {
    type: 'list-complete',
    files,
  };
}

// ── Message Handler ──────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  try {
    let response: WorkerResponse;

    switch (req.type) {
      case 'save':
        response = await handleSave(req);
        break;
      case 'load':
        response = await handleLoad(req);
        break;
      case 'delete':
        response = await handleDelete(req);
        break;
      case 'list':
        response = await handleList();
        break;
      default:
        response = { type: 'error', message: `Unknown request type` };
    }

    self.postMessage(response);
  } catch (err) {
    const error: ErrorResponse = {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      slotId: 'slotId' in req ? (req as any).slotId : undefined,
    };
    self.postMessage(error);
  }
};
