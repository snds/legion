# Planet Visual Realism — Generative Planets That Read as Photographs

**Status:** Design doc (technical art direction synthesis), 2026-06-13
**Scope:** Planet/moon surface shading, generative texture pipeline, cloud layering, per-archetype recipes.
**Out of scope:** Atmospheric scattering (roadmap Phase 4 = Hillaire 2020 4-LUT — unchanged by this doc; the fresnel-rim shell stays as-is until then). Phase numbers in §5 are local to this doc.

**Hard constraints honored throughout** (from the shipped pipeline):

- 60 fps on WebGL2 / Three r171. All planet shading feeds the HDR HalfFloat chain (AgX, center-weighted log-average auto-exposure, threshold-free Karis bloom, post-tonemap SMAA). New shading must emit HDR-sane radiance — additive highlights bloom with **no threshold** and skew auto-exposure metering.
- Log depth buffer is active: every replacement shader keeps `#include <logdepthbuf_pars_*>` / `<logdepthbuf_*>`.
- `planet-surface.ts` is shared verbatim by planets AND moons; uniform-interface changes touch both `createPlanetMesh` (objects.ts:181) and `createMoonMesh` (objects.ts:633).
- Time semantics: spin = sim `gameTime` (deterministic on-rails); cosmetic motion = bounded wall clock (`wallClock % 1000`, main.ts:332). All cloud/storm animation below is a **pure function of t** so 1x → YR/S warp scales cleanly.
- Single-star assumption (`uSunDir = normalize(-planetPos)`) and planetshine parent lookup stay as-is.
- PlanetType truth (src/core/components.ts:134): **Rocky=0, Oceanic=1, Desert=2, GasGiant=3, IceGiant=4, Dwarf=5**.
- Per CLAUDE.md working agreement: small focused diffs, no new dependencies without flagging, typecheck/test shown per PR.

---

## 1. Current-state gaps vs photographic realism

Audit of what stands between today's renderer and "NASA photograph" (The Martian / The Expanse bar):

| # | Gap | Where | Why it reads as fake |
|---|-----|-------|----------------------|
| G1 | **No clouds anywhere.** No cloud layer, shader, shadow, or motion. | whole pipeline | Every atmospheric world looks like a painted ball. Clouds + their cast shadows are the single strongest "this is a planet" photographic tell. |
| G2 | **Albedo-only generative output.** Recipes emit pure RGB; no height, normal, roughness, specular mask, or emissive channels. | `src/render/procedural-textures.ts` | No crater relief, no ocean-only glint (spec is a whole-sphere gate today), no city lights, no lava glow. |
| G3 | **Free isotropic noise, no physical structure.** Gas giants are `sin(lat)` stripes + fBm swirl; no zonal jets, no vortices pinned at shear boundaries, no polar-turbulence transition. Terrestrials have no biome logic (ice caps are a `|cos(vπ)|>0.85` hack). Airless bodies have `|noise|` "craters" with no bowl/rim/ejecta morphology. | `procedural-textures.ts` recipes | Isotropy and uniform feature scale are the top two "procedural" tells (anisotropy aligned with flow + power-law feature hierarchy read as real — NMS GDC lessons, https://archive.org/details/GDC2015Duncan). |
| G4 | **Name-keyed recipes (7 EE planets only).** Any new fictional body falls to flat `uColor`. | `PLANET_RECIPE_MAP` | Generative archetype work requires keying by `(PlanetType, seed)`. |
| G5 | **CPU canvas bake, 100–300 ms/planet,** chunked 64 rows/rAF, serialized via `_genQueue` because the simplex perm table is module-global. | `procedural-textures.ts` | The GPU equivalent (two fullscreen-quad passes) is single-digit milliseconds (Gaia Sky moved CPU→GPU for exactly this; documented bake-vs-live example doubled 80→160 fps — https://tonisagrista.com/blog/2024/supercharging-planetary-surfaces/, https://parallelcascades.com/planet-texture-baking-part-1-equirectangular/). |
| G6 | **Uniform Lambert for every class.** No limb darkening (gas giants in photos darken hard toward the limb with a slightly *blue* limb), no oblateness (real Jupiter is ~6.5% flattened, Saturn ~9.8% — visibly squashed; Legion's are perfect spheres). | `planet-surface.ts`, `objects.ts` | Björn Jónsson's Cassini-fitted model exists and is copy-paste portable (https://bjj.mmedia.is/3dtest/jup_shading.html). |
| G7 | **Stale-enum bugs.** `objects.ts` specular gate treats type 2 as IceGiant → **Uranus/Neptune/Niflheim (IceGiant=4) get ZERO specular**; `planet-colors.ts` ATMOSPHERE_COLORS comments use the stale enum → Desert gets cyan haze, IceGiant gets grey "Dwarf" values, Dwarf(5) falls back to Rocky warm haze; the `intensity` field is defined but never consumed. | `objects.ts` createPlanetMesh, `src/render/planet-colors.ts` | Wrong archetype response before any new art lands. |
| G8 | **`uTime` = sim `gameTime`** (main.ts:375): night-storm flicker frequency scales with time compression (up to 3.15e7× at YR/S) and unbounded gameTime overflows f32 in `sin()`. The bounded cosmetic clock exists but is unused for planets. | `main.ts`, `planet-surface.ts` | Strobing/frozen lightning at warp; precision shimmer after long sessions. |
| G9 | **Palette indiscipline risk.** Hand-rolled gradient stops per recipe; no photo-sampled ramps; an IceGiant recipe could ship "cinematic cobalt Neptune," which is a known processing artifact (Irwin et al., MNRAS 2024 — Neptune is pale greenish-blue, near-identical to Uranus; https://www.ox.ac.uk/news/2024-01-05-new-images-reveal-what-neptune-and-uranus-really-look-0). | recipes | Hue errors are the fastest way to fail the hard-sci-fi bar. |
| G10 | **EE Niflheim ring path** `'/textures/saturn_ring_alpha.png'` vs Saturn's `'/textures/sol/saturn_ring_alpha.png'` — likely 404s into the procedural fallback. | `star-catalog.ts:83` | Silent content bug. |
| G11 | **Planetshine bounce color = parent's flat `uColor`,** not its texture average. | `objects.ts:438` updatePlanetShaders | Texture-first redesign must produce a representative albedo per body or moon planetshine drifts from what the player sees. |
| G12 | **Static Sol 2K JPGs decompress to full RGBA8 in VRAM** (~8 MB each with mips, ~10 bodies). | `/textures/sol/*.jpg` | KTX2/Basis ETC1S stays compressed (~4 bpp) — ~4–6× VRAM reduction (https://www.khronos.org/news/press/khronos-ktx-2-0-textures-enable-compact-visually-rich-gltf-3d-assets). |

---

## 2. Per-archetype recipe cards

Architecture rule (the deterministic-artistry contract, from NMS GDC + flow-field literature): an archetype recipe is **{photo-sampled palette ramps[] + hand-tuned parameter RANGES + structural rules}**, and the seed only *picks within ranges* — never free RGB, never unconstrained shape. Seed = existing name-hash (kept for back-compat); recipes re-keyed to `(PlanetType, seed)` with a name-override map preserving the 7 EE looks. Add a bake-time self-check: re-roll seeds whose output histogram is too uniform (no scale hierarchy) or whose hue spread leaves the archetype ramp.

Shared bake outputs per planet (see §4): **albedo RGB** + **aux RGBA** (R = cloud density, G = specular/ocean mask, B = emissive/night, A = height).

---

### 2.1 GasGiant (3) — Jupiter-class & Saturn-class sub-variants (seeded pick)

**Palette (photo-derived, https://www.schemecolor.com/jupiter-planet-colors.php / saturn-planet-colors.php):**
- Jupiter-like ramp: `#404436` (dark olive-gray belt) · `#90614D` (brown belt) · `#C88B3A` (ochre) · `#D39C7E` (copper beige) · `#A79C86` (prairie dust) · `#D2CFDA` (pale zone white-lavender). Desaturated tans/browns/creams — **not** orange stripes.
- Saturn-like ramp: light gunmetal · ivory stone · matte khaki · neutral mustard · palomino (pale butterscotch family, very low band contrast).
- Seed jitter: ramp offset + ±5–10° hue only; variation lives in **value**, not hue.

**Structure synthesis:**
1. **1D latitude band profile** — divide latitude into N seeded intervals, perturb interior boundaries with seeded noise, alternate zone/belt colors from the ramp, smoothstep steepness parameter (Andrew Yi's approach, https://andrewyibc.github.io/planet_generation/). Band counts: Jupiter-like **10–14** visible bands (real Jupiter: ~a dozen zonal jets total; belt/zone widths *vary* — EZ spans ~7°S–7°N ≈14°, NEB/SEB ≈11° — encode varying widths, not uniform 10°); Saturn-like **6–10** low-contrast bands plus one fat equatorial zone (real Saturn's equatorial eastward jet reaches ~30° latitude, ~400 m/s). Source: https://en.wikipedia.org/wiki/Atmosphere_of_Jupiter.
2. **Polar cutoff at ~|lat| 50°** — fade bands out and crossfade to mottled vortex fBm ("the alternating pattern of belts and zones continues until the polar regions at approximately 50 degrees latitude, where their visible appearance becomes somewhat muted"). High-value tell almost no hobby shader has.
3. **Turbulence:** perturb the latitude coordinate with fractal noise *before* the band lookup (amplitude/frequency = turbulence knobs); then y-stretched (~2.5×) fBm domain-warped at strength ~2.0, composited with smoothstep thresholds (0.4–0.6) for distinct cloud-deck edges, not mushy gradients (https://medium.com/@barth_29567/procedural-gas-giants-f2a61bc6bd97).
4. **Storms (a RULE, not noise):** at most **1** giant anticyclone, **2–5** medium ovals, then only small eddies (power-law sizes). Placement constrained to shear latitudes derived from the band profile (the GRS sits at ~22°S pinned *between* opposing jets, deflecting bands around it). One-shot synthesis: analytic spiral warp `theta += strength * exp(-d²/r²)` around the storm center + local shift toward the `#C88B3A`→`#90614D` brick/salmon family. Optional polish: bake-time curl-noise advection, ~100–300 ping-pong feedback iterations with clamped delta-sharpening + color reinjection, to age bands into flow-aligned filaments — <0.5 ms per iteration at 1024² (https://emildziewanowski.com/flowfields/). Seeded storm list doubles as POI/tooltip hooks.

**Cloud plan:** the surface *is* the cloud deck. Animate by **differential rotation** — `uv.x += jetProfile(lat) * uCloudTime` (wall clock), jet profile = the same 1D band profile's velocity curve; alternating jets for Jupiter-likes, fat equatorial superrotation for Saturn-likes. Bands visibly shear past each other at warp; clamp visible angular rate at extreme warp so it never strobes.

**Lighting response:** Jónsson limb darkening (class-gated): `I = cos(i)^0.85`; when `cos(e) < 0.75`, multiply by `((cos(e)/0.75)^(rp*(1-rc)) + rc)` blended by phase factor `(cos(a)+1)/2`, per-channel **R rp=0.2 rc=0.1 · G rp=0.125 rc=0.07 · B rp=0.04 rc=0.5** — this is what makes the limb go slightly blue (https://bjj.mmedia.is/3dtest/jup_shading.html). `cos(e) = dot(N,V)` is already computed. **Oblateness:** `spinGroup.scale.y` ×0.935 Jupiter-class, ×0.90 Saturn-class. Specular 0. Twilight: keep existing band, tint toward ramp's warm end.

**Night side:** near-black base; lightning flicker kept but moved to wall clock and clustered at the seeded storm latitudes (not free vnoise cells).

**Determinism constraints:** band count range, ramp choice, boundary-perturb amplitude 0.1–0.4, warp strength 1.5–2.5, storm counts as above, polar cutoff 45–55°. Reject seeds with >2 same-size large storms (uniform feature scale = fake tell).

---

### 2.2 IceGiant (4) — Uranus/Neptune-class

**Palette:** Uranus photo ramp `#D5FBFC · #BBE1E4 · #93B8BE · #65868B` (https://www.color-hex.com/color-palette/7180). **Default both sub-looks to this pale greenish-cyan family** — Neptune's cobalt is a Voyager contrast-stretch artifact (Irwin 2024); "cinematic Neptune blue" is an opt-in variant flag, not the default. Hard-sci-fi bar: NPR coverage https://www.npr.org/2024/01/11/1224129018/.

**Structure:** 2–4 *barely visible* bands (contrast ≤0.06 in value) under a heavy methane-haze low-pass (wide blur of the band profile); seeded chance (≈30%) of 1–3 bright transient cloud streaks (thin, zonal, near 30–40° lat). Almost featureless is *correct* here — resist detail.

**Cloud plan:** haze is baked in; streaks ride the differential-rotation offset like gas giants.

**Lighting:** Jónsson limb term (slightly stronger blue channel response suits methane); **fix G7 — restore `uSpecularScale 0.55` for type 4**; oblateness ×0.98. Twilight tint toward pale cyan, not the current warm defaults.

**Night side:** plain dark; no lightning.

**Determinism:** band count 2–4, contrast cap, streak count 0–3, hue confined to 170–210° band.

---

### 2.3 Oceanic (1) — terrestrial water worlds (Earth-like)

**Architecture: Gaia Sky two-pass GPU bake** (the reference pipeline, https://tonisagrista.com/blog/2021/procedural-planetary-surfaces/ + /2024/supercharging-planetary-surfaces/):
- **Pass 1 — biome map:** elevation (R), moisture (G), temperature (B) from fBm sampled on 3D unit-sphere directions (seamless by construction). Elevation: fBm 6 oct, lacunarity 2.0, gain 0.5, range mapped so sea level sits at seeded 0.45–0.65; continent shaping via a "power" exponent 1.2–2.0 on the fBm. Temperature = latitude gradient + elevation lapse + seeded noise — **ice caps come from the temperature channel**, replacing the `|cos(vπ)|>0.85` hack.
- **Pass 2 — color LUT:** a hand-painted 256×256 **moisture × elevation Whittaker LUT** per archetype (smooth gradients beat discrete bands). LUT rows: elevation [0,seaLevel] → ocean blues by depth (`#0b1d33 → #123a5e → #1f5d8a → #3a7ca5`), beach tan sliver, vegetation greens → arid tan by moisture, rock gray, snow white above 0.85. LUT PNGs become the art-direction surface — repaint, don't recode.

**Cloud plan (full treatment, §3):** dedicated cloud channel: ITCZ bright band hugging the equator (±5–8° lat, brightest), mid-latitude frontal spirals (sparse curl-advected swirls, same machinery as gas-giant vortices but sparser), marine stratus sheets; generated with the same fBm anisotropically stretched along the rotation axis (Gaia Sky's trick). Coverage 0.4–0.7 seeded.

**Lighting:** specular **through the ocean mask only** (aux G channel) — `uSpecularScale 1.0` kept but multiplied by the mask tap, so land stops glinting. Keep Blinn-Phong pow 32. Per-channel terminator treatment per §3.4. No limb-darkening term (thin atmosphere ≠ optically thick cloud deck).

**Night side:** optional **city-lights emissive** (aux B) for bodies whose catalog `status` marks them inhabited — Gaia Sky bakes emissive night lights in the same pass; clustered along coastlines (low elevation + near-sea), fed to the existing bloom chain at modest radiance (≤0.35 — HDR-sane, blooms gently with no threshold).

**Determinism:** sea level range, 2–6 continents (low-freq octave count), cap extent from temperature, LUT hue-shift ±8°, cloud coverage range. Reject seeds with <10% or >90% land.

---

### 2.4 Rocky (0) — two sub-recipes gated on `hasAtmosphere`

**(a) Airless (Mercury/Luna-class):**
- **Palette:** gray-brown 5-stop ramp (keep vulcan's), value range 0.18–0.55, near-zero chroma.
- **Structure — crater stamping (Sebastian Lague's exact formula, MIT, https://github.com/SebLague/Solar-System/.../Craters.cginc):** per crater `x = dist(pos, centre)/radius`; `cavity = x²−1`; `rimX = min(x−1−rimWidth, 0)`; `rim = rimSteepness·rimX²`; `shape = smoothMin(smoothMax(cavity, floorHeight, s), rim, s)`; `height += shape·radius`. Stamp **50–300 craters** with power-law radii (cumulative ~D⁻² — real size-frequency statistics, https://www.lpi.usra.edu/lunar/tools/lunarcratercalc/theory.pdf), floors biased shallower for large craters; stamped in **3D sphere space** during the bake (no UV pole distortion). Albedo: brighten rims; sparse fresh craters get radial ejecta-ray streaks (radial value-noise fading with distance). Height → aux A; derive a normal-ish shading term from height gradient at bake time and pre-shade subtle relief into albedo (cheap alternative to a runtime normal map at system view).
- **Lighting:** specular 0; twilight 0; hard terminator (tighten `uTerminatorSoftness` per-class toward 0.15 — airless bodies have knife-edge terminators; the current global 0.75 is an atmosphere look).
- **Night:** black + planetshine (moons already get it).

**(b) Thin-atmosphere (Mars-class):** keep pax's ridged-fBm rust recipe, upgraded: 6-stop rust ramp anchored to photography (`#b06b4c · #a35a3e · #8f4a35 · #c98a5e` family), polar CO₂/water caps from the temperature channel, seeded dark basalt provinces (low-freq mask), global dust brightness jitter ±10%. Few subdued craters (10–40, small). Twilight tint stays warm (existing Rocky `(0.95,0.45,0.20)` is right).

**Lava-world variant (seeded within Rocky, or by catalog flag):** emissive crack network = inverted ridged fBm `(1−|fbm|)^p`, thresholded to thin filaments, masked where low-freq "crust" noise is thick; colored by a blackbody ramp **900–1300 K** (deep red → orange-yellow), written to aux B. Radiance cap ~1.5 — bright enough that Karis bloom + AgX give free photographic glow, dim enough not to hijack auto-exposure when the planet fills the frame.

---

### 2.5 Desert (2) — defined in the enum, unused in the catalog; spec'd now so the archetype keying is total

**Palette:** ochre/tan family between Mars and butterscotch: `#c2956a · #d4a976 · #a87b50 · #8a6240 · #e0c391`, low chroma spread.
**Structure:** anisotropic dune fields — fBm stretched 4–8× along a seeded prevailing-wind direction (the anisotropy *is* the realism, per G3), broken by 1–3 rocky uplands (ridged fBm masks) and seeded bright salt/playa flats; no ocean; optional thin ice caps. **Clouds:** sparse (coverage 0.05–0.2), high-altitude streaks only. **Lighting:** spec 0; warm twilight; soft-ish terminator if `hasAtmosphere`. **Night:** dark; optional dust-storm-belt lightning (reuse storm flicker, very sparse). **Determinism:** wind direction, dune frequency, upland count ranges; hue confined to 25–45°.

---

### 2.6 Dwarf (5) — Pluto/Ceres-class

**Palette:** dark blue-gray base (keep helheim's) + bright ice `#cfe6ee`.
**Structure:** keep helheim's ridged fracture mask (it already reads well) + add **20–80 stamped craters** (same Lague formula) and 1–2 large seeded albedo provinces (Pluto's Sputnik-Planitia-style bright basin: one big smooth high-albedo ellipse, low-freq edge noise).
**Lighting:** spec 0 (ice glint optional at 0.2 via aux G on the fracture mask); hard terminator; twilight 0.
**Night:** black + planetshine.

**Europa-class ice variant (for moons / seeded within Dwarf):** globally bright water ice (albedo ~0.6+); **lineae** = seeded great-circle arcs with low-frequency sinusoidal deviation (cycloid chains from tidal-stress rotation), drawn at bake time as 1–2 px brown-tan strokes (`#9a7a55`) with bright ridge centerlines (real lineae are sulfur-tinted double ridges — https://en.wikipedia.org/wiki/Europa_(moon), https://www.caltech.edu/about/news/probing-mysteries-europa-jupiters-cracked-and-crinkled-moon-48593); sparse chaos-terrain patches of broken texture. Spec 0.4 via mask. Instantly reads "icy ocean moon" for pennies.

**Io-class volcanic variant:** four-color science palette — yellow (sulfur), brown (radiolytic sulfur chains), gray-white (SO₂ frost), black (fresh silicates) — with Voronoi-seeded volcanic centers stamped as radial rings (black core, red annulus `#a03a20`, fading to yellow), >100 seeded vents, mid-latitude white frost patches; faint emissive at vent cores (aux B, radiance ≤0.5).

---

## 3. Cloud layering architecture

Principle: **at system view, clouds live in the surface shader, not a shell.** One extra texture (or one aux channel) + 2 taps ≈ free; a transparent shell costs a full extra draw call per planet *and* a sorting headache against the existing additive atmosphere (renderOrder 2, depthTest hacks on ringed planets).

### 3.1 In-shader cloud compositing (all atmospheric planets)
- Sample aux **R** (cloud density) in `planet-surface.ts`; composite over surface albedo by density before lighting. Cloud albedo ≤1.0 (HDR-sane — these pixels meter into auto-exposure).
- Cost: 1 tap + a mix. Negligible.

### 3.2 Cloud shadows (the photographic multiplier)
Second tap of the same cloud channel at a sun-direction-dependent tangent-space offset, then `surface *= (1.0 − 0.5 * cloudShadow)`. **Exact offset (verifier-corrected from the source, https://sangillee.com/2024-06-07-create-realistic-earth-with-shaders/):**

```glsl
vec3 translVec = 0.0005 * inverse(vTbn) * (dot(vNormal, sunDir) * vNormal - sunDir);
```

— the tangent-plane projection of the sun direction (NOT `normal − sunDir`; the simplified form shifts shadows incorrectly). The `0.0005` magic number is the apparent cloud height; expose as VP knob. Shadows automatically stretch oblique toward the terminator. Cost: 1 more tap.

### 3.3 Animation under time-warp (pure functions of t only)
- **Differential rotation** (ships first): `cloudUv.x += jetProfile(lat) * uCloudTime`, `uCloudTime` = the bounded wall clock. Pure phase shift — zero smearing, scales perfectly from 1x to YR/S; clamp the visible angular rate at extreme warp to avoid strobing. ~3 shader lines.
- **Flow mapping** (polish): Vlachos two-sample flow mapping — per-texel 2D flow vector, two taps with phase-offset distortion, cross-blended by a triangle wave so each sample resets before distortion shows (SIGGRAPH 2010, https://alex.vlachos.com/graphics/Vlachos-SIGGRAPH10-WaterFlow.pdf; https://catlikecoding.com/unity/tutorials/flow/texture-distortion/). The velocity field from the gas-giant bake **is** the flow map — bake once, reuse forever. Animates vortices actually rotating. Cost: 2 extra taps + a blend, gas giants only.
- **Never runtime feedback advection** — accumulated state desyncs/smears under variable time-step; Emil's loop is bake-time only.

### 3.4 Terminator differential scattering (per-channel)
Applied to the **cloud color** near the terminator (verifier-corrected — the source applies it to clouds, clamped, not as a general surface day-night blend):

```glsl
clouds.r *= clamp(pow(m, 1.0), 0.2, 1.0);
clouds.g *= clamp(pow(m, 1.5), 0.2, 1.0);
clouds.b *= clamp(pow(m, 2.0), 0.2, 1.0);   // m = day-night mix
```

Reds survive longest → the cloud limb goes warm exactly at the terminator. Slots beside the existing `uTwilightTint` block (which stays for the surface).

### 3.5 Optional close-zoom shell (ONE, surface/low-orbit tiers only)
Classic +2–3% radius transparent shell, rotating at ~half surface speed, for parallax at the closest tier only. **Integration tax it must pay:** (a) register with BOTH per-frame opacity writers — `applyPlanetOpacity` (objects.ts) and `icon-system.fadeMeshes` — or it pops instead of fading; (b) slot the fragile renderOrder ladder: ring 1 → **clouds 1.5** → atmosphere 2, depthWrite false; (c) honor the ringed-planet `depthTest=false` atmosphere hack. Default: **don't build it** until §5 Phase 4 screenshots prove the in-shader composite insufficient at closest zoom.

### 3.6 Cost budget

| Item | Cost | Budget call |
|---|---|---|
| Cloud composite tap | +1 tap/fragment | free |
| Cloud shadow tap | +1 tap + TBN math | free (TBN computable from sphere normal analytically — no tangent attribute needed) |
| Terminator per-channel | ALU only | free |
| Differential rotation | ALU only | free |
| Flow mapping (gas giants) | +2 taps | free |
| Jónsson limb term | ALU only | free |
| Optional shell | +1 draw call ×1 planet | deferred; only closest tier |
| Bake-time advection (300 iters @1024²) | <0.5 ms × 300 ≈ 150 ms once, async | load-time only, queued |

Everything runtime fits inside the existing fragment budget; the planet count on screen at fragment-heavy zoom is 1–2 (angular-size culling fades the rest).

---

## 4. Texture strategy

### 4.1 Generate-once GPU equirect bake (replaces the CPU canvas loop)
- **Mechanics** (https://parallelcascades.com/planet-texture-baking-part-1-equirectangular/): fullscreen quad into an equirect `WebGLRenderTarget`; per pixel `phi = uv.x·2π`, `theta = (1−uv.y)·π`, `dir = (sinθ·cosφ, cosθ, sinθ·sinφ)`; **evaluate all noise in 3D on that unit direction**. This kills the wrap seam at source (left/right edges sample the identical 3D position) and has no polar pinch by construction (equirect still oversamples poles — wasted texels, acceptable; and Legion's top-down view *does* see poles, so 3D-noise sourcing is mandatory, not optional).
- **Two passes per Gaia Sky:** pass 1 biome/structure map → pass 2 LUT colorize into albedo + aux. GLSL simplex/fBm replaces the CPU toolkit; the LCG-seeded permutation becomes a per-bake uniform texture, which **removes the module-global perm-table re-entrancy constraint** — keep `_genQueue` anyway to bound GPU spikes at load.
- **Mip seam at the UV wrap when sampling:** fix with `textureGrad` (explicit gradients of the spherical position), not by disabling mips.
- **Readback:** keep textures as RT-backed `THREE.Texture`s (no readback needed for rendering). For the IndexedDB cache, `readRenderTargetPixels` → canvas → JPEG blob preserves the existing contract; given bake time drops to ~1 frame, the cache becomes an *optional* cold-start optimization — keep it, **bump `TEXTURE_VERSION` 2 → 3** to invalidate all old CPU bakes.

### 4.2 Resolutions and LOD
- Keep the **2048×1024 master + 512×256 LOD0** ladder — at closest zoom a planet spans ~1000 px and the visible hemisphere covers half the equirect width, so 2048 gives ~1:1 texel:pixel. 4096 only if planets ever fill full screen height (they don't, per the camDist curve).
- Aux texture: 1024×512 RGBA8 is sufficient (clouds/masks are low-frequency).
- Current delivery just overwrites `uDayTexture` sequentially (last-delivered 2K wins, no runtime LOD switching) — acceptable and unchanged. If runtime LOD switching is ever added: three.js `LOD` now has built-in hysteresis (`addLevel(object, distance, hysteresis)` — issue #14565 is closed); note it's a *fraction* of distance and one-sided (delays only complex→simple), so wrap it for a symmetric band.
- VRAM budget: ~8 MB per 2048×1024 RGBA8 with mips + ~2.7 MB aux; ×7 EE planets ≈ 75 MB worst case — fine for WebGL2 desktop; LOD0-only retention for never-visited planets is the lever if mobile ever matters.

### 4.3 Re-keying recipes
`getRecipe(type: PlanetType, seed: number, overrides?: NameOverride)` — name map retained for the 7 EE planets (vulcan→Rocky-airless, ragnarok→Rocky-thin-atmos/Desert-adjacent, romulus→Oceanic, pax→Rocky-thin, jotunheim→GasGiant-Jupiter, niflheim→IceGiant, helheim→Dwarf). Cache key becomes `ee-{name|type-seed}-lod{n}-v3`.

### 4.4 Sol bodies (real textures) — what changes
- **Convert the static 2K JPGs to KTX2 ETC1S** (one-time `toktx`/`basisu` step, loaded via `THREE.KTX2Loader` — already in Three r171); ETC1S ~4 bpp for albedo stays compressed in VRAM vs JPG's decode-to-RGBA8. UASTC (~8 bpp) only if a normal map ever ships. Flag: no runtime dependency added; build-time tool only.
- Earth gets a static aux texture (real cloud map + night lights) through the same shader path as generated worlds — the shader doesn't know the difference.
- **Limb darkening + oblateness apply regardless of texture source** — Sol's Jupiter/Saturn get the Jónsson term and squash too (Jupiter scale.y 0.935, Saturn 0.902, Uranus/Neptune 0.98).
- Fix G10: Niflheim ring path → `/textures/saturn_ring_alpha.png` does 404; either copy the asset or point at `/textures/sol/saturn_ring_alpha.png` (or intentionally keep the procedural fallback and delete the path).
- **Planetshine representative albedo (G11):** at bake completion (or KTX2 load), compute a mean color (16×8 downsample average) and store on the entity; `updatePlanetShaders` reads it instead of flat `uColor`.

### 4.5 What stays live in the fragment shader vs baked

| Baked once (equirect RT) | Live per-fragment |
|---|---|
| Band profiles, turbulence, storms, craters, biomes, lineae, palettes, cloud distribution, emissive masks, flow/velocity map | Lambert/terminator, Jónsson limb term, cloud composite + shadow taps, differential-rotation UV offset, flow-map blend, twilight, planetshine, ring shadow, lightning flicker |

Rationale: bake-vs-live doubled fps in the documented benchmark (80→160), and everything archetype-defining is static structure; everything lighting/time-dependent is cheap ALU.

---

## 5. Implementation phases — small PRs, dependency-ordered

All PRs: run `npm run typecheck` + tests, show output (per CLAUDE.md "Response expectations"). New knobs go into `VisualParams` + `DEFAULTS` + the `VP.subscribe` block (objects.ts:588). Screenshot acceptance = capture at the named zoom tier via the existing dev preview.

### Phase 1 — Correctness + lighting foundation *(no new architecture; ships alone)*
**PR 1a — stale-enum/clock/path fixes**
- `src/render/objects.ts`: specular gate → `type===1 ? 1.0 : type===4 ? 0.55 : 0.0` (real IceGiant=4; Desert=2 gets 0).
- `src/render/planet-colors.ts`: re-derive `ATMOSPHERE_COLORS` against the real enum (Rocky warm haze, Oceanic blue, Desert dusty tan, GasGiant unchanged, IceGiant pale cyan, Dwarf thin gray); delete or consume the dead `intensity` field.
- `src/main.ts:375`: pass the bounded wall clock (main.ts:332 `wallClock % 1000`) as `uTime` instead of `gameTime`.
- `src/data/star-catalog.ts:83`: fix Niflheim ring path (or intentionally null it for the procedural fallback — decide and comment).
- **Acceptance screenshots:** (1) Uranus/Neptune at orbit tier show a specular glint that Mercury lacks; (2) night-side storm flicker at 1x vs 30 DAY/S warp blinks at the same wall-clock rate; (3) Niflheim's ring renders its intended texture.

**PR 1b — gas/ice giant photographic lighting**
- `src/render/shaders/planet-surface.ts`: add `uLimbDarkening` (0/1) + the Jónsson term (cos^0.85 diffuse power; per-channel limb multiplier with ce=0.75, R 0.2/0.1, G 0.125/0.07, B 0.04/0.5).
- `src/render/objects.ts`: enable for types 3/4; set `spinGroup.scale.y` oblateness per class (0.935/0.90/0.98); per-class `uTerminatorSoftness` (airless 0.15, atmospheric keep 0.75).
- `src/render/visual-params.ts`: knobs `planetLimbK` (0.85), `planetLimbCe` (0.75), `planetOblatenessScale` (1.0 master).
- **Acceptance:** Jupiter at orbit tier — disk visibly darkens toward the limb with a faintly blue edge; silhouette measurably flattened (~6%); Moon/Mercury terminator is knife-edge vs Earth's soft one.

### Phase 2 — GPU equirect bake harness (visual parity port)
- New `src/render/texture-baker.ts`: fullscreen-quad two-pass bake into equirect RTs (3D-direction noise GLSL: simplex/fBm/ridged/voronoi + domain warp), `_genQueue` retained, IndexedDB cache via readback, `TEXTURE_VERSION = 3`.
- `src/render/procedural-textures.ts`: recipes become parameter objects consumed by the baker; CPU noise path deleted once parity confirmed.
- **Acceptance:** side-by-side EE planets v2(CPU) vs v3(GPU) — same archetype read (not pixel-identical; seeds re-rolled is fine); bake completes <50 ms/planet (console timing); no wrap seam at the antimeridian; no polar pinch top-down.

### Phase 3 — Archetype recipe cards *(3 PRs, each independently shippable after Phase 2)*
- **PR 3a — giants:** band-profile synthesis + polar cutoff + storm rules + photo ramps + Saturn/Jupiter sub-variants + Irwin-correct ice giants. Files: recipe defs + baker pass-1 shader. **Acceptance:** Jotunheim shows ≥10 bands fading above |lat| 50° with exactly one GRS-class oval at a band boundary plus its color shift; Niflheim is near-featureless pale cyan, NOT cobalt.
- **PR 3b — terrestrial/desert:** biome-map pass + Whittaker LUT PNGs (`/textures/luts/`) + Oceanic/Desert/Mars-class recipes + temperature-driven caps. **Acceptance:** Romulus shows depth-graded oceans, latitude-coherent biomes, irregular polar caps; a seeded Desert test body shows wind-aligned anisotropic dunes.
- **PR 3c — airless/dwarf/variants:** Lague crater stamping in 3D space + power-law distribution + ejecta rays; Dwarf provinces; Europa lineae + Io vents + lava-crack variants (aux B emissive). **Acceptance:** Vulcan close-up shows bowl/rim/ejecta craters at power-law sizes; a lava test body's night side shows glowing crack filaments blooming gently through the existing chain.

### Phase 4 — Cloud layer
- Baker: aux RGBA output (R cloud, G spec mask, B emissive, A height); ITCZ/spiral/stratus cloud pass for terrestrials.
- `planet-surface.ts`: `uAuxTexture` + composite tap + shadow tap (corrected tangent-projection offset, `0.0005` as VP knob `cloudShadowHeight`) + per-channel terminator cloud tint + `uCloudTime` differential rotation; ocean-masked specular; emissive add.
- `objects.ts` + `main.ts`: wire aux texture + wall-clock `uCloudTime`; both factories (planets AND moons — moons pass a null aux).
- Earth: static cloud/night-light aux texture.
- **Acceptance:** Earth/Romulus at low-orbit — clouds cast offset shadows that stretch near the terminator; cloud limb goes warm at the terminator; at 30 DAY/S warp clouds drift smoothly with zero smearing; specular confined to water.

### Phase 5 — Storm dynamics polish *(optional, after 3a + 4)*
- Bake-time curl advection (ping-pong RT, 100–300 iters, clamped delta-sharpen + reinjection) for gas giants; velocity field saved as flow map; Vlachos two-sample flow blend in the shader for rotating vortices.
- **Acceptance:** Jotunheim vortices visibly rotate at the closest tier; band edges show flow-aligned filaments instead of fBm mush.

### Phase 6 — Asset/memory + integration debt
- KTX2 ETC1S conversion of `/textures/sol/*.jpg` + `KTX2Loader` wiring (build-time tooling only — flagged, no runtime dep).
- Planetshine representative-albedo averaging (G11).
- If the close-zoom cloud shell is ever justified by Phase-4 screenshots: build it WITH dual fade-path registration (`applyPlanetOpacity` + `icon-system.fadeMeshes`) and renderOrder 1.5.
- **Acceptance:** VRAM for Sol textures drops ~4× (renderer.info / GPU profiler); moons' planetshine tint matches the parent's visible texture color.

**Dependency graph:** 1a → 1b → (2 → 3a/3b/3c → 4 → 5) ; 6 anytime after 2. Each PR is one concern, per the working agreement.
