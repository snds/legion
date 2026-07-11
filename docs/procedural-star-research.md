# Procedural Star Rendering — research reference

**Purpose.** Source-anchored reference for rendering a generated system's **star** at system-zoom with
the correct spectral type, color, size, and surface/flare behavior. Roadmap lives in
[`procedural-worlds-plan.md`](procedural-worlds-plan.md). Compiled 2026-07-11.

## 1. Primary technique + its gap
[bpodgursky's procedural star](https://bpodgursky.com/2017/02/01/procedural-star-rendering-with-three-js-and-webgl-shaders/)
([corona GLSL](https://github.com/bpodgursky/uncharted/blob/master/src/main/www/com/bpodgursky/uncharted/www/resources/noise/corona-fragment-shader.glsl)):
a sphere with a blackbody-temperature base color perturbed by 3D simplex noise — **granulation**
(4 octaves, the perf/detail sweet spot), **sunspots** (low-freq clamped noise), a broad
temperature-variation layer, time-animated, plus a distance-scaled **corona** billboard that doubles
as the raycast/cull proxy. **Its limitation:** everything is hand-tuned to the Sun — a hardcoded
stepwise RGB-by-temperature GLSL function, fixed noise params, no flares, no limb darkening, no
type-dependent activity. It does **not** generalize O→M without manual retuning. That generalization
is exactly what Legion needs.

## 2. Stellar class → appearance (the parameter table)
Main-sequence (class V), from [Stellar classification](https://en.wikipedia.org/wiki/Stellar_classification):

| Class | T_eff (K) | Perceived color | Mass (M☉) | Radius (R☉) | Luminosity (L☉) | % of MS |
|---|---|---|---|---|---|---|
| O | ≥ 33,000 | blue-white | ≥ 16 | ≥ 6.6 | ≥ 30,000 | 0.00003% |
| B | 10,000–33,000 | blue-white | 2.1–16 | 1.8–6.6 | 25–30,000 | 0.12% |
| A | 7,300–10,000 | white | 1.4–2.1 | 1.4–1.8 | 5–25 | 0.61% |
| F | 6,000–7,300 | white | 1.04–1.4 | 1.15–1.4 | 1.5–5 | 3.0% |
| G | 5,300–6,000 | yellowish-white (Sun looks white) | 0.8–1.04 | 0.96–1.15 | 0.6–1.5 | 7.6% |
| K | 3,900–5,300 | pale yellow-orange | 0.45–0.8 | 0.7–0.96 | 0.08–0.6 | 12% |
| M | 2,300–3,900 | orange-red | 0.08–0.45 | ≤ 0.7 | ≤ 0.08 | 76% |

Brown dwarfs: **L** ~1,300–2,300 K (deep red), **T** ~550–1,300 K (dim magenta/grey), **Y** < ~550 K.
Luminosity classes (I supergiant … V dwarf … VII white dwarf) drive **radius** (disc size + limb-
darkening softness) at a *given* color — **color = temperature; size/brightness = luminosity class.**

**Perceptual caveat (load-bearing):** the eye sees stars far paler than the spectral labels —
"yellow" G looks white, "red" M looks orange, and there are **no green/violet stars** (broadband
thermal emission desaturates to white). Do not over-saturate.

### Temperature → color
Blackbody / Planckian-locus → sRGB is exactly what the eye perceives. **Best news: it's already in
Three.js** — [`ColorUtils.setKelvin(color, kelvin)`](https://threejs.org/docs/pages/module-ColorUtils.html)
(the [Tanner Helland](https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html)
piecewise fit, valid 1000–40000 K), so the whole temperature→color step is one built-in call — the
bpodgursky LUT limitation removed for free. Validate against [Mitchell Charity's blackbody table](http://www.vendian.org/mncharity/dir3/blackbody/)
if desired. Theory: [Scratchapixel blackbody](https://www.scratchapixel.com/lessons/cg-gems/blackbody/blackbody.html).

## 3. Surface by type (physics → shader)
- **Granulation/convection** — animated fBm/simplex; **scale amplitude UP toward M, ~0 for O/B**
  (early-type stars lack surface convection — smooth photospheres). [Granulation physics](https://arxiv.org/pdf/1308.4873) ·
  [O/B smooth](https://arxiv.org/pdf/1305.5549).
- **Plasma flow** — domain-warp a final fBm layer by a secondary fBm; curl noise for divergence-free
  swirl. Worked GLSL (6-octave fBm + domain warp + limb Fresnel): [Sangil Lee](https://sangillee.com/2024-06-29-create-realistic-sun-with-shaders/).
- **Limb darkening** — `dot(normal,viewDir)` / Fresnel edge falloff (dimmer, redder rim).
- **Starspots** — clamped low-freq noise, coverage scaled by activity.
- **Differential rotation** — latitude-dependent rotation of the noise sample.
- **Activity = f(type, age, rotation)** — young/fast M–K dwarfs are strongly **flare-prone**; old
  dwarfs and O/B are quiet. [Activity–age–rotation](https://arxiv.org/pdf/astro-ph/0502305) ·
  [Living with a Red Dwarf](https://iopscience.iop.org/article/10.3847/1538-4357/ad0840).

## 4. Flares / corona / glow (real-time)
- **Corona via CubeCamera + displaced noise sphere + bloom** — the [FDL "Sun in Three.js" build](https://tympanus.net/codrops/2021/01/25/recreating-frontier-development-labs-sun-in-three-js/).
- **Pure-GLSL corona + polar-coordinate sine flares** — [sun-shader](https://github.com/bradleyJT-CS/sun-shader) ·
  [Shadertoy flaming sun](https://www.shadertoy.com/view/4dXGR4).
- **HDR + `UnrealBloomPass` scaled by luminosity** — sells scale/visual-magnitude and makes the
  distant point-of-light hand-off correct (bpodgursky's corona couldn't).
- **Prominences/CMEs** — billboarded limb arcs / noise eruptions, gated by `activity`.

## 5. Wiring to generated data
Standard main-sequence relations, game-usable:
- **L ≈ M³·⁵** ([mass–luminosity](https://www.physics.unlv.edu/~jeffery/astro/star/diagram/mass_luminosity.html)); **R ≈ M^0.8** (or read radius from §2 by class); **T = (L/(4πR²σ))^0.25** — keeps color, size, brightness mutually consistent.
- **T → color:** `ColorUtils.setKelvin`.
- **Luminosity class → radius multiplier + limb softness**; white dwarf = tiny + hot-blue.
- **Activity = f(type, age, rotation)** → granulation amp, spot coverage, flare/prominence rate.
- **Uniforms:** `uTemperature, uRadius, uLuminosityClass, uGranulationAmp, uSpotCoverage, uActivity,
  uRotation, uDifferential, uTime`, bloom ∝ luminosity.
- **Population realism:** ~76% M / 12% K / 8% G — warm field, rare blue-white jewels. Reference impl:
  [CK42BB/procedural-stars-threejs](https://github.com/CK42BB/procedural-stars-threejs).

## 6. Top recommendations (impact ÷ effort)
1. **`ColorUtils.setKelvin(T)` from generated T_eff** — near-zero effort, every star physically-correctly colored O→M.
2. **One uniform-driven material parameterized by the star record** (mass→L,R,T; type→granulation/activity) — renders all types, no per-star tuning.
3. **HDR + bloom ∝ luminosity** — sells scale + the distant point-of-light hand-off.
4. **fBm + domain-warp plasma flow + limb Fresnel, activity-gated (0 for O/B)** — [Sangil Lee GLSL](https://sangillee.com/2024-06-29-create-realistic-sun-with-shaders/).
5. **Activity-gated flares/prominences** — makes the 76% M-dwarf population feel alive and distinct.
