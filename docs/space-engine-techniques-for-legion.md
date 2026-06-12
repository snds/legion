# SpaceEngine-Class Techniques for Legion

**Status:** Durable engineering reference. Compiled 2026-06-11 from 12 verified research facets on SpaceEngine (spaceengine.org, Vladimir Romanyuk), comparator engines (KSP, Elite Dangerous, Star Citizen, EVE, Outerra, Cesium, OpenSpace, Gaia Sky), and the underlying papers — cross-checked against Legion's actual source at the time of writing (three.js r0.171, WebGLRenderer, the file references below). All adversarial-verifier corrections have been applied; where a claim about SpaceEngine internals is **inference** rather than documented fact, it is marked as such. Load this document before touching `src/render/` or `src/core/` simulation code.

---

## 1. Executive summary

1. **SpaceEngine's realism is not exotic GI — it is a disciplined exposure pipeline over physically *ratioed* emitters**: physically based brightness + histogram auto-exposure + tone map + bloom-as-PSF (SE dev blogs 2017–2020); Legion's highest-leverage visual work is calibrating brightness ratios and adding auto-exposure, not new shaders.
2. **Nobody simulates N-body gravity for the world.** SpaceEngine, KSP, and Elite all propagate celestial bodies analytically from Keplerian elements (O(1) per body per frame, stable at any time warp); numeric integration is reserved for the one player-controlled vessel under thrust. Legion's on-rails architecture is correct — but its current Kepler math is wrong (P ∝ a², sheared inclination) and must be fixed.
3. **The scale problem is two orthogonal problems**: translation precision (solve with float64 sim coordinates + camera-relative/floating-origin rendering — free in JS, where every number is already a double) and depth precision (solve with per-tier depth partitioning now, reversed-Z after a three.js upgrade — **not** `logarithmicDepthBuffer`, which Legion currently has on and which disables early-Z for every material).
4. **Legion's `logarithmicDepthBuffer: true` is its most expensive renderer flag**: r171 unconditionally writes `gl_FragDepth` for every material, killing early-Z exactly where Legion has maximum overdraw (volumetric disc, sun glow, atmosphere shells). SpaceEngine tested fragment-shader log depth in 2013 and rejected it for this exact reason, shipping reversed-Z float depth in 0.980 instead (SE blogs 2013-07-16, 2015-08-03).
5. **The atmosphere answer is Hillaire 2020**, not O'Neil and not (for Legion's many-planets case) baked Bruneton: four tiny per-frame LUTs (transmittance 256×64, multi-scattering 32×32, sky-view 200×100, aerial-perspective 32³ froxels) at ~0.31 ms on a GTX 1080, fully dynamic per-planet parameterization, proven in WebGL-class fragment shaders. SpaceEngine itself ships baked Bruneton `.atm` LUTs for ~10 archetypes (documented fact, SE credits/manual).
6. **SpaceEngine's galaxies are sprite clouds, not full raymarched volumes** (DSO manual: emission/absorption/bulge sprite classes; only elliptical galaxies use a ray-tracing shader; raymarching arrived in 0.990 for *nebulae*, rendered at reduced resolution with bicubic upsampling). Legion's volumetric disc is fine — but should march at half resolution with blue-noise jitter, and be **baked to a cubemap on system entry** (the EVE/Elite pattern) so it costs nothing at system tier.
7. **Real data is shippable and licensing-clean via AT-HYG**, not raw Gaia: ESA switched Gaia archive data to CC BY-NC 3.0 IGO (verified, change bracketed 2024-05→2025-03), so a commercial title must not pull the ESA archive directly; AT-HYG v3.3 (CC BY-SA 4.0) ships ready subsets (330k stars / 27.9 MB gz, including *all* stars within 100 ly) that pack to a ~6.6 MB binary.
8. **Legion's post chain is mis-ordered and miscalibrated**: SMAA runs on linear HDR before tonemap (its edge metric is calibrated for gamma-space LDR), the canvas `antialias: true` is inert (EffectComposer's target is non-multisampled), bloom is thresholded (physically wrong; bloom is the PSF tail of *every* pixel), and ACES filmic hue-skews exactly the blackbody star colors Legion cares about (AgX, in three since r160, preserves them).
9. **Two correctness bugs are live in the codebase today**: the unbounded float32 shader clock (`main.ts:291` → `uTime` in grain/sun/galaxy shaders quantizes, stutters, then freezes over hours — fix is The Witness's wrap-at-1000 s trick), and the main loop is variable-dt despite its own comment claiming fixed-timestep (no accumulator; steering/AI integrate with warp-scaled raw dt).
10. **Profiling must precede optimization claims**: the only in-browser GPU timer on WebGL is `EXT_disjoint_timer_query_webgl2` (Chrome/Edge; Firefox never; Safari behind a flag) — a ~200-line sequential-TIME_ELAPSED harness with per-pass labels is the prerequisite for every budget claim in this document.

---

## 2. How SpaceEngine does it

SpaceEngine is a from-scratch C++/OpenGL/GLSL engine (no third-party engine code, per the official FAQ), built by astronomer Vladimir Romanyuk since 2010, now ~5–6 people at Cosmographic Software with an in-progress OpenGL→Vulkan "GPU-driven framework" migration (announced 2023; still incomplete as of late 2025 — the Nov 2025 0.991 release shipped on OpenGL). It models a cubical universe ~10 Gpc per side centered on the Solar System barycenter. Its architecture rests on three documented pillars plus one rendering discipline:

### 2.1 Deterministic hierarchical procedural generation (FACT)

Everything derives from one global seed via nested octrees: a universe-level octree of galaxies (levels 0–9) and a per-galaxy octree of stars (levels 0–8). Each octree node stores (a) a child seed (pure function of node coordinates + global seed) and (b) the **maximum luminosity** of any object inside it; brighter/rarer objects live at coarser levels. A visibility query — "could this node's brightest star exceed the apparent-magnitude cutoff (`StarMaxAppMagn`) at the camera's distance?" — prunes the tree. Node contents are generated on demand and discarded; revisits regenerate identically with zero persistent storage. Procedural designations literally encode the data structure: `RS <galaxy>-<sector>-<octree level>-<block>-<star>` (Habr 2012; SE Fandom wiki; SE blog 2018-09-21).

Documented costs of the design: visible "cubes of stars" at node boundaries and luminosity pops when crossing octree levels (Romanyuk, blog180921) — i.e., LOD transitions need magnitude-fade hysteresis — and any change to the generation algorithm is a "universe reset" that relocates every procedural object (0.991 release, blog251118).

**Open**: how SE derives star counts per node from the galaxy density profile/IMF was never published; Legion would design that from astrophysics literature (exponential disc + de Vaucouleurs bulge, Kroupa IMF).

### 2.2 Catalog pinning — "where the data ends, algorithms take over" (FACT)

~130k real objects (full HIPPARCOS, NGC/IC, all known exoplanets, Solar System bodies) are inserted at their real positions inside the same octree; the 2024 catalog update applied Gaia parallaxes to 100k+ stars (blog240417). Procedural generation fills only the gaps and adds planets to catalog stars lacking known systems, constrained by astrophysical statistics, not free noise: globular-cluster counts via specific frequency vs. galaxy magnitude (transition at M = −18.5), terrestrial mass–radius distributions calibrated to observation, brown-dwarf T_eff from Sonora evolutionary models (0.991 blog 2025-09-11). Catalog objects are editable `.sc` text files; addons can suppress procedural content per object.

This is Legion's exact design pillar. The implementation pattern: a pinned real-catalog layer plus a spatial exclusion index (k-d tree) so procedural nodes skip generation near catalog stars.

### 2.3 Hierarchical coordinate frames + Kepler-only dynamics (FACT + inference)

Positions are stored in 64-bit, objects positioned relative to their parent frame (star→galaxy, planet→star, terrain node→planet), with camera-relative transforms computed in 64-bit before float32 conversion (Habr 2012). The exact representation (flat float64 vs fixed-point vs int128) is **undocumented** — community inference only. All bodies follow fixed Keplerian elements; "gravity is not simulated outside the orbits of moons, planets and stars in a system, with the exception of the controllable spacecraft" (quote is from the **Wikipedia 'SpaceEngine' article**, Gameplay section — *verifier correction: not the Fandom Orbit page, which says orbits "are simulated by predefined scripts as opposed to physics"*). Ships switch between numeric integration (engines firing / drag) and analytic Kepler orbits when coasting (SE blog 2015-07-28). For the real Solar System, SE evaluates analytic ephemeris theories — VSOP87 (valid ≈ −2000..6000 AD), JPL DE436 (1550–2560), per-satellite theories (L1.2 Galileans, TASS 1.7, GUST86, …) — and outside a theory's valid span it samples the boundary state vector and freezes it into a simple Keplerian orbit forever after (blog180817).

### 2.4 Rendering: HDR-first, impostors + reduced-res volumetrics, quadtree terrain (FACT, with marked inferences)

- **Depth**: SE experimented with Outerra-style logarithmic depth in 2013 and rejected the fragment-shader variant because planet/atmosphere overdraw with early-Z off "kills FPS to almost zero" (blog130716); it shipped a **reversed floating-point depth buffer** in 0.980 (2016) — "similar to logarithmic depth buffer, but with full hardware support and with no changes in shaders" — one depth buffer for the whole universe, camera within centimeters of surfaces, unblocking deferred shading/shadow maps/SSAO (blog150803). Whether modern SE *also* uses log depth or layered passes is unconfirmed.
- **HDR (2017–2020)**: physically based brightness of all objects, floating-point linear buffers (indirectly corroborated), autoexposure originally metering "the central screen area," overhauled April 2020 to a histogram that samples the entire image with dominant-brightness-area selection and center priority (blog170312, blog170415, blog200419). Three camera modes: Auto (physical + adaptation), Manual (physical + fixed exposure), legacy "HDR" (explicitly *faked* — per-object-class brightness multipliers). *Verifier correction:* the lux-calibrated `MinPixelBright`/`MaxPixelBright` texture parameters were announced as **prospective design intent** in blog170312 ("scripts *will have*… something like…"), not confirmed shipped under those names. Forward vs deferred shading was never officially stated; MSAA usage suggests forward (**inference**; shaders encrypted since 0.990).
- **Galaxies/nebulae**: spiral/irregular galaxies are **procedural sprite clouds** — emission (`em*`), absorption (`abs*`, per-channel light absorption colors, e.g. `(0.0 0.3 0.5)` so dust reddens what's behind it), and bulge (`b*`) sprite classes distributed by textures (dust pattern in the disc texture's alpha) + warped fBm noise, order 10⁴–10⁵ sprites in an octree with continuous LOD; **elliptical galaxies alone** use a custom ray-tracing shader; **raymarching shipped in 0.990 for nebulae** (config-driven custom GLSL with auto-registered uniforms), with all volumetrics rendered at reduced resolution and bicubically upsampled (DSO manual; blog190217; 0.990 notes). The shipped Milky Way model was community-authored and tuned against the from-inside view.
- **Terrain**: cube-sphere, six per-face quadtrees; each node owns 256×256 GPU-generated textures (height/normal/color/emission) and a 33×33 vertex grid (geometry 8× coarser than texture, so heightmap generation jumps 3 levels); Earth-size caps at quadtree level 12 (~9.5 m/px) before float artifacts; beyond that, pre-generated detail/splat textures (64 materials × 1024², 320 MB; up to 5 materials per point; "the current limit is 64, but it can easily be increased to a few hundred" — *verifier correction: that quote is blog180323/Terrain #6, not blog171102, which frames 256 materials as a >1 GB VRAM problem*) carry effective resolution to ~1 mm. Terrain 2.0 (0.990, 2019) made terrain meshless (vertex-shader heightmap displacement) and replaced dynamic texture allocation with statically preallocated OpenGL texture arrays (2048 layers/type) for a 10× generation-speed win (blog190328).
- **Black holes (2022)**: two-pass — 1/3-resolution geodesic integration in Kerr spacetime writing a deflection-vector texture + integrated accretion-disk brightness/opacity, then full-res composite via screen-space UV displacement with skybox fallback, photon-ring edge re-rendered at full res; 100+ fps on a GTX 1060 (blogs 220705, 220830).

**The transferable meta-lesson**: every expensive thing is either generated on demand from a seed, baked once and reused, or computed at reduced resolution and upsampled. Nothing brute-forces.

---

## 3. Scale & coordinates

### 3.1 The precision problem, quantified

float32 has a 24-bit significand; ULP(x) = x·2⁻²³. Above |x| ≈ 131,071 m a float32 cannot represent 1 cm steps (Ohlarik 2008, "Precisions, Precisions"); at Earth-radius magnitude ULP ≈ 0.5–0.76 m; at 1 AU it is 16,384 m. *Verifier correction for citing*: at 4×10⁸ ULP is **32**, not 64 (the often-quoted Medium article is wrong by 2×). float64 (53-bit significand) holds ~0.03 mm at 1 AU, ~2 m at 1 ly, ~65–131 km at Milky Way radius — so even doubles can't do "millimeters at galactic scale" in one flat frame, which is why every serious engine nests frames.

Depth is the second, independent problem: standard 1/z projection puts half of all depth precision within ~2× the near plane.

### 3.2 The technique menu

| Technique | What it fixes | Mechanism | Who uses it |
|---|---|---|---|
| **Camera-relative / floating origin** | translation | Keep authoritative positions in float64; each frame compute `pos − cameraPos` in doubles, upload small float32 residuals; camera at/near (0,0,0). Thorne 2005 (*Proc. Int'l Conf. on Cyberworlds, IEEE — verifier correction: not SIGGRAPH*) | KSP, Star Citizen, SE (inference), UE5 LWC |
| **Velocity rebasing (Krakensbane)** | high-speed float error | Zero the vessel's velocity, absorb into a float64 universal velocity vector, translate the universe back each tick. Threshold **1500 m/s at introduction** (HarvesteR's own 2012 devblog comment), ~750 m/s in modern KSP (*verifier correction*) | KSP |
| **GPU RTE (high/low split)** | translation, for massive *static* vertex data | Encode each double as two float32s (`high = floor(v/65536)·65536`); shader computes `(posHigh − camHigh) + (posLow − camLow)`; ~1.35 cm max error (Ohlarik 2008; Cozzi & Ring 2011 §5.4) | Cesium |
| **Hierarchical / dynamic frames** | translation at all scales | Each object stores (frameId, f64 pos-in-frame); galaxy frame in pc → system frame in AU/km → planet frame in m; OpenSpace re-roots the scene graph at the node nearest the camera (Axelsson et al., CGF 36(3) 2017) | OpenSpace, SE (inference), KSP (2-level) |
| **Logarithmic depth** | depth | `gl_FragDepth = log2(1+w)·Fcoef·0.5`; constant relative precision over ~9 decades on 24-bit (Kemen/Outerra 2009–2013; Ulrich 2011). **Cost: gl_FragDepth disables early-Z** | Outerra (objects only), Cesium hybrid (2018), three.js flag |
| **Reversed-Z float depth** | depth, no shader cost | near→1, far→0, GREATER compare, clear 0, [0,1] clip space; float32's density near 0 cancels 1/z's sparsity; ~0% misordered depth pairs (Reed 2015); slightly *beats* 24-bit log depth (Kemen 2012) | SpaceEngine 0.980+, D3D/Vulkan/WebGPU norm |
| **Scaled-space proxy scenes** | both | Render far content as a shrunken duplicate (KSP: 1/6000 miniature with its **own per-frame floating origin**, scaled camera = mainCam/6000); compositing far→near with depth clears. HarvesteR sketched the recursion: StellarSpace at 6000², GalacticSpace at 6000³ | KSP; SE pre-0.980 (inference from "single depth buffer… like usual 3D games" wording) |
| **Multi-frustum depth partitioning** | depth | One scene, 2–3 consecutive frustums at far/near ≤ **1000** (*verifier correction: Cesium's `farToNearRatio` default is 1,000, not 10,000; the multifrustum writeup is "Rendering a Frame", 2015-05-14*), rendered far-to-near with depth clears | Cesium (pre-2018 default, still the fallback) |

### 3.3 three.js / Legion reality check (verified against the installed r171)

- `Matrix4.elements` is a plain JS Array (float64); `WebGLRenderer.js:1611` computes `modelViewMatrix = camera.matrixWorldInverse * object.matrixWorld` **on the CPU per object** — so three.js already does double-precision RTC implicitly, *provided* (1) logical positions live in JS doubles, (2) geometry Float32Arrays stay small/local per object, and (3) custom shaders use `modelViewMatrix` rather than subtracting huge `modelMatrix`/`cameraPosition` uniforms in-shader (a real gotcha for Legion's sun/atmosphere/disc shaders). Float32 truncation happens only at GPU upload. (*Verifier correction: "three.js stores all transforms in Float32" is false — only GPU-bound data is.*)
- `logarithmicDepthBuffer: true` (Legion has it ON in `src/render/renderer.ts`) has **only the fragment-depth path** in r171: every material writes `gl_FragDepth` (`logdepthbuf_fragment.glsl.js`), early-Z dies globally; a Dec 2025 forum case measured 65→35 fps from this flag alone on a high-overdraw scene. Legion's volumetric disc + glow shells are the worst case.
- `reverseDepthBuffer` exists in r171 (EXT_clip_control, landed r169, PRs #29445/#29579) but is **broken in r170–r174** (issue #30808, nothing renders; fixed ~r175, later renamed `reversedDepthBuffer`). EXT_clip_control support: 86.1% of WebGL2 devices (96.6% iOS, 91.3% Windows, **57.6% Android**) — web3dsurvey; Khronos status Community Approved, rev. 2023-11-06 (*verifier correction on date*).
- **WebGPURenderer does NOT have reversed-Z in r171** — contrary to common assumption; basic support landed r183 (PR #32967, Feb 2026), `depth32float` in r184, fixes through r185. Maintainer Mugen87 (Oct 2025): "if you have reverse-z, logarithmic depth buffer is obsolete."

### 3.4 RECOMMENDATION for Legion

Legion currently has three mutually inconsistent compressed scales (1 AU = 10 WU, 1 kpc = 333 WU, 1 ly = 0.333 WU — ~10⁶× inconsistent), art-scaled radii (Earth ~470× oversized vs its orbit), and a `scale-manager.ts` that only lerps mesh visual scale. Replace with:

1. **Float64 authoritative coordinates in the sim layer** (the ECS / frame store), organized as nested frames: galactic frame in parsecs, per-system frame in km or AU (origin at the system barycenter), future planet-local frame in meters. The scale-manager becomes the **frame broker**: it owns frame→frame double transforms and emits per-frame camera-relative float32 root transforms. Discipline rule: no gameplay code ever reads `object3D.matrixWorld` for galactic-magnitude positions; the three.js graph is a render cache.
2. **Continuous floating origin per tier**: each tier's scene root is repositioned every frame so the camera sits at (0,0,0) (KSP's ScaledSpace fix — per-frame recenter, not threshold-triggered, is what makes arbitrary zoom jitter-free).
3. **Depth: per-tier partitioning now, reversed-Z later.** `renderer.autoClear = false`; per frame: render galactic backdrop scene → `renderer.clearDepth()` → render system scene (tight near/far) → optional local pass. Zero shader changes, zero extensions, early-Z restored, identical under WebGPU. Then **drop `logarithmicDepthBuffer`**. When Legion upgrades three.js past r175 (and to r183+ for WebGPU), adopt `reversedDepthBuffer` behind an EXT_clip_control capability check, keeping the partitioned path as the Android/Linux fallback. Post chain must then run once on the composite, and depth-reading shaders must respect the inverted comparison.
4. **GPU RTE is not needed now.** Legion's per-tier object counts (tens of bodies, point-cloud stars) are served by CPU camera-relative re-rooting. Reserve the high/low split for the future planet-surface terrain tier (where the GLSL fast-math cancellation bug on some mobile GPUs needs `precise`-style mitigations). Note WGSL has no f64 at all, so high/low remains the only GPU-side option there too.

Canonical reference for the whole area: Cozzi & Ring, *3D Engine Design for Virtual Globes* (2011), Part II "Precision" (Ch. 5 vertex transform precision, Ch. 6 depth buffer precision), with the OpenGlobe companion source as working shader reference.

---

## 4. Gravity, momentum & orbits

### 4.1 The spectrum, and where shipped products sit

On-rails analytic ←→ patched conics ←→ full N-body. **No shipping space sim uses N-body for the world.** SE and KSP propagate every celestial body from six Keplerian elements relative to a parent in a hierarchical barycenter tree (binary stars = barycenter ParentBody nodes, documented in SE's `.sc` format); KSP additionally runs full rigid-body physics only inside a ~2.25–2.5 km bubble around the active vessel (community-documented; not primary-sourced — extract `Physics.cfg` defaults if precision matters), with everything else "packed"/on rails. SE integrates Newtonian gravity + aerodynamics for the player ship only, and switches the ship back to analytic Kepler the moment thrust/drag vanish (blog150728). This asymmetry — analytic ephemerides for the world, numeric integration for one agent — is *why* both products time-warp to extreme factors while staying stable (**inference**, but a safe one).

### 4.2 The load-bearing math

**Elliptic Kepler solver** (per body, per query):
1. n = √(μ/a³), μ = G·M_parent (store μ per body, never G and M separately).
2. M = M₀ + n·(t − t₀), wrap to [−π, π].
3. Solve M = E − e·sinE by Newton–Raphson: E₊ = E − (E − e·sinE − M)/(1 − e·cosE); E₀ = M for moderate e, E₀ = π for e > 0.8; ~1e-12 in 2–5 iterations for e < 0.9. Guard the near-parabolic / E≈π stall (tiny derivative) with relaxation or bisection fallback.
4. ν from tan(ν/2) = √((1+e)/(1−e))·tan(E/2) (atan2 form); r = a(1 − e·cosE).
5. Perifocal: x′ = a(cosE − e), y′ = a√(1−e²)·sinE; v′ = (√(μa)/r)·(−sinE, √(1−e²)·cosE, 0).
6. Rotate into the reference frame by **R = R_z(Ω)·R_x(i)·R_z(ω)** — the full three-angle rotation. *(This is the fix for Legion's current bug: `world.ts` applies inclination as a y/z shear with no Ω/ω at all.)*

**Hyperbolic branch** (e > 1, a < 0): M = e·sinhH − H; Newton H₊ = H − (e·sinhH − H − M)/(e·coshH − 1); the standard initial guess ln(2M/e + 1.8) is **Danby's guess** (confirmed in Napier 2024, arXiv:2411.15374 — *verifier correction: sole author Kevin J. Napier, not "Brandt et al."; the "≤2 iterations in 99.996% of cases" figure appears in neither cited source and is unsourced — do not repeat it*). Parabolic: Barker's equation, closed form.

**Element ↔ state conversions** (needed at every SOI crossing and thrust on/off transition): elements→state per Rene Schwarz M001; state→elements per M002 / Curtis Alg. 4.1 (h = r×v; e_vec = (1/μ)[(v² − μ/|r|)r − (r·v)v]; a = −μ/2ξ; …). Unit-test the round trip to ~1e-9 and explicitly test the degenerate cases (e≈0: ω undefined; i≈0: Ω undefined) — robust handling per Flores & Fantino, arXiv:2404.18141 (*verifier correction: those are the authors, not "Kromydas"*).

**Universal-variable formulation** (Stumpff c2/c3 + Lagrange f/g, Curtis Alg. 3.4): one branch-free propagator valid for all conics — worth adopting if/when Legion's probes do hyperbolic flybys mixing bound and unbound arcs; otherwise elliptic + hyperbolic branches are simpler.

**Patched conics / SOI** (the KSP model, right for Legion probe navigation): r_SOI = a·(m/M)^(2/5) (Laplace). On crossing, subtract the new parent's full state vector (position AND velocity) and re-derive elements. Cheap, deterministic, warp-safe. It cannot produce Lagrange points/Trojans — if those become gameplay, script them as special locations (SE's approach) rather than going N-body.

**Integrators, if ever needed**: RK4/RKF45 for the *powered* arcs of one vessel (switch back to rails when thrust stops — the SE pattern). Symplectic leapfrog/Verlet only if emergent mutual perturbation is ever wanted (bounded energy error via the shadow Hamiltonian, but **fixed timestep only** — adaptive dt breaks symplecticity, which conflicts with time warp). IAS15 (Rein & Spiegel 2015) is research-grade overkill; the transferable idea is REBOUND's MERCURIUS hybrid: cheap analytic path normally, accurate integrator only during rare close encounters. **Verdict: do not N-body Legion's systems. SE's own choice settles it.**

### 4.3 Real Sol-system data

Three fidelity tiers: (1) **JPL "Keplerian Elements for Approximate Positions of the Major Planets"** (Standish & Williams, ssd.jpl.nasa.gov/planets/approx_pos.html) — a complete copy-paste algorithm: per planet 6 elements + 6 secular rates in Julian centuries T = (T_eph − 2451545.0)/36525 (T_eph in **TDB**), outer-planet b·T² + c·cos(fT) + s·sin(fT) correction terms, Kepler solve to |ΔE| ≤ 1e-6 deg, rotate R_z(−Ω)R_x(−I)R_z(−ω), ecliptic→equatorial by ε = 23.43928°. Valid 1800–2050 (a second table covers 3000 BC–3000 AD); sub-arcminute for inner planets; ~40 lines of float64 + a static JSON table. (2) VSOP87 — sub-arcsec analytic series, valid ≈ ±2000 yr, heavier term tables. (3) JPL DE Chebyshev files — research-grade, multi-MB, skip. **Adopt (1) now**; adopt SE's extrapolation-fallback verbatim (sample the theory at its validity boundary, convert state→elements, propagate Kepler forever after) since Bobiverse narrative dates (2130s+) are inside VSOP87 but outside DE436 (ends 2560) and several moon theories.

### 4.4 Time system (currently missing in Legion)

- **Master clock**: one float64 `et` = TDB seconds past J2000.0 (the SPICE/OpenSpace/KSP convention). ulp ≈ 0.95 µs at ±136 yr from epoch; JD_TDB = 2451545.0 + et/86400; centuries T = et/3.15576e9. Never store the master clock in days or float32. Anchor a named `gameEpoch` constant for the narrative date.
- **Time scales**: run on "TDB"; UTC display = calendar conversion of (et − 69.184 s) (TT = TAI + 32.184 exactly; 37 leap seconds frozen since 2017); ignore the periodic TDB−TT ≈ 1.657e-3·sin(E) ms term (Celestia `date.cpp` implements all of this if reference is needed). Use a vetted JD→calendar algorithm (Fliegel–Van Flandern or Meeus).
- **Loop**: Fiedler's accumulator (`gafferongames.com/post/fix_your_timestep/`): clamp frame time, `while (acc ≥ dt) step(dt)`, interpolate render state by α = acc/dt; re-seed prevState on warp discontinuities. **Legion's `main.ts` comment claims fixed-timestep but the loop is variable-dt (capped 100 ms) with `gameTime += dt·tc` and no accumulator — `updateSteering`/`updateAI` currently integrate with warp-scaled raw dt.**
- **Warp contract (KSP's two modes)**: "physics warp" = fixed iteration count, scaled step, hard-capped (KSP: 4×) because error grows; "on-rails warp" = clock multiplier only (KSP tiers {5, 10, 50, 100, 1000, 10000, 100000}×), legal only when nothing is integrating (no thrust/atmosphere), gated per-body by altitude. SE's planetarium mode accepts TimeScale ±1e12 *because everything is position = f(JD)*; its flight-sim mode caps at 10,000× (ships integrate). Legion mapping: galactic tier = pure planetarium (unbounded warp); system tier = planets always on rails, probes on rails when coasting, fixed-step integration only under thrust (which caps available warp, KSP-style). Add a time-ordered event priority queue: at 100,000× a 60 fps frame spans ~28 sim-minutes, so arrivals/production/SOI events must be processed in timestamp order within the frame span (or auto-drop warp at events, KSP's `warp_to` behavior). OpenSpace's polish: cubic-Hermite-interpolate deltaTime changes over ~1 s so warp/pause transitions are visually smooth (`timemanager.cpp`). (*Verifier correction: the kOS on-rails/MEANANOMALYATEPOCH documentation is the Orbit-structure page, not the ref-frame page.*)
- **Sim clock vs shader clock**: shader `uTime` uniforms are float32 on WebGL and WGSL alike; f32 ulp hits 0.5 ms at ~1.1 h of accumulated seconds, a full 60 fps frame at ~36 h — animations quantize, stutter, freeze. **This bug is live**: `main.ts:291` accumulates unbounded `elapsedTime` feeding `uTime` in `post-processing.ts:347` (grain hash multiplies by 137, burning precision 137× faster), `sun.ts:292-294`, and `galaxy.ts` dash shaders. Fix: The Witness's trick (the-witness.net, Feb 2022, technique credited to Ignacio Castaño) — wrap the shader clock at a power of ten (`fmod(elapsed, 1000.0)`) and quantize periodic frequencies to ≤3 decimal digits so every sin/cos completes integer cycles per 1000 s (phase-continuous wrap). Cosmetic shader effects take the **wall** clock, never warp-scaled time. Sim-driven shader inputs (rotation angles) are reduced mod 2π on CPU in f64 before upload.

### 4.5 RECOMMENDATION for Legion

Keep the on-rails architecture; fix the math and formalize the contract:

1. Fix `world.ts:135`: n = 2π/(a^1.5·365.25) → properly n = √(μ/a³) with real μ values (or at minimum P ∝ a^1.5); fix the inclination shear to the full R_z(Ω)R_x(i)R_z(ω) rotation; add Ω/ω/M₀ to the orbit components; introduce barycenter parent nodes.
2. Implement the JPL approximate-elements table for Sol (static JSON + ~40-line evaluator in float64).
3. Introduce `et` (f64 TDB-seconds-past-J2000) as the master clock; make `gameTime` a derived value; rebuild the main loop on a Fiedler accumulator with the command tick (`commands.ts`) defined on the fixed-step counter.
4. Adopt the two-mode warp contract with an event queue; warp multiplies the clock only on the rails path.
5. Probes: state→elements on thrust cutoff, elements→state on ignition, RK4 only while burning; patched-conic SOI handoffs when interplanetary transfers become gameplay.

All CPU-side TypeScript; zero renderer cost; trivially 60 fps for thousands of on-rails bodies.

---

## 5. The visual stack, layer by layer

### 5.1 Stars: photometry, color, PSF splats

**Replaces**: the 6-bucket hand-tuned population table, pixel sprites with art sizes 1.1–6.5 px (`galactic-stars.ts`).

- **Magnitude → irradiance** (Jensen et al., "A Physically-Based Night Sky Model," SIGGRAPH 2001): E = 10^{0.4(−m−19)} W/m² (Eq. 6); m = M + 5·log₁₀(d_pc) − 5; L/L☉ = 10^{(4.74−M)/2.5}. Add Jensen's integrated-starlight constant (3×10⁻⁸ W/m²) so magnitude-culled faint stars still contribute background light.
- **Temperature → color**: Teff = 7000 K/(B−V + 0.56) (Jensen Eq. 8) or Ballesteros 2012; bake Planck(λ,T) × CIE 1931 CMFs → XYZ → linear sRGB into a **256×1 RGBA16F LUT over log T (1,000–40,000 K)**; desaturate out-of-gamut toward white at constant luminance. Validation targets from Harre & Heller 2021 (AN 342, arXiv:2101.06254): no green/cyan/purple stars; M dwarfs are *orange*, not crimson.
- **Render as energy-conserving PSF splats, never raw points** (tiffnix.com/star-rendering; Jensen 2001): each star a camera-facing quad/point-sprite whose Gaussian footprint (σ ≈ 0.5–1.0 px, computed at the exact sub-pixel center) **integrates** to E; brighter stars keep total energy fixed, growing the quad ∝ √E past a peak clamp so the peak stays in RGBA16F. Accumulate additively into the HDR target before bloom/tonemap. This directly upgrades Legion's velocity micro-streaks: a streak is the same splat stretched along screen velocity with peak ÷ stretch length — energy conservation gives streak dimming for free.
- **Glare/spikes** (Spencer, Shirley, Zimmerman, Greenberg, SIGGRAPH 1995 — coefficients **verified against the original paper** via Wayback; *verifier correction: Ritschel et al. "Temporal Glare" 2009 does NOT reproduce them, it's a separate wave-optics model*): PSF(θ) = weighted sum of f0 = 2.61×10⁶·e^{−(θ/0.02)²}, f1 = 20.91/(θ+0.02)³, f2 = 72.37/(θ+0.02)², plus the wavelength halo f3 = 436.9·(568/λ)·e^{−(θ−3λ/568)²/0.0228²} at ~3°; photopic mix 0.384·f0 + 0.478·f1 + 0.138·f2. The discrete kernel must renormalize to exactly 1. Practical tiers: (a) pre-rendered glare sprite per bright source sized by √E (what SE visually does); (b) bloom chain with weights refit to the f1+f2 inverse-power skirt; (c) FFT convolution — WebGPU-era.
- **Catalog architecture** (Gaia Sky, Sagristà et al., IEEE TVCG 25(1) 2019; SE's 10-level brightness octree; Elite's 8-layer sector octree with 64-bit addresses): Legion's Orion Spur scale (10⁴–10⁵ stars) needs **no streaming** — one interleaved BufferGeometry, magnitude-sorted so distant LOD = `drawRange` prefix. The octant-file streaming format (Gaia Sky LOD docs) is the design to copy only if Legion ever ships >10⁶ stars. Performance envelope datapoints: 119k stars in 2012 three.js (Google "100,000 Stars"); 200k instanced systems at 4 ms (EVE Frontier map, 2025); 1M particles in r171's official `webgpu_compute_particles` example.

**Three.js feasibility**: everything WebGL2-now (instanced quads / Points, AdditiveBlending, RGBA16F — blending to 16F is guaranteed under EXT_color_buffer_float; **standardize HDR accumulation on RGBA16F, never 32F**, whose blending needs the separate, less-available EXT_float_blend).

### 5.2 Milky Way from inside (system-tier backdrop)

Three shipped strategies: (a) all-sky panorama (Jensen 2001 used a 14400×7200 mosaic with bright stars median-filtered out to avoid double-counting catalog stars); (b) live particle/billboard model (Gaia Sky 2.2: separate gas/dust/HII/star components, dither shaders, log depth); (c) **position-baked skybox** — EVE redraws each of its systems' skyboxes from a real cluster model of "relatively few but highly distinctive" artist nebulae (*verifier correction: the "four primary" count is not in the Engadget source; the four empire nebulae are examples*), and Elite generates the backdrop from the player's actual Stellar Forge position (octree + 64-bit sector IDs + Hipparcos/Gliese seeding is dev-confirmed via the 80.lv Doc Ross interview; the per-jump 6-face bake mechanism is **community inference, not dev-confirmed** — and the config's `GalaxyBackground` skybox-resolution setting indicates a runtime-generated skybox texture *plus* instanced near stars, not pure live geometry).

**RECOMMENDATION**: the bake-the-view hybrid. On system entry, render the existing galactic-tier scene (volumetric disc + far stars + nebulae) once from the system's position into a 6×1024–2048 RGBA16F cubemap (`WebGLCubeRenderTarget`) during the jump/transition animation Legion already has, then sample it statically at system tier while near catalog stars stay live (correct parallax where it matters, zero per-frame disc cost). Subtract drawn-star flux from the bake to avoid double-counting. Asset alternative/reference: **NASA SVS Deep Star Maps 2020** (svs.gsfc.nasa.gov/4851) — US public domain, 4K–64K equirect **EXR (linear HDR)** in galactic or celestial frame, built from 1.7B Hipparcos-2/Tycho-2/Gaia DR2 stars, with/without bright stars. **Mellinger's panorama is pay-for-commercial — ruled out** (milkywaysky.com/licenses.html); ESA Gaia EDR3 imagery is CC BY-SA 3.0 IGO (usable, ShareAlike on the asset).

### 5.3 Galaxy & nebula volumetrics

**Current**: single-box 24-step raymarch, full-res, no jitter, 2D plane-projected value noise, emission–absorption only, AABB uniforms baked at build time (`galactic-disc-volume.ts`).

- **The calibrated budget** (Schneider & Vos, "Real-Time Volumetric Cloudscapes of Horizon Zero Dawn," SIGGRAPH 2015 Advances — all numbers verified against the official deck): 64 zenith → 128 horizon adaptive steps; 6 light samples per march in a cone (cheap-shader switch at α ≥ 0.3 = 2× faster); noise = 128³×4ch Perlin–Worley + 32³×3ch Worley + 128²×3ch curl (~8.5 MB raw; the oft-quoted 20 MB is the whole system's RAM); **quarter-res buffer updating 1 of 16 pixels per 4×4 block with reprojection** → ~2 ms on PS4. Jittered-offset marching achieves visually similar results with 1/16 the steps (Toft, Bowles & Zimmermann, arXiv:1609.05344 — *verifier correction: not Häggström*).
- **The no-TAA browser recipe** (SE's documented choice): march at **1/2 res into RGBA16F**, jitter the step offset with a static blue-noise texture per pixel, **bicubic (Catmull-Rom 4-tap) upsample**, composite. Roughly 3–4× cheaper at galactic-haze frequencies; ~1 day of work; no motion vectors needed. Temporal 1/16-pixel reprojection is the WebGPU-era upgrade (Legion's cinematic flight paths give perfect motion vectors; galaxy dust has no depth discontinuities, so ghosting risk is low). Takram's three-clouds proves the browser envelope: max 500 primary iterations, 3 sun + 2 ground secondary samples, shadow march max **50** iterations (*verifier correction: not 500*), 1/16-texel temporal upscaling = 60 fps at 2.4K on an M4 iPad.
- **Structure**: density ρ(p) = baseShape(p)·saturate(fBm(warp(p)) − threshold) with warp(p) = p + d·fBm₃(p); pack octaves into one tiling 3D texture (`Data3DTexture`, 64³–128³ RGBA8) instead of inline octaves. Drive the raymarch density and the star-spawn sampler from **one shared galaxy-density function** (arms + disc + bulge; density-wave placement per Berg, beltoforion.de — ellipse orientations rotating with radius, H-II knots on crests, dust lanes on inner arm edges) so stars sit inside the visible arms, and dim the volume's emission as discrete stars spawn at sector tier (constant summed luminance across the LOD seam — the SE/Gaia Sky handoff pattern, blending rule inferred).
- **Consider SE's sprite-cloud hybrid**: ~20–50k instanced emission + per-channel-absorbing dust sprites (Three.js `CustomBlending` with `OneMinusSrcColor`) for arm clumps and reddened dust-lane structure at sector tier; sprites beat raymarch at oblique angles.
- Fix now regardless: move the box AABB to per-frame uniforms derived from the group's world transform (currently baked at build time — breaks if the galaxy group moves).

### 5.4 Sun

**Current**: 512px cubemap re-rendered **every frame** by a CubeCamera (5-octave 4D simplex), artistic polynomial color ramp, no blackbody, no limb darkening, 2048-quad corona.

Upgrades in value order: (1) gate the cubemap re-render by distance/visibility (at galaxy tier it is pure waste) and drop the update rate to every N frames with time interpolation; (2) color from the **same blackbody LUT as stars** at the star's catalog Teff (G2V ≈ 5772 K), scaled to the physical-ratio brightness contract (§5.8) so the sun's HDR value, not a bloom threshold, makes it glow; (3) limb darkening I(μ) = 1 − u(1 − μ), u ≈ 0.6 in the visible band — one line in the surface shader, and it also feeds the eclipse-visibility LUT; (4) per-system parameterization from the catalog spectral type (temperature, radius class) — this is where the AT-HYG MK spectral types plug directly into the existing shader. SE documents sunspot/granule temperatures derived from stellar Teff via empirical equations (0.991) — the same idea: derive the art knobs from one physical input.

### 5.5 Planets & atmospheres — pick Hillaire

**Current**: fresnel-rim BackSide shell at 1.08×, additive, day-factor gated — a hack, not scattering (`planet-atmosphere.ts`).

The three candidates:
- **O'Neil (GPU Gems 2 ch.16, 2005)** — documented here as a **trap**: single scattering only; the fitted polynomial hard-codes atmosphere ratio 1.025× and scale height 0.25, so it cannot represent varied planets without re-fitting. Skip.
- **Bruneton 2008/2017** — the gold standard for Earth stills; 4D scattering LUT packed into a 256×128×32 3D texture (~8 MB RGBA16F), transmittance 256×64, irradiance 64×16; multiple scattering by iteration; **~250 ms per LUT rebuild**, so parameters are frozen per archetype. This is what SpaceEngine ships (**FACT** — official credits: "the exact model of the Earth's atmosphere (code by Eric Bruneton), adapted for the other planets"; baked `.atm` binaries for ~10 archetypes + cheap runtime knobs Bright/Opacity/Hue/Saturation/SkyLight). Production three.js port exists: `@takram/three-atmosphere` (Bruneton LUTs, SkyMaterial, AerialPerspectiveEffect, SunDirectionalLight, SkyLightProbe) — but it is Earth-parameterized, GLSL/pmndrs-postprocessing-only (TSL rewrite in flight), and maintenance-risky (client funding ended 03/2025).
- **Hillaire 2020** ("A Scalable and Production Ready Sky and Atmosphere Rendering Technique," EGSR/CGF 39(4), the UE4/UE5 sky) — **RECOMMENDED**. Four small LUTs rebuilt per frame: transmittance 256×64 (~40 steps/texel); multi-scattering 32×32 (64-direction 2nd-order integral + geometric-series closure F_ms = 1/(1−f_ms) replacing Bruneton's iteration); sky-view 200×100 lat-long, sun-azimuth-aligned, non-linear latitude mapping concentrating texels at the horizon; aerial-perspective 32×32×32 camera-frustum froxels (in-scatter RGB + transmittance α, one trilinear tap per scene pixel). **0.31 ms at 720p on a GTX 1080; ~1 ms on an iPhone 6s.** Because LUTs are per-frame, every planet gets a *dynamically parameterized* physically-derived sky from ~15 uniforms — no baking, which beats SE's own flexibility. WebGL2-proven (Shadertoy "Production Sky Rendering" runs the full pipeline in fragment buffers); WGSL library exists for the WebGPU era (JolifantoBambla/webgpu-sky-atmosphere, MIT).

**The per-planet parameter struct** (canonical Earth values, shared by Bruneton 2017/Hillaire 2020/webgpu-sky-atmosphere): radius 6360 km, top +100 km; Rayleigh β = (0.005802, 0.013558, 0.033100) km⁻¹, H = 8 km; Mie scatter 0.003996 / extinction 0.004440 km⁻¹, H = 1.2 km, Cornette–Shanks g = 0.8; ozone absorption (0.000650, 0.001881, 0.000085) km⁻¹ in a tent profile centered at 25 km (this term is what keeps sunset zeniths blue — cheap, high payoff); ground albedo 0.1–0.4. Alien worlds: scale Rayleigh by composition/pressure with the 1/λ⁴ law, drive haze with Mie density/g (Titan: high Mie, low Rayleigh). Real-planet values are derivable from these templates — directly serves Grounded Sci-Fi Authenticity.

**Aerial perspective / scene-lighting coupling** (the difference between "planet with sky shader" and "SpaceEngine-grade scene"): post pass reconstructs world position from depth, composites color′ = color·T + S (froxel tap); sun directional light = TOA irradiance × transmittance LUT at the surface; ambient = sky irradiance → SH probe. Reddened terminator light then emerges physically instead of being painted. Tier mapping: system view = transmittance/sky-view-driven limb + terminator shading on the sphere shader; orbital/surface view = full 4-LUT with froxel aerial perspective. Amortize: rebuild transmittance/multi-scatter only on parameter change; one full LUT set for the dominant body, analytic fallback for distant ones.

**Planet shading detail kit** (all WebGL1-era cheap, single shader, highest realism-per-ms at system tier; Three.js Journey Earth lesson; Sangil Lee 2024 writeups; SE manual):
- Day/night blend by NdotL smoothstep; night-side city-light emissive gated by inverse day mask (SE GlowMap modes Night/Permanent/Thermal — Thermal encodes 24-bit temperature in RGB for lava worlds).
- Ocean glint: water mask × high-power specular (SE default SpecularPower 55) + Fresnel limb bloom — the single strongest "real planet" cue at system distance, and it feeds bloom naturally.
- Lambert↔Hapke lerp per body with opposition surge ≈ 1 + A·e^{−phase/w} for airless dusty bodies (Moon, asteroids).
- **Analytic eclipse shadows** (no shadow maps — they're unusable at AU scale): per fragment, sun disc angular radius α_s = asin(R_sun/d_sun), occluder α_o, separation c; light fraction = 1 − circleOverlapArea(α_s, α_o, c)/(π·α_s²) (standard lens formula). Gives exact umbra/penumbra/**antumbra** (annular eclipses) for a few ALU ops; pass 2–4 occluder spheres as uniforms chosen by the sim. Refine with the limb-darkening-weighted 1D LUT (visibility → effective intensity + color). With auto-exposure this makes a total eclipse an emergent spectacle for near-zero cost.

**Clouds**: tier A (SE-style) for system view — 1–3 textured shells at different heights with differential rotation + the cloud texture projected down as a moving surface-shadow multiplier; parallax sells "3D" for ~nothing. Tier B (Takram three-clouds-style volumetrics) is a low-orbit/surface-tier luxury, browser-proven but Earth/WGS84-centric — defer.

**Terrain (future surface tier)**: SE's cube-sphere quadtree (256×256 textures / 33×33 grids / distance-to-edge÷node-size split metric in unwarped cube coords / generation priority normal→color, visible nodes only) + render-to-texture node generation (1–2 nodes/frame via priority queue in WebGL; one compute dispatch per node under WebGPU) + Terrain 2.0's preallocated `DataArrayTexture` cache with LRU layers (256–512 layers of 256² RGBA16F ≈ 130–260 MB — the browser-realistic budget; SE's 2 GB is not) + Ulrich 2002 skirts first, CDLOD morphing only if pops show + Cesium horizon-occlusion-point culling. Keep chunk vertices node-local and compose camera-relative or level-12 nodes jitter in float32.

### 5.6 Rings

**Current** (`planet-rings.ts`): radial 1D profile, analytic planet→ring shadow — already half right. Upgrades:
- SE's texture format (*verifier-corrected*): **x wide × 2 tall** (e.g., 1024×2) RGBA — row 1 = front-lit radial color+alpha pattern, row 2 = back-lit pattern. Rings are translucent particle sheets: the unlit face still glows (transmission/back-scatter); SE exposes FrontBright/BackBright + Density; cheap version: visibility = 0.7/(1+e^{−10·cos(sun,normal)}) + 0.3. Author the radial profile from Cassini optical-depth data for NASA authenticity.
- **Ring shadow on the planet** (currently missing): per surface fragment, ray to sun ∩ ring plane: t = −(n·(p − p_ring))/(n·sunDir); if innerR < r_hit < outerR, attenuate sun by (1 − ringAlpha(r_hit)) — one texture fetch, gives Saturn's banded shadows. Penumbra: spread 10–15 sun-disc rays or pre-blur the alpha profile by distance from the ring plane.
- Planet→ring shadow: replace the current axis-projection smoothstep with the same circle-overlap eclipse() for a correct curved penumbra edge.
- Transparency ordering: split the annulus into two one-sided discs (or front/back halves) rendered around the planet rather than relying on `depthTest` hacks.

### 5.7 Lighting, planetshine, ambient

GI in space is nearly degenerate — every phenomenon has low-dimensional analytic structure. Ship **zero stochastic GI** in the WebGL build (SE itself shows no evidence of probe/RT GI — **inference**; its realism = brightness ratios + exposure + scattering LUTs):

1. **Star light**: one directional/point light per system; intensity follows inverse-square from the physical contract (replaces the current PointLight range-4000/decay-1 non-physical falloff).
2. **Planetshine** (the only bounce that matters; measured: full-Earth on the Moon ≈ 1–10 lux, 30–60× full moonlight, ~10⁻⁴ of sunlight — arXiv:1904.00236): E = E_sun_at_body·albedo·phase(α)·(R²/d²)·(2/3), Lambert-sphere phase(α) = (sinα + (π−α)cosα)/π; bind the 1–2 brightest neighbors as diffuse-only bounce lights (skip specular; optional wrap-diffuse). ~20 lines; invisible at day exposure, beautiful at night exposure — the "moon night-side lit blue by its gas giant" money shot. SE itself probably does *not* model this (inference) — a place Legion can exceed the reference.
3. **Galaxy ambient**: project the baked galactic cubemap (§5.2) into a 9-coefficient SH irradiance probe (Ramamoorthi & Hanrahan, SIGGRAPH 2001; `THREE.LightProbe` + `LightProbeGenerator.fromCubeRenderTarget`, 64² faces suffice) so deep-space ships are faintly rim-lit parallel to the Milky Way band; refresh on large displacement; keep the absolute level art-directable.
4. **Eclipse/ring shadows**: analytic (§5.5/§5.6). All of 1–4 together costs well under ~2 ms.

### 5.8 Exposure & tone mapping

This is the section that makes everything else read as "real." Sequence matters: **calibrate ratios → auto-exposure → threshold-free bloom → tonemap retune** (adopting threshold-free bloom while brightnesses are hand-tuned-similar washes the frame).

- **Photometric contract** (Lagarde & de Rousiers, Frostbite, SIGGRAPH 2014): sun disc ~1.6e9 cd/m², moonless sky ~3e-5 cd/m² — ~14 orders. FP16 maxes at 65504, so either pre-expose in the emissive shaders (Frostbite: multiply by previous frame's exposure at light-injection time) or — the pragmatic Legion contract — **relative-physical units**: sun = 1.0 at 1 AU irradiance, everything ratioed from it, documented mapping to lux; one consistent radiance scale per render tier with the scale-manager owning tier conversion. Reserve true photometric units for the WebGPU rewrite. EffectComposer already defaults to HalfFloatType targets in r171 — correct foundation.
- **Auto-exposure**: WebGL-now version = Reinhard et al. 2002 log-average — render log(δ+L) at quarter res, mip-reduce to 1×1, read in the tonemap shader (no readback), exposure = 0.18/clamp(L̄, Lmin, Lmax)·2^EC, Krawczyk auto-key optional, temporal adaptation L′ += (L − L′)(1 − e^{−dt/τ}) with τ ≈ 0.5 s brightening / ~2 s darkening. Center-weight with a Gaussian falloff — exactly SE's documented behavior (center-area metering 2017, histogram with dominant-area + center priority 2020). Exclude FX (engine plumes) from metering and blend FX intensity in log2 space against estimated exposure (Narkowicz 2016) — fixes SE's own documented night-blinding failure mode. The histogram version (64–128 log-luminance bins, percentile clip 50–80% low / 2–20% high) needs compute + atomics → first WebGPU feature.
- **Tone mapping: AgX over ACES.** ACES filmic (Legion's current) has the "notorious 6" hue skew — bright saturated blues→purple, oranges→red — destroying exactly the blackbody O/B-blue vs M-orange information the star pipeline produces. AgX (Sobotka; `THREE.AgXToneMapping` since r160, gamut fix r161 — Legion's r171 has it) rolls saturated emissives to white with far less skew via the inset/outset gamut compression + log2 sigmoid over ~16.5 stops. One-line change in `renderer.ts`; re-tune `toneMappingExposure` (currently 0.85) and bloom strength after. three's AgX reads slightly flatter than Blender's — if art direction wants punch, add a *post-tonemap* saturation/contrast grade (SE did exactly this: saturation/vibrance filters added with HDR in 2017). Audit custom shaders (sun, atmosphere, disc) to confirm they output linear HDR and never self-tonemap.
- **Pass-order correction** (current chain runs grade/grain/vignette pre-tonemap and SMAA on linear HDR): target order = Render → [no NaN pass once sources are fixed] → Bloom → LensFlare → CA → Vignette → Grade → **OutputPass (AgX + sRGB, to buffer)** → **SMAA (post-tonemap)** → Grain (last, so it isn't smoothed) → screen.

### 5.9 Bloom, glare, lens flares as PSF

- **Replace UnrealBloomPass (thresholded mip-Gaussian) with the Jimenez CoD:AW chain** (SIGGRAPH 2014): progressive 13-tap downsample (5–7 mips), **Karis average on the first downsample only** (weight 2×2 samples by 1/(1+luma)) — non-optional for Legion: sub-pixel stars + bloom without it = shimmering fireflies that the micro-streaks amplify — then 3×3 tent upsample summing mips, composite `lerp(scene, bloom, ~0.04)` **with no threshold** (bloom is the PSF tail of every pixel — Spencer 1995; thresholding causes glow pop-in). Off-the-shelf: pmndrs `postprocessing` BloomEffect with `mipmapBlur: true, luminanceThreshold: 0`; or hand-roll per LearnOpenGL "Physically Based Bloom" (~100 lines/shader). The AMD GPUOpen max3 variant (`c·rcp(max3(c)+1)`) avoids hue shift at ~7 extra VALU ops. A halo's size/brightness then emerges from HDR value × exposure — a physically bright sun *automatically* gets a huge glow.
- **Lens flare**: keep sprite-based, but (1) derive the starburst from one offline |FFT(aperture)|² texture (6-blade iris for the NASA-camera identity; Kakimoto et al. 2004) shared by sun/bright stars/plumes, sized by post-exposure luminance; (2) occlusion-test against geometry (1-px render-target sample with 1 frame latency — never a depth readback stall) instead of zoom-tier gating; (3) author flare textures in HDR (16-bit) — SE found 8-bit "have not enough dynamic range." Hullin 2011 ghost ray-tracing is overkill; 3–5 parametric ghost sprites suffice. SE's flares are a "pseudo lens flare post-effect with preset configs" with transmittance-aware occlusion testing (cost cut from ~100 fps drop to 10–20).

### 5.10 Anti-aliasing (currently broken in Legion)

Verified state: canvas `antialias: true` is **inert** (every frame goes through EffectComposer's non-multisampled HalfFloat target; `RenderTarget.samples` defaults 0), and SMAAPass runs pre-tonemap on linear HDR (its `SMAA_THRESHOLD 0.1` luma metric is calibrated for gamma-space data — maintainers: "SMAA works in gamma space"; the shader even carries a hacky pow(2.2) round-trip). Net: effectively zero working AA on planet limbs against black, ring edges, terminators. Three-layer fix, all WebGL2-now:

1. **MSAA on the scene target**: construct the composer with `new WebGLRenderTarget(w, h, { type: HalfFloatType, samples: 4 })`; set canvas `antialias: false`. Gotchas: EffectComposer clones the target for ping-pong (clone copies `samples`) — zero `samples` on the non-scene buffer or every pass pays MSAA storage+resolve; multisampled RGBA16F renderbuffers are **optional** per spec — runtime-probe `gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES)` and clamp; depth-reading effects see resolved single-sample depth.
2. **Post-tonemap SMAA** (§5.8 pass order). Prefer SMAA over FXAA: SE's own manual warns FXAA "makes background stars look dim" (isolated 1–2 px bright stars read as aliasing and get averaged into black) — directly relevant to the micro-streaks; or draw star splats after the AA pass. SE itself ships MSAA 2–32× + optional FXAA, no TAA.
3. **Shader-side prefiltering for sub-pixel features** (the only thing that scales to the galactic tier where everything is sub-pixel): fwidth-smoothstep all procedural edges (`w = fwidth(d); alpha = smoothstep(−w, w, d)`) for ring annuli/terminator/limb; **width-clamp + energy compensation** for edge-on rings (clamp drawn width to 1 px, multiply opacity by projectedWidth/1 px — Persson "Phone-wire AA" — so rings thin by dimming, not dissolving into dashes); mips + maxAnisotropy on ring textures. Plus **specular AA** ported into the custom planet shaders: three's built-in materials already widen roughness by `max(|dFdx(N)|,|dFdy(N)|)` (`lights_physical_fragment.glsl.js:5-10`) but custom ShaderMaterials get nothing — copy those 4 lines (Kaplanyan HPG 2016 / Tokuyoshi & Kaplanyan I3D 2019 lineage).
4. **TAA: not now.** Core `TAARenderPass` is accumulation-only (useless with a perpetually moving cinematic camera); real WebGL TRAA is a build-it-yourself project (Karis SIGGRAPH 2014: Halton jitter, velocity buffer, variance clipping, 1/(1+luma)-weighted blend — 0beqz/realism-effects proves feasibility) and handles Legion's content worst (sub-pixel stars ghost/dissolve). The WebGPU era gets three's own `TRAANode` (r183+, velocity nearly free from TSL; MSAA off per its docs). When TAA lands, the cross-frame ping-pong feedback passes must consume **unjittered** matrices, and grain/CA must run post-resolve.
5. Karis-weight the bloom's first downsample regardless (§5.9) — it kills the firefly half of the aliasing complaint immediately.

---

## 6. Annotated bibliography

### Papers

- **Jensen, Durand, Stark, Premože, Dorsey, Shirley — "A Physically-Based Night Sky Model," SIGGRAPH 2001.** Magnitude→irradiance (E = 10^{0.4(−m−19)}), B−V→Teff, star PSF compositing through atmosphere transmittance, panorama with bright-star removal, integrated-starlight constant.
- **Harre & Heller 2021, "Digital color codes of stars," AN 342 (arXiv:2101.06254).** Validated blackbody→sRGB star colors; correctness checks (no green stars; M dwarfs orange).
- **Spencer, Shirley, Zimmerman, Greenberg — "Physically-Based Glare Effects for Digital Images," SIGGRAPH 1995.** The eye PSF (f0–f3 coefficients, photopic/scotopic mixes) — verified against the original via Wayback; kernel must integrate to 1.
- **Kakimoto et al. — "Glare Generation Based on Wave Optics," Pacific Graphics 2004.** Spectral PSF = |FFT(aperture)|²; precompute-and-splat recipe.
- **Hullin, Eisemann, Seidel, Lee — "Physically-Based Real-Time Lens Flare Rendering," SIGGRAPH 2011.** Ghost enumeration through lens prescriptions; cited as the overkill bound.
- **Bruneton & Neyret — "Precomputed Atmospheric Scattering," EGSR/CGF 2008; Bruneton 2017 reference implementation (BSD-3).** The baked-LUT atmosphere standard; LUT sizes/parameterization; what SpaceEngine ships.
- **Hillaire — "A Scalable and Production Ready Sky and Atmosphere Rendering Technique," EGSR/CGF 39(4) 2020.** The recommended atmosphere: 4 per-frame LUTs, multi-scattering geometric-series closure, 0.31 ms/720p/GTX 1080.
- **O'Neil — GPU Gems 2 ch. 16, 2005.** Legacy single-scattering sky; documented as a trap (hard-coded 1.025/0.25 fit).
- **Schneider & Vos — "The Real-Time Volumetric Cloudscapes of Horizon Zero Dawn," SIGGRAPH 2015 Advances.** The calibrated raymarch budget (steps, cone samples, noise sizes, 1/16-pixel temporal update, ~2 ms).
- **Toft, Bowles, Zimmermann — "Optimisations for Real-Time Volumetric Cloudscapes," arXiv:1609.05344.** Jittered offsets + TAA ≈ 1/16 steps (verifier-corrected attribution).
- **Ramamoorthi & Hanrahan — "An Efficient Representation for Irradiance Environment Maps," SIGGRAPH 2001.** Order-2 SH irradiance, <3% error; basis of the galaxy ambient probe.
- **Majercik et al. — DDGI, JCGT 8(2) 2019.** Cited as the future-tier-only GI option (WebGPU compute, SDF rays).
- **Lagarde & de Rousiers — "Moving Frostbite to PBR," SIGGRAPH 2014 course.** Photometric units, EV100, pre-exposure for FP16.
- **Reinhard, Stark, Shirley, Ferwerda — "Photographic Tone Reproduction," SIGGRAPH 2002.** Log-average luminance — the WebGL auto-exposure path.
- **Jimenez — "Next Generation Post Processing in Call of Duty: Advanced Warfare," SIGGRAPH 2014.** 13-tap mip bloom, Karis average, threshold-free composite.
- **Karis — "High Quality Temporal Supersampling," SIGGRAPH 2014; "Tone mapping" blog 2013.** TAA recipe; reversible-tonemap resolve weighting.
- **Kaplanyan et al. HPG 2016; Tokuyoshi & Kaplanyan I3D 2019.** NDF filtering / specular AA (three.js built-ins implement the cheap variant).
- **Jimenez et al. — "SMAA," CGF/Eurographics 2012.** Why morphological AA belongs in gamma space.
- **James, von Tunzelmann, Franklin, Thorne — DNGR, Classical & Quantum Gravity 32 (2015).** Ray-bundle Kerr lensing ground truth (offline); contrast with SE's real-time two-pass scheme.
- **Rein & Spiegel 2015 (IAS15, MNRAS 446); Rein & Tamayo (WHFast); Yoshida 1990.** Integrator landscape; MERCURIUS hybrid pattern; fixed-step requirement of symplectic methods.
- **Napier 2024 (arXiv:2411.15374).** Kepler initial guesses; confirms Danby's hyperbolic guess (verifier-corrected attribution).
- **Flores & Fantino 2024 (arXiv:2404.18141).** Robust state→elements conversion (verifier-corrected attribution).
- **Standish & Williams — JPL "Approximate Positions of the Major Planets" (ssd.jpl.nasa.gov).** The copy-paste Sol ephemeris algorithm + element/rate tables.
- **Sagristà, Jordan, Müller, Sadlo — "Gaia Sky: Navigating the Gaia Catalog," IEEE TVCG 25(1) 2019 (+ LOD docs).** Octree star streaming: θ solid-angle loading, ν LRU eviction, binary particle formats, parallax-error filtering.
- **Axelsson et al. — "Dynamic Scene Graph," CGF 36(3) 2017; Bock et al. — "OpenSpace," IEEE TVCG 26(1), Jan 2020 (verifier-corrected year).** Re-rooting scene graphs for universe scale; the academic architecture documentation.
- **Cozzi & Ring — *3D Engine Design for Virtual Globes*, A K Peters/CRC 2011.** Chapters 5–6 are the precision design manual (RTC/RTE/GPU-RTE, complementary/log depth, multi-frustum); OpenGlobe reference code.
- **Ulrich 2011 (log-depth note); Ulrich 2002 (Chunked LOD); Strugar 2010 (CDLOD); Thorne 2005 (floating origin, Proc. CW'05 IEEE — verifier-corrected venue).**
- **Ballesteros 2012 (B−V→T); Lindegren et al. 2021 (Gaia parallax zero-point); Bailer-Jones et al. 2021 (distances); Høg et al. 2000 (Tycho-2, BT/VT transforms).** Catalog hygiene math.

### Talks

- **Murray — "Building Worlds Using Math(s)," GDC 2017; McKendrick — "Continuous World Generation in No Man's Sky," GDC 2017.** Seed-chain determinism discipline; uber-noise (domain warp + derivative-damped octaves); voxel pipeline (wrong fit for browser — heightfield quadtree is).
- **Bjørge — "Bandwidth-Efficient Rendering," SIGGRAPH 2015 mobile.** Dual-filter Kawase blur fallback for low-tier bloom.

### Dev blogs / primary engine sources

- **spaceengine.org blogs**: 130716 (log depth rejected), 150803 (reversed-Z shipped), 150728 (ship Kepler/integration switching), 170312+170415 (HDR; MinPixelBright as *intent*), 200419 (histogram autoexposure overhaul), 171016/171102/171120/180323 (terrain #1–#6), 190328 (Terrain 2.0 meshless + texture arrays), 190611 (0.990: raymarched nebulae, bicubic volumetric upsample, E-galaxy gamma), 190217 (sprite-cloud galaxies), 161008 (raymarch program), 180817 (ephemerides + Kepler fallback), 180921 (octree artifacts), 220705/220830 (black holes), 240417 (Gaia catalog update), 250911/251118 (0.991 generation). The DSO manual and "Creating a planet" manual document the sprite/atmosphere/ring/cloud parameter surface.
- **HarvesteR (KSP devblogs, Aug 2012, via Wayback)**: "Krakensbane" (velocity rebase, 1500 m/s original threshold) and "Scaled Space: Now with 100% more Floating Origin!" (1/6000 proxy subscene, per-frame recenter, recursive-tier sketch).
- **Kemen (Outerra blog 2009/2012/2013)**: log-depth equations, precision decades, reversed-Z comparison, early-Z cost measurements.
- **Cesium blog**: "Rendering a Frame" (2015-05-14 — multifrustum, far/near 1000); "Graphics Tech in Cesium Stack" (2015-05-26 — GPU RTE/Ohlarik); Bagnell "Hybrid Multi-Frustum Logarithmic Depth" (2018-05-24; `logarithmicDepthFarToNearRatio` is 1.45+, not 1.28 — verifier-corrected).
- **Ohlarik — "Precisions, Precisions," AGI/Insight3D 2008.** The float-jitter ULP analysis + RTC/RTE/high-low encodings.
- **80.lv — Doc Ross (Frontier) interview.** Stellar Forge: top-down mass/metallicity budgets, octree sectors, 64-bit body addressing, Hipparcos/Gliese seeding (the *confirmed* Elite facts; per-jump skybox baking is community inference).
- **GamersNexus — Sean Tracy (Star Citizen) 2016; starcitizen.tools.** Selective 64-bit conversion, camera-relative rendering, nested zone system, histogram eye-adaptation + ACES.
- **Drain — "EVE Evolved: Touring a galaxy reborn," Engadget 2011.** Per-system skybox redraw from a real cluster model; faction nebula color identity.
- **Schreibt — "Homeworld 2 Backgrounds."** Vertex-painted skydomes = banding-free gradients (modern equivalent: HDR cubemap + blue-noise dither).
- **the-witness.net — "A Shader Trick" (Feb 2022).** Wrap shader clocks at powers of ten (credited to Ignacio Castaño).
- **Narkowicz — "Automatic Exposure" (2016); Hennessy (2014).** Histogram metering, percentile clipping, FX exclusion.
- **Reed — "Depth Precision Visualized," NVIDIA 2015.** Reversed-Z error simulation (0% misordered).
- **NAIF SPICE Time Required Reading; Celestia `date.cpp`; OpenSpace `timemanager.cpp`; KSP TimeWarp API/kOS Orbit docs.** Time-system conventions (et/TDB, leap-second table, warp interpolation, on-rails contract).

### Code

- **github.com/ebruneton/precomputed_atmospheric_scattering** (BSD-3, official WebGL2 demo); **jeantimex** three.js port; **takram-design-engineering/three-geospatial** (production Bruneton atmosphere + volumetric clouds for three.js; GLSL/pmndrs-only; maintenance risk); **JolifantoBambla/webgpu-sky-atmosphere** (MIT, WGSL Hillaire).
- **0beqz/realism-effects** (WebGL TRAA + VelocityDepthNormalPass — feasibility proof); **pmndrs/postprocessing** (mipmapBlur bloom, multisampling option).
- **figma/webgl-profiler** (per-pass EXT_disjoint_timer_query flamecharts); **stats-gl / r3f-perf GLPerf** (whole-frame GPU meter); **Spector.js** (per-draw capture, no timing).
- **rantonels/starless** (Schwarzschild Binet-equation lensing — the LUT-able mid tier); **REBOUND** (integrator reference, not for porting); **codeberg.org/astronexus/athyg** (the catalog); **gaiasky-catgen** (MPL2 octree generator); **OpenGlobe** (Cozzi & Ring reference engine).
- **three.js r171 source facts verified locally**: `EffectComposer.js:27` HalfFloat default / `:37` clone ping-pong; `RenderTarget.js:40` samples=0 default; `logdepthbuf_*.glsl.js` unconditional gl_FragDepth; `lights_physical_fragment.glsl.js:5-10` built-in specular AA; `WebGLCapabilities.js:95` clip-control gate; PRs #29445/#29579 (reversed-Z), #29881 (instancedArray, r171), #29594/#29615 (indirect draw, r170), #30359 (TimestampQueryPool, r173), #32967 (WebGPU reversed-Z, r183).

---

## 7. Gap analysis

| Legion area (files) | Current approach | Target technique | Effort | Payoff |
|---|---|---|---|---|
| Kepler math (`world.ts`, `systems.ts`) | P ∝ a² for planets, arbitrary moon constant, inclination as y/z shear, no Ω/ω/barycenters | n = √(μ/a³); full R_z(Ω)R_x(i)R_z(ω); barycenter parent tree; JPL approx elements for Sol | **S** | Correctness pillar; real ephemerides; foundation for SOI navigation |
| Time (`main.ts`, `state.ts`, `commands.ts`) | Unitless gameTime days; variable-dt loop contradicting its own comment; command tick = floor(gameTime) | f64 `et` TDB-s-past-J2000; Fiedler accumulator; KSP two-mode warp contract + event queue; tick on fixed-step counter | **S** | Determinism, multiplayer-safe ticks, unbounded rails warp |
| Shader clock (`main.ts:291` → grain/sun/galaxy uTime) | Unbounded f32 accumulation (live degradation bug) | Wrap at 1000 s, power-of-ten frequency quantization (Witness trick); wall clock for cosmetics, never warp-scaled | **S** (~5 lines) | Fixes session-length animation freeze/stutter |
| Coordinates (`scale-manager.ts`, `state.ts`, all renderers) | 3 inconsistent compressed scales (10⁶× mismatch); art-scaled radii; no rebasing | f64 nested frames (pc / km / m), scale-manager as frame broker, per-frame camera-at-origin per tier | **M** | Unified zoom continuum; jitter-free at all tiers; unlocks true distances |
| Depth (`renderer.ts`) | `logarithmicDepthBuffer: true` (gl_FragDepth everywhere, early-Z dead) | Per-tier depth partitioning (autoClear=false + clearDepth) now; `reversedDepthBuffer` after upgrade ≥r175 (broken in r171), WebGPU r183+ | **S–M** | Major hidden perf win on overdraw-heavy frames; z-fighting solved |
| Post chain (`post-processing.ts`, `renderer.ts`) | SMAA pre-tonemap on linear HDR; UnrealBloom threshold 1.2; ACES 0.85; grade/grain pre-tonemap; NaN-sanitize band-aid | Reorder (OutputPass→SMAA→grain); AgX; threshold-free 13-tap mip bloom + Karis; log-average auto-exposure; fix NaN sources | **M** | The single biggest "SpaceEngine look" lever |
| AA (`renderer.ts`, `post-processing.ts`) | Canvas MSAA inert; no working geometric AA | samples:4 HDR composer target (+ runtime RGBA16F-MSAA probe); post-tonemap SMAA; fwidth prefiltering; specular-AA lines in custom shaders | **S–M** | Planet limbs/rings/terminators stop crawling |
| Stars (`galactic-stars.ts`, population table) | 6-bucket art table, px-size sprites, no physics | mag→flux, blackbody LUT, energy-conserving PSF splats, streaks as stretched splats | **M** | Physically ratioed starfield that exposure/bloom can act on |
| Star catalog (`star-catalog.ts`, GAL_SYSTEMS) | 16 hand-authored systems, fictional coords, duplicated across tiers | AT-HYG v3.3 m10 subset (330k stars) → 20 B/star binary; one source of truth for both tiers; exclusion-indexed procedural fill | **M** | Navigationally truthful sky (design pillar); kills tier duplication |
| Atmosphere (`planet-atmosphere.ts`) | Fresnel-rim shell hack | Hillaire 2020 4-LUT (per-planet dynamic params; transmittance-driven terminator + limb at system tier; froxels at orbital tier) | **L** | The flagship visual upgrade; physically varied alien skies |
| Sun (`sun.ts` + shaders) | 512 cubemap re-rendered every frame; artistic ramp; no limb darkening | Distance-gated cubemap updates; blackbody color by spectral type; limb darkening; brightness from the photometric contract | **M** | Per-system star variety from catalog data; reclaimed GPU time |
| Galactic disc (`galactic-disc-volume.ts`) | Full-res 24 steps, no jitter, build-time AABB | Half-res RGBA16F + blue-noise jitter + Catmull-Rom upsample; per-frame AABB uniforms; shared density function with star spawner; baked cubemap at system tier | **M** | ~3–4× cheaper; banding gone; LOD seam coherent |
| Shadows/eclipses | None (no shadow maps anywhere) | Analytic circle-overlap occluders (2–4 uniforms) in planet/ring/atmosphere shaders; ring↔planet shadows both directions | **S** | Eclipses + Saturn-band shadows for a few ALU ops |
| Lighting | PointLight range 4000 decay 1 + AmbientLight | Inverse-square star light; analytic planetshine bounce lights; SH probe from baked galaxy cubemap | **S** | Night sides live; deep-space rim light; physically correct falloff |
| Asteroid belt (`asteroid-belt.ts`) | 2000 static instances, hand-coded Kirkwood gaps | MPCORB filtered subset (~50k, ~1.3 MB) with per-instance elements; Kepler solve in vertex shader | **M** | Real Kirkwood gaps/Hildas/Trojans emerge from data; belt actually orbits |
| Lens flare (`lens-flare.ts`) | Procedural overlay, zoom-tier gated | FFT-aperture PSF sprite, luminance-scaled, occlusion-tested (1-px RT sample) | **S–M** | Consistent camera identity; no flare-through-planet |
| Background sky (`particles.ts` legacy band) | 8000 decorative shell stars + 25k-point legacy band | Delete; replace with NASA SVS Deep Star Maps HDR cubemap and/or system-entry galactic bake | **S** | Removes double-sky inconsistency; HDR backdrop |
| Planet textures (`procedural-textures.ts`, /textures) | 2K color-only JPG/canvas | NASA/USGS/SolarSystemScope sources → KTX2 (toktx, UASTC/ETC1S) + Moon LOLA-derived normals | **S–M** | NASA-authentic system view; VRAM savings |
| Surface tier (future) | Nothing at camDist 0.6 WU | Cube-sphere quadtree + RTT heightmaps + DataArrayTexture cache + skirts + horizon culling (SE/Cesium pattern) | **L** | The eventual third tier; design documented above |
| Profiling | None (CPU FPS overlay only) | EXT_disjoint_timer_query per-pass harness + stats-gl + budget contract + Playwright replay with SwiftShader assertion | **S–M** | Every other row becomes measurable; regression gate |

---

## 8. Prioritized roadmap

Ordered by dependency; each phase's deliverables are independently shippable. File references are to current paths.

### Phase 0 — Correctness hygiene (days)

1. **Shader-clock wrap**: in `main.ts`, wrap `elapsedTime` at 1000 s before uniform upload; audit `sun-perlin.ts` sin/cos frequency constants to ≤3 decimal digits; grain/dash patterns tolerate any wrap. Keep a separate never-warp-scaled wall clock for cosmetic uniforms.
2. **Kepler fixes** in `world.ts`: physical mean motion (store μ per body), full Ω/ω/i rotation, barycenter parents. Unit-test element↔state round trip at 1e-9 incl. e≈0 / i≈0 cases.
3. **Fixed-timestep accumulator** in `main.ts` (Fiedler): fixed sim quantum for `runSystems`/`updateSteering`/`updateAI`, render interpolation for tracked movers, `setCommandTick` on the step counter, prevState re-seed on warp change.
4. **Profiling baseline**: drop in `stats-gl` (whole-frame GPU ms via EXT_disjoint_timer_query_webgl2 — Chrome/Edge; Safari behind the "Timer Queries" flag; Firefox: CPU-only); set `renderer.info.autoReset = false` with one `reset()` per frame and per-pass draw-call snapshots; record the per-tier baseline *before* any optimization below so every claim is same-machine measured.

### Phase 1 — Foundations: time, frames, depth (1–2 weeks)

5. **`et` master clock**: f64 TDB-seconds-past-J2000 module (julianDateTDB(), centuries T = et/3.15576e9, gameEpoch constant); UTC display = calendar(et − 69.184 s); `gameTime` becomes derived.
6. **JPL approximate elements for Sol**: static JSON element/rate tables + 40-line evaluator; SE-style frozen-Kepler fallback outside validity.
7. **Frame store + floating origin**: f64 positions per nested frame; scale-manager becomes the frame broker emitting per-frame camera-relative float32 roots; audit custom shaders for `cameraPosition`/`modelMatrix` subtraction (must use `modelViewMatrix`).
8. **Depth partitioning, log-depth off**: `renderer.autoClear = false`; backdrop scene → `clearDepth()` → system scene with tight near/far; remove `logarithmicDepthBuffer: true` and the logdepthbuf includes; run the post chain once on the composite. Measure the early-Z win with the Phase-0 harness. (Reversed-Z waits for the three.js upgrade — r171's `reverseDepthBuffer` is in the broken r170–r174 window.)
9. **Warp contract**: rails/integrating mode bit per entity; warp = clock multiplier on rails; event priority queue processed in timestamp order per frame; optional OpenSpace-style 1 s cubic deltaTime interpolation for the cinematic feel.

### Phase 2 — The photometric pipeline (1–2 weeks; sequence is load-bearing)

10. **Brightness contract**: relative-physical units (sun = 1.0 @ 1 AU), inverse-square star light replacing the PointLight falloff, all emissives re-ratioed (sun surface, star splats, night lights, disc emission). Document the unit per tier in the frame broker.
11. **Auto-exposure**: quarter-res log-luminance pass → mip chain → 1×1 sampled in the tonemap shader; Gaussian center weighting; τ ≈ 0.5 s/2 s adaptation in a 1×1 ping-pong; FX excluded from metering.
12. **AgX**: `renderer.toneMapping = THREE.AgXToneMapping`; retune exposure/bloom; verify no custom shader self-tonemaps.
13. **Bloom replacement**: pmndrs BloomEffect (`mipmapBlur: true, luminanceThreshold: 0`) or hand-rolled 13-tap chain with first-mip Karis average; remove the NaN-sanitize pass after fixing `normalize(0)` sources at origin.
14. **Pass reorder + AA**: composer target `{ type: HalfFloatType, samples: 4 }` (runtime-probe RGBA16F MSAA support; zero `samples` on the ping-pong clone); canvas `antialias: false`; OutputPass to buffer; SMAA after it; grain last. fwidth-smoothstep + width-clamp edges in ring/atmosphere/terminator shaders; copy three's 4-line specular-AA into custom planet materials.

### Phase 3 — Physical sky & light (2–3 weeks)

15. **Star photometry**: blackbody LUT (256×1 RGBA16F over log T) + mag→flux in the star shaders; PSF-splat rendering with energy-conserving streak stretching; glare sprites for the N≈50 brightest from the shared aperture-PSF texture.
16. **AT-HYG catalog**: Vite prebuild script — csv.gz → filter (drop dist ≥ 10000 pc sentinels) → BT/VT→Johnson (V = VT − 0.090(BT−VT); B−V = 0.850(BT−VT)) → equatorial→galactic rotation → 20 B/star interleaved binary (f32 xyz pc, u16 absmag, u16 B−V, u32 name index) + JSON name sidecar; one InterleavedBuffer Points draw with magnitude-sorted drawRange LOD; replaces both `star-catalog.ts` fictional coords and GAL_SYSTEMS duplicates. Ship CC BY-SA 4.0 attribution for the data file; keep code/art uncontaminated (collection, not adaptation).
17. **Analytic shadows + planetshine + SH ambient**: occluder-sphere uniforms in planet/ring/atmosphere shaders (circle-overlap visibility ×limb-darkening LUT); ring↔planet shadows both directions; 1–2 planetshine bounce lights from the Lambert-sphere formula; LightProbe from the baked galaxy cubemap.
18. **System-entry galactic bake**: render galactic tier → 6×1024–2048 RGBA16F `WebGLCubeRenderTarget` during the jump transition; system tier samples it; volumetric disc stops rendering per frame at system tier; SVS Deep Star Maps as art-reference/validation (and optional direct backdrop source).
19. **Disc raymarch optimization**: half-res target + static blue-noise jitter + Catmull-Rom upsample; per-frame AABB uniforms; shared density function with the star sampler; measured before/after via the harness.

### Phase 4 — Atmosphere (3–4 weeks)

20. **Hillaire 2020**: transmittance 256×64 + multi-scatter 32×32 (rebuild on parameter change only) per atmospheric body; sky-view 200×100 + froxel 32³ (`WebGL3DRenderTarget` or 2D slice atlas — spike which is faster cross-browser) for the dominant body; system-tier planets use transmittance-LUT-driven limb/terminator shading only. AtmosphereProfile struct per body (real Sol values from the canonical templates; procedural worlds via 1/λ⁴ + Mie g). Sun light color = TOA irradiance × transmittance at the surface point.
21. **Cloud shells**: 1–3 textured layers with differential rotation + projected surface shadows on Earth-likes.
22. **Sun upgrade**: distance-gated cubemap updates; blackbody color by catalog spectral type; limb darkening; corona brightness onto the photometric contract.

### Phase 5 — Data depth (parallel-izable)

23. **MPCORB belt**: build-time filter (2.0 < a < 3.6 AU, H < 14, ~50k) → 26 B/object binary; per-instance elements as attributes; Kepler solve (3–4 Newton iterations) in the asteroid vertex shader; MPC source-credit line.
24. **NASA Exoplanet Archive**: PSCompPars TAP pull, crossmatch to AT-HYG IDs, map onto PlanetType taxonomy; procedural fill flagged as such; incorporate eps Eri b into the home system.
25. **Texture pipeline**: Blue Marble / CGI Moon Kit (+LOLA→normal) / USGS Mars-Mercury-Venus / SolarSystemScope gas giants → toktx KTX2 (UASTC normals, ETC1S albedo); KTX2Loader + basis wasm; CREDITS.md.

### Phase 6 — WebGPU era (gated on three.js ≥ r183, ideally r185+)

26. Upgrade three.js (spike the legacy-EffectComposer→node-PostProcessing migration; the cross-frame ping-pong feedback needs re-validation); adopt `reversedDepthBuffer` on both backends, collapsing depth partitions where convenient.
27. TRAANode for temporal AA (MSAA off per docs; unjittered matrices for feedback passes; grain/CA post-resolve); histogram auto-exposure in compute; TimestampQueryPool profiling (`trackTimestamp` + `resolveTimestampsAsync`); compute-driven star culling via instancedArray + setIndirect when catalog depth grows.
28. Future tiers as designed above: cube-sphere quadtree terrain (compute heightmap generation), Takram-style volumetric clouds at low orbit, Schwarzschild-LUT lensing (deflection vs impact parameter, 1024×1 RGBA32F precomputed in JS) if compact objects become content, full Kerr two-pass à la SE as the showpiece.

**Profiling discipline throughout**: the per-pass EXT_disjoint_timer_query harness (sequential TIME_ELAPSED pairs, ring-buffered, disjoint-checked, ~200 lines or adapted from figma/webgl-profiler) with labels matching the budget table (galactic: disc ≤4.0 ms, stars ≤1.5, bloom ≤1.5, exposure ≤0.3, tonemap+UI ≤0.7; system: sun ≤2.0, planets+atmo ≤2.5, belt ≤1.5, flare ≤0.5, post ≤2.0 — initial allocations to be re-fit from the Phase-0 baseline). Compare p50/p95 over ≥300 warm frames, same machine only. CI later: Playwright `--headless=new` with platform GPU flags, **fail the job if UNMASKED_RENDERER contains "SwiftShader"**, deterministic camera replay per tier, JSON baselines with deliberate refresh. Note WebGPU timestamps are quantized to 100 µs in default Chrome (sub-ms budgets verified statistically or with `--enable-webgpu-developer-features`), and sum-of-passes < whole-frame is expected (inter-pass gaps invisible) — track both.

---

## 9. Open questions & unverified claims

**SpaceEngine internals (closed source; shaders encrypted since 0.990):**
- Coordinate representation (float64 vs fixed-point vs int128) and frame-handoff thresholds: undocumented; hierarchical-doubles + camera-relative is community inference.
- Forward vs deferred shading: never stated; forward inferred from MSAA + uber-shaders + no G-buffer mention.
- Whether modern SE still uses log depth/layered passes alongside reversed-Z; whether the Vulkan rewrite (status unknown through Dec 2025) changed the depth strategy.
- `MinPixelBright`/`MaxPixelBright` lux calibration: 2017 *design intent*, never confirmed shipped under those names. Floating-point framebuffers corroborated only indirectly.
- Whether SE models planetshine (probably not — inference from black night sides in screenshots); exact histogram-exposure parameters; `.atm` LUT binary format and whether it is 2008- or 2017-generation Bruneton; how one Earth-parameterized LUT is rescaled across radii/scale heights; per-node star-count derivation in the octree.
- The defunct en.spaceengine.org forum (offline since ~Nov 2025) likely holds deeper Romanyuk answers (galaxy impostor baking, star octree details) — recoverable via archive access.

**Comparator-engine claims at inference grade:**
- Elite's per-jump 6-face skybox bake: plausible community consensus, **not** dev-confirmed (the 80.lv interview covers generation only; the config's GalaxyBackground skybox-resolution key supports a runtime-generated skybox + instanced near stars). Specific face resolutions/time budgets unknown.
- KSP physics-bubble distances (~2.25–2.5 km) are community-documented, not primary-sourced (extract from Physics.cfg if load-bearing); KSP scaled-space camera constants are reverse-engineered — re-derive for Legion, don't copy.
- EVE: whether per-system skyboxes are prebaked offline or regenerated at jump time is explicitly uncertain in the best source; "cubemap" as storage format is community knowledge, not in the dev blog.
- NMS polygonizer specifics (dual contouring vs marching cubes) live only in the GDC video; superformula shipping status unconfirmed.
- Star Citizen zone-graph internals have no single public writeup.

**three.js / platform spikes needed before commitment:**
- Reversed-Z production stability on the *current* (mid-2026) release — tracking issue #31998 still listed shadow/SSAO/DoF breakage as of Oct 2025; hands-on spike before the Phase-6 upgrade.
- EXT_clip_control coverage on Legion's actual player hardware (57.6% Android) — decides how long the depth-partition fallback ships.
- `WebGL3DRenderTarget` vs 2D slice atlas for the Hillaire froxel volume (cross-browser perf); LUT-set budget when several atmospheric bodies are visible.
- RGBA16F multisample support on target mobile GPUs (spec-optional) — runtime probe required; pmndrs `multisampling` buffer/resolve behavior needs a source read if adopted.
- Sky-view LUT quality at Legion's orbital-to-system distances (thin limbs, multiple planets in frame) — may need the per-pixel ray-march fallback; prototype.
- WebGL timer-query effective resolution under ANGLE-on-Metal (any post-GLitch quantization is undocumented — measure empirically); whether FBO-to-FBO fullscreen passes time reliably (figma profiler's zero-time caveat); Safari 26/Firefox 141 WebGPU timestamp-query availability.
- takram three-atmosphere: vendor the GLSL now vs wait for the TSL rewrite (maintenance risk after client funding ended 03/2025).
- Whether the legacy-EffectComposer cross-frame ping-pong feedback survives the node-based PostProcessing migration (Phase 6 prerequisite spike).

**Data/licensing (counsel items):**
- Gaia license change (open-with-credit → CC BY-NC 3.0 IGO, bracketed 2024-05→2025-03): does ESA assert BY-NC retroactively over copies distributed under the earlier terms? AT-HYG's CC BY-SA 4.0 grant is irrevocable for material already received — strong but legally untested; flag for counsel before commercial launch (or email data.licences@esa.int for authorization).
- Hipparcos/Tycho-2 formal license: predates the CC regime, universally redistributed (NASA itself ships Tycho-2-derived public-domain products) — practical risk ~nil, formally undocumented.
- ShareAlike mechanics for the shipped star binary: bundling LICENSE+attribution is likely sufficient; publicly posting the .bin + build script removes all doubt (cheap, recommended).

**Design decisions unowned:**
- Warp-saturation policy (effective warp sags vs step coarsens vs force-to-rails) — interacts with the multiplayer command tick.
- Whether any gameplay needs true Lagrange points/resonances (forces scripted L-point patches; on-rails can't produce them emergently).
- Negative time rates (SE supports −1e12): free on rails, impossible for integrated/event-driven state — decide early if "rewind" is ever a feature.
- Real-calendar UTC HUD with frozen leap-second table vs fictional mission-elapsed calendar.
- Unsourced figure to never repeat: "≤2 Kepler iterations in 99.996% of cases" (in neither cited source).
