// ═══════════════════════════════════════════════════════════════════
// SECTOR STARS — density-sampled embedded star field (prototype Inc 2)
//
// Generates a sector's resolved stars by sampling the SAME analytic density
// model (galaxy-density.ts) the disc volume raymarches — so the resolved stars
// and the cloud glow agree by construction (docs/sector-cloud-prototype.md §"Embedded
// stars"):
//   • count   = ∫ emission dV over the cube, normalised to a home reference, clamped.
//   • position = rejection-sample the cube, accept ∝ local emission.
//   • colour  = sampleRealisticStar — the true type census (mostly red/orange dwarfs,
//               accurate hue, luminosity-driven size), since these are resolved up close.
//   • ALL deterministic — mulberry32 seeded from the sector identity, never Math.random.
//
// FRAME: generation works in galactocentric PARSECS (the sector's authoritative
// frame). The density model wants galaxy-local native WU (Sgr A* origin, 1 kpc =
// KPC_TO_WU WU, disc in X-Z, +Y vertical) — and galactocentric pc maps there by a
// single scalar (PC_TO_NATIVE), no axis swap (solPc is already y-vertical; ε Eri's
// solPc.y = −2.392 == its true galactic Z). Output positions are sector-LOCAL WU
// (galPc − centre)·WU_PER_PC, ready to drop into sector.group.
// ═══════════════════════════════════════════════════════════════════

import {
  AdditiveBlending, BufferGeometry, Float32BufferAttribute, Points, ShaderMaterial, Vector3,
} from 'three';
import { KPC_TO_WU, WU_PER_PC } from '../../core/metrics';
import { armPattern, COL_HII, sampleGalaxy } from '../galaxy-density';
import { galacticStarsVertexShader, galacticStarsFragmentShader } from '../shaders/galactic-stars';
import { sampleArmStar, sampleRealisticStar } from '../stellar-population';
import { mulberry32, seedFrom } from '../../data/system-gen';
import { DEFAULT_SECTOR_EDGE_PC, type Sector } from './sector';
import { computeStarId, type EditContext } from './galaxy-edit';

/** parsec → galaxy-local native WU (the frame sampleGalaxy expects). 0.333. */
export const PC_TO_NATIVE = KPC_TO_WU / 1000;

/** Total emission radiance density (scalar) at a galactocentric-pc point. The
 *  unweighted RGB sum is the faithful scalar of what the disc volume integrates
 *  (the raymarch accumulates T·j·dt per channel) — so star count and cloud glow
 *  read the SAME field, the "agree by construction" guarantee (spec §Embedded stars).
 *  Exported so the region layer can classify a region's density from the same scalar. */
export function emissionAtGalPc(x: number, y: number, z: number): number {
  const s = sampleGalaxy(x * PC_TO_NATIVE, y * PC_TO_NATIVE, z * PC_TO_NATIVE);
  return s.j[0] + s.j[1] + s.j[2];
}

/** Emission at the solar-circle midplane — the count-normalisation reference, so a
 *  home-equivalent 250 pc sector targets REF_STARS and richer sectors scale up.
 *  Exported as the shared galactic-density reference (the region density class is emission/REF). */
export const REF_EMISSION = (() => {
  const s = sampleGalaxy(8.3 * KPC_TO_WU, 0, 0); // SOL_GAL_POS, native WU
  return s.j[0] + s.j[1] + s.j[2];
})();

// ── Arm-phase → stellar population (density-wave physics; region/LOD spiral READ) ──
// When ARM_AWARE_STARS, each accepted star's COLOUR/TYPE is biased by the spiral-arm crest it sits
// in — a pure function of its galactocentric position via the SHARED armPattern, so adjacent sectors
// agree at their seam by construction and the RNG stream (hence determinism) is untouched. Flip to
// false to fall back to the uniform census.
const ARM_AWARE_STARS = true;
// armPattern is already pow(cos, ARM_SHARP)·spiralInnerFade — a SHARP ridge, not a smooth cosine
// (most of the disc reads ~0, only narrow crests approach 1). Map it through a smoothstep band so
// 'crest' begins near where region.ts/classifyArmPhase calls it crest (≈0.5) and flanks get partial
// credit, rather than treating the whole disc as inter-arm.
const CREST_LO = 0.12;
const CREST_HI = 0.6;

function smoothstep01(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/** Crestiness ∈ [0,1] at a galactocentric (x,z) pc — how deep into a spiral-arm crest, for biasing
 *  the stellar population. The disc plane is X-Z; theta's scale factor cancels in atan2. */
function crestinessAtGalPc(xPc: number, zPc: number): number {
  const rNative = Math.hypot(xPc, zPc) * PC_TO_NATIVE;
  return smoothstep01((armPattern(rNative, Math.atan2(zPc, xPc)) - CREST_LO) / (CREST_HI - CREST_LO));
}

/** Arm phase at a galactocentric (x,z) pc — the raw ridge + the smoothstepped crestiness. Exported
 *  as a pure query hook for a future galaxy/star manipulation tool (preview what's at a point). */
export function armPhaseAt(xPc: number, zPc: number): { armRidge: number; crestiness: number } {
  const rNative = Math.hypot(xPc, zPc) * PC_TO_NATIVE;
  const armRidge = armPattern(rNative, Math.atan2(zPc, xPc));
  return { armRidge, crestiness: smoothstep01((armRidge - CREST_LO) / (CREST_HI - CREST_LO)) };
}

// HII REGIONS — pink/magenta emission knots (ionised gas around young OB clusters) sit on the arm
// crests just downstream of the dust lane. The strongest "this is a spiral" cue for the least code:
// on a strong crest, a small deterministic fraction of accepted stars become a COL_HII bead instead.
const HII_BEAD_CREST = 0.7;   // only the brightest crests host visible HII regions
const HII_BEAD_PROB = 0.006;  // ~1/160 of crest stars → a few beads per arm sector
const [HII_R, HII_G, HII_B] = COL_HII;

// DENSITY DIM — additive star sprites in a dense sector pile up and clamp to white, hiding the
// arm-phase colour. Dense sectors dim their additive output so N overlapping points sum to a natural
// coloured glow. ~1/√(emission ratio), clamped gentle; the solar circle and below never dim.
export function sectorDensityDim(emissionMean: number): number {
  const ratio = emissionMean / REF_EMISSION;
  return ratio <= 1 ? 1 : Math.max(0.4, 1 / Math.sqrt(ratio));
}

// Calibration (visual, not physical — real local density ≈ 0.1 star/pc³ would be
// millions of points). REF_STARS is the generated-star budget for a home-density 250 pc
// sector — kept SPARSE: the cloud is the unresolved-star aggregate, these are the ~few-%
// we resolve as Points (alongside the canonical curated/survey systems). STAR_BREACH = 1.0:
// stars tile EXACTLY to the cube (B4 seam fix). Each star belongs to exactly one cell, so
// adjacent streamed sectors don't double up at the shared face (a 1.15 breach overlapped them
// into a visible denser band). Density stays continuous across the seam because placement is
// ∝ the shared analytic emission, which is identical on both sides of the boundary.
const REF_STARS = 600;
const STAR_BREACH = 1.0;
const REF_EDGE_PC = 250;
const MIN_STARS = 120;
const MAX_STARS = 6000;
const N_PROBE = 4096; // Monte-Carlo samples for the emission integral / max
const ACCEPT_HEADROOM = 1.5; // emissionMax safety margin so rare peaks don't over-accept

export interface SectorStarData {
  /** sector-LOCAL WU, xyz triples. */
  readonly positions: Float32Array;
  /** linear RGB triples. */
  readonly colors: Float32Array;
  /** point sizes, px. */
  readonly sizes: Float32Array;
  /** per-star spiral-arm crestiness (0 gap … 1 crest) — for the debug overlay + the tool. */
  readonly crests: Float32Array;
  readonly count: number;
  /** mean emission over the cube (∫/V) — drives the count. */
  readonly emissionMean: number;
  readonly emissionMax: number;
}

/** Stable deterministic seed key for a sector (centre + edge). Millipc precision is
 *  far finer than any sector spacing (≥ edge pc apart), so distinct sectors never
 *  collide; the value is a pure function of the float64 centre, stable across reloads. */
export function sectorStarSeedKey(sector: Sector): string {
  const c = sector.centerPc;
  return `sector-stars:${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)}:${sector.edgePc}`;
}

/** Generate the sector's embedded stars (pure data; deterministic from the seed). `starCountCap`
 *  (the build-out overview path) clamps the placed count to a deterministic PREFIX — fewer stars,
 *  same seed stream, same arm colour — so a galaxy-wide fill stays in a viable point budget. */
export function generateSectorStars(sector: Sector, starCountCap?: number): SectorStarData {
  const rng = mulberry32(seedFrom(sectorStarSeedKey(sector)));
  const { centerPc, edgePc } = sector;
  const genEdge = edgePc * STAR_BREACH; // generation volume — slightly past the bounds

  // 1. Emission integral over the cube (Monte Carlo): mean + peak.
  let sum = 0;
  let emissionMax = 0;
  for (let i = 0; i < N_PROBE; i++) {
    const e = emissionAtGalPc(
      centerPc.x + (rng() - 0.5) * genEdge,
      centerPc.y + (rng() - 0.5) * genEdge,
      centerPc.z + (rng() - 0.5) * genEdge,
    );
    sum += e;
    if (e > emissionMax) emissionMax = e;
  }
  const emissionMean = sum / N_PROBE;
  emissionMax *= ACCEPT_HEADROOM;

  // 2. Count ∝ ∫ emission dV, normalised to the home reference, clamped.
  const edgeFactor = (edgePc / REF_EDGE_PC) ** 3;
  const rawCount = REF_STARS * (emissionMean / REF_EMISSION) * edgeFactor;
  let count = Math.max(MIN_STARS, Math.min(MAX_STARS, Math.round(rawCount)));
  if (starCountCap !== undefined) count = Math.min(count, starCountCap); // build-out overview budget

  // 3. Rejection-sample positions (accept ∝ emission) + IMF colour/size.
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const crests = new Float32Array(count);
  const invMax = emissionMax > 0 ? 1 / emissionMax : 0;
  // A void sector (≈ 0 emission everywhere — e.g. far off the disc plane) can't be
  // rejection-filled, so scatter the MIN-floor uniformly. Real in-disc sectors always
  // have emission and take the rejection path → count always equals the field length
  // (no silent under-fill); the guard below is then a pure never-trip safety net.
  const useUniform = emissionMax <= 0;
  let placed = 0;
  let guard = 0;
  const guardMax = count * 80 + 1000;
  while (placed < count && guard++ < guardMax) {
    const ox = (rng() - 0.5) * genEdge;
    const oy = (rng() - 0.5) * genEdge;
    const oz = (rng() - 0.5) * genEdge;
    if (!useUniform) {
      const e = emissionAtGalPc(centerPc.x + ox, centerPc.y + oy, centerPc.z + oz);
      if (rng() > e * invMax) continue; // accept ∝ emission/max
    }
    const i3 = placed * 3;
    positions[i3] = ox * WU_PER_PC;       // sector-local WU
    positions[i3 + 1] = oy * WU_PER_PC;
    positions[i3 + 2] = oz * WU_PER_PC;
    // Colour/type biased by the spiral-arm crest at THIS star's galactocentric position (density-wave
    // physics): blue young population on the arms, warm red dwarfs in the gaps, plus magenta HII beads
    // on the brightest crests. crestiness comes from position (not the RNG), so determinism holds.
    let crest = 0;
    let star: readonly [number, number, number, number];
    if (ARM_AWARE_STARS) {
      crest = crestinessAtGalPc(centerPc.x + ox, centerPc.z + oz);
      star = crest > HII_BEAD_CREST && rng() < HII_BEAD_PROB
        ? [HII_R, HII_G, HII_B, 1.5 + rng() * 1.0] // HII region — magenta star-forming knot
        : sampleArmStar(rng, crest);
    } else {
      star = sampleRealisticStar(rng);
    }
    colors[i3] = star[0]; colors[i3 + 1] = star[1]; colors[i3 + 2] = star[2];
    sizes[placed] = star[3];
    crests[placed] = crest;
    placed++;
  }

  // If the guard tripped (degenerate near-zero field), return the filled prefix.
  if (placed < count) {
    return {
      positions: positions.slice(0, placed * 3),
      colors: colors.slice(0, placed * 3),
      sizes: sizes.slice(0, placed),
      crests: crests.slice(0, placed),
      count: placed, emissionMean, emissionMax,
    };
  }
  return { positions, colors, sizes, crests, count, emissionMean, emissionMax };
}

/** Floor on a build-out cell's star count (so even faint rim cells render a few points). */
const MIN_BUILDOUT_STARS = 6;
/** Vertical scale height (pc) for placing build-out stars WITHIN a cell. The disc's emission falls off
 *  as ~exp(−|y|/H) (thin-disc dominated near the plane); placing stars by this profile instead of
 *  uniformly makes the 250 pc layers blend into a smooth disc rather than a banded box-staircase. */
/** Sub-slices for the per-cell vertical emission CDF (placement ∝ the real profile, see below). */
const BUILDOUT_VERTICAL_SLICES = 6;
/** Sub-cells per axis for the per-cell HORIZONTAL (x,z) emission CDF. Placing stars ∝ the real in-plane
 *  emission (instead of uniformly per 250 pc cell) makes the rendered density track the CONTINUOUS field
 *  — the per-cell normalization cancels — so adjacent cells blend and the 250 pc "grid" dissolves. The
 *  residual structure is the K-times-finer sub-cell (~41 pc at K=6), well below perceptible at galaxy zoom. */
const BUILDOUT_HORIZONTAL_SLICES = 6;

/** Build-out FAST path — generate a cell's stars from its ALREADY-KNOWN emission (the enumeration
 *  gate value), with NO full Monte-Carlo integral: count = REF_STARS · emission/REF capped, x,z placed
 *  uniformly, arm-phase coloured (+ HII beads). The VERTICAL position is sampled ∝ the cell's REAL
 *  emission profile (a tiny 6-sample CDF down the cell) — this is the key to a band-free disc: the
 *  model's vertical falloff varies (thin disc near the plane, thick + flared off-plane), so a single
 *  analytic scale height left residual horizontal banding; matching the real profile makes the 250 pc
 *  layers' densities meet continuously. Still ~seconds galaxy-wide (6 samples/cell, not 4096). The
 *  near-camera streaming keeps the full emission-weighted path. Deterministic from the cell centre. */
export function generateSectorStarsFast(
  centerPc: Vector3, emission: number, cap: number, edgePc = DEFAULT_SECTOR_EDGE_PC, edit?: EditContext,
): SectorStarData {
  const rng = mulberry32(seedFrom(
    `buildout:${centerPc.x.toFixed(1)},${centerPc.y.toFixed(1)},${centerPc.z.toFixed(1)}`));
  // Non-destructive paint edits (Phase 0 seam) — read only when this cell/region actually has edits,
  // so unedited cells (the overwhelming majority) take the identical fast path below. The base star
  // STREAM is generated unchanged regardless (same RNG draws); edits only transform the OUTPUT.
  const mod = edit ? edit.editState.modifiers.get(edit.cellKey) : undefined;
  const ovMap = edit ? edit.editState.overrides.get(edit.regionKey) : undefined;
  const densityFactor = mod ? mod.densityFactor : 1;
  // Painting denser must be able to grow a cell PAST its base point budget, else cells already at the
  // build-out cap (the bright bulge) wouldn't visibly respond. Scale the cap with densityFactor>1 so a
  // density-add stroke adds stars; at densityFactor===1 (every unedited cell) the cap is untouched, so
  // the fast path stays byte-identical.
  const effCap = densityFactor > 1 ? Math.round(cap * densityFactor) : cap;
  const count = Math.max(MIN_BUILDOUT_STARS,
    Math.min(effCap, Math.round(REF_STARS * (emission / REF_EMISSION) * densityFactor)));
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const crests = new Float32Array(count);
  // Vertical emission CDF for this cell: sample the REAL emission at a few heights down the cell and
  // accumulate, so stars place ∝ the actual vertical profile and adjacent layers meet the model
  // continuously (no horizontal banding edge-on).
  const NV = BUILDOUT_VERTICAL_SLICES;
  const yStep = edgePc / NV;
  const y0 = -edgePc * 0.5; // bottom of the cell, relative to centre
  const vcdf = new Float64Array(NV + 1);
  for (let s = 0; s < NV; s++) {
    vcdf[s + 1] = vcdf[s]! + Math.max(0, emissionAtGalPc(centerPc.x, centerPc.y + y0 + (s + 0.5) * yStep, centerPc.z));
  }
  const vTot = vcdf[NV]! || 1;
  // In-plane (x,z) emission CDF: a K×K grid of the REAL emission across the cell footprint, accumulated,
  // so stars place ∝ the continuous field (not uniformly per square) and the 250 pc grid dissolves.
  const NH = BUILDOUT_HORIZONTAL_SLICES;
  const hStep = edgePc / NH;
  const h0 = -edgePc * 0.5;
  const hcdf = new Float64Array(NH * NH + 1);
  for (let iz = 0; iz < NH; iz++) {
    for (let ix = 0; ix < NH; ix++) {
      const ex = centerPc.x + h0 + (ix + 0.5) * hStep;
      const ez = centerPc.z + h0 + (iz + 0.5) * hStep;
      hcdf[iz * NH + ix + 1] = hcdf[iz * NH + ix]! + Math.max(0, emissionAtGalPc(ex, centerPc.y, ez));
    }
  }
  const hTot = hcdf[NH * NH]! || 1;
  let placed = 0;
  for (let i = 0; i < count; i++) {
    // in-plane position from the 2D emission CDF: inverse lookup → sub-cell, then uniform jitter within it
    const uxz = rng() * hTot;
    let hs = 1;
    while (hs < NH * NH && hcdf[hs]! < uxz) hs++;
    const sub = hs - 1;
    const ox = h0 + ((sub % NH) + rng()) * hStep;
    const oz = h0 + (((sub / NH) | 0) + rng()) * hStep;
    // sample the height from the vertical emission CDF (inverse lookup + linear interp within a slice)
    const u = rng() * vTot;
    let vs = 1;
    while (vs < NV && vcdf[vs]! < u) vs++;
    const oy = y0 + (vs - 1 + (u - vcdf[vs - 1]!) / Math.max(vcdf[vs]! - vcdf[vs - 1]!, 1e-12)) * yStep;
    const crest = ARM_AWARE_STARS ? crestinessAtGalPc(centerPc.x + ox, centerPc.z + oz) : 0;
    const star: readonly [number, number, number, number] = ARM_AWARE_STARS
      ? (crest > HII_BEAD_CREST && rng() < HII_BEAD_PROB
          ? [HII_R, HII_G, HII_B, 1.5 + rng() * 1.0]
          : sampleArmStar(rng, crest))
      : sampleRealisticStar(rng);
    // Base position (sector-local WU) + paint edits. With no edits (mod/ovMap undefined) this is the
    // identity — same arrays, same indices — so the build-out/streaming output is byte-identical.
    let px = ox * WU_PER_PC, py = oy * WU_PER_PC, pz = oz * WU_PER_PC, br = 1;
    if (ovMap) {
      const ov = ovMap.get(computeStarId(edit!.cellKey, i));
      if (ov) {
        if (ov.position === null) continue; // deleted star — omit
        if (ov.position) {
          px = (ov.position[0] - centerPc.x) * WU_PER_PC;
          py = (ov.position[1] - centerPc.y) * WU_PER_PC;
          pz = (ov.position[2] - centerPc.z) * WU_PER_PC;
        }
        if (ov.brightness !== undefined) br = ov.brightness;
      }
    }
    if (mod) {
      px += mod.displacementPc[0] * WU_PER_PC;
      py += mod.displacementPc[1] * WU_PER_PC;
      pz += mod.displacementPc[2] * WU_PER_PC;
    }
    const i3 = placed * 3;
    positions[i3] = px; positions[i3 + 1] = py; positions[i3 + 2] = pz;
    colors[i3] = star[0] * br; colors[i3 + 1] = star[1] * br; colors[i3 + 2] = star[2] * br;
    sizes[placed] = star[3];
    crests[placed] = crest;
    placed++;
  }
  if (placed < count) {
    return {
      positions: positions.slice(0, placed * 3),
      colors: colors.slice(0, placed * 3),
      sizes: sizes.slice(0, placed),
      crests: crests.slice(0, placed),
      count: placed, emissionMean: emission, emissionMax: emission,
    };
  }
  return { positions, colors, sizes, crests, count, emissionMean: emission, emissionMax: emission };
}

/** Default screen-space size multiplier for sector stars (tunable). */
export const SECTOR_STAR_SIZE_SCALE = 1.0;

/** Shared arm-phase DEBUG uniform — ALL sector star materials reference this one object, so
 *  setArmDebug() toggles every field (current + future) at once. 0 = normal, 1 = recolour by phase. */
export const armDebugUniform = { value: 0 };

/** Toggle the arm-phase debug recolour across every sector star field. */
export function setArmDebug(on: boolean): void {
  armDebugUniform.value = on ? 1 : 0;
}

export interface SectorStarField {
  readonly points: Points;
  readonly material: ShaderMaterial;
  readonly data: SectorStarData;
}

/** Build the renderable star field (Points) for a sector, authored sector-LOCAL.
 *  Reuses the galactic-stars additive point shader. Add .points to sector.group. */
export function buildSectorStarField(sector: Sector): SectorStarField {
  const data = generateSectorStars(sector);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(data.colors, 3));
  geo.setAttribute('aSize', new Float32BufferAttribute(data.sizes, 1));
  geo.setAttribute('aCrest', new Float32BufferAttribute(data.crests, 1));
  const material = new ShaderMaterial({
    vertexShader: galacticStarsVertexShader,
    fragmentShader: galacticStarsFragmentShader,
    uniforms: {
      uSizeScale: { value: SECTOR_STAR_SIZE_SCALE },
      uPixelRatio: { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1 },
      uCamVelocity: { value: new Vector3() },
      uStreakStrength: { value: 0.0 },
      uMaxStretch: { value: 0.4 },
      uDensityDim: { value: sectorDensityDim(data.emissionMean) }, // tame additive overdraw in dense sectors
      uArmDebug: armDebugUniform, // shared — setArmDebug() recolours every field by arm phase
      uDepthLODRef: { value: 0.0 }, // near-camera streaming keeps constant point size
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geo, material);
  points.name = 'sector-stars';
  points.renderOrder = 0; // before the cloud (3): the cloud's premultiplied alpha then occludes dust-shadowed Points
  // Disable culling: the group's world AABB moves every frame (updateSectorFrame
  // re-roots it to the floating-origin residual), so a cached frustum AABB would be
  // stale. Relies on the group being re-rooted before each render (it is, in main.ts).
  points.frustumCulled = false;
  return { points, material, data };
}

/** Dispose a star field's GPU resources (geometry + material). Call when its sector unloads. */
export function disposeSectorStarField(field: SectorStarField): void {
  field.points.geometry.dispose();
  field.material.dispose();
}
