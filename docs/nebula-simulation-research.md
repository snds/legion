# Nebula & Stellar-Phenomena Rendering — research reference

**Purpose.** Source-anchored reference for recreating scientifically-grounded, visually stunning
renderings of real Milky Way nebulae and stellar phenomena in Legion's real-time WebGL/Three.js
renderer. This is the *evidence base*; the actionable roadmap lives in
[`stellar-phenomena-plan.md`](stellar-phenomena-plan.md). Every physics claim below is anchored to a
primary source (arXiv, IOP/ARA&A, NASA/STScI/ESA, or the artist's own papers/interviews); some
how-to links are secondary (blog/astrophotography) and flagged as such.

Compiled 2026-07-11 from a research sweep triggered by Sean finding Salvatore Orlando's Sketchfab
work.

---

## 1. The artist and his method — Salvatore Orlando (INAF Palermo)

**Identity.** Salvatore Orlando, Sketchfab handle **[@sorlando](https://sketchfab.com/sorlando)**, a
**Research Director at INAF – Osservatorio Astronomico di Palermo** (Italian National Institute for
Astrophysics). Expertise: astrophysics, magnetohydrodynamics (MHD), parallel/HPC. Sketchfab
"Master" (~620k views, 202M triangles across models).

- Sketchfab: https://sketchfab.com/sorlando
- ArtStation: https://www.artstation.com/saorlando4
- INAF page: https://astropa.inaf.it/?p=9930

**Why it matters:** his models are rendered directly from the same 3D (M)HD simulations behind his
peer-reviewed research, so morphology is physically grounded — both his *outputs* and his *method*
are usable reference material. **NASA/Chandra officially ships his models** (Cassiopeia A,
G292.0+1.8, Cygnus Loop/Veil, BP Tau; April 2025) — the validated reference for "stunning but
accurate."

### The pipeline (his own words + primary sources)
1. **Simulate.** 3D HD/MHD runs with **FLASH** (U. Chicago) or **PLUTO** (Turin) — Godunov-type MHD,
   MPI-parallel, ~10⁴ CPUs and millions of CPU-hours. Physics modeled: gravity, magnetic-field-
   oriented thermal conduction, radiative losses, viscosity, non-equilibrium ionization, cosmic-ray
   acceleration.
2. **Extract geometry.** In **ParaView** (also VisIt, IDL) he builds **multilayer iso-density
   surfaces at graduated opacities** — nested semi-transparent isosurface *shells* that turn a
   continuous volume into a real-time-friendly mesh.
3. **Fake diffuse gas cheaply** (verbatim): *"complex meshes in which the grid points are randomized
   and the faces of the meshes are intertwined; the gas effect is completed by selecting appropriate
   transparency of the faces of the meshes, according to some properties encoded in specific
   textures."* Mesh edits in MeshMixer/MeshLab; finishing in Blender/Unreal.

**Takeaway:** nested transparent iso-density shells + property-encoded opacity textures is a proven,
real-time-cheap approximation of a volumetric simulation without true volume raymarching — and it is
exactly how the reference art is made.

**Primary sources:**
- 3DMAP-VR pipeline paper — Orlando et al. 2019, arXiv: https://arxiv.org/abs/1912.02649
- Technique writeup (INAF/OAPA): https://sketchfab.com/blogs/community/modeling-astrophysical-phenomena-at-inaf-oapa/
- "Meet the Masters" interview: https://sketchfab.com/blogs/community/meet-the-masters-salvatore-orlando/
- NASA/Chandra 3D models (his): https://chandra.harvard.edu/photo/2025/3dmodels/ · downloadable files: https://chandra.harvard.edu/resources/illustrations/3d_files.html

### His relevant catalogue (Sketchfab reference)
- **Neutron stars / magnetars:** "A highly magnetized rotating neutron star" (the magnetar); "Pulsar"
- **Black holes:** "Interstellar: Gargantua" (×2); "An active Seyfert Galaxy"
- **Nebulae / nurseries:** "The Helix nebula"; "A stellar nursery in the interstellar space"; "Stars and nebulae"
- **Supernovae / remnants:** "Evolution of SN 1987A"; "Core-collapse Supernova"; "The remnant of a Supernova explosion"; "Iron distribution in a Supernova Remnant"; "T Coronae Borealis" (recurrent nova / symbiotic binary)
- **Stellar / accretion:** "The young accreting star DG Tauri B"; "Low-Mass X-ray Binary (LMXB)"; "Giant CME in an active star"
- **Other:** WASP-76b, protoplanet collision, open cluster, "Navigating the Cosmic Web"

---

## 2. Techniques by phenomenon

### Emission / reflection / planetary nebulae & stellar nurseries
**Science.** Morphology is set by an ionizing star's UV carving an **HII region** behind an
**ionization front**, with dust providing extinction/scattering. Color is *line emission*, not
blackbody: **H-alpha 656.3 nm (deep red)**, **[OIII] 500.7 nm (teal-green, traces hottest/most-
ionized gas near the star)**, **[SII] 672 nm (red)**, **H-beta (blue)**. Dust lanes are pure
absorption. Reflection nebulae are blue (Rayleigh-scattered starlight, no emission).

**Real-time approximation.** Map a scalar ionization/density field to an emission-color ramp
(hot core → [OIII] teal → H-alpha red → neutral dust) and treat dust as an absorption term. Then
either (a) Orlando's nested-isosurface shells, (b) volumetric raymarching of a procedural density
field with an emission+absorption integral, or (c) billboarded/gaussian-splat clouds tinted by the
same ramp.

- Line-emission color: https://en.wikipedia.org/wiki/H-alpha · https://astrobackyard.com/emission-nebula/ *(secondary)*
- STScI 2D→3D "flythrough" method (Frank Summers' transparency-compositing renderer, multi-layer 2.5D + true 3D): https://science.nasa.gov/missions/hubble/experience-hubbles-universe-in-3-d/
- Pillars of Creation (Hubble+Webb) 3D viz: https://science.nasa.gov/missions/hubble/new-hubble-webb-pillars-of-creation-visualization/
- Carina 3D viz: https://www.ipac.caltech.edu/news/new-nasa-3d-visualization-explores-the-carina-nebula-complex

### Stellar nurseries / star formation (formation physics)
**Science.** Turbulent, magnetized molecular clouds collapse under gravity; massive stars then inject
ionizing + wind **feedback** that both destroys and triggers star formation. "Pillars"/"elephant
trunks" are photoevaporation sculptures — dense clumps shadowing gas from a nearby O-star's UV, young
stars forming at the tips.
- Photo-ionization self-regulation: https://arxiv.org/abs/1701.07982
- Compressive turbulence in Carina pillars: https://arxiv.org/pdf/2010.09861
- 3D pillar/globule formation around HII regions: https://arxiv.org/pdf/1207.6400

**Real-time approximation.** Don't simulate collapse live — *shape* clouds with a dust map (§3) +
procedural noise, orient pillars/trunks toward the nearest hot star, add an erosion/glow gradient
along that axis.

### Black holes (accretion disk + relativistic optics)
**Science.** The reference is the *Interstellar*/Gargantua work: **DNGR** (Double Negative
Gravitational Renderer) + Kip Thorne — null-geodesic integration around a spinning (Kerr) hole:
gravitational lensing, photon ring, Doppler + gravitational shifts on the disk.
- Paper — James, von Tunzelmann, Franklin, Thorne 2015, CQG 32 065001: https://iopscience.iop.org/article/10.1088/0264-9381/32/6/065001
- Writeups: https://cerncourier.com/a/building-gargantua/ · https://physicsworld.com/a/decoding-the-dark-arts-of-interstellars-black-hole/ *(secondary)*

**Real-time approximation (WebGL/WebGPU, with source):**
- Schwarzschild geodesic GLSL shader over Three.js (physically faithful): https://github.com/oseiskar/black-hole
- Production shader (photon ring, disk, Doppler beaming): https://ebruneton.github.io/black_hole_shader/
- Three.js TSL/WebGPU raymarched BH tutorial: https://threejsroadmap.com/blog/raytracing-a-black-hole-with-webgpu

### Magnetars / neutron stars
**Science.** Young neutron stars, **B ≈ 10¹⁴–10¹⁶ G**. Field decay cracks the crust ("starquakes"),
twists the magnetosphere, drives X-ray/gamma bursts and giant flares. Visually: small hot rotating
sphere + structured dipole/twisted magnetosphere + beamed hotspots.
- Review — Kaspi & Beloborodov 2017, ARA&A 55 261: https://arxiv.org/abs/1703.00068

**Real-time approximation.** Blackbody-hot sphere + animated procedural dipole field-lines + emissive
polar hotspots + episodic burst flashes; magnetosphere twist as a shader-animated field-line bundle.

### Binary stars (Roche lobes, mass transfer, common envelope)
**Science.** Equipotential **Roche lobes** meet at inner Lagrange point **L1**; donor overflow sends a
gas **stream** through L1 → impacts the companion or forms an **accretion disk**; extreme cases → a
**common envelope**. Underlies LMXBs, novae (Orlando's T CrB), cataclysmic variables.
- Common-envelope / RLOF: https://arxiv.org/abs/1809.02297 · pre-CE accretion disks: https://arxiv.org/pdf/2502.02933

**Real-time approximation.** Analytic Roche-lobe teardrop equipotentials + an L1 stream as a curved
particle/ribbon + a flat differentially-rotating emissive accretion disk with a bright impact hot spot.

---

## 3. Data sources (with what each gives us)

**3D dust / cloud placement — the highest-value category for real nebula *geography*:**
- **Edenhofer et al. 2024** — highest-resolution 3D dust map of the solar neighborhood, **69 pc–1.25
  kpc, parsec-scale**, resolves internal structure of hundreds of molecular clouds. arXiv:
  https://arxiv.org/abs/2308.01295 · queryable via the `dustmaps` package. *Gives us: real 3D
  positions/shapes of nearby dust clouds to voxelize into nebula density fields — in the SAME frame
  as Legion's real HYG stars.*
- **Bayestar / Green et al.** — 3D dust reddening over ¾ of the sky (PS1 + Gaia + 2MASS). Papers:
  http://argonaut.skymaps.info/papers · docs: https://dustmaps.readthedocs.io · code:
  https://github.com/gregreen/dustmaps
- **Lallement et al. 2019/2022** — Gaia-2MASS 3D dust to ~3 kpc (Local Arm, Radcliffe Wave):
  https://arxiv.org/abs/2203.01627

**HII regions / ionized gas — where the emission nebulae actually are:**
- **WISE Catalog of Galactic HII Regions** (Anderson et al.) — ~8,000 HII regions, positions/sizes.
  Paper: https://arxiv.org/abs/1312.6202 · data: http://astro.phys.wvu.edu/wise/ *Gives us: a real
  catalog to seed emission nebulae + their ionizing stars.*
- H-alpha surveys (WHAM full-sky, SHASSA, IPHAS) for the diffuse ionized-gas glow distribution.

**Ready-made scientifically-grounded 3D models (drop-in reference/assets):**
- Orlando's Sketchfab collection: https://sketchfab.com/sorlando
- NASA/Chandra 3D files (Cas A, Cygnus Loop, …): https://chandra.harvard.edu/resources/illustrations/3d_files.html · NASA 3D: https://science.nasa.gov/3d-resources/

---

## 4. Rendering-tech references (WebGL/Three.js, with code)

- Volume rendering in WebGL2 (3D-texture raymarching): https://www.willusher.io/webgl/2019/01/13/volume-rendering-with-webgl/
- Customizable Three.js volume renderer (procedural GLSL density): https://github.com/Donitzo/three.js-volume-renderer
- Volumetric raymarched clouds in R3F (adaptable to nebulae): https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/
- Procedural stars/nebulae for Three.js (WebGPU compute + WebGL2 fallback; already implements
  emission/reflection/dark/planetary/SNR nebula types): https://github.com/CK42BB/procedural-stars-threejs
- Emerging — **KHR_gaussian_splatting** glTF extension (ratifying 2026) + OpenVDB→LOD-splat research
  (a future path to load volumetric astro data as splats in Three.js):
  https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_gaussian_splatting/README.md
  · https://arxiv.org/abs/2504.04857

---

## 5. How this maps to Legion today

- **`renderGasBlur` (galaxy-sim.ts)** already builds a blurred gas buffer from star-distribution
  puffs — a coarse cousin of Orlando's "randomized intertwined transparent meshes + opacity
  textures." The nested-shell method is the structured upgrade path.
- **Real HYG 25 pc star frame** — Legion already pins the neighbourhood to real stars at real
  positions. The **Edenhofer 3D dust map covers the exact same volume**, so real dust/nebulae can be
  dropped in at real coordinates with zero frame mismatch. This is the standout near-term win.
- **Gas coloring** is currently an amber-nucleus/blue-arm cross-section; a physically-motivated
  **emission-color ramp** ([OIII] teal → H-alpha red → dust absorption) would make emission vs.
  reflection vs. dark nebulae read correctly for cheap.
- **Scale-unification Phase 5's "far = volumetric cloud" ambition** now has two concrete paths:
  nested-shell meshes (cheap, LOD-friendly, everywhere) + true raymarching (hero objects only).
- **Deterministic sector mapping** (sector-manager / region-manager / galaxy-enumerate, seeded per
  (sector, index)) is the integration point for *procedurally propagating* the canonical phenomena
  into uncharted space — see the plan.

---

## 6. Caveats
- Many secondary how-to links (astrophotography/blogs) are convenience references; cite the primary
  sources (arXiv/IOP/ARA&A/NASA-STScI/artist) in design decisions.
- Orlando's assets are CC-licensed on Sketchfab but check per-model license before shipping any
  derivative; the *technique* is unencumbered. Sean has reached out to the artist directly (2026-07).
- True volume raymarching is the most expensive path — reserve for a few showpieces; use nested
  shells / splats for the general field.

---

## 7. Additional procedural-generation sources (galaxy/nebula/particle techniques)

Assessed against the shell + dust-map base. None is a drop-in upgrade, but three contribute reusable
pieces; two are thin demos to skip.

- **[Solaris-Explorer](https://github.com/Jupiter0818/Solaris-Explorer)** (Three.js, MIT, single-file
  demo — math is production-sound). The standout: a **logarithmic spiral-arm particle placement**
  recipe — `r = pow(rand(),1.5)·rMax` (core-density bias), `θ = base + (i%arms)·(2π/arms) +
  (r/rMax)·W·π` (W≈3, arms 2–4, logarithmic winding), `y = (rand()−0.5)·r·0.2·(1−r/rMax·0.6)` (disk
  thins outward), color lerp core→arm by `r/rMax`. Slots straight into the galactic-frame catalog
  particle layer to give it real arm structure. Also: Keplerian accretion (`ω ∝ 1/r`) and Fresnel rim
  shaders.
- **[three-nebula](https://three-nebula.org)** ([repo](https://github.com/creativelifeform/three-nebula),
  MIT, ~1.2k★, the only production-grade **library** — but last release targets three@0.122, so
  **version/WebGPU compat needs checking; may adopt the emitter/behaviour *pattern* over the
  dependency**). The right tool for **dynamic emissive effects shells can't do**: engine jets (line-
  zone emitter + axial Force), CME/flares (radial Force + Life + Color/Alpha decay), accretion streams
  (Attraction behaviour), SN ejecta, comet tails, sparse parallaxing nebula wisps. Gate counts by LOD.
- **[ecency GLSL galaxies/nebulae article](https://ecency.com/@hey2d/creating-procedural-galaxies-and-nebulas-in-glsl-em9)**
  — a **domain-warp + power-curve emission** recipe: `uv += vec2(fbm(p·3), fbm(p·3+5))·0.2` before
  sampling density (kills banding, yields filaments), then escalating `pow(density,{2,5})` for layered
  core glow. Maps directly onto the shell fragment shader (sampling the dust map instead of 2D fbm).
- **Skip:** [Celestial-Object-Generator](https://github.com/Kritgoel/Celestial-Object-Generator)
  (offline 2D Python raster) and [nebula-weaver](https://github.com/dropmoltbot/nebula-weaver) (thin
  R3F demo; only the layered-sine motion + `mat2` vortex swirl are worth remembering).

**Approach fit:** shells + dust map = the *base*; instanced particles = stars / spiral arms; screen-
space fBm + domain warp = surface treatment *on* the shells; particle engine = *dynamic* effects
(jets/CMEs/ejecta). Notably none of the five raymarch — validating shells as the pragmatic middle
ground between raymarch cost and flat-billboard cheapness.
