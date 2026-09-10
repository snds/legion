import { describe, expect, it } from 'vitest';
import { GLSL_CLOUDS } from './glsl';

// P2-6: the shipping-path (Legacy engine, `?lab=planet` default / `?demo=planet`)
// lightning flash used to fire from TWO mechanisms — cyclone eyewalls (storm-
// gated, fine) and a periodic low-frequency "storm belt" (fbm region mask)
// that was NOT tied to any cyclone position, i.e. the exact "whole-region
// flashes together" bug the NORTHSTAR hold names. Continuum (engine C) got
// the storm-gate fix in commit f833d6d; this Legacy path (`glsl.ts`) never
// did — Audit A4 §3 confirmed it via `git show --stat f833d6d`. This test
// locks the port: the belt/region mechanism is gone, and the same
// stormW / floor(d*28.0) cell-grid gating pattern from
// continuum/shaders.ts:507-526 is present here instead.
describe('glsl.ts GLSL_CLOUDS lightning storm-gate (P2-6)', () => {
  it('lightning flash is storm-gated (no position-independent whole-region belt)', () => {
    expect(GLSL_CLOUDS).not.toContain('float belt = smoothstep');
    expect(GLSL_CLOUDS).not.toContain('float region = fbm(d * 2.2');
  });

  it('lightning flash uses the same stormW / cell-grid pattern ported from continuum', () => {
    expect(GLSL_CLOUDS).toContain('float stormW = 0.0;');
    expect(GLSL_CLOUDS).toContain('floor(d * 28.0)');
    expect(GLSL_CLOUDS).toContain('clamp(stormW * 2.5, 0.0, 1.0)');
  });

  it('flash strobe is still gated by real cyclone position/strength uniforms', () => {
    expect(GLSL_CLOUDS).toContain('uCycPos[i]');
    expect(GLSL_CLOUDS).toContain('uCycStr[i]');
    expect(GLSL_CLOUDS).toContain('uCycSize');
  });
});
