# Lab Requirements — Black Hole Lab · Star Lab · Nebula / Stellar-Nursery Lab

**Purpose.** Requirements for the three stubbed generator labs (`src/ui/labs.ts`: `star`,
`blackhole`, `nebula` — currently `available: false`), building on the planet lab's proven shell.
The *science* lives in the companion research docs — this doc specifies **what each lab must let
Sean see, change, save, and verify**. Compiled 2026-07-16.

Companions: [`black-hole-simulation-research.md`](black-hole-simulation-research.md) ·
[`procedural-star-research.md`](procedural-star-research.md) ·
[`nebula-simulation-research.md`](nebula-simulation-research.md) ·
[`stellar-phenomena-plan.md`](stellar-phenomena-plan.md) ·
[`giants-moons-rings-research.md`](giants-moons-rings-research.md)

---

## 0. Shared shell requirements (all three labs)

Everything the planet lab established is the contract, not an option:

1. **Single-example gallery** — a `PickerCtrl` archetype selector mounts ONE subject at a time,
   disposed/rebuilt on switch, framed by a per-lab `LAB_VIEW` radius. (Explicit Sean decision:
   "this gallery/singular view will be something we repeat for the sun/solar lab and
   nebula/stellar object lab.")
2. **Docked panel** — the shared `mountControlPanel` dock (right side, collapse-to-right,
   `--lab-dock-w` HUD reflow, prominent «LAB reopen tab), one section per subsystem, single-line
   section blurbs, click-to-edit slider values (sub-step precision), `InfoCtrl` for read-only
   physical readouts.
3. **Complete persistence** — a per-lab `LabSnap` (`legion.<lab>Lab.interim`) capturing **every**
   tunable (presets + any per-type toggles), Save/Revert/Copy-JSON *full set*, stale-snapshot-safe
   (key-by-key merge). No partial saves — this was an explicit correction on the planet lab.
4. **Clean-room isolation** — world particle systems/models culled, Milky Way backdrop KEPT
   (reference visual; and the black-hole lab *requires* it — §2). No raycast inspect. Time
   controls remain.
5. **Determinism** — subject fully derived from `(archetype, seed)`; Reseed re-rolls in place;
   Copy JSON round-trips into the canonical presets file.
6. **Dev hooks** — `__lab<Thing>` globals for verification (the `__labBake`/`__labStorms`
   pattern): each lab ships at least a state-dump hook and a torture hook (jump the clock, max a
   param) so the #11 verification loop stays scriptable.
7. **Acceptance per framework #11** — every lab feature lands with reference figures named in
   advance (EHT/Interstellar for the hole; SDO/solar photography for the star; Hubble/Chandra +
   Orlando models for nebulae), compared at native resolution before "ready for review."

---

## 1. Star Lab (`star`)

**Subject.** The system-tier hero star, generalized O→M + brown dwarfs — the bpodgursky technique
with its Sun-hardcoding removed (see research §1–2).

**Gallery archetypes.** `O · B · A · F · G · K · M` main-sequence, plus `L/T` (brown dwarf) and a
`WD` white dwarf stub. Luminosity class as a *control* (V default; III/I scale radius +
limb-darkening softness), not separate gallery entries.

**Sections & parameters**
| Section | Controls |
|---|---|
| Classification | Picker: spectral class · slider T_eff (500–40,000 K, drives color via `ColorUtils.setKelvin`) · luminosity class → radius/brightness · InfoCtrl readouts (M☉, R☉, L☉, expected color name) |
| Photosphere | granulation amplitude + scale (auto-scaled ↓ toward O/B — smooth photospheres are a *correctness gate*) · granulation animation speed · sunspot coverage, size, latitude band (butterfly zone) · M-dwarf mega-spot mode |
| Limb & corona | limb-darkening strength (deep for cool, shallow for hot) · chromosphere rim tint · corona radius/intensity/streamer count · corona billboard = cull/raycast proxy (existing pattern) |
| Activity | flare rate + intensity (↑ sharply for M dwarfs) · prominence loops (count, arc height) · CME chance (slow expanding shell burst) |
| Geometry | rotation period · oblateness (fast rotators bulge — B/A stars) · axial tilt |

**Requirements**
- One material generalizes across class: temperature/class drive *parameter curves*, not separate
  shaders. The class→appearance table in `procedural-star-research.md` §2 is the canonical mapping;
  the lab's job is tuning the curves' constants and saving them as `STAR_PRESETS`.
- **Perceptual gate**: no green/violet stars; G reads white, M reads orange (not crayon red).
  Saturation cap enforced in the temperature→color path, verified against the blackbody table.
- HDR/bloom budget: the star must not blow out the tonemap at lab framing; bloom threshold
  interaction is a lab slider (it changes how every archetype reads).
- Time controls drive granulation/flare animation; the torture hook jumps the star clock (weather
  P-06 lesson applies to granulation drift too).
- Wire into `derivePlanetParams`-style flow: system-gen already assigns stellar class; the lab
  edits the class preset, propagating to every generated system.

## 2. Black Hole Lab (`blackhole`)

**Subject.** The existing world set-piece (`blackHole.group`), promoted to a parameterized lab
subject. The correctness bar is Sean's standing one: **real geodesic lensing, not a bloom fake**
(research §6 ladder: full geodesic or deflection-table; the post-process fake is explicitly
rejected).

**Gallery archetypes.** `Stellar-mass` (X-ray-binary look: small, hot, blue-white disk) ·
`Supermassive` (Sgr A*/M87: huge, cooler orange disk, gentle) · `AGN/Quasar` (violent disk +
relativistic jets). Spin is a slider, not an archetype.

**Sections & parameters**
| Section | Controls |
|---|---|
| Hole | mass (sets every length: r_s, photon ring, shadow) · spin a ∈ [−1, 1] (ISCO slides 6M→M prograde; frame-drag asymmetry) · InfoCtrl readouts: r_s, r_ISCO, b_crit = 3√3 M shadow radius |
| Accretion disk | inner radius (default = ISCO, override for gaps) · outer radius · temperature/palette ramp · accretion rate → brightness · turbulence/hot-spot detail · disk tilt vs camera (the Interstellar over-under fold is the money shot at high inclination) |
| Relativity | Doppler beaming strength (approaching side brighter/bluer — with a physical/exaggerated blend) · gravitational redshift falloff · photon-ring intensity · lensing quality ladder (per research §6: geodesic steps ↔ deflection-table ↔ weak-field far-zone) |
| Jets | on/off · length, opening angle, brightness · precession wobble |
| Environment | background star/backdrop lensing toggle · lensed-image doubling inspection zoom |

**Requirements**
- **The lab MUST keep the star backdrop + Milky Way skybox alive inside the lensing pass** —
  lensing without a lensed background is invisible. (Clean-room culling exempts whatever the
  ray-marcher samples; the backdrop cubemap is the sample source.)
- Correctness gates (InfoCtrl-verifiable, from the research doc): shadow diameter ≈ 2×3√3 M on
  screen at known FOV; disk near-side fold visible above/below the shadow at ≥ 60° inclination;
  beaming brightens the *approaching* side (sign check!); ISCO tracks the spin slider per the
  Bardeen–Press–Teukolsky curve.
- Performance ladder is a lab control (steps cap + half-res toggle) so the quality/fps trade is
  explorable; the deflection-table option pre-integrates on Rebuild.
- The lens is a post-pass: it must compose with the docked panel (panel excluded from distortion)
  and the FPS meter — lab framing pins the hole at screen center at LAB_VIEW distance.

## 3. Nebula / Stellar-Nursery Lab (`nebula`)

**Subject.** The phenomenon-archetype renderer from `stellar-phenomena-plan.md` — nested
iso-density shells (Orlando technique) and/or single-box raymarch (galaxy playbook §3), tuned per
archetype in isolation. `testNebula` already exists as the seed implementation.

**Gallery archetypes.** `Emission (H II)` · `Reflection` · `Dark (Bok globule)` ·
`Planetary nebula` · `Supernova remnant` · `Stellar nursery (pillars)`.

**Sections & parameters**
| Section | Controls |
|---|---|
| Morphology | density-field seed + Reseed · scale/extent · fbm vs curl-noise mix (filament anisotropy — SNRs are curl-dominated) · shell count + spacing (PN/SNR nested shells) · pillar erosion vector (photoevaporation direction, nursery only) |
| Emission & palette | line-mix sliders: Hα (656 nm red) / OIII (501 nm teal) / SII (deep red) · "natural ↔ Hubble-palette" blend · emission intensity · reflection tint (blue dust) for reflection type |
| Dust & extinction | dust density (Beer–Lambert extinction — the ONLY correct star-occlusion path, playbook #9) · dust/gas ratio · dark-nebula silhouette mode |
| Illumination | embedded star count + temperature (ionizing O/B → emission strength coupling) · external illumination direction · protostar sprinkle + accretion glints (nursery) |
| Quality | renderer strategy A/B: **iso-shells ↔ raymarch** · raymarch step cap · half/quarter-res toggle · blue-noise jitter + temporal reprojection on/off |

**Requirements**
- **The A/B between Orlando iso-shells and the raymarch is a first-class lab feature** — the two
  strategies have different cost/quality envelopes and the lab exists to decide per-archetype
  which ships. Same density field feeds both.
- Emission color is *physics-locked by default*: gas-type palettes ship at the real line colors;
  the Hubble-palette blend is an explicit artistic override, never the silent default.
- Verification set: dust must silhouette the background starfield (Beer–Lambert gate); no
  stacked-plane artifacts under orbit (playbook #7); temporal-reprojection ghosting checked with
  the motion-torture hook (P-06 discipline); palette swatches against real Hα/OIII references.
- Import path stub: accept a baked 3D texture / VDB-derived density (Blender MCP pipeline) as an
  alternative to procedural noise — the canonical-atlas heroes (Cas A etc.) arrive that way.
- Scale: nebulae are the largest lab subjects — LAB_VIEW framing needs a per-archetype radius
  (a nursery is not a planetary nebula); camera auto-orbit preset for judging parallax depth.

---

## Build order recommendation
1. **Star Lab** — smallest new surface (one material, no post-pass, no volumetrics), completes the
   system-tier hero set, and its presets feed every generated system immediately.
2. **Nebula Lab** — unblocks the stellar-phenomena Phase work; the archetype A/B decides the
   renderer strategy the canonical atlas will use.
3. **Black Hole Lab** — highest wow, but gated on the WebGPU geodesic integration
   (research §7 hybrid: oseiskar math in a wgslFn node); promote the existing set-piece once the
   lens pass is parameterizable.

Registry flips (`labs.ts` `available: true`), trigger routes, persistence keys, and dev hooks land
with each lab per the shared contract in §0.
