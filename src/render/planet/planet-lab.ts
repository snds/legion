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
import { PRESETS, PLANET_TYPES, type Preset } from './presets';
import { MACRO, type MacroParams } from './plates';
import { DEFAULT_BAKE, type BakeParams } from './bake';
import { mountControlPanel, type ControlPanelHandle, type LabCtrl, type LabSection } from '../../ui/control-panel';

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

  let selected: PlanetVisualType = 'ocean';

  // Bake (Phase 3): per-type on/off + shared erosion params. Baking is heavy, so
  // it runs only on toggle-on and the Rebuild action — never on a slider tick.
  const baked: Record<PlanetVisualType, boolean> = {
    rocky: false, ocean: false, desert: false, lava: false, ice: false, gas: false,
  };
  const bakeParams: BakeParams = { ...DEFAULT_BAKE };

  // ── Single-example gallery view ──────────────────────────────────────
  // Only the SELECTED archetype is built + mounted, centred at the origin and
  // normalised to a consistent display size so every world frames identically in
  // isolation. Switching disposes the old globe and builds the new on demand —
  // cheaper than the old 6-globe row, and the pattern the star / nebula labs reuse.
  const LAB_VIEW_R = visualRadius({ ...EXEMPLARS.ocean, seed: 0 }) * 3; // reference display size (fills the isolated frame)
  const build = (type: PlanetVisualType): void => {
    const planet: GenPlanet = { ...EXEMPLARS[type], seed: seeds[type] };
    const globe = new PlanetGlobe(planet, visualRadius(planet));
    globe.root.position.set(0, 0, 0);
    globe.root.scale.setScalar(LAB_VIEW_R / visualRadius(planet)); // normalise apparent size
    globe.root.userData.labType = type;
    parent.add(globe.root);
    globes.set(type, globe);
  };
  const mountSelected = (): void => {
    for (const [, g] of globes) { parent.remove(g.root); g.dispose(); }
    globes.clear();
    build(selected);
    globes.get(selected)?.setBaked(baked[selected], bakeParams);
  };

  // ── COMPLETE lab persistence ─────────────────────────────────────────
  // Save EVERY editable field — all archetypes, every parameter — across the
  // three sources the panel edits: PRESETS (presets.ts), MACRO tectonics
  // (plates.ts) and the erosion bake config. Deep-cloning the whole objects makes
  // this future-proof: new params/archetypes are captured automatically. Saved
  // tuning is applied on boot BEFORE the globes build, so edits stick on reload.
  const LAB_STORE = 'legion.planetLab.interim';
  type LabSnap = { presets: typeof PRESETS; macro: typeof MACRO; bake: BakeParams };
  const snapshotLab = (): LabSnap => JSON.parse(JSON.stringify({ presets: PRESETS, macro: MACRO, bake: bakeParams })) as LabSnap;
  const CANONICAL = snapshotLab(); // captured before any saved overlay is applied
  const applyLab = (s: Partial<LabSnap>): void => {
    if (s.presets) for (const t of Object.keys(s.presets) as PlanetVisualType[]) if (PRESETS[t]) Object.assign(PRESETS[t], s.presets[t]);
    if (s.macro) for (const t of Object.keys(s.macro) as PlanetVisualType[]) if (MACRO[t]) Object.assign(MACRO[t], s.macro[t]);
    if (s.bake) Object.assign(bakeParams, s.bake);
  };
  try { const raw = localStorage.getItem(LAB_STORE); if (raw) applyLab(JSON.parse(raw) as Partial<LabSnap>); } catch { /* ignore */ }

  mountSelected(); // build the initial selected archetype (after saved tuning applied)
  const applyBake = (): void => { globes.get(selected)?.setBaked(baked[selected], bakeParams); };

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
  // Bake-param sliders edit the shared erosion config (applied on Re-bake / Rebuild).
  const bakeSlider = (label: string, key: keyof BakeParams, min: number, max: number, step: number): LabCtrl => ({
    label, min, max, step,
    get: () => bakeParams[key],
    set: (v) => { bakeParams[key] = v; },
  });

  const sections = (): LabSection[] => {
    const giant = selected === 'gas' || selected === 'ice';
    // Single-example gallery: pick which archetype to view + edit in isolation.
    // Switching mounts only that world (mountSelected) and re-renders the panel
    // (giant vs surface sections differ).
    const typeSel: LabSection = {
      title: 'Archetype', key: 'lab-archetype',
      ctrls: [{
        kind: 'picker',
        options: PLANET_TYPES.map((t) => ({
          value: t,
          label: `${t[0].toUpperCase()}${t.slice(1)}`,
          icon: EXEMPLARS[t].isGasGiant ? '🪐' : '🌍',
        })),
        get: () => selected,
        set: (v) => { selected = v as PlanetVisualType; mountSelected(); handle.panel.refresh(); },
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
        macroSlider('Range variation', 'rangeVar', 0, 1, 0.01),
        slider('Terrain warp', 'warp', 0, 1.5, 0.01),
        macroSlider('Coastline rough', 'coastAmp', 0, 0.8, 0.01),
        macroSlider('Coastline scale', 'coastFreq', 0.5, 6, 0.1),
      ],
    }, {
      title: 'Terrain', key: 'lab-terrain', ctrls: [
        macroSlider('Detail scale', 'detailScale', 1, 8, 0.1),
        macroSlider('Normal depth', 'normalStrength', 0, 0.8, 0.01),
        slider('Displacement', 'displacement', 0, 0.12, 0.001),
        slider('Ridged', 'ridged', 0, 1, 0.01),
        slider('Roughness', 'roughness', 0, 1, 0.01),
        slider('Sea level', 'seaLevel', 0, 1, 0.01),
        slider('Moisture', 'moisture', 0, 1.5, 0.01),
        slider('Polar ice', 'latitudeIce', 0, 1, 0.01),
      ],
    }, {
      // Optional structural ephemera (Mercury/Mars/Venus). Impact craters ship
      // first; canyons + scarps follow. Randomised placement + overlap.
      title: 'Surface features', key: 'lab-surface', ctrls: [
        macroSlider('Craters', 'craters', 0, 1, 0.01),
        macroSlider('Crater density', 'craterFreq', 6, 32, 0.5),
        macroSlider('Crater depth', 'craterDepth', 0, 0.2, 0.005),
      ],
    }, {
      title: 'Master bake (erosion)', key: 'lab-bake', ctrls: [
        { kind: 'toggle', label: 'Baked + eroded', get: () => baked[selected], set: (v) => { baked[selected] = v; applyBake(); } },
        bakeSlider('Bake res', 'res', 64, 512, 32),
        bakeSlider('Droplets', 'droplets', 0, 120000, 5000),
        bakeSlider('Erosion', 'erosionStrength', 0, 1, 0.01),
        bakeSlider('Talus', 'talus', 0.001, 0.02, 0.001),
        bakeSlider('Thermal iters', 'thermalIters', 0, 20, 1),
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
      // In-place (no teardown): recreating the globe strands a camera that is
      // tracking it → the planet vanishes. Refresh uniforms + re-bake on the SAME
      // root instead. (build() is only used for the initial mount.)
      { label: 'Rebuild', onClick: () => { globes.get(selected)?.refreshParams(); applyBake(); return 'Rebuilt ✓'; } },
      { label: 'Reseed', onClick: () => {
        seeds[selected] = (seeds[selected] * 1103515245 + 12345) & 0x7fffffff;
        globes.get(selected)?.reseed(seeds[selected]);
        applyBake();
      } },
      // Save → persist ALL tuning (presets + tectonics + bake) to localStorage so
      // it sticks across reloads. Revert → clear it and restore the canonical look.
      { label: 'Save', onClick: () => {
        try { localStorage.setItem(LAB_STORE, JSON.stringify(snapshotLab())); return 'Saved ✓'; }
        catch { return 'Save failed'; }
      } },
      { label: 'Revert', onClick: () => {
        try { localStorage.removeItem(LAB_STORE); } catch { /* ignore */ }
        applyLab(CANONICAL);
        for (const t of PLANET_TYPES) globes.get(t)?.refreshParams();
        handle.panel.sync();
        return 'Canonical';
      } },
      { label: 'Copy JSON (full set → presets.ts + plates.ts + bake.ts)', minor: true, onClick: () => {
        const json = JSON.stringify(snapshotLab(), null, 2);
        return navigator.clipboard?.writeText(json).then(() => 'Copied ✓', () => 'Copy failed') ?? 'No clipboard';
      } },
    ],
  }, {
    // Docked to the right edge (full height), collapsible — the HUD reflows around
    // it. Open by default since a ?lab= view is dedicated to tuning.
    dock: { open: true, storeKey: 'legion.planetLab.dock' },
  });

  const _root = new Vector3();
  const _sun = new Vector3();
  const handle: PlanetLabHandle = {
    panel,
    framingZoom: 0.135, // pulled in to frame the single isolated globe
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
  // Dev hook (matches the __cam/__VP dev globals): bake the selected globe with
  // light, erosion-free params to A/B the baked/unbaked MACRO parity (simplex.ts).
  (window as unknown as { __labBake?: (on: boolean) => void }).__labBake = (on: boolean) => {
    baked[selected] = on;
    globes.get(selected)?.setBaked(on, on ? { res: 128, droplets: 0, thermalIters: 0 } : bakeParams);
  };
  return handle;
}
