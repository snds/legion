// ═══════════════════════════════════════════════════════════════════
// SAVE DB — Dexie.js Metadata Store
// Structured, queryable metadata for save slots stored in IndexedDB.
// Actual save data goes to OPFS (faster for large binary blobs).
// Schema versioning handles save format evolution between versions.
// ═══════════════════════════════════════════════════════════════════

import Dexie, { type EntityTable } from 'dexie';

// ── Save Slot Schema ─────────────────────────────────────────────

export interface SaveSlot {
  id: string;               // unique slot ID (e.g., 'auto', 'slot_1')
  name: string;             // player-facing name
  timestamp: number;        // Unix ms when saved
  gameTime: number;         // in-game days elapsed
  turnNumber: number;       // game turn counter
  bobCount: number;         // total Bobs alive
  systemsExplored: number;  // count of explored systems
  version: number;          // save format version
  sizeBytes: number;        // compressed save file size
  thumbnail?: string;       // base64 mini-screenshot
  checksum?: string;        // integrity hash
}

// ── Cached Texture Schema ─────────────────────────────────────────

export interface CachedTexture {
  id: string;        // e.g. "ee-romulus-lod1-v1"
  blob: Blob;        // JPEG image data
  version: number;   // algorithm version — bump to regenerate
}

// ── Databases ────────────────────────────────────────────────────

class SaveDatabase extends Dexie {
  saves!: EntityTable<SaveSlot, 'id'>;

  constructor() {
    super('legion-saves');

    // Schema v1
    this.version(1).stores({
      saves: 'id, timestamp, gameTime, version',
    });
  }
}

export const saveDb = new SaveDatabase();

class TextureDatabase extends Dexie {
  textures!: EntityTable<CachedTexture, 'id'>;

  constructor() {
    super('legion-textures');

    this.version(1).stores({
      textures: 'id, version',
    });
  }
}

export const textureDb = new TextureDatabase();

// ── Convenience Methods ──────────────────────────────────────────

/**
 * Get metadata for a specific save slot.
 */
export async function getSlotMeta(slotId: string): Promise<SaveSlot | undefined> {
  return saveDb.saves.get(slotId);
}

/**
 * Get all save slot metadata, ordered by timestamp (newest first).
 */
export async function listSlots(): Promise<SaveSlot[]> {
  return saveDb.saves.orderBy('timestamp').reverse().toArray();
}

/**
 * Update or create save slot metadata.
 */
export async function upsertSlotMeta(slot: SaveSlot): Promise<void> {
  await saveDb.saves.put(slot);
}

/**
 * Delete a save slot's metadata.
 */
export async function deleteSlotMeta(slotId: string): Promise<void> {
  await saveDb.saves.delete(slotId);
}

/**
 * Get total storage used across all saves.
 */
export async function getTotalStorageUsed(): Promise<number> {
  const slots = await saveDb.saves.toArray();
  return slots.reduce((sum, s) => sum + s.sizeBytes, 0);
}
