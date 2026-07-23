// ═══════════════════════════════════════════════════════════════════
// BAKE WORKER — the 6-face eroded height master, off the main thread.
//
// bakeCube is ~4 s of pure typed-array math at res 256 (measured: 128→1.7 s,
// 192→2.6 s, 256→4.1 s), so running it inline freezes the tab for seconds the
// moment you approach a planet. It touches no DOM and no Three.js, so it moves
// here verbatim. The globe keeps drawing the LIVE analytic terrain until the
// atlas lands, then swaps to the baked path — same image, no hitch, and the
// per-frame terrain synthesis cost disappears once it arrives.
// ═══════════════════════════════════════════════════════════════════

import { bakeCube, type BakeParams } from './bake';
import type { PlanetVisualType } from '../../data/system-gen';

export interface BakeRequest {
  readonly seed: number;
  readonly type: PlanetVisualType;
  readonly params: Partial<BakeParams>;
  readonly warp: number;
  readonly noiseSeed: readonly [number, number, number];
}

export interface BakeResponse {
  readonly res: number;
  readonly faces: Float32Array[];
}

self.onmessage = (e: MessageEvent<BakeRequest>): void => {
  const { seed, type, params, warp, noiseSeed } = e.data;
  const cube = bakeCube(seed, type, params, warp, noiseSeed);
  const faces = cube.faces as Float32Array[];
  // Transfer the buffers (zero-copy) instead of structured-cloning ~1.5 MB back.
  (self as unknown as Worker).postMessage(
    { res: cube.res, faces },
    faces.map((f) => f.buffer as ArrayBuffer),
  );
};
