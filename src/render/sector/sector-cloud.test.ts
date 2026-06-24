// Sector-cloud prototype Inc 3 — the cloud volume's load-bearing math: the shader
// samples the SAME native galactocentric field the disc + embedded stars use, so the
// three agree by construction (no seam). The shader itself can't be unit-tested, but
// its coordinate contract — the JS that feeds its uniforms — can.

import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { KPC_TO_WU, WU_PER_PC, GALAXY_MODEL_SCALE } from '../../core/metrics';
import { CURATED_SYSTEMS, galPos, HOME_SYSTEM } from '../../data/curated-systems';
import { createHomeSector, createSector, HOME_GAL_PC, DEFAULT_SECTOR_EDGE_PC } from './sector';
import {
  buildSectorCloud, sectorCenterNativeWU, sectorLocalWUToNative, updateSectorCloudFrame,
  dominantLight, sectorCloudGateOpacity, SECTOR_CLOUD_MIN_CAMDIST, SECTOR_CLOUD_MAX_CAMDIST,
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
  it('box half-edge is the enlarged (×1.3) extent and composites over disc + stars', () => {
    const cloud = buildSectorCloud(createHomeSector());
    // The cloud box is enlarged (SECTOR_CLOUD_BOX_FACTOR=1.3) so it feathers past the bounds.
    expect(cloud.halfEdgeWU).toBeCloseTo((DEFAULT_SECTOR_EDGE_PC * WU_PER_PC / 2) * 1.3, 3); // 162,500
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

  it('drives a smooth crossfade opacity (no hard pop)', () => {
    updateSectorCloudFrame(home, cloud, 60_000); // mid-band
    expect(cloud.material.uniforms.uOpacity!.value).toBeGreaterThan(0.9);
    updateSectorCloudFrame(home, cloud, SECTOR_CLOUD_MAX_CAMDIST + 1); // past the disc handoff
    expect(cloud.material.uniforms.uOpacity!.value).toBe(0);
  });
});

describe('Sector cloud — gate crossfade math (Inc 5 composition)', () => {
  it('0 at the system tier, 1 in-band, 0 past the disc handoff — no discontinuity', () => {
    expect(sectorCloudGateOpacity(SECTOR_CLOUD_MIN_CAMDIST - 1)).toBe(0);
    expect(sectorCloudGateOpacity(SECTOR_CLOUD_MIN_CAMDIST)).toBe(0); // just entering
    expect(sectorCloudGateOpacity(60_000)).toBeGreaterThan(0.9);
    expect(sectorCloudGateOpacity(400_000)).toBeCloseTo(1, 5); // full mid-band
    expect(sectorCloudGateOpacity(SECTOR_CLOUD_MAX_CAMDIST)).toBe(0); // disc owns it
    expect(sectorCloudGateOpacity(SECTOR_CLOUD_MAX_CAMDIST + 1)).toBe(0);
  });

  it('stays within [0,1] across the whole zoom range', () => {
    for (let d = 0; d <= 1_500_000; d += 2_500) {
      const o = sectorCloudGateOpacity(d);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
  });
});

describe('Sector cloud — dominant light (brightest star)', () => {
  it('home sector picks Sirius (A-class, most luminous) at its native position', () => {
    const light = dominantLight(createHomeSector());
    const sirius = CURATED_SYSTEMS.find((s) => s.name === 'Sirius')!;
    const g = galPos(sirius);
    expect(light.nativePos.x).toBeCloseTo(g.x * PC_TO_NATIVE, 3);
    expect(light.nativePos.y).toBeCloseTo(g.y * PC_TO_NATIVE, 3);
    expect(light.nativePos.z).toBeCloseTo(g.z * PC_TO_NATIVE, 3);
    // A-class colour (0xcad7ff) is pale blue → blue channel the strongest.
    expect(light.color[2]).toBeGreaterThan(light.color[0]);
  });

  it('falls back to the sector centre when there are no curated systems', () => {
    const void3 = createSector(new Vector3(HOME_GAL_PC.x, HOME_GAL_PC.y + 12_000, HOME_GAL_PC.z));
    const light = dominantLight(void3);
    const centre = sectorCenterNativeWU(void3);
    expect(light.nativePos.distanceTo(centre)).toBeLessThan(1e-6);
  });
});
