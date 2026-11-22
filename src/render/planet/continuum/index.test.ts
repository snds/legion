// P2-17 — ContinuumGlobe's moon mode (`{ isMoon: true }` constructor option).
// Verifies the construction-time SKIP is real (clouds/atmosphere are never
// built, not just hidden), that terrain (chunk pool + surface voxels) is
// still built, that rings never mount regardless of `hasRings`, and that
// `setPlanetshine()` is safe on every body shape (moon, ordinary planet,
// giant — which has no chunk pool at all). Checked structurally via the
// public `root` scene graph (named children each subsystem already tags
// itself with — 'continuum-atmos', 'continuum-clouds', 'continuum-chunks',
// 'continuum-surface-voxels') rather than reaching into private fields.

import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { ContinuumGlobe } from './index';
import type { GenPlanet } from '../../../data/system-gen';

const rocky: GenPlanet = {
  type: 'rocky', kind: 'super-earth', au: 1.6, massEarth: 3, radiusEarth: 1.4,
  insolation: 0.4, isGasGiant: false, hasRings: false, inHZ: false, seed: 1001,
};

const rockyWithRings: GenPlanet = { ...rocky, hasRings: true, seed: 1002 };

const gasGiant: GenPlanet = {
  type: 'gas', kind: 'gas-giant', au: 3.4, massEarth: 300, radiusEarth: 11,
  insolation: 0.09, isGasGiant: true, hasRings: true, inHZ: false, seed: 6006,
};

function hasNamedDescendant(root: Object3D, name: string): boolean {
  let found = false;
  root.traverse((o) => { if (o.name === name) found = true; });
  return found;
}

describe('ContinuumGlobe moon mode (P2-17)', () => {
  it('an ordinary (non-moon) planet builds clouds + atmosphere + terrain', () => {
    const globe = new ContinuumGlobe(rocky, 1);
    expect(hasNamedDescendant(globe.root, 'continuum-atmos')).toBe(true);
    expect(hasNamedDescendant(globe.root, 'continuum-clouds')).toBe(true);
    expect(hasNamedDescendant(globe.root, 'continuum-chunks')).toBe(true);
    expect(hasNamedDescendant(globe.root, 'continuum-surface-voxels')).toBe(true);
    globe.dispose();
  });

  it('isMoon:true skips clouds + atmosphere entirely but still builds terrain', () => {
    const globe = new ContinuumGlobe(rocky, 1, { isMoon: true });
    expect(hasNamedDescendant(globe.root, 'continuum-atmos')).toBe(false);
    expect(hasNamedDescendant(globe.root, 'continuum-clouds')).toBe(false);
    expect(hasNamedDescendant(globe.root, 'continuum-chunks')).toBe(true);
    expect(hasNamedDescendant(globe.root, 'continuum-surface-voxels')).toBe(true);
    globe.dispose();
  });

  it('a non-moon body with hasRings mounts rings', () => {
    const globe = new ContinuumGlobe(rockyWithRings, 1);
    expect(globe.rings).not.toBeNull();
    globe.dispose();
  });

  it('isMoon:true never mounts rings, even when the GenPlanet says hasRings', () => {
    const globe = new ContinuumGlobe(rockyWithRings, 1, { isMoon: true });
    expect(globe.rings).toBeNull();
    globe.dispose();
  });

  it('setPlanetshine() is a harmless no-op call on a moon body (no throw)', () => {
    const globe = new ContinuumGlobe(rocky, 1, { isMoon: true });
    expect(() => globe.setPlanetshine([0, 1, 0], [0.6, 0.7, 0.9], 0.2)).not.toThrow();
    globe.dispose();
  });

  it('setPlanetshine() is a harmless no-op call on an ordinary planet body (no throw)', () => {
    const globe = new ContinuumGlobe(rocky, 1);
    expect(() => globe.setPlanetshine([0, 1, 0], [0.6, 0.7, 0.9], 0.2)).not.toThrow();
    globe.dispose();
  });

  it('setPlanetshine() is a harmless no-op call on a giant body (no chunk pool at all)', () => {
    const globe = new ContinuumGlobe(gasGiant, 1);
    expect(hasNamedDescendant(globe.root, 'continuum-chunks')).toBe(false);
    expect(() => globe.setPlanetshine([0, 1, 0], [0.6, 0.7, 0.9], 0.2)).not.toThrow();
    globe.dispose();
  });
});
