import { describe, expect, it } from 'vitest';
import {
  continuumAtmosFrag,
  continuumCloudShellFrag,
  continuumSurfaceFrag,
} from './shaders';

describe('continuum C1/C2/C5 shader contract', () => {
  it('C1 uses sun-dominant wrap (not chalk ambient)', () => {
    expect(continuumSurfaceFrag).toContain('ndl * 0.94 + 0.028');
    expect(continuumSurfaceFrag).toContain('smoothstep(-0.06, 0.14');
  });

  it('C2 emits HDR specular / limb peaks for AgX bloom', () => {
    expect(continuumSurfaceFrag).toContain('* 1.55');
    expect(continuumAtmosFrag).toContain('sunHorizon * 2.2');
  });

  it('C5 applies coast / limb fwidth AA', () => {
    expect(continuumSurfaceFrag).toContain('fwidth(sea)');
    expect(continuumAtmosFrag).toContain('fwidth(a)');
  });

  it('gates fragment micro-detail away from orbit (anti-mottling)', () => {
    expect(continuumSurfaceFrag).toContain('detailAmt');
    expect(continuumSurfaceFrag).toContain('Rgate * 0.22');
  });

  it('atmos rim uses abs(ndv) so BackSide does not fill the disk', () => {
    expect(continuumAtmosFrag).toContain('abs(dot(N, V))');
  });

  it('aerial haze gates out at orbit distances', () => {
    expect(continuumSurfaceFrag).toContain('nearAir');
    expect(continuumSurfaceFrag).toContain('R * 2.4');
  });

  it('blends ocean normals toward radial (anti-facet specular)', () => {
    expect(continuumSurfaceFrag).toContain('vNrad');
    expect(continuumSurfaceFrag).toContain('mix(Nmesh, Nrad, seaW)');
  });

  it('night side gets atmospheric scatter fill', () => {
    expect(continuumSurfaceFrag).toContain('skyFill');
    expect(continuumSurfaceFrag).toContain('antiSun');
  });

  it('cloud shell uses day-gated lighting (not half-Lambert glow)', () => {
    expect(continuumCloudShellFrag).toContain('smoothstep(-0.08, 0.16, ndl)');
    expect(continuumCloudShellFrag).not.toContain('* 0.5 + 0.5');
  });

  it('cloud lightning is storm-gated (no dens-seeded whole-deck flash)', () => {
    // Regression: dens in the strobe hash made every cloud core flicker.
    expect(continuumCloudShellFrag).not.toContain('uTime * 17.3 + dens');
    expect(continuumCloudShellFrag).toContain('stormW');
    expect(continuumCloudShellFrag).toContain('floor(d * 28.0)');
  });

  it('F1: cloud advection stays a continuous spherical-direction rotation (no cube/UV sampling)', () => {
    // The cloud field must be a function of the normalized object-space direction
    // only — never a cube-face UV or per-chunk coordinate — so it is seamless
    // across the whole sphere including poles and face boundaries.
    expect(continuumSurfaceFrag).toContain('float continuumCloudDens(vec3 d0)');
    expect(continuumSurfaceFrag).toContain('vec3 d = normalize(d0);');
    expect(continuumCloudShellFrag).toContain('vec3 d = normalize(vObj);');
    // Forbid feeding chunk/face UV into the shared cloud field (cube-face bleed).
    expect(continuumSurfaceFrag).not.toContain('continuumCloudDens(vUv');
  });

  it('F1: zonal differential shear is time-bounded (no frozen V/chevron seam)', () => {
    // Regression: a constant (non-time-gated) per-latitude shear offset froze a
    // mirrored V/chevron into the facing hemisphere (continuum-0.8-day.png,
    // approach-surface motion). Bounding it with sin(time) — matching the
    // Legacy pattern in glsl.ts GLSL_CLOUDS / weather-provider.ts — gates the
    // shear to zero at the default lab pose (uTime = 0) instead of baking a
    // permanent fold into the deck.
    expect(continuumSurfaceFrag).toContain(
      'float adv = uCloudTime * 0.02 * flow + zonal * 0.35 * flow * sin(uCloudTime * 0.0044);',
    );
    expect(continuumCloudShellFrag).toContain(
      'float adv = uTime * 0.02 * flow + zonal * 0.35 * flow * sin(uTime * 0.0044);',
    );
  });
});
