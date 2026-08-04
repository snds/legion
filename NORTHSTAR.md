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

| ID | Reference | Contract | Proves |
|---|---|---|---|
| `legion-continuum-ideal` | Continuum lab stills at `lab-continuum-0.8au` once look-signed | Literal | Regression bar for planet look after perf work |
| `legion-fly-approach` | Recorded `approach-surface` path once signed | Literal | Motion/LOD acceptance |

Replace placeholders with concrete file paths as captures are signed off.

## Match protocol

- **Stills:** native res → 1:1 grid tiles → compare to northstar crops (`#10`)  
- **Video:** extract triage + stress-dense frames → frame-by-frame vs northstar clip timestamps  
- Low-res / fit-to-window previews are locators only — never a pass
