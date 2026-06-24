// Sector-cloud prototype Inc 3 — the cloud volume's load-bearing math: the shader
// samples the SAME native galactocentric field the disc + embedded stars use, so the
// three agree by construction (no seam). The shader itself can't be unit-tested, but
// its coordinate contract — the JS that feeds its uniforms — can.

import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { KPC_TO_WU, WU_PER_PC, GALAXY_MODEL_SCALE } from '../../core/metrics';
import { galPos, HOME_SYSTEM } from '../../data/curated-systems';
import { createHomeSector, createSector, HOME_GAL_PC, DEFAULT_SECTOR_EDGE_PC } from './sector';
import {
  buildSectorCloud, sectorCenterNativeWU, sectorLocalWUToNative, updateSectorCloudFrame,
  SECTOR_CLOUD_MIN_CAMDIST, SECTOR_CLOUD_MAX_CAMDIST,
} from './sector-cloud';

const PC_TO_NATIVE = KPC_TO_WU / 1000;

describe('Sector cloud — native sampling frame', () => {
  it('sector centre maps to galPos·0.333 (galaxy-local native WU)', () => {
    const home = createHomeSector();
    const c = sectorCenterNativeWU(home);
    const g = galPos(HOME_SYSTEM);
    expect(c.x).toBeCloseTo(g.x * PC_TO_NATIVE, 6);
    expect(c.y).toBeCloseTo(g.y * PC_TO_NATIVE, 6);
    expect(c.z).toBeCloseTo(g.z * PC_TO_NATIVE, 6);
  });

  it('the shader formula agrees with the galPc→native path (cloud == stars == disc)', () => {
    const home = createHomeSector();
    const local = new Vector3(50_000, -20_000, 30_000); // sector-local WU offset
    const viaShader = sectorLocalWUToNative(home, local);
    // The path the embedded stars use: galPc = centre + local/WU_PER_PC, then ·PC_TO_NATIVE.
    const galPc = new Vector3().copy(home.centerPc).add(local.clone().divideScalar(WU_PER_PC));
    const viaGalPc = galPc.multiplyScalar(PC_TO_NATIVE);
    expect(viaShader.x).toBeCloseTo(viaGalPc.x, 6);
    expect(viaShader.y).toBeCloseTo(viaGalPc.y, 6);
    expect(viaShader.z).toBeCloseTo(viaGalPc.z, 6);
  });

  it('a zero local offset maps to the sector native centre', () => {
    const home = createHomeSector();
    const atCentre = sectorLocalWUToNative(home, new Vector3(0, 0, 0));
    const centre = sectorCenterNativeWU(home);
    expect(atCentre.distanceTo(centre)).toBeLessThan(1e-6);
  });

  it('world→native step scaling equals the disc bridge (1 / GALAXY_MODEL_SCALE)', () => {
    const home = createHomeSector();
    const d = 100_000; // world WU along the ray
    const a = sectorLocalWUToNative(home, new Vector3(d, 0, 0));
    const b = sectorLocalWUToNative(home, new Vector3(0, 0, 0));
    expect(a.x - b.x).toBeCloseTo(d / GALAXY_MODEL_SCALE, 3);
  });
});

describe('Sector cloud — mesh build', () => {
  it('box half-edge is edgePc·WU_PER_PC/2 and composites over disc + stars', () => {
    const cloud = buildSectorCloud(createHomeSector());
    expect(cloud.halfEdgeWU).toBe((DEFAULT_SECTOR_EDGE_PC * WU_PER_PC) / 2); // 125,000
    expect(cloud.mesh.renderOrder).toBe(3);
    expect(cloud.mesh.frustumCulled).toBe(false);
    expect(cloud.material.depthWrite).toBe(false);
  });

  it('uConvK uniform bridges world→native exactly', () => {
    const cloud = buildSectorCloud(createHomeSector());
    expect(cloud.material.uniforms.uConvK!.value).toBeCloseTo(1 / GALAXY_MODEL_SCALE, 9);
  });

  it('a coreward sector carries a smaller native centre radius (closer to Sgr A*)', () => {
    const coreward = createSector(
      new Vector3(HOME_GAL_PC.x - 2000, HOME_GAL_PC.y, HOME_GAL_PC.z),
      DEFAULT_SECTOR_EDGE_PC,
    );
    const cwR = sectorCenterNativeWU(coreward).length();
    const homeR = sectorCenterNativeWU(createHomeSector()).length();
    expect(cwR).toBeLessThan(homeR);
  });
});

describe('Sector cloud — viewing-band gate (protects the system + galaxy tiers)', () => {
  const home = createHomeSector();
  const cloud = buildSectorCloud(home);

  it('hides at the system tier (camera deep inside the box)', () => {
    updateSectorCloudFrame(home, cloud, SECTOR_CLOUD_MIN_CAMDIST - 1);
    expect(cloud.mesh.visible).toBe(false);
  });

  it('shows across the sector-viewing band', () => {
    updateSectorCloudFrame(home, cloud, (SECTOR_CLOUD_MIN_CAMDIST + SECTOR_CLOUD_MAX_CAMDIST) / 2);
    expect(cloud.mesh.visible).toBe(true);
  });

  it('hides at the galaxy tier (far disc owns the view)', () => {
    updateSectorCloudFrame(home, cloud, SECTOR_CLOUD_MAX_CAMDIST + 1);
    expect(cloud.mesh.visible).toBe(false);
  });
});
