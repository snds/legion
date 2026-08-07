import {
  childNodes, rootNode, selectSphere, nodeCenterDir, type QuadNode, type Vec3,
} from '../cube-sphere';
import {
  CHUNK_DETAIL, CHUNK_MAX_LEVEL, CHUNK_STREAM_MAX_LEVEL, MAX_ACTIVE_LEAVES,
  nodeFromKey, nodeKey, parentNodeKey,
} from './chunk-types';

export interface LodSelectOpts {
  camLocal: Vec3;
  radius: number;
  morph?: number;
  maxElevation?: number;
  /** >1 coarsens splits while the camera is moving (keeps streamer fed). */
  motionScale?: number;
  /**
   * Approach / zoom stream mode: cheaper splits only.
   * Must NOT punch holes — coverage stays full; builds stay cheap.
   */
  streamPressure?: boolean;
  /** HUD AU — mid-orbit (~0.3) needs view-LOD even when camDist/R still looks "far". */
  viewAu?: number;
  /** Extra horizon radians so rotate/approach keeps limb + upcoming face warm. */
  horizonPad?: number;
}

/** Uniform cube-sphere leaves at a fixed level (full planet, no horizon cull). */
export function allNodesAtLevel(level: number): QuadNode[] {
  const L = Math.max(0, Math.min(level, 8));
  const out: QuadNode[] = [];
  const walk = (n: QuadNode): void => {
    if (n.level >= L) {
      out.push(n);
      return;
    }
    for (const c of childNodes(n)) walk(c);
  };
  for (let f = 0; f < 6; f++) walk(rootNode(f));
  return out;
}

/**
 * Orbit / mid-distance: whole-planet uniform level from camera distance.
 * Mid-AU (~0.35) switches to view-LOD so facing coasts densify; stream cover
 * stays cheap and stepped upgrades restore fidelity (not a multi-minute 384² storm).
 */
export function uniformLevelForDistance(
  dist: number, radius: number, viewAu = 99,
): number {
  const near = dist / Math.max(radius, 1e-6);
  if (viewAu <= 0.35 || near < 1.55) return -1;
  if (near >= 3.2) return 1; // 24
  if (near >= 1.9) return 2; // 96
  if (near >= 1.55) return 2;
  return -1;
}

/**
 * Collapse deepest leaves into parents until under `cap`.
 * Never `slice()` — that dropped whole faces and left rectangular holes.
 */
export function collapseLeavesToCap(nodes: QuadNode[], cap: number): QuadNode[] {
  if (nodes.length <= cap) return nodes;
  const set = new Map<string, QuadNode>();
  for (const n of nodes) set.set(nodeKey(n), n);

  let guard = 0;
  while (set.size > cap && guard++ < 4096) {
    let maxL = 0;
    for (const n of set.values()) maxL = Math.max(maxL, n.level);
    if (maxL <= 0) break;

    const byParent = new Map<string, string[]>();
    for (const [id, n] of set) {
      if (n.level !== maxL) continue;
      const pk = parentNodeKey(n);
      if (!pk) continue;
      const arr = byParent.get(pk);
      if (arr) arr.push(id);
      else byParent.set(pk, [id]);
    }
    let bestPk = '';
    let bestCount = 0;
    for (const [pk, kids] of byParent) {
      if (kids.length > bestCount) {
        bestCount = kids.length;
        bestPk = pk;
      }
    }
    if (!bestPk || bestCount === 0) break;
    for (const id of byParent.get(bestPk)!) set.delete(id);
    const parent = nodeFromKey(bestPk);
    if (!parent) break;
    set.set(bestPk, parent);
  }
  return [...set.values()];
}

function facingScore(n: QuadNode, cam: Vec3): number {
  const d = nodeCenterDir(n);
  const len = Math.hypot(cam[0], cam[1], cam[2]) || 1;
  return (d[0] * cam[0] + d[1] * cam[1] + d[2] * cam[2]) / len;
}

/** Rotate / approach lookahead: keep more of the limb than geometric horizon. */
export function defaultHorizonPad(viewAu: number, near: number): number {
  if (near < 1.35) return 0.55; // ~31° — surface flight
  if (viewAu <= 0.45 || near < 2.0) return 0.40; // mid-orbit rotate
  return 0.22;
}

/** Distance-based leaf set. Orbit uses full-sphere preload; close uses view LOD. */
export function selectChunkLeaves(opts: LodSelectOpts): QuadNode[] {
  const dist = Math.hypot(opts.camLocal[0], opts.camLocal[1], opts.camLocal[2]);
  const near = dist / Math.max(opts.radius, 1e-6);
  const viewAu = opts.viewAu ?? 99;
  const uniform = uniformLevelForDistance(dist, opts.radius, viewAu);
  if (uniform >= 0) return allNodesAtLevel(uniform);

  // Close / mid-AU — view-dependent with padded horizon (rotate coverage).
  const motion = Math.max(1, opts.motionScale ?? 1);
  const stream = !!opts.streamPressure;
  let detail = CHUNK_DETAIL * motion;
  let maxLevel = CHUNK_MAX_LEVEL;
  let leafCap = MAX_ACTIVE_LEAVES;
  const midAu = viewAu <= 0.35 && near >= 1.55;
  if (stream) {
    // Coarser splits = faster cover builds. Do NOT slash leafCap (that punched holes).
    detail = Math.max(detail, 0.026) * 1.25;
    maxLevel = Math.min(maxLevel, CHUNK_STREAM_MAX_LEVEL);
  } else if (near < 1.25) {
    detail = 0.015 * motion;
    maxLevel = Math.min(CHUNK_MAX_LEVEL, 6);
    leafCap = Math.max(MAX_ACTIVE_LEAVES, 110);
  } else if (near < 1.45) {
    detail = 0.018 * motion;
    maxLevel = Math.min(CHUNK_MAX_LEVEL, 5);
    leafCap = Math.max(MAX_ACTIVE_LEAVES, 100);
  } else if (midAu) {
    // ~0.35 AU: densify facing coasts without exploding the whole sphere.
    detail = 0.020 * motion;
    maxLevel = Math.min(CHUNK_MAX_LEVEL, 4);
    leafCap = Math.max(MAX_ACTIVE_LEAVES, 110);
  } else {
    detail = 0.022 * motion;
    leafCap = Math.max(MAX_ACTIVE_LEAVES, 96);
  }

  const pad = opts.horizonPad ?? defaultHorizonPad(viewAu, near);
  const base = {
    camLocal: opts.camLocal,
    radius: opts.radius,
    detail,
    maxLevel,
    cullHorizon: true,
    maxElevation: opts.maxElevation ?? 0.06,
    horizonPad: pad,
  };
  let nodes = selectSphere(base);
  if (nodes.length > leafCap * 4) {
    detail *= 2.2;
    nodes = selectSphere({ ...base, detail });
  }
  if (nodes.length <= leafCap) return nodes;

  detail *= 1.6;
  nodes = selectSphere({ ...base, detail });
  if (nodes.length <= leafCap) return nodes;

  let lo = detail;
  let hi = detail * 8;
  let bestUnder: QuadNode[] | null = nodes.length <= leafCap ? nodes : null;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) * 0.5;
    nodes = selectSphere({ ...base, detail: mid });
    if (nodes.length > leafCap) lo = mid;
    else {
      hi = mid;
      bestUnder = nodes;
    }
  }
  if (bestUnder && bestUnder.length <= leafCap) return bestUnder;

  let d = Math.max(hi, lo);
  for (let i = 0; i < 6; i++) {
    nodes = selectSphere({ ...base, detail: d });
    if (nodes.length <= leafCap) return nodes;
    d *= 1.55;
  }
  // Last resort: parent-collapse (spatial cover), never face-order slice.
  return collapseLeavesToCap(nodes, leafCap);
}

/**
 * Leaves needed one zoom step closer — idle warm ONLY at far orbit, stream-res.
 * Prefetching 100+ coarse/full leaves during 0.6→0.2 AU was the multi-minute hitch.
 */
export function prefetchApproachLeaves(opts: LodSelectOpts): QuadNode[] {
  const viewAu = opts.viewAu ?? 0.8;
  // Only warm from comfortable orbit; approach stays cover-first on the live set.
  if (viewAu < 0.7) return [];
  const dist = Math.hypot(opts.camLocal[0], opts.camLocal[1], opts.camLocal[2]);
  const R = Math.max(opts.radius, 1e-6);
  if (dist < R * 1.8) return [];

  // Prefetch facing L2 siblings toward the camera — not a denser view-LOD tree.
  const facing = allNodesAtLevel(2);
  return sortLeavesByFacing(facing, opts.camLocal).slice(0, 12);
}

/** Sort leaves facing-camera first (warm + cover priority). */
export function sortLeavesByFacing(nodes: QuadNode[], camLocal: Vec3): QuadNode[] {
  return [...nodes].sort((a, b) => facingScore(b, camLocal) - facingScore(a, camLocal));
}

export function isDescendant(child: QuadNode, parent: QuadNode): boolean {
  if (child.face !== parent.face || child.level <= parent.level) return false;
  return child.u0 >= parent.u0 - 1e-9
    && child.v0 >= parent.v0 - 1e-9
    && child.u0 + child.size <= parent.u0 + parent.size + 1e-9
    && child.v0 + child.size <= parent.v0 + parent.size + 1e-9;
}
