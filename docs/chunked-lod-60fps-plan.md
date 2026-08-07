# Chunked LOD for 60 fps — plan of record

**Status:** Proposed (2026-07-30). Performance architecture for **close-zoom 60 fps**
across planet, galaxy, and star — without forcing one shared renderer.

**Parent context:** close-zoom perf session after planet-renderer ship (`main` @
`24040e5`); local work on `perf/planet-horizon-cull`. Consumes lessons from
[`procedural-planet-v2-plan.md`](procedural-planet-v2-plan.md),
[`sector-cloud-prototype.md`](sector-cloud-prototype.md),
[`procedural-worlds-plan.md`](procedural-worlds-plan.md),
[`fly-to-surface-research.md`](fly-to-surface-research.md).

---

## Measurement baselines (Track 0)

**Official replicate distance:** HUD **0.8 AU** (`PERF_BASELINE_AU`). Matches Sean’s
planet-lab / star-lab tuning pose (`zoomForPhysicalAu(0.8) ≈ 0.1205` on the zoom axis).

| Pose | When | URL |
|------|------|-----|
| **lab-0.8au** | Planet lab (legacy) | `?lab=planet&perfcapture&au=0.8&w=1280&h=720&dpr=2` |
| **lab-continuum-0.8au** | Planet lab continuum | `?lab=planet&engine=continuum&perfcapture&au=0.8&w=1280&h=720&dpr=2` |
| **star-0.8au** | Procedural star | `?demo=star&perfcapture=composite&au=0.8&w=1280&h=720&dpr=2` |
| **approach-low** | True-scale close orbit (fill worst case) | `?demo=approach&perfcapture&w=1280&h=720&dpr=2` (omit `&au=` to keep low-orbit) |

Optional: `&warmup=90&samples=120`. Results land in `window.__perfCapture` + on-screen panel + console JSON.

**60 fps budget:** 16.67 ms whole-frame composite (includes post). Attribute planet fill by
CAPTURE differences (worst − baked − noplanet), never raw absolutes alone.

**Device label required** on every recorded row (e.g. MBP M-series native Chrome). Headless /
backgrounded tabs throttle rAF — do not treat those fps as baselines.

### Baseline log

Captured in **Cursor IDE browser** (WebGL2 gpu-timer-query, 1280×720 @ DPR 2).
Treat as **trend / ranking** — re-run in native Chrome on your MBP before declaring wins.
Budget = **16.67 ms** (60 fps).

| Date | Device | Pose | Mode | worst/comp med | p95 | ≈fps | Attribution / notes |
|------|--------|------|------|----------------|-----|------|----------------------|
| 2026-07-30 | Cursor IDE browser | lab-0.8au (ocean) **before** | capture | **188.5 ms** | 307 | ~5 | fill 91 · clouds/etc 93 · floor 3.7 · **1318 draws** / 664k tris |
| 2026-07-30 | Cursor IDE browser | lab-0.8au (ocean) **after LOD pass** | capture | **163.1 ms** | 206 | ~6 | fill 98 · clouds/etc 61 · floor 4.3 · **24 draws** / 162k tris |
| 2026-07-30 | Cursor IDE browser | star-0.8au (cold) | composite | **11.9 ms** | 14.1 | **~84** | under budget · 87 draws |
| 2026-07-30 | Cursor IDE browser | star-0.8au (post-planet, hot GPU) | composite | 129 ms | 227 | ~8 | thermally contaminated — ignore vs cold run |
| 2026-07-30 | Cursor IDE browser | approach-low | capture | **76.0 ms** | 111 | ~13 | fill 35.8 · clouds/etc 36.3 · floor 4.0 · 379 draws |
| 2026-07-30 | Cursor IDE browser | **lab-continuum-0.8au** (ocean ideal) | capture | **5.1 ms** | 70 | **~194** | fill 1.2 · clouds/etc 0.3 · floor 3.6 · **25 draws** / 1.6k tris · `lodRebuildCount=0` |

**LOD pass shipped (planet lab first):** merged leaf geos → **1 surface draw**, `MAX_LEAVES=320`, `DETAIL=0.035`, `MAX_LEVEL=7`, LOD hysteresis, coarser cloud/atmos shells. Draw calls **1318→24**, tris **664k→162k**. Frame time only modestly better — still **fragment-bound** (live terrain FBM ≈ 98 ms).

**Bake/fragment pass shipped:** `CACHE_BAKE` + single-flight `bake-queue`, lab `setBakeAuto(false)`, atlas invalidate on terrain fingerprint, `uCloudCheap` lite path on cache bakes. Lab-0.8au capture (trend): worst **~120 ms**, baked **~56 ms**, live-terrain fill **~65 ms**, clouds/atmos/night **~52 ms** (was ~163 / ~61 / ~98 / ~61). Still well above 60 fps on legacy.

**Continuum lab prototype shipped:** atlas-first fixed mesh + cheap cloud shell (`?lab=planet&engine=continuum`). Trend capture median **~5 ms** at lab-0.8au (under 16.7 ms budget in Cursor IDE browser). Look A/B vs legacy still required in native Chrome before shipping cutover. Half-res volumetric clouds not needed for this pose.

**Star:** tessellation/corona trimmed (96→64, corona steps 12→8). Cold baseline already under 60 fps in this browser.

**Re-run on your machine (authoritative):** use port of a **fresh** Vite (`--force` if needed). Paste `__perfCapture` with device = `MBP … Chrome`.

---

## Decisions (locked)

1. **Pattern yes, framework no.** Planet / galaxy / star share *principles*
   (working set only, cheaper far proxies, residency + budgets). They do **not**
   share a mega LOD engine, base class, or single chunk format. Each domain owns
   its data, shaders, streaming, and fidelity knobs.
2. **Fidelity is per-domain.** “Modular” means each implementation is free to use
   the representation that looks best at that scale — clipmap tiles on planets,
   density bricks (or improved raymarch) in the galaxy, surface patches + corona
   cone on stars — so long as the **frame budget** is met.
3. **60 fps hard cap** at the worst-case pose for the active domain (planet
   approach, galaxy immersion/band, star close-up). Measure with
   `?perfcapture` / `?perfcapture=passes` before and after each change.
4. **Galaxy visual parity.** Current galaxy look is dialed in. Any new approach
   (voxel bricks, half-res, impostors, step cuts) is acceptable **only if** the
   final image is near-identical to today’s disc + sector cloud + star fields at
   the same camera poses. Prefer A/B stills + side-by-side flythroughs over
   redesign. Tuning the *method* is fine; changing the *look* is not the goal.
5. **No cross-domain imports of render guts.** Shared code is limited to tiny
   pure utilities (math, budgets, hysteresis helpers, GPU timer harness). A
   planet leaf must never import a sector brick shader, and vice versa.
6. **Ship independently.** Each domain is its own PR stream and can land (or
   roll back) without blocking the others.

---

## Shared principles (interfaces only)

These are **contracts**, not a library:

| Principle | Meaning |
|-----------|---------|
| **Working set** | Only the camera’s near region pays full cost. |
| **Far proxy** | Everything else is a cheaper stand-in of the *same* field/look. |
| **Residency** | Load/unload with hysteresis; no rebuild-every-frame churn. |
| **Hard budget** | Cap leaves / bricks / steps / draw calls; degrade quality, never miss the frame. |
| **Determinism** | Same seed + pose → same content (edits aside). |
| **Measure first** | Attribute GPU vs CPU before optimizing the wrong layer. |

Optional tiny shared helpers (new module only if ≥2 domains need the same pure
function): screen-error split rule, hysteretic cell pick, leaf/brick LRU.
**Not** shared: mesh builders, shaders, atlas formats, streaming managers.

---

## Domain A — Planet (surface zone load)

**Fidelity goal:** crisp close terrain (per-fragment / bake + micro-detail),
legible continents and coastlines, living weather — without full-sphere cost.

**Representation (owned by `src/render/planet/`):**

- **Lab continuum (new budget path):** atlas-first
  [`continuum/`](../src/render/planet/continuum/) via
  `?lab=planet&engine=continuum`. Fixed mesh + height/albedo/aux masters;
  weather live. This is the path that can hit 60 fps at lab 0.8 AU without
  fragment FBM. Shipping cutover waits on A/B vs ideal ocean.
- **Legacy holdover:** cube-sphere quadtree + horizon cull + merged leaves
  until continuum wins. Keep bake-as-cache (`CACHE_BAKE` + `bake-queue`
  single-flight, lab `setBakeAuto(false)`, atlas invalidate on terrain
  fingerprint change, `uCloudCheap` lite clouds/night when cache-baked).
- Longer arc: clipmap / face-tile streaming around the sub-camera (planet v2
  Phase 3), not 3D voxels (surface is a 2D manifold). Shared data pool
  (continuum) is the identity layer those representations should read.

**Budget levers:** continuum atlas res + cheap cloud shell (half-res march if
needed); legacy `MAX_LEVEL`, `DETAIL`, `MAX_LEAVES`, shader octave/biome gates,
residency hysteresis.

**Acceptance:** lab continuum at
`?lab=planet&engine=continuum&perfcapture&au=0.8` under 16.7 ms composite
median (native Chrome); legacy `?demo=approach&perfcapture` still ≥ 60 fps
settled where previously green; no settings regression for mapped ideal
controls; continuum `lodRebuildCount` stays 0 under idle spin.
---

## Domain B — Galaxy (chunked volume, look-preserving)

**Fidelity goal:** **near-identical** to the current dialed-in look (disc
raymarch + sector clouds as unresolved-star aggregate + realistic pinpoints).
Performance via structure, not a new aesthetic.

**Representation (owned by `src/render/sector/` + galaxy shaders):**

- Keep the **shared analytic density** as the source of truth (seam continuity).
- Optional upgrade path: **per-sector sparse density bricks** sampled from that
  field — a *cache* of today’s march, not a different cloud language.
- Far field stays the existing disc impostor; near field stays one live cloud
  (+ neighbour stars). Bricks / half-res / step cuts must A/B match current
  emission, fade-with-approach, feathered bounds, and color balance.
- Do **not** voxelize the whole disc; bricks only where streaming already pays
  (resident sectors, especially dense arm/core).

**Visual parity gate (required before merge):**

1. Still frames at fixed poses: home system tier, sector band, through-disc,
   core corridor (if `?proto-fill`).
2. Side-by-side or toggle (`?galaxyLod=brick` vs default) — no obvious denser/
   thinner/foggiеr/boxier cloud.
3. Motion: fade-into-stars and disc↔cloud handoff feel unchanged.

**Budget levers:** one live march, motion-adaptive `uSteps`, half-res RT if
needed, brick occupancy skips, star count / draw-call merge (existing fill-pass
findings).

**Acceptance:** parity gate pass + ≥ 60 fps at the previously expensive poses
(immersive sector, filled corridor in frame).

---

## Domain C — Star (patch LOD + corona cone)

**Fidelity goal:** granulation, limb, spots/plages, corona streamers at close
range; clean point-of-light hand-off far away (already partly via `uDetailFade`).

**Representation (owned by `src/render/star/`):**

- Replace monolithic “always full sphere + full corona” with **view-facing
  surface patches** (or screen-error tessellation) + **corona march limited to
  the on-screen cone**.
- Cull active-region footpoints outside the view.
- Fade granulation octaves / corona steps with apparent size (extend existing
  LOD window). Do **not** invent stellar interior voxels for gameplay LOD.

**Budget levers:** patch count, corona `STEPS`, octave count, footpoint count.

**Acceptance:** close-up star ≥ 60 fps; pull-back still hands off cleanly to
bloom/icon with no popping.

---

## Modularity rules (so similarity does not become coupling)

```
src/render/
  planet/     # zone load, bake, quadtree — owns planet fidelity
  sector/     # bricks/streaming — owns galaxy chunk fidelity
  star/       # patches + corona — owns star fidelity
  perf-capture.ts   # shared measurement only
  (optional) lod-math.ts  # pure helpers only, if extracted
```

- **Feature flags per domain:** e.g. planet zone tiers, `?galaxyLod=…`, star
  patch LOD — independently togglable for A/B.
- **No shared “ChunkVolume” type** across domains. Names and formats stay local
  (`QuadNode`, `Sector` brick, star `Patch`).
- **Docs stay split:** this file = cross-cutting policy; deep design stays in
  planet v2 / sector-cloud / procedural-worlds plans.

---

## Work order (independent tracks)

| Order | Track | Why first |
|-------|--------|-----------|
| 0 | Measure each domain’s worst pose (`perfcapture`) | Avoid optimizing the wrong cost |
| 1 | Planet: residency + leaf budget + shader tiers | Known close-zoom stutter + full-screen cost |
| 2 | Planet: safe bake-as-cache re-wire | SHIPPED — see bake-queue / CACHE_BAKE / uCloudCheap |
| 3 | Galaxy: perf behind parity gate (steps/half-res → bricks if needed) | Look is sacred; change plumbing only |
| 4 | Star: patch + corona cone | Same principles, different mesh |

Tracks 3 and 4 may proceed in parallel after track 0 baselines exist.

---

## Explicit non-goals

- One universal voxel/chunk engine for planet + galaxy + star.
- Redesigning the galaxy’s visual language.
- Trading away planet close-up crispness or star surface character for an
  easier shared abstraction.
- Shipping auto-bake or brick LOD without the domain’s acceptance + (for
  galaxy) parity gate.

---

## Open questions

- Planet: clipmap vs face-tile atlas for the first streaming slice (decide after
  residency + bake-cache land).
- Galaxy: whether bricks are required after half-res + step budgets, or only for
  dense showcase sectors.
- Star: cube-sphere patches vs subdivided icosphere for the near surface.
- Exact fps measurement machine (native MBP vs headless preview) — baselines
  must be labeled by device.
