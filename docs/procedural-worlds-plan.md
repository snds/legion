# Procedural Worlds — plan of record

**Status:** Proposed (2026-07-11). A dedicated effort for everything revealed on the **system dive**:
the generated system's **star** rendered by real stellar physics, its **planets** as globes at
system-zoom, and eventually **walkable/simulatable planetary surfaces** supporting the gameplay
endgame (creatures, alien races, colonization/city-management, Factorio-like surface factories).
Evidence base: [`procedural-star-research.md`](procedural-star-research.md),
[`procedural-planet-research.md`](procedural-planet-research.md). Sibling to
[`stellar-phenomena-plan.md`](stellar-phenomena-plan.md) (galaxy-tier phenomena) and consumes the
unified frame + floating origin from [`scale-unification-plan.md`](scale-unification-plan.md).

## Vision (Sean, 2026-07)

When you dive into a generated system, every body is produced procedurally, physically-plausibly, and
**deterministically on revisit** — the correct star for its type, planets you can approach from orbit,
and (the long arc) surfaces you can land on, build on, and populate. The rendering layers come first;
the gameplay-simulation layers (colonies, factories, creatures) build on the surface substrate.

## Decisions

1. **Rendering → gameplay, phased.** One plan, one continuous ambition, but a hard boundary: **Tiers
   0–1 (star + globe + survey surface) are rendering; Tier 2+ (simulatable surface, colonies,
   factories, creatures) is gameplay simulation** and may spin into its own plan once the substrate
   lands.
2. **Physically-driven, not hand-tuned.** Bodies render from their generated physical record (star:
   mass→L,R,T,activity; planet: type/mass/insolation → terrain/atmosphere/biomes), never per-object
   art tuning.
3. **Deterministic + float-safe.** Regenerates identically from seed; positions ride Legion's float64
   store + per-frame floating origin. The seed → coarse-fields (+ optional one-time baked sim, cached)
   architecture from the research is canonical.
4. **Two-representation surface** (when we get there): a global geodesic/Voronoi (Goldberg) cell map
   for planet-wide state + streamed local flat chunked grids (Factorio/DF model) for fine simulation.
5. **Surface-manipulation-ready — even before the surface gameplay is designed (Sean, 2026-07).** The
   *what* on the surface is deliberately open, but every generation/persistence/LOD choice must not
   foreclose it. Concretely: the surface is a **deterministic baseline the player can EDIT** (never a
   pure function of the seed once touched), terrain must support **runtime topology manipulation**, and
   the initial planning anchor is **flattening a region to a buildable flat plane** for factories/
   colonies. Also keep the door open for build sites **within gas giants (cloud-layer platforms) and
   their rings** where those exist at generation time — so gas-giant vertical band structure and ring
   systems are generated as potentially-interactable structures, not just visuals.

## Architecture (by dive tier)

```
  system zoom ──▶ STAR (type→color/size/activity)  +  PLANET GLOBES (cube-sphere + atmosphere)
                                                          │  approach / descend
                                                          ▼
  survey surface ──▶ tectonics → erosion → climate/biomes (baked to per-planet textures)
                                                          │  land
                                                          ▼
  gameplay surface ──▶ global Goldberg cells (planet state) + local chunked grids (sim)
                          └─▶ creatures · colonies/city-mgmt · Factorio-style factories
```

## Phases (each independently shippable + verifiable)

| # | Phase | Risk | Player-visible |
|---|---|---|---|
| P0 | ✅ **research capture** — star + planet research docs, archetype/parameter taxonomy | none | none |
| S1 | **Procedural star.** One uniform-driven material rendered from the star record: `ColorUtils.setKelvin(T_eff)` color, mass→L∝M³·⁵→R,T, HDR + bloom ∝ luminosity, fBm+domain-warp surface with limb darkening, **type-gated** granulation (0 for O/B, high for M). Rides system-tier scale + the point-of-light hand-off at distance. | med | correct star per system |
| S2 | **Star activity + flares.** Activity = f(type, age, rotation); starspots, prominences, activity-gated flares/CMEs — makes the 76% M-dwarf population distinct. | med | living stars |
| P1 | **Planet globe (system-zoom).** Cube-sphere quadtree + fBm/ridged/domain-warp terrain, altitude×latitude×moisture color ramp, Lague water post-process, planet-type presets (rocky/gas/ice/ocean/lava/desert). Distant fallback: analytic-sphere fragment shader (one draw). Deterministic from seed. Port the Lague/fqhd WebGL2 stack. | med | real planets in every system |
| P2 | **Atmosphere.** Rayleigh/Mie scattering shell, day/night terminator, night-side city-lights, clouds. | med | planets that read as worlds |
| P3 | **Survey surface (space→ground, no gameplay).** Adopt the Orogen pipeline as reference: geodesic sphere → plate tectonics → hydraulic/thermal erosion → Whittaker/Köppen biomes → hydrology, **baked to per-planet heightmap/biome/climate textures** (determinism-safe). Cube-sphere chunked LOD (CDLOD) for orbit→ground descent. **Gate: float precision** — leverage Legion's existing doubles + floating origin. | high | fly down to a surface |
| G1 | **Editable surface substrate.** Global Goldberg/Voronoi cell map (planet-wide state) + streamed local flat chunked grids (tangent-plane projected). **Editable topology from the start**: the baked baseline is overridable per-chunk; **flatten-to-plane** is the first supported edit (a buildable flat region for factories/colonies). World persistence = deterministic regen for untouched terrain + **diff-storage for player edits** (edits win over generation). | high | ground you can build on |
| G2+ | **Gameplay layers** (likely a spun-out plan; the *what* is still open). Candidates: creatures/ecology, alien races, colonization/city-management, Factorio-style surface factories, weather driving local conditions, atmosphere-composition habitability gates, **gas-giant cloud-platform + ring build sites**. | high | the game on the ground |

## Determinism, float precision & Legion's head start

- **Determinism:** seed → deterministic coarse fields; any erosion/tectonic sim runs with fixed
  iterations/timestep and is **baked once to textures** treated as canonical (never re-rolled). Same
  discipline as the density model + `(sector, index)` sector generation.
- **Float precision** is the single hardest space→surface problem — 32-bit floats jitter thousands of
  km from origin. **Legion already has the fix**: a float64 authoritative store + per-frame
  camera-relative floating origin (the scale-unification `Broker`). This is a major head start; the
  remaining work is extending the LOD quadtree from planet-radius to sub-meter in one continuous tree.
- **Editable-surface persistence (first-class, per Decision 5):** the generated planet is a
  **deterministic baseline** overlaid by a **sparse edit layer** (diffs). Untouched terrain regenerates
  from the seed (stored cost ≈ 0); edited chunks store only the diff and **edits override generation**.
  Implications to bake in early so we don't foreclose surface gameplay:
  - The surface heightmap/representation must be **mutable at runtime**, not a read-only noise sample —
    e.g. baked heightmap textures + a writable edit/RLE overlay per chunk.
  - **LOD must honor edits:** a flattened region can't pop back to procedural terrain when it
    re-streams; the edit layer is consulted at every LOD level (or the edited chunk is pinned/cached).
  - **Flatten-to-plane** is the reference edit op (raise/lower/level a bounded region to a buildable
    plane) — the initial concrete target that validates the whole editable pipeline.
  - Chunk boundaries and the global-cell ↔ local-grid projection must stay stable under edits (a
    flattened factory floor must not shift when the camera or LOD changes).
- **Non-terrestrial build sites (keep the door open):** where generation yields a **gas giant**, emit
  its vertical **cloud-band structure** (definable altitude layers a platform could sit on) rather than
  an opaque sphere; where it yields **rings**, generate them as a structured, samplable system (radius/
  density bands) — both as *potentially-interactable* structures, so a later cloud-city or ring-station
  layer isn't blocked by a visuals-only representation.

## Risks

- **Space→surface LOD** — one continuous quadtree from orbit to ground is the core custom engineering;
  no library gives it free.
- **Scope** — Tiers G1+ are a whole game layer; keep the rendering tiers (S/P) cleanly shippable
  independent of the gameplay sim, and split G-tiers into their own plan when the substrate lands.
- **Deterministic GPU sim fragility** — bake, don't re-roll; validate with a determinism snapshot test.
- **Perf budget** — the star, planet globes, and chunked terrain all compete with the galaxy/phenomena
  layers; hard LOD + streaming budgets per the lessons already learned (catalogue ball, sector grid).

## Relationship to the other efforts

- **Consumes** scale-unification (unified metric, float64 store, floating origin — Phases 0–3 shipped).
- **Sibling** to stellar-phenomena (galaxy-tier nebulae/exotica) — shares determinism + LOD discipline;
  a system's star here vs. a flythrough nebula there are different tiers of the same procedural universe.
- Exotic bodies (black holes, magnetars, binaries) live in the **phenomena** plan as galaxy-tier
  set-pieces; a *star* in a normal system lives here.
