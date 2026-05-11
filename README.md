# Legion — Bobiverse: Replication Protocol

Hard sci-fi RTS / 4X prototype inspired by Dennis E. Taylor's Bobiverse.
Self-replicating AI probes, factory-driven economy, real star systems, emergent rival-clone politics.

**Stack:** Three.js r0.171 + TypeScript + Vite. Targeting WebGPU.

## Getting started

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev` — Vite dev server with HMR
- `npm run build` — typecheck + production build to `dist/`
- `npm run preview` — preview the production build

## Layout

```
src/
  core/         ECS + state + events + camera + input
  render/       Three.js scene, renderer, post-processing, planets, galaxy
  simulation/   Pathfinding + steering
  audio/        Tone.js (music) + Howler (SFX/ambience) over a shared bus
  ui/           DOM HUD, panels, dock, tooltip
  network/      Command bus
  persistence/  Dexie-backed save manager + worker
  data/         Star catalog
  debug/        Overlay
public/textures/  Runtime image assets
Audio/            Music tracks
Fonts/            Berkeley Mono (variable)
```

Design notes, references, and screenshots are intentionally **not** in this repo —
they live in the design workspace and stay out of the runtime tree.
