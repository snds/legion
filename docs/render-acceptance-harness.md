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

## Fixture smoke status

| Date | Result |
|---|---|
| 2026-08-03 | `render-qa-toolkit` suite green on synthetic fixtures (frame_budget under 14 ms, native_grid, histogram, reference_match, temporal_delta) |

Authoritative visual/perf claims still require native Chrome captures on declared hardware — not IDE-browser alone.
