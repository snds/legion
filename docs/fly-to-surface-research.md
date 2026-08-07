# Fly-to-surface planet continuum — research note

**Status:** Research (2026-07-30). Complements
[`procedural-planet-research.md`](procedural-planet-research.md),
[`procedural-planet-v2-plan.md`](procedural-planet-v2-plan.md),
[`chunked-lod-60fps-plan.md`](chunked-lod-60fps-plan.md).

**Test fixture:** committed ocean guidepost
[`src/render/planet/lab-ideal.json`](../src/render/planet/lab-ideal.json)
(bake on @ 512, soft normals, tuned weather). Idempotent lab pose:
`?lab=planet&au=0.8`.

---

## 1. What Star Citizen actually cracked

Not “one mesh that gets finer.” The durable idea is a **shared planetary data
pool** whose *representation* changes with distance, while **identity** does not.

| Layer | Role |
|-------|------|
| **Genesis / data pools** | Geology, soil, temperature, humidity (+ derived slope, sunlight). Biomes, flora, scatter, and far albedo are *functions of the same fields*. |
| **Virtual Terrain (VT)** | Terrain + vegetation LOD with caching and blending so orbit→surface does not pop the *macro* shape. |
| **Object-container streaming** | Planet / POIs / stations stream as nested containers; no level load. |
| **Far shader approximation** | Distant shading *accounts for assets not yet resident* (trees/grass contribution folded into color). |
| **Weather** | Planet-scale fields (rotating weather texture / systems) drive flight model and look; not a separate “orbit weather” vs “surface weather.” |
| **Volumetric clouds** | Representation upgrade (voxels / raymarch) on Stanton; **same weather authorship**, thicker lighting. Crusader reused the tech for a gas giant. |

Digital Foundry’s Alpha 3.8 write-up is still the clearest public tech brief:
pop-in shifted from terrain to **shadow cascades and small scatter LODs**, not the
continent outline. That is the bar: macro identity stable; micro density budgets
flexible.

Wiki anchors: [Planet Tech v4](https://starcitizen.tools/Planet_Tech_v4),
[Planet Tech v5 / Genesis](https://starcitizen.tools/Planet_Tech_v5).

---

## 2. Continuum rule (for Legion)

**State is continuous; fidelity is not.**

Anything the player can name from orbit must still be *the same thing* on the
ground, even if tessellation, lighting cost, or cloud method changes:

- coastlines / basins (height master)
- climate belts (temp × moisture)
- ice extent
- weather systems (storms, cover, shadows)
- night settlement pattern (habitability field)

Allowed to change with distance: leaf density, shader octave count, cloud
*renderer* (shell → voxel march), scatter residency, shadow cascade count.

Forbidden: swapping to a different height field, freezing weather into a static
atlas at distance, or a “pretty orbit” preset that disagrees with the surface
sim.

This matches Sean’s constraint: volumetric clouds are fine **if** dynamics at
practical viewing distances stay alive (storms, flow, regional clear, lightning).

---

## 3. Legion today vs the continuum

| Concern | Legion now | Gap for fly-to-surface |
|---------|------------|------------------------|
| Height identity | Analytic `terrainHeight` / plates + optional eroded bake atlas | Bake is a cache of the same master (good). Need **clipmap / detail-over-master** for sub-texel close-up (v2 Phase 3). |
| Climate / biomes | Live Whittaker in fragment | Expensive at full-screen; must stay **same field** under cheaper LODs (downsample or atlas climate, don’t replace). |
| Weather | CPU ocean-gated cyclones + shared `cloudDensity` on shell + surface shadows | Identity is already shared. Shell ≠ volume; upgrade is **renderer only**. |
| LOD geometry | Cube-sphere quadtree + horizon cull + merged mesh | No CDLOD morph; hard leaf swaps. **Spin-frame LOD camera** causes rebuild churn (see §5). |
| Precision | Float64 store + floating origin | Ready for descent; still need RTE discipline at surface meters. |
| Far color | Impostor billboard | Does not yet approximate unloaded scatter/biome contribution (SC far-shader lesson). |

---

## 4. Volumetric clouds without killing dynamics

Reuse the **same density authority** the shell uses today (`cloudDensity` + storm
uniforms + weather clock). Change only how density is *integrated*:

1. **Orbit / lab 0.8 AU (practical):** keep shell or a **cheap low-step volume**
   (half-res RT, 8–16 steps) driven by the existing field. Prefer this over a
   static voxel bake of clouds.
2. **Close approach:** raise step count / resolution; optional sparse voxel brick
   cache *around the camera* of the live field (like sector-cloud bricks), not a
   planet-wide frozen volume.
3. **Do not** bake cloud cover into the height atlas as the only orbit look.
4. Galaxy voxel technique is relevant as **streaming bricks + LOD**, not as
   “precompute the weather once.”

Acceptance: side-by-side A/B at 0.8 AU and low orbit: storm eyes, regional clear,
and shadow motion remain recognizable; only softness / lighting richness may change.

---

## 5. Hitching diagnosis (lab-ideal ocean, 2026-07-30)

Measured in Cursor IDE browser after clearing stale interim storage:

| Condition | LOD rebuilds / s | Notes |
|-----------|------------------|-------|
| Auto-rotate **on** (daily spin) | **~0.3** (was ~1.9) | Spin-yaw gate + cooldown |
| Auto-rotate **off** | **0** | Geometry stable |
| Frame pacing (spin on) | med ~16 ms, **p95 ~375 ms** | Spikes track rebuilds |

**Root cause:** LOD camera is taken in `surfaceGroup` local space, which sits
**under `spinGroup`**. A fixed world camera therefore appears to orbit the
surface as the planet spins, repeatedly crossing `LOD_HYSTERESIS` (0.06 R).
Earlier iterations (many leaf meshes, no hard merge) paid less per rebuild and
felt smoother even when the set changed.

**Fix (shipped):** rebuild gate uses **tilt-local** camera motion (approach/orbit) plus
a **spin-yaw threshold** (`LOD_SPIN_ANGLE ≈ 12°`) and a 120 ms cooldown. Selection
still uses surface-local camera so facing leaves stay correct. Idle spin no longer
rewrites the merged mesh every hysteresis tick.

---

## 6. Continuum v1 plan of record (lab prototype)

**Status:** Parallel lab engine (`?lab=planet&engine=continuum`). Shipping
[`PlanetGlobe`](../src/render/planet/globe.ts) stays default until A/B wins.
Code: [`src/render/planet/continuum/`](../src/render/planet/continuum/).

### Architecture

- **Identity:** `PlanetDataPool` (height + albedo + aux cube atlases from
  `bakeCube` + approx climate colour). Weather stays live (clock + CPU storms).
- **Geometry:** fixed **cube-sphere** mesh (face UV + `aFace` match the bake).
  No quadtree. `lodRebuildCount` is always 0 under spin. Vertex **displacement**
  from the height atlas (sea flattened). Mesh density rises with distance tier.
- **Lighting backends** ([`lighting/`](../src/render/planet/continuum/lighting/)):
  - **Raster preview** — analytic direct + **sun-ray cloud occlusion**
    (`contCloudShadow`); “Show clouds” zeros cover **and** shadow strength.
  - **Progressive path tracer** (lab **Path Trace** toggle) — analytic sphere hit,
    atlas BRDF, cloud visibility, 1 diffuse bounce; accumulation resets on
    camera / atlas / cloud fingerprint. Exposes reservoir-friendly hooks
    (`direct`, `albedo`, …) for a later **ReSTIR DI + DDGI** WebGPU tier — not
    implemented in this pass.
- **Atmosphere:** fullscreen **ray-sphere limb** (smooth silhouette; sun-horizon
  warm filter). Not a low-facet icosphere shell.
- **Clouds:** shared `contCloudDensity` field. Thin shell at far/orbit; soft
  crossfade to **half-res volumetric raymarch** as distance approaches ~0.3 AU
  (`VOLUME_AU_START` 0.45 → full by ~0.22). Long terminator shadows from sun-ray
  extinction. Toggle off kills shell, volume, and all cloud occlusion.

### Multi-resolution atlas residency

Atlas soft-cap is **baked once at the near tier (1024)** on the initial /
Rebuild bake so approaching the surface never triggers a second atlas bake.
Height atlas uses **NearestFilter** (sharper relief normals); colour stays Linear.
Distance only changes **mesh faceRes** and a late shell↔volume cloud blend:

| View | Approx AU | Atlas res | faceRes |
|------|-----------|-----------|---------|
| Far | > 0.9 | 1024 (same bake) | 64 |
| Orbit | ≤ 0.9 | 1024 (same bake) | 96 |
| Near | ≤ 0.25 | 1024 (same bake) | 128 |

Volumetric cloud handoff starts only below ~0.16 AU (shell remains primary at 0.8 / 0.3 AU).
Erosion remains off on the continuum soft path (ideal 512×40k hydraulic is still a gap).
Lab bake-res < 128 is still honored for unit tests / light A/B only.
### Airplane / ~10k ft next gate (design lock)

Continuum stays **atlas-lit + height displacement** through low orbit. True local
chunk mesh (legacy quadtree or new surface tiles) is a **named next gate**, not
this build. Seam / acceptance pose: about **`AIRPLANE_VIEW_AU` ≈ 0.05–0.1 AU**
(altitude proxy ~10k ft class). Documented constant:
[`AIRPLANE_VIEW_AU`](../src/render/planet/continuum/globe.ts) (`0.08`).

### Settings → atlas / uniform map

| Lab control | Continuum path |
|-------------|----------------|
| Macro / warp | Height atlas via `bakeCube` — regen on commit; orography feeds moist/temp |
| Master bake / erosion | Soft-capped once at near tier (≤1024); **no** hydraulic erosion; **no** distance rebake |
| Sea level, ice, moisture, climate, ocean colours, nightLights | Albedo + aux — Whittaker climate (rain shadow / orographic / continental / patchiness); soft ice in `aux.g`; habitability in `aux.a` |
| Displacement | Live vertex displace from height |
| Cloud cover / shadow / flow / speed / cyclones / lightning | Live uniforms; sun-ray shadows; volume blend near 0.3 AU |
| Show clouds | Hides shell + volume + **all** cloud-derived shadows |
| Path Trace | Progressive settle; raster while scrubbing |
| Atmosphere tint / density | Ray-sphere limb overlays |
| Craters / canyons (macro) | Baked into height via `bakeCube` / plates |
| Full Whittaker FBM biomes | **Gap** — approx climate tint in atlas |
| ReSTIR / DDGI | **Gap** — buffer hooks only |

### Acceptance poses

```
?lab=planet&engine=continuum&au=0.8
  → PT settles; clouds off ⇒ no cloud shadows; soft ice; clustered night lights;
    smooth atmos limb

?lab=planet&engine=continuum&au=0.3
  → higher atlas tier; shell↔volume blend; long cloud shadows near terminator

?lab=planet&engine=continuum&perfcapture&au=0.8&w=1280&h=720&dpr=2
```

Panel **View → Continuum** / **Path Trace** / **Show clouds**. Ideal ocean
[`lab-ideal.json`](../src/render/planet/lab-ideal.json) remains the look target.

### A/B checklist

1. Legacy vs continuum: coasts, ice falloff (not flat paint), weather motion,
   clustered night lights, smooth atmos limb.
2. Auto-rotate on: no mesh rebuild spikes (`__labGlobe().lodRebuildCount === 0`).
3. Clouds off: no shell, no volume, no cloud shadows on the ground.
4. Composite median under 16.7 ms at 1280×720 DPR 2 in native Chrome (Cursor IDE
   browser is trend-only) for **raster** path; PT is quality/settle, not frame budget.
5. Scrub mapped ocean/macro/cloud sliders; atlases regen on commit; weather live;
   PT accumulation resets when params change.
6. Near `au=0.3`: volume blend visible; atlas already at near soft-cap (no bake flash on approach).
---

## 7. Recommended sequence

1. **Smoothness:** spin-invariant LOD selection (cheap, high user impact) — shipped for legacy.
2. **Budget at 0.8 AU:** continuum atlas path (lab) is the new budget experiment; legacy bake-as-cache remains holdover.
3. **Cloud continuum:** half-res volumetric march only if cheap shell over budget.
4. **Descent:** clipmap / face tiles + detail-over-master; impostor far color
   that samples climate summary, not a flat billboard forever.
5. **Gameplay later:** global geodesic cells + local tangent chunks
   (existing research §7) reading the same climate/geology pools.

---

## 8. Idempotent test recipe

```
# Lab ideal (committed) — legacy default
?lab=planet&au=0.8

# Continuum prototype
?lab=planet&engine=continuum&au=0.8
?lab=planet&engine=continuum&au=0.3

# Perf attribution
?lab=planet&perfcapture&au=0.8&w=1280&h=720&dpr=2
?lab=planet&engine=continuum&perfcapture&au=0.8&w=1280&h=720&dpr=2

# Hitch A/B: toggle Auto-rotate; watch lodRebuildCount via window.__labGlobe()
# Lighting A/B: Path Trace on/off; Show clouds off ⇒ no cloud shadows
```

If the panel disagrees with `lab-ideal.json`, clear
`localStorage['legion.planetLab.interim.v2']` (old key was `.interim`) or hit
**Revert**.
