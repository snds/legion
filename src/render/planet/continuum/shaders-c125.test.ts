import { describe, expect, it } from 'vitest';
import {
  continuumAtmosFrag,
  continuumCloudShellFrag,
  continuumSurfaceFrag,
} from './shaders';
import { PRESETS } from '../presets';

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

  it('F2: sun-horizon glow is keyed off the terminator (surface N vs L), not view direction', () => {
    // Regression: `pow(clamp(dot(V, L), 0, 1), 8) * soft` used the camera-to-
    // fragment direction, which barely varies across the whole visible disc at
    // orbit/space distances — so the warm mie term saturated the *entire* rim
    // (not a graze) whenever the sun was roughly behind the camera. Combined
    // with the un-tonemapped HDR boost, that clipped every channel flat to
    // white — the reported hard white/cream limb. The glow must instead be a
    // function of the surface point's own position relative to the day/night
    // terminator (ndl = dot(N, L) ~ 0).
    expect(continuumAtmosFrag).toContain('float ndl = dot(N, L);');
    expect(continuumAtmosFrag).toContain('float terminator = 1.0 - smoothstep(0.0, 0.22, abs(ndl));');
    expect(continuumAtmosFrag).toContain('float sunHorizon = terminator * soft;');
    expect(continuumAtmosFrag).not.toContain('dot(V, L)');
  });

  it('F2: day limb defaults to Rayleigh cyan/blue, not full mie wash', () => {
    // Away from the terminator (sunHorizon ~ 0), col must resolve to the
    // rayleigh mix — never fully to the warm `mie` constant — so the general
    // day-side graze reads as thin cyan/blue instead of hard white/cream.
    expect(continuumAtmosFrag).toContain('vec3 rayleigh = mix(uColor, vec3(0.35, 0.55, 0.95), 0.35);');
    expect(continuumAtmosFrag).toContain('vec3 mie = vec3(1.0, 0.72, 0.42);');
    expect(continuumAtmosFrag).toContain('vec3 col = mix(rayleigh, mie, clamp(sunHorizon * 1.4, 0.0, 0.85));');
  });

  it('F2: night-side rim keeps a non-zero alpha floor (readable, not chalk/blank)', () => {
    // sunFacing floors at 0 on the night side of the ring; alpha must still
    // carry a base term (0.35) so the rim doesn't vanish before F3 wires real
    // night posing/energy.
    expect(continuumAtmosFrag).toContain('(0.35 + 0.65 * sunFacing)');
  });

  it('F4: ground-shadow cloud field keeps its own (lower) coverage threshold, decoupled from the shell', () => {
    // The ground-shadow field (continuumCloudDens) has no turb/region terms,
    // so it sits fainter than the shell at the same uCloudCover. Once F4
    // lowered the Terran cover to fix the shell whiteout, the shadow term
    // needed its own threshold offset (0.25, not the shell's 0.14) or it
    // would go invisible. Assert the two curves are NOT sharing one constant.
    expect(continuumSurfaceFrag).toContain('float t = clamp((f - (c0 - 0.25)) / 0.28, 0.0, 1.0);');
    expect(continuumCloudShellFrag).toContain('float t = clamp((f - (c0 - 0.14)) / 0.28, 0.0, 1.0);');
  });

  it('F4: cloud shell keeps a real day-gated alpha ceiling below fully opaque (breaks stay readable)', () => {
    // a = dens * mix(0.32, 0.72, day): even at dens=1 the day-side shell
    // tops out at 0.72 alpha, so a single overcast patch never fully hides
    // the surface underneath (P-LOOK ice-ball regression guard).
    expect(continuumCloudShellFrag).toContain('float a = dens * mix(0.32, 0.72, day);');
  });

  it('F4: Terran/ocean archetype default cover+shadow match the calibrated Continuum values', () => {
    expect(PRESETS.ocean.cloudCover).toBeCloseTo(0.22, 5);
    expect(PRESETS.ocean.cloudShadow).toBeCloseTo(0.75, 5);
  });

  it('F5: cloud shell applies a day-gated thickness/self-shadow cue (cheap, no raymarch)', () => {
    expect(continuumCloudShellFrag).toContain('float pathLen = 1.0 / max(ndl, 0.18);');
    expect(continuumCloudShellFrag).toContain(
      'float thickness = clamp(dens * pathLen * 0.55, 0.0, 1.0);',
    );
    expect(continuumCloudShellFrag).toContain('col *= 1.0 - 0.4 * thickness * day;');
  });

  it('F5: thickness cue is multiplied by `day` so night clouds stay silhouette-thin', () => {
    // Regression guard: the darkening term must carry the day factor itself
    // (not just rely on col already being dark at night) so it never perturbs
    // the night silhouette-thin alpha/color path independently.
    const cueLine = 'col *= 1.0 - 0.4 * thickness * day;';
    expect(continuumCloudShellFrag).toContain(cueLine);
    const idx = continuumCloudShellFrag.indexOf(cueLine);
    expect(idx).toBeGreaterThan(continuumCloudShellFrag.indexOf('float day = smoothstep'));
  });

  it('F5: thickness cue does not disturb F1 shear bound or storm lightning gating', () => {
    expect(continuumCloudShellFrag).toContain(
      'float adv = uTime * 0.02 * flow + zonal * 0.35 * flow * sin(uTime * 0.0044);',
    );
    expect(continuumCloudShellFrag).toContain('stormW');
    expect(continuumCloudShellFrag).not.toContain('uTime * 17.3 + dens');
  });

  it('F8: land gets a side-light microrelief/material cue peaking at grazing (not front) sun', () => {
    // Parabola in ndl: 0 at full front (ndl=1) and at terminator/night (ndl=0),
    // peak at ndl=0.5 — reads as raking-light bump/biome contrast, never a
    // uniform (sun-angle-independent) tint.
    expect(continuumSurfaceFrag).toContain('float sideLight = 4.0 * ndl * (1.0 - ndl);');
    expect(continuumSurfaceFrag).toContain(
      'albedo *= 1.0 + (0.10 * (micro - 0.5) + 0.07 * (meso - 0.5)) * sideLight * (1.0 - snowish) * detailAmt;',
    );
  });

  it('F8: side-light cue lives in the land branch only (ocean path untouched)', () => {
    // Regression guard: the cue must sit after the land-only landVar/tint block
    // and before that branch's closing brace, never inside the seaW>0.5 branch,
    // so C5/C7 ocean glint + coast AA stay byte-identical.
    const landBranch = continuumSurfaceFrag.slice(
      continuumSurfaceFrag.indexOf('} else {'),
      continuumSurfaceFrag.indexOf('if (uDebugChunks > 0.5)'),
    );
    expect(landBranch).toContain('float sideLight = 4.0 * ndl * (1.0 - ndl);');
    expect(continuumSurfaceFrag.indexOf('oceanVar')).toBeLessThan(
      continuumSurfaceFrag.indexOf('float sideLight = 4.0 * ndl'),
    );
  });

  it('F8: microrelief cue cannot fire at night (gated to zero as ndl clamps to 0)', () => {
    // ndl is already max(dot(N,L),0) upstream, so at night sideLight=4*0*1=0 —
    // no separate night guard needed. Lock that ndl (not a raw/unclamped dot)
    // feeds the parabola.
    expect(continuumSurfaceFrag).toContain('float ndl = max(dot(N, L), 0.0);');
  });
});
