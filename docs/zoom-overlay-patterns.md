# Zoom Overlay Patterns — 2D object elements across Legion's 9 zoom tiers

**Status:** Design doc (pre-implementation) · **Date:** 2026-06-13
**Scope:** Icons, labels, markers, hover/selection affordances, and mesh↔icon handoff across the
zoom range — `src/render/icons.ts`, `src/render/icon-system.ts`, `src/render/visibility.ts`,
`src/ui/raycast.ts`, `src/ui/tooltip.ts`, plus the regional/galactic marker paths in
`src/render/objects.ts` and `src/render/galaxy.ts`.
**Out of scope:** Planet surface shading / volumetrics (separate doc), selection panels content.

Sources are tagged **[dev]** (developer-confirmed: released source, dev blogs, official guides,
patch notes) or **[community]** (modder/wiki/player documentation or observed shipped behavior).
Where a verifier corrected research claims, the corrected version appears here.

---

## 1. Pattern catalog from shipped games

### 1.1 Homeworld (1999) — the sensors manager: a discrete 2D mode, not "more zoom" **[dev]**

The released source (`src/Game/sensors.h` / `sensors.c`) exposes the whole design as tunables:

- **Blob clustering.** Ships aggregate into "blobs" — `SM_BlobClosenessFactor 2.0`,
  refreshed at `SM_BlobUpdateRate` 4 Hz, `SM_BlobCircleSize 2500.0`, fog-of-war blob persistence
  0.75 s. Clustering is cheap because it runs at a fixed low rate, decoupled from the frame loop.
- **A separate camera envelope.** `SM_ZoomMin 50000 / SM_ZoomMax 250000`,
  `SM_CameraMinDistance 65000 / Max 150000` — the mode has its own zoom range distinct from
  gameplay camera limits.
- **A 2D projected layer.** Structs `smblurry` (x, y, color blips) and `smticktext` (x, y, label)
  show blips and labels are screen-projected 2D, not 3D LOD swaps.
- **Mode-transition fade.** `SM_SkipFadeoutTime` ≈ 0.5 s fade entering/leaving the mode;
  selection feedback flashes at `SM_SelectedFlashSpeed 0.8`.
- **Color = standing.** Blob colors keyed to diplomatic standing (neutral 32,5,182; ally 5,182,32;
  hostile 182,5,32). In the tactical (in-gameplay) overlay, color encodes *stance*
  (passive yellow / defensive blue / aggressive red) plus command-status marks; green class
  glyphs exist specifically to locate ship classes inside the sensors manager.

The sensors manager was added in the final 8 months of development after playtests showed
continuous zoom alone wasn't enough — a whole-map *mode* was judged necessary on top of it. **[dev]**

In Remastered, tactical icons are tiny meshes (`.hod` under `ui/tacticalicons/meshes`) paired with
`.ti` definition files; icon-appear distance is a tunable modders actively hunt for. **[community]**

Sources: <https://github.com/aheadley/homeworld/blob/master/src/Game/sensors.h>,
<https://github.com/aheadley/homeworld/blob/master/src/Game/sensors.c>,
<https://hwmod.fandom.com/wiki/HWR_Tutorials>, <https://en.wikipedia.org/wiki/Homeworld>

**When it works:** when outer tiers are semantically different *tasks* (strategic survey vs.
tactical control). The discrete mode with its own fade, clustering, and camera envelope beats
stretching one continuous system across both.

### 1.2 Homeworld — NLIPS: inflate meshes instead of icon-ifying early **[dev feature, community quotes]**

Non-Linear Inverse Perspective Scaling renders ships *larger than true perspective* as camera
distance grows, per ship class (small ships inflate more), continuously (no pop), and
player-toggleable in HW1/2/Remastered/HW3. With it off, "strike craft appear as indistinguishable
specks next to your colossal mothership." HW3's War Games demo shipped with NLIPS bugged ("ship
sizes all out of whack") and it was patch-fixed — evidence of how load-bearing it is. HW3 also
added a toggle to **disable icon amalgamation** in the Tactical Overlay, and players asked for a
zoom-distance setting controlling when tactical icons appear — amalgamation and icon-appear-zoom
are the two perennially contested knobs.

Sources: <https://www.moddb.com/games/homeworld/downloads/disable-nlips>,
<https://www.homeworlduniverse.com/war-games-feedback/>,
<https://forums.gearboxsoftware.com/t/will-nlips-still-be-a-configurable-setting/84233>

**When it works:** when you want players to keep seeing *art* (Legion's case: planet shaders)
rather than living in icon-land. Inflation postpones the icon handoff; it must stay cosmetic-only.

### 1.3 EVE Online — brackets vs. overview, capped hover lists, fleet-scale discipline **[dev]**

- **Two systems, two filter sets.** Brackets (in-space icon markers) and the Overview (filterable
  list window) are deliberately separate: "Filters control what shows up in your Overview window.
  Bracket Filters control what shows up on your actual in-game screen," per overview tab;
  Alt+Z toggles all brackets. **[dev/community wiki]**
- **Overlap → a capped list, not spatial spreading.** The Crius (2014) bracket rework resolves
  overlapping brackets with a mouse-over list **hard-capped at 15 entries** ("the balance of
  feedback was against scrolling"; raising the cap "carries… performance" cost), in compact or
  bounded modes, configured independently for in-position brackets vs. brackets **gathered at
  screen edges** when their objects are off-view. **[dev blog]**
- **Fleet-scale guidance is brutal:** in very large fights, players turn brackets off entirely —
  hundreds of brackets are a real client cost. **[community]**

Sources: <https://wiki.eveuniversity.org/Overview>,
<https://www.eveonline.com/news/view/in-space-brackets-revisited-with-crius>

### 1.4 EVE Online 2015 "Iconocalypse" — shape-first taxonomy and its documented failures **[dev]**

CCP's icon strategy blog: shapes, not color, are the primary identifier ("should cater
specifically well to those with color blindness"); icons must be "recognizable on their own."
The grammar: **triangle = ship** (can move, manmade), **rectangle = structure** (immobile,
manmade), **circle = celestial** (natural). Sub-class via silhouette bulkiness; role via a small
attribute glyph in the upper-right corner; **player ships hollow wireframe vs. NPCs filled** —
explicitly to reduce pixel density in fleet fights.

The post-release feedback blog documents what broke: **thin wireframe strokes became illegible at
90% UI scale (sub-pixel stroke rendering)**; the subtle NPC interior fill was too weak to parse
mid-combat; drone icons were over-complex. Fixes: thicker distinctions, simplified glyphs, an
icon column added to the overview.

Sources: <https://www.eveonline.com/news/view/ui-modernization-icon-strategy>,
<https://www.eveonline.com/news/view/bracket-icon-feedback>

### 1.5 Supreme Commander / FAF — per-blueprint thresholds, mandatory 4-state icons, overlay-not-swap **[community/modder, source-level]**

- **Per-class threshold as data.** The blueprint property `Display.Mesh.IconFadeInZoom` is the
  per-unit *zoom value* at which the strategic icon fades in (the Advanced LOD mod sets all units
  to e.g. 160 via one Blueprints.lua line). The transition is a **fade-in of the icon over the
  still-rendering (soon sub-pixel) mesh** — never a mesh swap.
- **Hover/selection are part of the icon contract.** The engine requires **all four** state
  textures per icon — `_rest`, `_over`, `_selected`, `_selectedover` — "or it will not display an
  icon." Affordances are first-class, not decoration.
- **Pixel-locked icons.** BC3/DXT5, not intended to scale — mods ship separate 1080/1440/4K sets.
- **FAF glyph grammar:** silhouette = domain; overlaid mark = weapon/role (crosshair = direct
  fire, hollow diamond = land factory…); small bars/size = tech level; coverage lines around
  structure icons (topline = AA, underline = naval).

Sources: <https://supcom.fandom.com/wiki/Strategic_icon>,
<https://github.com/Garanas/strategic-icon-mod-examples>,
<https://wiki.faforever.com/en/Play/Advanced_Strategic_Icons>

### 1.6 Beyond All Reason — the modern monochrome glyph vocabulary, 400+ units **[dev guide]**

Three-slot composition, published as an official guide: **base silhouette = locomotion/domain**
(circle = bot, diamond = vehicle, triangle = aircraft, inverted triangle = VTOL, elongated hex =
amphibious, trapezoid = hovercraft, rounded square = ship, square = structure, shield = defensive
structure); **overlaid role marker** per weapon/function (mortar, AA, radar, jammer, builder,
minelayer…; right-arrow = fast/scout); **tech tier as dots at the bottom edge** (none = T1,
two = T2, three = experimental). Built explicitly so ~400 units stay distinguishable at a glance
in monochrome team color.

Source: <https://www.beyondallreason.info/guide/strategic-icons>

### 1.7 Sins of a Solar Empire — three-stage handoff and the "mush of icons" failure mode **[community/observed]**

Continuous mousewheel zoom with three representation stages: **3D model → per-unit icon → fleet
icon** (aggregation at the farthest band); planets/stars become 2D icons with side/bottom bar
gauges encoding own/enemy/friendly counts at that gravity well (community: bars are "very faint
and hard to read at a glance"). Zoom is object-targeted (camera centers on what the cursor
indicates). The documented failure: because the game is fully playable zoomed out, players *live*
there, and everything becomes "just a big mush of icons… icons, alas, do not tend to have a whole
lot of character." Sins II threads ask for per-class icon/model switch distance and NLIPS-style
capital-ship scaling — the same two contested knobs as Homeworld.

Sources: <https://scientificgamer.com/thoughts-sins-of-a-solar-empire-rebellion/>,
<https://www.sinsofasolarempire2.com/article/515246/strategic-zoom-please>

**Two warnings for Legion's NASA-photographic ambition:** (a) if the strategically optimal tier
is icon-only, players never see the planet shaders — at least one strategically useful tier must
keep meshes readable; (b) aggregate icons must aggregate *data* (counts, ownership), not just
collapse glyphs.

### 1.8 Stellaris / Endless Space 2 / Distant Worlds 2 — discrete named tiers, label staging, multimodal tier feedback **[community]**

The 4X school uses discrete views: Stellaris hard-switches galaxy ↔ system view (long-standing
community requests for seamless zoom; the galaxy view *resetting zoom* after visiting a system is
a documented persistent irritant — preserve camera state across tier switches). Endless Space 2
stages **label density by zoom**: system labels at mid zoom, constellation names when zoomed out —
labels *promote up the hierarchy* rather than thinning randomly. Distant Worlds 2 exposes its four
tiers as **named minimap buttons** (Galactic / sector / solar system / planet), ships per-category
icon toggles, and **changes ambient audio per zoom level** — multimodal confirmation of tier.

Sources: <https://forum.paradoxplaza.com/forum/threads/galaxy-map-and-system-view-zooming.962148/>,
<https://endless-space-2.fandom.com/wiki/Galaxy>,
<https://www.gamewatcher.com/reviews/distant-worlds-2-review/13325>

### 1.9 Elite Dangerous / KSP — markers and orbit lines as interactive surfaces **[community wikis, observed shipped behavior]**

- **Elite Dangerous:** target markers encode bearing by **fill state** — solid circle = target in
  front, outline = behind (same convention on the nav compass). HUD bracket style is
  mode-semantic (orange curved = Combat, straight blue = Analysis). Yellow is reserved strictly
  for current nav selection (blue = mission targets) — **one hue, one meaning**.
- **KSP map view:** three engagement levels — *glance* (always-on Ap/Pe glyph), *hover* (tag shows
  live numbers), *pin/click* (right-click pins the readout open; clicking a maneuver node expands
  handles). Planned trajectories are dashed vs. solid actual orbit, and **the orbit line itself is
  clickable** (click planned orbit → "Warp to next maneuver").

Sources: <https://elite-dangerous.fandom.com/wiki/HUD/Center>,
<https://elite-dangerous.fandom.com/wiki/System_Map>, <https://pinter.org/archives/12602>

### 1.10 Engine-level grounding — hysteresis and threshold metrics **[dev docs; verifier-corrected]**

- **Hysteresis dead band is the anti-flicker standard:** with threshold 100 and hysteresis 10, the
  switch happens at 105 going out and 95 coming back (DigitalRune docs; Unity LODGroup and Godot
  visibility ranges ship equivalents, Godot with optional dither/fade margins).
- **Verifier correction (overrides earlier research):** three.js issue #14565 is **closed** —
  `THREE.LOD` **now supports hysteresis**: `addLevel(object, distance = 0, hysteresis = 0)`,
  applied in the update loop as `levelDistance -= levelDistance * levels[i].hysteresis`. Two
  caveats: it is a **fraction of distance** (not an absolute offset like the 105/95 example) and
  it is **one-sided** (delays only the complex→simple switch). Legion's icon system doesn't use
  `THREE.LOD` at all, so we still implement our own band — but a symmetric/absolute band is a
  deliberate choice, not a workaround for a missing engine feature.
- **Threshold metric:** mature systems key transitions to **zoom / apparent screen size**
  (SupCom `IconFadeInZoom` is a zoom value; Unity LODGroup uses screen-relative height), not raw
  world distance — a gas giant and a small moon at the same camDist have wildly different
  legibility.
- **Swap-vs-fade:** every shipped reference avoids simultaneous two-way crossfade. SupCom-school
  fades the icon IN over the shrinking mesh (one-directional); Homeworld uses a short whole-mode
  fade (~0.5 s).

Sources: <https://digitalrune.github.io/DigitalRune-Documentation/html/b320aebd-46a0-45d8-8edb-0c717152a56b.htm>,
<https://github.com/mrdoob/three.js/issues/14565>,
<https://docs.unity3d.com/2021.3/Documentation/Manual/class-LODGroup.html>

---

## 2. Cross-cutting principles

1. **Sizing model: screen-constant icons, world meshes, one optional inflation band between.**
   Icons are screen-constant billboards over the world (SupCom, EVE, Sins). Meshes keep true
   perspective, optionally inflated NLIPS-style (per-class exponent, cosmetic-only, toggleable) to
   postpone the icon handoff. Never mix regimes silently — every overlay element declares which
   regime it's in.
2. **Handoff thresholds are apparent-size, per-class data.** Trigger on apparent screen size
   (`apparentPx`), not raw camDist; store per-class bias as data on the entity/archetype
   (SupCom's `IconFadeInZoom`), not as global constants.
3. **Hysteresis everywhere a discrete switch exists.** A ±10% dead band on every threshold, with
   per-entity last-state memory. (three.js LOD now has built-in one-sided fractional hysteresis,
   but our sprite system is custom — we implement a symmetric band ourselves.)
4. **One-directional fades, short mode fades.** Icon fades in over the still-shrinking mesh; tier/
   layer switches get a ~0.3–0.5 s temporal fade. No simultaneous two-way crossfades.
5. **Clustering is mandatory at scale, at a low fixed rate, with an opt-out.** Screen-space
   proximity blobs refreshed at ~4 Hz; cluster glyphs carry *data* (count, composition);
   overlap-hover yields a capped list (10–15), never cycling/topmost-wins; player toggle to
   disable amalgamation (HW3 shipped one for a reason).
6. **Labels are a separate system from icons, and they promote up the hierarchy.** Independent
   fade/scale from the icon; per-tier label level (body → system → arm), a screen label budget,
   hover/selection always overrides the budget.
7. **Hover/selection states are part of the icon contract.** Four states minimum
   (rest/over/selected/selected-over), baked ahead of time (atlas), swapped cheaply (UV offset),
   plus a *persistent* selection affordance distinct from hover.
8. **Shape first, fill second, color last.** Silhouette = ontological family; interior detail =
   sub-type; fill-vs-stroke = a binary semantic (ownership, or visible-vs-occluded per ED);
   color reserved for few, fixed meanings (standing/stance; ONE accent hue exclusively for
   current selection/destination).
9. **Readability discipline: no stroke below ~1.5 device px after DPR.** EVE's 90%-UI-scale
   lesson. Author stroke widths in *display* pixels, derive bake-resolution widths from the
   intended on-screen size — not from the logical canvas size.
10. **Discrete tiers deserve discrete confirmation, and camera state persists across them.**
    Named/perceptible tier shifts (DW2 audio; Legion could echo with a per-tier exposure-target
    nudge via the existing auto-exposure), and never reset zoom when returning to a tier
    (Stellaris's documented irritant).

---

## 3. Gap analysis — Legion today vs. the reference patterns

| # | Area | Legion today | Reference pattern | Gap severity |
|---|------|--------------|-------------------|--------------|
| G1 | **Label legibility** | Label baked INTO the icon texture (bold 12 logical px of a 160-logical-px canvas → ≈2 screen px at the 28 px sprite). Illegible at distance; no independent label fade; `createLabel` (icons.ts:344) exists but unused. | Labels are a separate staged system (ES2 promotion, EVE overview column). | **Critical** — labels currently don't function as labels. |
| G2 | **Stroke sub-pixel trap** | `outlineWidth 2` logical px × 4 SS = 8 texture px on a 640 px canvas, displayed at 28 px → ≈0.35 *screen* px, surviving only as mipmap blur. | EVE: thin strokes became illegible at 90% scale; fix was thicker distinctions. ≥1.5 device px floor. | **High** — explains the "soft glyph" look. |
| G3 | **Threshold metric** | Raw camDist bands in `visibility.ts`: outer-system fade `(camDist−120)/880 × 0.5`, heliopause `(camDist−1000)/5000`. Same bands for a gas giant and a dwarf. | Apparent-screen-size thresholds, per-class data (SupCom, Unity LODGroup). | **High** |
| G4 | **Hysteresis** | None — tier and per-object states flip exactly at thresholds; flicker risk when hovering at a boundary. | ±dead band standard everywhere; THREE.LOD has it (one-sided/fractional) but Legion's sprite path is custom. | **High** |
| G5 | **Tier-switch pop** | `visibility.ts` layer toggles are instant; galaxy disc is the only smoothly ramped element (`updateGalaxyLOD`). | Homeworld 0.5 s mode fade; Godot fade margins. | Medium |
| G6 | **Icon state vocabulary** | One config = one baked texture; no rest/over/selected variants. Hover = one shared 4-corner reticule sprite; **no persistent selection ring** (reticule is hover-only). | SupCom mandates 4 states or no icon; ED reserves a hue for selection. | **High** |
| G7 | **Clustering** | None. Co-orbiting moons/stations overdraw into an unreadable stack; raycast resolves topmost only. | HW blobs @4 Hz; EVE capped hover list (15); HW3 amalgamation + opt-out. | **High** (grows with entity count) |
| G8 | **Three sizing regimes, unreconciled** | Local icons screen-constant via `FOV_FACTOR` (recomputed per frame — FOV is dynamic); regional `createSystemMarker` sprites world-scaled (`marker.scale.setScalar(450)` in main.ts:550, no `isIcon` flag, never per-object hidden); galaxy labels fixed world-scale (500×125) with LOD opacity ramps. Markers grow/shrink across heliopause→arm. | One declared regime per element; screen-constant for symbolic markers. | **High** |
| G9 | **Shape grammar** | Shapes exist (diamond/circle/triangle/square/hex/star) with hex-only anatomy (glyphs, capacity arc, pips — Oblivion-Tet/HW2 vocabulary), but no formalized family grammar; planets get no archetype detail. | EVE family silhouettes; BAR three-slot composition (silhouette + role mark + tier pips). | Medium (grows with entity count) |
| G10 | **Texture-cache churn for dynamic state** | Cache keyed by full config string — every capacity/pip change bakes a new texture; hostile to continuously animated data. | SupCom pre-baked state atlas, UV swap. | Medium |
| G11 | **Two opacity writers** | `icon-system.fadeMeshes` and `objects.ts applyPlanetOpacity` both write the same planet materials per frame; coexists only because domains mostly partition. New overlay/mesh layers (cloud shells) must register with BOTH or pop. | Single fade owner / explicit composition. | Medium (latent bug) |
| G12 | **Occlusion semantics** | Icons `depthTest:true` (vanish behind geometry, binary); reticule `depthTest:false` renderOrder 10000. No encoding of "present but occluded". | ED fill-state: solid = in front, outline = behind. | Low/Medium |
| G13 | **Hover overlap** | `raycast.ts` resolves first hit up the parent chain; overlapping icons → topmost wins; tooltip shows one entity. | EVE Crius capped list. | Medium (rises with G7) |
| G14 | **Label/icon filtering per tier** | Per-tier *layer* toggles exist (GROUP level), but no per-tier icon-category filters (e.g. moon icons at inner-system tier). | EVE bracket filters per tab; DW2 per-category toggles. | Medium |
| G15 | **Orbit lines** | Not interactive; no hover/pin affordance. (Planned restyle: solid low-opacity white + hover brighten.) | KSP three engagement levels; orbit line as click surface. | Medium |
| G16 | **Strategic tier kills the art** | Outer-system half-fades meshes from camDist 120; if players live zoomed out, they never see the planet shaders (Sins failure mode). | NLIPS inflation band keeps meshes readable in at least one strategic tier. | Medium (experience goal) |

**What Legion already has right** (keep, don't rebuild): screen-constant sizing via per-frame
`setIconFov` (the dynamic-FOV plumbing is exactly what SupCom-school sizing needs); 9 discrete
zoom domains (the 4X-school structure); one-directional-ish fade states (`meshFading` fades mesh
while icon holds); canvas-baked SRGB sprites with mipmaps + anisotropy; `userData.type/eid`
selection plumbing with proxy hit-meshes; the class-keyed shift+dblclick zoom warp table; galaxy
disc LOD ramp as the model for smooth tier transitions.

---

## 4. Recommended target design

### 4.1 The unified sizing + handoff model

**Apparent size is the master signal.** Per body, per frame (or at 10 Hz — it changes slowly):

```
apparentPx = (bodyRadiusWU / camDist) / tan(fovRad / 2) * (viewportHeightPx / 2)
```

This reuses the same `FOV_FACTOR` feed (`setIconFov`) the icon scaler already consumes — one FOV
source of truth (constraint: any new overlay must consume the same factor or sizes drift).

**Handoff bands (defaults; per-archetype multiplier `iconBias` stored as data, VP-tunable):**

| State | Condition (with hysteresis) | Mesh | Icon | Notes |
|---|---|---|---|---|
| MESH | `apparentPx > 64` | full | hidden | Icon on a fullscreen planet is noise. Label on hover/selection only. |
| MESH+ICON | `15 < apparentPx ≤ 64` | full | 0.6 @ 20 px | Today's `meshFull_iconOn`. |
| ICON_FADE_IN | `8 < apparentPx ≤ 15` | full (NOT faded) | fades 0 → 0.95 @ 28 px across the band | One-directional: icon over still-shrinking mesh, SupCom-style. Replaces the camDist half-fade. |
| ICON | `apparentPx ≤ 8` | sub-pixel; stop fading it, let it shrink out | 0.95 @ 28 px | Mesh material opacity untouched → fewer collisions with `applyPlanetOpacity` (G11). |

- **Hysteresis:** symmetric ±10% on each boundary (e.g. enter ICON at 8, exit at 8.8), per-entity
  `lastIconState` flag. Spatial (driven by apparentPx), so scrubbing the zoom is deterministic;
  no time-based debounce needed for these bands.
- **Per-archetype bias** (`iconBias` multiplies the thresholds): stations/ships 1.3 (noisy small
  meshes → icon sooner), Dwarf 1.15, Rocky/Oceanic/Desert 1.0, IceGiant 0.9, GasGiant 0.8 (big
  readable art → hold the mesh longer). Note apparent-size already handles most of the
  size-difference problem; the bias is flavor tuning, kept as data (SupCom lesson). Use the
  **corrected PlanetType enum** (components.ts:133: Rocky=0, Oceanic=1, Desert=2, GasGiant=3,
  IceGiant=4, Dwarf=5) — do not copy the stale mapping from objects.ts/planet-colors.ts.
- **Optional NLIPS band (G16):** across inner/outer-system, apparent size of the *mesh* may be
  inflated `scale *= pow(refPx / apparentPx, k)` clamped to ≤1.6×, `k` per archetype (Dwarf
  highest, GasGiant ≈0), cosmetic-only (no physics/raycast change — raycast proxies keep true
  scale), VP-toggleable. Ship behind a flag; evaluate against the photographic-realism pillar
  before defaulting on.

**Tier-switch fades (G5):** every `visibility.ts` GROUP-level toggle becomes a 0.4 s opacity ramp
(reuse the `updateGalaxyLOD` pattern). The heliopause→sector transition (mesh world → icon world)
is Legion's "sensors manager threshold" and gets the full 0.4 s mode fade.

**Sizing regime reconciliation (G8):** three declared regimes, explicitly:
- **Local icons** — screen-constant (existing pipeline). Unchanged.
- **Regional system markers** — migrate to the same screen-constant pipeline (flag `isIcon`, size
  via `scaleFixed`, target 24 px, tier-gated heliopause→arm). Kills the grow/shrink artifact.
- **Galactic labels/halos** — keep world-scale (they are *landscape annotation*, not symbolic
  markers — arm names sit IN the galaxy like map typography), but document that choice in
  galaxy.ts and keep their LOD ramps.

### 4.2 Labels — a separate, staged system (G1)

- **Stop baking labels into icon textures.** Use the existing (currently unused) `createLabel`
  path: standalone text sprite, child of the same entity group, `userData.isLabel = true`
  (`fadeMeshes` already skips it), `depthTest:false`, renderOrder above icons, screen-constant
  via the same `scaleFixed`, target **12 screen px** cap (11 px floor).
- **Independent fade:** label opacity = f(icon state, tier, budget) — NOT the icon's opacity.
  Default: visible when in MESH+ICON or ICON state *and* within budget; always on hover/selected.
- **Label budget:** max ~10 simultaneous labels at any tier, priority = selected > hovered >
  player assets > nearest/largest. Beyond budget, labels hide; icons remain.
- **Promotion per tier (ES2):** surface→orbit shows body labels; inner/outer-system shows planet
  labels (moon labels only when parent selected — G14); heliopause→sector shows *system* labels
  (the migrated system markers own them); arm/galaxy shows arm/region labels (galaxy.ts, as-is).
- Sublabels (designation/status) render only at hover/selected, or when apparentPx of the icon
  cluster ≥ 24 px.

### 4.3 Icon anatomy, atlas, and states (G2, G6, G9, G10)

- **Stroke discipline:** author `outlineWidth` in *display* px. For a 28 px display target,
  bake stroke = `displayPx_stroke × (canvasLogical / displayPx)` → 1.75 display px ⇒ 10 logical px
  (×4 SS = 40 texture px on the 640 canvas). Same rule for internal glyphs, capacity arc, pips —
  nothing below 1.5 display px at the 28 px size.
- **Four-state atlas (SupCom contract):** bake rest / over / selected / selected-over as four
  columns of ONE texture; state change = UV offset on the SpriteMaterial, zero rebakes. Over =
  +brightness & stroke; selected = accent-color stroke + corner ticks; selected-over = both.
  Hover keeps the existing reticule short-term; once atlas states ship, the reticule becomes the
  *focus/destination* affordance only.
- **Persistent selection:** selected entity keeps its `selected` atlas state until deselect, plus
  a `depthTest:false` accent ring duplicate so selection survives occlusion. **Accent hue is
  reserved for selection/destination only** (ED yellow rule); standing/stance colors stay in the
  body-color slot.
- **Occlusion fill-state (G12, later phase):** icons stay `depthTest:true`; the selected/tracked
  entity additionally renders an *outline-variant* sprite at `depthTest:false` — net effect:
  solid = visible, outline = occluded behind a body. No depth readback needed.
- **Glyph grammar (three-slot, BAR-style), formalized for growth:**
  - *Base silhouette = family:* circle = natural body (planet/moon/comet), hex = built static
    (station/factory/mine/comms — existing anatomy keeps its slot), triangle = mobile (ships,
    Bobs), star = stellar, diamond = phenomenon/anomaly.
  - *Interior detail = archetype:* planets get PlanetType marks at uniform stroke weight —
    2 horizontal bands = GasGiant, single band = IceGiant, 3 crater dots = Rocky, wave = Oceanic,
    hatch = Desert, small circle = Dwarf; ring arc outside the silhouette for ringed bodies.
  - *Edge slot = state:* pips/corner glyph for colonized / hazard / under-attack
    (existing pip mechanics generalize).
  - *Fill-vs-stroke = ownership:* player assets stroke-only (current look), non-player filled —
    EVE's pixel-density logic inverted to favor the player's fleet view.
- **Cache policy (G10):** atlas folds 4 states into one bake; labels leave the key entirely
  (G1 removes `label|sublabel` from the cache key); quantize capacity to 24 steps so the arc
  can't explode the cache; continuously animated data is forbidden in baked textures — if a value
  animates per-frame, it belongs in a shader uniform or a DOM/label layer, not a canvas rebake.

### 4.4 Clustering and overlap (G7, G13)

- **Screen-space blobs at 4 Hz (Homeworld):** every 250 ms, project icon-state entities; greedy
  cluster when center distance < 1.5 × icon width (≈42 px at 28 px icons). Cluster sprite = family
  silhouette of the dominant member + **count** in the (now external) label slot + composition
  pips. Hysteresis on cluster membership: split only when separation > 1.8 × icon width.
- **Hover on overlap/cluster → capped list (EVE Crius):** when raycast hits a cluster or >1 icon
  within 8 px of the cursor, `tooltip.ts` renders a list capped at **12 rows** (name + type glyph
  + key stat), click row = select. No scrolling; ">N more" tail row if over cap.
- **Player toggle** (HW3 lesson): `VP.iconClustering: boolean` — amalgamation off shows every
  icon. Add to VisualParams + DEFAULTS + the VP.subscribe sync block.
- **Edge-gather (later):** selected/tracked entities outside the frustum get a screen-edge chip
  (EVE bounded mode) — reuse the cluster-chip rendering.

### 4.5 Hover/selection affordances incl. orbit lines (G15)

KSP's three engagement levels, applied to Legion:

| Level | Icons | Orbit lines |
|---|---|---|
| **Glance** | atlas `rest` state, label per budget | solid white @ 0.12 opacity (existing restyle plan) |
| **Hover** | atlas `over` state + reticule + DOM tooltip (existing `#hover-tip`) | line brightens to 0.5, +1 px width feel (shader-side), transient tag near cursor: body name + Pe/Ap-style stats |
| **Pin/Select** | atlas `selected` + persistent accent ring; survives occlusion as outline | line holds 0.35 accent-tinted; clicking the line selects the body; (later) pinned readout chip |

Orbit-line hover = raycast against fattened `Line2`/ribbon geometry or screen-space
nearest-curve test at ≤6 px — whichever lands cheaper; it must respect the existing
`userData.type` plumbing so tooltip/selection code paths are unchanged.

### 4.6 Per-tier behavior table (target)

| Tier | Meshes | Icons (local) | Labels | Markers/cluster | Notes |
|---|---|---|---|---|---|
| surface | full | hidden for focused body (>64 px rule); others per band | hover/selected only | — | icon on a fullscreen planet is noise |
| low-orbit | full | per apparent-size band | focused body + hover | — | |
| orbit | full | MESH+ICON for most bodies (0.6 @ 20 px) | planet labels ≤ budget | — | |
| inner-system | full (+ optional NLIPS) | MESH+ICON | planet labels; moons only if parent selected | clustering active (moons+stations) | the "strategic but photographic" tier — meshes must stay readable (Sins lesson) |
| outer-system | full, NOT half-faded; icons fade IN per apparentPx 15→8 | ICON_FADE_IN → ICON | planet labels ≤ budget | clustering active | replaces `(camDist−120)/880×0.5` |
| heliopause | shrink out naturally (no forced fade) | ICON | label promotion begins: system label appears | system markers (screen-constant 24 px) fade in, 0.4 s | replaces `(camDist−1000)/5000`; "sensors manager" boundary |
| sector | hidden | iconOnly (existing) | system labels only | markers + clusters; sector orb | 0.4 s mode fade on entry/exit |
| arm | hidden | hidden (layer off) | arm/region labels (galaxy.ts world-scale, kept) | marker clusters at low density | camera phi 1.3 (existing) |
| galaxy | hidden | hidden | arm labels only | — | Sgr A* focus (existing); optional per-tier exposure nudge as tier confirmation |

**Cross-tier invariants:** camera state persists per tier (no Stellaris reset); every threshold
in this table carries the ±10% band; both fade paths (`fadeMeshes`, `applyPlanetOpacity`) treat
any newly added mesh layers (cloud shells etc.) via a shared registration helper (G11).

---

## 5. Implementation phases (small PRs, per the working agreement)

Each phase is one PR, runs `npm run typecheck` (or the repo's equivalent) + tests before claiming
done, adds new knobs to `VisualParams` + `DEFAULTS` + the `VP.subscribe` sync block, and touches
nothing outside its scope.

### Phase 1 — Label decoupling + stroke legibility (icons.ts, icon-system.ts)
The highest-value, lowest-risk slice; fixes G1 + G2 and shrinks G10.
- Remove `label`/`sublabel` from the baked icon texture and from the cache key; spawn standalone
  label sprites via the existing `createLabel` (icons.ts:344), `userData.isLabel = true`
  (already skipped by `fadeMeshes`), `depthTest:false`, screen-constant via `scaleFixed` at
  12 px cap.
- Label opacity decoupled from icon opacity: visible in MESH+ICON/ICON states, always on
  hover/selected; simple count budget (10) by camDist priority for now.
- Re-derive stroke widths in display-px terms: outline ≥1.5 display px at the 28 px target
  (≈10 logical px pre-supersample); same floor for hex glyphs/arc/pips.
- **Acceptance:** at sector tier (icon-only), labels render ≥11 screen px and are legible; icon
  outlines no longer mip away to gray; texture cache entry count drops (no label permutations);
  hover/selection raycast unaffected (labels carry no `userData.type`, proxies untouched);
  crossfade states visually unchanged otherwise; typecheck + tests green.

### Phase 2 — Apparent-size thresholds + hysteresis (visibility.ts, icon-system.ts)
- Implement `apparentPx` (shared FOV_FACTOR), the 64/15/8 bands, symmetric ±10% hysteresis with
  per-entity `lastIconState`, and per-archetype `iconBias` data using the **corrected**
  PlanetType enum.
- Replace the camDist half-fade/full-fade formulas; mesh material opacity is no longer written by
  the icon path in ICON state (G11 reduction).
- **Acceptance:** parking the camera at any boundary produces zero flicker over 10 s; a Dwarf
  icon-ifies visibly sooner than a GasGiant at equal camDist; no double-fade artifacts with
  `applyPlanetOpacity`; VP exposes band edges + bias.

### Phase 3 — Four-state icon atlas + persistent selection (icons.ts, raycast.ts, icon-system.ts)
- Bake rest/over/selected/selected-over as one 4-column atlas; state = UV offset; persistent
  accent selection (atlas state + `depthTest:false` outline duplicate for occlusion fill-state).
- **Acceptance:** hover/selection changes cause zero texture bakes at runtime; selection survives
  deselect-free zoom across tiers and reads as outline when occluded; accent hue appears nowhere
  except selection/destination.

### Phase 4 — Sizing-regime unification + tier fades (objects.ts, main.ts, visibility.ts, galaxy.ts)
- Migrate `createSystemMarker` sprites to the screen-constant pipeline (`isIcon`, 24 px,
  heliopause→arm gating); replace `marker.scale.setScalar(450)`; document galaxy labels as
  intentionally world-scale; add 0.4 s ramps to all GROUP-level layer toggles (reuse
  `updateGalaxyLOD` pattern).
- **Acceptance:** system markers hold constant screen size across heliopause→arm; no instant
  pops on any tier boundary; galaxy ramp behavior unchanged.

### Phase 5 — Clustering + capped hover list (new cluster module, tooltip.ts, raycast.ts)
- 4 Hz screen-space blobs (<1.5 icon widths merge / >1.8 split), cluster chip with count +
  composition pips, hover list capped at 12, `VP.iconClustering` opt-out toggle.
- **Acceptance:** 20 co-orbital entities render as ≤3 legible chips; hover yields the list, click
  selects a row; toggle off restores every icon; cluster pass ≤0.5 ms at 4 Hz.

### Phase 6 — Orbit-line affordances (+ optional NLIPS flag, edge-gather)
- Glance/hover/pin levels on orbit lines (brighten + transient tag + click-select); optional:
  NLIPS inflation behind a VP flag; screen-edge chips for off-frustum selected entities.
- **Acceptance:** hovering within 6 px of an orbit line brightens it and shows the tag; clicking
  it selects the body; tooltips/selection panels/zoom-warp table all still operate via the
  existing `userData` plumbing.

---

*Compiled from the current overlay pipeline audit, shipped-game research (Homeworld 1999 source,
EVE dev blogs, SupCom/FAF + BAR modding docs, Sins/Stellaris/ES2/DW2/ED/KSP community
documentation), and verifier corrections — notably that three.js LOD hysteresis now exists
upstream (one-sided, fractional) even though Legion's custom sprite path still implements its own
symmetric band.*
