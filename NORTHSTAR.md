# NORTHSTAR.md — Legion

Movie-level / engine-class references that gate Legion visual acceptance (Workspace framework
#12). Spirit vs Literal called per row. Paths may be local captures or URLs; keep durable copies
under a project refs folder when possible.

`$LEGION_REF` is Sean's `Legion Reference` folder. Reference ids such as `frame-002` and
`legion-016` are the ids in the reviewed list, `refs/northstars/reference-review-2026-11-09.json`.
A copy of each cited still sits in `refs/northstars/<row id>/`. `refs/` is git-ignored, so these
copies are local to a machine; the reviewed list is also kept in Sean's workspace.

## How to use

1. At `shape` time, name the **layer** the change belongs to, then pick the rows that apply.
2. At `match` time, align stills or video frames and run `render-qa-toolkit` `reference_match` +
   native grid assess.
3. Motion-sensitive features must cite a **video** northstar (or a recorded path judged against
   still northstars frame-by-frame) — not a single screenshot.
4. For a Spirit row, the test is the "Proves" column: can each thing it names be pointed to in
   the capture? A Spirit row is never passed by resemblance alone.

## Why the work is ordered as it is

Sean's sequence, recorded so it is not second-guessed again: start in a system the player has
already visited, bring its planets and the system round them to a high enough quality, and only
then branch out into the rest of the game, because the fidelity bar will have been set. The bar
is set once, on the hardest subject, and everything built after it is held to it.

## Scale ladder

The player explores first, and exploring is moving along this ladder. Every rung has its own bar.
A rung is not excused because another rung looks good.

| Rung | What is on screen | Contract | Northstar rows | State on 2026-10-28 |
|---|---|---|---|---|
| **Surface** | Terrain, atmosphere from inside, horizon | Literal | `se-planet`, `aaa-atmos`, `legion-fly-approach` | Planet Lab work; not reviewed here |
| **Orbit** | One body filling much of the frame: limb, terminator, clouds, night side | Literal. **The most important rung, with Surface** | `se-planet`, `se-star`, `legion-continuum-ideal` | Soft cloud and land shapes, thick pale rim |
| **System** | Star, planets, belts, orbits, the player's assets | Fidelity required at this level; see [S-1](#s-1) | `orbit-diagram`, `se-star`, `esa-sky` | Lines at one weight; star is a glare patch; planets are flat discs |
| **Local region** | Nearby stars as true points, routes, named systems | Fidelity required at this level | `esa-sky`, `sector-grid`, `hw-glyphs` | Good glyphs inside heavy fills |
| **Spiral arm** | Arm structure, dust, the band of the galaxy | Fidelity required at this level | `esa-sky` | Soft; blocky patches |
| **Galaxy** | The whole disc on true black | Fidelity required at this level | `esa-sky` | Soft blur; a different grade from the band |

**Transitions are part of each rung.** The move from one rung to the next is judged as motion,
against a video row, never from two stills.

## Layers

A frame is built from layers. Exploration comes first, so the layers the player meets first lead.
A system the player has visited then adds the tactical layers on top.

| Order | Layer | What it is | Bar | State on 2026-10-28 |
|---|---|---|---|---|
| 1 | **Bodies** | Stars, planets, moons, belts, rings | By rung, above | Built. Softer than its references |
| 2 | **Backdrop** | Galaxy, star field, dust, nebulae | By rung, above | Built. Soft, and graded two ways |
| 3 | **Photography** | Camera, lens, depth of field, exposure, framing | Spirit to the film rows and the hard-surface renders | Not treated as a layer yet |
| 4 | **Units and structures** | The probe, ships, stations, extractors, smelters, assemblers, conduits | Spirit | Absent |
| 5 | **Tactical** | Glyphs, stalks, rings, ranges, orders, health, the sensors chart | Literal to the glyph sheet once written; Spirit to Homeworld until then | Begun: stalks, rings and shaped icons exist |
| 6 | **Strategic** | System, sector and galaxy maps as charts: territory, routes, bearings | Spirit | Sector sphere and plane exist as heavy fills |
| 7 | **Instruments** | Panels, readouts, build and research lists, the player's chrome | Spirit to the instrument rows; Literal to Legion's own token sheet once written | A developer's interface. Not designed |

**One grade across all of them.** See the grade rows below.

## References, grouped by context and intent

One image can serve several contexts. A ship shot against a planet through a long lens is a
photography reference, a background reference and a foreground reference at once. **Each context
is judged separately, and an image may lead in one and be weak in another.**

| Context | What is judged | Images that serve it, of 53 |
|---|---|---|
| **Photography** | Lens and focal length, depth of field, exposure, framing, how scale is staged | 27 |
| **Background, sky** | Star field, galaxy, dust, nebula | 25 |
| **Background, body** | A planet or star behind or beside the subject | 8 |
| **Foreground, units** | Hulls, structures, livery, lights | 23 |
| **Interface** | Glyphs, panels, readouts, how marks sit on the scene | 35 |
| **Tactical map** | Orbits, courses, ranges as diagram | 5 |
| **Strategic map** | Territory, grids, bearings | 6 |
| **Motion** | Camera moves, transitions, how marks track moving things | 24 |

The contexts are written into the reviewed list as a `contexts` field on each image. They were
assigned by family as a first pass, not image by image. A `rating` field sits beside it for Sean
to fill: 0 not a guide, 1 useful, 2 strong, 3 the lead for its context.

## Film / cinematic (look language)

| ID | Reference | Contract | Proves |
|---|---|---|---|
| `film-martian` | *The Martian* — orbital / surface lighting plates | Spirit | Dusty physical sunlight, grounded exposure, industrial craft |
| `film-expanse` | *The Expanse* — ship / station exteriors | Spirit | Hard light, material honesty, scale of hull vs human |
| `film-oblivion` | *Oblivion* (2013) — landscapes + craft | Spirit | Clean sci-fi compositions, restrained grade |

## Tactical layer (new)

| ID | Reference | Contract | Proves |
|---|---|---|---|
| `hw-glyphs` | Homeworld 2 Remastered, fleet views: `frame-002`, `frame-003`, `frame-004`, `frame-006` | Spirit | Class is a shape and side is a colour, so a fleet reads at any zoom. Height is a stalk and a ground ring in 1 px lines |
| `hw-sensors` | **Motion.** Homeworld 2 campaign footage, 562 extracted frames: `$LEGION_REF/Legion-Reference-Media/Video/Homeworld 2 ｜ Campaign ｜ Ep 11_frames/`. Steps: scene, the switch into the sensors chart, the chart held, the switch back | Spirit | The scene becomes a chart without changing the glyph language. How long the switch takes, what stays fixed on screen through it, and how the camera moves |
| `hw-threat` | **Motion.** The same footage. Steps: selection, order given, units moving, engagement, damage | Spirit | Threat is geometry: each line ends on the thing being hit and follows it as it moves. Health sits next to its unit at a fixed thickness at every zoom. How marks hold onto moving things |
| `orbit-diagram` | Monochrome orbital diagrams: `legion-018`, `legion-020` | Spirit | Three strengths of one white give near, middle and far. Only the stretch of orbit that matters is lit |
| `nav-course` | *The Expanse* navigation panel: `legion-024`; flight-path infographic: `legion-026` | Spirit | The course is the one thick bright line on a field of thin dim ones |

## Instruments and chrome (new)

| ID | Reference | Contract | Proves |
|---|---|---|---|
| `fui-mono` | Monochrome grid and instrument panels: `legion-000`, `legion-008`, `legion-011` | Spirit | One typeface, one stroke weight and one grid do everything. State is carried by fill or weight, so the layout holds with colour removed |
| `fui-three-ink` | Feed panel in three inks: `legion-007` | Spirit | Each ink has one job: structure, measurement, and the active or dangerous thing |
| `hw-panels` | Homeworld build and research panels: `legion-002`, `legion-005`, `frame-000` | Spirit | Colour is a strict code. Progress is the fill of the label itself. One colour is kept for the thing the player must do |
| `chrome-limit` | Homeworld text over a bright hull (the failing case in the reviewed list) | Spirit, as a warning | Text laid on the world fails on bright ground. Legion's text is drawn over the 3D view, never inside it |

## Units and structures (new)

| ID | Reference | Contract | Proves |
|---|---|---|---|
| `hard-surface` | Hard-surface renders and concept painting: `legion-004`, `legion-021` | Spirit | Every shape is a recognisable engineering part: modules, trusses, radiators. Colour appears only where a real craft would paint livery or warnings |
| `hw-hulls` | Homeworld 2 Remastered hulls: `frame-001`, `frame-005`, `frame-013` | Spirit | Scale comes from small repeated lights and panel grids on a large surface. Livery colour gives the side with overlays off |
| `scale-silhouette` | A dark built silhouette against a lit planet: `legion-004` and the hard-surface family. Judged in three contexts: photography, background body, foreground unit | Spirit | Photography: a long lens flattens the planet behind the hull, so the planet reads as vast. Background: the body is lit and simple. Foreground: the hull is dark, built and specific |

## Strategic layer (new)

| ID | Reference | Contract | Proves |
|---|---|---|---|
| `faction-map` | Faction maps: `legion-016`, `legion-023` | Spirit | Territory is a dark fill with a bright edge of the same hue, so large areas do not glare and borders stay crisp. A neutral white instrument layer sits on top |
| `sector-grid` | Astrometrics grids: `legion-012`, `legion-019` | Spirit | A grid of labelled boxes turns a star field into territory that can be named. Territories are quiet tints; the small bright marks on top are what is read |
| `polar-bearing` | Polar-grid faction map, family `faction-map-polar-grid` in the reviewed list | Spirit | Every system has a bearing and a distance from home at a glance |

## Engine / game northstars

| ID | Reference | Contract | Proves |
|---|---|---|---|
| `se-planet` | SpaceEngine — planet approach / surface flythrough. Durable refs: `refs/continuum/stills/NORTHSTAR/space engine/`, motion `refs/continuum/motion/NORTHSTAR/space engine/source.mp4` (review copies under `refs/continuum/qa/northstar-review/se/` + `motion-se/`). Same-pose Earth day/coast plates for `reference_match` still needed under `refs/northstars/se-planet/`. | Literal (within WebGPU) | Atmosphere limb, terrain scale continuity, approach without LOD pop chaos |
| `se-star` | SpaceEngine — star close views | Spirit / Literal mix | Photosphere energy, corona restraint, exposure |
| `aaa-atmos` | Modern AAA atmospheric demos (e.g. Hillaire-class real-time skies) | Spirit | Multiple scattering sky, horizon energy |
| `esa-sky` (new) | **Motion and stills.** ESA videos in `$LEGION_REF/galaxy videos/` and the Gaia fly-through at the folder root; stills `frame-017`, `frame-018`, `frame-021`, `frame-022` | Fidelity required at each rung; see [S-1](#s-1) | Star colour varies and size follows brightness. Density changes across the frame, so the sky has structure. One object on true black, with emptiness doing the work of scale. In motion: stars near the camera pass as points, far structure holds still, and nothing pops or swims |

## Grade (new)

| ID | Reference | Contract | Proves |
|---|---|---|---|
| `grade-one` | `film-oblivion` and `film-martian` for restraint; `esa-sky` for the black | Spirit | One grade from galaxy to surface: neutral, slightly cold, low in saturation, true black. No layer brings its own colour cast |
| `colour-jobs` | `fui-three-ink`, `hw-panels`, the pillars' resource code | Literal, once the code is written down | A colour has one job on every layer. Saturated colour is kept for sides, resources and the thing that needs the player |

## Project-local baselines

| ID | Reference | Contract | Status | Proves |
|---|---|---|---|---|
| `legion-continuum-ideal` | Captures present: `refs/continuum/stills/continuum-0.8-day.png`, `continuum-0.8-night.png`, `continuum-0.3-coast.png`, `continuum-0.6-clouds.png` (window PNGs ~1.8–2.3k, not locked 1920×1080) | Literal | **Unsigned — look hold** (cloud-deck flash P-LOOK; re-capture after lightning fix) | Regression bar for planet look after perf work |
| `legion-fly-approach` | Captures present: `refs/continuum/motion/{approach-surface,orbit-0.8au,look-orient}.mp4` + extracted `f_*.png` folders; QA under `refs/continuum/qa/` | Literal | **Unsigned — motion hold** (cloud flash visible frame-by-frame; re-record after fix) | Motion/LOD acceptance |
| `legion-glyph-sheet` (new) | Not yet made: one sheet of every glyph, at every zoom it is used | Literal, once made | **Missing** | The tactical layer's own regression bar |
| `legion-probe` (new) | Not yet made: the player's vessel, lit, at three distances | Literal, once made | **Missing** | The unit language, and a scale reference in every scene |
| `vork-ref` (new) | Offline ray-traced plates built from `reference/vork/`, output in `refs/vork/`. See [`docs/vork-reference-renderer.md`](docs/vork-reference-renderer.md) | Physics check only, until Sean rates a plate | **One plate rendered, unrated** (`ringed-giant`, 1280×720, 2026-11-10) | Where shadows fall, how light bends round a black hole, how a lens stages scale. Proves light transport, not art direction |

Capture store: `refs/continuum/` (`stills/`, `motion/`, `perf/`, `qa/`).
Spirit / technique companions (not a Literal `se-planet` substitute): Star Citizen stills + motion under `refs/continuum/{stills,motion}/NORTHSTAR/star citizen/`; Planet Tech V5 audio transcript at `refs/continuum/qa/northstar-review/sc-planet-tech-v5-transcript.md`.

Do **not** mark signed until:
(1) cloud lightning is storm-gated and re-captured motion shows no whole-deck flash,
(2) stills are native 1920×1080 (or documented backing-store size) with scorecard ≥2 on all P-LOOK axes,
(3) budget: `lab-continuum-0.8au` worst ≤16.67 ms **and** `lab-continuum-0.3au` addressed or explicitly waived,
(4) for `se-planet` `reference_match`: same-pose SE Earth day / coast / terminator plates exist and Continuum stills clear cloud-seam + hard-white-limb + night≠day gates.
See [`docs/render-acceptance-harness.md`](docs/render-acceptance-harness.md#continuum-look-verification-pack) and [`docs/superpowers/specs/2026-08-06-continuum-fidelity-qa-notes.md`](docs/superpowers/specs/2026-08-06-continuum-fidelity-qa-notes.md).

## Match protocol

- **Stills:** native res → 1:1 grid tiles → compare to northstar crops (`#10`)
- **Video:** extract triage + stress-dense frames → frame-by-frame vs northstar clip timestamps
- Low-res / fit-to-window previews are locators only — never a pass
- **Graphic layers (new):** judge with developer overlays off, at the zoom the layer is used at.
  Check the "Proves" column item by item. Where `vqa` checks apply (`field`, `balance`,
  `census`), they point and do not decide

## Rulings

Ruled by Sean on 2026-11-10.

- <a id="n-1"></a>**N-1 The planet bar: stays.** Planetary fidelity matters most in orbit and
  going down to the surface. `se-planet` stays Literal. The system, local region, spiral arm and
  galaxy must each meet the fidelity required at their own level. My recommendation to relax the
  planet bar is withdrawn.
- <a id="n-2"></a>**N-2 The order: exploration first.** The first thing a player does is explore.
  The work began in a visited system, which brings the tactical layers in, so that planets and
  their system could reach the bar before the rest of the game branched out from it.
- <a id="n-3"></a>**N-3 References: by context and intent, then rated.** One image can serve
  several contexts, and photography, background and foreground are judged separately even in a
  single image. Counting images by kind is the wrong measure.
- <a id="n-4"></a>**N-4 Copies: allowed.** References may be kept with the repo. They are guidance,
  not material used in the game. Done 2026-11-10: each cited still is copied to
  `refs/northstars/<row id>/`. That folder is git-ignored, so the copies are not published. The
  motion sources (562 Homeworld frames, the ESA videos) are not copied; their rows point at
  `$LEGION_REF`.
- <a id="n-5"></a>**N-5 Rows without a frame: read them as motion.** They are steps of a
  reference video. The lesson is in how motion is handled, how things are represented, and how
  other objects in the scene are treated with the interface.

## Still open

- <a id="s-1"></a>**S-1 What "fidelity required at this level" means for each rung above orbit.**
  The rows name what must be proved. Whether each is Spirit or Literal, and against which exact
  frames, is not yet written. It needs a reference pass per rung, as the planet had.
- <a id="s-2"></a>**S-2 Ratings.** The `rating` field on each reference is empty. Until Sean
  fills it, no image leads its context.
- <a id="s-3"></a>**S-3 Cutting the motion steps.** The Homeworld and ESA sequences are named,
  but the frame ranges for each step are not cut. That is a review job in its own right.
- <a id="s-4"></a>**S-4 The contexts were assigned by family.** An image-by-image pass would be
  more exact, above all for photography.
