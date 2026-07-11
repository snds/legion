import { describe, it, expect, afterEach } from 'vitest';
import { Group, PerspectiveCamera } from 'three';
import { updateSystemStar, disposeSystemStar } from './star-manager';

afterEach(() => disposeSystemStar());

/** A stand-in for the star group objects.ts createStarMesh builds: carries the
 *  spectral/name/bodyRadius userData + a legacy 'sun-system' subgroup to hide. */
function makeStarGroup(name: string, spectral: string): Group {
  const g = new Group();
  g.userData.type = 'star';
  g.userData.name = name;
  g.userData.spectralType = spectral;
  g.userData.bodyRadius = 0.5;
  const legacy = new Group();
  legacy.name = 'sun-system';
  g.add(legacy);
  return g;
}

const cam = new PerspectiveCamera();

describe('updateSystemStar — install + drive the active star', () => {
  it('installs on first sight, hides the legacy sun, returns true', () => {
    const star = makeStarGroup('Sol', 'G2V · HOME');
    const driving = updateSystemStar([star], 0.016, cam, 0.05);
    expect(driving).toBe(true);
    expect(star.getObjectByName('sun-system')!.visible).toBe(false);
    expect(star.getObjectByName('procedural-star')).toBeTruthy();
  });

  it('is idempotent — repeated frames do not stack duplicate stars', () => {
    const star = makeStarGroup('Sol', 'G2V');
    updateSystemStar([star], 0.016, cam, 0.05);
    updateSystemStar([star], 0.016, cam, 0.05);
    updateSystemStar([star], 0.016, cam, 0.05);
    const count = star.children.filter((c) => c.name === 'procedural-star').length;
    expect(count).toBe(1);
  });

  it('rebuilds on a system swap + restores the swapped-out legacy sun', () => {
    const sol = makeStarGroup('Sol', 'G2V');
    updateSystemStar([sol], 0.016, cam, 0.05);
    expect(sol.getObjectByName('procedural-star')).toBeTruthy();

    const eri = makeStarGroup('Epsilon Eridani', 'K2V');
    updateSystemStar([eri], 0.016, cam, 0.05);
    // Old star torn down (its procedural child removed, legacy restored)…
    expect(sol.getObjectByName('procedural-star')).toBeFalsy();
    expect(sol.getObjectByName('sun-system')!.visible).toBe(true);
    // …new star installed.
    expect(eri.getObjectByName('procedural-star')).toBeTruthy();
  });

  it('returns false + tears down when there is no star group', () => {
    const star = makeStarGroup('Sol', 'G2V');
    updateSystemStar([star], 0.016, cam, 0.05);
    expect(updateSystemStar([], 0.016, cam, 0.05)).toBe(false);
    expect(star.getObjectByName('procedural-star')).toBeFalsy();
    expect(star.getObjectByName('sun-system')!.visible).toBe(true);
  });
});
