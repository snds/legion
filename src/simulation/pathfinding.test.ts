// Regression guard for scale-unification Phase 1: when the curated systems were
// re-pinned to real regional scene-WU coordinates, the star-graph edge threshold
// (a stale "15" from the old fictional ±10 direction cube) silently produced ZERO
// edges — the closest real pair is ~352 WU apart. NAV_LINK_WU fixes the unit.
// These tests fail loudly if the graph is ever empty or disconnected again.

import { describe, it, expect } from 'vitest';
import { STAR_SYSTEMS } from '../data/star-catalog';
import { createSystemEntity } from '../core/world';
import {
  buildStarGraph, getGraphStats, getReachableSystems, findPath, NAV_LINK_WU,
} from './pathfinding';

const eids = STAR_SYSTEMS.map((s) => createSystemEntity(s));
buildStarGraph(eids);
const homeEid = eids[STAR_SYSTEMS.findIndex((s) => s.isHome)];

describe('star-system pathfinding graph (Phase 1 WU re-pin)', () => {
  it('builds a non-empty graph over all systems', () => {
    const stats = getGraphStats();
    expect(stats.nodes).toBe(STAR_SYSTEMS.length);
    expect(stats.edges).toBeGreaterThan(0);
  });

  it('is fully connected — every system reachable from home', () => {
    // getReachableSystems is transitive (BFS) and excludes the source itself
    expect(getReachableSystems(homeEid).length).toBe(STAR_SYSTEMS.length - 1);
  });

  it('has no isolated systems', () => {
    for (const eid of eids) {
      expect(getReachableSystems(eid).length).toBeGreaterThan(0);
    }
  });

  it('finds a route between the two farthest systems', () => {
    const ross154 = eids[STAR_SYSTEMS.findIndex((s) => s.name === 'Ross 154')];
    const route = findPath(homeEid, ross154);
    expect(route.length).toBeGreaterThanOrEqual(2);
    expect(route[0]).toBe(homeEid);
    expect(route[route.length - 1]).toBe(ross154);
  });

  it('NAV_LINK_WU is a world-unit distance in the regional regime (≈3080 WU)', () => {
    // Guards against the threshold ever silently reverting to a ~10-unit value.
    expect(NAV_LINK_WU).toBeGreaterThan(1500);
    expect(NAV_LINK_WU).toBeLessThan(5000);
  });
});
