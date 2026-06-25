// ═══════════════════════════════════════════════════════════════════
// N-BODY MICRO-BENCHMARK (P1) — measure the real all-pairs gravitational force-solver ceiling on THIS
// device, so the "no live N-body at 2–3M" decision rests on OUR numbers, not extrapolated published ones.
//
// Throwaway harness: it stands up its own WebGPU device (independent of the Three renderer), runs a TILED
// (workgroup-shared-memory) O(N²) force kernel at N = 2¹⁴…2¹⁸, times each via queue.onSubmittedWorkDone(),
// and reports ms/pass, sustained interactions/s, fps, the N that fits a 30 fps budget, and the projected
// cost at Legion's ~2.5M stars. Load with ?nbody-bench (run it on the laptop AND the iPad).
//
// A tiled kernel is a FAIR (near-peak) measurement; if anything it OVER-states achievable throughput, so a
// "still far too slow at millions" result is conservative. WebGPU only — if absent (e.g. iPadOS < 26) the
// panel says so, which is itself a finding for the P3 playback path (it would need a WebGL2 fallback).
// ═══════════════════════════════════════════════════════════════════

interface BenchRow {
  n: number;
  msPerPass: number;
  fps: number;
  ginteractionsPerSec: number;
}

const N_VALUES = [1 << 14, 1 << 15, 1 << 16, 1 << 17, 1 << 18]; // 16k … 262k
const WORKGROUP = 64;
const LEGION_N = 2_500_000;
const BUDGET_MS = 1000 / 30; // 30 fps

const KERNEL = /* wgsl */ `
struct Body { p : vec4<f32> }; // xyz + mass
@group(0) @binding(0) var<storage, read> pos : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> acc : array<vec4<f32>>;

const TILE : u32 = 64u;
var<workgroup> sharedPos : array<vec4<f32>, 64>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>,
        @builtin(local_invocation_id)  lid : vec3<u32>) {
  let n = arrayLength(&pos);
  let i = gid.x;
  let pi = pos[min(i, n - 1u)].xyz;
  var a = vec3<f32>(0.0, 0.0, 0.0);
  let tiles = (n + TILE - 1u) / TILE;
  for (var t : u32 = 0u; t < tiles; t = t + 1u) {
    let src = t * TILE + lid.x;
    sharedPos[lid.x] = select(vec4<f32>(0.0), pos[src], src < n);
    workgroupBarrier();
    for (var k : u32 = 0u; k < TILE; k = k + 1u) {
      let pj = sharedPos[k];
      let d = pj.xyz - pi;
      let r2 = dot(d, d) + 0.01;        // Plummer softening
      let inv = inverseSqrt(r2);
      a = a + d * (pj.w * inv * inv * inv);
    }
    workgroupBarrier();
  }
  if (i < n) { acc[i] = vec4<f32>(a, 0.0); }
}`;

/** Run the benchmark, render a results panel, expose window.__nbodyBench, and resolve with the rows. */
export async function runNbodyBench(): Promise<BenchRow[] | null> {
  const panel = makePanel();
  const log = (html: string): void => { panel.innerHTML = html; };

  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) {
    log(headerHtml() + `<p style="color:#ff9a9a">WebGPU is not available in this browser.<br>`
      + `(On iPad this means iPadOS &lt; 26 — the live playback path would need a WebGL2 fallback.)</p>`);
    return null;
  }

  let adapter: GPUAdapter | null = null;
  let device: GPUDevice | null = null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    device = (await adapter?.requestDevice()) ?? null;
  } catch (e) {
    log(headerHtml() + `<p style="color:#ff9a9a">WebGPU device request failed: ${String(e)}</p>`);
    return null;
  }
  if (!adapter || !device) {
    log(headerHtml() + `<p style="color:#ff9a9a">No WebGPU adapter/device.</p>`);
    return null;
  }

  const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
  const adapterDesc = info ? `${info.vendor || '?'} · ${info.architecture || info.description || '?'}` : 'adapter info unavailable';

  const module = device.createShaderModule({ code: KERNEL });
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });

  const rows: BenchRow[] = [];
  for (const n of N_VALUES) {
    log(headerHtml() + `<p>GPU: ${adapterDesc}</p><p>benchmarking N = ${n.toLocaleString()} …</p>` + tableHtml(rows));
    await new Promise((r) => requestAnimationFrame(r)); // let the panel paint

    const bytes = n * 16; // vec4<f32>
    const posBuf = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const accBuf = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE });
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      seed[i * 4] = (i * 12.9898) % 30 - 15; // cheap deterministic spread (no Math.random needed)
      seed[i * 4 + 1] = (i * 78.233) % 6 - 3;
      seed[i * 4 + 2] = (i * 37.719) % 30 - 15;
      seed[i * 4 + 3] = 1.0; // mass
    }
    device.queue.writeBuffer(posBuf, 0, seed);
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: posBuf } }, { binding: 1, resource: { buffer: accBuf } }],
    });
    const groups = Math.ceil(n / WORKGROUP);
    const dispatch = (passes: number): void => {
      const enc = device!.createCommandEncoder();
      for (let p = 0; p < passes; p++) {
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind);
        pass.dispatchWorkgroups(groups);
        pass.end();
      }
      device!.queue.submit([enc.finish()]);
    };

    // Warm up + estimate, then time a batch sized to ~150 ms of work (clamped).
    dispatch(2);
    await device.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    dispatch(1);
    await device.queue.onSubmittedWorkDone();
    const warmMs = performance.now() - t0;
    const passes = Math.max(2, Math.min(60, Math.round(150 / Math.max(0.5, warmMs))));
    const t1 = performance.now();
    dispatch(passes);
    await device.queue.onSubmittedWorkDone();
    const msPerPass = (performance.now() - t1) / passes;

    const interactions = n * n;
    rows.push({
      n,
      msPerPass,
      fps: 1000 / msPerPass,
      ginteractionsPerSec: interactions / (msPerPass / 1000) / 1e9,
    });
    posBuf.destroy();
    accBuf.destroy();
  }

  // Sustained throughput from the largest N (most compute-bound, least overhead-dominated).
  const peak = Math.max(...rows.map((r) => r.ginteractionsPerSec)) * 1e9;
  const nMaxAt30 = Math.sqrt(peak * (BUDGET_MS / 1000));
  const legionMsPerPass = (LEGION_N * LEGION_N) / peak * 1000;

  const summary = `<div style="margin-top:10px;border-top:1px solid #2a3340;padding-top:8px;line-height:1.7">`
    + `<div>peak sustained: <b>${(peak / 1e9).toFixed(0)} G interactions/s</b></div>`
    + `<div>N for 30 fps (1 force pass/frame): <b>${Math.round(nMaxAt30).toLocaleString()}</b></div>`
    + `<div>Legion's ${LEGION_N.toLocaleString()} stars: <b style="color:#ff9a9a">`
    + `${(legionMsPerPass / 1000).toFixed(1)} s/pass (${(1000 / legionMsPerPass).toFixed(3)} fps)</b></div>`
    + `<div style="margin-top:6px;opacity:0.7;font-size:11px">⇒ ~${Math.round(legionMsPerPass / BUDGET_MS).toLocaleString()}× over the 30 fps frame budget `
    + `(${Math.round(LEGION_N / nMaxAt30)}× too many stars) — confirms KINEMATIC playback, not gravity in the loop.</div></div>`;
  log(headerHtml() + `<p>GPU: ${adapterDesc}</p>` + tableHtml(rows) + summary);

  const result = { adapter: adapterDesc, rows, peakGInteractionsPerSec: peak / 1e9, nMaxAt30fps: nMaxAt30, legionSecPerPass: legionMsPerPass / 1000 };
  (globalThis as Record<string, unknown>).__nbodyBench = result;
  console.info('[nbody-bench]', result);
  return rows;
}

function headerHtml(): string {
  return `<div style="font-weight:600;letter-spacing:0.08em;margin-bottom:8px;color:#eaf0f7">N-BODY MICRO-BENCHMARK</div>`;
}

function tableHtml(rows: BenchRow[]): string {
  if (!rows.length) return '';
  const head = `<tr style="opacity:0.7"><th align="right">N</th><th align="right">ms/pass</th><th align="right">fps</th><th align="right">G int/s</th></tr>`;
  const body = rows.map((r) => `<tr>`
    + `<td align="right">${r.n.toLocaleString()}</td>`
    + `<td align="right">${r.msPerPass.toFixed(2)}</td>`
    + `<td align="right" style="color:${r.fps >= 30 ? '#9affb0' : '#ff9a9a'}">${r.fps.toFixed(1)}</td>`
    + `<td align="right">${r.ginteractionsPerSec.toFixed(0)}</td></tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse">${head}${body}</table>`;
}

function makePanel(): HTMLElement {
  for (const id of ['hud', 'dot-grid', 'hover-tip', 'dest-mode-indicator']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  const panel = document.createElement('div');
  panel.id = 'nbody-bench';
  panel.style.cssText = 'position:fixed;top:14px;left:14px;z-index:100000;width:320px;padding:14px 16px;'
    + 'background:rgba(12,15,20,0.92);border:1px solid #2a3340;border-radius:8px;color:#cfd8e3;'
    + 'font:12px/1.6 ui-monospace,SFMono-Regular,monospace;letter-spacing:0.02em';
  panel.innerHTML = headerHtml() + '<p>starting…</p>';
  document.body.appendChild(panel);
  return panel;
}
