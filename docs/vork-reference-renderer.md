# vork — offline reference renderer

Added 2026-11-10. Tool: [vork](https://voyager.so/vork) by Voyager, pinned at **0.3.0**.

## What it is, and what it is for here

vork is a ray-traced renderer with no editor. An agent writes a scene as JSON (plus optional
shader code), and vork renders a still or a clip on the GPU.

It is **not** a browser library. It does not use three.js, WebGL, or WebGPU, and nothing from it
runs in the game. Legion uses it for one job: making **physically lit reference plates** that the
realtime frame is judged against.

That fills a gap the acceptance harness already names. `reference_match` needs a reference at the
same pose as the capture. Until now the only sources were film stills and hand-captured
SpaceEngine plates. With vork, a reference can be built at any pose, lens, and sun angle we
choose, and rebuilt when the pose changes.

```
reference/vork/<id>/scene.json  →  vork  →  refs/vork/<id>/<profile>.png
                                                     ↓
        Legion capture (accept harness)  →  render-qa-toolkit reference_match
```

## Where it helps, by subject

| Subject | Fit in 0.3 | Why |
|---|---|---|
| **Black hole** | Strong | Light paths can be bent by a custom program. vork's own example integrates Schwarzschild geodesics, so lensing, the photon ring, and the disk's far side are computed, not painted. Legion's `src/render/blackhole/` can be checked against it |
| **Units and structures** (`hard-surface`, `hw-hulls`, `scale-silhouette`, `legion-probe`) | Strong | Path-traced hulls, real lens and depth of field, glTF import. This is the layer NORTHSTAR lists as absent |
| **Airless bodies, rings, eclipses** | Strong | Hard shadows, ring shadow on the globe, globe shadow on the rings, terminator falloff |
| **Photography layer** | Strong | Camera follows a physical model: focal length, sensor size, aperture. Display is AgX |
| **Star** | Partial | The photosphere as an emitting surface works. The corona is a volume, so it does not |
| **Planet with atmosphere, clouds** | Not yet | No volumes in 0.3. Surface and ocean only |
| **Nebulae, dust, galaxy band** | Not yet | These are volumes. vork says fog returns in 0.4; revisit then |

So the first targets are the black hole and the units layer. Nebulae and atmospheres stay on the
existing references until vork supports volumes.

## Limits that matter

- **Hardware.** Rendering needs Apple Silicon (Metal, macOS 26) or a recent NVIDIA card with
  hardware ray tracing. There is no CPU mode. Cloud agent sessions have no GPU, so they can
  write and check scenes but cannot render them.
- **A reference, not a northstar.** A vork plate proves light transport: where shadows fall, how
  light bends, how a lens stages scale. It does not set art direction. A plate becomes a
  NORTHSTAR row only when Sean rates it.
- **Approximations.** `std/final` approximates bounced light. Use `std/path` when bounce light,
  glass, or curved light paths matter. vork's black hole is a numerical approximation of a
  non-rotating hole, with an artistic disk.
- **Licence.** vork Preview License: free during the preview, including commercial work, and
  renders are ours. Modified copies of vork may not be redistributed, so vork's example code is
  never copied into this repo. The licence covers one version at a time, which is one reason the
  version is pinned.
- **Not a build dependency.** The platform binary is about 430 MB, so it is kept out of
  `package.json`. The runner uses a `vork` on the PATH, or fetches the pinned build with `npx`.

## Commands

| Command | Does | Needs a GPU |
|---|---|---|
| `node scripts/vork-ref.mjs list` | Lists scenes and the NORTHSTAR rows each serves | No |
| `npm run ref:vork:check` | Loads every scene and reports errors | No |
| `npm run ref:vork` | Renders every scene to `refs/vork/<id>/final.png` | Yes |
| `npm run ref:vork -- ringed-giant --profile std/previs` | One scene, fast blocking pass | Yes |
| `npm run ref:vork:blackhole` | Renders vork's own black hole example to `refs/vork/upstream-black-hole/path.png` | Yes |

Options on `render` and `upstream`: `--profile std/previs|std/draft|std/final|std/path`,
`--res 1920x1080`, `--at <seconds>`, `--samples <n>`.

`check` validates scene structure and built-in materials. Custom shader code and camera inputs
are only validated during a real render.

`ref:vork:blackhole` clones vork at the pinned tag into `scripts/.cache/` (git-ignored) and runs
the example's own `generate.py` to build its disk geometry before rendering.

## Adding a scene

1. Create `reference/vork/<id>/scene.json`. Run `vork help` for the format; it is the authority.
2. Optionally add `ref.json` beside it: `{ "rows": [...], "note": "...", "profile": "std/path", "at": 0 }`.
3. Match the Legion pose: same camera position, target, focal length, and sun direction as the
   official pose URL being judged.
4. `npm run ref:vork:check`, then render at `std/previs` first and inspect before a final.
5. No auto-exposure exists. Read the `exposure:` line vork prints and set
   `render.display.inputs.exposure` by hand.

Conventions: metres, right-handed Y-up, linear Rec.709, OpenPBR materials, physical camera in mm.
Scenes for space subjects use a scaled unit and say so in `ref.json`.

## Scenes

| ID | Serves | Status |
|---|---|---|
| `ringed-giant` | System rung; `scale-silhouette` (long lens), shadow geometry for giants and rings | Loads cleanly. **Not yet rendered**: exposure and framing are untuned first guesses. 1 unit = 1,000 km |
| `upstream-black-hole` | Black hole lensing and disk, as a physics check on `src/render/blackhole/` | vork's example, run in place. **Not yet rendered from this repo** |

## Next

- Render both on a GPU machine and tune `ringed-giant`.
- Write a Legion-owned black hole scene at the `?demo=blackhole` pose, so `reference_match` runs
  at the same camera.
- Write a `legion-probe` scene once the probe model exists: the vessel, lit, at three distances.
- Re-evaluate nebulae and atmospheres when vork ships volumes.
