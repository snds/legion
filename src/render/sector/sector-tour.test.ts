import { describe, it, expect } from 'vitest';
import { CURATED_SYSTEMS, type CuratedSystem } from '../../data/curated-systems';
import { sectorTourOrder } from './sector-tour';

const d2 = (a: CuratedSystem, b: CuratedSystem): number =>
  (a.solPc.x - b.solPc.x) ** 2 + (a.solPc.y - b.solPc.y) ** 2 + (a.solPc.z - b.solPc.z) ** 2;

describe('sectorTourOrder — node-to-node visit order', () => {
  it('is a permutation of the systems, starting at home', () => {
    const order = sectorTourOrder(CURATED_SYSTEMS);
    expect(order.length).toBe(CURATED_SYSTEMS.length);
    expect(order[0]!.isHome).toBe(true);
    expect(new Set(order.map((s) => s.name)).size).toBe(CURATED_SYSTEMS.length); // no dupes/drops
  });

  it('the first hop goes to home\'s nearest neighbour (nearest-neighbour greedy)', () => {
    const order = sectorTourOrder(CURATED_SYSTEMS);
    const [home, second] = [order[0]!, order[1]!];
    const dSecond = d2(home, second);
    for (const s of CURATED_SYSTEMS) {
      if (s === home || s === second) continue;
      expect(d2(home, s)).toBeGreaterThanOrEqual(dSecond);
    }
  });

  it('handles empty and singleton inputs', () => {
    expect(sectorTourOrder([]).length).toBe(0);
    expect(sectorTourOrder([CURATED_SYSTEMS[0]!]).length).toBe(1);
  });
});
