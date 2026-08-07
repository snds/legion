# Continuum Aesthetic Pipeline — Design Spec

**Status:** Draft for review (2026-08-02)
**Owner:** Sean / Continuum lab  
**Scope:** Lab Continuum planet (`?lab=planet&engine=continuum`) from orbit through near-cloud approach. Shipping Legacy `PlanetGlobe` stays default until Continuum wins A/B on **look and FPS**.  
**North stars:** Space Engine (photographic light + progressive terrain), Star Citizen (shared planetary identity; representation upgrades with distance).  
**Hard FPS contract:** 60 fps composite budget at official poses (`chunked-lod-60fps-plan.md`); orbit→surface flight must stay interactive (no rebuild thrash, bounded stream).

---

## 1. Problem

Continuum streaming/perf work preserved residency budgets but drifted from Legion’s photographic / hard-SF aesthetic. Desktop stills (2026-08-01…08-02) show pale biomes, flat oceans, thin white limb, weak terminator, missing cloud shadows, coastline stair-steps, and weak planetary scale. Moisture / climate knobs often look inert because vegetation cover is over-gated.

We need one pipeline that:

1. Restores visual fidelity (color, lighting, atmosphere, clouds, scale).
2. Progressively upgrades chunk maps, then hands off to camera-local **surface** voxels near the cloud layer (Approach C).
3. Applies **publicly documented** SE / SC / Outerra / HZD / virtual-globe techniques so fidelity climbs without breaking the 60 fps orbit→surface flight budget.

---

## 2. Locked decisions

| # | Decision |
|---|----------|
| D1 | **Approach C:** cube-sphere heightfield chunks for orbit/mid; camera-local surface voxel bricks near cloud layer; cloud voxels remain parallel. |
| D2 | **Identity continuous; fidelity not.** Coastlines, climate, ice, weather, night settlement stay the same fields; only mesh/tex/volume representation changes (`fly-to-surface-research.md`). |
| D3 | **Aesthetic before more streaming chrome.** Color + material + limb + cloud shadows land before or with map upgrades; no further “FPS-only” look regressions. |
| D4 | **Lab-only** until A/B vs Legacy wins on stills *and* `?perfcapture` poses. |
| D5 | **60 fps hard** at `lab-continuum-0.8au` and approach-low; near-cloud may raise GPU cost but must keep stream hitch-free (time-budgeted builds, no full-sphere rebake on orbit). |
| D6 | Prefer techniques with **public writeups** (SE blogs, Digital Foundry / SC wiki, Outerra/GameDev, Cozzi & Ring, HZD SIGGRAPH). Proprietary internals are inspiration only where undocumented. |

---

## 3. Aesthetic north star (acceptance)

| Pose | Must read as |
|------|----------------|
| Full disc ~0.8–2 AU | Biome contrast, ocean glint, cloud shadows, soft scattering limb, hard-SF palette |
| Low orbit | Visible relief, aerial haze, soft coasts |
| Near cloud / limb | Volumetric deck + terrain through haze |
| Crescent / terminator | Jagged lit relief, colored limb, deep night (+ optional city glow) |

Reference media: `Desktop/source.mp4` (SE trailer), Desktop Continuum screenshots 2026-08-01…02, docs `planet-visual-realism.md`, `space-engine-techniques-for-legion.md`.

Legion Aesthetic Lens: cold, technical, hard-SF; **refinement at the render layer is non-negotiable**.

---

## 4. Public technique catalog (apply aggressively for FPS)

Sources are public blogs, GDC/SIGGRAPH talks, GameDev.net, engine manuals, Digital Foundry, and textbooks. Use these as **implementation recipes**, not folklore.

### 4.1 Terrain / LOD streaming

| Technique | Source | Legion application |
|-----------|--------|-------------------|
| Cube-sphere quadtree; split when texels > ~screen budget | SE terrain blogs (2017–2018); I-Novae “Procedural Terrain Rendering How-To” | Keep Continuum quadtree; refine **error metric** toward SE’s *distance-to-edge / node-size in unwarped cube coords* × FOV/LOD factor |
| Geometry grid coarser than albedo (e.g. 33² vs 256²); “virtual” levels for color | SE blog #3 | Keep ~32 mesh grid; spend budget on **albedo/normal upgrades** before extra leaves |
| **Priority generation:** height/normal before color; nearer/finer first; only visible leaves | SE blog #3 | Build queue: missing cover → height/normal → albedo upgrade → idle polish |
| Skip intermediate height gens when mesh is 8× coarser than tex | SE blog #3 | Allow tex-only upgrades on resident leaves without remeshing |
| Parent cover while children generate | SE / Ulrich chunked LOD practice | Already partial; keep parent visible + fade children in |
| Ulrich skirts for LOD cracks | Ulrich 2002; SE | Keep/extend skirts on Continuum leaves |
| CDLOD morph only if pops remain | Strugar 2010; Cozzi & Ring | Optional after sticky LOD; not day-one |
| Horizon occlusion / backface cull | Cesium / Cozzi | Keep `cullHorizon` on close view-LOD |
| Zoom-sticky full-sphere at orbit; view-LOD only when close | Legion Continuum + SC “macro identity stable” | Keep; orbit spin must not reselect leaves |
| Motion coarsen while camera moves | Common planetary practice; Legion `motionScale` | Keep; restore detail when idle |
| Time-budgeted node builds (1–2 / frame or ms budget) | SE; browser WebGL reality | Keep `CHUNK_BUILD_MS_BUDGET`; never spike frame for polish |
| Far shading approximates unloaded detail | SC Digital Foundry 3.8; Planet Tech v4/v5 | Orbit albedo should already encode biome/weather contribution; don’t wait for voxels for “green” |

### 4.2 Star Citizen–class continuum (public)

| Technique | Source | Legion application |
|-----------|--------|-------------------|
| Shared data pool (temp, humidity, geology) → biomes/albedo/scatter | SC wiki Planet Tech v4/v5; Genesis notes | Single generator fingerprint; Continuum samples same climate/plates/weather as Legacy |
| Representation upgrade with distance (VT / volumetric clouds) | Digital Foundry Alpha 3.8 | Shell → volume clouds; heightfield → surface bricks |
| Pop-in shifts to shadows/scatter LODs, not continent outline | Digital Foundry | Acceptance: coastlines stable under flight; only micro density may lag |
| Nested working set / stream around camera | OCS public descriptions | Surface + cloud bricks = camera-local residency only |
| Weather as planet-scale rotating field | Planet Tech v4 | Keep live weather clock; don’t freeze orbit weather into static atlas |

### 4.3 Atmosphere, lighting, post (FPS-friendly)

| Technique | Source | Legion application |
|-----------|--------|-------------------|
| Physically ratioed sun + auto-exposure + threshold-free bloom | SE HDR blogs; Legion `space-engine-techniques` | Continuum emits linear HDR; no self-tonemap; don’t chalk albedo to fake brightness |
| Hillaire-style / Bruneton limb & aerial perspective (cheap LUTs or analytic limb first) | Hillaire 2020; SE uses Bruneton | Phase 1: improve ray-sphere limb + warm horizon; later froxels if budget allows |
| Ocean glint via water mask × high-power specular | SE manual; Sangil Lee / Three.js Journey Earth | Strongest cheap “real planet” cue at orbit |
| Cloud shadows as offset tap of same density field | SE shells; planet-visual-realism | Shell mode: one cheap shadow multiplier; no extra volume |
| Analytic eclipse / ring shadows (no AU-scale shadow maps) | SE techniques doc | Defer until rings/lab need; don’t pay CSM for planet disc |

### 4.4 Volumetric clouds / near approach (FPS)

| Technique | Source | Legion application |
|-----------|--------|-------------------|
| Half/quarter-res raymarch + temporal update (e.g. 1/16 pixels/frame) + reprojection | HZD Schneider & Vos SIGGRAPH 2015; arXiv:1609.05344; GameDev.net threads | Near-cloud volume: **half-res RT**, interleaved updates, reuse prior when camera stable |
| Cheap empty-space steps; expensive only when density > ε | HZD | Cloud + surface brick marches |
| Camera-local bricks, not planet-wide volume bake | SC volumetrics + Legion sector-cloud pattern | `NEAR_CLOUD_AU` surface + cloud bricks |
| Same density authority orbit→surface | fly-to-surface Continuum rule | Shell and volume share `cloudDensity` / weather uniforms |

### 4.5 Precision / scale

| Technique | Source | Legion application |
|-----------|--------|-------------------|
| Floating origin / camera-relative residuals | Thorne; SC Tracy; Cozzi RTC/RTE | Already in Legion core; Continuum verts stay node-local |
| Logarithmic depth | Outerra; Ulrich | Already on renderer; all Continuum shaders keep logdepth chunks |
| Narrow FOV on approach | procedural-planet-v2-plan | Lab camera curve; sells scale without more tris |

### 4.6 Explicitly deferred (cost / WebGL)

- Full ReSTIR / DDGI (hooks only until WebGPU).  
- Planet-wide voxelization.  
- Real-time TAA for Continuum lab (stars ghost; post-tonemap SMAA first).  
- POM / 1 mm splat stacks (SE Terrain 2.0 luxury).  
- Cascaded shadow maps for AU-scale sun.

---

## 5. Architecture

```
Generators (plates, climate, weather, ice)  ← single identity
        │
        ├─► Chunk streamer (cube-sphere leaves)
        │     • orbit: uniform sticky leaves + in-place map upgrade
        │     • close: view LOD + horizon cull
        │     • priority queue + ms budget
        │
        ├─► Cloud renderer
        │     • far: shell + shadow tap
        │     • near: half-res temporal volume bricks
        │
        └─► Surface voxel bricks (near cloud only)
              • camera-local SDF/displacement bricks
              • soft blend over fine heightfield
```

### 5.1 Progressive map residency (B1)

While leaf topology is sticky (orbit):

1. Ensure coarse cover (ancestors).  
2. Upgrade resident leaf **texRes** (and optional normal bake) without changing leaf set.  
3. Remesh only when height grid must change (close LOD split).  

Queue priority (SE-inspired):

1. Missing desired leaf geometry (cover).  
2. Height / normal for visible near leaves.  
3. Albedo upgrade toward `texResForLevel` max.  
4. Idle: deepen near-camera leaves only.

### 5.2 Surface voxel handoff (B3–B4)

- Engage near `NEAR_CLOUD_AU` (tune with cloud bricks; may be slightly tighter).  
- Bricks sample **same** height + climate + plates detail.  
- Soft depth/opacity fade vs fine chunks; tear down on retreat before dropping upgraded maps.  
- Cap brick count; never full-sphere voxels.

---

## 6. Work tracks (phased)

### Track A — Aesthetic recovery

| ID | Work | Exit |
|----|------|------|
| A0 | Fix biome cover / treeline so moisture & lushDepth tint land; analytic height for climate thresholds (hex-seam lesson); curb mid-lat snow wash | Moisture visibly greens land; no chalk continents |
| A1 | Ocean water-mask specular + Fresnel; land matte; ice matte; tune wrap/ambient so night is dark | Orbit still: glint + contrast |
| A2 | Scattering-tint limb + warm horizon (replace thin white halo) | Colored limb on disc / crescent |
| A3 | Cloud shadow tap from same field; Show clouds kills shell+volume+shadows | Shadows move with weather |
| A4 | Macro geology readable from orbit (uplift, craters, canyons break albedo + silhouette) | Disc not featureless |

### Track B — Progressive maps → voxels

| ID | Work | Exit |
|----|------|------|
| B1 | In-place map upgrades + SE-style priority queue | Orbit refine without spin thrash |
| B2 | Close view-LOD densify (mesh/tex near camera) | Low-orbit ridges without voxels |
| B3 | Camera-local surface voxel bricks | Near-cloud rocky relief |
| B4 | Soft handoff + residency teardown | No pop on enter/exit |

### Track C — Lighting, scale, AA

| ID | Work | Exit |
|----|------|------|
| C1 | Lighting ratios (lower ambient wrap; sun-dominant) | Contrast without whitening albedo |
| C2 | HDR-sane Continuum output into AgX / AE / bloom | Specular & limb bloom naturally |
| C3 | Aerial perspective / distance haze | Scale reads large |
| C4 | Approach FOV / true-scale discipline | No toy-planet feel |
| C5 | Limb/coast AA (shader prefilter; post-tonemap SMAA path where lab shares main chain) | Clean silhouettes |

### Track D — Lab / measurement

- Guidepost `lab-ideal.json`; fixed URLs for stills + `?perfcapture`.  
- Record device, pose, worst/comp med, draws, tris, `lodRebuildCount`.  
- Stills required per phase, not FPS alone.

---

## 7. FPS budget rules (orbit → surface flight)

These are **design constraints**, not afterthoughts.

1. **Orbit spin:** leaf set sticky; zero topology rebuilds from yaw alone.  
2. **Builds:** hard ms budget per frame; polish never steals cover.  
3. **Motion:** coarsen selection / reduce builds while moving; catch up when idle (SE + common practice).  
4. **Volumes:** half-res + temporal fraction; shell elsewhere.  
5. **Working set:** only camera-facing / horizon-visible fine work; full-sphere only at coarse uniform levels.  
6. **Draws:** prefer shared materials carefully (avoid one-texture-stamps-all bug); batch where safe.  
7. **Fragment cost:** bake albedo/climate to textures; do not re-run full Whittaker FBM per pixel at orbit.  
8. **Acceptance:** `lab-continuum-0.8au` under ~16.7 ms composite trend on author device; approach-low hitch-free (p95 rebuild spikes diagnosed).

If a fidelity feature breaks (7) or (8), add a **cheaper LOD path** for that distance; do not silently desaturate or flatten the look.

---

## 8. Suggested build order

1. A0 + A1 (readable color + materials)  
2. A2 + A3 (limb + cloud shadows)  
3. B1 (progressive maps + priority queue)  
4. A4 + B2 (macro relief + close densify)  
5. C1–C3 (lighting, HDR, haze)  
6. B3 + B4 (surface voxels + blend; HZD temporal volume)  
7. C4–C5 (scale + AA polish)

---

## 9. Out of scope

- Replacing Legacy as shipping default in this spec.  
- Full-planet voxels; ReSTIR/DDGI production path.  
- Nebulae / rings / HUD parity with SE trailer chrome.  
- Changing galaxy visual language.

---

## 10. Open questions (resolve during implementation plan)

1. Surface bricks: raymarch SDF vs meshed marching cubes (FPS vs caves/overhangs)? Default lean: **heightfield-displacement bricks first**, SDF if overhangs needed.  
2. Should A0 land as its own PR before B1? **Recommend yes** for still validation.  
3. Exact AU engage distance for surface bricks vs `NEAR_CLOUD_AU` (share vs tighter).

---

## 11. Spec self-review

- No TBD placeholders for core architecture; open questions listed in §10.  
- No contradiction with D1–D6 or Approach C.  
- Scope is Continuum lab aesthetic + LOD/voxel handoff + FPS rules; not a whole-engine rewrite.  
- References cite public SE/SC/Outerra/HZD/Cozzi material already mirrored in repo docs where applicable.

---

## 12. References (workspace + public)

- `docs/fly-to-surface-research.md`, `docs/planet-visual-realism.md`, `docs/space-engine-techniques-for-legion.md`, `docs/chunked-lod-60fps-plan.md`, `docs/procedural-planet-v2-plan.md`  
- SpaceEngine terrain blogs (esp. 2017-11-20 #3, 2018-03-23 #6)  
- I-Novae Forums: Procedural Terrain Rendering How-To  
- Digital Foundry: Star Citizen Alpha 3.8 tech focus; starcitizen.tools Planet Tech v4/v5  
- Outerra blog + GameDev.net chunked LOD thread (Cameni)  
- Cozzi & Ring, *3D Engine Design for Virtual Globes*  
- Schneider & Vos, HZD volumetric clouds (SIGGRAPH 2015); Toft et al. arXiv:1609.05344  
- Workspace: `01-frameworks/01-aesthetic-lens.md`, `08-knowledge/game-dev/legion-planet-surface-rendering.md`
