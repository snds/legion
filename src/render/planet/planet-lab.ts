// ═══════════════════════════════════════════════════════════════════
// PLANET LAB — tune the canonical archetype presets on live examples.
//
// Mounts one globe per planet archetype (rocky / ocean / desert / lava / ice /
// gas) in a row and drives a schema-driven control panel that edits the SELECTED
// archetype's preset (src/render/planet/presets.ts PRESETS) live. Because
// derivePlanetParams reads PRESETS on every build, editing a preset and
// rebuilding that archetype's globe shows exactly what every generated body of
// that type will inherit — the "guidepost" workflow. lab-ideal.json is the
// committed guidepost; Save writes localStorage only (this origin);
// Copy JSON is the clipboard / file-sync path into presets.ts + plates.ts.
//
// The lab owns its globes + panel; main.ts mounts it behind ?lab=planet, frames
// the row, and pumps update() each frame.
// ═══════════════════════════════════════════════════════════════════

import {
  Vector3, Mesh, SphereGeometry, MeshBasicMaterial,
  type Object3D, type WebGLRenderer, type Camera,
} from 'three';
import type { GenPlanet, PlanetVisualType } from '../../data/system-gen';
import { PlanetGlobe, type UpdateCtx } from './globe';
import { ContinuumGlobe, type LabEngine } from './continuum';
import { attachContinuumAcceptApi } from './continuum/accept-api';
import { visualRadius } from './index';
import type { PerspectiveCamera } from 'three';
import { PRESETS, PLANET_TYPES, type Preset } from './presets';
import { MACRO, type MacroParams } from './plates';
import { DEFAULT_BAKE, type BakeParams } from './bake';
import labIdeal from './lab-ideal.json';
import {
  OCEAN_VARIANTS, variantById, DEFAULT_SYSTEMIC,
  masterValues, applyOffsets, type SystemicState,
} from './variants';
import { mountControlPanel, type ControlPanelHandle, type LabCtrl, type LabSection } from '../../ui/control-panel';
import { PERF_BASELINE_AU, zoomForPhysicalAu, physicalAuFromZoom, Game } from '../../core/state';

// Default lab sun direction (even, flattering light). Mutable so the Continuum
// accept harness can pose day/night/terminator via a real world-space sun
// direction (see accept-api.ts `poseSun` — planet yaw cannot change which
// hemisphere faces the fixed lab camera, so posing must move the sun instead).
const sunDir = new Vector3(0.6, 0.35, 0.72).normalize();
/** Visible lab sun distance in local units (≈ a few planet radii past the subject). */
const LAB_SUN_SEPARATION = 4.2;

/** Either lab engine — CaptureGlobe-compatible + `.root` for perf wiring. */
export type LabBody = PlanetGlobe | ContinuumGlobe;

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
  /** Currently mounted globe (for ?perfcapture A/B). */
  selectedGlobe(): LabBody | null;
  /** Active lab render engine. */
  readonly engine: LabEngine;
  update(ctx: Omit<UpdateCtx, 'sunWorldPos'> & { rootWorld: Vector3 }): void;
  /** Continuum overlays (none in scratch v1; kept for main.ts wiring). */
  renderOverlays(renderer: WebGLRenderer, camera: Camera): void;
  dispose(): void;
}

/** Build the planet lab into `parent` (the system-tier local group). */
export function createPlanetLab(parent: Object3D): PlanetLabHandle {
  const seeds: Record<PlanetVisualType, number> = {
    rocky: 1001, ocean: 2002, desert: 3003, lava: 4004, ice: 5005, gas: 6006,
  };
  const globes = new Map<PlanetVisualType, LabBody>();

  // Parallel continuum prototype: ?lab=planet&engine=continuum (default legacy).
  const engParam = new URLSearchParams(location.search).get('engine');
  let engine: LabEngine = engParam === 'continuum' ? 'continuum' : 'legacy';

  let selected: PlanetVisualType = 'ocean';
  // View: auto-spin on by default; arrow keys hand-turn the subject either way.
  let autoRotate = true;
  let cloudsVisible = true;
  let showChunks = false; // outline overlay; albedo always shows planet
  const setAutoRotate = (on: boolean): void => {
    autoRotate = on;
    for (const g of globes.values()) g.setSpinPaused(!on);
  };
  const setCloudsVisible = (on: boolean): void => {
    cloudsVisible = on;
    for (const g of globes.values()) g.setCloudsVisible(on);
  };
  const setShowChunks = (on: boolean): void => {
    showChunks = on;
    for (const g of globes.values()) {
      if (g instanceof ContinuumGlobe) g.setShowChunks(on);
    }
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return; // don't hijack slider text entry
    const step = e.shiftKey ? 0.09 : 0.035;
    let yaw = 0, pitch = 0;
    if (e.key === 'ArrowLeft') yaw = step;
    else if (e.key === 'ArrowRight') yaw = -step;
    else if (e.key === 'ArrowUp') pitch = -step;
    else if (e.key === 'ArrowDown') pitch = step;
    else return;
    e.preventDefault();
    globes.get(selected)?.nudgeRotation(yaw, pitch);
  };
  window.addEventListener('keydown', onKey);
  let variant = 'terran'; // habitable-world climate state (ocean archetype)
  const systemic: SystemicState = { ...DEFAULT_SYSTEMIC };
  // Offset model (see variants.ts): these hold what the dials LAST computed for
  // every owned parameter. A hand edit shows up as (live - baseline), and that
  // delta is re-applied on top of the next baseline — so moving a master never
  // discards manual work. Re-seeded on archetype switch / climate-state apply,
  // both of which are absolute writes that should start from zero offsets.
  let baseP: Record<string, number> = {};
  let baseM: Record<string, number> = {};
  const seedBaseline = (): void => {
    const v = masterValues(systemic);
    baseP = v.preset; baseM = v.macro;
  };
  seedBaseline();

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

  // Visible sun for lighting reference + continuum atmos limb (kept by main.ts allowlist).
  const labSun = new Mesh(
    new SphereGeometry(LAB_VIEW_R * 0.14, 28, 20),
    new MeshBasicMaterial({ color: 0xfff0d4, toneMapped: false, depthTest: true, depthWrite: true }),
  );
  labSun.name = 'lab-sun';
  labSun.userData.type = 'lab-sun';
  labSun.renderOrder = 0;
  parent.add(labSun);
  const labSunGlow = new Mesh(
    new SphereGeometry(LAB_VIEW_R * 0.22, 20, 14),
    new MeshBasicMaterial({
      color: 0xffc878, transparent: true, opacity: 0.35,
      depthTest: true, depthWrite: false, toneMapped: false,
    }),
  );
  labSun.add(labSunGlow);
  const build = (type: PlanetVisualType): void => {
    const planet: GenPlanet = { ...EXEMPLARS[type], seed: seeds[type] };
    const r = visualRadius(planet);
    const globe: LabBody = engine === 'continuum'
      ? new ContinuumGlobe(planet, r)
      : (() => {
        const g = new PlanetGlobe(planet, r);
        g.setBakeAuto(false); // lab owns bake via the Baked toggle / A/B harness
        return g;
      })();
    if (engine === 'continuum') {
      (globe as ContinuumGlobe).setShowChunks(showChunks);
    }
    globe.setCloudsVisible(cloudsVisible);
    globe.root.position.set(0, 0, 0);
    globe.root.scale.setScalar(LAB_VIEW_R / r); // normalise apparent size
    globe.root.userData.labType = type;
    parent.add(globe.root);
    globes.set(type, globe);
  };
  const mountSelected = (): void => {
    for (const [, g] of globes) { parent.remove(g.root); g.dispose(); }
    globes.clear();
    build(selected);
    const g = globes.get(selected);
    if (g) {
      if (engine !== 'continuum') {
        (g as PlanetGlobe).setBaked(baked[selected], bakeParams);
      }
      g.setSpinPaused(!autoRotate);
      g.setCloudsVisible(cloudsVisible);
    }
  };

  // 1) lab-ideal.json — committed guidepost (survives ports / browsers / HMR).
  // 2) localStorage interim — this origin only (Chrome ≠ Cursor IDE browser,
  //    :5173 ≠ :5174). Save writes here only; Copy JSON is the export path.
  const LAB_STORE = 'legion.planetLab.interim.v3';
  type LabUiSnap = {
    cloudsVisible?: boolean;
    autoRotate?: boolean;
    showChunks?: boolean;
  };
  type LabSnap = {
    presets: typeof PRESETS;
    macro: typeof MACRO;
    bake: BakeParams;
    baked?: Record<PlanetVisualType, boolean>;
    ui?: LabUiSnap;
  };
  const snapshotLab = (): LabSnap => JSON.parse(JSON.stringify({
    presets: PRESETS,
    macro: MACRO,
    bake: bakeParams,
    baked,
    ui: { cloudsVisible, autoRotate, showChunks },
  })) as LabSnap;
  const applyLab = (s: Partial<LabSnap>): void => {
    if (s.presets) for (const t of Object.keys(s.presets) as PlanetVisualType[]) if (PRESETS[t]) Object.assign(PRESETS[t], s.presets[t]);
    if (s.macro) for (const t of Object.keys(s.macro) as PlanetVisualType[]) if (MACRO[t]) Object.assign(MACRO[t], s.macro[t]);
    if (s.bake) Object.assign(bakeParams, s.bake);
    if (s.baked) Object.assign(baked, s.baked);
    if (s.ui) {
      if (typeof s.ui.cloudsVisible === 'boolean') cloudsVisible = s.ui.cloudsVisible;
      if (typeof s.ui.autoRotate === 'boolean') autoRotate = s.ui.autoRotate;
      if (typeof s.ui.showChunks === 'boolean') showChunks = s.ui.showChunks;
    }
  };
  applyLab(labIdeal as unknown as Partial<LabSnap>); // committed ideal first
  const CANONICAL = snapshotLab(); // Revert target = ideal, not pre-ideal code drift
  try {
    const raw = localStorage.getItem(LAB_STORE);
    if (raw) applyLab(JSON.parse(raw) as Partial<LabSnap>);
  } catch { /* ignore */ }
  // Auto-bake stays off at every load (ideal / interim may still carry true).
  for (const t of Object.keys(baked) as PlanetVisualType[]) baked[t] = false;

  mountSelected(); // build the initial selected archetype (after saved tuning applied)
  const applyBake = (): void => {
    const g = globes.get(selected);
    if (!g) return;
    if (engine === 'continuum') {
      (g as ContinuumGlobe).invalidateChunks();
    } else {
      (g as PlanetGlobe).setBaked(baked[selected], bakeParams);
    }
  };

  // ── Live refresh: EVERY control edit pushes into the mounted globe.
  // Continuum: refreshParams invalidates heightfield chunks (budgeted rebuild).
  // Legacy: uniform refresh; baked worlds use stale/commit for erosion bake.
  let refreshQueued = false;
  const liveRefresh = (): void => {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => { refreshQueued = false; globes.get(selected)?.refreshParams(); });
  };
  let bakePreview = false;
  const autoBake = (): boolean => engine !== 'continuum' && baked[selected];
  const bakeStaleSet = (): void => {
    if (!autoBake()) return;
    if (!bakePreview) {
      bakePreview = true;
      const g = globes.get(selected);
      if (g instanceof PlanetGlobe) g.setBaked(false, bakeParams);
    }
  };
  const bakeStaleCommit = (): void => {
    if (!autoBake()) return;
    bakePreview = false;
    applyBake();
  };

  // ── Control schema (dynamic: editable fields differ surface vs giant) ──
  // Index the preset object (cast once) so the get/set close over a plain field.
  const P = (): Record<string, number | boolean | number[]> =>
    PRESETS[selected] as unknown as Record<string, number | boolean | number[]>;
  /** True when this control auto-regenerates the eroded bake on release (legacy only). */
  const needsRebake = (): boolean => autoBake();
  const slider = (label: string, key: keyof Preset, min: number, max: number, step: number, help?: string): LabCtrl => {
    const bakeKey = key === 'warp' || key === 'ridged' || key === 'seaLevel' || key === 'latitudeIce';
    const rebake = bakeKey && needsRebake();
    return {
      label, min, max, step, rebake, help,
      get: () => P()[key] as number,
      set: (v) => {
        P()[key] = v;
        if (bakeKey) bakeStaleSet();
        liveRefresh();
      },
      commit: bakeKey ? bakeStaleCommit : undefined,
    };
  };
  const toggle = (label: string, key: keyof Preset, help?: string): LabCtrl => ({
    kind: 'toggle', label, help,
    get: () => P()[key] as boolean,
    set: (v) => { P()[key] = v; if (key === 'hasAtmosphere') mountSelected(); else liveRefresh(); },
  });
  const color = (label: string, key: keyof Preset, help?: string): LabCtrl => ({
    kind: 'color', label, help,
    get: () => P()[key] as [number, number, number],
    set: (v) => { P()[key] = v; liveRefresh(); },
  });
  // Tectonics (Orogen-style macro): edits the live MACRO table for the archetype.
  const M = (): MacroParams => MACRO[selected];
  const macroSlider = (label: string, key: keyof MacroParams, min: number, max: number, step: number, help?: string): LabCtrl => ({
    label, min, max, step, rebake: needsRebake(), help,
    get: () => M()[key],
    set: (v) => { M()[key] = v; bakeStaleSet(); liveRefresh(); },
    commit: bakeStaleCommit,
  });
  // Bake-param sliders edit the shared erosion config (legacy).
  const bakeSlider = (label: string, key: keyof BakeParams, min: number, max: number, step: number, help?: string): LabCtrl => ({
    label, min, max, step, rebake: needsRebake(), help,
    get: () => bakeParams[key],
    set: (v) => { bakeParams[key] = v; },
    commit: () => { if (autoBake()) applyBake(); },
  });

  const sections = (): LabSection[] => {
    const giant = selected === 'gas' || selected === 'ice';
    // Single-example gallery: pick which archetype to view + edit in isolation.
    // Switching mounts only that world (mountSelected) and re-renders the panel
    // (giant vs surface sections differ).
    const viewSel: LabSection = {
      title: 'View', key: 'lab-view', ctrls: [
        {
          kind: 'picker',
          options: [
            { value: 'legacy', label: 'Legacy', icon: '🔧' },
            { value: 'continuum', label: 'Continuum', icon: '🌐' },
          ],
          get: () => engine,
          set: (v) => {
            engine = (String(v) === 'continuum' ? 'continuum' : 'legacy');
            const url = new URL(location.href);
            if (engine === 'continuum') url.searchParams.set('engine', 'continuum');
            else url.searchParams.delete('engine');
            history.replaceState(null, '', url.toString());
            mountSelected();
            handle.panel.refresh();
          },
        },
        { kind: 'info', label: 'Engine', get: () => engine === 'continuum' ? 'chunked heightfield' : 'live quadtree' },
        { kind: 'toggle', label: 'Auto-rotate', help: 'Spins the planet slowly for orbit viewing', get: () => autoRotate, set: (v) => setAutoRotate(v) },
        ...(engine === 'continuum' ? [
          {
            kind: 'toggle' as const, label: 'Show chunks',
            help: 'Wireframe / LOD tint + residency HUD',
            get: () => showChunks,
            set: (v: boolean) => setShowChunks(v),
          },
        ] : []),
        { kind: 'info', label: 'Turn', get: () => 'Arrow keys · Shift = faster' },
      ],
    };
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
        set: (v) => {
          selected = v as PlanetVisualType; bakePreview = false;
          seedBaseline();   // new archetype = new absolute values, zero offsets
          mountSelected(); handle.panel.refresh();
        },
      }],
    };
    // Habitable-world climate states (ocean archetype). Each variant is a real
    // documented climate — see variants.ts for the science each one encodes.
    // Applying one overwrites the archetype's climate/tectonic params in place,
    // so it is a STARTING POINT to tune from, not a locked mode.
    const variantSel: LabSection = {
      title: 'Climate state', key: 'lab-variant',
      ctrls: [{
        kind: 'picker',
        options: OCEAN_VARIANTS.map((v) => ({ value: v.id, label: v.label, icon: '🌍' })),
        get: () => variant,
        set: (v) => {
          variant = String(v);
          const def = variantById(variant);
          if (def) {
            Object.assign(PRESETS.ocean, def.preset);
            Object.assign(MACRO.ocean, def.macro);
            seedBaseline(); // a climate state is an absolute write: offsets reset
            bakeStaleSet();
            globes.get(selected)?.refreshParams();
            bakeStaleCommit();
          }
          handle.panel.refresh();
        },
      }, {
        kind: 'info', label: 'Basis',
        get: () => variantById(variant)?.blurb ?? '—',
      }],
    };
    if (giant) {
      return [typeSel, viewSel, {
        title: 'Cloud bands', key: 'lab-bands', ctrls: [
          slider('Band count', 'bandCount', 0, 24, 1, 'More latitude stripes across the giant'),
          slider('Turbulence', 'bandTurbulence', 0, 1.5, 0.01, 'Warps bands into storms and swirls'),
          slider('Storm chance', 'stormChance', 0, 1, 0.01, 'Adds bright oval storm spots'),
          color('Band A', 'bandColorA', 'Primary band tint'),
          color('Band B', 'bandColorB', 'Alternate band tint'),
        ],
      }, {
        title: 'Atmosphere', key: 'lab-atmos', ctrls: [
          toggle('Enabled', 'hasAtmosphere', 'Shows the soft limb glow around the planet'),
          slider('Density', 'atmosphereDensity', 0, 2, 0.01, 'Thicker haze / brighter limb'),
          color('Tint', 'atmosphere', 'Color of the atmospheric limb'),
        ],
      }];
    }
    // ── Systemic dials: each drives a physically-coupled BUNDLE of the detail
    // params below, so a coherent world can be FOUND by sweeping four sliders
    // instead of nudging six in step. They overwrite what they own and refresh
    // the panel, so the detail sliders stay the finishing tool (see variants.ts).
    const P2 = (): Record<string, number> => P() as unknown as Record<string, number>;
    const M2 = (): Record<string, number> => M() as unknown as Record<string, number>;
    const world = (label: string, key: keyof SystemicState, help: string): LabCtrl => ({
      label, min: 0, max: 1, step: 0.01, rebake: needsRebake(), help,
      get: () => systemic[key],
      set: (v) => {
        systemic[key] = v;
        // Offset model: re-apply every owned param as newBaseline + hand-delta.
        const next = masterValues(systemic);
        applyOffsets(P2(), next.preset, baseP);
        applyOffsets(M2(), next.macro, baseM);
        baseP = next.preset; baseM = next.macro;
        bakeStaleSet();
        liveRefresh();
      },
      commit: () => { bakeStaleCommit(); handle.panel.refresh(); },
    });
    const worldSel: LabSection = {
      title: 'World', key: 'lab-world', ctrls: [
        ...(autoBake()
          ? [{ kind: 'info' as const, label: 'Badge', get: () => '● = rebake on release' }]
          : [{ kind: 'info' as const, label: 'Mode', get: () => engine === 'continuum'
            ? 'chunk heightfields — edits rebuild residency'
            : 'live analytic — Rebuild to bake atlas' }]),
        world('Warmth', 'warmth', 'Shifts ice line and biome temperatures'),
        world('Hydrosphere', 'hydrosphere', 'Raises seas and fills cloud / moisture'),
        world('Tectonic vigour', 'tectonics', 'Taller ranges, more continents'),
        world('Biosphere', 'biosphere', 'Greener lowlands, stronger night lights'),
      ],
    };
    // Climate states are authored for the ocean archetype (habitable worlds).
    return [typeSel, viewSel, ...(selected === 'ocean' ? [variantSel] : []), worldSel, {
      title: 'Tectonics', key: 'lab-tectonics', ctrls: [
        macroSlider('Plates', 'plateCount', 3, 48, 1, 'More plates → more coastal complexity'),
        macroSlider('Continents', 'continents', 1, 8, 1, 'Number of major landmasses'),
        macroSlider('Land coverage', 'landCoverage', 0.02, 0.98, 0.01, 'Fraction of globe that is land'),
        macroSlider('Size variety', 'sizeVariety', 0, 1, 0.01, 'Uneven continent sizes'),
        macroSlider('Range uplift', 'uplift', 0, 0.6, 0.01, 'Taller mountain belts'),
        macroSlider('Range width', 'rangeWidth', 0.02, 0.2, 0.005, 'Wider orographic mountain belts'),
        macroSlider('Range variation', 'rangeVar', 0, 1, 0.01, 'Broken vs continuous ranges'),
        slider('Terrain warp', 'warp', 0, 1.5, 0.01, 'Warps coasts and ranges away from spheres'),
        macroSlider('Coastline rough', 'coastAmp', 0, 0.8, 0.01, 'Jagged fjords and bays'),
        macroSlider('Coastline scale', 'coastFreq', 0.5, 6, 0.1, 'Finer coastal wiggles'),
      ],
    }, {
      title: 'Terrain', key: 'lab-terrain', ctrls: [
        macroSlider('Detail scale', 'detailScale', 1, 8, 0.1, 'Finer hills and texture on land'),
        {
          label: 'Normal depth',
          help: 'Stronger height-based shading / relief',
          min: 0, max: 0.8, step: 0.01,
          rebake: needsRebake(),
          get: () => M().normalStrength,
          set: (v) => {
            M().normalStrength = v;
            bakeStaleSet();
            liveRefresh();
          },
          commit: bakeStaleCommit,
        },
        slider('Displacement', 'displacement', 0, 0.12, 0.001, 'Pushes mountains outward in 3D'),
        slider('Ridged', 'ridged', 0, 1, 0.01, 'Sharper alpine ridges'),
        slider('Roughness', 'roughness', 0, 1, 0.01, 'Less shiny specular highlights'),
        slider('Sea level', 'seaLevel', 0, 1, 0.01, 'Floods lowlands or exposes shelves'),
        slider('Polar ice', 'latitudeIce', 0, 1, 0.01, 'Larger white ice caps'),
      ],
    }, {
      title: 'Climate', key: 'lab-climate', ctrls: [
        slider('Base humidity', 'moisture', 0, 1.5, 0.01, 'Overall greener biomes'),
        slider('Arid belts', 'aridBelts', 0, 1.5, 0.01, 'Stronger subtropical deserts'),
        slider('Rain shadow', 'rainShadow', 0, 1.5, 0.01, 'Drier lee sides of ranges'),
        slider('Windward wetting', 'orographic', 0, 1.5, 0.01, 'Wetter windward slopes'),
        slider('Lapse rate', 'lapseRate', 0, 2, 0.01, 'Colder / snowier high elevations'),
        slider('Treeline', 'treeline', 0, 0.6, 0.005, 'Where forests give way to rock/snow'),
        slider('Wind bearing', 'windBearing', -1.57, 1.57, 0.01, 'Rotates wet/dry sides of continents'),
        slider('Continentality', 'continental', 0, 1.5, 0.01, 'Drier inland interiors'),
        slider('Altitude drying', 'altitudeDry', 0, 1.5, 0.01, 'Less vegetation on high plateaus'),
        slider('Patchiness', 'patchiness', 0, 1.5, 0.01, 'Broken biome mottling'),
        slider('Lush depth', 'lushDepth', 0, 1.5, 0.01, 'Deeper forest / jungle color'),
        slider('Snowfall', 'snowfall', 0, 1.5, 0.01, 'More mountain and seasonal snow'),
      ],
    }, {
      title: 'Surface features', key: 'lab-surface', ctrls: [
        macroSlider('Craters', 'craters', 0, 1, 0.01, 'Impact bowls carve the surface'),
        macroSlider('Crater density', 'craterFreq', 3, 32, 0.5, 'More craters packed together'),
        macroSlider('Crater depth', 'craterDepth', 0, 0.2, 0.005, 'Deeper crater floors'),
        macroSlider('Canyons', 'canyons', 0, 1, 0.01, 'Rift and canyon networks'),
        macroSlider('Canyon scale', 'canyonFreq', 1, 6, 0.1, 'Finer canyon branching'),
        macroSlider('Canyon depth', 'canyonDepth', 0, 0.25, 0.005, 'Deeper canyon cuts'),
      ],
    }, {
      title: 'Master bake (erosion)', key: 'lab-bake', ctrls: engine === 'continuum'
        ? [
          { kind: 'info' as const, label: 'Continuum', get: () => 'chunks rebuild from generators (no atlas)' },
          { kind: 'info' as const, label: 'Hint', get: () => 'Sliders invalidate residency · 1–2 builds/frame' },
        ]
        : [
        {
          kind: 'toggle',
          label: 'Baked + eroded',
          rebake: true,
          help: 'Runs hydraulic erosion on the height atlas',
          get: () => baked[selected],
          set: (v) => {
            baked[selected] = v;
            applyBake();
            handle.panel.refresh();
          },
        },
        {
          label: 'Bake res',
          help: 'Higher = sharper coasts and normals (slower bake)',
          min: 64, max: 512, step: 32,
          rebake: needsRebake(),
          get: () => bakeParams.res,
          set: (v) => { bakeParams.res = v; },
          commit: () => { if (autoBake()) applyBake(); },
        },
        bakeSlider('Droplets', 'droplets', 0, 120000, 5000, 'More erosion particles → carved valleys'),
        bakeSlider('Erosion', 'erosionStrength', 0, 1, 0.01, 'Stronger sediment carving per droplet'),
        bakeSlider('Talus', 'talus', 0.001, 0.02, 0.001, 'Smoother scree slopes under cliffs'),
        bakeSlider('Thermal iters', 'thermalIters', 0, 20, 1, 'More thermal erosion smoothing'),
      ],
    }, {
      title: 'Ocean / lava', key: 'lab-liquid', ctrls: [
        color('Shallow', 'oceanShallow', 'Near-shore water or lava color'),
        color('Deep', 'oceanDeep', 'Open-ocean or deep lava color'),
        slider('Emissive', 'emissiveStrength', 0, 3, 0.01, 'Glow strength (lava / biolume)'),
        color('Emissive tint', 'emissive', 'Color of the glow'),
      ],
    }, {
      title: 'Clouds', key: 'lab-clouds', ctrls: [
        {
          kind: 'toggle', label: 'Show clouds',
          help: 'Toggles the cloud deck and its ground shadows',
          get: () => cloudsVisible,
          set: (v) => setCloudsVisible(v),
        },
        slider('Cloud cover', 'cloudCover', 0, 1, 0.01, 'More of the sky filled with cloud'),
        slider('Cloud shadow', 'cloudShadow', 0, 1, 0.01,
          engine === 'continuum'
            ? 'Legacy ground-shadow pass (Continuum: use cover / lighting)'
            : 'Darker ground patches under clouds'),
        slider('Circulation', 'cloudFlow', 0, 2, 0.01, 'Stronger zonal wind drift'),
        slider('Turbulence', 'cloudTurb', 0, 1.5, 0.01, 'More shearing / morphing billows'),
        slider('Cyclones', 'cyclones', 0, 1, 0.01, 'Stronger spiral storm systems'),
        slider('Storm size', 'cycloneSize', 0.04, 0.4, 0.005, 'Wider cyclone eyes and arms'),
        slider('Terrain coupling', 'cloudTerrain', 0, 1, 0.01, 'Mountains clear the deck; wet belts thicken it'),
        slider('Detail scale', 'cloudDetail', 0.5, 4, 0.05, 'Smaller, finer cloud cells'),
        slider('Weather speed', 'cloudSpeed', 0, 1, 0.005, 'Faster deck drift and storm lifecycle'),
        slider('Wispiness', 'cloudWisp', 0, 1, 0.01, 'Thinner spiral arms and frayed edges'),
        slider('Clear regions', 'cloudRegion', 0, 1, 0.01, 'Larger clear vs overcast patches'),
        slider('Lightning', 'lightning', 0, 2, 0.01, 'Brighter flashes in storm cores'),
      ],
    }, {
      title: 'Atmosphere', key: 'lab-atmos', ctrls: [
        toggle('Enabled', 'hasAtmosphere', 'Shows the soft limb glow around the planet'),
        slider('Density', 'atmosphereDensity', 0, 2, 0.01, 'Thicker haze / brighter limb'),
        slider('Night lights', 'nightLights', 0, 1, 0.01, 'City glow on the night side'),
        color('Tint', 'atmosphere', 'Color of the atmospheric limb'),
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
      // Save → localStorage only (this origin). Copy JSON exports the full snap.
      // Revert → clear interim and restore lab-ideal.json.
      { label: 'Save', onClick: () => {
        const snap = snapshotLab();
        try { localStorage.setItem(LAB_STORE, JSON.stringify(snap)); }
        catch { return 'Save failed (storage)'; }
        return 'Saved ✓';
      } },
      { label: 'Revert', onClick: () => {
        try { localStorage.removeItem(LAB_STORE); } catch { /* ignore */ }
        applyLab(CANONICAL);
        setCloudsVisible(cloudsVisible);
        setAutoRotate(autoRotate);
        setShowChunks(showChunks);
        mountSelected();
        handle.panel.sync();
        return 'Ideal restored';
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
  let acceptCam: PerspectiveCamera | null = null;
  if (engine === 'continuum') {
    attachContinuumAcceptApi({
      getGlobe: () => {
        const g = globes.get(selected);
        return g instanceof ContinuumGlobe ? g : null;
      },
      getCamera: () => acceptCam,
      getSunDir: () => sunDir,
      setSunDir: (x, y, z) => {
        sunDir.set(x, y, z);
        if (sunDir.lengthSq() < 1e-12) sunDir.set(0.6, 0.35, 0.72).normalize();
        else sunDir.normalize();
      },
      setAutoRotate,
      setCloudsVisible,
    });
  }
  const handle: PlanetLabHandle = {
    panel,
    // Open at the official close-zoom perf / tuning distance (HUD ≈ 0.8 AU).
    framingZoom: zoomForPhysicalAu(PERF_BASELINE_AU),
    get engine() { return engine; },
    selectedGlobe: () => globes.get(selected) ?? null,
    update(ctx) {
      acceptCam = ctx.camera as PerspectiveCamera;
      // Key light + visible sun along sunDir (continuum atmos uses this).
      _root.copy(ctx.rootWorld);
      const sunDist = LAB_VIEW_R * LAB_SUN_SEPARATION;
      _sun.copy(sunDir).multiplyScalar(sunDist).add(_root);
      labSun.position.copy(_sun);
      labSun.scale.setScalar(1);
      const full: UpdateCtx = { camera: ctx.camera, sunWorldPos: _sun, dt: ctx.dt, fovYRad: ctx.fovYRad, viewportH: ctx.viewportH };
      const au = physicalAuFromZoom(Game.data.zoomLevel);
      for (const g of globes.values()) {
        if (g instanceof ContinuumGlobe) g.setViewDistanceAu(au);
        g.update(full);
      }
    },
    renderOverlays(renderer, camera) {
      if (engine !== 'continuum') return;
      const g = globes.get(selected);
      if (g instanceof ContinuumGlobe) g.renderOverlays(renderer, camera);
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      parent.remove(labSun);
      labSun.geometry.dispose();
      (labSun.material as MeshBasicMaterial).dispose();
      labSunGlow.geometry.dispose();
      (labSunGlow.material as MeshBasicMaterial).dispose();
      for (const g of globes.values()) { parent.remove(g.root); g.dispose(); }
      globes.clear();
      panel.destroy();
    },
  };
  // Dev hook: bake the selected globe (legacy) or invalidate chunks (continuum).
  (window as unknown as { __labBake?: (on: boolean) => void }).__labBake = (on: boolean) => {
    baked[selected] = on;
    const g = globes.get(selected);
    if (!g) return;
    if (engine === 'continuum') {
      (g as ContinuumGlobe).invalidateChunks();
    } else {
      (g as PlanetGlobe).setBaked(on, on ? { res: 128, droplets: 0, thermalIters: 0 } : bakeParams);
    }
  };
  // Dev hook: age the selected globe's storms past fade-in (verify full-strength
  // cyclones without waiting out the ramp — see globe.stormsMature).
  (window as unknown as { __labStorms?: () => void }).__labStorms = () => { globes.get(selected)?.stormsMature(); };
  (window as unknown as { __labGlobe?: () => LabBody | null }).__labGlobe = () => globes.get(selected) ?? null;
  return handle;
}
