# Procedural Planet & Surface Generation — research reference

**Purpose.** Source-anchored reference for procedural planets at **two levels** — a rendered globe at
system-zoom, and a **simulatable surface** for the eventual gameplay (creatures, alien races,
colonization/city-management, Factorio-like surface factories). Roadmap lives in
[`procedural-worlds-plan.md`](procedural-worlds-plan.md). Compiled 2026-07-11.

**Framing.** Two problems, different in kind: (1) a **rendered globe** is a shading/LOD problem you
can largely fake on the GPU; (2) a **simulatable surface** is a data-structure + world-persistence
problem where visuals are secondary. Almost every hard decision comes from wanting both to be the
*same* planet, seamlessly.

## 1. Primary references
- **[jsulpis/realtime-planet-shader](https://github.com/jsulpis/realtime-planet-shader)** — WebGL/GLSL,
  renders the planet as an **analytic ray-sphere intersection in a fragment shader** (one fullscreen
  quad, no mesh), fBm terrain color/normals, fake distance-glow atmosphere. 60fps on low-end mobile.
  *Reusable:* the cheapest "distant planet dot → globe" for the far system-zoom tier. Not a path to a
  surface.
- **[raguilar011095/planet_heightmap_generation](https://github.com/raguilar011095/planet_heightmap_generation)** —
  equirectangular heightmap → sphere. *Reusable:* the heightmap-as-source-of-truth idea (one texture
  drives globe + later surface sampling); weakness is polar distortion (→ cube-sphere below).
- **[orogen.studio (World Orogen)](https://www.orogen.studio)** — **the single most relevant
  reference.** Browser-based, **Three.js 0.160 + Delaunator + Web Workers**, no build step, GPL-3.0.
  Full geology pipeline: **tectonic plates → erosion (glacial/hydraulic/thermal) → climate (winds,
  currents, precipitation, Köppen) → hotspot volcanism**. Topology = Fibonacci sphere + **Voronoi via
  Delaunay**, elevation from distance-field blending + simplex/ridged/domain-warp noise. Exports
  equirectangular terrain/biome/Köppen/heightmap up to 65,536px + **shareable planet codes**
  (determinism blueprint). Runs Legion's exact stack — study it as the Tier-1 architecture.

## 2. Globe terrain (system-zoom)
**Consensus: cube-sphere + noise on the GPU.** Project a cube's faces to a sphere (near-uniform
vertices, no equirectangular pole pinch), displace by noise.
- [Sebastian Lague — Procedural Planets](https://github.com/SebLague/Procedural-Planets) (canonical
  cube-sphere walkthrough) · [Making Worlds — spheres vs cubes](https://acko.net/blog/making-worlds-1-of-spheres-and-cubes/)
- **Directly portable WebGL2 impl of the Lague stack:** [fqhd/ProceduralPlanets](https://github.com/fqhd/ProceduralPlanets)
- Noise vocabulary: **fBm** (continents), **ridged multifractal** (mountains), **domain warping**
  (organic coastlines). [Red Blob planet generation](https://www.redblobgames.com/x/1843-planet-generation/)

## 3. Atmosphere / clouds / planet types
- **Physically-based Rayleigh/Mie scattering** — [GPU Gems 2 ch.16](https://developer.nvidia.com/gpugems/gpugems2/part-ii-shading-lighting-and-shadows/chapter-16-accurate-atmospheric-scattering);
  drop-in GLSL [wwwtyro/glsl-atmosphere](https://github.com/wwwtyro/glsl-atmosphere); LUT-accelerated
  [sinnwrig/URP-Atmosphere](https://github.com/sinnwrig/URP-Atmosphere); best explainer
  [Maxime Heckel](https://blog.maximeheckel.com/posts/on-rendering-the-sky-sunsets-and-planets/);
  volumetric + ozone [BarthPaleologue](https://github.com/BarthPaleologue/volumetric-atmospheric-scattering).
- **Terminator + night city-lights** fall out of the sun-direction dot product (emissive mask where `NdotL<0`).
- **Planet types** (rocky/gas/ice/ocean/lava/desert) = parameter presets over the same shader.

## 4. Water
At globe scale, **screen-space water post-process** (depth-reconstruct, blend shallow/deep by depth,
Fresnel+specular) — Lague / [fqhd port](https://github.com/fqhd/ProceduralPlanets). Real waves/
shorelines belong to the surface tier.

## 5. Planet LOD + the space→surface problem (the hard one)
**Cube-sphere quadtree / chunked LOD** — each of 6 faces a quadtree; chunks split near camera, merge far.
- Studyable impl: [cuberact chunked-LOD planet](https://github.com/cuberact/godot-cuberact-planet-chunked-lod)
  (17×17 chunks, parent-vertex reuse, frustum + horizon culling).
- Theory: Ulrich's **Chunked LOD**; Strugar's **CDLOD** (morphs between levels, kills popping);
  survey [Procedural Planetary Multi-resolution Terrain (arXiv 1803.04612)](https://arxiv.org/pdf/1803.04612).
- **Seamless space→surface** = one continuous quadtree from planet-radius to sub-meter (core custom
  work) **+ float precision** (the thing that actually breaks).
- **AAA precedent:** [No Man's Sky continuous generation (GDC)](https://www.gdcvault.com/play/1024265/Continuous-World-Generation-in-No);
  [Star Citizen 64-bit world + 32-bit camera-relative render](https://gamersnexus.net/gg/2622-star-citizen-sean-tracy-64bit-engine-tech-edge-blending).

**Float precision — mandatory at planet scale.** 32-bit floats lose sub-meter precision thousands of
km from origin → jitter + Z-fighting. Fix: **64-bit doubles + camera-relative (RTE) / floating-origin**.
[Floating the origin devlog](https://frozenfractal.com/blog/2024/4/11/around-the-world-14-floating-the-origin/) ·
[RTC vs RTE at globe scale](https://reearth.engineering/posts/high-precision-rendering-en/). **Legion
already has a float64 authoritative store + per-frame floating origin** (the scale-unification Broker) —
a major head start on the single hardest problem here.

## 6. Terrain realism: tectonics, erosion, climate
- **Tectonics:** [Cortial 2019 — Procedural Tectonic Planets](https://perso.liris.cnrs.fr/eric.galin/Articles/2019-planets.pdf)
  (sphere-native plates); [Cordonnier 2016 — uplift + fluvial erosion](https://www.cs.purdue.edu/cgvlab/www/resources/papers/Cordonnier-Computer_Graphics_Forum-2016-Large_Scale_Terrain_Generation_from_Tectonic_Uplift_and_Fluvial_.pdf);
  cheap game shortcut = seed N plate centers, flood-fill, drift vectors, collide→mountains ([Red Blob](https://www.redblobgames.com/x/1843-planet-generation/)).
- **Erosion:** [droplet hydraulic erosion explainer](https://jobtalle.com/simulating_hydraulic_erosion.html);
  GPU [Mei et al.](https://www.researchgate.net/publication/4295561_Fast_Hydraulic_Erosion_Simulation_and_Visualization_on_GPU) /
  [UnityTerrainErosionGPU](https://github.com/bshishov/UnityTerrainErosionGPU); stream-power-law shortcut.
- **Whole-planet GPU sim in one artifact** (closest to Legion's ambition): [davidar — "Four billion years in four minutes"](https://davidar.io/post/sim-glsl)
  (cratering → tectonics → erosion → climate → ecology as GLSL passes).
- **Climate/biomes:** [Whittaker diagram](http://pcg.wikidot.com/pcg-algorithm:whittaker-diagram)
  (temp × precip → biome); [biome/moisture recipe](https://azgaar.wordpress.com/2017/06/30/biomes-generation-and-rendering/);
  winds from latitude pressure + Coriolis ([Red Blob wind](https://www.redblobgames.com/x/1731-wind-patterns/)).
  Atmosphere *composition* → habitability as per-planet scalars gating biomes/creatures, not chemistry.

## 7. Gameplay world representation (the simulation substrate)
The decision that constrains creatures/colonies/factories:
- **Chunked square grid (Factorio):** 32×32-tile chunks, generated on demand, **deactivated when idle**
  — the trick that makes big factory sim tractable. [Factorio map structure](https://wiki.factorio.com/Map_structure). Flat/local, not global.
- **Region-tile hierarchy (Dwarf Fortress):** coarse worldgen fields → fractal fill; region tiles
  streamed where the player is. [DF worldgen](https://dwarffortresswiki.org/index.php/World_generation).
- **Goldberg polyhedron / geodesic hex grid (global, seamless):** sphere of hexes + 12 pentagons,
  near-uniform, no pole distortion. [Red Blob Goldberg-Coxeter](https://www.redblobgames.com/x/1902-goldberg-coxeter/) ·
  [Babylon Goldberg mesh](https://doc.babylonjs.com/features/featuresDeepDive/mesh/creation/polyhedra/goldberg_poly/).
  (Orogen already builds a Fibonacci-Voronoi mesh serving this role.)

**The pragmatic reconciliation:** **two representations at two scales** — a coarse **global
geodesic/Voronoi cell map** (Goldberg) for planet-wide state (biomes, climate, colony regions) + a
streamed **local flat chunked grid** (Factorio/DF, tangent-plane projected) for fine factory/creature
sim. The globe cell tells the local grid what to generate; the local grid never needs curvature.

## 8. Determinism (seed → identical planet)
- **Seed cascade** (No Man's Sky): one seed hashed into all downstream seeds; nothing stored. [algorithms](https://www.rambus.com/blogs/the-algorithms-of-no-mans-sky-2/)
- **Seeded RNG threaded through generation** (Red Blob): pipeline = pure function of seed.
- **Planet codes** (Orogen): full parameter set → shareable string.
- **Caution:** deterministic erosion/tectonic *sim* needs fixed iterations/timestep/float-order, or
  **bake the sim once to a heightmap/texture and treat that as canonical** (the safe architecture:
  seed → deterministic coarse fields + a one-time baked sim cached/persisted, never re-rolled). Mirrors
  Legion's existing `(sector, index)` determinism discipline.

## 9. Top recommendations (impact ÷ effort)
1. **Ship the cube-sphere globe now** (port the Lague/fqhd WebGL2 stack) — every system gets real planets immediately. [fqhd](https://github.com/fqhd/ProceduralPlanets) · [Lague](https://github.com/SebLague/Procedural-Planets)
2. **Rayleigh/Mie atmosphere as a post-process shell** — huge payoff, self-contained; terminator + city-lights for free. [wwwtyro](https://github.com/wwwtyro/glsl-atmosphere)
3. **Adopt Orogen as the Tier-1 reference; bake its outputs to textures** (sidesteps deterministic-sim fragility). [orogen.studio](https://www.orogen.studio)
4. **Lean on Legion's existing doubles + floating-origin** before attempting descent — the non-negotiable space→surface gate, already largely solved here.
5. **Design the surface substrate as global-Goldberg + local-flat-chunk from day one** — what makes creatures/colonies/factory-sim tractable. [Goldberg](https://www.redblobgames.com/x/1902-goldberg-coxeter/) · [Factorio chunks](https://wiki.factorio.com/Map_structure)

**Deeper study, in priority:** [davidar GPU whole-planet sim](https://davidar.io/post/sim-glsl) ·
[Cortial 2019](https://perso.liris.cnrs.fr/eric.galin/Articles/2019-planets.pdf) ·
[cuberact chunked-LOD](https://github.com/cuberact/godot-cuberact-planet-chunked-lod) ·
[Red Blob sphere gen](https://www.redblobgames.com/x/1843-planet-generation/).
