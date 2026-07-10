// SYSTEM LOADER — lifecycle + staged-focus gating.
// instantiate populates the world / local layer / render map; dispose removes
// every entity, render-map entry, and layer child; the Stage-B swap holds
// while the local tier is perceptible and fires once it is hidden.
//
// Mesh factories are mocked (createIcon et al. need a DOM canvas; the runner
// is bare node) — the seam under test is the loader's BOOKKEEPING, which is
// exactly what swap correctness depends on. The factory internals themselves
// are exercised by the live render path.

import { describe, it, expect, vi } from 'vitest';
import { Group, Vector3, type Object3D } from 'three';
import { entityExists } from 'bitecs';

vi.mock('./objects', () => ({
  createStarMesh: () => new Group(),
  createPlanetMesh: () => new Group(),
  createMoonMesh: () => new Group(),
  createBobMesh: () => new Group(),
  createOrbitLine: (_el: unknown, opts?: { bodyName?: string }) => {
    const g = new Group();
    g.userData = { type: 'orbit', name: opts?.bodyName };
    return g;
  },
  unregisterStarMesh: vi.fn(),
  unregisterPlanetMesh: vi.fn(),
  unregisterOrbitLine: vi.fn(),
}));
vi.mock('./scene-objects', () => ({
  STATION_DATA: [{ parentIdx: 0, orbitOffset: 0.25 }],
  COMET_DATA: [{ sma: 40, ecc: 0.9 }],
  createStationMesh: () => new Group(),
  createCometMesh: () => ({ body: new Group(), orbLine: new Group() }),
}));
vi.mock('./particles', () => ({
  createHeliopause: () => {
    const g = new Group();
    g.name = 'heliopause';
    return g;
  },
}));
vi.mock('./asteroid-belt', () => ({
  createAsteroidBelt: () => ({ group: new Group() }),
}));
vi.mock('./procedural-textures', () => ({
  hasProceduralRecipe: () => false,
}));

// Stage-A warm-up fetches (Sol textures + exoplanet sidecar) must not hit the
// wire in node — a cold miss is the same as prod-offline (warm-up only).
vi.stubGlobal('fetch', vi.fn(() =>
  Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
));

import {
  instantiateLocalSystem, initSystemFocus, requestSystemFocus, updateSystemFocus,
  getActiveSystemHandle, getActiveAnchor, loadableSystemId,
  type SystemLoaderCtx,
} from './system-loader';
import { world, createSystemEntity } from '../core/world';
import { Game } from '../core/state';

function makeCtx(): SystemLoaderCtx {
  return { layers: { local: new Group() }, renderObjectMap: new Map<number, Object3D>() };
}

describe('instantiateLocalSystem — lifecycle', () => {
  it('EE: creates star + 7 planets + 3 bobs, registers render objects, mounts groups', () => {
    const ctx = makeCtx();
    const h = instantiateLocalSystem(ctx, 'ee', null);
    expect(h.systemId).toBe('ee');
    expect(h.eids).toHaveLength(11);      // 1 star + 7 planets + 3 bobs (no EE moons)
    expect(h.bobEids).toHaveLength(3);
    expect(ctx.renderObjectMap.size).toBe(11);
    // Everything the handle reports is a live child of layers.local
    expect(ctx.layers.local.children.length).toBe(h.groups.length);
    // star + 7 planets + 7 orbits + 1 station + 3 bobs + comet body+line + 2 belts (main + outer debris) + heliopause
    expect(h.groups).toHaveLength(24);
    h.dispose();
  });

  it('Sol: creates star + 8 planets + 7 moons and no bobs', () => {
    const ctx = makeCtx();
    const h = instantiateLocalSystem(ctx, 'sol', null);
    expect(h.eids).toHaveLength(16);
    expect(h.bobEids).toHaveLength(0);
    h.dispose();
  });

  it('dispose removes entities, render-map entries, and layer children', () => {
    const ctx = makeCtx();
    const h = instantiateLocalSystem(ctx, 'ee', null);
    const eids = [...h.eids];
    h.dispose();
    expect(ctx.layers.local.children).toHaveLength(0);
    expect(ctx.renderObjectMap.size).toBe(0);
    for (const eid of eids) expect(entityExists(world, eid)).toBe(false);
  });

  it('dispose clears the selection only when it owned the selected entity', () => {
    const ctx = makeCtx();
    const h1 = instantiateLocalSystem(ctx, 'ee', null);
    Game.selectEntity(h1.eids[0], { type: 'star' });
    h1.dispose();
    expect(Game.data.selectedEntity).toBeNull();

    const h2 = instantiateLocalSystem(ctx, 'ee', null);
    Game.selectEntity(999999, { type: 'system' }); // a marker, not ours
    h2.dispose();
    expect(Game.data.selectedEntity).toBe(999999);
  });
});

describe('system focus — staged Stage-B swap', () => {
  it('holds the swap while the local tier is perceptible, fires once hidden', () => {
    const ctx = makeCtx();
    const boot = instantiateLocalSystem(ctx, 'ee', null);
    const markerEid = createSystemEntity({
      name: 'Sol', x: 111, y: 22, z: -33, distanceLy: 10.5, color: 0xfff4e0,
      planetCount: 8, bobCount: 0, explored: false, hasBobs: false, isHome: false,
    });
    initSystemFocus({ ctx, renderer: null, markerEidFor: () => markerEid }, boot);

    // Perceptible: local visible + below the icon hand-off camDist — hold.
    // Scale-unification U2: SWAP_HIDDEN_CAMDIST now rides SYSTEM_TIER_SCALE
    // (≈ 3200 × 4.85e-4 ≈ 1.55 WU), so the hold/fire samples are true-scale.
    ctx.layers.local.visible = true;
    Game.data.camDist = 1.0;
    requestSystemFocus('sol');
    updateSystemFocus();
    expect(getActiveSystemHandle()?.systemId).toBe('ee');

    // Zoomed out past the hand-off — swap fires this frame.
    Game.data.camDist = 5.0;
    updateSystemFocus();
    expect(getActiveSystemHandle()?.systemId).toBe('sol');
    expect(ctx.renderObjectMap.size).toBe(16); // old EE fully out, Sol in

    // Anchor rides the marker's ECS Position.
    const a = getActiveAnchor(new Vector3());
    expect(a.x).toBeCloseTo(111);
    expect(a.y).toBeCloseTo(22);
    expect(a.z).toBeCloseTo(-33);

    // Re-focusing the active system is a no-op.
    requestSystemFocus('sol');
    updateSystemFocus();
    expect(getActiveSystemHandle()?.systemId).toBe('sol');
    getActiveSystemHandle()?.dispose();
  });

  it('maps only fully-authored curated systems to loadable ids', () => {
    expect(loadableSystemId('Sol')).toBe('sol');
    expect(loadableSystemId('Epsilon Eridani')).toBe('ee');
    expect(loadableSystemId('Sirius')).toBeNull();
    expect(loadableSystemId(undefined)).toBeNull();
  });
});
