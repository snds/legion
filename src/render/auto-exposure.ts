// ═══════════════════════════════════════════════════════════════════
// AUTO-EXPOSURE — Log-average luminance metering with eye adaptation
//
// A metering "tap" pass: it reads the rendered HDR scene, computes the
// geometric-mean luminance of the LIT pixels (the empty-space background is
// excluded — metering a mostly-black frame by naive average would drive the
// exposure up and blow out the sun/stars, the documented failure mode of
// average metering in space — docs §5.8), adapts it over time with an
// asymmetric time constant (fast when the scene brightens, slow when it
// darkens — the eye's behaviour), and drives renderer.toneMappingExposure.
//
// The AgX OutputPass at the end of the chain then tone-maps with this exposure,
// so moving between a sun-lit system and dark deep space auto-adjusts like
// SpaceEngine, rather than clipping or crushing. WebGL2 path: Reinhard et al.
// 2002 log-average, read back from a small RGBA8 target (universally readable,
// unlike half-float) with one frame of latency to limit the GPU→CPU stall.
//
// See docs/space-engine-techniques-for-legion.md §5.8.
// ═══════════════════════════════════════════════════════════════════

import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import {
  ShaderMaterial, WebGLRenderTarget, RGBAFormat, UnsignedByteType, NearestFilter,
  type WebGLRenderer, type WebGLRenderTarget as RT,
} from 'three';

const LUM_RES = 64;            // metering resolution (geometric mean over 64×64)
const LOG_MIN = -12;           // encoded log2-luminance range (L ≈ 2.4e-4 … 4096)
const LOG_MAX = 12;
const LIT_THRESHOLD = 0.015;   // luminance below this is treated as empty space (not metered)
const KEY = 0.18;              // middle-grey target
// P2-24/isolation task — root cause of small-isolated-disc overexposure (confirmed
// via scripts/p2-24-agx-diagnostic.mjs + direct exposure readback on Mercury/Vulcan:
// KarisBloomPass disabled entirely still left ~90% of the postNoAgx brightening
// intact, but live `autoExposurePass.exposure` measured 1.36× — i.e. metering
// decided the framed disc was TOO DARK and amplified it, when the disc's own
// brightest (sub-solar) pixels were already well-lit). A sunlit SPHERE's visible
// luminance is dominated by grazing-incidence (near-terminator) pixels — cos(θ)
// falloff means most of the disc's area sits far below its sub-solar peak. The
// UNWEIGHTED geometric mean of all "lit" pixels below therefore skews low for
// ANY compact, isolated sunlit body (independent of archetype/size), dragging
// `smoothedLum` under KEY and driving exposure UP — over-brightening the parts
// that were already correctly exposed. A busier/larger-on-screen scene (Earth
// with clouds, multiple bodies) dilutes this skew; an isolated close-zoom disc
// does not. Fix: meter a highlight-weighted PERCENTILE of the lit-pixel
// log-luminance distribution instead of its mean — this targets "how bright is
// the well-lit part of the subject" rather than "what's the average over the
// whole shading gradient", so it no longer over-reacts to a sphere's inherent
// dark-pixel majority while still reacting normally to genuinely dim/uniform
// scenes (percentile ≈ mean when the distribution isn't skewed).
const METER_PERCENTILE = 0.98;
const EXP_MIN = 0.04;          // exposure clamp — never fully black or blown out
const EXP_MAX = 1.6;           // capped so dark/empty space views don't wash the background out
const CENTER_SIGMA = 0.28;     // Gaussian center-weight: meter the framed subject, not dark periphery
const TAU_BRIGHTEN = 0.5;      // s — adapt quickly when the scene gets brighter
const TAU_DARKEN = 2.0;        // s — open up slowly when it gets darker
const METER_INTERVAL = 3;      // meter every Nth frame — readPixels is a sync stall,
                               // and adaptation runs over seconds, so ~20 Hz is ample

const LUMINANCE_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform float uLogMin;
  uniform float uLogRange;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float L = dot(c, vec3(0.2126, 0.7152, 0.0722));        // Rec.709 luminance
    float logL = log2(max(L, 1e-5));
    float enc = clamp((logL - uLogMin) / uLogRange, 0.0, 1.0);
    gl_FragColor = vec4(enc, enc, enc, 1.0);               // store encoded log-luminance
  }
`;

const LUMINANCE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Auto-exposure metering pass. Insert immediately after the scene RenderPass so
 * it taps the raw HDR scene (before bloom/grade). `needsSwap = false` — it is a
 * pure side-effect tap and leaves the composer's buffer chain untouched.
 *
 * @param exposureBias supplies a user/EV multiplier applied to the metered
 *   exposure (e.g. the VP toneMappingExposure slider), so manual bias still works.
 */
export class AutoExposurePass extends Pass {
  private readonly fsQuad: FullScreenQuad;
  private readonly material: ShaderMaterial;
  private readonly lumRT: RT;
  private readonly pixels: Uint8Array;
  private smoothedLum = KEY;
  private lastTime = -1;
  private frame = 0;
  private readonly exposureBias: () => number;
  // Scratch buffer for the weighted-percentile metering pass below — reused every
  // call (this runs at ~20 Hz) so it doesn't allocate/GC per frame. Sized to the
  // metering grid's pixel count; only the first `sampleCount` entries are valid
  // after each fill.
  private readonly meterLogL = new Float32Array(LUM_RES * LUM_RES);
  private readonly meterWeight = new Float32Array(LUM_RES * LUM_RES);
  private readonly meterOrder = new Uint16Array(LUM_RES * LUM_RES);

  /** Last computed exposure — exposed for debug/telemetry. */
  exposure = 1;

  constructor(exposureBias: () => number) {
    super();
    this.needsSwap = false;
    this.exposureBias = exposureBias;

    this.material = new ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uLogMin: { value: LOG_MIN },
        uLogRange: { value: LOG_MAX - LOG_MIN },
      },
      vertexShader: LUMINANCE_VERT,
      fragmentShader: LUMINANCE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);

    this.lumRT = new WebGLRenderTarget(LUM_RES, LUM_RES, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.pixels = new Uint8Array(LUM_RES * LUM_RES * 4);
  }

  render(renderer: WebGLRenderer, _writeBuffer: RT, readBuffer: RT): void {
    if (!this.enabled) return;

    // Meter only every Nth frame: the readback is a synchronous GPU→CPU stall,
    // and adaptation is a multi-second process, so sub-frame metering is wasted.
    this.frame = (this.frame + 1) % METER_INTERVAL;
    if (this.frame !== 0) return;

    // 1. Read the PREVIOUS metering target and update exposure. Reading the older
    //    result (latency imperceptible for exposure) lets the GPU finish it before
    //    the synchronous readback, limiting the stall.
    renderer.readRenderTargetPixels(this.lumRT, 0, 0, LUM_RES, LUM_RES, this.pixels);
    this.updateExposure(renderer);

    // 2. Render this frame's luminance into lumRT, tapping the scene HDR. Does not
    //    touch the composer's read/write buffers (needsSwap = false).
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(this.lumRT);
    this.fsQuad.render(renderer);
    renderer.setRenderTarget(prevRT);
  }

  private updateExposure(renderer: WebGLRenderer): void {
    const logRange = LOG_MAX - LOG_MIN;
    const litLog = Math.log2(LIT_THRESHOLD);
    const twoSigma2 = 2 * CENTER_SIGMA * CENTER_SIGMA;

    // Center-weighted metering of LIT pixels. Center weighting makes the exposure
    // track the framed subject (a sun/planet, usually centered) instead of the
    // mostly-dark frame — the average-metering-fails-in-space fix (docs §5.8).
    // Collect (logL, weight) samples first — the target is a weighted PERCENTILE
    // of this distribution (see METER_PERCENTILE above), not its mean, so a
    // sunlit sphere's grazing-incidence majority can't drag exposure up.
    let sampleCount = 0;
    let sumW = 0;
    for (let i = 0, p = 0; i < this.pixels.length; i += 4, p += 1) {
      const logL = (this.pixels[i] / 255) * logRange + LOG_MIN;
      if (logL <= litLog) continue;
      const dx = ((p % LUM_RES) + 0.5) / LUM_RES - 0.5;
      const dy = (Math.floor(p / LUM_RES) + 0.5) / LUM_RES - 0.5;
      const w = Math.exp(-(dx * dx + dy * dy) / twoSigma2);
      this.meterLogL[sampleCount] = logL;
      this.meterWeight[sampleCount] = w;
      this.meterOrder[sampleCount] = sampleCount;
      sumW += w;
      sampleCount += 1;
    }

    // Hold steady when nothing lit is in view (avoids drifting on empty space).
    let targetLum = this.smoothedLum;
    if (sumW > 1e-3) {
      const order = this.meterOrder.subarray(0, sampleCount);
      const logL = this.meterLogL;
      // TypedArray#sort supports a custom comparator (ES2015+) — sort the index
      // view by the logL each index points at, without allocating a plain array.
      order.sort((a, b) => logL[a] - logL[b]);
      const targetCum = METER_PERCENTILE * sumW;
      let cum = 0;
      let percentileLog = logL[order[sampleCount - 1]];
      for (let k = 0; k < sampleCount; k++) {
        const idx = order[k];
        cum += this.meterWeight[idx];
        if (cum >= targetCum) { percentileLog = logL[idx]; break; }
      }
      targetLum = Math.pow(2, percentileLog);
    }

    const now = performance.now();
    let dt = this.lastTime < 0 ? 0 : (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = Math.min(dt, 0.1); // clamp after stalls so adaptation can't jump

    const tau = targetLum > this.smoothedLum ? TAU_BRIGHTEN : TAU_DARKEN;
    const k = dt > 0 ? 1 - Math.exp(-dt / tau) : 1;
    this.smoothedLum += (targetLum - this.smoothedLum) * k;

    let exposure = KEY / Math.max(this.smoothedLum, 1e-4);
    exposure = Math.min(Math.max(exposure, EXP_MIN), EXP_MAX) * this.exposureBias();
    this.exposure = exposure;
    renderer.toneMappingExposure = exposure;
  }

  setSize(): void { /* metering resolution is fixed and resolution-independent */ }

  dispose(): void {
    this.lumRT.dispose();
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
