// ═══════════════════════════════════════════════════════════════════
// PHYSICAL GALAXY — the physically-generated galaxy (galaxy-physical.ts): one globally-sampled star set
// (disc + bulge + bar + density-wave arms + spurs/feathers + knots) at the group origin, with a dust-
// extinction layer and a STAR-DERIVED gas layer (a 1/4-count duplicate of the stars re-skinned as soft
// blurred additive puffs).
//
//   createPhysicalGalaxy() — the REUSABLE factory: builds stars+dust+gas into its own root Group and exposes
//     a `controls` schema (sections + Save/Revert/Copy-JSON), rendered by the in-game LAB panel. Returns
//     { root, cfg, data, update, render, controls, dispose }. It is the DEFAULT in-game disc (main.ts).
//
// PERSISTENCE (precedence): DEFAULT_* code constants → SAVED_GALAXY_DEFAULTS (the committed CANONICAL look,
// promoted by pasting the LAB panel's Copy-JSON blob) → localStorage interim (a per-browser Saved override
// that masks the preset until Revert). localStorage is origin-keyed, so it survives refresh + server restart.
// ═══════════════════════════════════════════════════════════════════

import {
  type Camera, Color, DoubleSide, Group, HalfFloatType, LinearFilter, Mesh,
  MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Points, RGBAFormat, Scene,
  ShaderMaterial, SRGBColorSpace, type Texture, TextureLoader, Vector2, Vector3, WebGLRenderTarget, type WebGLRenderer,
} from 'three';
import { WU_PER_PC } from '../core/metrics';
import {
  samplePhysicalGalaxy, buildPhysicalGalaxyPoints, sampleDust, buildDustPoints, sampleStarGas, buildStarGasPoints,
  sampleProminentStars, RIM_MAX,
  DEFAULT_PHYSICAL_CONFIG, DEFAULT_DUST_CONFIG,
  type PhysicalGalaxyConfig, type PhysicalGalaxyData, type DustConfig,
} from './galaxy-physical';

/** A self-contained physical galaxy: stars + dust + gas in `root`, tuned by an optional panel. */
export interface PhysicalGalaxySystem {
  readonly root: Group;                 // add to a scene (standalone) or the galactic-tier frame (in-game)
  readonly cfg: PhysicalGalaxyConfig;    // live config (panel mutates this)
  readonly data: PhysicalGalaxyData;     // current sampled star set
  /** Per frame: rigid pattern rotation (time-warp) + refresh the gas puffs' viewport-height uniform. Call
   *  after the caller has positioned `root`. `cloudActive` is retained for host-API compatibility. */
  update(camera: Camera, dtSeconds: number, cloudActive?: boolean): void;
  /** Render the gas ALONE (isolated on its own layer) to a half-res HDR target and gaussian-blur it, returning
   *  the blurred texture + composite gain for the host's post-processing to add over the scene. Null when the
   *  gas is hidden or blur is off (then the gas renders inline/sharp on layer 0). No-op on the main framebuffer. */
  renderGasBlur(renderer: WebGLRenderer, scene: Scene, camera: Camera): { texture: Texture; gain: number } | null;
  /** The declarative tuning schema + persistence actions — rendered/driven by the in-game LAB panel. */
  readonly controls: GalaxyControls;
  dispose(): void;
}

/** One panel slider: a value getter/setter onto some config, its UI range, and whether it applies LIVE
 *  (no resample) or triggers a resample. Generic over which config object it targets. */
export interface Ctrl {
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
/** A panel on/off switch (an easy per-feature bypass). `live` applies it without a resample; otherwise a
 *  toggle re-bakes like a bake-time slider. */
export interface Toggle {
  kind: 'toggle';
  label: string;
  get: () => boolean;
  set: (v: boolean) => void;
  live?: () => void;
}
export type PanelCtrl = Ctrl | Toggle;
export interface Section { title: string; key: string; ctrls: PanelCtrl[] }

/** The full look as a serialisable payload — the shared shape for the localStorage interim save, the LAB
 *  panel's Copy-JSON promotion, and the committed SAVED_GALAXY_DEFAULTS preset. `warp` is motion, not look. */
export interface GalaxyPreset {
  cfg?: Partial<PhysicalGalaxyConfig>;
  dust?: Partial<DustConfig>;
  gasIntensity?: number;
  dustOpacity?: number;
  gasPuffKpc?: number;
  gasCore?: number;
  gasBlurEnabled?: boolean;
  gasBlurScale?: number;
  gasBlurRadius?: number;
  gasGain?: number;
  prominentEnabled?: boolean;
  prominentCount?: number;
  prominentSize?: number;
  prominentBright?: number;
  prominentVariance?: number;
  cloudEnabled?: boolean;
  starsEnabled?: boolean;
  dustEnabled?: boolean;
}

/** The galaxy's tuning surface, handed to the LAB panel: the declarative section schema plus the persistence
 *  actions (all closing over the galaxy's private state — the panel only renders + calls these). */
export interface GalaxyControls {
  readonly sections: Section[];
  readonly collapseKey: string;   // localStorage key for per-section collapse state
  snapshot(): GalaxyPreset;       // the exact current look as a preset (for Save + Copy-JSON)
  save(): void;                   // persist snapshot() to the interim localStorage key
  revert(): void;                 // clear interim → back to the canonical committed look
  reseed(): void;                 // new random sample
  rebuild(): void;                // full-count resample (bake-time 'change')
  previewRebuild(): void;         // throttled preview resample (bake-time 'input')
}

/** CANONICAL committed look. Empty = ship the DEFAULT_* code look. Paste the LAB panel's Copy-JSON blob here
 *  to promote a tuned look so it ships to every browser/deploy. Precedence: DEFAULT_* → this → localStorage
 *  interim (a per-dev override that masks this until Revert). */
export const SAVED_GALAXY_DEFAULTS: GalaxyPreset = {};

const PREVIEW_COUNT = 550_000; // fast resample while dragging; full count on release
const STORE_KEY = 'legion.galaxy.interim';   // saved interim defaults (cfg/dust/cloud)
const COLLAPSE_KEY = 'legion.galaxy.collapsed'; // which panel sections are collapsed
// Render layers for galaxy sub-layers that the post pipeline composites SEPARATELY (so they aren't washed out
// by the gas). Layer 0 = the base star field (drawn by the main RenderPass). These must match post-processing.ts.
export const GALAXY_GAS_LAYER = 1;       // gas (blur ON) → blurred pre-pass; layer 0 when blur OFF (inline)
export const GALAXY_PROMINENT_LAYER = 2; // prominent standout stars → additive overlay, over the gas
export const GALAXY_DUST_LAYER = 3;      // dust → extinction overlay LAST, darkens the composited stars+gas

type StarDust = {
  points: Points; material: ShaderMaterial; dust: Points; dustMat: ShaderMaterial; gas: Points; gasMat: ShaderMaterial;
  prominent: Points; prominentMat: ShaderMaterial;
};

/** Build a physical galaxy into its own root Group. Caller adds `root` to a scene and drives update(); the
 *  returned `controls` schema is rendered by the LAB panel. The spiral pattern rotates rigidly at Ωp when the
 *  time-warp slider is non-zero. */
export function createPhysicalGalaxy(opts: { renderer?: WebGLRenderer } = {}): PhysicalGalaxySystem {
  const root = new Group();
  root.name = 'physical-galaxy';

  const cfg: PhysicalGalaxyConfig = { ...DEFAULT_PHYSICAL_CONFIG };
  const dustCfg: DustConfig = { ...DEFAULT_DUST_CONFIG };
  let gasIntensity = 2.0; // star-gas per-puff brightness (baked into the puff colour on resample)
  let dustOpacity = 1.0;  // live opacity scale (uOpacityScale)
  let warp = 0;           // warp rate (Myr per real second); 0 = frozen "moment in time"
  let simTimeMyr = 0;     // accumulated galactic time (Myr, float64) → the star/gas orbit uTime uniform
  let cloudEnabled = true; // gas on/off (panel toggle)
  let gasPuffKpc = 1.15;   // star-gas puff DIAMETER (kpc) — bake-time; bigger ⇒ sparse puffs overlap into a smoother mist
  let gasCore = 1.0;       // core-gas volume/brightness multiplier — scales ONLY the nucleus gas, independent of gas intensity
  let starsEnabled = true; // stars on/off (panel toggle — isolate the gas/dust)
  let dustEnabled = true;  // dust on/off (panel toggle)
  // Gas-blur knobs (consumed by renderGasBlur; declared here so the preset/localStorage load can set them).
  let gasBlurEnabled = true; // off ⇒ gas renders inline (sharp puffs, on layer 0)
  let gasBlurScale = 0.5;    // RT resolution vs. framebuffer (lower ⇒ softer + cheaper)
  let gasBlurRadius = 3.0;   // gaussian tap spread (texels at full res; scaled by 1/scale)
  let gasGain = 1.2;         // composite exposure into the value-preserving tone-map
  // Prominent-stars knobs (an independent big/bright standout layer, composited OVER the gas).
  let prominentEnabled = true; // on/off
  let prominentCount = 4000;   // how many standout stars
  let prominentSize = 6.0;     // size multiplier (× base star sprite)
  let prominentBright = 3.0;   // brightness multiplier
  let prominentVariance = 0.7; // 0 = uniform … 1 = a few giants among many small (size+brightness spread)

  // Look precedence: DEFAULT_* (above) → SAVED_GALAXY_DEFAULTS (committed canonical) → localStorage interim (a
  // per-dev Saved override). One helper drives every merge path so the field-set never drifts.
  const applyPreset = (p: GalaxyPreset | null | undefined): void => {
    if (!p) return;
    if (p.cfg) Object.assign(cfg, p.cfg);
    if (p.dust) Object.assign(dustCfg, p.dust);
    if (typeof p.gasIntensity === 'number') gasIntensity = p.gasIntensity;
    if (typeof p.dustOpacity === 'number') dustOpacity = p.dustOpacity;
    if (typeof p.gasPuffKpc === 'number') gasPuffKpc = p.gasPuffKpc;
    if (typeof p.gasCore === 'number') gasCore = p.gasCore;
    if (typeof p.gasBlurEnabled === 'boolean') gasBlurEnabled = p.gasBlurEnabled;
    if (typeof p.gasBlurScale === 'number') gasBlurScale = p.gasBlurScale;
    if (typeof p.gasBlurRadius === 'number') gasBlurRadius = p.gasBlurRadius;
    if (typeof p.gasGain === 'number') gasGain = p.gasGain;
    if (typeof p.prominentEnabled === 'boolean') prominentEnabled = p.prominentEnabled;
    if (typeof p.prominentCount === 'number') prominentCount = p.prominentCount;
    if (typeof p.prominentSize === 'number') prominentSize = p.prominentSize;
    if (typeof p.prominentBright === 'number') prominentBright = p.prominentBright;
    if (typeof p.prominentVariance === 'number') prominentVariance = p.prominentVariance;
    if (typeof p.cloudEnabled === 'boolean') cloudEnabled = p.cloudEnabled;
    if (typeof p.starsEnabled === 'boolean') starsEnabled = p.starsEnabled;
    if (typeof p.dustEnabled === 'boolean') dustEnabled = p.dustEnabled;
  };
  applyPreset(SAVED_GALAXY_DEFAULTS);
  try {
    const j = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as (GalaxyPreset & { cloud?: { intensity?: number } }) | null;
    if (j) {
      if (typeof j.gasIntensity !== 'number' && typeof j.cloud?.intensity === 'number') j.gasIntensity = j.cloud.intensity; // back-compat
      applyPreset(j);
    }
  } catch { /* corrupt storage → committed defaults */ }

  let seed = 4;
  let current: StarDust | null = null;
  let data: PhysicalGalaxyData;

  // ── OPTICAL-COMPARISON reference overlay: the R.Hurt face-on Milky Way as a flat plane laid in the disc plane
  //    at galaxy scale (adjustable opacity/scale/rotation/height), plus a global galaxy-opacity so the render can
  //    be dimmed to compare THROUGH it against the reference. Dev tool; the JPG is a gitignored public/ asset.
  const KPC_TO_WU = 1000 * WU_PER_PC;
  let refEnabled = false, refOpacity = 0.6, refScale = 1, refRotDeg = 0, refYOffset = 0, galaxyOpacity = 1;
  const refTex = new TextureLoader().load('reference/mw-faceon.jpg');
  refTex.colorSpace = SRGBColorSpace;
  const refMat = new MeshBasicMaterial({ map: refTex, transparent: true, opacity: refOpacity, depthWrite: false, depthTest: false, side: DoubleSide, toneMapped: false });
  const refMesh = new Mesh(new PlaneGeometry(1, 1), refMat);
  refMesh.name = 'reference-overlay';
  refMesh.rotation.order = 'YXZ';
  refMesh.rotation.x = -Math.PI / 2;   // lie flat in the XZ disc plane (viewed face-on it overlays the galaxy)
  refMesh.renderOrder = -10;           // draw behind the galaxy
  refMesh.frustumCulled = false;
  refMesh.visible = refEnabled;
  root.add(refMesh);
  const applyRef = (): void => {
    const w = cfg.rMax_kpc * RIM_MAX * KPC_TO_WU * 2 * refScale; // full width ≈ galaxy outer diameter
    refMesh.scale.set(w, w, 1);
    refMesh.position.y = refYOffset * KPC_TO_WU;
    refMesh.rotation.y = (refRotDeg * Math.PI) / 180;
    refMat.opacity = refOpacity;
    refMesh.visible = refEnabled;
  };
  const applyGalaxyOpacity = (): void => {
    if (!current) return;
    current.material.uniforms.uDensityDim!.value = galaxyOpacity;                 // stars (additive intensity)
    current.prominentMat.uniforms.uDensityDim!.value = galaxyOpacity;            // prominent stars
    current.gasMat.uniforms.uBright!.value = 0.019 * galaxyOpacity;               // gas puffs
    current.dustMat.uniforms.uOpacityScale!.value = dustOpacity * galaxyOpacity;  // dust lanes
  };
  applyRef();

  // ── GAS BLUR ─────────────────────────────────────────────────────────────────────────────────────────────
  // The particle gas reads as a mist of discrete puffs; the target is a smooth painterly haze. renderGasBlur()
  // renders the gas ALONE (isolated on GALAXY_GAS_LAYER) to a half-res HDR target and separable-gaussian blurs
  // it (H,V ×2); the host post chain composites the result over the scene before its tone-map (main.ts). Half-res
  // + the blur dissolves the individual sprites into a continuous cloud without touching the crisp star field.
  // (gasBlurEnabled/Scale/Radius/gasGain are declared up top so the preset/localStorage load can set them.)
  const savedClear = new Color();
  const fsGeo = new PlaneGeometry(2, 2);
  const fsCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsVert = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const blurMat = new ShaderMaterial({
    uniforms: { uTex: { value: null }, uTexel: { value: new Vector2() }, uDir: { value: new Vector2(1, 0) }, uRadius: { value: gasBlurRadius } },
    vertexShader: fsVert,
    fragmentShader: `
      uniform sampler2D uTex; uniform vec2 uTexel; uniform vec2 uDir; uniform float uRadius; varying vec2 vUv;
      void main(){
        vec2 o = uTexel * uDir * uRadius;
        vec4 s = texture2D(uTex, vUv) * 0.227027;
        s += (texture2D(uTex, vUv + o * 1.3846) + texture2D(uTex, vUv - o * 1.3846)) * 0.316216;
        s += (texture2D(uTex, vUv + o * 3.2308) + texture2D(uTex, vUv - o * 3.2308)) * 0.070270;
        gl_FragColor = s;
      }`,
    depthTest: false, depthWrite: false,
  });
  const blurScene = new Scene();
  { const q = new Mesh(fsGeo, blurMat); q.frustumCulled = false; blurScene.add(q); }
  let gasRT: WebGLRenderTarget | null = null, blurRT: WebGLRenderTarget | null = null;
  const ensureRTs = (w: number, h: number): void => {
    if (gasRT && gasRT.width === w && gasRT.height === h) return;
    gasRT?.dispose(); blurRT?.dispose();
    // HDR (half-float) target: the additive gas sums well past 1.0 in the arm/core cores. Blurring in HDR keeps
    // a smooth core→arm rolloff; an 8-bit target would clip the cores to a flat white plateau BEFORE the blur.
    const o = { depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter, format: RGBAFormat, type: HalfFloatType };
    gasRT = new WebGLRenderTarget(w, h, o);
    blurRT = new WebGLRenderTarget(w, h, o);
  };
  /** Render the GAS ALONE (isolated on GALAXY_GAS_LAYER) to a half-res HDR target and separable-gaussian blur it
   *  (H,V ×2), returning the blurred texture + composite gain for the host's post chain to add over the scene
   *  BEFORE its tone-map. Never touches the main framebuffer. Null when gas is hidden or blur is off (the gas then
   *  renders inline/sharp on layer 0 through the normal pass). */
  const renderGasBlur = (renderer: WebGLRenderer, scene: Scene, camera: Camera): { texture: Texture; gain: number } | null => {
    if (!current || !gasBlurEnabled || !current.gas.visible) return null;
    const dw = renderer.domElement.width, dh = renderer.domElement.height;
    const w = Math.max(4, Math.round(dw * gasBlurScale)), h = Math.max(4, Math.round(dh * gasBlurScale));
    ensureRTs(w, h);
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.getClearColor(savedClear);
    const prevAlpha = renderer.getClearAlpha();
    const prevLayers = camera.layers.mask;
    const prevBg = scene.background; // must render the gas against BLACK — not the sky cube/photo backdrop
    current.gasMat.uniforms.uViewportH!.value = h; // size the world-space puffs for the RT height (not the screen)
    // 1) gas ALONE → gasRT: restrict the camera to the gas layer, so only the gas Points render (into black).
    camera.layers.set(GALAXY_GAS_LAYER);
    scene.background = null;
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(gasRT!);
    renderer.render(scene, camera);
    // 2) separable gaussian, H then V, ×2. Radius scaled by 1/scale so softness is resolution-independent.
    blurMat.uniforms.uTexel!.value.set(1 / w, 1 / h);
    blurMat.uniforms.uRadius!.value = gasBlurRadius / gasBlurScale;
    for (let i = 0; i < 2; i++) {
      blurMat.uniforms.uTex!.value = gasRT!.texture; blurMat.uniforms.uDir!.value.set(1, 0);
      renderer.setRenderTarget(blurRT!); renderer.render(blurScene, fsCam);
      blurMat.uniforms.uTex!.value = blurRT!.texture; blurMat.uniforms.uDir!.value.set(0, 1);
      renderer.setRenderTarget(gasRT!); renderer.render(blurScene, fsCam);
    }
    // restore renderer + camera + scene state for the main composer pass.
    camera.layers.mask = prevLayers;
    scene.background = prevBg;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(savedClear, prevAlpha);
    renderer.autoClear = prevAutoClear;
    return { texture: gasRT!.texture, gain: gasGain };
  };


  const rebuild = (count = cfg.count): void => {
    if (current) {
      root.remove(current.points); current.points.geometry.dispose(); current.material.dispose();
      root.remove(current.dust); current.dust.geometry.dispose(); current.dustMat.dispose();
      root.remove(current.gas); current.gas.geometry.dispose(); current.gasMat.dispose();
      root.remove(current.prominent); current.prominent.geometry.dispose(); current.prominentMat.dispose();
    }
    data = samplePhysicalGalaxy({ ...cfg, count }, seed);
    const g = buildPhysicalGalaxyPoints(data);
    const frac = Math.max(0.1, count / cfg.count); // thin the dust on the preview resample too
    const dd = sampleDust(cfg, { ...dustCfg, dustCount: Math.round(dustCfg.dustCount * frac) }, seed);
    const d = buildDustPoints(dd);
    d.material.uniforms.uOpacityScale.value = dustOpacity;
    // gas = the STAR distribution re-skinned as soft blurred puffs (1/4 the star count, decorrelated seed),
    // coloured by the removed gas's amber-nucleus/blue-arm cross-section. `{...cfg, count}` ⇒ it tracks the
    // preview resample and thins with the stars on drags; gasIntensity is the baked brightness knob.
    const ga = buildStarGasPoints(sampleStarGas({ ...cfg, count }, seed, { countFraction: 0.25, puffKpc: gasPuffKpc, intensity: gasIntensity, coreGas: gasCore }));
    // Prominent standout stars — big/bright/varied, same structure + orbit motion, composited OVER the gas.
    const pr = buildPhysicalGalaxyPoints(sampleProminentStars(cfg, seed, { count: prominentCount, sizeMul: prominentSize, brightMul: prominentBright, variance: prominentVariance }));
    pr.material.uniforms.uDepthLODRef!.value = 0; // no distance-LOD shrink → they keep their size at galaxy range
    pr.points.name = 'galaxy-prominent';
    root.add(g.points);
    root.add(ga.points);
    root.add(pr.points);
    root.add(d.points);
    g.points.visible = starsEnabled; // honor the panel toggles across resamples
    d.points.visible = dustEnabled;
    d.points.layers.set(GALAXY_DUST_LAYER);                      // dust renders LAST (extinction overlay) so lanes read over the gas
    ga.points.visible = cloudEnabled;
    ga.points.layers.set(gasBlurEnabled ? GALAXY_GAS_LAYER : 0); // blurred pre-pass vs inline (see renderGasBlur)
    pr.points.visible = prominentEnabled;
    pr.points.layers.set(GALAXY_PROMINENT_LAYER);               // additive overlay OVER the gas → they stand out
    current = {
      points: g.points, material: g.material, dust: d.points, dustMat: d.material,
      gas: ga.points, gasMat: ga.material, prominent: pr.points, prominentMat: pr.material,
    };
    applyGalaxyOpacity(); // re-apply the global dim to the freshly-built materials
  };
  rebuild();

  let pending = false;
  const previewRebuild = (): void => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; rebuild(Math.min(cfg.count, PREVIEW_COUNT)); });
  };

  // ── declarative control SCHEMA (the LAB panel renders it), grouped into collapsible sections ──
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
        num('barAngle_deg', 'bar rotate', -90, 90, 1, undefined, '°'), // orients the bar; the inner arms follow it
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
        { kind: 'toggle', label: 'stars on', get: () => starsEnabled, set: (v: boolean) => { starsEnabled = v; },
          live: () => { if (current) current.points.visible = starsEnabled; } },
        num('starProminence', 'prominence', 0, 1, 0.05),
        num('starFaintDim', 'faint dim', 0, 1, 0.05),
        num('clumpFraction', 'clusters', 0, 0.4, 0.01),
        num('clumpScale_pc', 'cluster size', 60, 600, 10, undefined, 'pc'),
        num('clusterArm', 'cluster arm', 0, 1, 0.05),
      ] },
      { title: 'Dust', key: 'dust', ctrls: [
        { kind: 'toggle', label: 'dust on', get: () => dustEnabled, set: (v: boolean) => { dustEnabled = v; },
          live: () => { if (current) current.dust.visible = dustEnabled; } },
        { label: 'dust', min: 0, max: 2.5, step: 0.1, get: () => dustOpacity, set: (v: number) => { dustOpacity = v; },
          live: () => { if (current) current.dustMat.uniforms.uOpacityScale.value = dustOpacity; } },
        dnum('dustLeadDeg', 'dust lead', -40, 40, 2, '°'),
        dnum('dustThickness', 'dust thickness', 0.02, 1, 0.02),
        dnum('dustSegment', 'dust segments', 0, 1, 0.05),
        dnum('dustSegmentScale', 'segment freq', 0.6, 6, 0.2),
        dnum('dustFilament', 'dust tendrils', 0, 1, 0.05),
        dnum('dustFeather', 'dust feather', 0, 1.5, 0.05),
        dnum('dustCrossRung', 'cross rungs', 0, 1, 0.05),   // perpendicular rungs across the lane (sheared)
        dnum('dustVertWisp', 'vert wisps', 0, 1, 0.05),     // out-of-plane vertical filaments along the lane
        dnum('dustPerpSpur', 'perp spurs', 0, 1, 0.05),     // short combs branching off the lane edge
      ] },
      { title: 'Gas', key: 'gas', ctrls: [
        { kind: 'toggle', label: 'gas on', get: () => cloudEnabled, set: (v: boolean) => { cloudEnabled = v; },
          live: () => { if (current) current.gas.visible = cloudEnabled; } },
        // Star-gas bake-time knobs (resample): per-puff brightness + puff diameter.
        { label: 'gas intensity', min: 0, max: 3, step: 0.05, get: () => gasIntensity, set: (v: number) => { gasIntensity = v; } },
        { label: 'puff size', min: 0.25, max: 1.6, step: 0.05, unit: ' kpc', get: () => gasPuffKpc, set: (v: number) => { gasPuffKpc = v; } },
        { label: 'core gas', min: 0, max: 3, step: 0.05, get: () => gasCore, set: (v: number) => { gasCore = v; } }, // nucleus gas only
        // Blur compositor (live — gas → half-res target → gaussian → additive composite; no resample).
        { kind: 'toggle', label: 'gas blur', get: () => gasBlurEnabled, set: (v: boolean) => { gasBlurEnabled = v; },
          live: () => { if (current) current.gas.layers.set(gasBlurEnabled ? GALAXY_GAS_LAYER : 0); } }, // layer 1 = blurred pre-pass; 0 = inline
        { label: 'blur res', min: 0.25, max: 1, step: 0.05, get: () => gasBlurScale, set: (v: number) => { gasBlurScale = v; }, live: () => {} },
        { label: 'blur radius', min: 0.5, max: 5, step: 0.25, get: () => gasBlurRadius, set: (v: number) => { gasBlurRadius = v; }, live: () => {} },
        { label: 'gas gain', min: 0.5, max: 3, step: 0.05, get: () => gasGain, set: (v: number) => { gasGain = v; }, live: () => {} },
      ] },
      { title: 'Prominent Stars', key: 'prominent', ctrls: [
        { kind: 'toggle', label: 'prominent on', get: () => prominentEnabled, set: (v: boolean) => { prominentEnabled = v; },
          live: () => { if (current) current.prominent.visible = prominentEnabled; } },
        { label: 'count', min: 200, max: 20000, step: 100, get: () => prominentCount, set: (v: number) => { prominentCount = v; } },
        { label: 'size', min: 1, max: 30, step: 0.5, get: () => prominentSize, set: (v: number) => { prominentSize = v; } },
        { label: 'brightness', min: 0.5, max: 10, step: 0.25, get: () => prominentBright, set: (v: number) => { prominentBright = v; } },
        { label: 'variance', min: 0, max: 1, step: 0.05, get: () => prominentVariance, set: (v: number) => { prominentVariance = v; } },
      ] },
      { title: 'Motion', key: 'motion', ctrls: [
        { label: 'time warp', min: 0, max: 15, step: 0.5, unit: ' Myr/s', get: () => warp, set: (v: number) => { warp = v; }, live: () => {} },
      ] },
      { title: 'Reference', key: 'reference', ctrls: [
        { kind: 'toggle', label: 'reference', get: () => refEnabled, set: (v: boolean) => { refEnabled = v; }, live: applyRef },
        { label: 'ref opacity', min: 0, max: 1, step: 0.05, get: () => refOpacity, set: (v: number) => { refOpacity = v; }, live: applyRef },
        { label: 'ref scale', min: 0.3, max: 2.5, step: 0.01, get: () => refScale, set: (v: number) => { refScale = v; }, live: applyRef },
        { label: 'ref rotate', min: -180, max: 180, step: 1, unit: '°', get: () => refRotDeg, set: (v: number) => { refRotDeg = v; }, live: applyRef },
        { label: 'ref height', min: -3, max: 3, step: 0.05, unit: ' kpc', get: () => refYOffset, set: (v: number) => { refYOffset = v; }, live: applyRef },
        { label: 'galaxy opacity', min: 0.05, max: 1, step: 0.05, get: () => galaxyOpacity, set: (v: number) => { galaxyOpacity = v; }, live: applyGalaxyOpacity },
      ] },
    ];

  // ── persistence actions (close over the private state; the LAB panel calls these) ──
  const snapshot = (): GalaxyPreset => ({
    cfg: { ...cfg }, dust: { ...dustCfg },
    gasIntensity, dustOpacity, gasPuffKpc, gasCore,
    gasBlurEnabled, gasBlurScale, gasBlurRadius, gasGain,
    prominentEnabled, prominentCount, prominentSize, prominentBright, prominentVariance,
    cloudEnabled, starsEnabled, dustEnabled,
  });
  const save = (): void => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(snapshot())); } catch { /* storage denied — non-fatal */ }
  };
  const revert = (): void => {
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    Object.assign(cfg, DEFAULT_PHYSICAL_CONFIG);
    Object.assign(dustCfg, DEFAULT_DUST_CONFIG);
    gasIntensity = 2.0; dustOpacity = 1.0; gasPuffKpc = 1.15; gasCore = 1.0; warp = 0;
    gasBlurEnabled = true; gasBlurScale = 0.5; gasBlurRadius = 3.0; gasGain = 1.2;
    prominentEnabled = true; prominentCount = 4000; prominentSize = 6.0; prominentBright = 3.0; prominentVariance = 0.7;
    cloudEnabled = true; starsEnabled = true; dustEnabled = true;
    applyPreset(SAVED_GALAXY_DEFAULTS); // land on the canonical committed look, not the raw code floor
    rebuild();
  };
  const reseed = (): void => { seed++; rebuild(); };
  const controls: GalaxyControls = { sections, collapseKey: COLLAPSE_KEY, snapshot, save, revert, reseed, rebuild, previewRebuild };

  const update = (_camera: Camera, dt: number, _cloudActive = true): void => {
    if (warp !== 0 && current) {
      // Phase-1 galactic motion: advance the orbit clock; the star + gas vertex shaders stream each particle
      // along its circular orbit at Ω(R) (inner faster ⇒ differential rotation). At simTime 0 → identical to
      // the baked galaxy. simTime is a float64 accumulator; passed to float32 uTime (precise for any realistic
      // session — omega·t stays well within float32 until ~1e6 Myr of warp).
      simTimeMyr += warp * dt; // dt s · warp Myr/s = Myr
      current.material.uniforms.uTime!.value = simTimeMyr;
      current.gasMat.uniforms.uTime!.value = simTimeMyr;
      current.prominentMat.uniforms.uTime!.value = simTimeMyr; // prominent stars orbit with the field
      // Dust rides the SAME per-grain differential orbits as the arm stars (same uTime clock) so the lanes stay
      // pinned to the arms as the disc turns, rather than rigidly rotating and drifting off them.
      current.dustMat.uniforms.uTime!.value = simTimeMyr;
    }
    // gas puffs are world-sized → need the current framebuffer height for the perspective point-size conversion.
    if (current && opts.renderer) current.gasMat.uniforms.uViewportH!.value = opts.renderer.domElement.height;
  };
  const dispose = (): void => {
    if (current) {
      root.remove(current.points); current.points.geometry.dispose(); current.material.dispose();
      root.remove(current.dust); current.dust.geometry.dispose(); current.dustMat.dispose();
      root.remove(current.gas); current.gas.geometry.dispose(); current.gasMat.dispose();
      root.remove(current.prominent); current.prominent.geometry.dispose(); current.prominentMat.dispose();
    }
    gasRT?.dispose(); blurRT?.dispose();
    blurMat.dispose(); fsGeo.dispose();
    root.remove(refMesh); refMesh.geometry.dispose(); refMat.dispose(); refTex.dispose(); // reference-overlay dev tool
  };

  return { root, cfg, get data() { return data; }, update, renderGasBlur, controls, dispose };
}

