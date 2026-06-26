// ═══════════════════════════════════════════════════════════════════
// PHYSICAL GALAXY — the NEW physically-generated galaxy (galaxy-physical.ts): one globally-sampled star set
// (disc + bulge + bar + density-wave arms + spurs/feathers + knots) at the group origin, with a dust-
// extinction layer and a low-res raymarched gas volume, plus a hand-tuning control panel.
//
//   createPhysicalGalaxy() — the REUSABLE factory: builds stars+dust+cloud into its own root Group, wires
//     the control panel, and returns { root, update, dispose }. The CALLER owns where the root lives and
//     when update() runs, so it serves BOTH the standalone ?galaxy-sim harness AND the in-game ?proto-galaxy
//     (where the root rides the galactic-tier floating origin alongside the legacy markers).
//   bootGalaxySim() — the thin standalone shell (?galaxy-sim): a Scene + free-fly camera + render loop
//     around one createPhysicalGalaxy(), for tuning in isolation.
// ═══════════════════════════════════════════════════════════════════

import { type Camera, Group, PerspectiveCamera, Points, Scene, ShaderMaterial } from 'three';
import { OrbitFlyCamera } from './galaxy-paint';
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
  { label: 'arm width', key: 'armWidth', min: 0.3, max: 1, step: 0.05 },
  { label: 'flocculence', key: 'armNoise', min: 0, max: 1.2, step: 0.05 },
  { label: 'noise scale', key: 'armNoiseScale', min: 0.1, max: 1.5, step: 0.05 },
  { label: 'arm blue', key: 'armBlue', min: 0, max: 1, step: 0.05 },
  { label: 'knots', key: 'clumpFraction', min: 0, max: 0.4, step: 0.01 },
  { label: 'bulge', key: 'bulgeFraction', min: 0, max: 0.4, step: 0.01 },
  { label: 'bar amount', key: 'barFraction', min: 0, max: 0.25, step: 0.01 },
  { label: 'bar length', key: 'barLength_kpc', min: 0, max: 8, step: 0.2, unit: 'kpc' },
  { label: 'rim feather', key: 'rimFeather', min: 0, max: 1, step: 0.05 },
  { label: 'spurs', key: 'armSpurAmp', min: 0, max: 0.8, step: 0.05 },
  { label: 'spur open', key: 'armSpurOpen', min: 1.3, max: 3, step: 0.1 },
  { label: 'spur count', key: 'armSpurDensity', min: 2, max: 6, step: 0.1 },
  { label: 'spur sharp', key: 'armSpurSharp', min: 1.5, max: 6, step: 0.1 },
  { label: 'spur warp', key: 'armSpurWarp', min: 0, max: 0.6, step: 0.05 },
  { label: 'inter-arm', key: 'armSpurInterArm', min: 0, max: 0.6, step: 0.05 },
  { label: 'spur flank', key: 'armSpurFlank', min: 0.1, max: 1, step: 0.05 },
  { label: 'spur reach', key: 'armSpurReach', min: 0.2, max: 0.9, step: 0.05 },
];

const PREVIEW_COUNT = 550_000; // fast resample while dragging; full count on release

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
  let cloud: GalaxyCloud | null = null;
  let seed = 1;
  let dustOpacity = 1.0;  // live opacity scale (uOpacityScale)
  let warp = 0;           // warp rate (Myr per real second); 0 = frozen "moment in time"
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
    document.getElementById('galsim-hud')?.remove(); // drop any stale panel (HMR / re-boot)
    hud = document.createElement('div');
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
    html += '<div style="margin-top:9px;border-top:1px solid #2a3340;padding-top:7px;display:flex;justify-content:space-between">'
      + '<span>dust</span><span id="gs-v-dust" style="opacity:0.8">1.0</span></div>'
      + '<input id="gs-dust" type="range" min="0" max="2.5" step="0.1" value="1" style="width:100%;accent-color:#6aa3ff">'
      + '<div style="margin-top:5px;display:flex;justify-content:space-between"><span>dust lead</span><span id="gs-v-dlead" style="opacity:0.8">18°</span></div>'
      + '<input id="gs-dlead" type="range" min="-40" max="40" step="2" value="18" style="width:100%;accent-color:#6aa3ff">'
      + '<div style="margin-top:5px;display:flex;justify-content:space-between"><span>dust thickness</span><span id="gs-v-dthk" style="opacity:0.8">0.16</span></div>'
      + '<input id="gs-dthk" type="range" min="0.02" max="1" step="0.02" value="0.16" style="width:100%;accent-color:#6aa3ff">'
      + '<div style="margin-top:5px;display:flex;justify-content:space-between"><span>dust segments</span><span id="gs-v-dseg" style="opacity:0.8">0.55</span></div>'
      + '<input id="gs-dseg" type="range" min="0" max="1" step="0.05" value="0.55" style="width:100%;accent-color:#6aa3ff">'
      + '<div style="margin-top:5px;display:flex;justify-content:space-between"><span>segment freq</span><span id="gs-v-dsegs" style="opacity:0.8">3.0</span></div>'
      + '<input id="gs-dsegs" type="range" min="0.6" max="6" step="0.2" value="3.0" style="width:100%;accent-color:#6aa3ff">'
      + '<div style="margin-top:5px;display:flex;justify-content:space-between"><span>dust tendrils</span><span id="gs-v-dfil" style="opacity:0.8">0.7</span></div>'
      + '<input id="gs-dfil" type="range" min="0" max="1" step="0.05" value="0.7" style="width:100%;accent-color:#6aa3ff">'
      + '<div style="margin-top:5px;display:flex;justify-content:space-between"><span>dust feather</span><span id="gs-v-dfth" style="opacity:0.8">0.6</span></div>'
      + '<input id="gs-dfth" type="range" min="0" max="1.5" step="0.05" value="0.6" style="width:100%;accent-color:#6aa3ff">'
      + '<div style="margin-top:5px;display:flex;justify-content:space-between"><span>gas clouds</span><span id="gs-v-cloud" style="opacity:0.8">0.9</span></div>'
      + '<input id="gs-cloud" type="range" min="0" max="2" step="0.05" value="0.9" style="width:100%;accent-color:#6aa3ff">';
    html += '<div style="margin-top:9px;border-top:1px solid #2a3340;padding-top:7px;display:flex;justify-content:space-between">'
      + '<span>time warp</span><span id="gs-v-warp" style="opacity:0.8">0 Myr/s</span></div>'
      + '<input id="gs-warp" type="range" min="0" max="15" step="0.5" value="0" style="width:100%;accent-color:#6aa3ff">';
    html += '<button id="gs-reseed" style="margin-top:10px;width:100%;padding:6px;background:#1c2530;color:#cfd8e3;'
      + 'border:1px solid #34404e;border-radius:5px;cursor:pointer;font:inherit">Re-seed</button>'
      + '<div style="margin-top:8px;opacity:0.55;font-size:11px">drag/2-finger orbit · pinch/wheel zoom</div>';
    hud.innerHTML = html;
    document.body.appendChild(hud);

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
    const dustEl = hud.querySelector<HTMLInputElement>('#gs-dust')!;
    dustEl.addEventListener('input', () => {
      dustOpacity = +dustEl.value;
      hud!.querySelector('#gs-v-dust')!.textContent = dustOpacity.toFixed(1);
      if (current) current.dustMat.uniforms.uOpacityScale.value = dustOpacity; // live, no resample
    });
    const dleadEl = hud.querySelector<HTMLInputElement>('#gs-dlead')!;
    dleadEl.addEventListener('input', () => {
      dustCfg.dustLeadDeg = +dleadEl.value;
      hud!.querySelector('#gs-v-dlead')!.textContent = `${dleadEl.value}°`;
      previewRebuild();
    });
    dleadEl.addEventListener('change', () => { rebuild(); });
    const dthkEl = hud.querySelector<HTMLInputElement>('#gs-dthk')!;
    dthkEl.addEventListener('input', () => {
      dustCfg.dustThickness = +dthkEl.value;
      hud!.querySelector('#gs-v-dthk')!.textContent = (+dthkEl.value).toFixed(2);
      previewRebuild();
    });
    dthkEl.addEventListener('change', () => { rebuild(); });
    const dsegEl = hud.querySelector<HTMLInputElement>('#gs-dseg')!;
    dsegEl.addEventListener('input', () => {
      dustCfg.dustSegment = +dsegEl.value;
      hud!.querySelector('#gs-v-dseg')!.textContent = (+dsegEl.value).toFixed(2);
      previewRebuild();
    });
    dsegEl.addEventListener('change', () => { rebuild(); });
    const dsegsEl = hud.querySelector<HTMLInputElement>('#gs-dsegs')!;
    dsegsEl.addEventListener('input', () => {
      dustCfg.dustSegmentScale = +dsegsEl.value;
      hud!.querySelector('#gs-v-dsegs')!.textContent = (+dsegsEl.value).toFixed(1);
      previewRebuild();
    });
    dsegsEl.addEventListener('change', () => { rebuild(); });
    const dfilEl = hud.querySelector<HTMLInputElement>('#gs-dfil')!;
    dfilEl.addEventListener('input', () => {
      dustCfg.dustFilament = +dfilEl.value;
      hud!.querySelector('#gs-v-dfil')!.textContent = (+dfilEl.value).toFixed(2);
      previewRebuild();
    });
    dfilEl.addEventListener('change', () => { rebuild(); });
    const dfthEl = hud.querySelector<HTMLInputElement>('#gs-dfth')!;
    dfthEl.addEventListener('input', () => {
      dustCfg.dustFeather = +dfthEl.value;
      hud!.querySelector('#gs-v-dfth')!.textContent = (+dfthEl.value).toFixed(2);
      previewRebuild();
    });
    dfthEl.addEventListener('change', () => { rebuild(); });
    const cloudEl = hud.querySelector<HTMLInputElement>('#gs-cloud')!;
    cloudEl.addEventListener('input', () => {
      cloudCfg.intensity = +cloudEl.value;
      hud!.querySelector('#gs-v-cloud')!.textContent = (+cloudEl.value).toFixed(2);
      if (cloud) cloud.material.uniforms.uIntensity!.value = cloudCfg.intensity; // live, no resample
    });
    const warpEl = hud.querySelector<HTMLInputElement>('#gs-warp')!;
    warpEl.addEventListener('input', () => {
      warp = +warpEl.value;
      hud!.querySelector('#gs-v-warp')!.textContent = `${warp} Myr/s`;
    });
    hud.querySelector<HTMLButtonElement>('#gs-reseed')!.addEventListener('click', () => { seed++; rebuild(); });
  }

  const update = (camera: Camera, dt: number, cloudActive = true): void => {
    if (warp !== 0) root.rotation.y += patternOmega * warp * dt; // rigid pattern rotation (no winding)
    const steps = cloudActive && cloudCfg.intensity > 0 ? 26 : 0; // skip the march when off/zoomed away
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
