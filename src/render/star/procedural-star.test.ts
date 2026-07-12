import { describe, it, expect } from 'vitest';
import { Mesh, PerspectiveCamera, ShaderMaterial } from 'three';
import { createProceduralStar } from './procedural-star';
import { granulationAmp, type StarRecord } from './star-physics';

const M_DWARF: StarRecord = {
  tempK: 3200, radiusSolar: 0.3, luminositySolar: 0.02, activity: 0.9,
  spectralType: 'M', seed: 12345,
};
const OB_STAR: StarRecord = {
  tempK: 30000, radiusSolar: 8, luminositySolar: 20000, activity: 0.03,
  spectralType: 'O', seed: 777,
};

function surfaceUniforms(group: { traverse: (cb: (o: unknown) => void) => void }): Record<string, { value: unknown }> {
  let uniforms: Record<string, { value: unknown }> | null = null;
  group.traverse((o) => {
    const m = (o as Mesh).material;
    if (m instanceof ShaderMaterial && m.uniforms.uTempK) uniforms = m.uniforms;
  });
  if (!uniforms) throw new Error('surface material not found');
  return uniforms;
}

describe('createProceduralStar — headless construction', () => {
  it('exposes every required uniform, driven by the record', () => {
    const star = createProceduralStar({ record: M_DWARF, bodyRadiusWU: 0.6 });
    const u = surfaceUniforms(star.group);
    for (const key of [
      'uTempK', 'uRadius', 'uLuminosity', 'uGranulationAmp', 'uSpotCount',
      'uActivity', 'uRotation', 'uDifferential', 'uTime',
    ]) {
      expect(u[key], key).toBeDefined();
    }
    expect(u.uTempK.value).toBe(3200);
    expect(u.uActivity.value).toBe(0.9);
    expect(u.uGranulationAmp.value).toBeCloseTo(granulationAmp(M_DWARF), 5);
    star.dispose();
  });

  it('O/B stars build with ≈0 granulation + no active regions; active M dwarfs get both', () => {
    const ob = createProceduralStar({ record: OB_STAR, bodyRadiusWU: 2 });
    const uob = surfaceUniforms(ob.group);
    expect(uob.uGranulationAmp.value as number).toBeLessThan(0.05);

    // Active-region field children (coronal loops + CME) — present only when the
    // star has magnetic activity to erupt.
    const regions = (g: { getObjectByName: (n: string) => unknown }): number => {
      const node = g.getObjectByName('star-active-regions') as { children: unknown[] } | null;
      return node ? node.children.length : 0;
    };
    expect(regions(ob.group)).toBe(0);              // O/B: quiet, no loops/flares
    expect((surfaceUniforms(ob.group).uSpotCount.value as number)).toBe(0);

    const m = createProceduralStar({ record: M_DWARF, bodyRadiusWU: 0.6 });
    expect(regions(m.group)).toBeGreaterThan(0);    // active M: loops + CME present
    expect((surfaceUniforms(m.group).uSpotCount.value as number)).toBeGreaterThan(0);
    ob.dispose();
    m.dispose();
  });

  it('update() advances time + LOD-fades detail with distance', () => {
    const star = createProceduralStar({ record: M_DWARF, bodyRadiusWU: 0.6 });
    const u = surfaceUniforms(star.group);
    const cam = new PerspectiveCamera();

    star.update(0.016, cam, 0.02);       // very close
    const near = u.uDetailFade.value as number;
    star.update(0.016, cam, 5000);        // pulled way back
    const far = u.uDetailFade.value as number;

    expect(u.uTime.value as number).toBeGreaterThan(0);
    expect(near).toBeGreaterThanOrEqual(far);
    expect(far).toBeGreaterThanOrEqual(0);
    expect(near).toBeLessThanOrEqual(1);
    star.dispose();
  });

  it('setRecord re-points uniforms without rebuilding', () => {
    const star = createProceduralStar({ record: M_DWARF, bodyRadiusWU: 0.6 });
    const u = surfaceUniforms(star.group);
    star.setRecord(OB_STAR);
    expect(u.uTempK.value).toBe(30000);
    expect(u.uGranulationAmp.value as number).toBeLessThan(0.05);
    star.dispose();
  });
});
