// ═══════════════════════════════════════════════════════════════════
// PHYSICAL GALAXY — the NEW physically-generated galaxy (galaxy-physical.ts): one globally-sampled star set
// (disc + bulge + bar + density-wave arms + spurs/feathers + knots) at the group origin, with a dust-
// extinction layer and a low-res raymarched gas volume, plus a hand-tuning control panel.
//
//   createPhysicalGalaxy() — the REUSABLE factory: builds stars+dust+cloud into its own root Group, wires
//     the control panel (collapsible sections + Save/Revert persistence), returns { root, update, dispose }.
//     Serves BOTH the standalone ?galaxy-sim harness AND the in-game ?proto-galaxy.
//   bootGalaxySim() — the thin standalone shell (?galaxy-sim): a Scene + free-fly camera + render loop.
//
// PERSISTENCE: the panel's Save stores the current settings to localStorage as INTERIM DEFAULTS (the code
// DEFAULT_* constants are the untouched originals). On next boot the interim defaults load on top of the
// originals, so a saved look persists across reloads. Revert clears the interim → back to the originals.
// Promotion to the live game (folding interim into the code defaults) is a separate, manual step.
// ═══════════════════════════════════════════════════════════════════

import { type Camera, Group, PerspectiveCamera, Points, Scene, ShaderMaterial, Vector3 } from 'three';
import { OrbitFlyCamera } from './galaxy-paint';
import { WU_PER_PC } from '../core/metrics';
import { MW, KMS_PER_KPC_TO_RAD_PER_MYR } from './mw-model';
import {
  samplePhysicalGalaxy, buildPhysicalGalaxyPoints, sampleDust, buildDustPoints,
  DEFAULT_PHYSICAL_CONFIG, DEFAULT_DUST_CONFIG,
  type PhysicalGalaxyConfig, type PhysicalGalaxyData, type DustConfig,
} from './galaxy-physical';
import { buildGalaxyCloud, DEFAULT_CLOUD_CONFIG, type GalaxyCloud, type CloudConfig } from './galaxy-cloud';
import type { RendererContext } from './renderer';

/** A self-contained physical galaxy: stars + dust + gas in `root`, tuned by an optional panel. */
export interface PhysicalGalaxySystem {
  readonly root: Group;                 // add to a scene (standalone) or the galactic-tier frame (in-game)
  readonly cfg: PhysicalGalaxyConfig;    // live config (panel mutates this)
  readonly data: PhysicalGalaxyData;     // current sampled star set
  /** Per frame: rigid pattern rotation (time-warp) + the cloud's world→local refresh. Call after the
   *  caller has positioned `root`. `cloudActive` lets the in-game host skip the raymarch when zoomed away. */
  update(camera: Camera, dtSeconds: number, cloudActive?: boolean): void;
  dispose(): void;
}

/** One panel slider: a value getter/setter onto some config, its UI range, and whether it applies LIVE
 *  (no resample) or triggers a resample. Generic over which config object it targets. */
interface Ctrl {
  label: string;
  min: number;
  max: number;
  step: number;
  scale?: number; // displayed value = real value / scale (e.g. stars in millions)
  unit?: string;
  get: () => number;
  set: (v: number) => void;
  live?: () => void; // present ⇒ a LIVE control (apply on input, never resample)
}
interface Section { title: string; key: string; ctrls: Ctrl[] }

const PREVIEW_COUNT = 550_000; // fast resample while dragging; full count on release
const KPC_WU = 1000 * WU_PER_PC; // unified frame: 1 kpc = 1e6 WU (matches galaxy-physical positions)
const _camPos = new Vector3();
const _ctr = new Vector3();

/** Distance-ramped raymarch step count (quick-win perf): the diffuse gas needs FEW steps — ~14 when the
 *  disc fills the view, ramping to ~6 when it's small/far, and 0 when off (intensity 0 or zoomed away). The
 *  bake (phase 2) makes each step a single texture fetch; this just cuts the count the live FBM march pays. */
function cloudSteps(camera: Camera, root: Group, rMax_kpc: number, active: boolean): number {
  if (!active) return 0;
  camera.getWorldPosition(_camPos);
  root.getWorldPosition(_ctr);
  const rel = _camPos.distanceTo(_ctr) / Math.max(1, rMax_kpc * KPC_WU); // ~1 at the rim, grows when far
  return Math.max(6, Math.min(14, Math.round(16 - rel * 4)));
}
const STORE_KEY = 'legion.galaxy.interim';   // saved interim defaults (cfg/dust/cloud)
const COLLAPSE_KEY = 'legion.galaxy.collapsed'; // which panel sections are collapsed

type StarDust = { points: Points; material: ShaderMaterial; dust: Points; dustMat: ShaderMaterial };

/** Build a physical galaxy into its own root Group (+ optional tuning panel). Caller adds `root` to a scene
 *  and drives update(). The spiral pattern rotates rigidly at Ωp when the time-warp slider is non-zero. */
export function createPhysicalGalaxy(opts: { withPanel?: boolean } = {}): PhysicalGalaxySystem {
  const withPanel = opts.withPanel ?? true;
  const root = new Group();
  root.name = 'physical-galaxy';

  const cfg: PhysicalGalaxyConfig = { ...DEFAULT_PHYSICAL_CONFIG };
  const dustCfg: DustConfig = { ...DEFAULT_DUST_CONFIG };
  const cloudCfg: CloudConfig = { ...DEFAULT_CLOUD_CONFIG };
  let dustOpacity = 1.0;  // live opacity scale (uOpacityScale)
  let warp = 0;           // warp rate (Myr per real second); 0 = frozen "moment in time"
  // Interim defaults (a previously-Saved look) load on top of the code originals so they persist per browser.
  try {
    const j = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as
      { cfg?: Partial<PhysicalGalaxyConfig>; dust?: Partial<DustConfig>; cloud?: Partial<CloudConfig>; dustOpacity?: number } | null;
    if (j) {
      Object.assign(cfg, j.cfg ?? {});
      Object.assign(dustCfg, j.dust ?? {});
      Object.assign(cloudCfg, j.cloud ?? {});
      if (typeof j.dustOpacity === 'number') dustOpacity = j.dustOpacity;
    }
  } catch { /* corrupt storage → originals */ }

  let cloud: GalaxyCloud | null = null;
  let seed = 1;
  let current: StarDust | null = null;
  let data: PhysicalGalaxyData;
  // The spiral pattern rotates rigidly at the pattern speed Ωp (rad/Myr) — that's what a density wave does
  // and it never winds; individual stars streaming THROUGH the pattern is a finer (per-star) refinement.
  const patternOmega = MW.spiralPatternSpeed_kms_kpc * KMS_PER_KPC_TO_RAD_PER_MYR;

  const rebuild = (count = cfg.count): void => {
    if (current) {
      root.remove(current.points); current.points.geometry.dispose(); current.material.dispose();
      root.remove(current.dust); current.dust.geometry.dispose(); current.dustMat.dispose();
    }
    data = samplePhysicalGalaxy({ ...cfg, count }, seed);
    const g = buildPhysicalGalaxyPoints(data);
    const frac = Math.max(0.1, count / cfg.count); // thin the dust on the preview resample too
    const dd = sampleDust(cfg, { ...dustCfg, dustCount: Math.round(dustCfg.dustCount * frac) }, seed);
    const d = buildDustPoints(dd);
    d.material.uniforms.uOpacityScale.value = dustOpacity;
    root.add(g.points);
    root.add(d.points);
    current = { points: g.points, material: g.material, dust: d.points, dustMat: d.material };
    if (cloud) cloud.sync(cfg, cloudCfg); // re-trace the gas onto the (possibly retuned) arms
  };
  rebuild();
  cloud = buildGalaxyCloud(cfg, cloudCfg); // gas/nebulosity volume — created once, rides the rotating root
  root.add(cloud.mesh);

  let hud: HTMLDivElement | null = null;
  let pending = false;
  const previewRebuild = (): void => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; rebuild(Math.min(cfg.count, PREVIEW_COUNT)); });
  };

  if (withPanel) {
    // ── declarative controls, grouped into collapsible sections ──
    const num = (
      key: keyof PhysicalGalaxyConfig, label: string, min: number, max: number, step: number,
      scale?: number, unit?: string,
    ): Ctrl => ({
      label, min, max, step, ...(scale !== undefined ? { scale } : {}), ...(unit !== undefined ? { unit } : {}),
      get: () => (cfg[key] as number) / (scale ?? 1),
      set: (v) => { (cfg[key] as number) = v * (scale ?? 1); },
    });
    const dnum = (
      key: keyof DustConfig, label: string, min: number, max: number, step: number, unit?: string,
    ): Ctrl => ({
      label, min, max, step, ...(unit !== undefined ? { unit } : {}),
      get: () => dustCfg[key] as number,
      set: (v) => { (dustCfg[key] as number) = v; },
    });
    const sections: Section[] = [
      { title: 'Disc & Arms', key: 'disc', ctrls: [
        num('count', 'stars', 0.3, 3, 0.1, 1e6, 'M'),
        num('armCount', 'arms (m)', 1, 5, 1),
        num('armPitch_deg', 'pitch', 5, 32, 1, undefined, '°'),
        num('armContrast', 'arm contrast', 0, 1, 0.05),
        num('armWidth', 'arm width', 0.3, 1, 0.05),
        num('armNoise', 'flocculence', 0, 1.2, 0.05),
        num('armNoiseScale', 'noise scale', 0.1, 1.5, 0.05),
        num('armBlue', 'arm blue', 0, 1, 0.05),
        num('bulgeFraction', 'bulge', 0, 0.4, 0.01),
        num('barFraction', 'bar amount', 0, 0.25, 0.01),
        num('barLength_kpc', 'bar length', 0, 8, 0.2, undefined, 'kpc'),
        num('rimFeather', 'rim feather', 0, 1, 0.05),
      ] },
      { title: 'Spurs & Feathers', key: 'spurs', ctrls: [
        num('armSpurAmp', 'spurs', 0, 0.8, 0.05),
        num('armSpurOpen', 'spur open', 1.3, 3, 0.1),
        num('armSpurDensity', 'spur count', 2, 6, 0.1),
        num('armSpurSharp', 'spur sharp', 1.5, 6, 0.1),
        num('armSpurWarp', 'spur warp', 0, 0.6, 0.05),
        num('armSpurInterArm', 'inter-arm', 0, 0.6, 0.05),
        num('armSpurFlank', 'spur flank', 0.1, 1, 0.05),
        num('armSpurReach', 'spur reach', 0.2, 0.9, 0.05),
      ] },
      { title: 'Stars', key: 'stars', ctrls: [
        num('starProminence', 'prominence', 0, 1, 0.05),
        num('starFaintDim', 'faint dim', 0, 1, 0.05),
        num('clumpFraction', 'clusters', 0, 0.4, 0.01),
        num('clumpScale_pc', 'cluster size', 60, 600, 10, undefined, 'pc'),
        num('clusterArm', 'cluster arm', 0, 1, 0.05),
      ] },
      { title: 'Dust', key: 'dust', ctrls: [
        { label: 'dust', min: 0, max: 2.5, step: 0.1, get: () => dustOpacity, set: (v) => { dustOpacity = v; },
          live: () => { if (current) current.dustMat.uniforms.uOpacityScale.value = dustOpacity; } },
        dnum('dustLeadDeg', 'dust lead', -40, 40, 2, '°'),
        dnum('dustThickness', 'dust thickness', 0.02, 1, 0.02),
        dnum('dustSegment', 'dust segments', 0, 1, 0.05),
        dnum('dustSegmentScale', 'segment freq', 0.6, 6, 0.2),
        dnum('dustFilament', 'dust tendrils', 0, 1, 0.05),
        dnum('dustFeather', 'dust feather', 0, 1.5, 0.05),
      ] },
      { title: 'Gas', key: 'gas', ctrls: [
        { label: 'gas clouds', min: 0, max: 2, step: 0.05, get: () => cloudCfg.intensity, set: (v) => { cloudCfg.intensity = v; },
          live: () => { if (cloud) cloud.material.uniforms.uIntensity!.value = cloudCfg.intensity; } },
      ] },
      { title: 'Motion', key: 'motion', ctrls: [
        { label: 'time warp', min: 0, max: 15, step: 0.5, unit: ' Myr/s', get: () => warp, set: (v) => { warp = v; }, live: () => {} },
      ] },
    ];

    const collapsed = new Set<string>((() => {
      try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]') as string[]; } catch { return []; }
    })());

    hud = document.createElement('div');
    hud.id = 'galsim-hud';
    hud.style.cssText = 'position:fixed;top:14px;left:14px;z-index:100000;width:212px;padding:10px 12px;'
      + 'background:rgba(12,15,20,0.92);border:1px solid #2a3340;border-radius:8px;color:#cfd8e3;'
      + 'font:12px/1.5 ui-monospace,SFMono-Regular,monospace;letter-spacing:0.02em;user-select:none;'
      + 'max-height:calc(100vh - 28px);overflow:auto';
    const existing = document.getElementById('galsim-hud');
    if (existing) existing.replaceWith(hud); else document.body.appendChild(hud); // self-clean on HMR/re-boot

    const title = document.createElement('div');
    title.style.cssText = 'font-weight:600;letter-spacing:0.08em;margin-bottom:6px;color:#eaf0f7';
    title.textContent = 'GALAXY';
    hud.appendChild(title);

    const refreshers: Array<() => void> = []; // re-sync every slider's value+label (used by Revert)

    const addCtrl = (host: HTMLElement, c: Ctrl): void => {
      const row = document.createElement('div');
      row.style.cssText = 'margin-top:6px;display:flex;justify-content:space-between';
      const name = document.createElement('span'); name.textContent = c.label;
      const val = document.createElement('span'); val.style.opacity = '0.8';
      row.append(name, val);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(c.min); input.max = String(c.max); input.step = String(c.step);
      input.style.cssText = 'width:100%;accent-color:#6aa3ff';
      const fmt = (v: number): string => `${Number.isInteger(c.step) && !c.scale ? v : +v.toFixed(2)}${c.unit ?? ''}`;
      const sync = (): void => { const v = c.get(); input.value = String(v); val.textContent = fmt(v); };
      sync();
      input.addEventListener('input', () => {
        c.set(+input.value); val.textContent = fmt(+input.value);
        if (c.live) c.live(); else previewRebuild();
      });
      if (!c.live) input.addEventListener('change', () => { rebuild(); });
      host.append(row, input);
      refreshers.push(sync);
    };

    for (const sec of sections) {
      const header = document.createElement('div');
      header.style.cssText = 'margin-top:9px;padding-top:6px;border-top:1px solid #222b36;cursor:pointer;'
        + 'display:flex;justify-content:space-between;color:#9fb0c3;font-size:11px;letter-spacing:0.06em';
      const body = document.createElement('div');
      const caret = document.createElement('span');
      const label = document.createElement('span'); label.textContent = sec.title.toUpperCase();
      header.append(label, caret);
      const setOpen = (open: boolean): void => { body.style.display = open ? '' : 'none'; caret.textContent = open ? '▾' : '▸'; };
      setOpen(!collapsed.has(sec.key));
      header.addEventListener('click', () => {
        const open = body.style.display === 'none';
        setOpen(open);
        if (open) collapsed.delete(sec.key); else collapsed.add(sec.key);
        try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed])); } catch { /* ignore */ }
      });
      hud.append(header, body);
      for (const c of sec.ctrls) addCtrl(body, c);
    }

    // ── footer: Re-seed · Save (interim defaults) · Revert (originals) ──
    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top:11px;border-top:1px solid #2a3340;padding-top:8px;display:flex;gap:5px';
    const btn = (text: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = text;
      b.style.cssText = 'flex:1;padding:6px 2px;background:#1c2530;color:#cfd8e3;border:1px solid #34404e;'
        + 'border-radius:5px;cursor:pointer;font:inherit;font-size:11px';
      b.addEventListener('click', onClick);
      return b;
    };
    const flash = (b: HTMLButtonElement, text: string): void => {
      const orig = b.textContent; b.textContent = text;
      setTimeout(() => { b.textContent = orig; }, 900);
    };
    const saveBtn = btn('Save', () => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ cfg, dust: dustCfg, cloud: cloudCfg, dustOpacity }));
        flash(saveBtn, 'Saved ✓');
      } catch { flash(saveBtn, 'Failed'); }
    });
    const revertBtn = btn('Revert', () => {
      try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
      Object.assign(cfg, DEFAULT_PHYSICAL_CONFIG);
      Object.assign(dustCfg, DEFAULT_DUST_CONFIG);
      Object.assign(cloudCfg, DEFAULT_CLOUD_CONFIG);
      dustOpacity = 1.0; warp = 0;
      for (const r of refreshers) r();
      if (cloud) cloud.material.uniforms.uIntensity!.value = cloudCfg.intensity;
      rebuild();
      flash(revertBtn, 'Originals');
    });
    footer.append(btn('Re-seed', () => { seed++; rebuild(); }), saveBtn, revertBtn);
    hud.appendChild(footer);

    const help = document.createElement('div');
    help.style.cssText = 'margin-top:7px;opacity:0.5;font-size:10px';
    help.textContent = 'Save → interim defaults · Revert → originals';
    hud.appendChild(help);
  }

  const update = (camera: Camera, dt: number, cloudActive = true): void => {
    if (warp !== 0) root.rotation.y += patternOmega * warp * dt; // rigid pattern rotation (no winding)
    const steps = cloudSteps(camera, root, cfg.rMax_kpc, cloudActive && cloudCfg.intensity > 0);
    if (cloud) cloud.update(camera, steps);
  };
  const dispose = (): void => {
    if (current) {
      root.remove(current.points); current.points.geometry.dispose(); current.material.dispose();
      root.remove(current.dust); current.dust.geometry.dispose(); current.dustMat.dispose();
    }
    if (cloud) { root.remove(cloud.mesh); cloud.mesh.geometry.dispose(); cloud.material.dispose(); }
    hud?.remove();
  };

  return { root, cfg, get data() { return data; }, update, dispose };
}

/** Standalone harness (?galaxy-sim): a Scene + free-fly camera + render loop around one physical galaxy. */
export function bootGalaxySim(renderCtx: RendererContext, shouldRun: () => boolean): unknown {
  const scene = new Scene();
  const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 100, 2e8);
  const galaxy = createPhysicalGalaxy({ withPanel: true });
  scene.add(galaxy.root);

  const cam = new OrbitFlyCamera(camera, renderCtx.canvas, 3.4e7); // frames the ~32 kpc disc

  // Stop the browser hijacking a two-finger trackpad swipe over the sim as back/forward/new-tab navigation
  // (the canvas itself is hardened with touch-action in OrbitFlyCamera). Restored on teardown.
  const prevOverscroll = document.body.style.overscrollBehavior;
  document.body.style.overscrollBehavior = 'none';

  const onResize = (): void => {
    renderCtx.renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);
  onResize();

  for (const id of ['hud', 'dot-grid', 'hover-tip', 'dest-mode-indicator']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  const sim = { scene, camera, cam, galaxy, get cfg() { return galaxy.cfg; }, get data() { return galaxy.data; } };
  (globalThis as Record<string, unknown>).__galsim = sim;
  console.info(`[galaxy-sim] ${galaxy.cfg.count.toLocaleString()} stars — physically sampled; tune via the panel`);

  let lastMs = 0;
  function loop(): void {
    if (!shouldRun()) {
      cam.dispose();
      galaxy.dispose();
      window.removeEventListener('resize', onResize);
      document.body.style.overscrollBehavior = prevOverscroll;
      return;
    }
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = lastMs ? (now - lastMs) / 1000 : 0;
    lastMs = now;
    galaxy.update(camera, dt);
    cam.update();
    renderCtx.renderer.render(scene, camera);
  }
  loop();
  return sim;
}
