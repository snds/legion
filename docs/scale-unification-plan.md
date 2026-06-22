# Scale Unification — migration plan of record

**Status:** Active migration. Replaces Legion's three mutually-inconsistent compressed scales
(1 AU = 10 WU, 1 ly = 220 WU, 1 kpc = 333 WU — ~10⁶× inconsistent) with one unified metric +
float64 authoritative coordinates + a per-frame floating origin. Target architecture is
`space-engine-techniques-for-legion.md` §§2.1–2.2, 3.1–3.4 (the project's own verified research);
this doc is the concrete migration + the product decisions Sean signed off (2026-06-14).

## The metric

**1 parsec = 1000 world-units, everywhere.** Every object's true position is stored in **float64
parsecs** (galactocentric; plane XZ, +Y = NGP; Sgr A* at origin). Each frame the renderer
subtracts the camera's float64 position and uploads only the small residual to the GPU as float32.
Precision comes from the float64 store + per-frame re-centering (floating origin), **not** from the
scale number — so 1000 is a pure legibility choice. Absolute galactocentric WU is never uploaded.

Nested frames for sub-WU detail: **galactic** (pc) → **system** (AU/km, per star) → **planet**
(metres, future surface tier). The neighbourhood is literally the galaxy sampled near the camera at
full metric; zoom is pure camera distance, no regime switch.

## Confirmed product decisions (Sean, 2026-06-14)

1. **Re-pin curated stars to real sky positions — YES.** ε Eridani's fictional neighbours are
   replaced by the real nearby stars at their real coordinates (the "navigationally truthful"
   pillar). A deliberate, player-visible change.
2. **Body visual inflation — configurable in the UI, and re-modelled.** Scale changes only as you
   zoom OUT to a functional distance (~the Oort-cloud distance is where it starts to matter):
   **1:1 (true scale) at/near a target object**, ramping UP to **~1.25× at outer-system**, with the
   max + onset exposed as a UI control. (Inverts today's 8×-close→1×-far model.) Scales/distances to
   be tuned comprehensively later; the frame broker keys this on apparent angular size, not raw WU.
3. **Interstellar density — local-neighbourhood density as the mid-range**, varied **±20–25% per
   instanced sector**. Galactic-visual LOD: **near-to-camera stars are true particles; the far
   galaxy is the volumetric raymarch (the cloud/Heckel approximation)** synthesising the disc —
   billions of stars are never rendered as particles. Luminance hands off as discrete systems spawn
   from the volume (constant summed luminance across the LOD seam).

Defaults unless revisited: star-field as real 3D parallax vs infinity shell (render decision);
galaxy-tier disc live-re-rooted vs baked backdrop.

## Phases (each independently shippable + verifiable)

| # | Phase | Risk | Player-visible |
|---|---|---|---|
| 0 | ✅ **shipped** (PR #61) — Collapse all scale constants into `src/core/metrics.ts` (derives the *current* values — byte-identical) | very low | none |
| 1 | ✅ **shipped** — float64 `galPos` store (`src/data/curated-systems.ts`, `SOL_GAL_PC`); curated systems re-pinned to **real heliocentric pc** from the 25-pc HYG catalogue; **regional tier** placed from real geometry; star-graph link range migrated to WU (`NAV_LINK_WU`). Galactic tier (`GAL_SYSTEMS`/`HOME_POS`) merge **deferred to Phase 2** (moving frozen `HOME_POS` shifts the whole galaxy frame). | medium | yes (decision 1) |
| 2 | Frame broker (scale-manager becomes it) + per-frame floating origin; camera-relative shaders; new visual-scale model (decision 2) | high | none (jitter gone) + scale UI |
| 3 | Re-derive `getCamDist` from real extents; tiers → labels | medium | zoom feel |
| 4 | Depth partitioning; drop `logarithmicDepthBuffer` | med-high | perf |
| 5 | Sector tiling + procedural fill keyed off the float64 frame (decision 3) | medium | new far systems |

## Key risks (carried per phase)

- **float64 discipline:** no gameplay code reads `object3D.matrixWorld` for galactic-magnitude
  positions, and no absolute WU is baked into a BufferAttribute (either reintroduces jitter). Lint/
  review rule; `galaxy-density.test.ts` frozen HOME_POS anchor re-derived from the shared `galPos`.
- **Depth-partition vs the post chain:** the just-fixed AA/bloom/exposure ordering must survive the
  `autoClear=false` + `clearDepth()` multi-partition composite.
- **Galaxy at true metric** (15 Mpc-WU radius) cannot be uploaded raw — backdrop re-rooted per frame
  or drawn at bounded reduced metric; the volume↔discrete-systems luminance handoff is the trickiest
  seam.
- **getCamDist feel:** re-key endpoints to real extents but keep the curve shape; A/B per tier.
- **Headless preview throttles the galaxy tier** — galaxy/arm verification leans on unit tests +
  CPU numeric assertions; live-preview reserved for planet/system/heliopause.
- **Determinism:** procedural fillers keyed on (sector, index) must regenerate identically on
  revisit; a seed change is a "universe reset" relocating every procedural object.
