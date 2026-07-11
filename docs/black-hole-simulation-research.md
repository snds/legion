# Black-Hole Simulation — research reference (correct GR math)

**Purpose.** The physically-correct math for a real-time black hole, and which implementations get it
right — for the galaxy-tier set-pieces in [`stellar-phenomena-plan.md`](stellar-phenomena-plan.md).
Sean's explicit ask: **correct math, not a bloom-and-lens fake.** Compiled 2026-07-11.

Conventions: geometrized units G = c = 1 (mass M sets the length scale; ×GM/c² → meters). Spin is
dimensionless a ∈ [−1,1], a = J/(Mc).

## 1. Metrics & key radii

**Schwarzschild (non-spinning):**
ds² = −(1 − r_s/r)c²dt² + (1 − r_s/r)⁻¹dr² + r²dΩ²
- Event horizon: **r_s = 2GM/c²** (= 2M).
- Photon sphere: **r_ph = 1.5 r_s = 3M** (unstable circular photon orbits).
- Shadow / critical impact parameter: **b_crit = 3√3 M ≈ 5.196 M** — photons with b < b_crit are
  captured; the apparent shadow radius from infinity is 3√3 M (black disk + photon ring just outside).
- ISCO (disk inner edge, massive particles): **r_ISCO = 6M = 3 r_s.**

**Kerr (spinning), Boyer–Lindquist**, with Σ = r² + a²cos²θ, Δ = r² − 2Mr + a²:
- Horizons (Δ=0): **r± = M ± √(M² − a²)** — outer horizon shrinks 2M→M as a→1.
- Ergosphere: **r_ergo(θ) = M + √(M² − a²cos²θ)** — inside it, frame dragging forces co-rotation.
- Equatorial photon orbits: r_ph = 2M{1 + cos[(2/3)cos⁻¹(∓a/M)]} (prograde→M, retrograde→4M).
- ISCO (Bardeen–Press–Teukolsky 1972): r_ISCO = M{3 + Z₂ ∓ √[(3−Z₁)(3+Z₁+2Z₂)]}, Z₁ = 1 +
  (1−a²)^⅓[(1+a)^⅓ + (1−a)^⅓], Z₂ = √(3a²+Z₁²). Prograde 6M→M, retrograde 6M→9M as a:0→1. This
  spin-dependence is why a high-spin (Gargantua) disk glows closer and hotter.

Sources: [Photon sphere](https://en.wikipedia.org/wiki/Photon_sphere) · [Kerr geodesics arXiv 2004.07501](https://arxiv.org/pdf/2004.07501) · [NYU GR lecture 24](https://cosmo.nyu.edu/yacine/teaching/GR_2019/lectures/lecture24.pdf) · [Kerr calculator](https://duetosymmetry.com/tool/kerr-calculator-v2/) · [ISCO](https://en.wikipedia.org/wiki/Innermost_stable_circular_orbit).

## 2. Light bending — null-geodesic ray tracing (the core)

Render **backwards**: one ray per pixel from the camera, integrated through curved spacetime until it
hits the disk, crosses the horizon (→ black), or escapes to the star cubemap.

**Schwarzschild → a 2-D problem (what real-time shaders do).** Every geodesic is planar; per ray build
that plane, then integrate the exact **Binet equation** in u ≡ 1/r vs. orbit angle φ:

**d²u/dφ² = −u + (3/2) r_s u²**  (= −u + 3M u² in G=c=1)

The impact parameter **b = L/E** (energy E, angular momentum L folded away) is fixed by initial
conditions — you integrate one 2nd-order ODE, not the 4-D system. Integrate with **Leapfrog /
Velocity-Verlet** (symplectic, stable at large steps far out, small near the hole) + adaptive Δφ;
capture when u grows past the horizon. The **shadow + photon ring fall out for free**: b < 3√3 M
spirals in; b just above winds around the photon sphere before escaping — the physically-correct ring
and Einstein lensing, not a hack. This is exactly [oseiskar's physics page](https://oseiskar.github.io/black-hole/docs/physics.html)
(states u″ = −u(1 − 3/2 u), r_s=1).

**Kerr → the Carter constant makes it tractable.** No orbital plane, but still fully integrable via a
*third* conserved quantity **Q** (beyond E = −p_t, L_z = p_φ): geodesics separate into first-order
r-motion and θ-motion (R(r), Θ(θ)) integrated with RK4/RKF45. Q, E, L_z let you reduce the system,
detect turning points, and precompute deflection tables. This is the DNGR machinery.

**The gold standard — Interstellar/Gargantua:** James, von Tunzelmann, Franklin & Thorne 2015, *CQG*
32 065001 ([arXiv 1502.03808](https://arxiv.org/abs/1502.03808) · [SIGGRAPH version](https://dl.acm.org/doi/10.1145/2775280.2792510)).
DNGR propagates **ray *bundles*** (elliptical beams) through Kerr for a camera in arbitrary
motion/location — the bundle is what kills flicker at IMAX res. Overkill for a game, but the
correctness reference. Rigorous, code-complete alternative: [Riazuelo, "Seeing relativity I" (arXiv 1511.06025)](https://arxiv.org/abs/1511.06025).

## 3. Accretion-disk relativistic effects (cheap once you have the geodesic)

Thin, optically-thick equatorial annulus from r_ISCO outward.
- **(a) Temperature (Shakura–Sunyaev / Novikov–Thorne):** T_eff⁴(r) = [3GMṀ/(8πσr³)]·[1 − √(r_in/r)],
  peaking near ~1.4 r_in then **T ∝ r^(−3/4)**. Convert T(r)→color via Planck (precompute a 1-D
  T→RGB blackbody ramp texture). [arXiv 1201.2060](https://arxiv.org/pdf/1201.2060).
- **(b) Doppler beaming + gravitational redshift → one factor g = ν_obs/ν_emit:** λ_obs = g⁻¹λ_emit
  (approaching side blue, receding red); **bolometric intensity I_obs = g³·I_emit** (the famous cube,
  from Lorentz-invariant I_ν/ν³). This is what makes one side of the disk dramatically brighter.
  [Relativistic beaming](https://en.wikipedia.org/wiki/Relativistic_beaming).
- **(c) Lensing of the far side (the "Interstellar halo") is FREE** from the same integrator — rays
  passing over/under bend back onto the disk's far side, so a single disk plane yields the top-arc +
  bottom-arc + front silhouette; the photon ring is the innermost, most-wound copy.

## 4. Frame dragging (Kerr)
Off-diagonal g_tφ drags spacetime azimuthally; ZAMO angular velocity ω = −g_tφ/g_φφ. Inside the
ergosphere nothing can stay static. Visible: **asymmetric "D"-shaped shadow** at high spin (prograde
photon orbit ~M, retrograde ~4M), compounded disk brightness asymmetry, spin-dependent ring winding.

## 5. Implementation comparison (source-verified)

| Repo / source | Metric | Method | Real GR? | Stack | License | Role for Legion |
|---|---|---|---|---|---|---|
| **[oseiskar/black-hole](https://github.com/oseiskar/black-hole)** | Schwarzschild | Per-pixel Binet-ODE geodesic, Leapfrog + adaptive step | ✅ lensing, photon ring, shadow, disk w/ Planck+Doppler+redshift | WebGL/GLSL (three.js) | **MIT** | **#1 physics source** — best-documented, implement line-for-line |
| **[ebruneton/black_hole_shader](https://ebruneton.github.io/black_hole_shader/)** | Schwarzschild | **Precomputed deflection tables** → constant-time/pixel + beam tracing | ✅ exact deflection, Doppler/beaming, redshift, AA star filtering | WebGL2/GLSL | **BSD-3** | **#2 — cheap-per-frame correctness** for a fixed-mass hero hole |
| [Riazuelo "Seeing relativity I"](https://arxiv.org/abs/1511.06025) | Schwarzschild | Full null-geodesic tracer (incl. inside horizon) | ✅ rigorous | paper+code | — | Reference for rigor |
| DNGR (Interstellar) | Kerr | Ray-bundle propagation | ✅ gold standard | not open | — | Correctness bar only |
| **[MisterPrada/singularity](https://github.com/MisterPrada/singularity)** | none | Volumetric noise raymarch + **1/r² ray-steer hack** | ✗ no metric/geodesic (physically-*flavored* only) | **WebGPU + TSL, three.js 0.180** | **none (blocker)** | **Best stack scaffold, wrong physics** — see §7 hybrid |
| [Bruno Simon/webgl-black-hole](https://github.com/brunosimon/webgl-black-hole) | none | Screen-space radial distortion mask + chromatic shift | ✗ cosmetic UV warp | WebGL, three.js 0.141 | none | Multi-pass **architecture** reference only |
| [Scenes3D/black-hole](https://github.com/Scenes3D/black-hole) | none | Fork of Bruno Simon | ✗ (same fake) | WebGL | MIT | Skip (MIT copy of Bruno's effect) |

**Note:** the three implementations Sean supplied last (singularity, Bruno Simon, Scenes3D) are all
**art effects — none integrate a geodesic or use a metric.** Correct math lives only in oseiskar /
ebruneton / Riazuelo.

## 6. Correctness-vs-performance ladder
1. **Full per-pixel geodesic** (Kerr, Carter-reduced, RK4/RKF45) — most correct, ~tens–hundreds of ODE
   steps/pixel; feasible at 1080p if capped + early-out. (oseiskar does Schwarzschild in-browser.)
2. **Precomputed deflection tables** (ebruneton) — **best correctness-per-frame-cost**; integrate once
   into a texture, runtime = table lookup. Per-metric (recompute if M/a changes — fine for a fixed hole).
3. **Analytic weak-field lensing** (α ≈ 4GM/(c²b) = 2r_s/b as a UV warp) — correct far, wrong in the
   strong field (no photon ring). Cheap.
4. **Post-process fake** (bloom + distortion + disk sprite) — no physics; **what Sean rejected** (= the
   Bruno Simon / Scenes3D tier).

## 7. Recommendation for Legion

**Take the correct geodesic math from `oseiskar/black-hole` (MIT)** and, for a fixed hero hole,
optionally **table-ify à la `ebruneton` (BSD-3)** so it runs near-post-process cost while staying
physically exact. Add **Kerr only if spin is story/gameplay-relevant** (a fast-rotating *disk* on a
Schwarzschild hole already reads as "spinning" via Doppler asymmetry).

**Stack caveat / hybrid worth flagging:** Legion is on WebGPU, and **MisterPrada/singularity is the
only reference already running WebGPU + TSL** — so it's the best *engineering scaffold* for the
node-material/WebGPU integration that the (WebGL/GLSL) oseiskar/ebruneton shaders don't solve. The
hybrid: **port oseiskar's Binet geodesic solve into that WebGPU scaffold**, replacing singularity's
noise-raymarch with the real photon-path integrator. Two caveats: (1) singularity has **no license** —
don't copy verbatim; use it only as an architecture reference / contact the author; (2) TSL can't yet
express the adaptive-step geodesic loop elegantly — prefer a `wgslFn`/raw-shader node for the
integrator and TSL only for compositing.

**"Correct enough" recipe:** ray-march only inside a bounding sphere (~20–30 r_s; flat outside → sample
the star cubemap); Leapfrog + adaptive Δφ; cap ~100–300 steps + early-out on capture/escape; single
thin disk plane (lensed arcs are free); precompute T(r)→RGB + deflection textures; fold redshift +
Doppler + beaming into one g (color ×g, intensity ×g³); render at half-res + composite. Every headline
feature stays physically real — horizon at 2GM/c², photon ring at 3√3 M, true lensing, Doppler
asymmetry — inside a WebGL/WebGPU game budget.

**Hand the implementer:** [oseiskar physics page](https://oseiskar.github.io/black-hole/docs/physics.html)
(equations to code) · [ebruneton method](https://ebruneton.github.io/black_hole_shader/) · [Riazuelo](https://arxiv.org/abs/1511.06025)
(rigor) · [disk temperature](https://arxiv.org/pdf/1201.2060) · [DNGR](https://arxiv.org/abs/1502.03808) (gold standard).
