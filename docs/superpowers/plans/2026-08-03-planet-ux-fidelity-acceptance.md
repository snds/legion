# Planet Continuum UX + Fidelity Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Continuum planet approach feel seamless and SpaceEngine-class under real camera interaction: cover appears in seconds, fidelity climbs with zoom, night/clouds/limb match northstars, and every claim closes the Framework #12 triple done-gate (native still grid + motion video + measured frame budget).

**Architecture:** Keep Approach C (cube-sphere heightfield + camera-local voxels). Treat streaming as a **user-visible product** with SLA metrics and HUD feedback, not a silent CPU queue. Cover stays stream-cheap; polish climbs in stepped upgrades with facing priority. Acceptance is harness-driven (`?perfcapture`, `RENDER.md` paths, `render-qa-toolkit`), never screenshot vibes.

**Tech Stack:** TypeScript, Three.js GLSL, Vitest, Legion lab (`?lab=planet&engine=continuum`), `src/render/perf-capture.ts`, Workspace `#12` / `realtime-visual-craft` / `render-qa-toolkit`.

## Global Constraints

- Continuum remains **lab-only** until A/B vs Legacy wins on still + motion + budget (`RENDER.md`).
- Floor **60 FPS** / 16.67 ms worst composite (`BUDGET.md`); uncapped default; judge worst hitch, not mean.
- Northstar: `se-planet` Literal-within-WebGPU; `legion-continuum-ideal` / `legion-fly-approach` once signed (`NORTHSTAR.md`).
- Triple done-gate required for every track close: native still → 1:1 grid; recorded path frame-by-frame; `__perfCapture` JSON.
- Low-res / fit-to-window / IDE-browser stills are **locators only** (Framework #10/#12 ban).
- Cover before polish; polish never steals cover; no face-order `slice()` of leaf sets.
- No new heavy deps; prefer Vitest + existing perf capture.
- Conflict guard: Cursor marketing-3D Three.js plugins are API lookup only when `#12` spine is loaded.

**Doctrine / contracts (read before coding):**

| Doc | Role |
|---|---|
| `Workspace/01-frameworks/12-realtime-photoreal-operational-framework.md` | Triple done-gate, bans |
| `RENDER.md` / `BUDGET.md` / `NORTHSTAR.md` | Paths, poses, refs |
| `docs/render-acceptance-harness.md` | How to run QA |
| `docs/superpowers/specs/2026-08-02-continuum-aesthetic-pipeline-design.md` | Continuum tracks A–D |
| `docs/chunked-lod-60fps-plan.md` | Perf architecture |

**Session failure modes to close (ledger candidates):**

| ID | Symptom | Likely cause (current code) |
|---|---|---|
| P-UX-01 | 5–10 min “baking” on 0.6→0.2 AU | Full-res upgrades / warm flood / view-LOD thrash |
| P-UX-02 | Soft forever after stream cover | Upgrade ceiling frozen / polish gated too hard |
| P-UX-03 | Rectangular holes on rotate | Leaf `slice`, thin sticky, slow LOD refresh |
| P-LOOK-01 | Night clouds glow | Half-Lambert cloud shade (patched; verify motion) |
| P-LOOK-02 | Pitch-black night disc | Missing atmos fill (patched; verify still+motion) |
| P-LOOK-03 | Ocean specular facets | Mesh normals on sea (radial blend; verify) |
| P-LOOK-04 | Visible bathymetry | Wide ocean depth ramp (narrowed; verify) |
| P-LOOK-05 | Atmos disk wash | BackSide fresnel / aerial haze (patched; verify) |

---

## File map

| File | Responsibility |
|---|---|
| `src/render/planet/continuum/chunk-types.ts` | Tex ladder, ceilings, stream/coarse constants, SLA constants |
| `src/render/planet/continuum/chunk-lod.ts` | Leaf select, collapse, prefetch caps, horizon pad |
| `src/render/planet/continuum/chunk-pool.ts` | Queue, cover/polish split, warm, HUD stats, hitch accounting |
| `src/render/planet/continuum/chunk-sample.ts` | Bake cost (skipRelief, coast SS) |
| `src/render/planet/continuum/shaders.ts` | Surface/cloud/atmos lighting |
| `src/render/planet/continuum/debug-chunks.ts` + lab HUD | User-visible stream state |
| `src/render/planet/continuum/stream-metrics.ts` (**create**) | Pure SLA counters for tests + HUD |
| `src/render/perf-capture.ts` / lab URLs | Budget poses |
| `docs/render-acceptance-harness.md` | Wire Continuum approach poses |
| `NORTHSTAR.md` | Sign local baselines after Task 6 |

---

### Task 1: Stream SLA metrics (pure) + failing budget tests

**Files:**
- Create: `src/render/planet/continuum/stream-metrics.ts`
- Create: `src/render/planet/continuum/stream-metrics.test.ts`
- Modify: `src/render/planet/continuum/chunk-types.ts` (export SLA constants)

**Interfaces:**
- Produces: `StreamSlaConstants`, `recordCoverComplete(stats)`, `estimateCoverSeconds(pending, buildsPerSec)`, `ApproachSlaReport`
- Consumes: nothing from Three.js

- [ ] **Step 1: Add SLA constants**

In `chunk-types.ts`:

```ts
/** UX contract: time from zoom band change to pending===0 at stream res. */
export const APPROACH_COVER_SLA_SEC = 3;
/** UX contract: facing leaf median texRes after 5s idle at fixed AU. */
export const APPROACH_FIDELITY_IDLE_SEC = 5;
export const APPROACH_FIDELITY_MIN_TEX_AT_03AU = 96;
```

- [ ] **Step 2: Write failing tests for cover-time estimate + report shape**

```ts
// stream-metrics.test.ts
import { describe, expect, it } from 'vitest';
import {
  estimateCoverSeconds, approachSlaPass, APPROACH_COVER_SLA_SEC,
} from './stream-metrics';
import { APPROACH_COVER_SLA_SEC as SLA } from './chunk-types';

describe('stream SLA', () => {
  it('estimates cover time from pending and build rate', () => {
    expect(estimateCoverSeconds(96, 30)).toBeCloseTo(3.2, 1);
    expect(estimateCoverSeconds(0, 30)).toBe(0);
  });

  it('fails SLA when cover seconds exceed budget', () => {
    const report = approachSlaPass({
      coverSeconds: SLA + 1,
      facingMedianTexAt03: 128,
      worstFrameMs: 12,
    });
    expect(report.coverOk).toBe(false);
    expect(report.fidelityOk).toBe(true);
    expect(report.budgetOk).toBe(true);
    expect(report.pass).toBe(false);
  });
});
```

- [ ] **Step 3: Implement minimal `stream-metrics.ts` to pass**

```ts
import {
  APPROACH_COVER_SLA_SEC,
  APPROACH_FIDELITY_MIN_TEX_AT_03AU,
} from './chunk-types';

export function estimateCoverSeconds(pending: number, buildsPerSec: number): number {
  if (pending <= 0) return 0;
  const rate = Math.max(1e-6, buildsPerSec);
  return pending / rate;
}

export interface ApproachSlaInput {
  coverSeconds: number;
  facingMedianTexAt03: number;
  worstFrameMs: number;
}

export function approachSlaPass(input: ApproachSlaInput) {
  const coverOk = input.coverSeconds <= APPROACH_COVER_SLA_SEC;
  const fidelityOk = input.facingMedianTexAt03 >= APPROACH_FIDELITY_MIN_TEX_AT_03AU;
  const budgetOk = input.worstFrameMs <= 16.67;
  return { coverOk, fidelityOk, budgetOk, pass: coverOk && fidelityOk && budgetOk };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/render/planet/continuum/stream-metrics.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/render/planet/continuum/stream-metrics.ts src/render/planet/continuum/stream-metrics.test.ts src/render/planet/continuum/chunk-types.ts
git commit -m "$(cat <<'EOF'
feat(continuum): add approach stream SLA metrics and constants

EOF
)"
```

---

### Task 2: User-visible stream state (lab HUD + game-feel feedback)

**Files:**
- Modify: `src/render/planet/continuum/chunk-types.ts` (`ChunkHudStats`)
- Modify: `src/render/planet/continuum/chunk-pool.ts` (`hud()`, cover clock)
- Modify: `src/render/planet/continuum/debug-chunks.ts`
- Modify: `src/render/planet/planet-lab.ts` (always show stream line when Continuum + approaching)

**Interfaces:**
- Extends `ChunkHudStats` with `coverPending`, `warmPending`, `medianTex`, `coverAgeMs`, `streaming`
- Game-design lens (`visual-qa-game-design`): player must see **why** the surface looks soft (streaming vs settled), not a silent mush

- [ ] **Step 1: Extend HUD stats in pool**

Track `coverStartedAt` when `pending` rises from 0; clear when pending hits 0. Expose in `hud()`:

```ts
{
  resident, pending, building, byLevel, tris, showChunks,
  coverPending: this.pending.length,
  warmPending: this.warmPending.length,
  streaming: this.streaming,
  coverAgeMs: this.coverStartedAt ? performance.now() - this.coverStartedAt : 0,
  medianTex: median of desired residents' texRes (0 if none),
}
```

- [ ] **Step 2: Format string for lab**

```ts
// debug-chunks.ts
export function formatChunkHud(s: ChunkHudStats): string {
  const stream = s.streaming || s.coverPending > 0
    ? ` · STREAM cover ${s.coverPending} ${(s.coverAgeMs / 1000).toFixed(1)}s`
    : ` · settled tex~${s.medianTex}`;
  return `chunks ${s.resident} · pending ${s.pending}${stream} · tris ${s.tris}`;
}
```

- [ ] **Step 3: Show Continuum stream HUD whenever `engine=continuum` (not only Show chunks)**

In lab update path, call `updateChunkHud` when Continuum selected so approach feedback is default.

- [ ] **Step 4: Manual locator check**

Open `?lab=planet&engine=continuum&au=0.8`, zoom toward 0.3. HUD must flip to STREAM with falling pending, then “settled tex~N” climbing.  
Expected: visible state change within 1s of zoom; no silent  minutes.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(continuum): surface approach stream state in lab HUD

EOF
)"
```

---

### Task 3: Cover SLA enforcement (catch-up + cost caps)

**Files:**
- Modify: `src/render/planet/continuum/chunk-pool.ts` (`tick`, `buildOne`)
- Modify: `src/render/planet/continuum/chunk-sample.ts` (optional early-out)
- Test: `src/render/planet/continuum/chunk.test.ts` + new pool unit if pure helpers extracted

**Goal:** P-UX-01 — cover at stream res within `APPROACH_COVER_SLA_SEC` under scripted approach.

- [ ] **Step 1: Instrument build rate**

In `tick`, maintain EMA of stream builds/sec. If `estimateCoverSeconds(pending, ema) > APPROACH_COVER_SLA_SEC`, enter **catch-up**: budget ≥ 12 ms, maxBuilds ≥ 4, forceStream true, skip warm/polish entirely.

- [ ] **Step 2: Hard ban expensive builds while `coverPending > 0`**

Assert in `buildOne`:

```ts
if (this.pending.length > 0 || forceStream) {
  // stream tex only — never coarse/full while cover backlog exists
}
```

Add test that `texResStreamForLevel(L) <= 24` and `texResNextUpgrade` not used from `buildOne` path.

- [ ] **Step 3: Bench guard (Vitest)**

```ts
it('stream sample of L2 leaf stays under 25ms on CI machine', () => {
  const t0 = performance.now();
  sampleHeightfieldChunk(bundle, someL2, { texRes: 16, meshGrid: 20, skipRelief: true });
  expect(performance.now() - t0).toBeLessThan(40); // loosen on slow CI if needed
});
```

- [ ] **Step 4: Manual + perf**

Script zoom 0.8→0.3; note HUD coverAgeMs at pending=0. Target ≤ 3s. Capture `?perfcapture` worst frame during zoom; hitch spikes OK once, not sustained.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix(continuum): enforce stream cover SLA with catch-up budget

EOF
)"
```

---

### Task 4: Fidelity climb UX (stepped upgrades that users can feel)

**Files:**
- Modify: `src/render/planet/continuum/chunk-types.ts` (`texResCeilingForAu`, `texResNextUpgrade`)
- Modify: `src/render/planet/continuum/chunk-pool.ts` (`upgradeOneAlbedo`, polish cadence)
- Test: `chunk.test.ts` ladder assertions

**Goal:** P-UX-02 — after cover, facing tex climbs every idle second toward AU ceiling (96+ by 5s at 0.3 AU).

- [ ] **Step 1: Lock ceilings (closer → sharper facing patches)**

```ts
export function texResCeilingForAu(level: number, viewAu: number): number {
  const full = texResForLevel(level);
  if (viewAu >= 0.75) return full;
  if (viewAu >= 0.5) return Math.min(full, 192);
  if (viewAu >= 0.35) return Math.min(full, 160);
  if (viewAu >= 0.22) return Math.min(full, level >= 3 ? 160 : 192);
  return Math.min(full, level >= 4 ? 192 : 160);
}
```

- [ ] **Step 2: Polish cadence**

While `pending===0` and not moving: spend remaining frame budget on **2–3** facing upgrades/frame (not 1). Prefer `facing * 80 + (next-current)`.

- [ ] **Step 3: Test SLA fidelity gate**

```ts
it('0.3 AU ceiling allows >=96 and steps from 16 without jumping to full', () => {
  expect(texResCeilingForAu(3, 0.3)).toBeGreaterThanOrEqual(96);
  expect(texResNextUpgrade(16, 3, 0.3)).toBeLessThanOrEqual(48);
  let t = 16;
  for (let i = 0; i < 8; i++) t = texResNextUpgrade(t, 3, 0.3);
  expect(t).toBeGreaterThanOrEqual(96);
});
```

- [ ] **Step 4: Motion acceptance (locator then native)**

Record `approach-surface` 10s; pause 5s at 0.3 AU. Frame-by-frame: mush → sharper coasts on facing hemisphere. Still-only pass is **invalid**.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(continuum): accelerate facing albedo climb after cover

EOF
)"
```

---

### Task 5: Rotate / approach hole immunity (LOD product polish)

**Files:**
- Modify: `src/render/planet/continuum/chunk-lod.ts`
- Modify: `src/render/planet/continuum/chunk-pool.ts` (sticky until replacement ready)
- Test: `chunk.test.ts`, `cube-sphere.test.ts`

**Goal:** P-UX-03 — no rectangular holes during `look-orient` at 0.3–0.6 AU.

- [ ] **Step 1: Sticky rule**

Do not drop a sticky leaf from `desired` until either (a) a ready ideal descendant covers its footprint, or (b) miss count exceeds limit **and** pending for that region is 0.

- [ ] **Step 2: Guard test — collapse never empties**

Already present; add:

```ts
it('select under streamPressure does not reduce leafCap into hole territory', () => {
  const a = selectChunkLeaves({ camLocal: [0,0,1.3], radius: 1, viewAu: 0.25, streamPressure: false });
  const b = selectChunkLeaves({ camLocal: [0,0,1.3], radius: 1, viewAu: 0.25, streamPressure: true });
  expect(b.length).toBeGreaterThanOrEqual(Math.min(72, a.length * 0.5));
});
```

- [ ] **Step 3: Motion path `look-orient`**

At 0.35 AU, yaw 360° in 8s. Fail if any frame shows starfield through a quad hole on the lit disc.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix(continuum): hold sticky cover until replacements are ready

EOF
)"
```

---

### Task 6: Look verification pack (northstar + ledger)

**Files:**
- Modify: `NORTHSTAR.md` (paths once signed)
- Modify: `docs/render-acceptance-harness.md` (Continuum approach pose rows)
- Capture store: project refs folder (document paths in NORTHSTAR)

**Goal:** Close P-LOOK-01…05 with #12 evidence, not chat screenshots.

- [ ] **Step 1: Official still poses (native Chrome)**

| Pose | URL |
|---|---|
| continuum-0.8-day | `?lab=planet&engine=continuum&au=0.8&w=1920&h=1080&dpr=1` |
| continuum-0.8-night | same + rotate night into view |
| continuum-0.3-coast | `au=0.3` facing coast, wait 5s settled |
| continuum-0.6-clouds | clouds on, terminator across disc |

Lossless PNG → `render-qa-toolkit` `native_grid` → tile Read (#10).

- [ ] **Step 2: Checklist vs `se-planet` Spirit/Literal**

For each pose, score 0–4 on: limb, terminator, cloud night, ocean glint continuity, coast AA, bathymetry hide, night fill. Fail any 0–1.

- [ ] **Step 3: Motion**

Record `approach-surface` + `orbit-0.8au` + `look-orient`. Run `video_extract` + `temporal_delta`. Flag hitch frames and LOD pops.

- [ ] **Step 4: Sign baselines**

Update `NORTHSTAR.md` rows `legion-continuum-ideal` and `legion-fly-approach` with concrete paths.

- [ ] **Step 5: Commit docs only**

```bash
git commit -m "$(cat <<'EOF'
docs: sign Continuum northstar baselines and harness poses

EOF
)"
```

---

### Task 7: Lighting regression locks (clouds + night fill)

**Files:**
- Modify: `src/render/planet/continuum/shaders.ts` (only if Task 6 finds regressions)
- Test: `shaders-c125.test.ts` (string contracts already present)

**Goal:** Keep P-LOOK-01/02 closed under AgX + bloom.

- [ ] **Step 1: Confirm string contracts still present**

```bash
npx vitest run src/render/planet/continuum/shaders-c125.test.ts
```

Expected: cloud day-gate + `skyFill` / `antiSun` PASS.

- [ ] **Step 2: If night is too bright or clouds too dark, tune constants only**

Cloud night alpha `mix(0.32, 0.72, day)`; surface `skyFill` scales with `uAtmosDensity`. Document final constants in a one-line comment citing Task 6 pose IDs.

- [ ] **Step 3: Re-capture continuum-0.6-clouds + continuum-0.8-night; commit if tuned**

---

### Task 8: Budget gate for Continuum approach

**Files:**
- Modify: `BUDGET.md` (add Continuum approach poses)
- Modify: `docs/render-acceptance-harness.md`
- Optional: extend `perf-capture.ts` markers for `lodRebuildCount` / `coverAgeMs`

**Goal:** Framework #12 gate C — numbers, not FPS overlay vibes.

- [ ] **Step 1: Add poses to BUDGET.md**

```md
| lab-continuum-0.3au | `?lab=planet&engine=continuum&perfcapture&au=0.3&w=1280&h=720&dpr=2` |
| lab-continuum-approach | scripted 0.8→0.2 with perfcapture samples |
```

- [ ] **Step 2: Capture JSON on author hardware; run toolkit**

```bash
cd ~/Projects/Workspace/03-skills/render-qa-toolkit
python qa-suite.py --config configs/legion.yaml --output ./_qa-out \
  --perf path/to/__perfCapture.json \
  --only frame_budget,pass_attribution
```

Pass: worst composite ≤ 16.67 ms at 0.8 AU settled; approach hitch frames logged and bounded (no multi-second freeze).

- [ ] **Step 3: Commit budget doc + sample JSON fixture if useful for CI trend**

---

### Task 9: Premortem harden (#11) before declaring Continuum UX done

**Files:**
- Create: `docs/superpowers/specs/2026-08-03-continuum-ux-premortem.md` (short)
- Optional Workspace ledger rows (outside Legion if policy says so)

- [ ] **Step 1: Write premortem** listing how P-UX-01…03 and P-LOOK-01…05 could return

Include: upgrade to 256² during cover; warm queue > 16; sticky expire before child ready; half-Lambert regression; aerial haze `viewDist/R` return.

- [ ] **Step 2: Map each to a test or harness check that would catch it**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs: Continuum UX premortem and regression tripwires

EOF
)"
```

---

### Task 10: Continuum vs Legacy A/B cutover gate (no ship yet)

**Files:**
- Modify: `RENDER.md` (`continuum-ab` path notes)
- Lab only; do not flip shipping default

- [ ] **Step 1: Same seed / climate / `lab-ideal.json` Terran on Legacy vs Continuum**

Record identical `approach-surface` path twice (`engine` toggle).

- [ ] **Step 2: Guild-style scorecard (Lighting, Materials, LOD/Camera, Budget, Reference Match) 0–4**

Continuum ships as default only if Continuum ≥ Legacy on look **and** meets SLA + budget. Otherwise stay lab-only.

- [ ] **Step 3: Document decision in `docs/superpowers/specs/` one-pager**

---

## Acceptance matrix (plan done when)

| Gate | Criterion |
|---|---|
| Still | Native grids for Task 6 poses; no P-LOOK criticals |
| Motion | `approach-surface` + `look-orient` hole-free; fidelity climbs after pause |
| Budget | 0.8 AU ≤ 16.67 ms worst; approach cover ≤ 3s stream; no multi-minute freeze |
| UX | HUD shows STREAM vs settled; player can tell soft = loading |
| Premortem | Task 9 filed with tripwires |
| Cutover | Explicit Legacy vs Continuum decision recorded (ship or lab-only) |

---

## NORTHSTAR re-eval pointer (2026-08-06)

Full visual + Star Citizen Planet Tech V5 audio re-eval lives in
[`docs/superpowers/specs/2026-08-06-continuum-fidelity-qa-notes.md`](../specs/2026-08-06-continuum-fidelity-qa-notes.md)
(§ NORTHSTAR re-eval). Durable refs: `refs/continuum/{stills,motion}/NORTHSTAR/`.

**Priority shift for look tasks:** cloud cube-face V/seam → Rayleigh limb / night rim → night pose → thin clouds + cast shadows → cheap cloud thickness → close-AU tex climb → ocean/coast → side-light microrelief → accept hygiene. Do not sign `se-planet` or local baselines until same-pose SE Earth day/coast plates exist and those gates clear.

## Out of scope

- Full offline lightmap bake-orchestration (different skill; Continuum is runtime procedural).
- Shipping Continuum as default before Task 10 pass.
- ReSTIR / DDGI / full-planet voxels.
- Galaxy / star lab work.
- Full Star Citizen V5 volumetric clouds, Genesis art-placed POIs, dynamic weather systems, planet size upsizing (spirit language only; see QA notes chase vs skip).

---

## Spec self-review

1. **Coverage:** UX lag → Tasks 1–4; holes → 5; look → 6–7; budget → 8; harden → 9; ship gate → 10. Northstar/harness/#12 baked into Global Constraints + Tasks 6/8.  
2. **Placeholders:** None intentional; NORTHSTAR paths filled in Task 6 when captures exist.  
3. **Consistency:** SLA constants live in `chunk-types.ts`; reports in `stream-metrics.ts`; HUD consumes `ChunkHudStats`.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-08-03-planet-ux-fidelity-acceptance.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans checkpoints  

Which approach?
