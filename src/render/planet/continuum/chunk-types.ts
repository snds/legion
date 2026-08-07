// Continuum chunk addressing — cube-sphere quadtree keys + heightfield payload.

import type { QuadNode } from '../cube-sphere';
import { nodeId } from '../cube-sphere';

/** Geometry grid (cells/side). Displacement / skirts use this. */
export const CHUNK_MESH_GRID = 32;

/** @deprecated alias — prefer CHUNK_MESH_GRID */
export const CHUNK_GRID = CHUNK_MESH_GRID;

/**
 * Final albedo size by level (idle polish only).
 * Bench: 384² ≈ 3s/chunk CPU — never bake this during approach.
 */
export const CHUNK_TEX_RES = 256;

/** Builds/frame hard cap — real limit is CHUNK_BUILD_MS_BUDGET. */
export const CHUNK_BUILDS_PER_FRAME = 3;

/**
 * Soft CPU budget for heightfield sampling + meshing per frame (ms).
 * Catch-up mode raises this when the cover queue is deep.
 */
export const CHUNK_BUILD_MS_BUDGET = 5;

/** Resident mesh cap (level-2 full sphere = 96). */
export const MAX_RESIDENT_CHUNKS = 220;

/** Soft cap for warm (not yet visible) prefetched residents — keep tiny. */
export const MAX_WARM_CHUNKS = 16;

/** Max leaves selected before coarsening detail (close view-LOD only). */
export const MAX_ACTIVE_LEAVES = 96;

/** Split sooner → finer cells at close approach. */
export const CHUNK_DETAIL = 0.024;
export const CHUNK_MAX_LEVEL = 8;

/** While streaming / zooming: never split past this until the queue is quiet. */
export const CHUNK_STREAM_MAX_LEVEL = 3;

/** Mesh density by level — close leaves get denser displacement grids (B2). */
export function meshGridForLevel(level: number): number {
  if (level <= 2) return CHUNK_MESH_GRID;
  if (level <= 4) return 36;
  if (level <= 6) return 40;
  return 48;
}

/**
 * Ultra-cheap first cover. Bench: 32² ≈ 40ms; 16² ≈ 10ms — approach must stay here.
 */
export function texResStreamForLevel(level: number): number {
  if (level <= 2) return 16;
  if (level <= 4) return 20;
  return 24;
}

/** Mesh grid while streaming — geometry after cover, never during zoom thrash. */
export function meshGridStreamForLevel(level: number): number {
  return Math.min(20, meshGridForLevel(level));
}

/** Zoom must change by this fraction of radius before LOD reselects. */
export const LOD_ZOOM_HYSTERESIS = 0.12;

/** Spin gate kept for close view-LOD only (orbit uses zoom-sticky). */
export const LOD_SPIN_ANGLE = 0.7;
export const LOD_MIN_REBUILD_MS = 400;
export const LOD_HYSTERESIS = 0.18;

/** LOD crossfade duration (seconds). Only used for parent→child refine. */
export const LOD_FADE_SEC = 0.25;

/** Keep a leaf after it leaves the ideal set (close view-LOD edge flap). */
export const LOD_STICKY_PASSES = 4;
export const LOD_STICKY_MOVING = 8;

/**
 * Below this AU, new cover stays stream-cheap until the queue drains.
 * Upgrades still run after cover — closer zoom raises the ceiling.
 */
export const APPROACH_COVER_AU = 0.55;

/** @deprecated use APPROACH_COVER_AU */
export const APPROACH_TEX_AU = APPROACH_COVER_AU;

/** UX contract: time from zoom band change to pending===0 at stream res. */
export const APPROACH_COVER_SLA_SEC = 3;
/** UX contract: facing leaf median texRes after 5s idle at fixed AU. */
export const APPROACH_FIDELITY_IDLE_SEC = 5;
export const APPROACH_FIDELITY_MIN_TEX_AT_03AU = 96;

/** Final albedo bake size by quadtree level — idle polish ceiling. */
export function texResForLevel(level: number): number {
  if (level <= 0) return 96;
  if (level <= 1) return 160;
  if (level <= 2) return CHUNK_TEX_RES; // 256 @ 96-leaf orbit
  if (level <= 4) return Math.min(320, CHUNK_TEX_RES + 64);
  return Math.min(384, CHUNK_TEX_RES + 128);
}

/**
 * First paint after stream cover (still cheap).
 * Bench: 96² ≈ 200ms — only when settled, never on the approach ladder.
 */
export function texResCoarseForLevel(level: number): number {
  const full = texResForLevel(level);
  return Math.max(32, Math.min(64, full >> 2));
}

/**
 * Max albedo for a leaf at this AU. Closer zoom → higher ceiling
 * (orbit can look soft if we freeze at stream-16 forever).
 */
export function texResCeilingForAu(level: number, viewAu: number): number {
  const full = texResForLevel(level);
  if (viewAu >= 0.75) return full;
  if (viewAu >= 0.5) return Math.min(full, 192);
  if (viewAu >= 0.35) return Math.min(full, 160);
  if (viewAu >= 0.22) return Math.min(full, level >= 3 ? 160 : 192);
  // Near cloud / surface: denser leaves carry spatial res; texel still climbs.
  return Math.min(full, level >= 4 ? 192 : 160);
}

/**
 * Next stepped upgrade from `current` toward the AU ceiling.
 * Never jumps 16→256 in one bake (that was the multi-minute hitch).
 *
 * F6: below the SLA fidelity floor, jump straight to it in one bake instead
 * of three small steps (16→48→80→112). Measured bake cost is ~quadratic in
 * texRes (16²≈20ms, 48²≈55ms, 80²≈143ms, 96²≈204ms) — three small steps to
 * clear 96 cost ~470ms of serial CPU per leaf vs. ~200ms for one direct
 * jump, and the facing population needs most of its leaves past the floor
 * before the HUD median can pass. Steps past the floor stay small (this is
 * cosmetic climb toward the full ceiling, not SLA-critical).
 */
export function texResNextUpgrade(current: number, level: number, viewAu: number): number {
  const ceiling = texResCeilingForAu(level, viewAu);
  if (current >= ceiling) return current;
  if (current < APPROACH_FIDELITY_MIN_TEX_AT_03AU && ceiling >= APPROACH_FIDELITY_MIN_TEX_AT_03AU) {
    return Math.min(ceiling, APPROACH_FIDELITY_MIN_TEX_AT_03AU);
  }
  let step = 32;
  if (current >= 128) step = 64;
  else if (current >= 64) step = 32;
  else step = 32;
  return Math.min(ceiling, Math.max(current + step, current + 1));
}

/** @deprecated prefer texResCeilingForAu + texResNextUpgrade */
export function texResUpgradeForLevel(level: number, viewAu: number, _settled: boolean): number {
  return texResCeilingForAu(level, viewAu);
}

/** Stable cache / mesh key for a quadtree node under a generator fingerprint. */
export function chunkKey(node: QuadNode, fingerprint: string): string {
  return `${nodeId(node)}|${fingerprint}`;
}

export function nodeKey(node: QuadNode): string {
  return nodeId(node);
}

/** Reconstruct a QuadNode from `nodeId` / `parentNodeKey` string. */
export function nodeFromKey(key: string): QuadNode | null {
  const parts = key.split(':');
  if (parts.length !== 4) return null;
  const face = Number(parts[0]);
  const level = Number(parts[1]);
  const u0 = Number(parts[2]);
  const v0 = Number(parts[3]);
  if (![face, level, u0, v0].every(Number.isFinite)) return null;
  return { face, level, u0, v0, size: 1 / (2 ** level) };
}

/** Parent node key (empty string for roots). */
export function parentNodeKey(node: QuadNode): string {
  if (node.level <= 0) return '';
  const s = node.size * 2;
  const u0 = Math.floor(node.u0 / s + 1e-9) * s;
  const v0 = Math.floor(node.v0 / s + 1e-9) * s;
  return `${node.face}:${node.level - 1}:${u0.toFixed(6)}:${v0.toFixed(6)}`;
}

export interface HeightfieldChunk {
  readonly node: QuadNode;
  readonly key: string;
  readonly fingerprint: string;
  readonly meshGrid: number;
  readonly texRes: number;
  /** (meshGrid+1)² column-top heights in [0,1]. */
  readonly heights: Float32Array;
  /** (meshGrid+1)² × 3 linear RGB (mesh verts / fallback). */
  readonly colors: Float32Array;
  /** (meshGrid+1)² sea mask 0/1. */
  readonly sea: Uint8Array;
  /** texRes² RGBA8 albedo bake (A = sea 0|255). */
  readonly albedoRGBA: Uint8Array;
}

export interface ChunkHudStats {
  resident: number;
  pending: number;
  coverPending: number;
  warmPending: number;
  building: number;
  byLevel: Record<number, number>;
  tris: number;
  medianTex: number;
  coverAgeMs: number;
  streaming: boolean;
  showChunks: boolean;
}
