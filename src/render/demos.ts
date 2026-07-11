// ═══════════════════════════════════════════════════════════════════
// DEMOS — the "review builds" registry: one destination per shipped subsystem.
//
// A single ?demo=<id> URL flag drives an in-game showcase so each recently-
// merged piece of work can be evaluated directly. The dropdown (src/ui/demo-
// menu.ts) sets the flag + reloads; the boot director (main.ts) reads the flag,
// mounts any showcase that only exists at init (planet globes), and eases the
// camera to the destination below — clearing object tracking, setting the tier
// (Game.data.targetZoom) and the ABSOLUTE focus (Game.data.camFocusTarget,
// which the orbit math consumes directly; no floating-origin rebase needed).
//
// targetZoom values are hand-tuned against the getCamDist() curve (core/state.ts)
// so each subsystem lands in the tier where it renders: system tiers for the
// star/planets, the galaxy crossfade window (camDist > 6e5 WU) for the nebula
// and the disc, and a close orbit of the hero black hole so its geodesic trace
// resolves past the point-LOD.
// ═══════════════════════════════════════════════════════════════════

import { Vector3 } from 'three';
import { nebulaCenterAbsWU, ORION_NEBULA_PARAMS } from './nebula';

export type DemoId = 'star' | 'planet' | 'nebula' | 'blackhole' | 'galaxy';

/** URL query key that selects a demo. */
export const DEMO_PARAM = 'demo';

/** Absolute galactocentric scene-WU position of the hero black hole. Single
 *  source of truth: main.ts builds the set-piece here, and the black-hole demo
 *  flies to the same point. Keep the two in lockstep by importing this. */
export const HERO_BLACKHOLE_ABS = new Vector3(46_000, 9_000, -32_000);

export interface DemoDef {
  readonly id: DemoId;
  /** Emoji shown in the dropdown + caption. */
  readonly icon: string;
  /** Short dropdown label. */
  readonly label: string;
  /** The PR / branch that shipped this, for the caption footer. */
  readonly source: string;
  /** One line: what to look at once the camera lands. */
  readonly blurb: string;
  /** Game.data.targetZoom to ease to (0..1 zoom axis, see ZOOM_STEPS). */
  readonly targetZoom: number;
  /** Absolute scene-WU focus point for the camera (fed to camFocusTarget). */
  readonly focusAbs: Vector3;
}

export const DEMOS: readonly DemoDef[] = [
  {
    id: 'star',
    icon: '☀️',
    label: 'Procedural star surface',
    source: 'PR #158 · procedural-star',
    blurb: 'The live system star, re-skinned from its physical record — granulation, '
      + 'limb darkening, spectral colour and corona. Warp time to watch it churn.',
    targetZoom: 0.11, // low-orbit: pulled in tight so the star fills the frame, surface detail resolves
    focusAbs: new Vector3(0, 0, 0), // star sits at the home local-tier root
  },
  {
    id: 'planet',
    icon: '🪐',
    label: 'Procedural planet globes',
    source: 'PR #161 · planet-globes',
    blurb: 'A showcase system: one of every biome preset (lava, desert, ocean, rocky, '
      + 'gas & ice giants) plus two ring systems, on cube-sphere globes with quadtree LOD.',
    targetZoom: 0.22, // orbit tier (~4 AU): the showcase globes read as distinct textured worlds
    focusAbs: new Vector3(0, 0, 0), // globes orbit the star at the local root
  },
  {
    id: 'nebula',
    icon: '🌫️',
    label: 'Nebula — Orion (M42)',
    source: 'PR #159 · phenomena-nebula',
    blurb: 'Nested iso-density emission shells — hot [OIII] core → Hα → dust lanes — '
      + 'placed at Orion’s real galactic position, ~412 pc out below the disc plane.',
    targetZoom: 0.93, // galaxy tier: crossfade opens past camDist 6e5 WU
    focusAbs: nebulaCenterAbsWU(ORION_NEBULA_PARAMS.galPosPc),
  },
  {
    id: 'blackhole',
    icon: '🕳️',
    label: 'Black hole set-piece',
    source: 'PR #162 · phenomena-blackhole',
    blurb: 'A Schwarzschild geodesic renderer: the shadow, the photon ring, Einstein '
      + 'lensing of the starfield, and a Doppler-beamed Novikov–Thorne accretion disk.',
    targetZoom: 0.76, // ~1.3k WU orbit ≈ 4× the geodesic bounding radius (matches the standalone harness framing)
    focusAbs: HERO_BLACKHOLE_ABS.clone(),
  },
  {
    id: 'galaxy',
    icon: '🌌',
    label: 'Galaxy arms + gas filaments',
    source: 'PR #160 · galaxy-arm-polish',
    blurb: 'Full-disc framing: spiral-arm catalog-star highlights redistributed along '
      + 'the arms, plus domain-warped gas-shell filament emission breaking up the banding.',
    targetZoom: 0.97, // near GALAXY tier: whole Milky Way disc in frame
    focusAbs: new Vector3(0, 0, 0),
  },
];

/** The active demo id from the URL, or null when running the normal game. */
export function activeDemoId(): DemoId | null {
  if (typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get(DEMO_PARAM);
  return DEMOS.some((d) => d.id === v) ? (v as DemoId) : null;
}

/** Look up a demo definition by id. */
export function demoById(id: DemoId | null): DemoDef | null {
  return id ? DEMOS.find((d) => d.id === id) ?? null : null;
}
