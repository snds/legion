// ═══════════════════════════════════════════════════════════════════
// CONTINUUM CATALOGUE ADAPTER (P2-1 engine consolidation)
//
// Bridges the curated catalogue's `PlanetConfig` (a hand-authored name/size/
// PlanetType record — the shape SOL_PLANETS/EPS_ERI_PLANETS use, see
// core/world.ts) to `GenPlanet` (the seed+physical-record shape ContinuumGlobe
// and the generators/presets pipeline actually consume, see
// data/system-gen.ts). Nothing here is Sol/EE-specific: any catalogue body
// with `renderEngine: 'continuum'` set on its PlanetConfig routes through
// this adapter, regardless of which system it belongs to.
//
// The curated catalogue predates GenPlanet/presets.ts entirely (it was built
// for the legacy `objects.ts` pipeline, which needs none of this — see Audit
// A1), so it carries no seed, insolation, or radiusEarth. This adapter
// derives reasonable, DETERMINISTIC stand-ins from the fields the catalogue
// does have, the same way planet-scale.ts's REP_R_EARTH table already stands
// in a representative radius per legacy PlanetType where the catalogue has
// no real one.
// ═══════════════════════════════════════════════════════════════════

import type { Object3D } from 'three';
import type { MoonConfig, PlanetConfig } from '../core/world';
import { PlanetType } from '../core/components';
import { computeInsolation, type GenPlanet, type PlanetKind, type PlanetVisualType } from '../data/system-gen';
import { ContinuumGlobe } from './planet/continuum';
import { planetTypeRepRadiusEarth, MOON_REP_R_EARTH } from './planet-scale';

const VISUAL_TYPE_BY_ENUM: Readonly<Record<number, PlanetVisualType>> = {
  [PlanetType.Rocky]: 'rocky',
  [PlanetType.Oceanic]: 'ocean',
  [PlanetType.Desert]: 'desert',
  [PlanetType.GasGiant]: 'gas',
  [PlanetType.IceGiant]: 'ice',
  [PlanetType.Dwarf]: 'rocky',
};

const KIND_BY_ENUM: Readonly<Record<number, PlanetKind>> = {
  [PlanetType.Rocky]: 'rocky',
  [PlanetType.Oceanic]: 'rocky',
  [PlanetType.Desert]: 'rocky',
  [PlanetType.GasGiant]: 'gas-giant',
  [PlanetType.IceGiant]: 'ice-giant',
  [PlanetType.Dwarf]: 'dwarf',
};

/**
 * P2-23 — real-authored-colour ramp override, keyed by catalogue body name
 * (GenPlanet.rampOverride's doc comment has the full root-cause writeup).
 * Root-caused (real-boot verified, not guessed) that the generic 'rocky'
 * archetype ramp — correctly tuned for grey/tan cratered worlds like
 * Mercury — reads as washed-out pale for Mars once run through Continuum's
 * exposure/tonemap pipeline, because nothing in the Continuum path ever
 * consumes the catalogue's own authored per-body colour (0xc1440e for
 * Mars) the way the legacy pipeline does. Empty for every other body —
 * `rampOverride` stays `undefined` and every other body's ramp is
 * byte-identical to before this map existed.
 */
const MARS_RAMP_OVERRIDE_BY_NAME: Readonly<Record<string, readonly { readonly at: number; readonly color: readonly [number, number, number] }[]>> = {
  Mars: [
    { at: 0.0, color: [0.26, 0.03, 0.015] },
    { at: 0.45, color: [0.55, 0.09, 0.03] },
    { at: 0.75, color: [0.48, 0.11, 0.05] },
    { at: 1.0, color: [0.70, 0.22, 0.09] },
  ],
};

/** Stable 32-bit FNV-1a hash — deterministic per-body seed from its
 *  catalogue name/designation, so a re-boot generates the identical planet
 *  every time (same contract GenPlanet.seed already requires elsewhere). */
function stableSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Builds a GenPlanet record from a curated catalogue PlanetConfig. Only the
 * fields the render pipeline (presets.ts/generators/) actually reads are
 * meaningful (type, seed, isGasGiant, hasRings, insolation, radiusEarth,
 * kind, massEarth, inHZ, hasAtmosphere — see presets.ts derivePlanetParams);
 * `au` is unused by rendering and kept only for type-shape.
 *
 * P2-12: `hasAtmosphere` carries the catalogue's own authored fact straight
 * through, so presets.ts's retainsAtmosphere() radius/density heuristic
 * (tuned for procedurally-generated bodies with no authored answer) cannot
 * override an explicitly airless catalogue body — Mercury and Vulcan both
 * clear that heuristic's floor on their rep-radius stand-ins despite being
 * authored `hasAtmosphere: false`, which without this field would silently
 * render both with an atmosphere shell + clouds the moment they're routed.
 *
 * P2-2: `massEarth`/`inHZ` used to be hardcoded stand-ins (`1` / `false`) —
 * harmless while derivePlanetParams() never read mass or kind, but now that
 * it derives a real density scalar and a per-body systemic state from them,
 * a flat `massEarth: 1` against a rep-radius-11 gas giant (Saturn) would
 * silently corrupt its look (density ≈ massEarth/radiusEarth³ ≈ 1/1331, a
 * physically absurd value) the moment it reached the real system-loader.ts
 * boot path — exactly the "works in ?lab=planet, breaks in the real boot"
 * gap this task was warned about. Both are now derived from data the
 * catalogue already carries:
 *   massEarth = gravity (relative to Earth's g) × radiusEarth² — the real
 *     surface-gravity relation (g ∝ M/R²), so it reduces to the catalogue's
 *     own per-body `gravity` field instead of a constant.
 *   inHZ = the body's own VISUAL_TYPE_BY_ENUM bucket is 'ocean' — the
 *     curated catalogue's only signal for "this body is meant to read as
 *     habitable" (it never carries insolation/HZ math of its own).
 *
 * P2-20: `insolation` used to be hardcoded `1` for every body regardless of
 * its real semi-major axis — harmless for gating (nothing read it before
 * P2-2) but wrong the moment `derivePlanetParams` started using it to drive
 * warmth (Mercury reading exactly as warm as Neptune). Now computed from the
 * body's own `pCfg.sma` and its parent star's real luminosity (passed in by
 * the caller — system-loader.ts knows which star it's building), via the
 * SAME `computeInsolation` formula the procedural generator uses. `axialTilt`
 * is threaded straight through from the catalogue's own authored field (was
 * silently dropped before — GenPlanet had no such field at all).
 */
export function genPlanetFromCatalog(pCfg: PlanetConfig, starLuminositySolar: number): GenPlanet {
  const isGasGiant = pCfg.planetType === PlanetType.GasGiant || pCfg.planetType === PlanetType.IceGiant;
  const type = VISUAL_TYPE_BY_ENUM[pCfg.planetType] ?? 'rocky';
  const radiusEarth = planetTypeRepRadiusEarth(pCfg.planetType);
  return {
    kind: KIND_BY_ENUM[pCfg.planetType] ?? 'rocky',
    au: pCfg.sma,
    inHZ: type === 'ocean',
    type,
    massEarth: +(Math.max(0, pCfg.gravity) * radiusEarth * radiusEarth).toPrecision(3),
    radiusEarth,
    insolation: computeInsolation(starLuminositySolar, pCfg.sma),
    isGasGiant,
    hasRings: !!pCfg.ringTexturePath,
    seed: stableSeed(`${pCfg.designation}:${pCfg.name}`),
    hasAtmosphere: pCfg.hasAtmosphere,
    axialTilt: pCfg.axialTilt,
    rampOverride: MARS_RAMP_OVERRIDE_BY_NAME[pCfg.name],
  };
}

/**
 * Continuum-backed replacement for objects.ts's createPlanetMesh, for a
 * catalogue body opted into the new engine via `renderEngine: 'continuum'`.
 * Returns the mountable Object3D (ContinuumGlobe.root — already carries
 * `userData.bodyRadius` for camera focus/approach framing, same contract
 * createPlanetMesh's Group provides) plus the ContinuumGlobe instance itself
 * so the caller can register it for per-frame updates and dispose it later.
 */
export function createContinuumPlanetMesh(
  pCfg: PlanetConfig,
  starLuminositySolar: number,
): { object: Object3D; globe: ContinuumGlobe } {
  const genPlanet = genPlanetFromCatalog(pCfg, starLuminositySolar);
  const globe = new ContinuumGlobe(genPlanet, pCfg.size);
  globe.root.name = `planet-${pCfg.name}`;
  globe.root.userData.name = pCfg.name;
  globe.root.userData.hasAtmosphere = pCfg.hasAtmosphere;
  globe.root.userData.planetTypeId = pCfg.planetType;
  // P2-21: ContinuumGlobe's constructor tags its own root
  // `userData.type = 'planet-globe'` — a Lab/approach-demo clean-room marker
  // (main.ts), not the entity-selection vocabulary `ui/raycast.ts` walks the
  // scene graph for. Override it here, in the real-game adapter only, so
  // hover/click/tooltip/inspector treat a routed planet exactly like a
  // legacy `createPlanetMesh` group (TYPE_ICONS, selection.ts's PROFILE
  // section, the orbit-hover-highlight gate, and `warpZoomForType` all
  // switch on `'planet'`).
  globe.root.userData.type = 'planet';
  return { object: globe.root, globe };
}

// ═══════════════════════════════════════════════════════════════════
// MOON ADAPTER (P2-18 moon-routing) — mirrors the planet adapter above for
// `MoonConfig`, the curated catalogue's moon shape (star-catalog.ts's
// SOL_MOONS/EPS_ERI_MOONS). `MoonConfig` is even thinner than `PlanetConfig`:
// no `planetType`, `gravity`, or `hasAtmosphere` — it was built for the
// legacy `objects.ts` createMoonMesh path, which needs none of them. Any
// catalogue moon with `renderEngine: 'continuum'` set routes through this
// adapter, regardless of system or parent — no per-body name special-casing.
// ═══════════════════════════════════════════════════════════════════

/** Dwarf-band mass-radius exponent (system-gen.ts's PLANET_SIZE.dwarf.mExp,
 *  not exported — duplicated here as a documented constant, not re-derived
 *  differently). Used as the stand-in for a moon's missing mass data, the
 *  same power law derivePlanetPhysical() already applies to any
 *  procedurally-generated dwarf body lacking real archive mass/radius. */
const DWARF_MASS_RADIUS_EXP = 3.7;

/**
 * Builds a GenPlanet record from a curated catalogue MoonConfig. Every
 * catalogue moon shares one deterministic physical stand-in (no per-moon
 * scaling from the authored `size` field — same precedent as the planet
 * adapter, where `size` is a pure visual/authoring radius, decoupled from
 * `radiusEarth`):
 *   kind: 'dwarf', type: 'rocky' — matches P2-17's own synthetic-test-moon
 *     assumption (no dedicated moon PlanetVisualType exists or is needed).
 *   radiusEarth: MOON_REP_R_EARTH (planet-scale.ts's existing "Luna-class
 *     stand-in for moons — no per-moon radius in the curated data").
 *   massEarth: radiusEarth ^ DWARF_MASS_RADIUS_EXP — MoonConfig carries no
 *     `gravity` field (unlike PlanetConfig) to derive a real value from, so
 *     this reuses system-gen.ts's own dwarf mass-radius power law instead of
 *     a flat/invented constant (the same physically-reasonable stand-in the
 *     generator already uses for any dwarf lacking real archive data).
 *   hasAtmosphere: false — explicit (belt-and-suspenders with the `kind:
 *     'dwarf'` heuristic in presets.ts's retainsAtmosphere()) so no moon
 *     picks up an atmosphere/cloud shell from the radius/density heuristic;
 *     matches legacy moons, which never modeled one either.
 *   au: mCfg.sma — unused by rendering (same as the planet adapter's `au`),
 *     kept only for type-shape.
 *
 * P2-20: `insolation` used to be hardcoded `1`. A moon's own `sma` is a
 * parent-local orbital radius, not a stellar distance, so it has no
 * independent insolation to compute — it inherits its PARENT PLANET's
 * already-computed real insolation instead (the caller looks that up and
 * passes it in; a moon orbits close enough to its parent that the parent's
 * stellar distance is the physically meaningful one). No `axialTilt` is set
 * here — `MoonConfig` carries no authored tilt field (unlike `PlanetConfig`),
 * so moons keep ContinuumGlobe's RNG-derived cosmetic lean, unchanged.
 */
export function genPlanetFromMoonCatalog(mCfg: MoonConfig, parentInsolation: number): GenPlanet {
  const radiusEarth = MOON_REP_R_EARTH;
  return {
    kind: 'dwarf',
    au: mCfg.sma,
    inHZ: false,
    type: 'rocky',
    massEarth: +(radiusEarth ** DWARF_MASS_RADIUS_EXP).toPrecision(3),
    radiusEarth,
    insolation: parentInsolation,
    isGasGiant: false,
    hasRings: false,
    seed: stableSeed(`${mCfg.parentName}:${mCfg.name}`),
    hasAtmosphere: false,
  };
}

/**
 * Continuum-backed replacement for objects.ts's createMoonMesh, for a
 * catalogue moon opted into the new engine via `renderEngine: 'continuum'`.
 * Builds ContinuumGlobe in `isMoon` mode (P2-17 — airless terminator, no
 * clouds/atmosphere/rings). Real per-frame parent-body planetshine is driven
 * separately, every frame, by `continuum/registry.ts` (this function does not
 * set it — a globe has no visibility into sibling bodies at construction
 * time, same reason the legacy bounce computation lives in a free function).
 */
export function createContinuumMoonMesh(
  mCfg: MoonConfig,
  parentInsolation: number,
): { object: Object3D; globe: ContinuumGlobe } {
  const genPlanet = genPlanetFromMoonCatalog(mCfg, parentInsolation);
  const globe = new ContinuumGlobe(genPlanet, mCfg.size, { isMoon: true });
  globe.root.name = `moon-${mCfg.name}`;
  globe.root.userData.name = mCfg.name;
  // P2-21: same fix as the planet adapter above — override the ContinuumGlobe
  // constructor's Lab/demo `'planet-globe'` marker with the real-game
  // entity-selection vocabulary (`'moon'`) so raycast/tooltip/inspector treat
  // a routed moon exactly like a legacy `createMoonMesh` group.
  globe.root.userData.type = 'moon';
  return { object: globe.root, globe };
}
