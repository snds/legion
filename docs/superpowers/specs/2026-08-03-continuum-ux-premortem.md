# Continuum UX premortem — regression tripwires

**Status:** Task 9 (2026-08-03)  
**Scope:** Lab Continuum before declaring UX done. Each row is a failure mode that already burned a session; tripwire is the cheapest check that catches it before ship.

---

## Cross-cutting triggers (watch these edits)

| Trigger | How it returns | Primary tripwire |
|---|---|---|
| **256² during cover** | `buildOne` / `selectChunkBuildQuality` skips stream path when `coverPending===0` by mistake, or polish runs in same tick as cover | `chunk.test.ts` — `uses stream-only quality and bans upgrades during cover`; `samples an L2 stream leaf within the soft 40ms guard` |
| **Warm queue > 16** | `MAX_WARM_CHUNKS` raised, warm runs during catch-up, warm evicts visible residents | `chunk.test.ts` — `prefetchApproachLeaves` cap; `skips warm prefetch and polish while cover catch-up is active`; pool HUD `warmPending` |
| **Sticky expires before child ready** | `shouldKeepStickyLeaf` miss budget too low, or `readyIdealCoversLeaf` false-positive | `chunk.test.ts` — `holds sticky leaves until ready replacements cover them`; `collapseToCap retains spatial coverage without face-order holes` |
| **Half-Lambert cloud regression** | `continuumCloudShellFrag` reintroduces `ndl * 0.5 + 0.5` or drops day gate | `shaders-c125.test.ts` — `cloud shell uses day-gated lighting (not half-Lambert glow)` |
| **Aerial haze `viewDist/R` at orbit** | `nearAir` gate removed; haze scales with `viewDist/R` at 0.8 AU | `shaders-c125.test.ts` — `aerial haze gates out at orbit distances` (`R * 2.4`); still `continuum-0.8-day` |

---

## P-UX (streaming product)

| ID | Symptom | Likely return path | Tripwire |
|---|---|---|---|
| **P-UX-01** | 5–10 min “baking” on 0.6→0.2 AU | Full-res upgrade in cover queue; warm flood steals ms budget; view-LOD thrash rebuilds 256² leaves | **Unit:** `stream-metrics.test.ts` (`estimateCoverSeconds`, `approachSlaPass` cover gate); `chunk.test.ts` (`caps all stream texture levels at 24`, cover catch-up tests). **Harness:** `BUDGET.md` `lab-continuum-approach` — HUD `coverPending→0` within `APPROACH_COVER_SLA_SEC`; `__perfCapture` worst frame ≤ 16.67 ms (`src/render/perf-capture.ts`) |
| **P-UX-02** | Soft forever after stream cover | `canPolishCover` stays false; `texResNextUpgrade` frozen; polish cadence = 0 | **Unit:** `chunk.test.ts` — `upgrade ladder climbs as AU decreases`; `0.3 AU ceiling allows >=96 and steps from 16`; `stream-metrics.test.ts` — fidelity gate (`facingMedianTexAt03` ≥ 96). **Harness:** `BUDGET.md` `lab-continuum-0.3au` settled; motion `approach-surface` — pause 5 s at 0.3 AU, facing coast sharpens (`NORTHSTAR.md` `legion-fly-approach`) |
| **P-UX-03** | Rectangular holes on rotate | Leaf `slice()` cap; sticky dropped before descendant ready; slow LOD refresh under `streamPressure` | **Unit:** `chunk.test.ts` — sticky + `collapseToCap`; `select under streamPressure does not reduce leafCap into hole territory`. **Harness:** `RENDER.md` / `NORTHSTAR.md` motion path `look-orient` → `render-acceptance-harness.md` `temporal_delta` / `motion_stress` on `refs/continuum/motion/look-orient/` |

---

## P-LOOK (lighting / materials)

| ID | Symptom | Likely return path | Tripwire |
|---|---|---|---|
| **P-LOOK-01** | Night clouds glow | Half-Lambert or ungated ambient on cloud shell | `shaders-c125.test.ts` cloud day-gate; motion `orbit-0.8au` + still `continuum-0.6-clouds` (`render-acceptance-harness.md`) |
| **P-LOOK-02** | Pitch-black night disc | `skyFill` / `antiSun` removed or AgX crushes fill | `shaders-c125.test.ts` — `night side gets atmospheric scatter fill`; still `continuum-0.8-night` native grid |
| **P-LOOK-03** | Ocean specular facets | Sea uses mesh normals only (radial blend dropped) | `shaders-c125.test.ts` — `mix(Nmesh, Nrad, seaW)`; still `continuum-0.3-coast` |
| **P-LOOK-04** | Visible bathymetry | Ocean depth ramp widened again | Still `continuum-0.3-coast` tile assess (bathymetry hide score 0–1 fails); coast AA in same pose |
| **P-LOOK-05** | Atmos disk wash | BackSide fresnel fills disc; aerial haze ungated at orbit | `shaders-c125.test.ts` — `abs(dot(N, V))` rim + `nearAir` / `R * 2.4`; still `continuum-0.8-day` |

---

## Pre-ship checklist (run in order)

1. `npx vitest run src/render/planet/continuum/stream-metrics.test.ts src/render/planet/continuum/chunk.test.ts src/render/planet/continuum/shaders-c125.test.ts`
2. Native Chrome: `BUDGET.md` poses `lab-continuum-0.8au`, `lab-continuum-0.3au`, scripted `lab-continuum-approach`
3. Motion: `look-orient` + `approach-surface` per `NORTHSTAR.md` / `render-acceptance-harness.md`
4. Stills: four `continuum-*` poses — any P-LOOK 0–1 score blocks done

**Done gate:** Premortem filed (this doc) + triple gate (#12 still + motion + budget) green on declared hardware.
