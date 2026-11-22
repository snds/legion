// ASTEROID BELT — determinism test (P2-8).
//
// createAsteroidBelt() used raw Math.random() for every geometry/placement/
// color draw, so a belt looked different on every reload of the same system
// (dispose + re-instantiate calls createAsteroidBelt again with the same
// static BeltConfig). It now derives a per-belt seed from the belt's stable
// identity (name + AU range) via the project's channel()/mulberry32
// primitives (planet/rng.ts) — same inputs must always produce byte-identical
// instance data, simulating exactly what a system-focus reload does.

import { describe, it, expect } from 'vitest';
import type { InstancedMesh, Group } from 'three';
import { createAsteroidBelt } from './asteroid-belt';

function instancedMeshes(group: Group): InstancedMesh[] {
  return group.children as InstancedMesh[];
}

function snapshot(group: Group): { matrices: Float32Array[]; colors: (Float32Array | null)[] } {
  const meshes = instancedMeshes(group);
  return {
    matrices: meshes.map((m) => new Float32Array(m.instanceMatrix.array)),
    colors: meshes.map((m) => {
      const attr = m.geometry.getAttribute('instanceColor');
      return attr ? new Float32Array(attr.array as Float32Array) : null;
    }),
  };
}

describe('createAsteroidBelt — seeded determinism (P2-8)', () => {
  it('same belt identity (name + AU range) reproduces byte-identical instances across reloads', () => {
    const beltA = createAsteroidBelt(2.06, 3.27, { name: 'Main Belt', density: 0.05 });
    const beltB = createAsteroidBelt(2.06, 3.27, { name: 'Main Belt', density: 0.05 });

    const snapA = snapshot(beltA.group);
    const snapB = snapshot(beltB.group);

    expect(snapA.matrices.length).toBe(snapB.matrices.length);
    expect(snapA.matrices.length).toBeGreaterThan(0);
    for (let i = 0; i < snapA.matrices.length; i++) {
      expect(Array.from(snapB.matrices[i])).toEqual(Array.from(snapA.matrices[i]));
      const colA = snapA.colors[i];
      const colB = snapB.colors[i];
      expect(colB && Array.from(colB)).toEqual(colA && Array.from(colA));
    }
  });

  it('a different belt name (different identity) does NOT reproduce the same instances', () => {
    const beltA = createAsteroidBelt(2.06, 3.27, { name: 'Main Belt', density: 0.05 });
    const beltC = createAsteroidBelt(2.06, 3.27, { name: 'Kuiper Belt', density: 0.05 });

    const snapA = snapshot(beltA.group);
    const snapC = snapshot(beltC.group);

    // At least one instanced mesh's matrix stream must differ — a different
    // belt identity must not collide onto the same seed.
    const anyDifferent = snapA.matrices.some((m, i) =>
      Array.from(m).join(',') !== Array.from(snapC.matrices[i]).join(','));
    expect(anyDifferent).toBe(true);
  });

  it('two different systems sharing the belt name "Main Belt" still diverge (AU range breaks the tie)', () => {
    // Sol's main belt and EE's main belt are both literally named "Main Belt"
    // but occupy different AU ranges — the seed must fold in the range too,
    // or every "Main Belt" in the galaxy would look identical.
    const sol = createAsteroidBelt(2.06, 3.27, { name: 'Main Belt', density: 0.05 });
    const ee = createAsteroidBelt(1.9, 2.6, { name: 'Main Belt', density: 0.05 });

    const snapSol = snapshot(sol.group);
    const snapEe = snapshot(ee.group);
    const anyDifferent = snapSol.matrices.some((m, i) =>
      Array.from(m).join(',') !== Array.from(snapEe.matrices[i]).join(','));
    expect(anyDifferent).toBe(true);
  });
});
