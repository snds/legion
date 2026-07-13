# Procedural Planet v2 — Plan of Record

_Status: **planning**. Supersedes the P1/P2 globe approach in `procedural-worlds-plan.md`
for the surface/terrain/atmosphere layers. Owner: Sean. Guide star: **World Orogen**
(orogen.studio) — plate/cell continents as the macro structure, with our own
high-detail texturing + water + LOD on top._

## Why v2

The P1 cube-sphere globe (fBm height displaced in the vertex shader, `MAX_LEVEL=4`,
per-vertex normal) was tuned for **system-tier** viewing where a planet is a few dozen
pixels. The Generator Lab exposed close-up scrutiny, which the system was never built
for: faceted silhouette (LOD cap), blocky shading (per-vertex normal on a coarse mesh),
no true topology, no dedicated water, and inflated (non-1:1) scale. v2 rebuilds the
surface as an asset-style **LOD-master** pipeline.

## The mental model — one master, many LOD resolutions

A 3D modeler bakes the highest-detail master, then derives LOD versions for the
distances each asset is seen at. For a procedural planet the "master" is the **surface
definition** (elevation + biome + water + cover), and LOD = how finely we resolve it for
the current camera distance. Everything below is a facet of that one idea.

## Decisions locked (2026-07-12)

1. **Master representation → baked maps + procedural detail.** Bake per-planet master
   maps (cube-map faces: height, biome/albedo, water/flow, cover) at an **8K-equivalent**
   fidelity at generation/edit time; smooth transitions come from filtering. Add
   procedural high-frequency detail **in-shader** for close-up beyond the baked ceiling
   (so we are not memory-bound for extreme zoom). Architected so the bake is a cache over
   an analytic master (same function the detail shader extends).
2. **Macro shape → hybrid.** Spherical **Voronoi plates** drive continents, coastlines,
   and uplift ridges along plate boundaries (the Orogen "shapes"); **fBm/ridged** noise
   fills terrain and **dissolves the polygonal cell edges** into natural landforms.
3. **1:1 planetary scale up front.** Planets render at true radius; the LOD/camera
   distance curve and FOV are reworked to match (see Scale).
4. **Camera:** FOV **narrows** as the camera approaches a planet (telephoto "from orbit"
   feel), instead of opening.
5. **Lab UX → single-planet carousel.** The lab shows **one planet of one type**
   full-frame; a carousel lazy-loads prev/next **type** (rocky, ocean, desert, lava, gas,
   ice…). The lab is where we author the **"best average" master** per type, plus the new
   threshold controls below.

## Scale (1:1)

- `WU_PER_PC = 1000`; true `AU_TO_WU_TRUE ≈ 0.004848 WU/AU`; system tier authored at
  `AU_TO_WU = 10` then × `SYSTEM_TIER_SCALE ≈ 4.848e-4` to reach true scale.
- **Earth radius** = 6371 km = 4.264e-5 AU → **2.067e-7 WU** true (≈ **4.264e-4** in the
  authoring frame). Today's `visualRadius` gives 0.18–2.2 authoring units → **~1000–5000×
  inflated**.
- Work: replace `visualRadius` inflation with `trueRadiusWU(radiusEarth)`; extend the
  close end of the zoom/`getCamDist` curve down to ~planet-radius camDist (float32-safe
  under the floating origin, which keeps the camera near the residual origin); keep a
  bounded, optional **visual-inflation** escape hatch (VP.visualInflation) for readability
  at system framing, ramping to 1.0 (true) as you approach.

## Subsystems

### 1. Macro structure — plates + fBm (hybrid)
- Poisson/blue-noise **plate seeds** on the sphere → spherical Voronoi → per-plate base
  elevation (continental vs oceanic), motion vector; **boundary uplift** (convergent →
  ranges, divergent → rifts) as a distance-to-boundary ridge field. fBm + ridged detail
  layered on top and used to **warp the cell boundaries** so coastlines aren't polygonal.
- Deterministic from `planet.seed`; pure (unit-testable) like the current presets.

### 2. Height-map detail + shading (fix the faceting)
- **Per-fragment** height + normal (analytic gradient of the height field at the
  fragment's direction) → shading + coastlines are tessellation-independent and crisp.
- **Geometry** provides silhouette only: adaptive quadtree, **deep near the camera**
  (uncapped by a fixed `MAX_LEVEL`; bounded by per-patch screen error + a leaf/memory
  budget). Displacement samples the (baked) height master.
- Distance-scaled **detail octaves** (and a detail-normal micro-layer) added close up for
  the "8K texture" feel without geometry cost.

### 3. Water shader (its own pass)
- Sea-level shell decoupled from land: depth-tinted color from the height master,
  shoreline blend/foam, **wave normal detail whose scale follows zoom** (broad swell from
  orbit → fine ripples close), sun glint, subsurface tint. LODs independently of terrain.

### 4. Atmosphere & clouds
- **Rocky worlds:** a **single cloud layer** shell (habitable or not), animated drift.
- **Gas/ice giants:** **multiple gas layers** showing movement between upper/lower
  atmosphere (parallax between shells), banding + storms; **gas color driven by
  composition** (element mix → absorption tint). Cloud/band formation controls in the lab.

### 5. Biosphere colour — photosynthesis wavelength
- A per-planet **photosynthetic peak wavelength** threshold drives vegetation colour
  (Earth ≈ green; other stars/pigments → red/purple/etc.). Feeds the biome ramp for
  grasses/forests so cover colour is physically motivated by the host star + pigment.

### 6. Rings
- More authoring control + detail: band structure, particle size/albedo, gaps
  (resonances), opacity, tilt; shadowing already present — extend fidelity + LOD.

### 7. Camera
- FOV narrows on approach (`fovForDistance` inverted/retuned for the planet-close regime);
  smooth, motion-sickness-safe.

## Lab UX v2 (authoring surface)
- **One planet, full-frame**, of the selected type; **carousel** (prev/next type,
  lazy-loaded). The lab authors the **canonical "best average" master per type** +
  Copy-JSON/committed Save (planet-defaults.json). New controls: photosynthesis
  wavelength, cloud/gas-layer + composition colour, ring detail, macro (plate) params.

## Phased roadmap

- **Phase 0 — Scale + camera foundation.** ✅ `trueRadiusWU`, extended zoom close end,
  FOV-narrowing, floating-origin precision. Planet renders at 1:1.
- **Phase 1 — Per-fragment shading + deep adaptive LOD.** ✅ Deep quadtree LOD;
  winding fix (the real "missing faces"). Per-fragment shading landed in Phase 2b.
- **Phase 2 — Macro generator.** ✅ (a) plate Voronoi hybrid; (b) **reworked to the
  Orogen two-layer model** — see below.
- **Phase 3 — Master bake (8K cube maps) + erosion + detail-over-master.** The bake
  caches `macroHeight`, then runs **erosion passes on the grid** (hydraulic channels,
  thermal talus, glacial smoothing — a grid SIM, not an analytic term; this is the fine
  detail Orogen shows). Shader samples the eroded map + adds sub-texel procedural detail.
- **Phase 4 — Water shader.**
- **Phase 5 — Atmosphere/clouds (rocky single layer; gas multi-layer + composition).**
- **Phase 6 — Biosphere colour (photosynthesis) + rings detail.**
- **Phase 7 — Lab v2 (single-planet carousel + new authoring controls).**

Each phase: tsc + vitest green, verified in the lab, its own PR.

## Decisions locked (2026-07-13) — Orogen reference review

Reviewing the real World Orogen generator (orogen.studio) against our Phase-2 output:

6. **Plates ≠ continents (two decoupled layers).** Orogen exposes *Plates: 80* AND
   *Continents: 4* separately. Plates are fine tectonic cells whose BOUNDARIES make
   mountain ranges; continents are a coarse grouping that sets land coverage. Our v1
   Phase-2 conflated them (one plate = one blob → cellular look). **Reworked:** a
   continent field (few caps sized by `landCoverage`) sets base land/ocean shape; a
   separate plate field supplies convergent ranges / divergent rifts on top.
7. **Rebuild-on-demand is allowed.** The lab may regenerate on an explicit "Rebuild"
   (or param change) rather than every frame — heavy generation (and Phase-3 erosion) is
   fine if real-time isn't. Unlocks the grid-sim erosion the analytic shader can't do.
8. **Crispness is the bar.** No stair-stepping in shading / specular / normals; landmarks
   must be legible. **Landed:** shading is now PER-FRAGMENT (analytic height + tangent-
   space relief normal), tessellation-independent. Cell edges dissolved by a strong
   multi-scale domain warp (Orogen "Terrain Warp").
9. **Orogen param vocabulary in the lab** (Tectonics section, live + Rebuild): Plates,
   Continents, Land coverage, Size variety, Range uplift, Range width, Terrain warp.
   Still to add toward parity: Irregularity, Roughness, Erosion (Phase 3: glacial/
   hydraulic/thermal), Smoothing.

## Known gaps after Phase 2b (for Phase 3)
- **Erosion** — the hydraulic/glacial fine detail is a grid simulation; needs the bake.
- **Range realism** — convergent ranges are a smooth exp falloff now; erosion + ridged
  bake will give real foothills/valleys.
- **Perf** — per-fragment `terrainHeight` (continent + up-to-48-plate loop + fBm, ×3 for
  the gradient) is heavy at 1:1 full-screen; the bake makes it a texture fetch.

## Open questions
- Bake target/format: cube-map array PNG/EXR vs KTX2; per-face res for "8K-equivalent"
  (e.g. 6×2K faces ≈ 8K equirect) + a clipmap/detail layer for closer-than-bake.
- Bake timing: at generation (async, cached) vs on lab-edit only; runtime budget for N
  planets in a live system.
- Visual-inflation policy under 1:1 (readability at system framing vs strict 1:1).
