# Continuum Fidelity Build Plan (NORTHSTAR re-eval)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.
> Source ranking: `docs/superpowers/specs/2026-08-06-continuum-fidelity-qa-notes.md` § revised list.

**Goal:** Close Continuum orbit/approach look gaps vs SE/SC NORTHSTAR plates: seamless clouds, Rayleigh limb, real night, thinner Terran cover with shadows, close-AU climb, coast/ocean polish, accept hygiene.

**Branch:** `perf/planet-horizon-cull` (lab-only Continuum; do not cut over Legacy).

**Global constraints:**
- Continuum stays lab-only.
- Floor 60 FPS / 16.67 ms worst on author hardware for budget claims; Chromium accept is trend-only.
- No full SC V5 volumetric raymarch / Genesis POIs / weather systems / planet upsizing.
- Cheap shader cues only for cloud thickness and microrelief.
- Add/extend Vitest locks in `shaders-c125.test.ts` (or focused sibling) for shader contract strings.
- Commit each task; do not sign NORTHSTAR rows.
- Prefer existing patterns in `src/render/planet/continuum/`.

---

### Task F1: Kill cloud cube-face V / center seam

**Files:** `shaders.ts` (cloud shell + shared cloud field), possibly `cloud-voxels.ts`, `shaders-c125.test.ts`

**Problem:** Continuum stills/motion show a persistent chevron / V / mirrored seam across the disc center in the cloud field.

**Done when:**
- Cloud density sampling is continuous on the sphere (no cube-face UV / face-order artifacts; no polar/equator V from bad mapping).
- Ground-shadow cloud helper (if same field) stays in sync with shell.
- Test asserts the seam-prone pattern is gone (e.g. no cube UV projection; spherical domain documented) and lightning still storm-gated.
- Commit.

---

### Task F2: Rayleigh limb + warm terminator / night rim

**Files:** `shaders.ts` atmos + surface haze; tests

**Done when:** Hard white uniform limb replaced by thin cyan/blue graze on day limb and warmer rim near terminator/night; no full-disk atmos wash (P-LOOK-05). Commit.

---

### Task F3: Night pose + night disc energy

**Files:** `accept-api.ts`, `planet-lab.ts` / sun posing, atmos night fill; `continuum-accept.mjs` if pose broken

**Done when:** `poseSun('night')` (or accept night pose) yields a dark disc with rim energy; night still ≠ day still. Commit.

---

### Task F4: Thin Terran cloud cover + cast ground shadows

**Files:** presets / lab-ideal / cloud cover params; surface frag ground shadow term

**Done when:** Terran Continuum default cover no longer reads as ice ball; soft cloud shadows visible on surface under side light. Commit.

---

### Task F5: Cloud self-shadow / thickness cue

**Files:** `continuumCloudShellFrag` lighting

**Done when:** Day-gated cheap thickness/self-shadow cue (not full raymarch); night still silhouette-thin. Commit.

---

### Task F6: Close-AU albedo climb (medianTex ≥96)

**Files:** `chunk-pool.ts`, polish cadence, settle idle

**Done when:** After idle SLA at 0.3 AU, facing medianTex ≥96 (or documented gate + test for the scheduler path). Commit.

---

### Task F7: Ocean glint + coast AA + bathymetry hide

**Files:** surface frag / sample coast; P-LOOK-03/04

**Done when:** Softer coast AA, bathymetry not readable from orbit/close, liquid specular continuous (no mesh facets). Commit.

---

### Task F8: Side-light multi-material / microrelief cue

**Files:** surface frag climate albedo under non-front sun

**Done when:** Cheap biome/material variance readable under side light without new asset pipeline. Commit.

---

### Task F9: Accept capture hygiene

**Files:** `continuum-accept.mjs`, accept-api / lab chrome hide

**Done when:** Stills/motion captures exclude game HUD/dock; night/day/coast poses reliable. Commit.

---

### Task F10: Re-run accept harness

**Done when:** `npm run accept:continuum` (or stills+perf subset if motion too long) refreshes refs; short notes appended to fidelity QA doc. Do not sign NORTHSTAR.
