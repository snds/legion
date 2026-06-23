// Scale-unification Phase 2b — frame broker + per-frame floating origin.
// 2b ships the machinery with an IDENTITY policy (R ≡ 0): every value must be
// byte-identical to the pre-broker code, and re-parenting all renderables under
// an origin sceneRoot must be a 0-ULP no-op. These two suites are the load-
// bearing neutrality gate (the live render path is verified by screenshot — it
// can't be built headlessly here: createScene needs window, createGalaxy needs
// document, and the runner is bare node).

import { describe, it, expect, afterEach } from 'vitest';
import { Scene, Group, Object3D, PerspectiveCamera, Vector3 } from 'three';
import { Broker } from './scale-manager';
import { galPos, HOME_SYSTEM } from '../data/curated-systems';
import { WU_PER_PC } from '../core/metrics';

// Phase 2c-1: the galactic tier origin is Sgr A* in the unified metric =
// −galPos(home)·WU_PER_PC (~8.3e6 WU). Computed from the curated catalogue, the
// same authoritative source the broker places the galactic tier from.
const GAL_ORIGIN = (() => {
  const g = galPos(HOME_SYSTEM);
  return new Vector3(-g.x * WU_PER_PC, -g.y * WU_PER_PC, -g.z * WU_PER_PC);
})();

describe('frame broker — tier roots (Phase 2c-1 unified galactic origin)', () => {
  it('galactic tier root equals −galPos(home)·WU_PER_PC (Sgr A* in the unified metric)', () => {
    const g = Broker.getTierRoot('galactic');
    expect(g.x).toBeCloseTo(GAL_ORIGIN.x, 3);
    expect(g.y).toBeCloseTo(GAL_ORIGIN.y, 3);
    expect(g.z).toBeCloseTo(GAL_ORIGIN.z, 3);
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
    expect(Broker.getTierRoot('galactic').x).toBeCloseTo(GAL_ORIGIN.x, 3);
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

  const G = GAL_ORIGIN.clone(); // galactic layer offset (Sgr A*, unified metric)
  const battery: Array<[Vector3, Vector3]> = [
    [new Vector3(0, 0, 0), new Vector3(12, -3, 47)],          // local body
    [new Vector3(0, 0, 0), new Vector3(1484, 1716, 421)],     // regional marker (Sol scene-WU)
    [G, new Vector3(8_300_000, 0, 0)],                        // galactic: Sol galactocentric (unified WU)
    [G, new Vector3(1.5e7, 4e5, -1.5e7)],                     // galactic: disc-AABB corner (unified WU)
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

// Phase 2c-0b: the floating origin is ACTIVE. The camera sets R = its absolute
// world position via Broker.setRebase() each frame; these drive the REAL broker
// (not a hand-injected tier root) so the rebase math can't silently break.
describe('floating origin ACTIVE — broker rebase (Phase 2c)', () => {
  afterEach(() => Broker.setRebase(new Vector3(0, 0, 0))); // restore identity for other suites

  it('setRebase drives R; getTierRoot(tier) = tierOrigin − R for every tier', () => {
    const R = new Vector3(8_300_000, 1_000_000, -2_000_000);
    Broker.setRebase(R);
    expect(Broker.getSceneRebase().toArray()).toEqual([R.x, R.y, R.z]);
    expect(Broker.getTierRoot('local').toArray()).toEqual([-R.x, -R.y, -R.z]);
    expect(Broker.getTierRoot('regional').toArray()).toEqual([-R.x, -R.y, -R.z]);
    const g = Broker.getTierRoot('galactic');
    expect(g.x).toBeCloseTo(GAL_ORIGIN.x - R.x, 2);
    expect(g.y).toBeCloseTo(GAL_ORIGIN.y - R.y, 2);
    expect(g.z).toBeCloseTo(GAL_ORIGIN.z - R.z, 2);
  });

  it('a body at the camera focus renders at a SMALL residual (the float32-safety point)', () => {
    // Camera orbits a focus at galactic magnitude; with R = the camera world pos,
    // the focus (and bodies near it) render within ~camDist of the origin — NOT at
    // 8e6 WU — so float32 GPU coords stay precise.
    const focusAbs = new Vector3(8_300_000, 0, 0);                  // home-ish, galactic WU
    const camAbs = focusAbs.clone().add(new Vector3(0, 0, 3000));   // orbit dist 3000
    Broker.setRebase(camAbs);                                       // R = camera world pos
    const focusRender = focusAbs.clone().sub(Broker.getSceneRebase()); // = focusAbs − camAbs
    expect(focusRender.length()).toBeCloseTo(3000, 0);              // ≈ camDist, small
    expect(focusRender.length()).toBeLessThan(1e4);
  });

  it('modelView is invariant to R (the residual −R cancels)', () => {
    // Build scene→tierGroup→body with the tier at getTierRoot('galactic') and the
    // camera at camAbs−R, for R=0 and R=camAbs; the body's modelView must match.
    const bodyLocal = new Vector3(1.5e7, 4e5, -1.5e7);
    const camAbs = new Vector3(2.0e7, 5.0e5, -1.0e7);
    const bodyAbs = new Vector3(GAL_ORIGIN.x + bodyLocal.x, GAL_ORIGIN.y + bodyLocal.y, GAL_ORIGIN.z + bodyLocal.z);
    const modelView = (R: Vector3): number[] => {
      Broker.setRebase(R);
      const scene = new Scene();
      const tier = new Group(); tier.position.copy(Broker.getTierRoot('galactic'));
      const body = new Object3D(); body.position.copy(bodyLocal);
      scene.add(tier); tier.add(body);
      const cam = new PerspectiveCamera(55, 1.6, 0.01, 2e8);
      cam.position.copy(camAbs).sub(R);                 // camera at residual
      cam.lookAt(bodyAbs.x - R.x, bodyAbs.y - R.y, bodyAbs.z - R.z);
      scene.add(cam);
      scene.updateMatrixWorld(true); cam.updateMatrixWorld(true);
      return cam.matrixWorldInverse.clone().multiply(body.matrixWorld).elements.slice();
    };
    const mv0 = modelView(new Vector3(0, 0, 0));
    const mvR = modelView(camAbs.clone());              // R = camAbs ⇒ camera → origin
    mv0.forEach((v, i) => expect(mvR[i]).toBeCloseTo(v, 1)); // float64 cancels; ~exact
  });
});
