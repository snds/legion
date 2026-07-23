// ═══════════════════════════════════════════════════════════════════
// GPU PROFILING / CLOSE-PLANET CAPTURE HARNESS (?perfcapture) — ADDITIVE, OFF BY DEFAULT.
//
// A self-contained WebGL2 GPU-timing harness for the Legion post chain. It brackets GPU work with
// EXT_disjoint_timer_query_webgl2 TIME_ELAPSED_EXT queries through a per-region ring buffer (results
// lag 1-3 frames, so a ring avoids the synchronous stall the harness exists to prevent), handles the
// GPU_DISJOINT_EXT invalidation, and reduces per region to an N-frame median + p95.
//
// TWO MUTUALLY-EXCLUSIVE MODES (TIME_ELAPSED allows only ONE active query at a time — never nest, and
// never run a whole-composite bracket AND a per-pass breakdown together):
//
//   ?perfcapture            → CAPTURE mode. Reuse the ?demo=approach worst-case pose (one true-scale
//                             ocean world at low orbit), freeze it, fix the viewport+DPR, and time the
//                             WHOLE post-chain render (postCtx.render) across three phases on the SAME
//                             pose: WORST (live per-fragment terrain FBM, uUseBake=0) vs BAKED
//                             (globe.setBaked(true), terrain-fill removed) vs NO-PLANET (root hidden).
//                             Attribution is by DIFFERENCE — absolute ms includes the always-on chain.
//   ?perfcapture=passes     → PASSES mode. Wrap every enabled EffectComposer pass in its own flat,
//                             sequential TIME_ELAPSED region and report a live per-pass ms breakdown.
//
// Requires ?demo=approach for CAPTURE mode (worst-case terrestrial pose). Mutually exclusive with
// stats-gl (?stats / DEV) — both claim the single timer-query slot; main.ts gates them apart.
//
// URL params (CAPTURE): &w=1280 &h=720 &dpr=2 &warmup=90 &samples=120
//   w/h = backing-store size in CSS px, dpr = devicePixelRatio to force (retina worst case = 2 →
//   ~4× fragments; the fill claim may only reproduce at deployment DPR, so it is RECORDED, not hidden).
// ═══════════════════════════════════════════════════════════════════

import type { WebGLRenderer, Object3D } from 'three';
import type { PostProcessingContext } from './post-processing';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

// ── EXT_disjoint_timer_query_webgl2 (not in lib.dom) ──
interface DisjointTimerQueryExt {
  readonly QUERY_COUNTER_BITS_EXT: number;
  readonly TIME_ELAPSED_EXT: number;
  readonly TIMESTAMP_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/** Minimal surface of PlanetGlobe the capture drives (see render/planet/globe.ts). */
export interface CaptureGlobe {
  setBaked(on: boolean): void;
  stormsMature(): void;
  setSpinPaused(p: boolean): void;
}

export interface PerfCaptureDeps {
  renderer: WebGLRenderer;
  postCtx: PostProcessingContext;
  /** approach.root — hidden for the NO-PLANET phase (capture mode only; may be null). */
  planetRoot: Object3D | null;
  /** approach.globe — baked/live toggle + stabilisation (capture mode only; may be null). */
  globe: CaptureGlobe | null;
  /** Freeze the fixed-step sim so the tracked body can't drift between phases (Game.setTimeSpeed(0)). */
  freezeSim: () => void;
  /** Re-assert viewport-derived state that postCtx.resize() doesn't cover (e.g. orbit-line resolution). */
  onViewport?: (w: number, h: number) => void;
}

type CaptureMode = 'capture' | 'passes';

interface Config {
  mode: CaptureMode;
  w: number;
  h: number;
  dpr: number;
  warmup: number;
  samples: number;
}

function parseConfig(search: string): Config {
  const p = new URLSearchParams(search);
  const raw = (p.get('perfcapture') ?? '').toLowerCase();
  const mode: CaptureMode = raw === 'passes' ? 'passes' : 'capture';
  const num = (key: string, def: number): number => {
    const v = Number(p.get(key));
    return Number.isFinite(v) && v > 0 ? v : def;
  };
  return {
    mode,
    w: num('w', 1280),
    h: num('h', 720),
    dpr: num('dpr', Math.min(window.devicePixelRatio || 1, 2)),
    warmup: Math.round(num('warmup', 90)),
    samples: Math.round(num('samples', 120)),
  };
}

// ── One timed region: a ring buffer of query objects cycled round-robin so a region is never
//    re-begun on a query still awaiting its result (results lag 1-3 frames). ──
interface InFlight<M> {
  q: WebGLQuery;
  meta: M;
}

class GpuRegion<M> {
  readonly label: string;
  private readonly gl: WebGL2RenderingContext;
  private readonly target: number; // TIME_ELAPSED_EXT
  private readonly free: WebGLQuery[] = [];
  private readonly inFlight: InFlight<M>[] = [];
  private active: WebGLQuery | null = null;
  /** Completed, non-disjoint samples in ms, plus the meta captured at issue time. */
  readonly results: { ms: number; meta: M }[] = [];

  constructor(gl: WebGL2RenderingContext, target: number, label: string, pool = 8) {
    this.gl = gl;
    this.target = target;
    this.label = label;
    for (let i = 0; i < pool; i++) {
      const q = gl.createQuery();
      if (q) this.free.push(q);
    }
  }

  /** Begin timing this region. Returns false (drops the sample) if no query is free — never stalls. */
  begin(meta: M): boolean {
    if (this.active) return false; // guard against accidental nesting
    const q = this.free.pop();
    if (!q) return false; // ring exhausted (deeper lag than pool) → drop this frame's sample
    this.active = q;
    this.gl.beginQuery(this.target, q);
    this.inFlightMeta = meta;
    return true;
  }

  private inFlightMeta: M | null = null;

  end(): void {
    if (!this.active) return;
    this.gl.endQuery(this.target);
    this.inFlight.push({ q: this.active, meta: this.inFlightMeta as M });
    this.active = null;
    this.inFlightMeta = null;
  }

  /** Drain finished queries. `disjoint` invalidates every result read this frame. */
  poll(disjoint: boolean): void {
    const gl = this.gl;
    // Queries complete strictly in issue order → drain from the front.
    while (this.inFlight.length) {
      const head = this.inFlight[0];
      const available = gl.getQueryParameter(head.q, gl.QUERY_RESULT_AVAILABLE) as boolean;
      if (!available) break;
      const ns = gl.getQueryParameter(head.q, gl.QUERY_RESULT) as number;
      this.inFlight.shift();
      this.free.push(head.q);
      if (!disjoint) this.results.push({ ms: ns / 1e6, meta: head.meta });
    }
  }

  dispose(): void {
    const gl = this.gl;
    if (this.active) { try { gl.endQuery(this.target); } catch { /* ignore */ } this.active = null; }
    for (const q of this.free) gl.deleteQuery(q);
    for (const f of this.inFlight) gl.deleteQuery(f.q);
    this.free.length = 0;
    this.inFlight.length = 0;
  }
}

// ── Stats helpers ──
function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
}
function passLabel(pass: Pass, i: number): string {
  const name = (pass.constructor && pass.constructor.name) || 'Pass';
  return `${String(i).padStart(2, '0')}·${name}`;
}

// ── The single public entry point. Idempotent; safe to call once at boot behind the flag. ──
export function installPerfCapture(deps: PerfCaptureDeps): void {
  const cfg = parseConfig(location.search);
  const { renderer, postCtx } = deps;

  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as DisjointTimerQueryExt | null;
  const method: 'gpu-timer-query' | 'cpu+finish' = ext ? 'gpu-timer-query' : 'cpu+finish';
  if (!ext) {
    console.warn(
      '[perfcapture] EXT_disjoint_timer_query_webgl2 unavailable (Safari/WebKit?). ' +
      'Falling back to CPU wall-time + gl.finish() — a WEAK proxy for GPU cost; treat as trend only.',
    );
  }

  // ── Fix the backing store + DPR so phases are comparable and the number is reproducible. Both of
  //    Legion's resize listeners re-apply window/DPR sizes; rather than reach into their closures we
  //    re-assert the fixed size at the top of every frame (a no-op unless it drifted). ──
  const applyViewport = (): void => {
    if (renderer.getPixelRatio() !== cfg.dpr) renderer.setPixelRatio(cfg.dpr);
    const cur = renderer.domElement;
    if (cur.width !== Math.floor(cfg.w * cfg.dpr) || cur.height !== Math.floor(cfg.h * cfg.dpr)) {
      renderer.setSize(cfg.w, cfg.h);
      postCtx.resize(cfg.w, cfg.h);
      deps.onViewport?.(cfg.w, cfg.h);
    }
  };
  applyViewport();

  const pollDisjoint = (): boolean => (ext ? (gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean) : false);

  if (cfg.mode === 'passes') {
    installPassesMode(deps, gl, ext, method, cfg, applyViewport, pollDisjoint);
  } else {
    installCaptureMode(deps, gl, ext, method, cfg, applyViewport, pollDisjoint);
  }
}

// ═══════════════════════════════════════════════════════════════════
// CAPTURE MODE — whole-composite timing, WORST vs BAKED vs NO-PLANET on one frozen pose.
// ═══════════════════════════════════════════════════════════════════
type Phase = 'worst' | 'baked' | 'noplanet';
const PHASES: Phase[] = ['worst', 'baked', 'noplanet'];

interface PhaseMeta { phase: Phase; sampling: boolean; calls: number; tris: number; }

function installCaptureMode(
  deps: PerfCaptureDeps,
  gl: WebGL2RenderingContext,
  ext: DisjointTimerQueryExt | null,
  method: string,
  cfg: Config,
  applyViewport: () => void,
  pollDisjoint: () => boolean,
): void {
  const { renderer, postCtx, globe, planetRoot } = deps;
  const composer = postCtx.composer;

  if (!globe) {
    console.warn('[perfcapture] CAPTURE mode needs ?demo=approach (no globe found). Add ?demo=approach&perfcapture.');
    return;
  }

  // Accumulate whole-frame draw stats: EffectComposer calls renderer.render per pass, and autoReset
  // would reset info at each one — so we own the reset (once per frame) to get a real per-frame total.
  const prevAutoReset = renderer.info.autoReset;
  renderer.info.autoReset = false;

  const region = new GpuRegion<PhaseMeta>(gl, ext ? ext.TIME_ELAPSED_EXT : 0, 'composite', 10);
  const collected: Record<Phase, { ms: number[]; calls: number; tris: number }> = {
    worst: { ms: [], calls: 0, tris: 0 },
    baked: { ms: [], calls: 0, tris: 0 },
    noplanet: { ms: [], calls: 0, tris: 0 },
  };

  // Stabilise the pose once: freeze storms at full strength, stop spin, pause the sim.
  globe.stormsMature();
  globe.setSpinPaused(true);
  deps.freezeSim();

  let phaseIdx = 0;
  let frameInPhase = 0;
  let phaseConfigured = false;
  let drainingFrames = 0;
  let done = false;

  const configurePhase = (phase: Phase): void => {
    switch (phase) {
      case 'worst':
        globe.setBaked(false);         // uUseBake=0 → live per-fragment terrain FBM (the suspect fill)
        if (planetRoot) planetRoot.visible = true;
        break;
      case 'baked':
        globe.setBaked(true);          // bakes atlas + uUseBake=1 → terrain-fill removed, all else identical
        if (planetRoot) planetRoot.visible = true;
        break;
      case 'noplanet':
        if (planetRoot) planetRoot.visible = false; // background + always-on post chain floor
        break;
    }
  };

  const orig = composer.render.bind(composer);
  const cpuTimer = { t0: 0 }; // fallback path

  composer.render = function patched(deltaTime?: number): void {
    if (done) { orig(deltaTime); return; }

    // 1. Once-per-frame drain + disjoint check (reading GPU_DISJOINT resets it).
    const disjoint = pollDisjoint();
    region.poll(disjoint);

    // 2. Absorb any results that arrived, tagged with the phase that issued them.
    for (const r of region.results.splice(0)) {
      if (!r.meta.sampling) continue; // warm-up sample — discard
      const bucket = collected[r.meta.phase];
      bucket.ms.push(r.ms);
      bucket.calls = r.meta.calls;
      bucket.tris = r.meta.tris;
    }

    // 3. Hold the fixed viewport and own the info reset for a true per-frame count.
    applyViewport();
    renderer.info.autoReset = false;
    renderer.info.reset();

    // 4. Advance the phase state machine.
    const phase = PHASES[phaseIdx];
    if (!phaseConfigured) { configurePhase(phase); phaseConfigured = true; }
    const sampling = frameInPhase >= cfg.warmup;
    const issuedAllSamples = frameInPhase >= cfg.warmup + cfg.samples;

    // 5. Bracket the whole composite (or CPU+finish fallback).
    const meta: PhaseMeta = { phase, sampling, calls: 0, tris: 0 };
    let timed = false;
    if (!issuedAllSamples && ext) timed = region.begin(meta);
    if (!ext && !issuedAllSamples) cpuTimer.t0 = performance.now();

    orig(deltaTime);

    // Per-frame draw totals (accumulated across the composer's internal renderer.render calls).
    meta.calls = renderer.info.render.calls;
    meta.tris = renderer.info.render.triangles;

    if (timed) region.end();
    if (!ext && !issuedAllSamples) {
      gl.finish(); // force the queue to drain so wall-time reflects GPU work (stalls — fallback only)
      if (sampling) {
        const bucket = collected[phase];
        bucket.ms.push(performance.now() - cpuTimer.t0);
        bucket.calls = meta.calls;
        bucket.tris = meta.tris;
      }
    }

    frameInPhase++;

    // 6. Phase transition: after issuing all sample frames, drain the ring for a few frames so the
    //    last in-flight results land, then move on.
    if (issuedAllSamples) {
      drainingFrames++;
      const drained = collected[phase].ms.length >= cfg.samples || drainingFrames > 8;
      if (drained || !ext) {
        phaseIdx++;
        frameInPhase = 0;
        phaseConfigured = false;
        drainingFrames = 0;
        if (phaseIdx >= PHASES.length) finish();
      }
    }
  } as typeof composer.render;

  function finish(): void {
    done = true;
    // Final drain.
    region.poll(pollDisjoint());
    for (const r of region.results.splice(0)) {
      if (!r.meta.sampling) continue;
      const bucket = collected[r.meta.phase];
      bucket.ms.push(r.ms);
      bucket.calls = r.meta.calls;
      bucket.tris = r.meta.tris;
    }

    const rows = PHASES.map((phase) => {
      const b = collected[phase];
      return {
        phase,
        gpuMedianMs: round(median(b.ms)),
        gpuP95Ms: round(percentile(b.ms, 0.95)),
        frames: b.ms.length,
        drawCalls: b.calls,
        triangles: b.tris,
      };
    });

    const m = (p: Phase): number => median(collected[p].ms);
    const attribution = {
      liveTerrainFillMs: round(m('worst') - m('baked')),      // WORST − BAKED = live per-fragment terrain FBM
      cloudsAtmosNightIceMs: round(m('baked') - m('noplanet')), // BAKED − NO-PLANET = everything-but-terrain planet cost
      backgroundAndPostFloorMs: round(m('noplanet')),          // NO-PLANET = background + always-on post chain
    };

    const result = {
      mode: 'capture',
      method,
      viewport: { w: cfg.w, h: cfg.h, dpr: cfg.dpr, backingStore: `${renderer.domElement.width}×${renderer.domElement.height}` },
      warmup: cfg.warmup,
      requestedSamples: cfg.samples,
      rows,
      attribution,
      note: 'Absolute ms includes the always-on post chain + log-depth buffer. Attribute the fill claim by DIFFERENCE, never absolutes. Numbers are driver-quantised trend indicators.',
    };

    /* eslint-disable no-console */
    console.log(`%c[perfcapture] CAPTURE complete — ${method} @ ${cfg.w}×${cfg.h} DPR ${cfg.dpr}`, 'font-weight:600');
    console.table(rows);
    console.log('[perfcapture] attribution (ms, by difference):');
    console.table([attribution]);
    console.log('[perfcapture] JSON:\n' + JSON.stringify(result, null, 2));
    /* eslint-enable no-console */

    (globalThis as Record<string, unknown>).__perfCapture = result;
    renderPanel(result);

    // Teardown: restore the composer + renderer state so gameplay is untouched.
    composer.render = orig;
    region.dispose();
    renderer.info.autoReset = prevAutoReset;
  }
}

// ═══════════════════════════════════════════════════════════════════
// PASSES MODE — flat, sequential per-pass TIME_ELAPSED breakdown (live rolling median).
// ═══════════════════════════════════════════════════════════════════
function installPassesMode(
  deps: PerfCaptureDeps,
  gl: WebGL2RenderingContext,
  ext: DisjointTimerQueryExt | null,
  method: string,
  cfg: Config,
  applyViewport: () => void,
  pollDisjoint: () => boolean,
): void {
  const { postCtx } = deps;
  const composer = postCtx.composer;

  if (!ext) {
    console.warn('[perfcapture] PASSES mode requires the GPU timer extension; unavailable here. Aborting.');
    return;
  }

  const RING = 240; // rolling window per pass
  const regions = new Map<Pass, GpuRegion<null>>();
  const samples = new Map<Pass, number[]>();

  // Wrap each pass.render. The composer skips disabled passes (pass.render isn't called), so a wrapper
  // only fires — and only issues a query — for an enabled pass. Flat + sequential = no nesting.
  composer.passes.forEach((pass, i) => {
    const region = new GpuRegion<null>(gl, ext.TIME_ELAPSED_EXT, passLabel(pass, i), 6);
    regions.set(pass, region);
    samples.set(pass, []);
    const passOrig = pass.render.bind(pass);
    pass.render = function timed(renderer, writeBuffer, readBuffer, deltaTime, maskActive): void {
      const began = region.begin(null);
      passOrig(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      if (began) region.end();
    };
  });

  // Drive the per-frame drain + overlay from a composer.render wrapper (runs exactly once per frame).
  const orig = composer.render.bind(composer);
  let frame = 0;
  composer.render = function patched(deltaTime?: number): void {
    applyViewport();
    const disjoint = pollDisjoint();
    for (const [pass, region] of regions) {
      region.poll(disjoint);
      const buf = samples.get(pass)!;
      for (const r of region.results.splice(0)) {
        buf.push(r.ms);
        if (buf.length > RING) buf.shift();
      }
    }
    orig(deltaTime);
    frame++;
    if (frame % 60 === 0) {
      const rows = [...regions.keys()]
        .filter((p) => (samples.get(p)!.length > 0) && p.enabled !== false)
        .map((p) => ({
          pass: regions.get(p)!.label,
          medianMs: round(median(samples.get(p)!)),
          p95Ms: round(percentile(samples.get(p)!, 0.95)),
          samples: samples.get(p)!.length,
        }));
      const total = round(rows.reduce((a, r) => a + (r.medianMs || 0), 0));
      (globalThis as Record<string, unknown>).__perfCapture = { mode: 'passes', method, rows, totalMedianMs: total };
      renderPassPanel(rows, total, method);
    }
  } as typeof composer.render;

  // eslint-disable-next-line no-console
  console.log(`%c[perfcapture] PASSES mode live — per-pass GPU ms (${method}). window.__perfCapture holds the rows.`, 'font-weight:600');
}

// ── Small utilities + on-screen panels (mirrors nbody-bench's panel style). ──
function round(x: number): number { return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : NaN; }

function basePanel(id: string): HTMLElement {
  let panel = document.getElementById(id);
  if (!panel) {
    panel = document.createElement('div');
    panel.id = id;
    panel.style.cssText =
      'position:fixed;top:14px;right:14px;z-index:100000;max-width:420px;padding:12px 14px;' +
      'background:rgba(12,15,20,0.92);border:1px solid #2a3340;border-radius:8px;color:#cfd8e3;' +
      'font:11px/1.55 ui-monospace,SFMono-Regular,monospace;letter-spacing:0.02em';
    document.body.appendChild(panel);
  }
  return panel;
}

function renderPanel(result: {
  method: string;
  viewport: { w: number; h: number; dpr: number };
  rows: { phase: string; gpuMedianMs: number; gpuP95Ms: number; drawCalls: number; triangles: number }[];
  attribution: { liveTerrainFillMs: number; cloudsAtmosNightIceMs: number; backgroundAndPostFloorMs: number };
}): void {
  const p = basePanel('perfcapture-panel');
  const head = `<div style="font-weight:600;letter-spacing:0.08em;margin-bottom:6px;color:#eaf0f7">PERFCAPTURE · ${result.method}</div>` +
    `<div style="opacity:0.7;margin-bottom:8px">${result.viewport.w}×${result.viewport.h} · DPR ${result.viewport.dpr}</div>`;
  const rows = result.rows.map((r) =>
    `<tr><td>${r.phase}</td><td align="right">${r.gpuMedianMs}</td><td align="right">${r.gpuP95Ms}</td><td align="right">${r.drawCalls}</td></tr>`).join('');
  const table = `<table style="width:100%;border-collapse:collapse">` +
    `<tr style="opacity:0.7"><th align="left">phase</th><th align="right">med ms</th><th align="right">p95</th><th align="right">calls</th></tr>${rows}</table>`;
  const a = result.attribution;
  const attr = `<div style="margin-top:8px;border-top:1px solid #2a3340;padding-top:6px;line-height:1.7">` +
    `<div>live terrain fill: <b style="color:#ff9a9a">${a.liveTerrainFillMs} ms</b></div>` +
    `<div>clouds/atmos/night/ice: <b>${a.cloudsAtmosNightIceMs} ms</b></div>` +
    `<div>bg + post floor: <b>${a.backgroundAndPostFloorMs} ms</b></div>` +
    `<div style="margin-top:5px;opacity:0.65;font-size:10px">by difference — see console for JSON</div></div>`;
  p.innerHTML = head + table + attr;
}

function renderPassPanel(rows: { pass: string; medianMs: number; p95Ms: number }[], total: number, method: string): void {
  const p = basePanel('perfcapture-panel');
  const head = `<div style="font-weight:600;letter-spacing:0.08em;margin-bottom:6px;color:#eaf0f7">PERFCAPTURE · PASSES · ${method}</div>`;
  const body = rows.map((r) =>
    `<tr><td>${r.pass}</td><td align="right">${r.medianMs}</td><td align="right">${r.p95Ms}</td></tr>`).join('');
  p.innerHTML = head +
    `<table style="width:100%;border-collapse:collapse">` +
    `<tr style="opacity:0.7"><th align="left">pass</th><th align="right">med ms</th><th align="right">p95</th></tr>${body}` +
    `<tr style="border-top:1px solid #2a3340"><td><b>Σ</b></td><td align="right"><b>${total}</b></td><td></td></tr></table>`;
}
