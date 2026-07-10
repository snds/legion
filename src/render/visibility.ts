// ═══════════════════════════════════════════════════════════════════
// LAYER VISIBILITY — Per-Zoom-Tier Visibility Management
// Controls which layer groups and scene objects are visible based
// on the current zoom domain. Matches the monolithic prototype's
// per-frame visibility update across all 6 tiers.
//
// Simplified from the monolithic's fine-grained per-object fading
// to group-level visibility, which covers the visual parity goal.
// Per-object fading and icon system are deferred to optimization.
// ═══════════════════════════════════════════════════════════════════

import { Game, type DomainName, getCamDist } from '../core/state';
import { Events } from '../core/events';
import { Notifications } from '../ui/notifications';
import type { LayerGroups } from './scene';
import { Vector3 } from 'three';
import type {
  Group, Points, PointsMaterial, Sprite, SpriteMaterial, Camera, Object3D,
  Material, Mesh, MeshBasicMaterial,
} from 'three';
import { HELIOPAUSE_RADIUS_WU } from './particles';
import {
  updateBodyLOD, iconBiasFor, scaleFixed, setLocalIconTierFade,
} from './icon-system';

// Heliopause icon-set hand-off ramp: 0 below 1800 WU (local body icons full,
// regional star-system markers hidden) → 1 above 3200 WU (local icons gone,
// regional markers full). Spans the heliopause band into early sector so the
// solar-system icons cross-fade into the star-system markers as one motion.
const SWAP_IN = 1800;
const SWAP_OUT = 3200;
const REGIONAL_ICON_PX = 24; // screen-constant marker size (docs §4.6)
function heliopauseSwap(camDist: number): number {
  return smooth01(camDist, SWAP_IN, SWAP_OUT);
}

// 0→1 smoothstep of camDist across [lo, hi] — the shared ramp primitive for
// every zoom-seam crossfade below. Pure function of camDist: deterministic,
// per-frame cheap, no per-domain state.
function smooth01(x: number, lo: number, hi: number): number {
  if (x <= lo) return 0;
  if (x >= hi) return 1;
  const t = (x - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
}

// ── Continuous background-star fade ──────────────────────────────
// The sky-shell starfield used to step to a new opacity at every domain flip
// (0.85 / 0.7 / 0.5 / 0.2 / 0.08) — a visible pop at each boundary. Replaced
// by one continuous curve: smoothstep between the SAME anchor levels, placed
// in log10(camDist) so each hand-off spans its zoom seam evenly.
const BG_ANCHOR_DIST = [2e3, 1e4, 1e5, 2e6, 2e7]; // WU
const BG_ANCHOR_OP = [0.85, 0.70, 0.50, 0.20, 0.08];
export function backgroundStarOpacity(camDist: number): number {
  const lx = Math.log10(Math.max(camDist, 1));
  if (lx <= Math.log10(BG_ANCHOR_DIST[0])) return BG_ANCHOR_OP[0];
  for (let i = 0; i < BG_ANCHOR_DIST.length - 1; i++) {
    const l0 = Math.log10(BG_ANCHOR_DIST[i]);
    const l1 = Math.log10(BG_ANCHOR_DIST[i + 1]);
    if (lx <= l1) {
      const t = (lx - l0) / (l1 - l0);
      const s = t * t * (3 - 2 * t);
      return BG_ANCHOR_OP[i] + (BG_ANCHOR_OP[i + 1] - BG_ANCHOR_OP[i]) * s;
    }
  }
  return BG_ANCHOR_OP[BG_ANCHOR_OP.length - 1];
}

// ── Sector-orb presence ──────────────────────────────────────────
// The sensor bubble used to hard-flip with the 'sector' domain. Now a pure
// camDist curve: fade IN 6e3→1.2e4 WU (the camera exiting the ~5,860 WU orb)
// × fade OUT 1.5e5→5e5 WU (the neighbourhood dissolving into the arm tier).
function orbPresence(camDist: number): number {
  return smooth01(camDist, 6e3, 1.2e4) * (1 - smooth01(camDist, 1.5e5, 5e5));
}

// ── Extra Scene References ───────────────────────────────────────
// Set during init — these are groups outside the standard layers
// that need per-tier visibility control.

interface VisibilityTargets {
  layers: LayerGroups;
  eclipticGrid: Group | null;
  oortCloud: Group | null;
  galaxyArms: Group | null;
  sectorOrb: Group | null;
  /** Catalog star layer (catalog-systems.ts) — per-frame presence of both
   *  frames: the regional chart (setOpacity) and the galactic-frame highlight
   *  particles embedded in the disc (setGalacticOpacity). */
  catalogSystems: { setOpacity(v: number): void; setGalacticOpacity(v: number): void } | null;
  /** Progressive LOD star shells (star-shells.ts) — own their per-shell
   *  crossfade bands; visibility just feeds them camDist. */
  starShells: { updatePresence(camDist: number): void } | null;
}

let targets: VisibilityTargets | null = null;
let lastDomain: DomainName | null = null;

// ── Visibility Rules Per Domain ───────────────────────────────────

function applyDomain(domain: DomainName): void {
  if (!targets) return;
  const { layers, eclipticGrid, oortCloud, galaxyArms } = targets;

  // Asteroid belt is a band inside the local layer. It only reads as
  // meaningful content when the system disc is the subject — surface/
  // low-orbit close-up shots get a distracting horizontal stripe at the
  // top of the frame, so hide it there too.
  const belt = layers.local.getObjectByName('asteroid-belt');
  if (belt) {
    belt.visible =
      domain === 'orbit' || domain === 'inner-system' || domain === 'outer-system';
  }

  // Defaults: everything off, then selectively enable. (The sector orb is NOT
  // domain-gated any more — updateVisibility drives it per frame from the pure
  // orbPresence(camDist) curve, so it fades across the seams instead of popping.)
  layers.local.visible = false;
  layers.regional.visible = false;
  layers.galactic.visible = false;
  if (eclipticGrid) eclipticGrid.visible = false;
  if (oortCloud) oortCloud.visible = false;
  if (galaxyArms) galaxyArms.visible = false;

  // Background always visible; its opacity is a continuous per-frame curve
  // (backgroundStarOpacity), no longer stepped per domain.
  layers.background.visible = true;

  switch (domain) {
    case 'surface':
    case 'low-orbit':
      // Planet-scale views: local layer only, no overlays/grids.
      // Background starfield stays full so the sky reads correctly.
      layers.local.visible = true;
      break;

    case 'orbit':
      // Out past the first moon — show local objects (stations, ships,
      // moons) but no ecliptic grid yet (it's distracting at this scale).
      layers.local.visible = true;
      break;

    case 'inner-system':
      // Star + inner planets + their full orbital paths. Ecliptic grid
      // is meaningful here for orientation across multiple orbits.
      layers.local.visible = true;
      if (eclipticGrid) eclipticGrid.visible = true;
      break;

    case 'outer-system':
      // Everything in the system — primary planets, comets, Oort cloud.
      layers.local.visible = true;
      if (eclipticGrid) eclipticGrid.visible = true;
      if (oortCloud) oortCloud.visible = true;
      break;

    case 'heliopause':
      // System bubble + the 2-3 nearest navigable neighbors. Both local
      // and regional shown; per-marker proximity ramping handled below.
      layers.local.visible = true;
      layers.regional.visible = true;
      if (oortCloud) oortCloud.visible = true;
      break;

    case 'sector':
      // ~10-12 nearby systems within the local arm patch + tactical
      // sensor bubble (volumetric orb) showing the sector boundary.
      // Galaxy disc is ALSO enabled here — its opacity is ramped from
      // 0 → 1 across the sector→arm range by updateGalaxyLOD() so the
      // disc fades into view smoothly as we zoom out, rather than
      // popping on at the arm tier boundary.
      layers.local.visible = true;
      layers.regional.visible = true;
      if (galaxyArms) galaxyArms.visible = true;
      break;

    case 'arm':
      // Immersed inside the Orion Spur — galactic particles dominate
      // the field of view, regional system markers float as nav targets.
      // Force a near-in-plane camera angle so the disc surrounds us
      // (galaxy tier left phi at 0.35 = top-down; arm wants horizon-level).
      layers.regional.visible = true;
      layers.galactic.visible = true;
      if (galaxyArms) galaxyArms.visible = true;
      Game.data.targetPhi = 1.3;
      break;

    case 'galaxy': {
      // Full Milky Way disc. The camera KEEPS its current focus (the system you
      // were in) — it does NOT snap to the galaxy centre, so zooming out leaves
      // you anchored to your own system in the spur (the centre/bulge sits off to
      // one side, which is astronomically truthful). Only an explicit selection
      // re-targets the camera. We still tilt to a near-top-down polar angle
      // (phi ≈ 0.35) so the paper-thin disc doesn't collapse to an edge-on line.
      layers.galactic.visible = true;
      if (galaxyArms) galaxyArms.visible = true;
      Game.data.targetPhi = 0.35;
      break;
    }
  }
}

/** Fade background stars at outer zoom tiers — driven per frame from the
 *  continuous backgroundStarOpacity curve (the traverse is 2-3 children, so
 *  per-frame cost is negligible). (The legacy 'milky-way' band was deleted in
 *  the same commit as the baked-cubemap backdrop; the second parameter is
 *  kept so the signature survives until a wider cleanup.) */
function setBackgroundOpacity(starsOp: number, _milkyOp: number): void {
  if (!targets) return;
  targets.layers.background.traverse(child => {
    if ((child as Points).isPoints && (child as Points).material) {
      const mat = (child as Points).material as PointsMaterial & {
        uniforms?: { uOpacity?: { value: number } };
      };
      if (child.name === 'background-stars') {
        // The real-sky field is a ShaderMaterial (uOpacity uniform); the
        // fallback path keeps PointsMaterial.opacity for any other field.
        if (mat.uniforms?.uOpacity) mat.uniforms.uOpacity.value = starsOp;
        else mat.opacity = starsOp;
      }
    }
  });
}

// ── Strategic Overlay ────────────────────────────────────────────
// G key toggle — shows ecliptic grid + distance aids at system/helio.

function applyOverlay(overlayOn: boolean, domain: DomainName): void {
  if (!targets) return;
  const { eclipticGrid } = targets;

  // Overlay (G key) is meaningful at the orbit / inner-system / outer-system
  // / heliopause tiers — anywhere the player is reasoning about orbital paths.
  const isRelevant =
    domain === 'orbit' || domain === 'inner-system' ||
    domain === 'outer-system' || domain === 'heliopause';

  if (eclipticGrid && isRelevant) {
    // outer-system always shows grid; others rely on G toggle
    eclipticGrid.visible = overlayOn || domain === 'outer-system' || domain === 'inner-system';
  }
}

// ── Public API ───────────────────────────────────────────────────

export function initVisibility(
  layers: LayerGroups,
  eclipticGrid: Group | null,
  oortCloud: Group | null,
  galaxyArms: Group | null,
  sectorOrb: Group | null = null,
  catalogSystems: { setOpacity(v: number): void; setGalacticOpacity(v: number): void } | null = null,
  starShells: { updatePresence(camDist: number): void } | null = null,
): void {
  targets = { layers, eclipticGrid, oortCloud, galaxyArms, sectorOrb, catalogSystems, starShells };
  lastDomain = null;

  // Wire overlay toggle notification
  Events.on('camera:zoom-changed', () => {
    // Domain changed — will be picked up on next updateVisibility()
  });
}

/**
 * Called each frame. Checks if domain changed and applies visibility.
 * Also applies overlay state and per-object icon scaling.
 */
export function updateVisibility(camera?: Camera): void {
  const domain = Game.data.zoomDomain;
  const overlayOn = Game.data.overlayMode;

  if (domain !== lastDomain) {
    // The galaxy tier no longer snaps the focus to Sgr A* (it stays on the
    // current system), so the pre-overview focus save/restore that compensated
    // for that snap is gone too — focus only changes on explicit selection.
    lastDomain = domain;
    applyDomain(domain);
  }

  applyOverlay(overlayOn, domain);

  const camDist = Game.data.camDist;

  // Background starfield: one continuous curve over camDist, replacing the
  // per-domain opacity steps — no pop at any tier boundary.
  setBackgroundOpacity(backgroundStarOpacity(camDist), 0);

  // Sector orb: pure camDist presence curve (fade in leaving the bubble, fade
  // out dissolving into the arm), replacing the per-domain hard flip.
  updateSectorOrbPresence(camDist);

  // Heliopause orb is external-facing ONLY: show it once the camera is outside
  // the shell (camDist ≥ radius). Inside the shell a translucent sphere wall
  // fills the viewport and tints the whole interior, so it must stay hidden
  // until the player has zoomed out past it.
  updateHeliopauseGate();

  // Heliopause icon-set hand-off: fade local body icons OUT and the regional
  // star-system markers IN across the same camDist window, as one cross-fade.
  const swap = heliopauseSwap(camDist);
  setLocalIconTierFade(1 - swap);

  // Catalog star layer (the 3,066 real HYG systems): present at EVERY tier,
  // as TWO representations of the same data crossfading through the zoom.
  // REGIONAL chart: a subtle 0.15 floor at system scales (never hard-vanishes),
  // full with the heliopause swap, dissolving across 2e6→1.2e7 WU. GALACTIC
  // highlight particles (embedded in the generative disc's frame): fade in
  // across the same band the chart dissolves through, and stay lit at arm +
  // galaxy framing — the space-agency stars persist at every zoom level.
  // 0.9 is the layers' base uOpacity.
  const galaxyDissolve = 1 - smooth01(camDist, 2e6, 1.2e7);
  // LOCAL EASE: once the camera is well past the 25-pc survey ball itself
  // (~140 ly out), the chart dims toward the shells' level instead of
  // persisting at full — the dense "inner sphere" stops out-shining the
  // surrounding tiers while staying readable as the survey layer.
  const localEase = 1 - 0.55 * smooth01(camDist, 3e4, 1.2e5);
  targets?.catalogSystems?.setOpacity(0.9 * Math.max(0.15, swap * localEase) * galaxyDissolve);
  targets?.catalogSystems?.setGalacticOpacity(0.9 * smooth01(camDist, 2e6, 8e6));

  // Progressive star shells: each annulus fades in at its scale and out past
  // it — the "spheres of stars" ladder from the survey sphere to the disc.
  targets?.starShells?.updatePresence(camDist);

  // Galactic-plane UI (sector rings + quadrant spokes): rise with the disc
  // across the sector→arm pull-back instead of popping in on the domain flip.
  updateSectorGridPresence(camDist);

  // Per-object icon/mesh state — runs every frame for smooth transitions
  updateIconStates(domain);

  // Regional star-system markers (incl. Sol): screen-constant size + fade-in.
  // Runs whenever the regional layer is visible (heliopause → arm), independent
  // of the local layer (which is off at arm tier).
  updateRegionalMarkers(camDist, swap, camera);

  // Label DECLUTTER: after the show-logic has set each label's wants-state,
  // prune overlapping labels in screen space so the local map stays readable
  // where bodies cluster (higher-priority — selected / home / nearer — wins).
  if (camera) declutterLabels(camera);
}

const _mkPos = new Vector3();
function updateRegionalMarkers(camDist: number, swap: number, camera?: Camera): void {
  if (!targets) return;
  const regional = targets.layers.regional;
  if (!regional.visible) return;
  const show = swap > 0.005;
  for (const marker of regional.children) {
    if (!marker.userData?.isRegionalMarker) continue;
    marker.visible = show;
    if (!show) continue;
    // Screen-constant sizing must use the TRUE camera→marker distance — markers
    // are spread far from the focus, so the global camDist would balloon near
    // ones and shrink far ones.
    marker.getWorldPosition(_mkPos);
    const dist = camera ? camera.position.distanceTo(_mkPos) : camDist;
    marker.traverse(c => {
      if (c.userData?.isIcon) {
        const sp = c as Sprite;
        scaleFixed(sp, dist, REGIONAL_ICON_PX);
        (sp.material as SpriteMaterial).opacity = swap * 0.95;
      } else if (c.userData?.isLabel) {
        // Name + sublabel ride with the marker; fade in/out with the swap.
        // .visible is the per-frame "wants" state the declutter pass reads.
        (c as Sprite).visible = swap > 0.05;
        ((c as Sprite).material as SpriteMaterial).opacity = swap;
      } else if (c.userData?.isStemPart) {
        // Out-of-plane stem line — fade in with the markers, kept dim.
        ((c as unknown as { material: { opacity: number } }).material).opacity = swap * 0.4;
      }
    });
  }
}

// ── Sector-orb presence (per frame) ──────────────────────────────
// Scales every orb material's opacity by orbPresence(camDist): the two fresnel
// shells carry a uOpacity uniform; the wireframe cardinals ride a plain
// LineBasicMaterial opacity. Base values are cached on the material's userData
// on first touch so the curve always scales from the authored look.

function updateSectorOrbPresence(camDist: number): void {
  const orb = targets?.sectorOrb;
  if (!orb) return;
  const presence = orbPresence(camDist);
  orb.visible = presence > 0.002;
  if (!orb.visible) return;
  orb.traverse(child => {
    const mat = (child as Mesh).material as
      | (Material & { uniforms?: { uOpacity?: { value: number } } })
      | undefined;
    if (!mat) return;
    const ud = mat.userData as { _baseOpacity?: number };
    if (mat.uniforms?.uOpacity) {
      ud._baseOpacity ??= mat.uniforms.uOpacity.value;
      mat.uniforms.uOpacity.value = ud._baseOpacity * presence;
    } else {
      ud._baseOpacity ??= mat.opacity;
      mat.opacity = ud._baseOpacity * presence;
    }
  });
}

/** Galactic-plane UI (the 'sector-grid' rings/spokes inside the galaxy
 *  group): scale each line's base uOpacity by a camDist ramp so the plane
 *  furniture rises with the disc across the sector→arm pull-back instead of
 *  popping in when the galaxy group's visible flag flips. */
function updateSectorGridPresence(camDist: number): void {
  const grid = targets?.galaxyArms?.getObjectByName('sector-grid');
  if (!grid) return;
  const presence = smooth01(camDist, 2.5e5, 1.2e6);
  grid.visible = presence > 0.002;
  if (!grid.visible) return;
  grid.traverse(child => {
    const mat = (child as Mesh).material as
      | (Material & { uniforms?: { uOpacity?: { value: number } } })
      | undefined;
    if (!mat?.uniforms?.uOpacity) return;
    const ud = mat.userData as { _baseOpacity?: number };
    ud._baseOpacity ??= mat.uniforms.uOpacity.value;
    mat.uniforms.uOpacity.value = ud._baseOpacity * presence;
  });
}

// ── Label declutter (screen-space collision) ─────────────────────
// Labels are screen-constant billboards; where their owners cluster on screen
// the names pile into an unreadable smear. Each frame, after the show-logic has
// set every label's wants-state, we project the labelled icons to screen space,
// sort by priority, and greedily keep non-overlapping labels — higher priority
// (selected → home → your presence → class → nearer) wins the slot; losers hide
// their label only (the icon glyph stays). Re-evaluated every frame, so it is
// stable as the camera moves and never leaves a label stuck hidden.

const LABEL_MIN_X = 104; // px — half-keep-out box around a kept label, horizontal
const LABEL_MIN_Y = 26;  // px — …vertical (labels sit just below their icon)
const _lblPos = new Vector3();
const _lblKept: { x: number; y: number }[] = [];
interface LabelCand { labels: Object3D[]; x: number; y: number; prio: number; }

function labelPriority(ud: Record<string, unknown>): number {
  let s = 0;
  if (Game.data.selectedEntity != null && ud.eid === Game.data.selectedEntity) s += 400;
  if (ud.isHome) s += 80;
  if (ud.hasBobs) s += 40;
  const t = ud.type as string | undefined;
  if (t === 'star' || t === 'system') s += 50;
  else if (t === 'planet') s += 25;
  else if (t === 'station') s += 12;
  else if (t === 'moon') s += 8;
  if (ud.explored) s += 6;
  return s;
}

function declutterLabels(camera: Camera): void {
  if (!targets) return;
  const W = window.innerWidth, H = window.innerHeight;
  const cands: LabelCand[] = [];

  for (const layer of [targets.layers.local, targets.layers.regional]) {
    if (!layer.visible) continue;
    layer.traverse(o => {
      if (!o.userData?.isIcon) return;
      const icon = o as Sprite;
      const labels = icon.children.filter(c => c.userData?.isLabel) as Object3D[];
      if (!labels.length) return;
      // Only icons whose labels the show-logic wants visible this frame.
      if (!labels.some(l => l.visible)) return;
      if (!icon.visible || (icon.material as SpriteMaterial).opacity < 0.1) {
        for (const l of labels) l.visible = false;
        return;
      }
      icon.getWorldPosition(_lblPos);
      const dist = camera.position.distanceTo(_lblPos);
      _lblPos.project(camera);
      if (_lblPos.z > 1 || _lblPos.z < -1) { for (const l of labels) l.visible = false; return; }
      const x = (_lblPos.x * 0.5 + 0.5) * W;
      const y = (1 - (_lblPos.y * 0.5 + 0.5)) * H;
      const ud = (icon.parent?.userData ?? {}) as Record<string, unknown>;
      // Class dominates; nearer wins the tie (distance is the fractional part).
      cands.push({ labels, x, y, prio: labelPriority(ud) * 1e7 - dist });
    });
  }

  cands.sort((a, b) => b.prio - a.prio);
  _lblKept.length = 0;
  for (const c of cands) {
    let collide = false;
    for (const k of _lblKept) {
      if (Math.abs(k.x - c.x) < LABEL_MIN_X && Math.abs(k.y - c.y) < LABEL_MIN_Y) { collide = true; break; }
    }
    if (collide) {
      for (const l of c.labels) l.visible = false;
    } else {
      for (const l of c.labels) l.visible = true;
      _lblKept.push({ x: c.x, y: c.y });
    }
  }
}

let heliopauseMesh: Group | null = null;
let heliopauseBase = 0; // authored material opacity, re-cached with the mesh
function updateHeliopauseGate(): void {
  if (!targets) return;
  const local = targets.layers.local;
  // Re-resolve when detached — a system-focus swap (system-loader.ts) disposes
  // the old shell and instantiates a fresh one under the same name.
  if (!heliopauseMesh || heliopauseMesh.parent !== local) {
    heliopauseMesh = local.getObjectByName('heliopause') as Group | null;
    if (!heliopauseMesh) return;
    // Fresh shell ⇒ fresh material at its authored opacity — re-cache the base.
    const mat = (heliopauseMesh as unknown as Mesh).material as MeshBasicMaterial | undefined;
    heliopauseBase = mat?.opacity ?? 0;
  }
  // Banded fade: opacity 0 → base across radius → 1.8×radius, so the shell
  // materialises as the camera pulls away instead of popping in at the radius.
  // The inside-the-shell rule stands: camDist < radius keeps it hidden (the
  // translucent wall would otherwise tint the whole interior view).
  const camDist = Game.data.camDist;
  const t = smooth01(camDist, HELIOPAUSE_RADIUS_WU, HELIOPAUSE_RADIUS_WU * 1.8);
  heliopauseMesh.visible = local.visible && camDist >= HELIOPAUSE_RADIUS_WU && t > 0.001;
  const mat = (heliopauseMesh as unknown as Mesh).material as MeshBasicMaterial | undefined;
  if (mat) mat.opacity = heliopauseBase * t;
}

// ── Per-Object Icon State ────────────────────────────────────────
// Iterates local-layer children and applies the Homeworld-style
// mesh/icon crossfade based on zoom domain and camera distance.

function updateIconStates(_domain: DomainName): void {
  if (!targets) return;
  const camDist = Game.data.camDist;

  // Only local-layer objects have mesh+icon pairs
  const local = targets.layers.local;
  if (!local.visible) return;

  // Apparent-size mesh↔icon handoff with per-entity hysteresis (overlay
  // Phase 2). Replaces the per-domain camDist half/full-fade: each body now
  // switches on its OWN on-screen size, so a Dwarf icon-ifies sooner than a
  // GasGiant at equal distance, and parking at a boundary never flickers.
  for (const child of local.children) {
    const hasIcon = child.children?.some(c => c.userData?.isIcon);
    if (!hasIcon) continue;
    const ud = child.userData as Record<string, unknown>;
    const radiusWU = ((ud.bodyRadius as number) ?? 1) * child.scale.x;
    const bias = iconBiasFor(ud.type as string | undefined, ud.planetTypeId as number | undefined);
    const prev = (ud._iconState as number) ?? -1;
    ud._iconState = updateBodyLOD(child, camDist, radiusWU, bias, prev);
  }
}
