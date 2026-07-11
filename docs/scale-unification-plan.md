# Scale Unification — migration plan of record

**Status:** Core migration COMPLETE (reconciled 2026-07-11). Replaced Legion's three
mutually-inconsistent compressed scales (1 AU = 10 WU, 1 ly = 220 WU, 1 kpc = 333 WU — ~10⁶×
inconsistent) with one unified metric (**1 pc = 1000 WU everywhere**) + float64 authoritative
coordinates + a per-frame floating origin. Target architecture is
`space-engine-techniques-for-legion.md` §§2.1–2.2, 3.1–3.4 (the project's own verified research);
this doc is the concrete migration + the product decisions Sean signed off (2026-06-14).

**Where it stands (2026-07-11):**
- ✅ **Phases 0, 1, 2a, 2b, 2c, 3 shipped.** The visible seam is dead — the neighbourhood sits at
  true scale as a speck in the Orion Spur, reached by continuous dive-in. The floating origin is
  live (`FLOATING_ORIGIN_ACTIVE = true`), the ×220 regional frame is retired, and the whole
  system→galaxy dive is one continuous physical-distance readout (U-series, on top of the numbered
  phases). Phase 5a (streamed sector particles) shipped then was retired to a default-off toggle —
  **star-shells** carry the neighbourhood→galaxy visual, with an aggressive zoom-exterior LOD on the
  25 pc catalogue.
- ⏳ **Remaining:** **Phase 4** (depth partitioning; drop `logarithmicDepthBuffer`) — not started.
  **Phase 5 beyond 5a** — the near-particle → volumetric-cloud luminance handoff, ±20–25% per-sector
  density, and sectors as navigable traversal overlays. Plus a parked item: the alien-civ territory
  "zones" (`SHOW_ALIEN_CIV_ZONES = false` in `galaxy.ts`, to re-address).

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

4. **Browsing the neighbourhood = dive-in (continuous zoom), confirmed 2026-06-22.** Once the scale
   is unified the neighbourhood is a *speck* at galaxy-overview zoom; you browse it by zooming
   continuously **into the spur** until labels resolve — NOT via a magnified "you-are-here" inset
   (which would reintroduce a deliberate scale lie). This is the "moving through and between
   neighbourhoods" experience.

Defaults unless revisited: star-field as real 3D parallax vs infinity shell (render decision);
galaxy-tier disc live-re-rooted vs baked backdrop.

## The visible seam — why it looks wrong today, and how the phases remove it

This section exists so the through-line is never lost: **all the "plumbing" phases must converge on a
single, true-scale representation.** (Sean, 2026-06-22, from a sector-tier screenshot where the whole
Milky Way appeared roughly the same size as the 10-ly neighbourhood ring.)

**Symptom (sector tier).** The local neighbourhood and the galaxy disc are drawn in two *incompatible*
frames — neighbourhood at 1 ly = 220 WU, galaxy at 1 ly ≈ 0.10 WU (1 kpc = 333 WU): a **~2,150×
mismatch**. Where the sector→arm crossfade overlaps them, the entire ~100,000-ly Milky Way renders
only ~2× the size of a 10-ly ring instead of ~5,000×. The neighbourhood is artificially inflated
~2,000× to stay browsable; the galaxy is near its true (compressed) proportions; the *seam is the gap
between the two frames*.

**End-state.** ONE galactic frame at the unified metric. Every star sits at its real galPos; the
neighbourhood is a faint cluster **deep inside the Orion Spur** reached by **diving in** (decision 4 —
continuous zoom, no regime switch, no magnified inset). Near the camera, stars are **true
particles/markers**; the rest of the galaxy is the **volumetric raymarch** (the disc model)
approximating billions of stars, with luminance handing off across the LOD seam as discrete systems
spawn from the volume. So "most star particles end up as volumetric cloud" (Sean) is the *intended*
far-field representation, not a compromise.

**Convergence — each phase's contribution to true scale:**
- **0–1** ✅ single source of scale + neighbourhood pinned to real *relative* geometry (still ×220).
- **2a** ✅ body visual inflation (orthogonal to positions).
- **2b** ✅ floating origin + frame broker — the precision substrate; a single continuous metric at
  galactic distances (home ≈ 8.3e6 WU) is impossible in float32 without it. `FLOATING_ORIGIN_ACTIVE =
  true` (`scale-manager.ts`); activated in #68.
- **2c** ✅ **collapsed the regional neighbourhood tier INTO the unified galactic frame** at real galPos
  — *this is where the seam died* (#67–#71; the legacy ×220 regional frame is retired). The
  neighbourhood is now a speck in the spur; the disc model is scaled/placed by the broker to read at
  true proportions (internal 333-WU/kpc calibration frozen — no HOME_POS re-derive).
- **3** ✅ re-derived every camDist/zoom/LOD threshold for the unified magnitudes — shipped as the
  **U-series** (U1 one continuous physical-distance readout; U2 whole system at true scale in the
  unified frame; U3 adaptive FOV over log(camDist) + mesh↔icon LOD). Dive-in zoom is continuous.
- **4** ⏳ depth partitioning so the vastly wider depth range renders without z-fighting. **Not started**
  — `logarithmicDepthBuffer: true` is still set (`renderer.ts`).
- **5** ◑ sector tiling + procedural fill: near = true particles, far = volumetric cloud, deterministic
  on revisit; ±20–25% per-sector density around the local mid-range. **5a shipped** (streamed sector/
  region particles); the near-particle → volumetric-cloud luminance handoff is the remaining ambition.

## Phases (each independently shippable + verifiable)

| # | Phase | Risk | Player-visible |
|---|---|---|---|
| 0 | ✅ **shipped** (PR #61) — Collapse all scale constants into `src/core/metrics.ts` (derives the *current* values — byte-identical) | very low | none |
| 1 | ✅ **shipped** — float64 `galPos` store (`src/data/curated-systems.ts`, `SOL_GAL_PC`); curated systems re-pinned to **real heliocentric pc** from the 25-pc HYG catalogue; **regional tier** placed from real geometry; star-graph link range migrated to WU (`NAV_LINK_WU`). Galactic tier (`GAL_SYSTEMS`/`HOME_POS`) merge **deferred to Phase 2** (moving frozen `HOME_POS` shifts the whole galaxy frame). | medium | yes (decision 1) |
| 2 | Frame broker + floating origin + galactic merge — **decomposed** into 2a/2b/2c | high | per sub-slice |
| 2a | ✅ **shipped** (#63) — visual-inflation re-model (decision 2): `getEffectiveScale` inverted to **1:1 close → ~1.25× outer-system/Oort**, configurable max + ramp window (`visualInflation` VP key, settings UI), dead `isInSolarSystem` removed | low | yes (scale UI) |
| 2b | ✅ **shipped** (#64–#66, #68) — frame broker + per-frame floating origin, `sceneRoot` container, `Broker` (`getTierRoot`/`getSceneRebase`/`beginFrame`), galaxy frame + disc-volume uniforms per frame, camera velocity + planet uniforms on the f64 anchor. `FLOATING_ORIGIN_ACTIVE = true` (activated #68). Density model frozen in its 333-WU/kpc frame. | high | none (jitter gone) |
| 2c | ✅ **shipped** (#67–#71) — **collapsed the regional neighbourhood tier INTO the unified galactic frame** (THE visible-seam fix): per-frame local + regional re-rooting via broker (#67), floating origin activated (#68), `uModelScale` plumbing (#69), unified galaxy rescale + working dive-in (#70), real curated markers + **retired the legacy ×220 regional frame** (#71). Disc model's internal 333-WU/kpc calibration stays frozen. | high | **neighbourhood sits true-scale in the spur** |
| 3 | ✅ **shipped as the U-series** — U1 one continuous physical-distance readout (kills the AU→ly jump); U2 whole system at true scale in the unified frame (+ blockers: floating-origin oscillation, true-scale overexposure, re-keyed system-tier thresholds, belt lighting); U3 adaptive FOV over log(camDist) + restored mesh↔icon LOD at true scale | medium | zoom feel |
| 4 | ⏳ **not started** — depth partitioning; drop `logarithmicDepthBuffer` (still `true` in `renderer.ts`) | med-high | perf |
| 5 | ◑ **5a shipped** — streamed sector/region particles keyed off the float64 frame (decision 3); retired to a default-off toggle after live QA (read as a hard square), **star-shells** now carry the neighbourhood→galaxy visual, catalog gets an aggressive zoom-exterior LOD. **Remaining:** near-particle → volumetric-cloud luminance handoff; ±20–25% per-sector density; sectors as navigable traversal overlays | medium | new far systems |

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
