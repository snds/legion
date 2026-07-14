// ═══════════════════════════════════════════════════════════════════
// PLANET LAB — tune the canonical archetype presets on live examples.
//
// Mounts one globe per planet archetype (rocky / ocean / desert / lava / ice /
// gas) in a row and drives a schema-driven control panel that edits the SELECTED
// archetype's preset (src/render/planet/presets.ts PRESETS) live. Because
// derivePlanetParams reads PRESETS on every build, editing a preset and
// rebuilding that archetype's globe shows exactly what every generated body of
// that type will inherit — the "guidepost" workflow. Copy-JSON / Save promote
// the tuned set; Reseed re-jitters the example so you see the archetype's range.
//
// The lab owns its globes + panel; main.ts mounts it behind ?lab=planet, frames
// the row, and pumps update() each frame.
// ═══════════════════════════════════════════════════════════════════

import { Vector3, type Object3D } from 'three';
import type { GenPlanet, PlanetVisualType } from '../../data/system-gen';
import { PlanetGlobe, type UpdateCtx } from './globe';
import { visualRadius } from './index';
import { PRESETS, PLANET_TYPES, snapshotPresets, type Preset } from './presets';
import { MACRO, type MacroParams } from './plates';
import { mountControlPanel, type ControlPanelHandle, type LabCtrl, type LabSection } from '../../ui/control-panel';

const SPACING = 5.5;              // authoring units between globe centres
const FIXED_SUN_DIR = new Vector3(0.6, 0.35, 0.72).normalize(); // even, flattering light

/** Representative example body per archetype (radius/insolation drive the look). */
const EXEMPLARS: Record<PlanetVisualType, Omit<GenPlanet, 'seed'>> = {
  rocky:  { type: 'rocky',  kind: 'super-earth', au: 1.6, massEarth: 3,   radiusEarth: 1.4, insolation: 0.4, isGasGiant: false, hasRings: false, inHZ: false },
  ocean:  { type: 'ocean',  kind: 'rocky',       au: 1.0, massEarth: 1,   radiusEarth: 1.0, insolation: 1.0, isGasGiant: false, hasRings: false, inHZ: true  },
  desert: { type: 'desert', kind: 'rocky',       au: 0.6, massEarth: 0.8, radiusEarth: 0.9, insolation: 1.8, isGasGiant: false, hasRings: false, inHZ: false },
  lava:   { type: 'lava',   kind: 'rocky',       au: 0.2, massEarth: 1.1, radiusEarth: 1.1, insolation: 12,  isGasGiant: false, hasRings: false, inHZ: false },
  ice:    { type: 'ice',    kind: 'ice-giant',   au: 6.0, massEarth: 17,  radiusEarth: 4.2, insolation: 0.03, isGasGiant: true, hasRings: true,  inHZ: false },
  gas:    { type: 'gas',    kind: 'gas-giant',   au: 3.4, massEarth: 300, radiusEarth: 11,  insolation: 0.09, isGasGiant: true, hasRings: true,  inHZ: false },
};

export interface PlanetLabHandle {
  panel: ControlPanelHandle;
  /** Suggested camera target zoom to frame the whole row. */
  readonly framingZoom: number;
  update(ctx: Omit<UpdateCtx, 'sunWorldPos'> & { rootWorld: Vector3 }): void;
  dispose(): void;
}

/** Build the planet lab into `parent` (the system-tier local group). */
export function createPlanetLab(parent: Object3D): PlanetLabHandle {
  const seeds: Record<PlanetVisualType, number> = {
    rocky: 1001, ocean: 2002, desert: 3003, lava: 4004, ice: 5005, gas: 6006,
  };
  const globes = new Map<PlanetVisualType, PlanetGlobe>();
  const posX = new Map<PlanetVisualType, number>();

  const mid = (PLANET_TYPES.length - 1) / 2;
  PLANET_TYPES.forEach((type, i) => { posX.set(type, (i - mid) * SPACING); });

  const build = (type: PlanetVisualType): void => {
    const old = globes.get(type);
    if (old) { parent.remove(old.root); old.dispose(); }
    const planet: GenPlanet = { ...EXEMPLARS[type], seed: seeds[type] };
    const globe = new PlanetGlobe(planet, visualRadius(planet));
    globe.root.position.set(posX.get(type)!, 0, 0);
    parent.add(globe.root);
    globes.set(type, globe);
  };
  for (const t of PLANET_TYPES) build(t);

  let selected: PlanetVisualType = 'ocean';

  // ── Control schema (dynamic: editable fields differ surface vs giant) ──
  // Index the preset object (cast once) so the get/set close over a plain field.
  const P = (): Record<string, number | boolean | number[]> =>
    PRESETS[selected] as unknown as Record<string, number | boolean | number[]>;
  const slider = (label: string, key: keyof Preset, min: number, max: number, step: number): LabCtrl => ({
    label, min, max, step,
    get: () => P()[key] as number,
    set: (v) => { P()[key] = v; },
  });
  const toggle = (label: string, key: keyof Preset): LabCtrl => ({
    kind: 'toggle', label,
    get: () => P()[key] as boolean,
    set: (v) => { P()[key] = v; },
  });
  const color = (label: string, key: keyof Preset): LabCtrl => ({
    kind: 'color', label,
    get: () => P()[key] as [number, number, number],
    set: (v) => { P()[key] = v; },
  });
  // Tectonics (Orogen-style macro): edits the live MACRO table for the archetype.
  const M = (): MacroParams => MACRO[selected];
  const macroSlider = (label: string, key: keyof MacroParams, min: number, max: number, step: number): LabCtrl => ({
    label, min, max, step,
    get: () => M()[key],
    set: (v) => { M()[key] = v; },
  });

  const sections = (): LabSection[] => {
    const giant = selected === 'gas' || selected === 'ice';
    const typeSel: LabSection = {
      title: 'Archetype', key: 'lab-archetype',
      ctrls: [{
        kind: 'select', label: 'Editing', options: PLANET_TYPES as readonly string[],
        get: () => selected,
        set: (v) => { selected = v as PlanetVisualType; handle.panel.refresh(); },
      }],
    };
    if (giant) {
      return [typeSel, {
        title: 'Cloud bands', key: 'lab-bands', ctrls: [
          slider('Band count', 'bandCount', 0, 24, 1),
          slider('Turbulence', 'bandTurbulence', 0, 1.5, 0.01),
          slider('Storm chance', 'stormChance', 0, 1, 0.01),
          color('Band A', 'bandColorA'),
          color('Band B', 'bandColorB'),
        ],
      }, {
        title: 'Atmosphere', key: 'lab-atmos', ctrls: [
          toggle('Enabled', 'hasAtmosphere'),
          slider('Density', 'atmosphereDensity', 0, 2, 0.01),
          color('Tint', 'atmosphere'),
        ],
      }];
    }
    return [typeSel, {
      title: 'Tectonics', key: 'lab-tectonics', ctrls: [
        macroSlider('Plates', 'plateCount', 3, 48, 1),
        macroSlider('Continents', 'continents', 1, 8, 1),
        macroSlider('Land coverage', 'landCoverage', 0.02, 0.98, 0.01),
        macroSlider('Size variety', 'sizeVariety', 0, 1, 0.01),
        macroSlider('Range uplift', 'uplift', 0, 0.6, 0.01),
        macroSlider('Range width', 'rangeWidth', 0.02, 0.2, 0.005),
        slider('Terrain warp', 'warp', 0, 1.5, 0.01),
      ],
    }, {
      title: 'Terrain', key: 'lab-terrain', ctrls: [
        macroSlider('Detail scale', 'detailScale', 1, 8, 0.1),
        macroSlider('Normal depth', 'normalStrength', 0, 0.8, 0.01),
        slider('Displacement', 'displacement', 0, 0.12, 0.001),
        slider('Ridged', 'ridged', 0, 1, 0.01),
        slider('Roughness', 'roughness', 0, 1, 0.01),
        slider('Sea level', 'seaLevel', 0, 1, 0.01),
        slider('Moisture', 'moisture', 0, 1, 0.01),
        slider('Polar ice', 'latitudeIce', 0, 1, 0.01),
      ],
    }, {
      title: 'Ocean / lava', key: 'lab-liquid', ctrls: [
        color('Shallow', 'oceanShallow'),
        color('Deep', 'oceanDeep'),
        slider('Emissive', 'emissiveStrength', 0, 3, 0.01),
        color('Emissive tint', 'emissive'),
      ],
    }, {
      title: 'Atmosphere', key: 'lab-atmos', ctrls: [
        toggle('Enabled', 'hasAtmosphere'),
        slider('Density', 'atmosphereDensity', 0, 2, 0.01),
        slider('Night lights', 'nightLights', 0, 1, 0.01),
        color('Tint', 'atmosphere'),
      ],
    }];
  };

  const panel = mountControlPanel({
    title: '🪐 PLANET LAB',
    collapseKey: 'legion.planetLab.collapse',
    sections,
    // Push edits into the live globe's uniforms — no teardown/recompile (that
    // vanished the planet + recompiled the heavy per-fragment shader per tick).
    // Structural changes (type switch, atmosphere on/off) use Rebuild / Reseed.
    onChange: () => { globes.get(selected)?.refreshParams(); },
    actions: [
      { label: 'Rebuild', onClick: () => { build(selected); return 'Rebuilt ✓'; } },
      { label: 'Reseed', onClick: () => { seeds[selected] = (seeds[selected] * 1103515245 + 12345) & 0x7fffffff; build(selected); } },
      { label: 'Copy JSON → presets.ts', minor: true, onClick: () => {
        const json = JSON.stringify(snapshotPresets(), null, 2);
        return navigator.clipboard?.writeText(json).then(() => 'Copied ✓', () => 'Copy failed') ?? 'No clipboard';
      } },
    ],
  }, { anchor: 'right:16px;top:64px' });

  const _root = new Vector3();
  const _sun = new Vector3();
  const handle: PlanetLabHandle = {
    panel,
    framingZoom: 0.205,
    update(ctx) {
      // Even, fixed-direction key light so archetypes are lit identically for
      // comparison (independent of the floating-origin shift).
      _root.copy(ctx.rootWorld);
      _sun.copy(FIXED_SUN_DIR).multiplyScalar(1e4).add(_root);
      const full: UpdateCtx = { camera: ctx.camera, sunWorldPos: _sun, dt: ctx.dt, fovYRad: ctx.fovYRad, viewportH: ctx.viewportH };
      for (const g of globes.values()) g.update(full);
    },
    dispose() {
      for (const g of globes.values()) { parent.remove(g.root); g.dispose(); }
      globes.clear();
      panel.destroy();
    },
  };
  return handle;
}
