# Legion — Intent / in-repo agent notes

Personal game repo. Doctor-managed `CLAUDE.md` at the root is a vault beacon; if you cannot read `~/Projects/Workspace`, use this file plus the repo itself.

## Stack (do not casually replace)

Three.js r171, TypeScript, Vite, GLSL ES planet materials (`src/render/planet/`). Lab-store is per-archetype (`lab-store.ts`); Save/Revert is load-bearing. Shader “nodes” today are GLSL chunks in `glsl.ts` / `shaders.ts`, not a second graph library.

## Boundaries

- ShadeGraph (`~/Projects/ShadeGraph`) authors graphs and may **export** into this repo. Do not add a ShadeGraph dependency here, and do not rewrite planet shaders in ShadeGraph’s document format inside Legion.
- Hard sci-fi / Bobiverse direction. Do not restyle as a toy or cartoon look.
- No employer (`c8`) files or tokens in this tree.
