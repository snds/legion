// Scale-unification Phase 2b — frame broker + per-frame floating origin.
// 2b ships the machinery with an IDENTITY policy (R ≡ 0): every value must be
// byte-identical to the pre-broker code, and re-parenting all renderables under
// an origin sceneRoot must be a 0-ULP no-op. These two suites are the load-
// bearing neutrality gate (the live render path is verified by screenshot — it
// can't be built headlessly here: createScene needs window, createGalaxy needs
// document, and the runner is bare node).

import { describe, it, expect } from 'vitest';
import { Scene, Group, Object3D, PerspectiveCamera, Vector3 } from 'three';
import { Broker } from './scale-manager';
import { HOME_POS } from './galaxy-density';

describe('frame broker — Phase 2b identity policy', () => {
  it('galactic tier root equals −HOME_POS (byte-identical to legacy getGalaxyOffset)', () => {
    const g = Broker.getTierRoot('galactic');
    expect(g.x).toBe(-HOME_POS[0]);
    expect(g.y).toBe(-HOME_POS[1]);
    expect(g.z).toBe(-HOME_POS[2]);
  });

  it('local and regional tier roots are the scene origin', () => {
    expect(Broker.getTierRoot('local').toArray()).toEqual([0, 0, 0]);
    expect(Broker.getTierRoot('regional').toArray()).toEqual([0, 0, 0]);
  });

  it('the scene rebase R is the identity, independent of beginFrame focus', () => {
    expect(Broker.getSceneRebase().toArray()).toEqual([0, 0, 0]);
    Broker.beginFrame({ x: 8_300_000, y: -2e6, z: 3e6 }); // a galactic-magnitude focus
    expect(Broker.getSceneRebase().toArray()).toEqual([0, 0, 0]);
    // tier roots are unchanged after beginFrame under the identity policy
    expect(Broker.getTierRoot('galactic').x).toBe(-HOME_POS[0]);
  });

  it('returns fresh vectors (matches the legacy getGalaxyOffset() contract)', () => {
    const a = Broker.getTierRoot('galactic');
    const b = Broker.getTierRoot('galactic');
    expect(a).not.toBe(b);
    expect(a.toArray()).toEqual(b.toArray());
  });
});

describe('floating-origin re-parent is a 0-ULP identity (sceneRoot at origin)', () => {
  // Mirrors the real chain scene → sceneRoot → layer → body (galactic layer
  // carries −HOME_POS), and asserts world transforms are bit-identical with vs
  // without the origin sceneRoot. Bare three.js math — no DOM/WebGL.
  const build = (withRoot: boolean, layerPos: Vector3, bodyPos: Vector3): Object3D => {
    const scene = new Scene();
    const layer = new Group();
    layer.position.copy(layerPos);
    const body = new Object3D();
    body.position.copy(bodyPos);
    if (withRoot) {
      const root = new Group();
      root.name = 'scene-root';
      scene.add(root);
      root.add(layer);
    } else {
      scene.add(layer);
    }
    layer.add(body);
    scene.updateMatrixWorld(true);
    return body;
  };

  const G = new Vector3(-HOME_POS[0], -HOME_POS[1], -HOME_POS[2]); // galactic layer offset
  const battery: Array<[Vector3, Vector3]> = [
    [new Vector3(0, 0, 0), new Vector3(12, -3, 47)],          // local body
    [new Vector3(0, 0, 0), new Vector3(1484, 1716, 421)],     // regional marker (Sol scene-WU)
    [G, new Vector3(2766.9, 0, 0)],                           // galactic: Sol galactic-local WU
    [G, new Vector3(5000, 400, -5000)],                       // galactic: disc-AABB corner
  ];

  it('getWorldPosition is bit-identical with and without the origin sceneRoot', () => {
    for (const [lp, bp] of battery) {
      const a = new Vector3(); build(true, lp, bp).getWorldPosition(a);
      const b = new Vector3(); build(false, lp, bp).getWorldPosition(b);
      expect(a.toArray()).toEqual(b.toArray());
    }
  });

  it('matrixWorld elements are bit-identical (no precision drift)', () => {
    for (const [lp, bp] of battery) {
      expect(build(true, lp, bp).matrixWorld.elements.slice())
        .toEqual(build(false, lp, bp).matrixWorld.elements.slice());
    }
  });

  it('camera modelView (matrixWorldInverse · matrixWorld) is bit-identical', () => {
    const cam = new PerspectiveCamera(55, 1.6, 0.01, 200000);
    cam.position.set(0, 40, 80);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    for (const [lp, bp] of battery) {
      const a = cam.matrixWorldInverse.clone().multiply(build(true, lp, bp).matrixWorld).elements.slice();
      const b = cam.matrixWorldInverse.clone().multiply(build(false, lp, bp).matrixWorld).elements.slice();
      expect(a).toEqual(b);
    }
  });
});
