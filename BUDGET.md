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
| star-0.8au | `?demo=star&perfcapture=composite&au=0.8&w=1280&h=720&dpr=2` |
| approach-low | `?demo=approach&perfcapture&w=1280&h=720&dpr=2` |

Optional: `&warmup=90&samples=120`. Results: `window.__perfCapture` + console JSON. Harness: `src/render/perf-capture.ts`.

Pass mode: `?perfcapture=passes` for per-EffectComposer-pass attribution.

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
