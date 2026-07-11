import { describe, it, expect } from 'vitest';
import {
  CUBE_FACES, facePoint, cubeToSphere, rootNode, childNodes, nodeId,
  nodeCenterDir, selectFace, selectSphere, type Vec3,
} from './cube-sphere';

const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

describe('cube→sphere mapping', () => {
  it('maps every face sample onto the unit sphere', () => {
    for (const face of CUBE_FACES) {
      for (let u = 0; u <= 1; u += 0.25) {
        for (let v = 0; v <= 1; v += 0.25) {
          const s = cubeToSphere(facePoint(face, u, v));
          expect(len(s)).toBeCloseTo(1, 5);
        }
      }
    }
  });

  it('face centres point along their outward normal', () => {
    for (const face of CUBE_FACES) {
      const c = nodeCenterDir(rootNode(face.id));
      expect(c[0]).toBeCloseTo(face.normal[0], 5);
      expect(c[1]).toBeCloseTo(face.normal[1], 5);
      expect(c[2]).toBeCloseTo(face.normal[2], 5);
    }
  });

  it('the six face centres are mutually distinct directions', () => {
    const centres = CUBE_FACES.map((f) => nodeCenterDir(rootNode(f.id)));
    for (let i = 0; i < centres.length; i++) {
      for (let j = i + 1; j < centres.length; j++) {
        const dot = centres[i][0] * centres[j][0] + centres[i][1] * centres[j][1] + centres[i][2] * centres[j][2];
        expect(dot).toBeLessThan(0.99); // never the same direction
      }
    }
  });
});

describe('quadtree subdivision', () => {
  it('splits a node into four half-size children covering the parent', () => {
    const n = rootNode(0);
    const kids = childNodes(n);
    expect(kids).toHaveLength(4);
    for (const k of kids) {
      expect(k.size).toBeCloseTo(0.5);
      expect(k.level).toBe(1);
      expect(k.u0).toBeGreaterThanOrEqual(0);
      expect(k.v0).toBeGreaterThanOrEqual(0);
      expect(k.u0 + k.size).toBeLessThanOrEqual(1 + 1e-9);
    }
    // The four children tile the [0,1]² face with no overlap in origin.
    const origins = new Set(kids.map((k) => `${k.u0},${k.v0}`));
    expect(origins.size).toBe(4);
  });

  it('gives every node a stable, unique id', () => {
    const kids = childNodes(rootNode(2));
    const ids = kids.map(nodeId);
    expect(new Set(ids).size).toBe(4);
    expect(nodeId(kids[0])).toBe(nodeId(childNodes(rootNode(2))[0])); // deterministic
  });
});

describe('LOD selection', () => {
  const far: Parameters<typeof selectFace>[1] = {
    camLocal: [0, 0, 100], radius: 1, detail: 1.1, maxLevel: 4,
  };
  const near: Parameters<typeof selectFace>[1] = {
    camLocal: [0, 0, 1.2], radius: 1, detail: 1.1, maxLevel: 4,
  };

  it('keeps the root leaf when the camera is far', () => {
    const leaves = selectFace(4, far); // +Z face, camera on +Z
    expect(leaves).toHaveLength(1);
    expect(leaves[0].level).toBe(0);
  });

  it('splits deeper as the camera approaches', () => {
    const leaves = selectFace(4, near);
    expect(leaves.length).toBeGreaterThan(1);
    expect(Math.max(...leaves.map((l) => l.level))).toBeGreaterThan(0);
  });

  it('never exceeds maxLevel', () => {
    const leaves = selectSphere({ camLocal: [0, 0, 1.001], radius: 1, detail: 0.2, maxLevel: 3 });
    expect(Math.max(...leaves.map((l) => l.level))).toBeLessThanOrEqual(3);
  });

  it('is deterministic for identical params', () => {
    const a = selectSphere(near).map(nodeId).sort();
    const b = selectSphere(near).map(nodeId).sort();
    expect(a).toEqual(b);
  });

  it('covers all six faces', () => {
    const faces = new Set(selectSphere(far).map((l) => l.face));
    expect(faces.size).toBe(6);
  });
});
