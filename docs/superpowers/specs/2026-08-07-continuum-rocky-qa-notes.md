# Continuum rocky archetype QA (2026-08-07)

Default Continuum rocky guidepost (`lab-ideal.json` + `PRESETS.rocky` / exemplar seed 1001).

## Pass 2 (post lab-sun hide + dusty atmos)

Capture:

```bash
npm run accept:continuum -- --only stills --type rocky --base http://127.0.0.1:5175 --skip-qa --headless true
```

Artifacts: `refs/continuum/stills/continuum-rocky-*.png`

### Defaults now

| Knob | Value | Notes |
|---|---|---|
| Exemplar | super-earth, au 1.6, R=1.4 Re, insolation 0.4 | Cold-ish rocky |
| `seaLevel` | 0 | No ocean path |
| `hasAtmosphere` | **true** | Thin dusty limb |
| `atmosphereDensity` | 0.38 | Warm dust tint |
| Atmos color | warm dust / ochre | `blueBias` keeps graze warm (not ocean violet) |
| `cloudCover` | 0.08 | Thin wisps |
| Displacement / ridged | 0.045 / 0.6 | Strong relief |
| Night lights | 0 | Expected dark night |

### Numbers (pass 2)

| Pose | medianTex | Center mean | Notes |
|---|---|---|---|
| 0.8 day | 160 | ~175 | Lab-sun gone; warm dusty disc + thin limb |
| 0.8 night | 160 | ~36 | Day/night still separated |
| 0.8 day noclouds | 160 | ~175 | Ochre patches read; no cream disc step |
| 0.3 surface | **96** | ~119 | F6 floor held; warmer RGB than pass 1 |
| 0.6 clouds (terminator) | 96 | ~23 | Side-light; seams still visible |

### Pass 2 verdict

1. **Lab-sun hide — fixed.** Accept path sets `labSun.visible = false` (`?accept` + `setLabPropsVisible`). Day rings no longer show the cream concentric mesh (smooth lighting falloff only).
2. **Thin dusty atmos — landed.** Warm limb graze present on day / noclouds; night rim still subtle.
3. **Identity improved.** Ochre/umber patches vs pass-1 lunar gray; still pale under front light.
4. **Remaining (addressed in pass 3):** terminator cube seams / faceted limb; relief isoline banding.

### Pass 3 — land seams / relief (same class as ocean, sea-gated fixes skipped rocky)

Screenshot @ ~0.5 AU showed contour-ring relief, hard rectangular LOD tiles, faceted terminator, flat atmos band. Ocean F1–F10 sea/coast paths do not help `seaLevel: 0`.

| Fix | Where |
|---|---|
| Soft-cap macro relief bake + higher lap thresholds | `chunk-sample.ts` `applyMacroReliefShading` |
| Corner-shared chunk UVs (`ix/(N-1)`) | `chunk-sample.ts` bake loop |
| Feather chunk albedo borders (polish / ≥48²) | `chunk-sample.ts` `featherChunkBorder` |
| Land radial normal blend at mid/orbit | `shaders.ts` `landSoft` |
| Rocky albedo from mostly-macro elev | `climate-provider.ts` |
| Rocky `normalStrength` 0.22 → 0.10 | `plates.ts` + `lab-ideal.json` |
| Softer ridged/displacement | `presets.ts` / `lab-ideal.json` |
| Atmos icosa detail 6 → 7 | `continuum/index.ts` |

Still open: mixed-LOD neighbor mismatch during polish climb; residual cube-edge lighting; close-AU land AA.

### Ocean fix checklist vs rocky (pass 2)

| Ocean item | Rocky status |
|---|---|
| F2 Rayleigh limb | **Pass** (warm dust, blueBias-gated) |
| F3 night pose | **Pass** |
| F6 close tex ≥96 | **Pass** |
| F9 chrome + lab-sun | **Pass** |
| F8 side-light microrelief | Partial — use terminator as look pose |
| Cube seams / faceted limb | Open |

## Harness (unified)

- `scripts/legion-accept.mjs` — planet archetypes (`--type`) + review demos (`--demo` / `--lab star|blackhole|nebula` → demos until labs ship)
- Shortcut: `npm run accept:continuum` · demos: `npm run accept:demos` · all types: `npm run accept:archetypes`
- Playwright: `PLAYWRIGHT_BROWSERS_PATH=0` (local `node_modules` browsers); Chromium fallback when system Chrome missing

## Pass 1 (baseline, superseded)

Defaults were `hasAtmosphere: false`, `cloudCover: 0.15`. Day stills blocked by lab-sun cream disc on view-aligned sun. See git history of this file / earlier stills if needed.
