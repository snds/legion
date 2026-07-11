import { describe, it, expect } from 'vitest';
import { Group, Vector3, Mesh, Matrix4 } from 'three';
import type { GenPlanet, GenSystem } from '../../data/system-gen';
import { buildNodeGeometry, PlanetGlobe } from './globe';
import { rootNode } from './cube-sphere';
import { PlanetGlobes, visualRadius, orbitalPosition } from './index';

function planet(over: Partial<GenPlanet> = {}): GenPlanet {
  return {
    kind: 'rocky', au: 1, inHZ: false,
    type: 'rocky', massEarth: 1, radiusEarth: 1, insolation: 1,
    isGasGiant: false, hasRings: false, seed: 12345, ...over,
  };
}

describe('buildNodeGeometry', () => {
  it('lays vertices on the sphere of the given radius with unit normals', () => {
    const geo = buildNodeGeometry(rootNode(0), 3, 8);
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      expect(r).toBeCloseTo(3, 4);
      const n = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      expect(n).toBeCloseTo(1, 4);
    }
    expect(geo.getIndex()!.count).toBe(8 * 8 * 6); // res² quads × 2 tris × 3
  });
});

describe('visual calibration', () => {
  it('terrestrials are small, giants larger, all clamped', () => {
    expect(visualRadius(planet({ radiusEarth: 1 }))).toBeCloseTo(0.36, 2);
    expect(visualRadius(planet({ radiusEarth: 11, isGasGiant: true }))).toBeGreaterThan(1);
    expect(visualRadius(planet({ radiusEarth: 40, isGasGiant: true }))).toBeLessThanOrEqual(2.2);
  });

  it('orbital position sits on the ecliptic at au·scale, phase from seed', () => {
    const p = planet({ au: 2, seed: 5 });
    const a = orbitalPosition(p);
    const b = orbitalPosition(p);
    expect(a.y).toBe(0);
    expect(a.length()).toBeCloseTo(2 * 10, 5); // AU_TO_WU = 10
    expect(a).toEqual(b); // deterministic
  });
});

describe('PlanetGlobe assembly', () => {
  it('builds a cube-sphere surface for terrestrials, rings when flagged', () => {
    const g = new PlanetGlobe(planet({ type: 'ocean', hasRings: true }), 0.5);
    // Coarse initial selection = 6 face-root leaf meshes + atmosphere + impostor.
    let meshCount = 0;
    g.root.traverse((o) => { if ((o as Mesh).isMesh) meshCount++; });
    expect(meshCount).toBeGreaterThan(6);
    expect(g.rings).not.toBeNull();
    g.dispose();
  });

  it('builds a banded giant (no terrain ramp) for gas giants', () => {
    const g = new PlanetGlobe(planet({ type: 'gas', isGasGiant: true, radiusEarth: 11 }), 1.5);
    expect(g.params.isGiant).toBe(true);
    expect(g.params.ramp).toHaveLength(0);
    g.dispose();
  });

  it('exposes a samplable ring structure and authors it in planet-radii', () => {
    const radius = 1.5;
    const g = new PlanetGlobe(planet({ type: 'gas', isGasGiant: true, hasRings: true, seed: 8 }), radius);
    let ringMesh: Mesh | undefined;
    g.root.traverse((o) => { if (o.userData.ringSystem) ringMesh = o as Mesh; });
    expect(ringMesh).toBeDefined();
    const rings = g.rings!;
    // Geometry radii must be in PLANET-RADII (so the shader's uInner/uOuter in
    // planet-radii match length(position.xy)); the mesh scale lifts to WU.
    ringMesh!.geometry.computeBoundingSphere();
    expect(ringMesh!.geometry.boundingSphere!.radius).toBeLessThanOrEqual(rings.outerRadius + 1e-3);
    expect(ringMesh!.geometry.boundingSphere!.radius).toBeGreaterThan(1); // outside the planet
    expect(ringMesh!.scale.x).toBeCloseTo(radius, 6);
    g.dispose();
  });
});

describe('PlanetGlobes manager', () => {
  const sys = (planets: GenPlanet[]): GenSystem => ({
    star: {} as GenSystem['star'], planets, hzAu: 1, snowAu: 3, belts: [], habitableCount: 0,
  });

  it('mounts one globe per planet and disposes cleanly', () => {
    const parent = new Group();
    const mgr = new PlanetGlobes();
    mgr.mount(sys([planet({ seed: 1 }), planet({ seed: 2, type: 'gas', isGasGiant: true })]), parent);
    expect(mgr.count).toBe(2);
    expect(parent.children.length).toBe(2);
    mgr.unmount();
    expect(mgr.count).toBe(0);
    expect(parent.children.length).toBe(0);
  });

  it('drives per-frame LOD without a GPU: far ⇒ impostor, near ⇒ globe', () => {
    const parent = new Group();
    parent.scale.setScalar(1); // no tier scale in the test frame
    const mgr = new PlanetGlobes();
    const p = planet({ au: 0, seed: 3 }); // at the origin for a clean distance
    mgr.mount(sys([p]), parent);
    parent.updateMatrixWorld(true);
    const globe = mgr.globes[0];
    globe.root.position.set(0, 0, 0);
    parent.updateMatrixWorld(true);

    const cam = (dist: number): { position: Vector3; matrixWorld: Matrix4 } => ({
      position: new Vector3(0, 0, dist), matrixWorld: new Matrix4(),
    });
    const ctx = (dist: number): Parameters<typeof globe.update>[0] => ({
      camera: cam(dist), sunWorldPos: new Vector3(0, 0, 1000),
      dt: 0.016, fovYRad: (55 * Math.PI) / 180, viewportH: 1080,
    });

    mgr.update(ctx(3));          // close
    expect(globe['surfaceGroup'].visible).toBe(true);

    mgr.update(ctx(500000));     // very far
    expect(globe['surfaceGroup'].visible).toBe(false);
  });
});
