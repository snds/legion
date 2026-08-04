# NORTHSTAR.md — Legion

Movie-level / engine-class references that gate Legion visual acceptance (Workspace framework #12). Spirit vs Literal called per row. Paths may be local captures or URLs; keep durable copies under a project refs folder when possible.

## How to use

1. At `shape` time, pick the rows that apply to the change.  
2. At `match` time, align stills or video frames and run `render-qa-toolkit` `reference_match` + native grid assess.  
3. Motion-sensitive features must cite a **video** northstar (or a recorded path judged against still northstars frame-by-frame) — not a single screenshot.

## Film / cinematic (look language)

| ID | Reference | Contract | Proves |
|---|---|---|---|
| `film-martian` | *The Martian* — orbital / surface lighting plates | Spirit | Dusty physical sunlight, grounded exposure, industrial craft |
| `film-expanse` | *The Expanse* — ship / station exteriors | Spirit | Hard light, material honesty, scale of hull vs human |
| `film-oblivion` | *Oblivion* (2013) — landscapes + craft | Spirit | Clean sci-fi compositions, restrained grade |

## Engine / game northstars

| ID | Reference | Contract | Proves |
|---|---|---|---|
| `se-planet` | SpaceEngine — planet approach / surface flythrough | Literal (within WebGPU) | Atmosphere limb, terrain scale continuity, approach without LOD pop chaos |
| `se-star` | SpaceEngine — star close views | Spirit / Literal mix | Photosphere energy, corona restraint, exposure |
| `aaa-atmos` | Modern AAA atmospheric demos (e.g. Hillaire-class real-time skies) | Spirit | Multiple scattering sky, horizon energy |

## Project-local baselines

| ID | Reference | Contract | Status | Proves |
|---|---|---|---|---|
| `legion-continuum-ideal` | Planned native 1920×1080 lossless PNG set: `refs/continuum/stills/continuum-0.8-day.png`, `continuum-0.8-night.png`, `continuum-0.3-coast.png`, and `continuum-0.6-clouds.png` | Literal | **Unsigned, pending author capture** | Regression bar for planet look after perf work |
| `legion-fly-approach` | Planned native/lossless motion extracts: `refs/continuum/motion/approach-surface/`, `orbit-0.8au/`, and `look-orient/` | Literal | **Unsigned, pending author capture** | Motion/LOD acceptance |

The intended capture store is `refs/continuum/`: `stills/` for native PNGs, `motion/<path-id>/` for
lossless frame sequences or extracted PNGs, and `qa/<pose-or-path-id>/` for toolkit output. Do not replace
the pending status with a signed baseline until the capture set includes native 1920×1080 lossless PNGs,
motion extracts, toolkit grids, and recorded scorecards. See
[`docs/render-acceptance-harness.md`](docs/render-acceptance-harness.md#continuum-look-verification-pack)
for the official poses and commands.

## Match protocol

- **Stills:** native res → 1:1 grid tiles → compare to northstar crops (`#10`)  
- **Video:** extract triage + stress-dense frames → frame-by-frame vs northstar clip timestamps  
- Low-res / fit-to-window previews are locators only — never a pass
