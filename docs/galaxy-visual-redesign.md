# Galaxy Visual Redesign — structural model & per-tier rendering

**Status:** approved spec — drives implementation sessions
**Date:** 2026-06-13
**Scope:** `src/render/galaxy.ts`, `src/render/shaders/galactic-disc-volume.ts`, `src/render/particles.ts`, a restored `src/render/galaxy-backdrop.ts`, `src/render/visibility.ts` (sky wiring only), exposure clamp in the post pipeline.
**Non-goals:** HUD/marker/route/label systems, raycast contracts, satellite galaxies, Sgr stream — all preserved as-is (see §3 constraints recap).

Verified repo ground truth used throughout: `KPC = 333` WU/kpc (`galaxy.ts:70`), `SOL_GAL_POS = (8.3·333, 0, 0) = (2763.9, 0, 0)` WU (`galaxy.ts:73`), `DISC_RADIUS_WU = 15·KPC = 4995` WU (`galaxy.ts:734`), box half-height `DISC_Y_HALF_WU = 400` (`galaxy.ts:738`), `uExtinction = 0.012`/WU (`galaxy.ts:780`), home system ε Eridani at galactic-local `(2765.13, −2.597, 1.665)` WU, scene origin = home via `getGalaxyOffset()`.

---

## 1. Why the current design fails from inside

The volumetric disc was tuned for one vantage — outside, looking at the slab. The extinction comment in `galaxy.ts:780` says it verbatim: *"Tuned so a typical 30-step march through dense midplane accumulates ~0.7 alpha."* That is a ray **crossing** the thin slab from outside. Put the camera at the home system and the same constants describe a different physical situation:

1. **The camera is embedded in full-strength emitting medium.** Home sits at r_norm = 0.554, 2.6 WU below midplane; the shader's vertical Gaussian `exp(-h*h*2.0)` evaluates to ≈ 0.9994 at the camera. With `side: BackSide` every view direction rasterizes interior faces, the slab test yields tNear < 0, and `tNear = max(tNear, 0.0)` correctly starts the march at the eye — the ray setup is fine; the medium is not.

2. **The mean free path is ~417 WU (1.25 kpc).** Local density ≈ 0.2 × `uExtinction` 0.012 → σ ≈ 0.0024/WU. A vertical ray accumulates τ ≈ 0.23 → a 20%-alpha warm-sepia veil over the **entire sky** (the zenith should be ≲ 0.01). Every in-plane ray saturates to alpha = 1 within ~5–6 of the 24 steps (~0.78 optical depth per step in-plane); the `transmittance < 0.01` early-exit confirms only the nearest ~2 kpc ever renders.

3. **Saturated emission-absorption is direction-independent.** For a locally uniform medium the accumulation telescopes: `accumColor = E·(1−T_total)` — every direction with τ ≳ 2 converges to the **same** local emission color E. The ray toward the Galactic Center accumulates τ ≈ 6.6 in the first 2765 WU and is extinguished before the bulge term contributes anything: Sagittarius glows exactly as much as the anticenter. The defining asymmetry of the real band is *impossible* under these constants.

4. **The transfer function crushes the geometry the model already has.** Box aspect and the vertical Gaussian (HWHM ≈ 88 WU vs radius 4995 — ~57:1) give a correct ~83:1 path-length ratio toward the GC vs the pole at Sol. But `alpha = 1−e^(−τ)` compresses 83:1 in path into 5:1 in alpha, because in-plane saturates. Auto-exposure then normalizes that low-contrast result into the uniform tan fog observed in the failed cubemap bake — and its alpha occludes the system-tier scene, crushing planets to silhouettes.

5. **Emission and opacity are one field.** The shader cannot express "bright but transparent," which is precisely what a star-field band is: integrated starlight with near-zero occlusion. Only dust should occlude — and dust lives in a layer ~3× thinner than the stars.

6. **No structure below ~1 kpc.** The fBm is 2D XZ-projected (`pUV = local.xz`), so vertical rays see a **constant** noise value (zero overhead structure), feature size is ~2.5 kpc, and 24 coarse steps average it out in-plane. Fly-through produces no parallax.

**Root cause in one sentence:** the failure is not the geometry (the vertical falloff and kpc-scale anisotropy exist) but the **transfer function** — a single coupled density used for both emission and opacity, scaled for an exterior crossing, with no emissivity/extinction split, no thin dust layer, no per-channel reddening, and no 3D small-scale structure. Patching opacity ramps cannot fix this; the medium model must change.

---

## 2. Visual truth targets (acceptance criteria)

Each item is judgeable from a screenshot. References: ESO GigaGalaxy Zoom (Brunier 2009), Mellinger panorama (PASP 2009), Gaia DR2/EDR3 sky map, NASA SVS Deep Star Maps 2020 (svs.gsfc.nasa.gov/4851 — the calibration target, galactic-coordinate plate carrée, public domain), NGC 891 / NGC 4565 (edge-on), M51 / NGC 6744 / UGC 12158 (face-on), Hurt/Spitzer 2008 roadmap (SSC2008-10).

In scene coordinates, the Galactic Center direction from home is **−X** (Sgr A* sits at scene `(−2765.13, +2.597, −1.665)`); anticenter is +X; the band's great circle is the galactic XZ plane passing within ~0.05° of the horizon-circle through those points (home is 2.6 WU ≈ 8 pc below midplane).

### 2.1 System tier (surface → heliopause): the interior band

| # | Feature | Number / reference |
|---|---------|--------------------|
| S1 | Sky away from the band is **near-black**: a great-circle band, not a veil. Vertical (galactic-pole) accumulated dust opacity < 0.01, emission column ~hz_em only. | Hakkila et al. 1997: polar A_V ≈ 0.1 ± 0.2 mag (verifier-confirmed) |
| S2 | Band is a hazy strip **~25–35° wide (FWHM)** toward the GC azimuth, visibly **narrower (~10–15°) and dimmer toward the anticenter** (+X). | Wikipedia Milky Way visibility section; band width ~30°; Sun 25 pc above a ~300 pc scale-height disc → plane bisects sky |
| S3 | **Brightness peaks toward Sagittarius (−X)**: GC-direction band core ≥ 2× (target 2–4×) the anticenter band brightness, with a distinct hot spot (Large Sagittarius Star Cloud / bulge punching through). | ESO GigaGalaxy; Mellinger; radial exponential + bulge |
| S4 | **Band-to-pole luminance ratio in [8, 30]** measured pre-tonemap. Real photometry: band 20.5–21 mag/arcsec² vs polar integrated starlight 24.24 (NGP) / 24.08 (SGP) mag/arcsec² → 17–30× (VERIFIER-CORRECTED — the researcher's "3.5–10×" was internally inconsistent; do not calibrate to it). We accept ≥ 8× to allow game-compressed range. | arXiv:1011.2941 (pole ISL, verified values); band magnitudes per Wikipedia/Mellinger |
| S5 | **Great Rift**: a dark, marbled, crisp-edged lane splitting the band lengthwise over roughly **1/3 of its circumference**, from Cygnus through Aquila/Ophiuchus, obscuring the GC region, ending near Centaurus. It must read as discrete silhouetted clouds (high-frequency edges), not a smooth gradient. | Wikipedia Great Rift: clouds at 800–1,000 pc ≈ 265–333 WU from home |
| S6 | **Color logic**: warm yellow-orange (~4,300 K Planckian) toward the bulge azimuth; tan-white along Cygnus; neutral-cool (5,500–6,500 K) toward outer-arm directions; brown-black rift; sparse magenta HII points in the plane. NO uniform blue-cyan band. | Clarkvision natural-color references; greychow.com |
| S7 | **A sunlit planet in frame crushes the band to invisibility** (correct hard-sci-fi behavior): band contribution < 1 LSB post-AgX in a lit-planet frame. Sky-only frame: band core settles 3–5 stops below mid-grey (see §6). | SpaceEngine physically-based-brightness architecture; AgX 16.5-stop window |
| S8 | Band is **positionally coherent** with the flyable galaxy: the GC hot spot, rift, and band plane must match what the arm-tier camera sees when flying out. Comparison: cubemap bake vs NASA SVS Deep Star Maps band-width-by-longitude. | NASA SVS 4851 |

### 2.2 Heliopause → sector (1000–5500 WU): leaving home

| # | Feature | Number / reference |
|---|---------|--------------------|
| H1 | **No pop** crossing the bake↔live boundary or any tier boundary: crossfade window with both representations sampling the same density (§5.4). | — |
| H2 | Climbing out of the plane: the **rift thins and migrates to the band's lower edge by camera-y ≈ +100 WU** (camera clears the ~30 WU dust slab in 2–3 scale heights); **band asymmetry (wider/brighter below) obvious by y ≈ +330 WU**; disc reads as an inclined plane by y ≈ +1,200 WU. (Geometric inference — verifier: internally consistent but unverifiable as observation; treat as design intent, not photometric truth.) | z0 = 25 pc, dust hz 80–150 pc, disc optical radius ~13–15 kpc |
| H3 | The bulge emerges as a **3D glowing ellipsoid** poking through the disc by ~1–2 kpc altitude; dust lanes silhouette against the bright side only. | M31 inclined geometry |

### 2.3 Arm tier flythrough (5500–9000 WU, forced near in-plane phi 1.3)

| # | Feature | Number / reference |
|---|---------|--------------------|
| A1 | **Parallax during flight**: 3D density structure at 17–66 WU (50–200 pc) clump scale; discrete authored dark clouds and HII regions slide against the background. No sprite-flip artifacts on anything within ~500 WU of the camera path. | jpgrenier/HZD volumetric practice; SpaceEngine sprite-matching |
| A2 | **Arm anatomy sandwich** in oblique views: dark dust lane on the arm's **inner (concave) edge** → blue young-star ridge → magenta HII bead-knots immediately downstream → diffuse warm old disc between arms. Interarm NOT empty (faint old population + feathering spurs). | Dust Lanes in Spiral Galaxies (density-wave consensus); M51 |
| A3 | Edge-on skimming: ONE crisp dark mid-plane lane inside a thicker glowing star slab; slightly ragged lane edges (vertical "chimney" texture on dust only). | NGC 891 (Howk & Savage: filaments to 0.4–1.5 kpc, along the entire length — verifier-confirmed) |

### 2.4 Galaxy exterior (9000–12000 WU, forced phi 0.35 near top-down)

| # | Feature | Number / reference |
|---|---------|--------------------|
| G1 | **Top-down structure matches Hurt/Spitzer 2008** — the shared mental model: central **bar half-length 5.0 ± 0.2 kpc = 1,665 WU at 28°** to the Sun–center line; **TWO dominant arms** (Scutum–Centaurus, Perseus) rooted at the bar ends at ~2× the amplitude of the two minor arms (Sagittarius, Norma); **Orion Spur** as a short bright partial segment containing the home marker. | SSC2008-10; Wegg, Gerhard & Portail 2015 (arXiv:1504.01401) |
| G2 | **Edge-on aspect ratio**: glowing star disc thickness (2×300 pc) vs bright diameter (~27 kpc) ≈ **1:45**. If the disc looks lens-shaped or fuzzy-thick edge-on, scale heights are wrong. The dark dust lane bisects BOTH disc and bulge glow; the bulge **punches above and below the lane** (verifier correction: NGC 891 *does* have a bulge cut by its lane; NGC 4565's bulge is prominent/boxy — do not render a bulgeless edge-on). | NGC 4565 / NGC 891, verifier-corrected |
| G3 | **Four-palette color logic**: yellow old bulge, blue young arm ridges, brown dust, magenta HII — visible simultaneously. | M51, NGC 6744 |
| G4 | **Deliberate asymmetry**: one arm slightly dominant / locally broken pitch; flocculent spur segments; **warp** (onset R ≈ 10 kpc = 3,330 WU, rim displacement ~330–400 WU at the 15 kpc truncation, line-of-nodes twist) and outer **flare** (hz roughly doubling toward the rim). Perfect symmetry reads as CGI. | Cepheid warp (arXiv:2401.13736, 2305.09343); M51's broken arm |
| G5 | Dust lanes face-on are **filamentary/marbled**, concentrated on inner arm edges; face-on overall transparency: semi-transparent disc with more opaque arms (Holwerda; the specific τ_V ≈ 0.5–1 central figure is plausible but unpinned — treat as soft target). | arXiv:0710.3776 |

---

## 3. The structural model — ONE shared analytic density

A single analytic model, implemented **once** and consumed by BOTH the volume shader and the star-particle spawner (and the CPU-side calibration tests):

- `src/render/shaders/galaxy-density.glsl.ts` — exports the GLSL chunk (functions `galaxyEmission(p) → vec3 j`, `galaxyDustKappa(p) → float κ_V`, plus the shared spiral/bar/warp helpers).
- `src/render/galaxy-density.ts` — a line-for-line TypeScript mirror of the same functions. The particle spawner samples it for population statistics; vitest integrates it numerically for the §6 calibration tests (no GPU needed in CI).

Any structural tuning edits BOTH files in the same commit (enforced by a comment header cross-referencing the two; a unit test compares TS evaluation against a small table of expected values to catch drift).

### 3.1 Parameter table (physical → world units, KPC = 333 WU/kpc)

All physical values are the verifier-corrected set (Bland-Hawthorn & Gerhard 2016 arXiv:1602.07702; McMillan 2017 arXiv:1608.00971; Gaia DR3 MDPI Galaxies 11(3):77; dust per Guo et al. 2021 / arXiv:2509.14669 / Drimmel & Spergel 2001 — see notes).

| Component | Parameter | Physical | WU | Notes |
|---|---|---|---|---|
| Geometry | Sun/home galactocentric R₀ | 8.2 ± 0.1 kpc | **2763.9 (keep repo 8.3 kpc)** | Constraint: `SOL_GAL_POS` is load-bearing for every marker — do NOT change |
| Geometry | home height above midplane | 25 ± 5 pc | −2.6 (ε Eri placement) | sign differs from Sol; visually negligible |
| Geometry | disc truncation | 15 kpc | 4,995 (`DISC_RADIUS_WU`) | keep; smooth taper, not hard cut |
| Thin stellar disc (emission) | scale length h_R | 2.5–2.6 kpc | **866** | McMillan 2.50; B-H&G 2.6 ± 0.5 |
| Thin stellar disc | scale height h_z | ~300 pc (Gaia DR3 280 ± 12.5) | **100** | exp(−\|z\|/h_z); the band's width source |
| Thick disc (emission) | scale height h_z | ~900 pc (Gaia DR3 693 ± 121) | **300** | 10–12% of thin-disc local density |
| Thick disc | scale length h_R | 3.0 kpc | 1,000 | McMillan |
| Bulge (emission) | Hernquist a | ~0.7 kpc | **233** | ρ ∝ a/(r(r+a)³). ATTRIBUTION (verifier): Hernquist is a common analytic-MW choice, NOT McMillan's bulge (he uses Bissantz-Gerhard power-law w/ cutoff) |
| Bulge vertical | box/peanut h_z | 180 pc | **60** | flatten the Hernquist vertically; boxy, not spherical (B-H&G) |
| Bar | half-length, angle | 5.0 ± 0.2 kpc @ 28° (27–33°) | **1,665 @ 28°** | Gaussian ellipsoid axis ratio ~1:2.1 in-plane |
| Spiral arms | pitch angle | 12.8° (Vallée consensus; meta 13.1 ± 0.6°) | ARM_TWIST 4.2 ↔ 13.4° — **keep** | within observed range |
| Spiral arms | count & amplitude | m = 4 log-spirals; 2 major @ ~2× amplitude of 2 minor | A_stars ≈ 0.3–0.5 (m=2 dominant), A_dust ≈ 1.5–3 sharpened | Hurt 2008 two-major-arm correction |
| Spiral arms | arm half-width | ~400 pc | **130** | sharpened cos^k mask, k ≈ 3–6 for dust |
| Dust (extinction) | thin h_z | 80–100 pc (VERIFIER: 2025 paper 81 ± 6.7; classic 100–150; Guo 2021 73) | **30** | the rift layer; ~3× thinner than stellar thin disc |
| Dust | thick h_z (optional 2nd component) | ~150–225 pc | **60 @ 20% weight** | verifier: do NOT treat 73/225 as state of the art |
| Dust | scale length h_R | D&S 2.26 kpc / LAMOST 3.19 kpc | **866 (compromise 2.6 kpc)** | tunable; flag in §8 |
| Dust | midplane extinction normalization | τ_V ≈ 1.66/kpc near plane (1.8 mag/kpc; 0.7–1.0 local) | **κ_V(midplane, R₀) ≈ 0.005/WU** | verifier-confirmed; vs current 0.012 *applied to everything* |
| Dust | per-channel reddening | CCM89 R_V = 3.1 | **κ_rgb = κ_V · (0.75, 1.00, 1.32)** | transmittance exp(−τ·vec3) → tan/amber lanes, not grey |
| Dust | clump scale (3D fBm) | 50–200 pc | **17–66** | VALUE-3D noise, 3–4 octaves, must vary in y |
| Dust lane offset | inner-edge displacement | 100–200 pc inward of stellar arm crest | **33–66** | density-wave anatomy (A2/G5) |
| Warp | onset / amplitude | R ≳ 10 kpc / ~1.2 kpc @ 16 kpc | **3,330 / ~333–400 at rim** | keep existing warp helpers, retune |
| Flare | thin h_z growth | 0.3 → 0.6 kpc by R ≈ 18 kpc | h_z(R) = 100·exp((R−2764)/R_flare), mild within truncation | asymmetry budget (G4) |
| Great Rift | authored clouds | 5–10 clouds at 800–1,000 pc | **265–333 WU from home**, along the Cygnus→Sagittarius arc | discrete ellipsoids ADDED to κ field; parallax for free |

Consistency check the model must pass (encoded as unit test, §6): vertical dust column from home ≈ κ_V·h_z_dust ≈ 0.005·30 = **τ ≈ 0.15** (matches polar A_V ≈ 0.1–0.2 mag); in-plane dust mean free path ≈ 1/1.66 kpc ≈ 0.6 kpc = **200 WU**, so in-plane emission saturates over a few kpc instead of telescoping to local color — but rays at \|b\| ≳ 3–5° clear the 30-WU dust slab quickly and integrate **unextinguished emission over kpc**, which is what makes the band ~30° wide (set by the *emission* slab, csc\|b\| path through h_z = 100 WU) while the dust carves only the narrow rift near b = 0. GC brightening comes from the radial exponential (e^{(2764−r)/866}) plus bulge along −X rays. This is the mechanism the old shader could not express.

### 3.2 What the model deliberately is NOT

- Not a fitted McMillan potential — it is a *visual* model with verifier-corrected magnitudes.
- Emission color: 3 fixed Planckian-derived RGB constants blended by population weight (bulge ~4,300 K warm, thin-disc arm ridge ~6,500–7,500 K blue-white, interarm/thick disc ~5,000 K neutral-warm), NOT per-sample blackbody math.
- HII regions and the Great Rift clouds are **authored lists** (positions in galactic-local WU) layered onto the analytic field — both the GLSL and TS sides read the same constant arrays.

### 3.3 Constraints recap (from codebase analysis — all binding)

Exported API survives unchanged: `createGalaxy()`, `getGalaxyOffset()`, `updateGalaxyLOD(camDist)`, `updateGalaxyAnimations(t)`, `updateStarStreaks(v)`, `createSectorOrb(r)`, constants `KPC`, `SOL_GAL_POS`, `GAL_SYSTEMS`. Raycast `userData.type` contracts and invisible hit spheres untouched. `KPC`/`SOL_GAL_POS`/`lyToWu` frozen (marker space). Static `uBoxMin`/`uBoxMax` stay valid because the group stays at `getGalaxyOffset()`. HMR module-registry reset pattern followed for any new module state. Shared `STAR_CAM_VELOCITY` uniform and dashed-material factory untouched. `visibility.ts` name-matched traversal (`'milky-way'`, `'background-stars'`) updated **in the same PR** that touches the legacy band. Volume draw state (NormalBlending→premultiplied variant per §4.5, depthWrite:false, BackSide, renderOrder 2) changes are confined to the volume material and documented where they alter compositing against markers.

---

## 4. Shader redesign spec — `galactic-disc-volume.ts` v2

### 4.1 Principles

1. **Emissivity j and extinction κ are constants of the medium per WU — never view-dependent.** No camera-distance opacity ramps inside the medium (the `discPresence` multiplication of `uOpacity` is deleted for the volume; see §5.3). Surface-brightness invariance guarantees one set of constants serves interior and exterior views; the auto-exposure bridges absolute levels (SpaceEngine's validated architecture).
2. **Two fields, not one**: `j(p)` (vec3, stellar emission — bright but transparent) and `κ(p)` (scalar V-band, × per-channel vector — dust, the ONLY thing that occludes).
3. **Per-channel Beer–Lambert** so dust reddens instead of greying.

### 4.2 Ray setup (camera-inside-capable — keep, it already works)

```glsl
vec3 ro = cameraPosition;
vec3 rd = normalize(vWorldPos - cameraPosition);
// slab test vs static uBoxMin/uBoxMax (unchanged)
tNear = max(tNear, 0.0);            // interior camera: march starts at the eye
float tMax = tFar;
```

### 4.3 Density evaluation (per sample, ~15–20 ALU)

```glsl
// shared chunk: galaxy-density.glsl.ts  (mirrored in galaxy-density.ts)
struct GalaxySample { vec3 j; float kappaV; };

GalaxySample sampleGalaxy(vec3 pLocal) {        // pLocal = world - uGalaxyOrigin
  float R = length(pLocal.xz);  float y = pLocal.y;
  float yw = y - warp(pLocal.xz);               // keep existing warp helper, retuned per §3.1
  float hzThin = 100.0 * flare(R);

  // EMISSION (stars) — double exponential + thick disc + boxy Hernquist bulge + bar
  float thin   = exp(-R/866.0) * exp(-abs(yw)/hzThin);
  float thick  = 0.11 * exp(-R/1000.0) * exp(-abs(yw)/300.0);
  float bulge  = hernquist(length(vec3(pLocal.x, yw*(100.0/60.0), pLocal.z)), 233.0); // y squashed → boxy
  float bar    = barEllipsoid(pLocal, 1665.0, radians(28.0));
  float armS   = 1.0 + Astars * armPattern(R, theta, /*major2x=*/true);   // m=2 dominant + m=4
  vec3 j = COL_DISC * thin * armS + COL_OLD * thick + COL_BULGE * (bulge + bar);
  j += COL_HII * hiiKnots(pLocal);              // authored list, crest-downstream of dust lane

  // EXTINCTION (dust) — thinner, clumpier, inner-edge offset, 3D noise
  float dustLane = pow(0.5 + 0.5*cos(armPhase - LANE_OFFSET), DUST_SHARP); // inner edge
  float dust = exp(-R/866.0) * ( exp(-abs(yw)/30.0) + 0.2*exp(-abs(yw)/60.0) );
  dust *= mix(0.4, 1.6, fbm3d(pLocal / CLUMP_SCALE));   // VALUE-3D, 3–4 octaves, varies in y
  dust *= (0.25 + dustLane);
  dust += riftClouds(pLocal);                   // authored discrete ellipsoids (§3.1)
  float kappaV = KAPPA_MID * dust / dustNorm;   // normalized: κ_V(midplane, R0) = 0.005/WU

  return GalaxySample(j, kappaV);
}
```

`fbm3d` octave count and `hiiKnots`/`riftClouds` list length are compile-time `#define`s so the bake variant can afford more than the live variant.

### 4.4 March loop — log steps, per-channel transmittance, analytic vertical integration

```glsl
vec3 accum = vec3(0.0);
vec3 T = vec3(1.0);
float t0 = max(tNear, 2.0), t1 = tMax;
for (int i = 0; i < STEPS; i++) {                       // STEPS: 40 live, 256 bake
  float a = (float(i) + jitter) / float(STEPS);         // jitter: blue-noise per pixel
  float t  = t0 * pow(t1/t0, a);                        // logarithmic distribution
  float tn = t0 * pow(t1/t0, (float(i)+1.0)/float(STEPS));
  float dt = tn - t;
  GalaxySample s = sampleGalaxy(toLocal(ro + rd*t));
  // analytic vertical integration: replace point-sample of exp(-|y|/hz) with its
  // closed-form average over [t, tn] along rd (elementary for exponential slabs)
  // — kills slab aliasing for near-in-plane rays at coarse dt.
  vec3 tau = s.kappaV * KAPPA_RGB * dt;                 // KAPPA_RGB = (0.75, 1.0, 1.32)
  accum += T * s.j * dt;                                // emission NOT coupled to alpha
  T *= exp(-tau);
  if (max(T.r, max(T.g, T.b)) < 0.005) break;
}
float coverage = 1.0 - dot(T, vec3(1.0/3.0));
gl_FragColor = vec4(accum * uEmissionScale, coverage);   // premultiplied compositing
```

- **Blending:** `CustomBlending` premultiplied (`One, OneMinusSrcAlpha`) replaces plain NormalBlending: emission adds (band glow over black sky) while dust coverage occludes what is behind (renderOrder 2 → the additive star Points drawn earlier ARE occluded by the rift — the principled version of what the dead dust-strand particles faked). depthWrite stays false; BackSide stays.
- **Long in-plane rays:** log distribution + the early-out (per-channel) handles them; for the live tiers the camera is outside or skimming, so paths through the thin slab are short anyway. The bake variant (256 steps, amortized, no frame budget) marches the full path — no distance clamp needed there. If a live interior march is ever wanted (cinematics), clamp at 1,650 WU (~2–3 dust mean-free-paths) + add the source-function tail `j/κ · T_clamp`.
- **Half-res option (perf reserve, Phase 6):** march into a half-resolution HDR target with per-frame blue-noise offset `fract(noise + frame%32 · φ⁻¹)`, bicubic upsample before composite (Heckel three.js recipe). Budget at full res is already fine: ~0.5–2M rays × 40 steps × ~20 ALU on the live tiers.

### 4.5 Emission calibration strategy (work WITH auto-exposure)

Reference: sunlit diffuse planet surface = **1.0 scene-linear** (physical ≈ 9.5×10³ cd/m²; 10⁵ lux × 0.3/π — verifier-confirmed). Physical band luminance 20.5–22 mag/arcsec² ≈ 1.7–6.8×10⁻⁴ cd/m² → the true gap is **~24–25 stops**, beyond AgX's 16.5-stop window (−10..+6.5 around 0.18 mid-grey, darktable AgX docs / Blender PR 106355).

**Chosen N = 14: tune `uEmissionScale` so the band's peak (GC-direction band core, integrated) lands at 2⁻¹⁴ ≈ 6.1×10⁻⁵ of the sunlit reference.** Why 14, not the physical 24–25: (a) it keeps the band genuinely invisible (< 1 LSB post-AgX) whenever a lit planet is metered — preserving the NASA-real behavior and the S7 criterion; (b) it brings the band within reach of dusk/terminator compositions where a faint band presence is artistically wanted; (c) it keeps the auto-exposure EV-min clamp (§6) in a sane range instead of demanding +20 EV of gain on sky frames. All *ratios* within the sky (band/pole 8–30×, GC/anticenter 2–4×, band 4–6 stops above the per-pixel unresolved star background) stay physical — only the absolute gap to sunlit surfaces is compressed, exactly the SpaceEngine compromise.

**The anti-pattern this replaces (delete on sight):** inflating emissivity so the galaxy "reads" at some tier, then ramping opacity by camera distance. Brightness ratios are exposure's job; the medium has one set of constants.

---

## 5. Per-tier architecture

### 5.1 Summary table

| Zoom domain (camDist, WU) | Galaxy representation | Notes |
|---|---|---|
| surface → heliopause (0.6–2800) | **Baked HDR cubemap** from scene origin (restored `galaxy-backdrop.ts`) as the sky + live resolved-star Points on top | zero per-frame march cost; replaces flat 0x020208 AND the legacy particles.ts band |
| heliopause → sector boundary (≈ 2000–3000) | **Crossfade**: bake fades down, live volume fades up | both sample the SAME density chunk → invisible handoff (H1) |
| sector / arm / galaxy (2800–12000) | **Live march**, 40 log steps, blue-noise jitter (half-res reserve) | volume `uOpacity` is constant 1.0; no presence ramp |

### 5.2 System tier: baked cubemap (decision + justification)

**Decision: origin-baked cubemap, NOT a live thin-slab march.** Justification: (a) within a system the camera moves parsecs while the galaxy is kpc away — the backdrop is angularly static to < 0.01°, so a bake is *exact*, not an approximation; (b) it permits a 256-step, full-octave, full-authored-list march amortized to a single event (system entry / boot), eliminating every per-frame cost at the tiers where the planet renderer needs the budget; (c) the production precedent is unambiguous — SpaceEngine measured 17 fps live vs > 125 fps skyboxed, Elite Dangerous bakes a per-system skybox from its galaxy DB; (d) **the reverted `galaxy-backdrop.ts` harness was architecturally sound** (WebGLCubeRenderTarget HalfFloat 1024, CubeCamera at origin, galaxy-only visibility, full-LOD force) — yesterday's fog came from the medium, which §3–4 fixes, not from the bake. Restore the harness as-is, pointing it at the v2 volume with `#define STEPS 256` and full quality defines.

Bake content rules:
- **Included:** the v2 volume box only (emission + dust). Optionally the 50 ambient nebula sprites at distance ≥ 1 kpc.
- **Excluded:** ALL HUD entities (markers, labels, rings, routes, orb), the star Points populations (kept live for parallax/identity — Gaia Sky's resolved/unresolved split), and the **core-glow sprite stack, which is deleted outright** in Phase 2 — the bulge is now real volume emission; the 2800–8000 WU camera-facing glow walls were a primary contributor to the old tan wash.
- The baked cube is applied as the scene background (renders into the HDR chain pre-tonemap, so auto-exposure and AgX treat it like any scene light).
- Re-bake triggers: boot, system change. (No per-frame cost; a re-bake is ~one heavy frame.)

### 5.3 What happens to the legacy pieces

| Piece | Fate |
|---|---|
| `particles.ts createMilkyWay` (25k ring centered on the PLAYER — positionally incoherent by construction) | **Deleted** in the same PR that ships the bake. `visibility.ts setBackgroundOpacity`'s name-matched traversal (`'milky-way'`) updated in the same change (binding constraint). |
| `particles.ts createBackgroundStars` (8k shell) | **Kept** as the resolved-foreground star layer over the bake (renamed responsibility, same name to spare the traversal), Planckian recolor optional in Phase 5. |
| Core glow sprite stack (`galaxy.ts:800–824`) | **Deleted** (bulge emission replaces it). |
| Dead shaders `galactic-disc.ts`, `galactic-dust.ts` + empty `GALAXY_LOD.dustLayerMats` | **Deleted** (confirmed zero imports); `updateGalaxyLOD` loop over `dustLayerMats` removed with the field. |
| Dust-strand particles (8k dark dots) | **Deleted** in Phase 5 — the volume's per-channel dust now actually occludes; dark additive-scene dots never could. |
| `updateGalaxyLOD` discPresence ramp | **Retained for HUD/sprite/marker layers only** (they still fade in across sector→arm); the volume material is removed from `discMats` opacity control and pinned at uOpacity 1.0. Export signature unchanged. |

### 5.4 Flythrough continuity (no pops)

1. **One density function, two renderers** — bake and live march share the GLSL chunk, so a crossfade over camDist ≈ 2000→3000 WU (inside the heliopause→sector window, below the old 2500–5500 ramp) is genuinely invisible: same band, same rift, same colors on both sides.
2. **Physically continuous density at the box skin** — the exponentials are ~0 at uBoxMin/uBoxMax; never reintroduce camera-keyed presence ramps on the medium.
3. **Volume-boundary crossing** (arm tier dives into the slab): tNear clamp + log steps + jitter mean no discontinuity at entry; the 3D clump noise provides the near-field parallax that makes penetration legible (A1).
4. Tier visibility in `visibility.ts` keeps the galaxy group at sector/arm/galaxy; the bake covers everything below. The crossfade is implemented as: background-cube intensity ↓ while volume material fades ↑ — the ONLY opacity ramp allowed, because it blends two renderings of the same medium, not the medium itself.

---

## 6. Exposure & calibration plan

Scene-linear anchors (sunlit diffuse = 1.0):

| Quantity | Target (scene-linear) | Stops vs mid-grey-metered-sunlit |
|---|---|---|
| Sunlit planet diffuse | 1.0 | reference |
| Band peak (GC core, integrated) | 2⁻¹⁴ ≈ 6.1×10⁻⁵ | −14 from reference |
| Band at anticenter | band/2..4 | S3 |
| Polar sky (integrated starlight) | band/8..30 | S4 |
| Unresolved per-pixel background floor | band − 4..6 stops | band must read as *structure* |

**Auto-exposure changes:** add an **EV-min clamp** (floor on exposure gain) to the center-weighted log-average controller. Without it, a mostly-black sky meters on the band itself and over-brightens empty space — the clamp, not emissivity, defines the night floor. Set the clamp so a settled sky-only frame at system tier puts the band peak at **0.18/2⁴ ≈ 0.011** display-linear (4 stops below mid-grey — in AgX's toe: visible, dim, photographic; chosen mid-point of the 3–5 stop target). Tune adaptation tau so re-entering a sky view from a lit-planet view re-adapts in ~2–4 s (SpaceEngine's known pain point).

**Expected settled exposure per tier** (record actuals during Phase 3 and update):
- system tier, lit planet in frame: exposure ≈ reference (metered on planet); band < 1 LSB post-AgX.
- system tier, sky-only: exposure pinned at EV-min clamp; band core ≈ 0.011 display-linear.
- sector/arm: mixed; band + star field dominate metering; expect within ~2 EV of the clamp.
- galaxy tier: disc fills viewport; exposure meters on the disc — verify the bulge does not clip to white before AgX shoulder.

**Measurement procedure:**
1. **CPU unit test (CI, no GPU):** numerically integrate the TS mirror `galaxy-density.ts` along rays from home — assert: τ_dust(pole) ∈ [0.05, 0.2]; I(b=0°, toward GC)/I(pole) ∈ [8, 30]; I(GC azimuth)/I(anticenter) ∈ [2, 4]; band FWHM toward GC ∈ [25°, 35°] and toward anticenter < 20°. Plus a GLSL↔TS drift check against a fixed sample table.
2. **GPU harness (manual + screenshot protocol):** debug overlay exposing current exposure EV; a `readPixels` probe pre-tonemap sampling band-core / anticenter / pole directions from the baked cube; log the three luminances + ratios.
3. **Regression pair (the fog-bug tripwire):** (a) lit-planet frame → assert band contribution < 1 LSB after AgX; (b) sky-only frame → band peak 3–5 stops below mid-grey. These two assertions are precisely the failure mode of the reverted bake.
4. **Side-by-side:** baked cube unwrapped to plate carrée vs NASA SVS Deep Star Maps 2020 (galactic coords) — judge band-width-by-longitude, bulge hot spot, rift arc (S8).

---

## 7. Implementation phases (small, independently shippable PRs)

### Phase 0 — Dead-code removal (trivial, unblocks everything)
**Files:** delete `src/render/shaders/galactic-disc.ts`, `src/render/shaders/galactic-dust.ts`; remove `GALAXY_LOD.dustLayerMats` + its loop in `updateGalaxyLOD` (`galaxy.ts`).
**Verify:** typecheck + game boots; galaxy tier screenshot unchanged.

### Phase 1 — Shared density model + CPU calibration tests (no visual change)
**Files (new):** `src/render/shaders/galaxy-density.glsl.ts` (GLSL chunk per §4.3), `src/render/galaxy-density.ts` (TS mirror), `src/render/galaxy-density.test.ts` (vitest).
**Content:** full §3.1 parameter set as named exported constants; emission/dust split; warp/flare/bar/arm helpers; authored `RIFT_CLOUDS` + `HII_KNOTS` arrays (initial coarse pass); numerical ray integrator in the test asserting §6.1's ratios BEFORE any shader exists.
**Verify:** `npx vitest run src/render/galaxy-density.test.ts` green — the model is proven to produce a band, not fog, before a single pixel changes. GLSL↔TS sample-table drift test green.

### Phase 2 — Volume shader v2 (exterior views first)
**Files:** rewrite `src/render/shaders/galactic-disc-volume.ts` to consume the chunk (§4.2–4.4); `galaxy.ts`: volume material uniforms (κ, emission scale, jitter texture), premultiplied custom blending, pin volume uOpacity = 1 and remove it from `discMats`; **delete the core-glow sprite stack**; keep uBoxMin/uBoxMax static (constraint).
**Verify (per §2.4):** galaxy tier top-down — bar @ 28°, two dominant arms, four-palette colors, asymmetry (G1, G3, G4); arm tier edge-on — 1:45 glowing-disc aspect, single crisp lane bisecting disc AND bulge, bulge punching through (G2); sector tier — no fog veil when skimming the slab. Typecheck + tests green.

### Phase 3 — Restore the bake; replace the system-tier sky; exposure clamp
**Files:** restore `src/render/galaxy-backdrop.ts` (CubeCamera/HalfFloat-1024 harness, `#define STEPS 256` variant); `main.ts` wiring (bake at boot, set scene background); `particles.ts` delete `createMilkyWay`; `visibility.ts` update `setBackgroundOpacity` traversal in the SAME commit; post pipeline: EV-min clamp + adaptation tau.
**Verify (per §2.1):** system-tier sky-only screenshot vs checklist S1–S8 (band ~30° toward −X, hot spot, rift arc, near-black pole); regression pair §6.3 (lit planet crushes band; sky-only settles band −4 stops); plate-carrée comparison vs NASA SVS (S8). Confirm planets/exposure unharmed at all system tiers.

### Phase 4 — Crossfade continuity
**Files:** `galaxy.ts`/`visibility.ts`/`main.ts`: camDist-windowed crossfade (≈ 2000→3000 WU) between background-cube intensity and volume fade-in; retune marker/sprite discPresence ramps against it.
**Verify (per §2.2):** screen-record heliopause→sector→arm flight: no pop at the handoff (H1); rising-out-of-plane sequence hits H2/H3 checkpoints (rift migrates by +100 WU, asymmetry by +330 WU).

### Phase 5 — Star/dust/HII coherence
**Files:** `galaxy.ts` particle spawners re-sampled from `galaxy-density.ts` statistics (two-major-arm amplitudes, bar angle 28°, populations per region); HII sprites repositioned crest-downstream of dust lanes; delete the 8k dust-strand particles; luminance-conserving handoff (where star Points fade in, subtract matched emissivity weight from the unresolved field — single shared scalar); optional Planckian recolor of the kept shell stars.
**Verify (per §2.3/§2.4):** arm flythrough shows the dust-lane→blue-ridge→HII sandwich (A2) and parallax (A1); galaxy tier still matches G1; re-run Phase-1 tests (model unchanged) + visual diff of marker positions (MUST be identical — constraint).

### Phase 6 — Polish & perf reserve (optional, independent)
Half-res march + blue-noise temporal jitter + bicubic upsample if profiling demands; NGC-891 chimney noise on dust edges; warp/flare retune; nebula sprite near-path audit (A1).

Each PR: `npm run typecheck` + `npx vitest run` outputs shown; screenshots attached against the named §2 checklist items; one concern per PR (working agreement).

---

## 8. Open questions / risks

1. **Verifier-flagged citation gaps** (do not calibrate against): the "3.5–10× band/pole" figure is wrong (use 8–30, derived from band 20.5–21 vs pole 24.08–24.24 mag/arcsec², arXiv:1011.2941); the csc\|b\| ISL fit and "25 + 250·exp(−\|b\|/20°) S10" formula are unsourced (the slab law itself is textbook physics and stands); Holwerda's central τ_V ≈ 0.5–1 face-on figure is plausible but unpinned (soft target only); dust two-component attribution corrected (Guo 2021: 73/225 pc; 2025: 81/152 pc; 2026: radius-dependent) — we use 30 WU + 60 WU @ 20% and treat exact split as tunable.
2. **Dust scale length disagreement** (D&S 2.26 kpc vs LAMOST 3.19 kpc): we picked 866 WU (2.6 kpc). If the rift looks too weak toward the anticenter, shorten toward 753 WU.
3. **Local Bubble:** home is inside a real ~100 pc low-density cavity. If the near-field fBm clump happens to be dense at the camera, faint local haze could appear; mitigation is a small authored density floor-out within ~50 WU of SOL_GAL_POS in the dust field. Decide during Phase 3 calibration.
4. **Premultiplied blending interplay:** switching the volume to custom premultiplied blending changes compositing against additive stars (intended — rift occlusion) and against depthTest:false label sprites (verify labels stay legible at arm tier).
5. **scene.background in the custom HDR chain:** confirm the background cube samples land in the HalfFloat buffer pre-tonemap with no implicit sRGB conversion (r171 background path). If not, render the cube on a far skybox mesh inside the HDR pass instead.
6. **ε Eridani ≠ Sol:** the calibration target panoramas are from Sol; home is 10.5 ly away — angular differences are far below perceptibility (< 0.1°), but the bake must use scene origin, not SOL_GAL_POS.
7. **Galaxy-tier camDist semantics:** `Game.data.camDist` at galaxy tier measures from the Sgr A* focus, not origin (constraint) — crossfade windows live entirely in system/heliopause/sector tiers where it measures from home, so no conflict; re-verify when wiring Phase 4.
8. **Exposure clamp tuning risk:** the EV-min value interacts with bloom (Karis, threshold-free) — a clamp set too high re-introduces visible noise-floor bloom on the band. Tune with bloom enabled.
9. **Arm count vs Hurt:** we keep m=4 geometry with 2× amplitude on two arms (Hurt-compatible) rather than literal m=2 — preserves existing particle spiral math. If galaxy-tier reads "four equal arms," push the major/minor ratio further before touching geometry.
10. **Performance floor:** 40 log steps full-res at sector/arm on Apple integrated GPUs is projected fine (~0.5–2M rays × ~20 ALU/step) but unmeasured; Phase 6's half-res path is the designed escape hatch — do not pre-optimize.
