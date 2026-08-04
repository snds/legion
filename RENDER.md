# RENDER.md — Legion

Project consumer contract for Workspace framework **#12 Realtime Photoreal Operational** and skill `realtime-visual-craft`. Skills live in the Workspace repo; this file is Legion-local look doctrine.

## Fidelity contract

| Layer | Type | Meaning |
|---|---|---|
| Primary | **Spirit** | NASA-industrial hard sci-fi (Martian / Expanse / Oblivion language): material honesty, industrial scale, function over ornament |
| Hero bodies / planets | **Literal** toward named northstars in `NORTHSTAR.md` within WebGPU budget | Match energy transport + camera language of SpaceEngine-class / film refs at official poses |
| Gameplay | **Intent** | Readable silhouettes and state at play distance (see `visual-qa-game-design`) stacked under photoreal |

Vague "photoreal" without a northstar row is rejected at `shape` time.

## Engine target

- **Primary:** Three.js + WebGPU/TSL (`adapter-webgpu-three`)
- **Doctrine:** Workspace `#12` + `realtime-render-performance` + `imaging-foundations`
- **Conflict guard:** Cursor plugin marketing-3D Three.js skills are API lookup only; Workspace doctrine wins (no frag log-depth default, post order, native eval, uncapped-with-floor FPS)

## Look doctrine (summary)

- Linear/HDR work → tonemap (ACES / AgX as chosen per scene) → sRGB encode last
- Strong IBL + physically ratioed emitters; do not fake photoreal with unbounded fill lights
- Post: bloom in HDR before tonemap; judge the **composer** final frame, not raw `renderer.render`
- Planets / continuum: atlas-first / chunked LOD per `docs/chunked-lod-60fps-plan.md`
- Atmospheres: Hillaire-class LUTs (`atmospheric-scattering-and-clouds`)

## Official poses (still)

See `BUDGET.md` for URLs. Capture lossless PNG at backing-store resolution; if larger than one truthful view, **1:1 grid-chunk** and assess tiles (`native-visual-eval` / `render-qa-toolkit` `native_grid`).

## Official interaction paths (motion)

Still-only approval is an automatic fail for LOD, volumetrics, dither, TAA, cascades, scale traversal.

| Path ID | Covers | Capture notes |
|---|---|---|
| `orbit-0.8au` | Slow orbit at 0.8 AU baseline | 10–20 s; extract 1 fps + dense around lighting changes |
| `approach-surface` | Zoom / scale from far → close / low orbit | Stress LOD rebuilds, floating-origin if any, fill-rate |
| `look-orient` | Pitch/yaw/roll at fixed distance | Temporal crawl, cascade swim, dither crawl |
| `continuum-ab` | Legacy vs `engine=continuum` same path | A/B still *and* motion before cutover |

Record visually lossless (or lossless) at native canvas resolution. Review **frame-by-frame** (`interactive-capture-eval` + `reference-video-review`).

### `continuum-ab` protocol

`engine=continuum` is a lab-only comparison path. Legacy remains the shipping default.

1. Start from the same Terran state: identical seed, climate inputs, and `src/render/planet/lab-ideal.json` configuration.
2. Reset the lab before each pass, then record the same `approach-surface` and `look-orient` camera inputs once on Legacy and once with `?engine=continuum`.
3. Keep canvas dimensions, DPR, browser, hardware, capture method, warmup, and relevant lab controls identical. Record native still poses and visually lossless motion for both passes.
4. Export `__perfCapture` for the equivalent settled and approach poses. Assess native still grids, motion frames, and budget results together in `docs/superpowers/specs/2026-08-03-continuum-ab-cutover-decision.md`.

This protocol records evidence only. It does not establish ship readiness or change the default engine.

## Debug views expected

When materials/lighting are in scope: albedo, normals, roughness/metalness, emissive, and final beauty — labeled captures.

## Related Workspace skills

`realtime-visual-craft` · `render-qa-toolkit` · `interactive-capture-eval` · `native-visual-eval` · `visual-qa-photoreal-rendering` · `rendering-guild` · `realtime-render-performance` · `adapter-webgpu-three` · `failure-mode-premortem`
