# BUDGET.md — Legion

Frame and latency envelope for Legion. Companion to `RENDER.md` and `NORTHSTAR.md`. Doctrine: Workspace `realtime-render-performance` (60 FPS floor, uncapped default, latency co-equal).

## Targets

| Metric | Value |
|---|---|
| Floor | **60 FPS** (16.67 ms composite worst-frame) |
| Real in-browser planning budget | ~14–15 ms GPU after compositor / rAF overhead |
| Default present | Uncapped to display refresh (`rAF`) |
| Optional | User frame-cap setting (never hard-wire a silent 60 cap that blocks 120/144) |
| Stress (hero close-zoom) | Stretch goals documented in hero-body / planet docs (e.g. 90 FPS intent where named) — floor still 60 |

Judge **worst frame**, not average. One hitch under vsync is a fail even if mean is fine.

## Official pose URLs (perf)

From `docs/chunked-lod-60fps-plan.md` (Track 0). Device label required on every row. Prefer native Chrome on target hardware over headless/IDE browser for authoritative claims.

| Pose ID | URL |
|---|---|
| lab-0.8au | `?lab=planet&perfcapture&au=0.8&w=1280&h=720&dpr=2` |
| lab-continuum-0.8au | `?lab=planet&engine=continuum&perfcapture&au=0.8&w=1280&h=720&dpr=2` |
| lab-continuum-0.3au | `?lab=planet&engine=continuum&perfcapture&au=0.3&w=1280&h=720&dpr=2` |
| lab-continuum-approach | scripted 0.8→0.2 with perfcapture samples (see below) |
| star-0.8au | `?demo=star&perfcapture=composite&au=0.8&w=1280&h=720&dpr=2` |
| approach-low | `?demo=approach&perfcapture&w=1280&h=720&dpr=2` |

Optional: `&warmup=90&samples=120`. Results: `window.__perfCapture` + console JSON. Harness: `src/render/perf-capture.ts`.

Pass mode: `?perfcapture=passes` for per-EffectComposer-pass attribution.

### Continuum approach budget gate (Task 8)

**Settled poses:** export `window.__perfCapture` JSON from `lab-continuum-0.8au` and `lab-continuum-0.3au` after warmup. Pass when worst composite ≤ **16.67 ms** on declared hardware.

**Approach path (`lab-continuum-approach`):** native Chrome, `?lab=planet&engine=continuum&w=1280&h=720&dpr=2` (no `&au=` lock). Start at HUD **0.8 AU**, zoom smoothly to **0.2 AU** over ~10 s. During zoom:

- Watch chunk HUD (`coverAgeMs`, `coverPending`) — stream cover should clear within `APPROACH_COVER_SLA_SEC` (see continuum chunk pool)
- Log hitch frames (Δt spikes); one origin-shift / LOD spike OK, sustained multi-second freeze fails
- At **0.8 AU settled**, **0.3 AU settled**, and **0.2 AU settled**, re-open with `&perfcapture&au=<stop>` and paste JSON for toolkit `frame_budget`

Motion evidence: record `approach-surface` (see [`docs/render-acceptance-harness.md`](docs/render-acceptance-harness.md#continuum-budget-verification-pack)) → `temporal_delta` / `motion_stress`.

**Author capture (2026-08-06):** JSON at `refs/continuum/perf/lab-continuum-0.8au.json` and `lab-continuum-0.3au.json`. Judge the `worst` row `gpuMedianMs` (do not sum `worst`+`baked`+`noplanet` — those are alternate phases). Measured: **0.8 AU 15.139 ms PASS**; **0.3 AU 32.032 ms FAIL** (clouds/atmos attribution ~26 ms). Toolkit reports under `refs/continuum/qa/`. Approach scripted JSON still pending. Harness: [`docs/render-acceptance-harness.md`](docs/render-acceptance-harness.md#continuum-budget-verification-pack).

## Flythrough budget

Along paths in `RENDER.md` (`orbit-0.8au`, `approach-surface`, `look-orient`):

- Worst composite ms along the path must hold the floor on the declared device class
- Log hitch frames (Δt spikes) separately from mean
- Origin-shift / LOD rebuild frames may spike once; repeated spikes fail

## Capture method

1. `render-qa-toolkit` `frame_budget` / `pass_attribution` on exported `__perfCapture` JSON  
2. Motion: record path → `video_extract` → `temporal_delta` / `motion_stress`  
3. Stills: native PNG → `native_grid` → tile assess  

Config: Workspace `03-skills/render-qa-toolkit/configs/legion.yaml`

## Hardware class under test

Record per session, e.g. `MBP M-series · Chrome · 1280×720@dpr2`. IDE-browser rows are trend-only.
