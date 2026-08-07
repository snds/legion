# Continuum Aesthetic Phase 1 (A0+A1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Continuum land color (moisture/biome response) and orbit material lighting (ocean glint, darker night, less chalky ambient) so lab stills match Legacy Whittaker intent and SE-style disc cues.

**Architecture:** Fix CPU climate cover to match Legacy `shaders.ts` (temperature treeline + moisture bare-rock gate; climate lapse from `macroHeight`). Improve Continuum surface fragment lighting without remeshing topology.

**Tech Stack:** TypeScript, Vitest, Three.js GLSL string shaders in `continuum/shaders.ts`.

## Global Constraints

- Continuum lab only; do not change shipping Legacy default.
- 60 fps / existing build budgets stay intact (A0/A1 are bake + shader only).
- Climate thresholds must use continuous macro height (hex-seam lesson).
- No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-02-continuum-aesthetic-pipeline-design.md` §6 Track A0–A1.

---

### Task 1: Climate cover parity + macro elev for lapse

**Files:**
- Modify: `src/render/planet/generators/climate-provider.ts`
- Modify: `src/render/planet/generators/types.ts` (ClimateProvider.sample signature)
- Modify: `src/render/planet/generators/index.ts` (`sampleSurface` passes macroHeight)
- Test: `src/render/planet/generators/generators.test.ts`

**Interfaces:**
- Consumes: `PlateTectonicsProvider.macroHeight(dir)`, `PlanetRenderParams.treeline|moisture|lushDepth`
- Produces: `ClimateProvider.sample(dir, height, climateElev?)` with Legacy-equivalent cover

- [x] **Step 1: Write failing tests for moisture→green and cover formula**

Add to `generators.test.ts`:

```ts
  it('moist equatorial land is greener than arid (biome cover responds)', () => {
    const b = createGeneratorBundle(ocean);
    const wet = { ...b.params, moisture: 1.2, lushDepth: 1.2, aridBelts: 0.2, snowfall: 0.2 };
    const dry = { ...b.params, moisture: 0.05, lushDepth: 0.2, aridBelts: 1.2, snowfall: 0.2 };
    b.refreshParams(wet, b.macro);
    const sw = sampleSurface(b, [1, 0.08, 0]);
    b.refreshParams(dry, b.macro);
    const sd = sampleSurface(b, [1, 0.08, 0]);
    if (!sw.sea && !sd.sea) {
      // Wet biomes are darker / greener (lower R, higher G relative) than arid sand
      expect(sw.color[1]).toBeGreaterThan(sw.color[0] * 0.85);
      expect(sd.color[0]).toBeGreaterThan(sd.color[1] * 0.9);
      const wetMax = Math.max(...sw.color);
      const dryMax = Math.max(...sd.color);
      expect(wetMax).toBeLessThan(dryMax + 0.05); // wet not chalk-white
    }
  });

  it('default ocean land is not chalk-pale at mid latitudes', () => {
    const b = createGeneratorBundle(ocean);
    const dirs: [number, number, number][] = [
      [1, 0.2, 0], [0.7, 0.3, 0.5], [0.2, 0.15, 0.9],
    ];
    let landSamples = 0;
    let pale = 0;
    for (const d of dirs) {
      const len = Math.hypot(d[0], d[1], d[2]);
      const s = sampleSurface(b, [d[0] / len, d[1] / len, d[2] / len]);
      if (s.sea) continue;
      landSamples++;
      const maxC = Math.max(s.color[0], s.color[1], s.color[2]);
      if (maxC > 0.72) pale++;
    }
    expect(landSamples).toBeGreaterThan(0);
    expect(pale).toBe(0);
  });
```

- [x] **Step 2: Run tests — expect failure on pale/green assertions**

Run: `npx vitest run src/render/planet/generators/generators.test.ts`
Expected: at least one new assertion FAIL

- [x] **Step 3: Implement Legacy cover + climateElev**

In `types.ts`, change:

```ts
  sample(
    dir: Vec3,
    height: number,
    /** Continuous elev for lapse/moisture (plate macro). Defaults to height. */
    climateElev?: number,
  ): Pick<SurfaceSample, 'temp' | 'moisture' | 'ice' | 'habit' | 'color' | 'sea'>;
```

In `index.ts` `sampleSurface`:

```ts
  let h = bundle.plates.terrainHeight(dir);
  h = Math.max(0, Math.min(1, h + bundle.authoring.heightDelta(dir, chunkKey)));
  const elev = bundle.plates.macroHeight(dir);
  const c = bundle.climate.sample(dir, h, elev);
  return { height: h, ...c };
```

In `climate-provider.ts` land branch, replace elevation `belowTree` gate with Legacy formula; use `climateElev` for temp/moist altitude:

```ts
      const elevRaw = climateElev ?? height;
      const elevHh = p.seaLevel > 0
        ? clamp01((elevRaw - p.seaLevel) / Math.max(1e-3, 1 - p.seaLevel))
        : elevRaw;
      // temp/moist use elevHh; ramp/sea still use hh from height
```

Cover (match `shaders.ts:239-240`):

```ts
        function smoothstep(e0: number, e1: number, x: number): number {
          const t = clamp01((x - e0) / Math.max(1e-6, e1 - e0));
          return t * t * (3 - 2 * t);
        }
        const cover = smoothstep(p.treeline - 0.06, p.treeline + 0.10, temp)
          * (0.35 + 0.65 * smoothstep(0.05, 0.35, moist));
        color = mixRgb(color, biomeColor(temp, moist), cover * p.lushDepth);
```

Use `elevHh` in temp lapse and moisture altitude/orographic terms instead of `hh`.

- [x] **Step 4: Run generators tests — expect PASS**

Run: `npx vitest run src/render/planet/generators/generators.test.ts`

- [ ] **Step 5: Commit** (only if user asked — skip unless requested)

---

### Task 2: Continuum surface materials (ocean glint + lighting ratios)

**Files:**
- Modify: `src/render/planet/continuum/shaders.ts` (`continuumSurfaceFrag`)
- Test: visual lab still OR extend `chunk.test.ts` if uniform wiring needed — shader string change is verified by typecheck + lab

**Interfaces:**
- Consumes: existing `uRoughness`, `uNightLights`, sea from albedo alpha
- Produces: lower ambient wrap; stronger ocean Fresnel specular; darker night

- [x] **Step 1: Adjust fragment lighting**

Replace wrap and sea/land lighting block approximately:

```glsl
    float wrap = ndl * 0.88 + 0.10;  // was 0.72/0.28 — chalk ambient

    // ... albedo sample unchanged ...

    vec3 lit = albedo * wrap;

    if (sea > 0.5) {
      vec3 V = normalize(cameraPosition - vWorldPos);
      vec3 H = normalize(L + V);
      float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
      float gloss = mix(55.0, 14.0, clamp(uRoughness, 0.0, 1.0));
      float spec = pow(max(dot(N, H), 0.0), gloss) * (1.0 - uRoughness * 0.65);
      lit = mix(lit, lit * vec3(0.82, 0.90, 1.05), 0.22);
      lit += vec3(0.65, 0.75, 0.88) * spec * (0.35 + 0.65 * fres) * ndl;
    } else {
      float rim = pow(1.0 - max(dot(N, normalize(cameraPosition - vWorldPos)), 0.0), 3.0);
      lit += albedo * rim * 0.05;
      float night = pow(1.0 - clamp(ndl, 0.0, 1.0), 2.4);
      lit += vec3(1.0, 0.78, 0.48) * night * uNightLights * 0.28 * (1.0 - snowish);
      // Soften micro brightening on land so biomes stay readable
      // (keep existing micro/meso but they already applied to albedo)
    }
```

Also tone down land albedo micro lift slightly if still chalky:

```glsl
    } else {
      albedo *= mix(0.92 + 0.08 * micro, 0.97 + 0.02 * meso, snowish);
      albedo = mix(albedo, albedo * vec3(1.03, 1.01, 0.96), 0.10 * (meso - 0.45) * (1.0 - snowish));
    }
```

- [x] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (or project’s `npm run build` typecheck step)

- [ ] **Step 3: Manual lab check**

Open: `?lab=planet&engine=continuum&au=0.8`  
Expect: greener continents with moisture up; ocean sun glint; darker night side; not chalk-beige.

---

### Task 3: Plan coverage note (later phases)

Remaining spec tracks A2–A4, B1–B4, C1–C5 get a follow-up plan after A0+A1 stills pass. Do not implement in this plan.

---

## Spec coverage (Phase 1)

| Spec item | Task |
|-----------|------|
| A0 color / biome / treeline | Task 1 |
| A0 analytic elev for climate | Task 1 (`macroHeight`) |
| A1 ocean specular + lighting ratios | Task 2 |
| A2+ later | Deferred |
