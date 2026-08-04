# Render acceptance harness (Workspace #12)

Legion is the **test platform** for Workspace realtime photoreal rigor. Skills live in Workspace; this doc records how to run the triple done-gate against Legion.

## Contracts (this repo)

| File | Role |
|---|---|
| [`RENDER.md`](../RENDER.md) | Look doctrine + official interaction paths |
| [`BUDGET.md`](../BUDGET.md) | 60fps floor + `?perfcapture` poses |
| [`NORTHSTAR.md`](../NORTHSTAR.md) | Movie / SpaceEngine / signed baselines |

## Workspace load chain

1. Framework `#12` + `#10` + `#11`
2. `realtime-visual-craft` (`init` / `shape` / `flythrough` / `audit` / `budget` / `match` / `harden`)
3. `render-qa-toolkit` + `interactive-capture-eval` + `native-visual-eval`
4. `visual-qa-photoreal-rendering` and/or `rendering-guild` for judgment
5. `adapter-webgpu-three` for Three/WebGPU gotchas

**Conflict guard:** Cursor plugin marketing-3D Three.js skills are API lookup only when this spine is loaded.

## Smoke (measurement toolkit)

From Workspace:

```bash
cd ~/Projects/Workspace/03-skills/render-qa-toolkit
pip install -r requirements.txt
# fixtures + suite already smoke-tested with synthetic perfcapture / stills / frames
python qa-suite.py --config configs/legion.yaml --output ./_qa-out \
  --perf path/to/__perfCapture.json \
  --image path/to/native-beauty.png \
  --reference path/to/northstar.png \
  --frames path/to/extracted-frames \
  --only frame_budget,pass_attribution,native_grid,histogram_hdr,reference_match,temporal_delta
```

## Full acceptance pass (per change)

1. **Budget** — open official pose URL from `BUDGET.md`, paste `window.__perfCapture` → `frame_budget` / `pass_attribution`  
2. **Still** — lossless native PNG of final composer frame → `native_grid` → Read tiles (#10)  
3. **Motion** — record path from `RENDER.md` → `video_extract` → `temporal_delta` / `motion_stress` → frame-by-frame vs `NORTHSTAR.md`  
4. **Guild / photoreal QA** — close only when still + motion + ms all pass  
5. **Ledger** — any new failure mode → Workspace `visual-failure-mode-ledger.md` (technique-keyed)

## Continuum look verification pack

Capture in native Chrome at 1920×1080, DPR 1, as lossless PNG. The query strings below are the official
pose URLs; where the brief names a viewing condition rather than a query parameter, set that condition
manually before capture. IDE-browser images are locators only and cannot sign this pack.

| Pose ID | URL | Required view | Intended capture |
|---|---|---|---|
| `continuum-0.8-day` | `?lab=planet&engine=continuum&au=0.8&w=1920&h=1080&dpr=1` | Day-facing disc | `refs/continuum/stills/continuum-0.8-day.png` |
| `continuum-0.8-night` | `?lab=planet&engine=continuum&au=0.8&w=1920&h=1080&dpr=1` | Rotate the night side into view | `refs/continuum/stills/continuum-0.8-night.png` |
| `continuum-0.3-coast` | `?lab=planet&engine=continuum&au=0.3&w=1920&h=1080&dpr=1` | Face a coast; wait 5 seconds after settling | `refs/continuum/stills/continuum-0.3-coast.png` |
| `continuum-0.6-clouds` | `?lab=planet&engine=continuum&au=0.6&w=1920&h=1080&dpr=1` | Clouds on; terminator across the disc | `refs/continuum/stills/continuum-0.6-clouds.png` |

Score every pose against `se-planet` on a 0–4 scale for: atmosphere limb, terminator, cloud night,
ocean-glint continuity, coast anti-aliasing, bathymetry hide, and night fill. A score of 0 or 1 on any
dimension fails the pose. Record evidence and scores only after native tile review; do not fabricate
scores from locator captures.

| Motion path | Required capture | Intended store | Required review |
|---|---|---|---|
| `approach-surface` | Native/lossless far-to-low-orbit approach | `refs/continuum/motion/approach-surface/` | Flag hitch frames and LOD pops |
| `orbit-0.8au` | Native/lossless 10–20 s orbit at 0.8 AU | `refs/continuum/motion/orbit-0.8au/` | Extract 1 fps plus dense lighting-change frames |
| `look-orient` | Native/lossless pitch, yaw, and roll at fixed distance | `refs/continuum/motion/look-orient/` | Flag temporal crawl, cascade swim, and dither crawl |

### Author capture commands

After saving the PNGs and native/lossless recordings to the paths above, run:

```bash
cd ~/Projects/workspace/03-skills/render-qa-toolkit
python3 qa-suite.py --image ~/Projects/Legion/refs/continuum/stills/continuum-0.8-day.png --config configs/legion.yaml --output ~/Projects/Legion/refs/continuum/qa/continuum-0.8-day --only native_grid,histogram_hdr --labeled-native
python3 qa-suite.py --image ~/Projects/Legion/refs/continuum/stills/continuum-0.8-night.png --config configs/legion.yaml --output ~/Projects/Legion/refs/continuum/qa/continuum-0.8-night --only native_grid,histogram_hdr --labeled-native
python3 qa-suite.py --image ~/Projects/Legion/refs/continuum/stills/continuum-0.3-coast.png --config configs/legion.yaml --output ~/Projects/Legion/refs/continuum/qa/continuum-0.3-coast --only native_grid,histogram_hdr --labeled-native
python3 qa-suite.py --image ~/Projects/Legion/refs/continuum/stills/continuum-0.6-clouds.png --config configs/legion.yaml --output ~/Projects/Legion/refs/continuum/qa/continuum-0.6-clouds --only native_grid,histogram_hdr --labeled-native
python3 qa-suite.py --frames ~/Projects/Legion/refs/continuum/motion/approach-surface --config configs/legion.yaml --output ~/Projects/Legion/refs/continuum/qa/approach-surface --only temporal_delta,motion_stress
python3 qa-suite.py --frames ~/Projects/Legion/refs/continuum/motion/orbit-0.8au --config configs/legion.yaml --output ~/Projects/Legion/refs/continuum/qa/orbit-0.8au --only temporal_delta,motion_stress
python3 qa-suite.py --frames ~/Projects/Legion/refs/continuum/motion/look-orient --config configs/legion.yaml --output ~/Projects/Legion/refs/continuum/qa/look-orient --only temporal_delta,motion_stress
```

For video recordings rather than PNG sequences, first extract PNG frames with `video_extract`, then point
the corresponding `--frames` command at that extracted directory. Sign the NORTHSTAR rows only when the
native stills, toolkit outputs, motion extracts, and human scorecards are all present.

## Fixture smoke status

| Date | Result |
|---|---|
| 2026-08-03 | `render-qa-toolkit` suite green on synthetic fixtures (frame_budget under 14 ms, native_grid, histogram, reference_match, temporal_delta) |

Authoritative visual/perf claims still require native Chrome captures on declared hardware — not IDE-browser alone.
