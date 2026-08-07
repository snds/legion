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
| `se-planet` | SpaceEngine — planet approach / surface flythrough. Durable refs: `refs/continuum/stills/NORTHSTAR/space engine/`, motion `refs/continuum/motion/NORTHSTAR/space engine/source.mp4` (review copies under `refs/continuum/qa/northstar-review/se/` + `motion-se/`). Same-pose Earth day/coast plates for `reference_match` still needed under `refs/northstars/se-planet/`. | Literal (within WebGPU) | Atmosphere limb, terrain scale continuity, approach without LOD pop chaos |
| `se-star` | SpaceEngine — star close views | Spirit / Literal mix | Photosphere energy, corona restraint, exposure |
| `aaa-atmos` | Modern AAA atmospheric demos (e.g. Hillaire-class real-time skies) | Spirit | Multiple scattering sky, horizon energy |

## Project-local baselines

| ID | Reference | Contract | Status | Proves |
|---|---|---|---|---|
| `legion-continuum-ideal` | Captures present: `refs/continuum/stills/continuum-0.8-day.png`, `continuum-0.8-night.png`, `continuum-0.3-coast.png`, `continuum-0.6-clouds.png` (window PNGs ~1.8–2.3k, not locked 1920×1080) | Literal | **Unsigned — look hold** (cloud-deck flash P-LOOK; re-capture after lightning fix) | Regression bar for planet look after perf work |
| `legion-fly-approach` | Captures present: `refs/continuum/motion/{approach-surface,orbit-0.8au,look-orient}.mp4` + extracted `f_*.png` folders; QA under `refs/continuum/qa/` | Literal | **Unsigned — motion hold** (cloud flash visible frame-by-frame; re-record after fix) | Motion/LOD acceptance |

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
