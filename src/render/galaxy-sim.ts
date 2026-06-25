// ═══════════════════════════════════════════════════════════════════
// GALAXY SIM — a standalone, hand-tunable view of the NEW physically-generated galaxy (galaxy-physical.ts).
// No sectors, no image, no paint tools: one globally-sampled star set (disc + bulge + bar + density-wave
// arms + knots) at the scene origin, a free-fly camera, and a control panel exposing the geometry/colour
// knobs so the look can be dialled by hand. Load with ?galaxy-sim. (Rotation + dust are layered on next.)
// ═══════════════════════════════════════════════════════════════════

import { Group, PerspectiveCamera, Points, Scene, ShaderMaterial } from 'three';
import { OrbitFlyCamera } from './galaxy-paint';
import {
  samplePhysicalGalaxy, buildPhysicalGalaxyPoints, DEFAULT_PHYSICAL_CONFIG,
  type PhysicalGalaxyConfig, type PhysicalGalaxyData,
} from './galaxy-physical';
import type { RendererContext } from './renderer';

export interface GalaxySim {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly cam: OrbitFlyCamera;
  data: PhysicalGalaxyData;
  readonly cfg: PhysicalGalaxyConfig;
}

/** One tunable knob: a config key, its UI range, and an optional display scale (e.g. count in millions). */
interface Knob {
  label: string;
  key: keyof PhysicalGalaxyConfig;
  min: number;
  max: number;
  step: number;
  scale?: number; // cfg value = slider value × scale (default 1)
  unit?: string;
}

const KNOBS: Knob[] = [
  { label: 'stars', key: 'count', min: 0.3, max: 3, step: 0.1, scale: 1e6, unit: 'M' },
  { label: 'arms (m)', key: 'armCount', min: 1, max: 5, step: 1 },
  { label: 'pitch', key: 'armPitch_deg', min: 5, max: 32, step: 1, unit: '°' },
  { label: 'arm contrast', key: 'armContrast', min: 0, max: 1, step: 0.05 },
  { label: 'flocculence', key: 'armNoise', min: 0, max: 1.2, step: 0.05 },
  { label: 'noise scale', key: 'armNoiseScale', min: 0.1, max: 1.5, step: 0.05 },
  { label: 'arm blue', key: 'armBlue', min: 0, max: 1, step: 0.05 },
  { label: 'knots', key: 'clumpFraction', min: 0, max: 0.4, step: 0.01 },
  { label: 'bulge', key: 'bulgeFraction', min: 0, max: 0.4, step: 0.01 },
  { label: 'bar amount', key: 'barFraction', min: 0, max: 0.25, step: 0.01 },
  { label: 'bar length', key: 'barLength_kpc', min: 0, max: 8, step: 0.2, unit: 'kpc' },
];

const PREVIEW_COUNT = 550_000; // fast resample while dragging; full count on release

/** Boot the standalone physical-galaxy view. `shouldRun` (the boot-gen check) self-terminates on HMR. */
export function bootGalaxySim(renderCtx: RendererContext, shouldRun: () => boolean): GalaxySim {
  const scene = new Scene();
  const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 100, 2e8);
  const root = new Group();
  root.name = 'galaxy-sim-root';
  scene.add(root);

  const cfg: PhysicalGalaxyConfig = { ...DEFAULT_PHYSICAL_CONFIG };
  let seed = 1;
  let current: { points: Points; material: ShaderMaterial } | null = null;

  const sim = { scene, camera } as GalaxySim;

  const rebuild = (count = cfg.count): void => {
    if (current) {
      root.remove(current.points);
      current.points.geometry.dispose();
      current.material.dispose();
    }
    const data = samplePhysicalGalaxy({ ...cfg, count }, seed);
    current = buildPhysicalGalaxyPoints(data);
    root.add(current.points);
    sim.data = data;
  };
  rebuild();

  const cam = new OrbitFlyCamera(camera, renderCtx.canvas, 3.4e7); // frames the ~32 kpc disc
  (sim as { cam: OrbitFlyCamera }).cam = cam;
  (sim as { cfg: PhysicalGalaxyConfig }).cfg = cfg;

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

  // ── Control panel ──
  const hud = document.createElement('div');
  hud.id = 'galsim-hud';
  hud.style.cssText = 'position:fixed;top:14px;left:14px;z-index:100000;width:210px;padding:12px 14px;'
    + 'background:rgba(12,15,20,0.9);border:1px solid #2a3340;border-radius:8px;color:#cfd8e3;'
    + 'font:12px/1.5 ui-monospace,SFMono-Regular,monospace;letter-spacing:0.02em;user-select:none;'
    + 'max-height:calc(100vh - 28px);overflow:auto';
  let html = '<div style="font-weight:600;letter-spacing:0.08em;margin-bottom:8px;color:#eaf0f7">GALAXY&nbsp;SIM</div>';
  for (const k of KNOBS) {
    const v = (cfg[k.key] as number) / (k.scale ?? 1);
    html += `<div style="margin-top:7px;display:flex;justify-content:space-between"><span>${k.label}</span>`
      + `<span id="gs-v-${k.key}" style="opacity:0.8">${v}${k.unit ?? ''}</span></div>`
      + `<input id="gs-${k.key}" type="range" min="${k.min}" max="${k.max}" step="${k.step}" value="${v}" style="width:100%;accent-color:#6aa3ff">`;
  }
  html += '<button id="gs-reseed" style="margin-top:10px;width:100%;padding:6px;background:#1c2530;color:#cfd8e3;'
    + 'border:1px solid #34404e;border-radius:5px;cursor:pointer;font:inherit">Re-seed</button>'
    + '<div style="margin-top:8px;opacity:0.55;font-size:11px">drag/2-finger orbit · pinch/wheel zoom</div>';
  hud.innerHTML = html;
  document.body.appendChild(hud);

  let pending = false;
  const previewRebuild = (): void => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; rebuild(Math.min(cfg.count, PREVIEW_COUNT)); });
  };
  for (const k of KNOBS) {
    const el = hud.querySelector<HTMLInputElement>(`#gs-${k.key}`)!;
    const lbl = hud.querySelector(`#gs-v-${k.key}`)!;
    const set = (): void => {
      const val = +el.value;
      (cfg[k.key] as number) = val * (k.scale ?? 1);
      lbl.textContent = `${val}${k.unit ?? ''}`;
    };
    el.addEventListener('input', () => { set(); previewRebuild(); });
    el.addEventListener('change', () => { set(); rebuild(); }); // full count on release
  }
  hud.querySelector<HTMLButtonElement>('#gs-reseed')!.addEventListener('click', () => { seed++; rebuild(); });

  (globalThis as Record<string, unknown>).__galsim = sim;
  console.info(`[galaxy-sim] ${cfg.count.toLocaleString()} stars — physically sampled; tune via the panel`);

  function loop(): void {
    if (!shouldRun()) {
      cam.dispose();
      if (current) { current.points.geometry.dispose(); current.material.dispose(); }
      hud.remove();
      window.removeEventListener('resize', onResize);
      return;
    }
    requestAnimationFrame(loop);
    cam.update();
    renderCtx.renderer.render(scene, camera);
  }
  loop();
  return sim;
}
