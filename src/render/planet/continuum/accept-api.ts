// Continuum accept harness — window API for Playwright / native Chrome automation.
// Lab-only. Does not change shipping defaults.

import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { Game, zoomForPhysicalAu } from '../../../core/state';
import type { ContinuumGlobe } from './index';
export interface ContinuumAcceptHud {
  resident: number;
  pending: number;
  coverPending: number;
  warmPending: number;
  streaming: boolean;
  coverAgeMs: number;
  medianTex: number;
  settled: boolean;
}

export type SunPoseMode = 'day' | 'night' | 'terminator';

export interface ContinuumAcceptApi {
  ready(): boolean;
  hud(): ContinuumAcceptHud | null;
  setAu(au: number): void;
  setSpin(on: boolean): void;
  setClouds(on: boolean): void;
  /** Switch planet lab archetype (rebuilds Continuum globe). Lab-only. */
  setArchetype(type: string): void;
  archetype(): string;
  /** Hide/show lab props (visible lab-sun, etc.) for clean captures. */
  setLabPropsVisible(on: boolean): void;
  nudgeYaw(radians: number): void;
  /** Sun·camFromPlanet in [-1,1]. Day≈+1, night≈−1, terminator≈0. */
  sunFacing(): number;
  /**
   * Move the world-space sun direction so the CURRENT camera view of the
   * planet reads as day / night / terminator. Planet yaw (nudgeYaw) rotates
   * only the surface mesh — the camera and sun stay put in world space, so
   * `sunFacing()` (sun·viewDir, both world-space) never changes from a yaw
   * search alone. Posing must move the sun (or the camera); this moves the sun.
   */
  poseSun(mode: SunPoseMode): void;
  canvasPngDataUrl(): string | null;
  /** Drawing buffer size for native capture validation. */
  canvasSize(): { w: number; h: number } | null;
  waitSettled(timeoutMs?: number, idleMs?: number): Promise<ContinuumAcceptHud>;
  waitPerfCapture(timeoutMs?: number): Promise<unknown>;
}

export interface ContinuumAcceptDeps {
  getGlobe: () => ContinuumGlobe | null;
  getCamera: () => PerspectiveCamera | null;
  getSunDir: () => Vector3;
  /** Set the world-space sun direction (normalized internally). Lab-only. */
  setSunDir: (x: number, y: number, z: number) => void;
  setAutoRotate: (on: boolean) => void;
  setCloudsVisible: (on: boolean) => void;
  setArchetype?: (type: string) => void;
  getArchetype?: () => string;
  setLabPropsVisible?: (on: boolean) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const _planetPos = new Vector3();

/**
 * The globe root's RENDER-frame position (`getWorldPosition`, not the raw
 * local `.position`). The lab mounts globes under the local tier group,
 * which the floating-origin frame broker translates by −R every frame (see
 * scale-manager.ts) — so a globe authored at local (0,0,0) does NOT render
 * at world (0,0,0). `cam.position` is already in this same render frame
 * (rebased near the origin each frame), so both sides of a facing/view
 * calculation must read the world-matrix position here, not `.position`.
 */
function planetRenderPos(globe: ContinuumGlobe): Vector3 {
  return globe.root.getWorldPosition(_planetPos);
}

/**
 * Pure math: the world-space sun direction that puts a camera looking along
 * `view` (normalize(camPos − planetPos)) into the requested lighting pose.
 * - day: sun toward the camera → sunFacing = sun·view → +1
 * - night: sun away from the camera → sunFacing → −1
 * - terminator: sun ⟂ view → sunFacing → 0
 * Exported standalone (no DOM/globe deps) so it has a direct Vitest lock.
 */
export function sunDirForPose(mode: SunPoseMode, view: Vector3): Vector3 {
  if (mode === 'day') return view.clone();
  if (mode === 'night') return view.clone().negate();
  // terminator: any unit vector perpendicular to view. Cross with world +Y,
  // falling back to +X when view is (near-)parallel to +Y to avoid a
  // degenerate near-zero cross product.
  const up = new Vector3(Math.abs(view.y) > 0.99 ? 1 : 0, Math.abs(view.y) > 0.99 ? 0 : 1, 0);
  const perp = new Vector3().crossVectors(view, up);
  return perp.lengthSq() < 1e-12 ? new Vector3(1, 0, 0) : perp.normalize();
}

export function attachContinuumAcceptApi(deps: ContinuumAcceptDeps): ContinuumAcceptApi {
  const api: ContinuumAcceptApi = {
    ready(): boolean {
      return deps.getGlobe() != null && deps.getCamera() != null;
    },

    hud(): ContinuumAcceptHud | null {
      const g = deps.getGlobe();
      if (!g) return null;
      const raw = g.hudStats();
      if (!raw) return null;
      const settled = !raw.streaming && raw.coverPending === 0 && raw.pending === 0;
      return {
        resident: raw.resident,
        pending: raw.pending,
        coverPending: raw.coverPending,
        warmPending: raw.warmPending,
        streaming: raw.streaming,
        coverAgeMs: raw.coverAgeMs,
        medianTex: raw.medianTex,
        settled,
      };
    },

    setAu(au: number): void {
      const z = zoomForPhysicalAu(Math.max(1e-6, au));
      Game.data.zoomLevel = z;
      Game.data.targetZoom = z;
      deps.getGlobe()?.setViewDistanceAu(au);
    },

    setSpin(on: boolean): void {
      deps.setAutoRotate(on);
      deps.getGlobe()?.setSpinPaused(!on);
    },

    setClouds(on: boolean): void {
      deps.setCloudsVisible(on);
      deps.getGlobe()?.setCloudsVisible(on);
    },

    setArchetype(type: string): void {
      deps.setArchetype?.(type);
    },

    archetype(): string {
      return deps.getArchetype?.() ?? 'ocean';
    },

    setLabPropsVisible(on: boolean): void {
      deps.setLabPropsVisible?.(on);
    },

    nudgeYaw(radians: number): void {
      deps.getGlobe()?.nudgeRotation(radians, 0);
    },

    sunFacing(): number {
      const cam = deps.getCamera();
      const g = deps.getGlobe();
      if (!cam || !g) return 0;
      const sun = deps.getSunDir();
      const p = planetRenderPos(g);
      let dx = cam.position.x - p.x;
      let dy = cam.position.y - p.y;
      let dz = cam.position.z - p.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
      return sun.x * dx + sun.y * dy + sun.z * dz;
    },

    poseSun(mode: SunPoseMode): void {
      const cam = deps.getCamera();
      const g = deps.getGlobe();
      if (!cam || !g) return;
      const p = planetRenderPos(g);
      const view = new Vector3(cam.position.x - p.x, cam.position.y - p.y, cam.position.z - p.z);
      if (view.lengthSq() < 1e-12) view.set(0, 0, 1); else view.normalize();
      const sun = sunDirForPose(mode, view);
      deps.setSunDir(sun.x, sun.y, sun.z);
    },

    canvasPngDataUrl(): string | null {
      // WebGL default preserveDrawingBuffer=false → sync toDataURL is often black.
      // Callers should prefer Playwright canvas screenshots. Kept as a last-resort
      // read after two rAFs (may still be empty without a forced redraw).
      const canvas = document.querySelector('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      try {
        return canvas.toDataURL('image/png');
      } catch {
        return null;
      }
    },

    /** Drawing buffer size for native capture validation. */
    canvasSize(): { w: number; h: number } | null {
      const canvas = document.querySelector('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      return { w: canvas.width, h: canvas.height };
    },

    async waitSettled(timeoutMs = 20000, idleMs = 5000): Promise<ContinuumAcceptHud> {
      const t0 = performance.now();
      let quietSince: number | null = null;
      while (performance.now() - t0 < timeoutMs) {
        const h = api.hud();
        if (h?.settled) {
          if (quietSince == null) quietSince = performance.now();
          if (performance.now() - quietSince >= idleMs) return h;
        } else {
          quietSince = null;
        }
        await sleep(100);
      }
      const last = api.hud();
      if (last) return last;
      throw new Error('waitSettled: no Continuum HUD');
    },

    async waitPerfCapture(timeoutMs = 120000): Promise<unknown> {
      const t0 = performance.now();
      while (performance.now() - t0 < timeoutMs) {
        const v = (globalThis as Record<string, unknown>).__perfCapture;
        if (v && typeof v === 'object' && (v as { mode?: string }).mode === 'capture') {
          return v;
        }
        await sleep(200);
      }
      throw new Error('waitPerfCapture: timed out');
    },
  };

  (globalThis as unknown as { __continuumAccept?: ContinuumAcceptApi }).__continuumAccept = api;
  return api;
}
