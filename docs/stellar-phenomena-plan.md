# Stellar Phenomena — plan of record

**Status:** Proposed (2026-07-11). A **separate, dedicated effort** to populate Legion's galaxy with
scientifically-grounded stellar phenomena — nebulae, stellar nurseries, supernova remnants, black
holes, magnetars, binaries — first as **canonical recreations of real, named objects at their real
galactic positions**, then **procedurally propagated** into uncharted space via the sector-mapping
system. Evidence base: [`nebula-simulation-research.md`](nebula-simulation-research.md). Integrates
with the scale-unification effort at **Phase 5** (sector tiling + procedural fill) but is tracked
independently here.

## The vision (Sean, 2026-07-11)

> "Bring as many canonical, real stellar phenomena into the galaxy as possible. From there, use those
> 'real' simulated phenomena to generate random ones for areas of the galaxy we do not have
> information for, and include it as part of our sector mapping and placement."

Two movements, in order:
1. **Canonical atlas** — recreate real, catalogued phenomena (Orion, Helix, Cas A, Crab, Eagle/M16,
   real molecular clouds, known black holes/magnetars/binaries) at their **real `galPos`**, using
   real data (3D dust maps, HII catalog, Chandra models) and the reference technique (Orlando's
   nested iso-density shells + emission-color physics).
2. **Procedural propagation** — treat the canonical set as **archetypes** (parameter distributions +
   morphology templates). For sectors with no real data, deterministically generate plausible
   phenomena seeded on `(sector, index)`, so the galaxy is richly populated everywhere and identical
   on revisit.

## Confirmed decisions (Sean, 2026-07-11)

1. **Separate but dedicated effort.** Not folded into scale-unification; own plan, own phases. Hooks
   into scale Phase 5 (sector placement) as the integration seam.
2. **Real-first, then generative.** The canonical, data-driven phenomena come first and become the
   ground truth the procedural generator samples from — not the other way round.
3. **Part of sector mapping/placement.** Phenomena are sector contents: streamed with the existing
   sector/region residency, LOD'd with zoom, and **deterministic per `(sector, index)`** (a seed
   change relocates every procedural object — a "universe reset").

## Architecture

```
  archetype library ──▶ CANONICAL ATLAS (real data, real galPos)
        │                      │
        │  (sample params)     │  (render)
        ▼                      ▼
  PROCEDURAL GENERATOR ──▶ sector/region placement ──▶ nested-shell / raymarch renderer
        (seeded per sector)        (streaming + LOD)         (emission-color physics)
```

- **Phenomenon archetype** — a typed template (nebula-emission, nebula-reflection, nebula-planetary,
  stellar-nursery, supernova-remnant, black-hole, magnetar, binary, …) with a parameter schema
  (size, color/line-emission mix, density-field seed, ionizing-source coupling, morphology axis) and
  a **renderer strategy** (nested shells for diffuse volumes; discrete shader set-pieces for
  BH/magnetar/binary).
- **Canonical atlas** — real objects instantiated from data: dust clouds from Edenhofer/Bayestar,
  emission nebulae from the WISE HII catalog + their ionizing stars, remnants/hero objects from
  Chandra models. Placed at real `galPos` in the unified frame.
- **Procedural generator** — samples archetype parameter distributions fit from the canonical set;
  keyed on `(sector, index)` + galactic-environment inputs the sector already knows (arm phase,
  density class, radius — see `region.ts`), so nurseries cluster on arm ridges, planetary nebulae in
  older-population regions, etc. Never renders billions — it's a sparse sprinkle per sector.
- **Renderer** — the reusable primitive (nested iso-density shells + emission/absorption color ramp),
  sharing the galaxy tier's floating-origin re-rooting and zoom LOD.

## Phases (each independently shippable + verifiable)

| # | Phase | Risk | Player-visible |
|---|---|---|---|
| P0 | ✅ **research capture** — `nebula-simulation-research.md` + this plan; archetype taxonomy | none | none |
| P1 | **Rendering primitive** — nested iso-density shell mesh + physically-motivated emission-color ramp ([OIII]→Hα→dust absorption); one hand-authored test nebula in the galaxy tier, riding the broker + zoom LOD. Optional: a single true-raymarch "hero" variant. | med | first real nebula |
| P2 | **Canonical atlas — data ingestion.** Pull the Edenhofer 2024 3D dust map (+ Bayestar) → voxelized density fields for real neighbourhood molecular clouds; WISE HII catalog → emission-nebula seeds at real `galPos`. Deterministic, cached. | med-high | real dust/clouds where they really are |
| P3 | **Archetype library + fit.** Formalize the phenomenon types + parameter schema; fit parameter distributions from the canonical atlas (the templates the generator samples). | med | none (data model) |
| P4 | **Procedural generator.** `(sector, index)`-seeded phenomena for uncharted sectors, gated by galactic environment (arm phase / density / radius). Deterministic on revisit. | high | populated far galaxy |
| P5 | **Sector integration + LOD.** Wire phenomena into sector/region streaming residency; near = detailed shells, far = impostor/volume hand-off; budget-capped per sector. | med-high | phenomena stream in on the dive |
| P6 | **Discrete set-pieces** (parallel track). Black hole (Kerr/Schwarzschild geodesic shader), magnetar (hot sphere + animated dipole + bursts), binary (Roche lobes + L1 stream + accretion disk). Placed as rare canonical + procedural objects. | med | exotic hero objects |

## Determinism & integration (load-bearing)

- **Seed discipline** mirrors scale-unification's Phase 5: procedural phenomena keyed on
  `(sector, index)` must regenerate **identically** on revisit. A seed change is a universe reset.
- **Frame discipline:** phenomena ride the galactic tier's float64 → per-frame residual rebase
  (`Broker`); no absolute-WU positions baked into buffers (reintroduces jitter).
- **Placement** flows through the existing sector/region residency (`sector-manager.ts`,
  `region-manager.ts`, `galaxy-enumerate.ts`) — phenomena are another sector-content layer alongside
  stars, budgeted so a dense arm sector doesn't blow the frame.
- **Canonical vs. procedural boundary:** a sector that overlaps real-data coverage (≤ dust-map
  extent, or a catalogued HII region) uses the real object; outside coverage it falls to the
  generator. The seam must be continuous (no pop where real data ends).

## Key risks

- **Perf:** true volume raymarching is expensive — reserve for heroes; nested shells / splats for the
  field. Budget-cap phenomena per sector; LOD hard on pull-back (same lesson as the catalogue ball).
- **Data pipeline:** the 3D dust maps are large scientific datasets (Python `dustmaps`); needs an
  offline bake → compact engine format, not a runtime dependency.
- **Determinism regressions:** any change to the generator's seed/param mapping relocates everything;
  gate with a determinism snapshot test like the density model's.
- **Scientific honesty vs. art:** the canonical set must stay recognizably real (color = line
  emission, not arbitrary); the generative set should stay within fitted distributions so it reads as
  "plausible Milky Way," not sci-fi.
- **Licensing:** Orlando's Sketchfab assets are CC — verify per-model before shipping derivatives; the
  *technique* is unencumbered. (Sean reached out to the artist directly, 2026-07.)

## Relationship to scale-unification

This effort **consumes** the unified frame + floating origin (Phases 0–3, shipped) and **extends**
scale Phase 5: where scale-Phase-5 concerns the *star* field (near particles → volumetric disc), this
plan concerns the *phenomena* layer (nebulae/remnants/exotica) that shares the same sector placement,
determinism, and LOD machinery. See `scale-unification-plan.md` Phase 5.
