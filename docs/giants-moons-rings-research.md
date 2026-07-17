# Giants, Rings, Moons & Exotic Configurations — research reference

**Purpose.** Source-anchored science for the next wave of planetary features: the ice/gas giant
visual pass, rings as an **any-archetype** feature, moon/satellite generation per archetype, and
the exotic configurations (binary planets, habitable moons of giants, super-earths) that exoplanet
science and hard SF both support. Compiled 2026-07-16. Companion plan docs:
[`procedural-worlds-plan.md`](procedural-worlds-plan.md) (planet roadmap),
[`labs-blackhole-star-nebula-requirements.md`](labs-blackhole-star-nebula-requirements.md) (labs).

Rendering-first framing per `sci-astro-objects`: get the physics right and the body reads as
hard-SF, not fantasy — every section ends with **Legion implications** (params → presets → lab).

---

## 1. Ice giants vs gas giants — two archetypes, not one

The current `gas`/`ice` presets share the banded GIANT material. The science says they should
diverge sharply:

| Property | Gas giant (Jupiter/Saturn) | Ice giant (Uranus/Neptune) |
|---|---|---|
| Bulk | H/He throughout | H/He envelope over water/methane/ammonia "ices" |
| Color driver | NH₃/NH₄SH cloud chromophores — cream/tan/rust | **CH₄ absorbs red → blue/teal**; Neptune deeper blue than Uranus (less haze or an extra absorber) |
| Banding | **Fine** alternating zones (bright, upwelling) & belts (dark, sinking); jets to ±400 km/h; ~2,000 mi deep | **No fine banding** — broad retrograde equatorial jet + one prograde jet per high latitude; hazy, few visible features (Uranus nearly featureless; Neptune active) |
| Storms | Anticyclones pinned in shear lanes — Great Red Spot (16,000 km, 22°S, centuries old); Saturn's Great White Spots | Dark vortices (Neptune GDS) that **drift in latitude** and die in years; bright methane-ice companion clouds |
| Poles | Cyclone clusters: Jupiter's pentagon/octagon of polar cyclones; **Saturn's hexagon** (6-sided jet, 2× Earth per side) | Seasonal pole-on illumination (Uranus tilt 98°) |
| Internal heat | Strong (drives convection) | Uranus ≈ none (hence bland), Neptune strong (hence storms despite 1/900 sunlight) |

Sources: [NASA Jupiter facts](https://science.nasa.gov/jupiter/jupiter-facts/) ·
[Ice-giant circulation (PMC7040070)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7040070/) ·
[Ice giant systems review (arXiv:1907.02963)](https://arxiv.org/pdf/1907.02963) ·
[Jupiter/Saturn weather-layer dynamics](https://link.springer.com/article/10.1186/s40562-020-00159-3) ·
[GRS](https://en.wikipedia.org/wiki/Great_Red_Spot) ·
[Saturn hexagon](https://www.syfy.com/syfy-wire/what-is-up-with-that-hexagon-on-saturn) ·
[Jupiter polar cyclones](https://theconversation.com/jupiter-scientists-spot-pentagon-pattern-of-cyclones-and-unlock-secrets-of-the-planets-interior-92949)

**Legion implications**
- Split the GIANT material presets: `gas` = many bands, high band contrast, warm palette,
  storm-prone (existing `stormChance` → GRS-class anticyclone with spiral texture);
  `ice` = 2–3 broad soft bands, cold methane palette (hue slider = CH₄ fraction), heavy haze
  (low-contrast limb), rare **dark** vortex + bright companion cloud instead of a red spot.
- Port the weather-system lessons from the cloud deck: bounded oscillating shear (ledger P-06),
  time-morphing turbulence, Coriolis-correct storm spin — the giant bands are the same math at
  different constants. One `giantWeather` GLSL chunk, two parameterizations.
- **Polar features** are the memorable close-ups: a polar cyclone cluster (N small vortices ringing
  one large, count 5–8) for gas; a hexagonal jet option (six-lobed standing wave on one band edge)
  as a rare Saturn-class trait. Both are shader-cheap (angular sector functions near |lat| > 0.75).
- Axial tilt is already per-body (`orient` channel); an ice giant rolled ~90° with seasonal pole-on
  lighting is a free "Uranus" wonder.
- Lab: the single-example gallery already selects `gas`/`ice` — the archetypes just need their own
  sections (Bands, Storms, Poles, Haze) once the material splits.

## 2. Planetary rings — a feature for any archetype

**Formation & structure.** Dense rings live at/inside the **Roche limit** (~2.4× radius for
fluid bodies): tidal forces shred or prevent accretion, so disrupted moons/comets or failed
satellites persist as a disc. Gaps (Cassini divisions) are carved by **mean-motion resonances**
with moons — rings and moons are one system, not two features. Ring composition sets albedo:
Saturn's bright water ice vs the dark reddish dust of Jupiter/Uranus rings.
[Roche/rings overview](https://www.planetary.org/articles/why-do-planets-have-rings) ·
[Rings beyond the giant planets (arXiv:1612.03321)](https://arxiv.org/pdf/1612.03321)

**Rocky/small bodies genuinely have rings.** Occultations found dense narrow rings around the
centaur **Chariklo** (~250 km body, two crisp ringlets near its Roche limit), **Haumea**, and —
theory-breaking — **Quaoar**, whose two rings sit *far outside* its Roche limit (elastic collisions
and a 6:1 resonance with its moon Weywot appear to keep them unaccreted).
[Quaoar ring (Nature)](https://www.nature.com/articles/s41586-022-05629-6) ·
[Quaoar–Weywot 6/1 resonance (arXiv:2308.07189)](https://arxiv.org/pdf/2308.07189)
At the other extreme, exoplanet **J1407b** is a "super-Saturn": a ring system ~200× Saturn's,
filling a large fraction of its Hill sphere, with moon-carved gaps.
[J1407b ring gaps (arXiv:1902.09285)](https://arxiv.org/pdf/1902.09285)

**Legion implications** — `rings.ts` already generates structured, samplable bands with
`hasRings` (55% giants, 4% terrestrials). Extend, don't replace:
- **Per-archetype ring character**: giants → broad multi-band systems (current behavior);
  rocky/desert/lava/ocean/ice → **Chariklo-style**: 1–3 *narrow, dense* ringlets, tighter radii.
  One new `RingStyle` knob (`broad` | `ringlets`) derived from archetype + seed.
- **Palette from composition**: icy bright (outer-system bodies, ice archetype) vs dark
  reddish dust (inner/rocky) — a per-system `ringTint` + albedo, replacing any single global tint.
- **The missing visuals that sell rings**: (a) **planet shadow across the rings** (a clean
  shadow wedge behind the planet), (b) **ring shadow banding on the planet** (thin dark latitudes
  that move with season/tilt), (c) forward-scattering brightening at the unlit side's edge.
  These are the difference between "disc texture" and "Saturn."
- **Rare wonder seeds**: a J1407b super-ring variant (Hill-sphere-filling, best at gas giants,
  `rng < ~0.01`) and a Quaoar "impossible ring" (far, thin, off-Roche) for small icy bodies.
- Rings inherit the body's tilt (already true via `tiltGroup`) — an eccentric tilted ring against
  the galaxy backdrop is the archetypal hard-SF beauty shot.
- Lab: a **Rings section** in the planet lab (style, band count, density, tint, tilt already
  implicit, shadow toggles) applicable to every archetype; `hasRings` becomes lab-forceable.

## 3. Moons & satellites — generation per archetype

**Three formation channels, three architectures**
([exomoon review](https://en.wikipedia.org/wiki/Exomoon) ·
[PDS 70c circumplanetary disk](https://www.mpg.de/17248532/0720-astr-moon-forming-disk-around-an-exoplanet-150980-x)):
1. **Circumplanetary-disk co-accretion** (giants): regular satellites — prograde, near-equatorial,
   near-circular, in **resonance chains** (Io:Europa:Ganymede = 1:2:4). Total satellite mass scales
   ~**10⁻⁴ of the planet** (Canup–Ward), so even Jupiter-class planets get Moon-to-Mars-sized
   majors, not Earths. Observationally confirmed: PDS 70c's moon-forming disk (ALMA).
2. **Giant impact** (rocky worlds): one large moon from a debris disc — Earth–Moon (~1.2% mass
   ratio), Pluto–Charon (~12%!). Prograde, initially close, tidally receding.
3. **Capture** (anyone, biased to giants): retrograde/inclined/eccentric — Neptune's Triton
   (retrograde, doomed), Mars' Phobos/Deimos-like captured rubble. Eccentric at first; tides
   circularize.

**Moon visual archetypes** (small bodies are their own render set):
cratered ice (Callisto), smooth cracked ice over ocean (Europa; Enceclus-style south-pole plumes),
sulfur-volcanic (Io — tidal heating from resonance + proximity), rock/regolith (Luna),
and **sub-spherical "potatoes"** below ~200 km radius (hydrostatic limit) — captured rubble must
NOT be rendered as spheres.

**Legion implications**
- `system-gen`: per-planet `moons[]` derived deterministically from seed + archetype:
  - giants: 3–6 majors on a resonance chain (pick period ratios from {1:2, 2:3, 3:4}) + optional
    retrograde captured outer moon; total mass budget 10⁻⁴ M_planet sets radii.
  - rocky/ocean/desert: 0–2 — either one impact-class moon (large, close, prograde) or 1–2
    captured potatoes; lava: usually none (young/hot).
  - ice (dwarf-class): binary-prone — see §4.
- Moon renderer = the existing planet globe at small radius for spherical moons (reuse the
  archetype presets with a `moon` bias: no atmosphere by default, higher crater defaults), plus a
  new lumpy-icosahedron potato mesh for sub-200 km bodies.
- **Tidal locking is default** (same face to primary — spin = orbit period); Io-class tidal
  heating (emissive vents) when the moon sits deep in the resonance chain.
- Rings ↔ moons couple: shepherd moons at ring gaps (place a tiny moon at each major `RingBand`
  gap); a moon inside the Roche limit is instead ring material (never generate both).
- Lab: moons belong to the **planet lab** as a section (count, chain, sizes, potato threshold,
  lock/heating), with the gallery able to focus a selected moon (the single-example pattern
  already supports swapping the focused body).

## 4. Exotic configurations (exoplanet science + hard SF)

**Binary planets.** Two planetary-mass bodies orbiting a barycenter *outside both* — Pluto–Charon
is the local prototype (barycenter ~960 km above Pluto's surface, mutually tidally locked, 6.4 d).
Formation: giant impact (rocky pairs) or capture via three-body scattering in the first ~100 Myr.
No confirmed exoplanet binary yet, but theoretically expected and stable when compact vs the Hill
sphere. [Pluto–Charon tidal evolution (A&A)](https://www.aanda.org/articles/aa/full_html/2020/12/aa38858-20/aa38858-20.html) ·
[Binary planet formation through tides (MNRAS)](https://academic.oup.com/mnras/article/527/2/3837/7379620) ·
[Where are the double planets?](https://phys.org/news/2023-11-planets.html)
- *Legion*: a `binaryWith` link in system-gen (rare, biased to ice-dwarf + rocky archetypes);
  render as two globes orbiting a shared point with mutual tidal lock (each shows the other a
  fixed face — the co-rotating sky is the wonder); camera framing must target the barycenter.

**Habitable moons of giants.** Kepler found **100+ giants in habitable zones**; an Earth-like moon
there is the classic SF setting and physically legitimate — but co-accreted moons cap at ~10⁻⁴
M_planet, so an **Earth-mass moon requires impact/capture origin** (rare = special).
Moon habitability adds: eclipses by the primary (a real, regular night), tidal lock **to the
planet** (day length = orbit period, not stellar day), tidal heating as a second energy source, and
the giant filling tens of degrees of sky.
[121 candidate giants](https://www.astronomy.com/science/kepler-data-reveals-121-gas-giants-that-could-harbor-habitable-moons/) ·
[Exomoon habitability](https://en.wikipedia.org/wiki/Habitability_of_natural_satellites)
(The famous exomoon *candidates* Kepler-1625b-i / 1708b-i are now
[doubted](https://www.nature.com/articles/s41550-023-02148-w) — treat "Neptune-sized moons" as
fiction, Earth-sized as speculative-plausible.)
- *Legion*: allow `ocean`/`rocky` archetype bodies as **moons of giants** (the §3 mass budget gets
  a rare override flag); their sky/lighting inherits eclipse cycles — even without simulating
  atmospherics, the giant's reflected light warming the night side is a cheap emissive-ambient term.

**Super-earths / mini-Neptunes / hycean worlds.** The most common planets (1–4 R⊕) are bimodal:
rocky super-earths (~1.4 R⊕ peak) vs volatile-rich mini-Neptunes (~2.4 R⊕), split by the **radius
valley at ~1.8 R⊕**. Water-rich interpretations give **ocean worlds** and **hycean** planets (warm
deep ocean under a hydrogen sky). [Radius valley (PMC11035145)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11035145/) ·
[Hycean conditions (arXiv:2402.12330)](https://arxiv.org/pdf/2402.12330)
- *Legion*: super-earth = existing rocky/ocean presets scaled up with **relief scaled DOWN**
  (higher gravity flattens topography — scale `displacement` ∝ 1/g); mini-Neptune = small ice-giant
  material with thick limb haze; **hycean** = a new derived preset: global ocean (seaLevel ≈ 1),
  pale hydrogen-haze atmosphere, dense warm cloud deck — three presets, no new shaders.

---

## Suggested build order (each independently shippable)
1. **Giant material split** (gas vs ice parameterization + polar features + storm port) — unblocks
   the deferred ice/gas archetype pass with the weather-system code we already trust.
2. **Rings v2** (styles, palettes, shadows, any-archetype + lab section) — high visual ROI,
   `rings.ts` foundation already exists.
3. **Moons** (system-gen `moons[]` + tidal lock + potato mesh + lab section) — biggest scope;
   rings v2's shepherd coupling lands here.
4. **Exotics** (binary pairs, giant-orbiting habitables, super-earth/hycean presets) — mostly
   system-gen + presets once 1–3 exist.
