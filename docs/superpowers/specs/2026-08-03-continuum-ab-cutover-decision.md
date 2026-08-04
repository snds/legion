# Continuum vs Legacy A/B cutover decision

**Status:** Recorded, not approved for ship (2026-08-03)  
**Scope:** Compare the Legacy shipping renderer against the Continuum lab renderer. This is a cutover gate, not a release authorization.

## Decision

**DECISION: Stay lab-only. Legacy remains the shipping default until native still, motion, and budget evidence passes and Continuum is at least equal to Legacy on look.**

The required evidence is absent: `NORTHSTAR.md` marks both Continuum still and motion baselines unsigned pending native author capture, and `BUDGET.md` has no native Chrome `__perfCapture` fixtures. No score or ship claim can be made from locator captures, unit tests, or IDE-browser observations.

## Controlled A/B protocol

1. Load the same Terran configuration from `src/render/planet/lab-ideal.json`, preserving the same seed and climate inputs.
2. Reset before each pass and record the identical `approach-surface` and `look-orient` inputs on Legacy, then on `?engine=continuum`.
3. Hold hardware, Chrome version, canvas size, DPR, warmup, lab controls, and capture settings constant.
4. Capture the Task 6 native still poses, visually lossless motion, and Task 8 `__perfCapture` JSON for both engines.
5. Review stills at 1:1 native grids and motion frame-by-frame. Populate the scorecard only with capture paths and declared hardware.

## Guild scorecard

Score each look category from 0 to 4 only after the evidence above exists. A pending cell is intentionally not a zero or a passing score.

| Category | Legacy evidence | Continuum evidence | Legacy score (0–4) | Continuum score (0–4) | Gate status |
|---|---|---|---:|---:|---|
| Lighting | Pending native still + motion capture | Pending native still + motion capture | Pending | Pending | Pending |
| Materials | Pending native still + motion capture | Pending native still + motion capture | Pending | Pending | Pending |
| LOD / Camera | Pending `approach-surface` + `look-orient` capture | Pending `approach-surface` + `look-orient` capture | Pending | Pending | Pending |
| Budget | Pending native Chrome `__perfCapture` | Pending native Chrome `__perfCapture` | Pending | Pending | Pending |
| Reference match | Pending native grid assessment against `se-planet` | Pending native grid assessment against `se-planet` | Pending | Pending | Pending |

## Cutover requirements

Continuum can be proposed as the default only when all conditions hold on declared native Chrome hardware:

- Every required still has a native 1:1 grid review with no P-LOOK critical.
- `approach-surface` and `look-orient` are hole-free, and fidelity visibly climbs after the settled pause.
- At 0.8 AU, worst composite frame time is at most 16.67 ms; approach cover clears within 3 seconds; there is no multi-minute freeze.
- The completed scorecard shows Continuum at least equal to Legacy on look.
- The evidence paths, hardware label, and review outputs are recorded with the final recommendation.

Until then, access Continuum only through `?engine=continuum`; do not change the Legacy default.

## Evidence references

- `RENDER.md` `continuum-ab` protocol
- `NORTHSTAR.md` unsigned Continuum baselines
- `BUDGET.md` Continuum approach budget gate
- `docs/superpowers/specs/2026-08-03-continuum-ux-premortem.md`
