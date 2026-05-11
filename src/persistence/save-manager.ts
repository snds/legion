// ═══════════════════════════════════════════════════════════════════
// SAVE MANAGER — Save/Load Orchestration
// Coordinates between the main thread (ECS state collection)
// and the Web Worker (compression + OPFS write).
//
// Flow:
//   Save: collect ECS state → JSON → Worker → gzip → OPFS
//   Load: Worker → OPFS → gunzip → JSON → restore ECS state
//
// Autosave every 60 seconds. Event-driven saves after significant
// game events. Incremental saves use bitECS Changed() queries
// to serialize only dirty entities.
// ═══════════════════════════════════════════════════════════════════

import { Events } from '../core/events';
import { Game } from '../core/state';
import { world, Strings } from '../core/world';
import { upsertSlotMeta, listSlots, deleteSlotMeta, type SaveSlot } from './save-db';
import { serializeBlackboards, deserializeBlackboards } from '../simulation/ai/blackboard';
import { serializeGraph, deserializeGraph } from '../simulation/pathfinding';
import { serializeAIState, deserializeAIState } from '../simulation/ai/ai-manager';
import type { WorkerResponse } from './save-worker';

// ── Save Format ──────────────────────────────────────────────────

const SAVE_VERSION = 1;

interface SaveData {
  version: number;
  timestamp: number;
  gameState: Record<string, unknown>;
  strings: string[];
  blackboards: Record<string, unknown>;
  starGraph: Record<string, unknown>;
  aiState: Record<string, unknown>;
  // bitECS component data serialized via built-in serializers
  ecsData: Record<string, unknown>;
}

// ── Worker Management ────────────────────────────────────────────

let worker: Worker | null = null;
let pendingCallbacks = new Map<string, {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
}>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('./save-worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;

      if (msg.type === 'error') {
        const cb = pendingCallbacks.get(msg.slotId ?? '');
        if (cb) {
          cb.reject(new Error(msg.message));
          pendingCallbacks.delete(msg.slotId ?? '');
        }
        return;
      }

      const slotId = 'slotId' in msg ? msg.slotId : '';
      const cb = pendingCallbacks.get(slotId);
      if (cb) {
        cb.resolve(msg);
        pendingCallbacks.delete(slotId);
      }
    };
  }
  return worker;
}

function sendToWorker(msg: unknown, slotId: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    pendingCallbacks.set(slotId, { resolve, reject });
    getWorker().postMessage(msg);
  });
}

// ── State Collection ─────────────────────────────────────────────

function collectSaveData(): SaveData {
  return {
    version: SAVE_VERSION,
    timestamp: Date.now(),
    gameState: Game.serialize(),
    strings: Strings.serialize(),
    blackboards: serializeBlackboards(),
    starGraph: serializeGraph(),
    aiState: serializeAIState(),
    // ECS component serialization placeholder.
    // In production, use bitECS createSoASerializer() for each component.
    ecsData: {},
  };
}

function restoreSaveData(data: SaveData): void {
  Game.deserialize(data.gameState);
  Strings.deserialize(data.strings);
  deserializeBlackboards(data.blackboards);
  deserializeGraph(data.starGraph);
  deserializeAIState(data.aiState);
  // Restore ECS components from data.ecsData
}

// ── Custom JSON Replacer/Reviver ─────────────────────────────────

function replacer(key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return { __type: 'Map', data: [...value.entries()] };
  }
  if (value instanceof Set) {
    return { __type: 'Set', data: [...value.values()] };
  }
  return value;
}

function reviver(key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && '__type' in (value as any)) {
    const typed = value as { __type: string; data: unknown[] };
    if (typed.__type === 'Map') return new Map(typed.data as [unknown, unknown][]);
    if (typed.__type === 'Set') return new Set(typed.data);
  }
  return value;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Save the game to a slot. Runs off-thread via Web Worker.
 */
export async function saveGame(
  slotId: string,
  name?: string,
): Promise<{ sizeBytes: number; durationMs: number }> {
  Events.emit('save:started', { slot: slotId });

  try {
    const data = collectSaveData();
    const json = JSON.stringify(data, replacer);

    const result = await sendToWorker(
      { type: 'save', slotId, data: json },
      slotId,
    ) as { sizeBytes: number; durationMs: number };

    // Update metadata in Dexie
    const meta: SaveSlot = {
      id: slotId,
      name: name ?? `Save ${slotId}`,
      timestamp: data.timestamp,
      gameTime: Game.data.gameTime,
      turnNumber: Math.floor(Game.data.gameTime / 365),
      bobCount: 0,  // populated from ECS query in production
      systemsExplored: 0,
      version: SAVE_VERSION,
      sizeBytes: result.sizeBytes,
    };

    await upsertSlotMeta(meta);

    Events.emit('save:completed', {
      slot: slotId,
      sizeBytes: result.sizeBytes,
      durationMs: result.durationMs,
    });

    Events.emit('ui:notification', {
      title: 'Game Saved',
      desc: `${(result.sizeBytes / 1024).toFixed(0)} KB in ${result.durationMs}ms`,
      duration: 3000,
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Events.emit('save:failed', { slot: slotId, error: message });
    throw err;
  }
}

/**
 * Load a game from a slot.
 */
export async function loadGame(slotId: string): Promise<void> {
  Events.emit('load:started', { slot: slotId });

  try {
    const result = await sendToWorker(
      { type: 'load', slotId },
      slotId,
    ) as { data: string; durationMs: number };

    const data = JSON.parse(result.data, reviver) as SaveData;

    if (data.version > SAVE_VERSION) {
      throw new Error(`Save version ${data.version} is newer than game version ${SAVE_VERSION}`);
    }

    restoreSaveData(data);

    Events.emit('load:completed', { slot: slotId });
    Events.emit('ui:notification', {
      title: 'Game Loaded',
      desc: `Loaded in ${result.durationMs}ms`,
      duration: 3000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Events.emit('save:failed', { slot: slotId, error: message });
    throw err;
  }
}

/**
 * Delete a save slot (both OPFS file and Dexie metadata).
 */
export async function deleteSave(slotId: string): Promise<void> {
  await sendToWorker({ type: 'delete', slotId }, slotId);
  await deleteSlotMeta(slotId);
}

/**
 * Get all available save slots.
 */
export async function getSaveSlots(): Promise<SaveSlot[]> {
  return listSlots();
}

// ── Autosave ─────────────────────────────────────────────────────

let autosaveTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start autosaving every N milliseconds.
 */
export function startAutosave(intervalMs = 60000): void {
  stopAutosave();
  autosaveTimer = setInterval(() => {
    if (!Game.data.paused) {
      saveGame('autosave', 'Autosave').catch(err => {
        console.warn('[SaveManager] Autosave failed:', err);
      });
    }
  }, intervalMs);
}

/**
 * Stop autosaving.
 */
export function stopAutosave(): void {
  if (autosaveTimer !== null) {
    clearInterval(autosaveTimer);
    autosaveTimer = null;
  }
}

// ── Request Persistent Storage ───────────────────────────────────

/**
 * Request persistent storage to prevent browser eviction.
 * Should be called early in app lifecycle.
 */
export async function requestPersistence(): Promise<boolean> {
  if (navigator.storage?.persist) {
    const persisted = await navigator.storage.persist();
    if (persisted) {
      console.info('[SaveManager] Storage persisted successfully');
    } else {
      console.warn('[SaveManager] Storage persistence denied');
    }
    return persisted;
  }
  return false;
}
