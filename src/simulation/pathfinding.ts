// ═══════════════════════════════════════════════════════════════════
// PATHFINDING — Star-System Graph Routing (ngraph.path)
// NBA* bidirectional A* on a weighted graph of star systems.
// Sub-millisecond path calculations for hundreds of systems.
//
// Edge weights combine distance, danger, and faction status.
// Blocked edges (blockaded routes) are filtered dynamically.
// ═══════════════════════════════════════════════════════════════════

import createGraph from 'ngraph.graph';
import path from 'ngraph.path';
import { Position, StarSystem, Identity } from '../core/components';
import { Strings } from '../core/world';
import { LY_TO_WU } from '../core/metrics';
import { globalBoard } from './ai/blackboard';

// ── Graph Instance ───────────────────────────────────────────────

// Navigable jump range, WORLD UNITS. Position holds real neighbourhood scene-WU
// coordinates; Phase 2c-1 Inc 6 re-expresses both the positions (regionalScenePos
// → ×WU_PER_PC) and this threshold on the UNIFIED metric (1 ly = LY_TO_WU ≈ 306.6
// WU), scaling both by the SAME 1.394× so the graph topology is preserved.
// 14 ly: the curated neighbourhood's MST has a 9.3 ly longest edge, so 14 ly
// keeps the graph connected with margin (~69 edges, matching prior density).
export const NAV_LINK_WU = 14 * LY_TO_WU; // ≈ 4292 WU (unified)

export interface StarEdge {
  distance: number;        // world units (unified frame, 1000 WU/pc); routing cost
  danger: number;          // 0-1 threat level
  status: 'open' | 'blockaded' | 'contested';
}

const graph = createGraph<{ eid: number; x: number; y: number; z: number }, StarEdge>();

// ── Graph Construction ───────────────────────────────────────────

/**
 * Build the star system graph from ECS entities.
 * Call once during init and whenever systems are discovered.
 *
 * @param systemEids - Array of star system entity IDs
 * @param maxEdgeDistance - Maximum distance for edge connections, WORLD UNITS
 *   (unified frame, 1000 WU/pc). Defaults to NAV_LINK_WU (14 ly).
 */
export function buildStarGraph(
  systemEids: number[],
  maxEdgeDistance = NAV_LINK_WU,
): void {
  graph.clear();

  // Add nodes
  for (const eid of systemEids) {
    graph.addNode(eid, {
      eid,
      x: Position.x[eid],
      y: Position.y[eid],
      z: Position.z[eid],
    });
  }

  // Add edges between systems within range
  for (let i = 0; i < systemEids.length; i++) {
    for (let j = i + 1; j < systemEids.length; j++) {
      const a = systemEids[i];
      const b = systemEids[j];

      const dx = Position.x[a] - Position.x[b];
      const dy = Position.y[a] - Position.y[b];
      const dz = Position.z[a] - Position.z[b];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist <= maxEdgeDistance) {
        const dangerA = globalBoard.threats.get(a)?.severity ?? 0;
        const dangerB = globalBoard.threats.get(b)?.severity ?? 0;
        const danger = Math.max(dangerA, dangerB);

        graph.addLink(a, b, {
          distance: dist,
          danger,
          status: 'open',
        });
      }
    }
  }
}

/**
 * Add a single system to the graph and connect it to nearby systems.
 */
export function addSystemToGraph(
  eid: number,
  maxEdgeDistance = NAV_LINK_WU,
): void {
  const x = Position.x[eid];
  const y = Position.y[eid];
  const z = Position.z[eid];

  graph.addNode(eid, { eid, x, y, z });

  // Connect to existing nodes within range
  graph.forEachNode((node) => {
    if (node.id === eid) return false;
    const data = node.data!;
    const dx = x - data.x;
    const dy = y - data.y;
    const dz = z - data.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist <= maxEdgeDistance) {
      graph.addLink(eid, node.id as number, {
        distance: dist,
        danger: 0,
        status: 'open' as const,
      });
    }
    return false; // continue iteration
  });
}

// ── Path Finding ─────────────────────────────────────────────────

/** Euclidean distance heuristic for A* */
function heuristic(fromNode: any, toNode: any): number {
  const a = fromNode.data;
  const b = toNode.data;
  if (!a || !b) return 0;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Find the shortest path between two star systems.
 * Returns array of system eids from start to end, or empty if no path.
 *
 * @param fromEid - Starting system entity ID
 * @param toEid - Destination system entity ID
 * @param avoidDanger - If true, danger-weighted routing (default false)
 */
export function findPath(
  fromEid: number,
  toEid: number,
  avoidDanger = false,
): number[] {
  const pathFinder = path.aStar(graph, {
    distance(from, to, link) {
      const edge = link.data as StarEdge;
      if (!edge) return Infinity;

      // Base cost is distance
      let cost = edge.distance;

      // Apply danger penalty if requested
      if (avoidDanger && edge.danger > 0) {
        cost *= (1 + edge.danger * 3);
      }

      return cost;
    },
    heuristic,
  });

  const result = pathFinder.find(fromEid, toEid);
  if (!result || result.length === 0) return [];

  // ngraph returns nodes in reverse order (destination first)
  return result.map(node => node.id as number).reverse();
}

/**
 * Find path avoiding specific systems (e.g., blockaded routes).
 */
export function findSafePath(
  fromEid: number,
  toEid: number,
  blockedSystems: Set<number>,
): number[] {
  const pathFinder = path.aStar(graph, {
    distance(from, to, link) {
      const edge = link.data as StarEdge;
      if (!edge || edge.status === 'blockaded') return Infinity;

      // Block paths through dangerous systems
      const toId = to.id as number;
      if (blockedSystems.has(toId) && toId !== toEid) return Infinity;

      return edge.distance * (1 + edge.danger * 5);
    },
    heuristic,
  });

  const result = pathFinder.find(fromEid, toEid);
  if (!result || result.length === 0) return [];

  return result.map(node => node.id as number).reverse();
}

// ── Edge Management ──────────────────────────────────────────────

/**
 * Update danger levels on all edges connected to a system.
 */
export function updateDanger(systemEid: number, danger: number): void {
  graph.forEachLinkedNode(systemEid, (linked, link) => {
    if (link.data) {
      (link.data as StarEdge).danger = Math.max(
        (link.data as StarEdge).danger,
        danger,
      );
    }
  });
}

/**
 * Blockade a route between two systems.
 */
export function blockadeRoute(fromEid: number, toEid: number): void {
  const link = graph.getLink(fromEid, toEid) ?? graph.getLink(toEid, fromEid);
  if (link?.data) {
    (link.data as StarEdge).status = 'blockaded';
  }
}

/**
 * Lift a blockade.
 */
export function liftBlockade(fromEid: number, toEid: number): void {
  const link = graph.getLink(fromEid, toEid) ?? graph.getLink(toEid, fromEid);
  if (link?.data) {
    (link.data as StarEdge).status = 'open';
  }
}

// ── Utility ──────────────────────────────────────────────────────

/**
 * Get all systems reachable from a given system.
 */
export function getReachableSystems(fromEid: number): number[] {
  const visited = new Set<number>();
  const queue = [fromEid];

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    graph.forEachLinkedNode(current, (linked, link) => {
      const edge = link.data as StarEdge;
      if (edge?.status !== 'blockaded' && !visited.has(linked.id as number)) {
        queue.push(linked.id as number);
      }
    });
  }

  visited.delete(fromEid);
  return [...visited];
}

/**
 * Get the nearest N systems to a given system (by graph distance).
 */
export function getNearestSystems(
  fromEid: number,
  count: number,
): Array<{ eid: number; distance: number }> {
  const distances: Array<{ eid: number; distance: number }> = [];

  graph.forEachLinkedNode(fromEid, (linked, link) => {
    const edge = link.data as StarEdge;
    if (edge) {
      distances.push({ eid: linked.id as number, distance: edge.distance });
    }
  });

  distances.sort((a, b) => a.distance - b.distance);
  return distances.slice(0, count);
}

// ── Debug ────────────────────────────────────────────────────────

export function getGraphStats(): {
  nodes: number;
  edges: number;
  blockedEdges: number;
} {
  let edges = 0;
  let blockedEdges = 0;

  graph.forEachLink((link) => {
    edges++;
    if ((link.data as StarEdge)?.status === 'blockaded') blockedEdges++;
  });

  return {
    nodes: graph.getNodeCount(),
    edges,
    blockedEdges,
  };
}

// ── Serialization ────────────────────────────────────────────────

export function serializeGraph(): Record<string, unknown> {
  const nodes: Array<[number, { eid: number; x: number; y: number; z: number }]> = [];
  const links: Array<{ from: number; to: number; data: StarEdge }> = [];

  graph.forEachNode((node) => {
    nodes.push([node.id as number, node.data!]);
  });

  graph.forEachLink((link) => {
    links.push({
      from: link.fromId as number,
      to: link.toId as number,
      data: link.data as StarEdge,
    });
  });

  return { nodes, links };
}

export function deserializeGraph(data: Record<string, unknown>): void {
  graph.clear();

  const nodes = data.nodes as Array<[number, { eid: number; x: number; y: number; z: number }]>;
  const links = data.links as Array<{ from: number; to: number; data: StarEdge }>;

  for (const [id, nodeData] of nodes) {
    graph.addNode(id, nodeData);
  }

  for (const link of links) {
    graph.addLink(link.from, link.to, link.data);
  }
}
