# Sector-cloud galaxy — architecture + single-sector prototype spec

Status: **design of record.** Supersedes the "galaxy = one monolithic volumetric
cloud" model for *traversal*. The monolith is **not deleted** — it is demoted to
the far-field layer (see §4).

## 0. Why

Once the goal shifts from "the galaxy *looks* right" to "the player can *traverse*
the galaxy," a single analytic raymarch can't deliver it — you can't fly to a place
that doesn't exist as data. Every traversable-galaxy space sim (Elite, Space Engine,
EVE, No Man's Sky) is built on the same shape: **spatial chunking + procedural-on-
demand + impostors for the far field.** This is that, fitted to Legion.

The key reframe (from the 6-lens architecture review): the proposal conflates two
*separable* problems — the galaxy's **look** and the galaxy's **traversal data**.
They do not need the same architecture.

- **Look:** keep the analytic field continuous at all distances (no boxiness).
- **Data:** stream per-sector navigable content; the cube grid is an *invisible
  spatial index* for load/unload + selection, **not** the rendered galaxy.

## 1. Visual target + references

Each sector is a **cloud volume with embedded star particles** — the same
volumetric-raymarch technique gives the look both *inside* a sector (fly-through
dust/nebula) and, summed with the far field, at the galaxy scale.

References (techniques, adapted — not dropped in):
- Maxime Heckel, *Real-time cloudscapes with volumetric raymarching* — the canonical
  loop: constant-step march, FBM/Perlin-Worley density, light-march toward a light
  for self-shadow, Beer-Lambert extinction, Henyey-Greenstein phase, blue-noise
  jitter, half-res + bicubic upscale.
- `CK42BB/procedural-clouds-threejs` — its **three rendering paths map directly to
  our three LOD tiers** (volumetric / mesh-cluster / billboard). NOTE: its volumetric
  path is WebGPU/TSL (three r170+); **Legion is WebGL2**, so we adapt the technique
  onto the existing GLSL raymarch (`galactic-disc-volume.ts`), which is already a
  working WebGL2 volumetric march.

The galaxy is not a planetary cloud system — interstellar medium is wispier, mostly
dark dust with emissive gas (HII pink, reflection blue) and embedded stars — but the
*flythrough across sectors* should read like flying through the reference clouds.

## 2. The sector cloud volume (the hero)

Generalize `src/render/shaders/galactic-disc-volume.ts` → `sector-cloud-volume.ts`:
same ray-AABB slab clip, motion-adaptive `uSteps`, `uModelScale` bridge, but the
box is the **sector cube** and the density + lighting are upgraded from "emissive
glow" to "lit cloud."

**Density** — the composition that keeps the galaxy coherent:

```
density(p) = sampleGalaxy(p).structure   // LOW-FREQ: which arm / dust lane — SHARED field
           × cloudShape(worldFBM(p))      // HIGH-FREQ: the wisps you see up close
```

- Low-frequency structure comes from the **shared `galaxy-density.ts`** model
  (arms, flare, dust lanes, HII knots). This is the rule that prevents boxiness and
  makes summed sectors reconstruct the spiral — adjacent sectors read the *same*
  field at the seam, exactly as the existing star spawner already agrees with the
  volume "by construction".
- High-frequency detail is `worldFBM(p)` — Heckel-style 4–6-octave Perlin-Worley FBM
  evaluated at **WORLD position, not a per-sector reseed**, so wisps flow continuously
  across sector faces (no C0 seam). This is the critical adaptation vs planetary
  cloud tiling.

**Lighting** — the galaxy has no single sun, so adapt the light-march:

- Emission (gas glows): the density model's emission `j[rgb]` (HII pink / reflection
  blue / general glow). Kept.
- Self-shadow / reflection: a cheap Heckel light-march (~6 steps) toward the sector's
  **single dominant light** (brightest embedded star, or galactic-core direction for
  the prototype). Gives dust the lit 3D form — bright near a hot star, dark lanes
  elsewhere. Beer-Lambert + powder edge apply directly.
- HG phase (`g ≈ 0.6`) on the dominant-light direction → forward-scatter glow when
  looking toward a star through dust.
- Extinction: existing per-channel Beer-Lambert (dust reddening), verbatim.
- Blue-noise jitter per pixel → keep `uSteps` low without banding.

**LOD ladder** (= CK42BB's three paths):

| Tier | When | Technique |
|---|---|---|
| **NEAR** (in/adjacent sector) | you can fly through it | full raymarch + light-march + star Points |
| **MID** (a few sectors out) | parallax matters, can't enter | baked octahedral impostor (`galaxy-backdrop.ts` harness) or instanced soft-sprite cluster — NOT flat billboards (they seam) |
| **FAR** (everything else) | the whole galaxy | the existing analytic disc raymarch — one draw call |

Prototype builds **NEAR only** + proves it blends into FAR. MID is Phase B.

## 3. Embedded star particles

Reuse `galactic-stars.ts` Points shader.

- Curated systems placed first (markers + nav nodes).
- Generated stars: count = `∫ emission dV` over the cube (clamped lo/hi) — *the same
  integral that drives the far volume's brightness*, so resolved stars and cloud glow
  agree by construction. Positions by rejection-sampling the shared model; colors from
  the IMF-weighted `sampleStellarPopulation` / `STELLAR_CLASS_COLOR`. All from the
  deterministic seed (`system-gen.ts` `mulberry32`), **never `Math.random`**.
- Stars render as small additive Points inside the cloud (the cloud's premultiplied
  coverage already silhouettes Points behind dust).

## 4. Composition — one diffuse authority, no double-bright

The subtlest correctness rule:

- The **analytic disc stays the diffuse galaxy at all distances.**
- Where a sector is resident, **punch out the far volume's emission inside the
  sector's AABB** (a soft radial/AABB term in the disc shader) and crossfade the
  sector's own emission up by the complementary weight, so
  `far_outside + sector_inside == far_everywhere` at the handoff.
- The sector adds **resolved stars + high-freq detail only** — it must not re-emit
  the diffuse band the disc already drew.
- Render order far → sector (back-to-front) so dust occludes correctly.
- **Acceptance test:** render the crossfade midpoint with the sector forced-far vs
  forced-near; assert mean luminance in the sector's screen region matches within
  tolerance.

## 5. The frame (float-safe, reuses the floating origin)

- Sector authoritative center = float64 galactocentric **parsecs** (like `galPos`).
- Absolute scene-WU center = `(centerPc − galPos(home)) · WU_PER_PC` (home at origin).
- Per frame, sector `Group.position = Broker.getResidual(centerAbsWU)` (= centerAbs −
  R), riding the same per-frame floating-origin rebase as every tier → GPU only sees
  small residuals → no float32 jitter, AND seams stay consistent (adjacent sectors
  subtract the same R). Vertex data authored sector-local.
- Cloud AABB uniforms refresh per-frame from the broker (mirrors `updateGalaxyFrame`).

## 6. Perf budget + guardrails

| Lever | Budget |
|---|---|
| Live-marched cloud volumes | **exactly 1** (the camera's sector). Never scales with sector count. |
| Cloud march steps | motion-adaptive 12→24; light-march ≤6 |
| Render resolution | consider half-res cloud pass + bicubic upscale (biggest single lever) |
| Star Points | one merged buffer, ≤ a few thousand/sector |
| Generation | one-shot at prototype init (worker + pooling is Phase B) |

The guardrail that matters: **fly-through cost is measured on ONE sector first.** If
one nebula can't hold 60 fps, the grid is dead on arrival — learned in a day.

## 7. Build increments (each independently verifiable)

- [ ] **Inc 1 — `Sector` skeleton.** Group factory + sector 0 at home, curated systems
  only, behind a flag. Zero default visual change. Proves the component API + the
  broker framing (float-safe placement that tracks the camera).
- [ ] **Inc 2 — embedded stars.** Density-sampled generated Points, deterministic
  seed. Proves count/color agree with the model.
- [ ] **Inc 3 — cloud volume v1.** Generalize the disc raymarch to the sector box;
  density = shared-field × worldFBM; emission only. Proves the cloud renders band-not-fog.
- [ ] **Inc 4 — cloud lighting.** Light-march self-shadow + HG phase + blue-noise +
  half-res. Proves the fly-through cloud *look*.
- [ ] **Inc 5 — composition.** AABB punch-out + crossfade over the far disc + the
  luminance-parity test. Proves seam-free (acceptance #1).
- [ ] **Inc 6 — fly-through + nav.** Node-to-node flight inside the sector + a fast
  nebula pass with the FPS probe. Acceptance #2 + #3.

## 8. File plan

```
src/render/sector/sector.ts                 — Sector component (Group factory + AABB + per-frame re-root)
src/render/sector/sector-density.ts         — shared-field × worldFBM
src/render/sector/sector-stars.ts           — density-sampled Points (reuses galactic-stars)
src/render/shaders/sector-cloud-volume.ts   — the raymarch (from galactic-disc-volume + Heckel lighting)
src/render/sector/sector-prototype.ts       — flagged harness: spawn sector 0 at home
```

Plus a `galaxy-density.test.ts`-style test asserting sector luminance ≈ the analytic
line-integral over the sector AABB.

## 9. Acceptance proofs (the whole point of the prototype)

1. **Seam-free overlay** — sector cloud + stars sit over the analytic disc with no
   visible boundary or brightness pop.
2. **Fly-through holds 60 fps** — crossing the sector's nebula/dust at speed.
3. **Node-to-node flight** — select + fly between systems inside the sector.

## 10. Open decisions

1. **Sector edge: 250 pc** (review recommendation; with a 1 kpc "region" level on top
   = the sector/region/quadrant selection hierarchy for free). The disc is ~50:1
   oblate, so storage is a **sparse hash of populated cells**, ~3 vertical layers —
   not a literal uniform 3D grid.
2. **Prototype cloud light source:** brightest embedded star (reflection-nebula look)
   vs galactic-core direction (one global light). Leaning brightest-star.
3. **Half-res cloud pass:** add the render-target plumbing in the prototype, or
   full-res first and add half-res only if needed.

## 11. Phase B (post-prototype, NOT in scope here)

Sparse cell hash + camera-cell streaming (load/unload diff, hysteresis, Web-Worker
generation, object pooling); the MID impostor tier; the hierarchical nav (intra-sector
graph + always-resident inter-sector portal graph); sector/region/quadrant selection
UI. **Foundation that must land first, independently:** stable string/hash system IDs
(today identity = raw ECS eid; generated systems would silently rebind saved Bobs).
