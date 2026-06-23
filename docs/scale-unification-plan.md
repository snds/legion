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
- **2b** (now) floating origin + frame broker — the precision substrate; a single continuous metric at
  galactic distances (home ≈ 8.3e6 WU) is impossible in float32 without it. Behaviorally neutral.
- **2c** **collapse the regional neighbourhood tier INTO the unified galactic frame** at real galPos —
  *this is where the seam dies* (the headline, not the landmark-list merge). The neighbourhood becomes
  a speck in the spur; the disc model is scaled/placed by the broker to read at true proportions (its
  internal 333-WU/kpc calibration stays frozen — no HOME_POS re-derive).
- **3** re-derive every camDist/zoom/LOD threshold for the unified magnitudes so the dive-in zoom is
  continuous and tiers fire at the right distances.
- **4** depth partitioning so the vastly wider depth range renders without z-fighting.
- **5** sector tiling + procedural fill: near = true particles, far = volumetric cloud, deterministic
  on revisit; ±20–25% per-sector density around the local mid-range.

## Phases (each independently shippable + verifiable)

| # | Phase | Risk | Player-visible |
|---|---|---|---|
| 0 | ✅ **shipped** (PR #61) — Collapse all scale constants into `src/core/metrics.ts` (derives the *current* values — byte-identical) | very low | none |
| 1 | ✅ **shipped** — float64 `galPos` store (`src/data/curated-systems.ts`, `SOL_GAL_PC`); curated systems re-pinned to **real heliocentric pc** from the 25-pc HYG catalogue; **regional tier** placed from real geometry; star-graph link range migrated to WU (`NAV_LINK_WU`). Galactic tier (`GAL_SYSTEMS`/`HOME_POS`) merge **deferred to Phase 2** (moving frozen `HOME_POS` shifts the whole galaxy frame). | medium | yes (decision 1) |
| 2 | Frame broker + floating origin + galactic merge — **decomposed** (see below) into 2a/2b/2c after the architecture sweep | high | per sub-slice |
| 2a | ✅ **shipped** — visual-inflation re-model (decision 2): `getEffectiveScale` inverted to **1:1 close → ~1.25× outer-system/Oort**, configurable max + ramp window (`visualInflation` VP key, settings UI), dead `isInSolarSystem` removed | low | yes (scale UI) |
| 2b | Frame broker + per-frame floating origin, **behaviorally neutral** (R≡0 identity policy — camera NOT moved). Sliced after a 3-design + adversarial-vet workflow into **2b-0..2b-4**: **2b-0/1/2 ✅ shipped** — `sceneRoot` container (all tiers + loose objects re-parented), dormant `Broker` (`getTierRoot`/`getSceneRebase`/`beginFrame`, `FLOATING_ORIGIN_ACTIVE=false`), `getGalaxyOffset` delegates to `Broker.getTierRoot('galactic')` (=−HOME_POS, byte-identical); 0-ULP bare-graph neutrality test; **2b-2** = `updateGalaxyFrame()` refreshes the galaxy group position + disc-volume AABB/origin uniforms per frame from the broker (`beginFrame` pinned right after `camCtrl.update`), idempotent under R≡0 (live-verified: group + uniforms = exactly −HOME_POS ± box). **Next**: 2b-3 camera velocity + focus/track reads onto the f64 anchor (+ `uPlanetCenter` lockstep, per adversary); 2b-4 land neutrality gate in CI. Density model stays frozen in its 333-WU/kpc frame. | high | none (jitter gone) |
| 2c | **Collapse the regional neighbourhood tier INTO the unified galactic frame** (THE visible-seam fix): regional markers + `GAL_SYSTEMS` placed from `CURATED_SYSTEMS` at real `galPos()` in ONE frame through the broker; the disc model is scaled/placed to read at true proportions (its internal 333-WU/kpc calibration stays frozen — no `HOME_POS` re-derive, which would break the CI snapshot/GLSL/RIFT_CLOUDS); `getGalaxyOffset`'s 3 consumers move to the broker atomically. Not just the landmark-list merge. | high | **neighbourhood sits true-scale in the spur** |
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
