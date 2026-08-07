# Continuum fidelity QA notes (2026-08-06)

Automated full harness (`npm run accept:continuum`) after fixing black WebGL captures
(`?accept=1` → `preserveDrawingBuffer`, Playwright page clip screenshots).

Artifacts: `refs/continuum/{stills,motion,perf,qa}/`.  
NORTHSTAR plates (author-provided): `refs/continuum/stills/NORTHSTAR/` + `refs/continuum/motion/NORTHSTAR/`.  
Review copies: `refs/continuum/qa/northstar-review/`.

## Harness status

| Gate | Result | Notes |
|---|---|---|
| Stills | Captured 1920×1080 | Day/night/coast/clouds; UI chrome still leaks into frames |
| Perf (auto Chromium) | 0.8 AU 4.7 ms / 0.3 AU 10.5 ms | **Not authoritative** vs author Chrome (~15 / ~32 ms) |
| Motion | approach / orbit / look-orient PNG sequences | Toolkit temporal MAD “OK”; visual seam remains |
| NORTHSTAR | Unsigned | Night≈day, cloud seam, hard white limb, soft 0.3 AU; SE same-pose Earth day/coast still missing |

## Visual findings (files)

1. **Overcast identity** — Terran Continuum reads as a white cloud/ice ball. Lab copy says ~67% cloud. SE Earth identity (blue ocean, green continents through breaks) is mostly hidden. SC Fairo/Obsidian show multi-material surface through thin atmos.
2. **Cloud center V / seam** — Chevron / mirrored V across the disc center on day, night, clouds, and approach frames. Primary fidelity blocker vs SE/SC cloud language; related to prior deck flash.
3. **Night still failed** — `continuum-0.8-night.png` is nearly the same as day. Accept `poseSun('night')` and/or night lighting insufficient.
4. **Hard white limb** — Thin aliased white ring; missing Rayleigh cyan/blue graze (SC Fairo/Pyro/Obsidian) and warm terminator / eclipse rim (SE).
5. **Flat cloud lighting** — Little self-shadow or ground shadow; deck reads as a sticker vs SC Pyro I cast shadows.
6. **0.3 AU soft** — HUD `medianTex~20` after settle; fidelity climb SLA (96+) not met in capture.
7. **Approach** — Distance changes correctly; seam rides with camera; close frames show more ocean but stay mushy vs SE close Earth / SC coast language.
8. **Histogram crush** — Toolkit flags ~44% floor pixels (space black). Expected; not a planet defect.

## Fidelity improvement list (priority)

_Superseded ranking — see § NORTHSTAR re-eval below for rationale. Quick list:_

1. **Remove cloud cube-face V/seam** — Fix cloud shell mapping / noise continuity across the facing hemisphere.
2. **Rayleigh limb + warm terminator / night rim** — Replace hard white shell with cyan/blue graze; night must rim-lit.
3. **Night pose + night disc** — Make night stills actually night (`poseSun` + skyFill/antiSun).
4. **Terran cloud cover + ground shadows** — Thin opacity/coverage so continents read; cast soft cloud shadows on surface.
5. **Cloud thickness / self-shadow cue** — Cheap volume hint without full SC V5 raymarch.
6. **Close-AU albedo climb** — Facing median tex ≥96 within idle SLA at 0.3 AU (polish path).
7. **Ocean glint, coast AA, bathymetry hide** — Close-up P-LOOK axes vs Fairo / SE coast language.
8. **Side-light multi-material / microrelief cue** — Cheap biome variance under non-front sun (Obsidian / Genesis spirit).
9. **Accept hygiene** — Strip game HUD/dock from captures; prefer system Chrome for budget.

## Next

- Author: add same-pose SE Earth day / coast / terminator under `refs/northstars/se-planet/`.
- Build: cloud seam (#1) then limb+night (#2–3), then re-run `npm run accept:continuum`. Details in re-eval below.

---

## NORTHSTAR re-eval (2026-08-06 evening)

Official durable refs now live under:

| Role | Path |
|---|---|
| SE stills | `refs/continuum/stills/NORTHSTAR/space engine/` |
| SC stills | `refs/continuum/stills/NORTHSTAR/star citizen/` |
| SE motion | `refs/continuum/motion/NORTHSTAR/space engine/source.mp4` (~359 s, 640×360) |
| SC motion | `refs/continuum/motion/NORTHSTAR/star citizen/source.mp4` (~613 s, 640×360) |
| Review copies | `refs/continuum/qa/northstar-review/{se,sc,motion-se,motion-sc,motion-sample}/` |
| SC audio transcript | `refs/continuum/qa/northstar-review/sc-planet-tech-v5-transcript.md` (+ Whisper `sc-audio-16k.*`) |

Legacy note: earlier notes cited `refs/continuum/stills/spaceengine/`; prefer NORTHSTAR paths above.

### Visual compare (Continuum vs NORTHSTAR stills/motion)

**Continuum** (`continuum-0.8-day/night`, `0.3-coast`, `0.6-clouds`, approach motion): front-lit white overcast disc; day≈night; hard cream/white limb; center cloud V/chevron; soft close-AU; HUD leaks; no cloud cast shadow or side-light microrelief.

**Star Citizen stills** (chase language for orbit identity):

- Pyro I: volumetric cloud self-shadow + long cast shadows on ocean; cyan limb; side light / terminator.
- Fairo: fractal coasts, multi-material land/sea, thin cyan limb, liquid specular under side light.
- Obsidian: multi-material surface + specular channels + thin blue limb + wispy cloud veil.
- Pyro IV: cloud shadows + ring language (ring cast is SE-adjacent, not Continuum priority).

**Space Engine stills** (literal `se-planet` contract language):

- Thin Rayleigh / warm eclipse diamond-ring rim (`earth-eclipse-close`, Saturn eclipse plates).
- Ring shadow on gas body; dense nebula/starfield plates.
- Caveat: several SE plates are eclipse / moon-surface / ring compositions, **not** same-pose Earth day/coast matches for Continuum accept stills. `earth-day-blue` review copy is a moon+rings plate, not Terran day.

**Motion samples:**

- SC video: mostly surface WIP (mountains, canopy whitebox) plus planet-tech talk; proves Genesis ground ambition, not orbit accept poses.
- SE video: icy/airless body texture climb and sharp limb; proves progressive surface detail, weaker Terran atmos match.

### SC audio technical takeaways (Whisper `base`)

Source discusses CIG Planet Tech V5 + Genesis (Ali Brown Spectrum answers, community recap):

1. **Incremental ship** — V5/Genesis features land bit-by-bit when ready (clouds, biomes, weather, art-placed locations), not a single swap.
2. **Genesis planet creation ~75%** — infrastructure mostly done; remaining = important visual features + **two major performance tech changes**.
3. **Rollout one planet first** — then more biomes; art process expected to speed planet production after that.
4. **Planet size increases deprioritized** — larger worlds amplify travel time and **visual repetition**; stay with current sizes for now.
5. **V5 ≠ volumetric clouds** — cloud presence/quality is art/design per body; not gated to V5 ship.
6. **Better planetary clouds + biomes + dynamic weather** are named product goals; dynamic rain / Pyro I storms already shipping as weather pieces.
7. **Natural rock placement** — density follows erosion (valleys dense, elsewhere clear); rocks should read from farther for route planning (LOD/readability, not random scatter).
8. **ArcCorp is bespoke** — natural physically-inspired V5 rules do not replace city-world special case.
9. **Orbits** still planned but blocked by starmap / quantum travel / server-meshing, not the planet shader stack.
10. **Vulkan / GI** called out as separate look upgrades alongside planet tech.

### Chase vs skip (lab WebGPU Continuum)

| Chase now | Skip / defer |
|---|---|
| Seamless cloud field (no cube V) | Full SC volumetric cloud raymarch / V5 cloud system |
| Thin cyan/blue Rayleigh limb + warm night rim | Genesis art-placed POIs, building density, ArcCorp |
| Side-lit cloud self-shadow + soft ground shadows | Dynamic weather / rain systems beyond storm-gated lightning |
| Thinner Terran cover so ocean/land identity reads | Planet radius upsizing |
| Fractal coast + liquid specular + bathymetry hide | Server-meshing, orbits, quantum travel |
| Close-AU tex climb without LOD pop | Full multi-biome authoring pipeline |
| Cheap multi-material / microrelief under side light | Vulkan/GI dependency |

### Revised fidelity improvement list (priority)

Prior list was: night → cloud seam → close tex → Rayleigh → thin clouds+shadows → ocean/coast → cloud thickness → accept hygiene.

| # | Improvement | Change vs prior | Why |
|---|---|---|---|
| 1 | **Kill cloud cube-face V / center seam** | Was #2 → **#1** | Dominant Continuum artifact; blocks every SC/SE cloud comparison |
| 2 | **Rayleigh limb (thin cyan/blue graze) + warm terminator / night rim** | Was #4 → **#2**; merges night rim energy | Hard white limb is the loudest “not SE/SC” tell on every Continuum still; SC Fairo/Pyro/Obsidian all show thin cyan limb |
| 3 | **Night pose + night disc energy** | Was #1 → **#3** | Still a hard accept fail (night≈day), but seam+limb are the fidelity identity blockers once night works |
| 4 | **Thin Terran cloud cover + cast ground shadows** | Was #5 → **#4** | SC Pyro I identity; transcript names better planetary clouds; Continuum overcast hides continents |
| 5 | **Cloud self-shadow / thickness cue** | Was #7 → **#5** | SC stills; chase cheap day-gated thickness, not full V5 volumes (transcript: clouds not tied to V5) |
| 6 | **Close-AU albedo climb (medianTex ≥96)** | Was #3 → **#6** | Still required for coast SLA; demoted only because lighting/limb/seam fail first visually |
| 7 | **Ocean glint + coast AA + bathymetry hide** | Was #6 → **#7** | Fairo language; P-LOOK-03/04 |
| 8 | **Side-light multi-material / microrelief cue** | **NEW** | Obsidian + Genesis biome talk; cheap material variance under non-front sun |
| 9 | **Accept capture hygiene** | Was #8 → **#9** | HUD/dock pollution; system Chrome for budget |

### Signing status

- `se-planet`: **cannot sign** `reference_match` yet. Missing same-pose SE Earth day / coast / terminator plates under `refs/northstars/se-planet/` (or documented crops from NORTHSTAR stills with pose alignment). Current SE plates are strong for limb/eclipse language only.
- `legion-continuum-ideal` / `legion-fly-approach`: remain **UNSIGNED** (night fail, cloud seam, soft 0.3 AU, HUD leaks, prior cloud-flash hold).
- SC assets are **spirit / technique** refs for Continuum orbit look; they do not replace `se-planet` Literal contract.

### Next build slice

1. Cloud seam (#1)  
2. Limb + night rim (#2–3)  
3. Cloud cover/shadows (#4–5)  
Then re-run `npm run accept:continuum`. Close-AU climb (#6) in parallel if stream polish work is already warm.

---

## F10 harness after F1–F9 (2026-08-06 late)

Full `npm run accept:continuum` re-run against a live Vite dev server
(`127.0.0.1:5174`) on `perf/planet-horizon-cull`, after F1 (cloud seam), F2
(Rayleigh limb/terminator), F3 (night pose), F4 (thin cover/shadows), F5
(cloud self-shadow), F6 (close-AU bake), F7 (ocean/coast), F8 (side-light
microrelief), F9 (capture hygiene) all landed. System Chrome channel still
unavailable on this machine; ran on the documented Playwright Chromium
fallback (~16 min end-to-end: 4 stills, 2 perf captures, 3 motion sequences,
9 toolkit QA jobs). Artifacts refreshed under `refs/continuum/{stills,perf,
motion,qa}/` (untracked, per Task F9/F10 convention).

### Numbers

| Metric | Result | vs prior notes |
|---|---|---|
| 0.8 AU perf, worst phase | 5.305 ms median / 10.369 ms p95 | was 4.7 ms (both non-authoritative, auto Chromium) |
| 0.3 AU perf, worst phase | 8.256 ms median / — | was 10.5 ms — improved |
| 0.3 AU medianTex (settle) | **96** | was ~20 — F6 fix confirmed closing the gap |
| 0.6 AU medianTex (settle) | 96 | new datapoint, meets floor |
| 0.8 AU medianTex (settle) | 160 | already above floor (far AU, cheap) |
| Motion frames | 120 + 144 + 96, all written clean | matches F9 verify counts |
| orbit-0.8au temporal MAD | 1.89 mean / 1.96 max — clean | no findings |
| look-orient temporal MAD | 12.22 mean — High "shimmer suspicion" (≥7.0) | new finding, not triaged |
| approach-surface motion_stress | MAD 20.65 spike at frame 97→98 (High, ≥16.0 threshold) | new finding, not triaged |
| histogram_hdr shadow crush | ~43% floor pixels on stills (High) | expected space-black, not a planet defect (unchanged from prior notes) |
| frame_budget toolkit check | Critical: TOTAL 17.905 ms > 14 ms budget at 0.3 AU | **false fail** — toolkit sums worst+baked+noplanet sequential phases as if concurrent; the `worst` row alone (8.256 ms) is under budget |

### Visual verdict (Read on refreshed stills + spot-checked motion frames)

- **Cloud V/seam — gone.** No chevron/mirrored-V artifact on any of the 4
  stills or the `approach-surface`/`orbit-0.8au` frames inspected. F1 holds.
- **Night ≠ day — fixed.** `continuum-0.8-night.png` is now clearly dim and
  blue-toned with small warm night-side lights, unambiguously distinct from
  the bright front-lit day still. F3 holds.
- **Chrome — gone.** No HUD, dock, debug overlay, or Planet Lab
  switcher visible in any inspected still or motion frame. F9 holds.
- **Cover thinner — fixed.** Ocean (blue) and continents (green/tan) read
  clearly through cloud breaks at both 0.3 AU (`coast`) and 0.8 AU
  (`day`/`night`); no longer the solid white ice-ball from the pre-F4 notes.
  F4/F7 hold.
- **Limb cyan — partial, residual gap.** The limb still reads mostly
  white/cream in these front-lit poses rather than a clearly cyan/blue
  Rayleigh graze; F2's own report already flagged this as an intentional
  narrowing (only the terminator-crossing glow was relocated off warm-white,
  the rest of the day-side rim is nominally on "the Rayleigh cyan/blue mix"
  per the shader diagnosis) but that blue tint isn't visually reading at
  capture exposure. Needs either a stronger cyan bias on the non-terminator
  rim or acceptance that the effect is intentionally subtle at this AU range.

### Residual gaps (carried forward, not fixed by this task)

1. **F6 bake hitch (watch, not blocker).** `medianTex` did hit the ≥96 floor
   for 0.3/0.6 AU in this run's settle window, but F6's own report already
   flagged the ~200 ms/leaf synchronous bake cost as "tight-to-infeasible
   worst-case" without incremental/off-thread baking. The toolkit's Critical
   `frame_budget` finding this run is the known worst+baked+noplanet
   false-sum (see Numbers table), not new evidence of a regression — still
   worth a real off-thread bake pass before trusting 0.3 AU under load.
2. **Legacy ocean cover unverified.** F4's `cloudCover: 0.44 → 0.22` change
   lands via the shared `PRESETS.ocean`, so Legacy's default ocean look
   thinned too, but F4 had no browser access to visually confirm Legacy and
   this harness only exercises the Continuum lab route (`?lab=planet&engine=
   continuum`) — Legacy is still unverified after this run.
3. **NORTHSTAR remains unsigned** (not signed by this task, per brief).
   `reference_match` still blocked on missing same-pose SE Earth day/coast/
   terminator plates under `refs/northstars/se-planet/`; on the Continuum
   side, the limb-cyan gap above is now the main open item before a
   re-attempt would even be worth scoring.
4. **New, untriaged:** `look-orient` shimmer suspicion (MAD 12.22) and an
   `approach-surface` motion spike at frame 97→98 (MAD 20.65) — both first
   appeared in this run's toolkit output; likely LOD/bake-transition pops
   given F6's known bake-cost profile, but not investigated as part of F10.
