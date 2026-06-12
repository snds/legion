// ═══════════════════════════════════════════════════════════════════
// KARIS BLOOM — Threshold-free physically-based mip bloom
//
// Replaces UnrealBloomPass (which thresholds, so glow pops in as things cross
// the cutoff, and which has no firefly suppression). This is the Jimenez
// "Next-Gen Post Processing in Call of Duty: Advanced Warfare" (SIGGRAPH 2014)
// chain, a.k.a. LearnOpenGL "Physically Based Bloom":
//
//   • Progressive 13-tap downsample into a mip pyramid.
//   • KARIS AVERAGE on the FIRST downsample only — weight each 2×2 box by
//     1/(1+luma) so a single ultra-bright sub-pixel star can't dominate and
//     shimmer as a firefly. The doc calls this non-optional for Legion, because
//     sub-pixel stars + bloom without it crawl (docs §5.9).
//   • 3×3 tent upsample, additively accumulated back up the pyramid.
//   • Threshold-free composite: mix(scene, bloom, strength). Bloom is the PSF
//     tail of every pixel — with AgX + auto-exposure upstream, a physically
//     bright sun gets a large glow automatically, with no threshold pop-in.
//
// Implemented as a self-contained EffectComposer Pass over three's WebGLRenderer
// (Legion does not use pmndrs/postprocessing). Mip targets are HalfFloat and
// rebuilt lazily when the input resolution changes.
//
// See docs/space-engine-techniques-for-legion.md §5.9.
// ═══════════════════════════════════════════════════════════════════

import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import {
  ShaderMaterial, WebGLRenderTarget, HalfFloatType, LinearFilter, ClampToEdgeWrapping,
  AdditiveBlending, NoBlending, Vector2,
  type WebGLRenderer, type WebGLRenderTarget as RT,
} from 'three';

const MIP_COUNT = 5;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// 13-tap downsample (COD:AW). Karis-weighted 5-box average on the first mip.
const DOWN_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uSource;
  uniform vec2 uTexel;       // 1 / source resolution
  uniform float uFirstMip;
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float karis(vec3 c) { return 1.0 / (1.0 + luma(c)); }
  void main() {
    float x = uTexel.x, y = uTexel.y;
    vec3 a = texture2D(uSource, vUv + vec2(-2.0*x,  2.0*y)).rgb;
    vec3 b = texture2D(uSource, vUv + vec2( 0.0,    2.0*y)).rgb;
    vec3 c = texture2D(uSource, vUv + vec2( 2.0*x,  2.0*y)).rgb;
    vec3 d = texture2D(uSource, vUv + vec2(-2.0*x,  0.0  )).rgb;
    vec3 e = texture2D(uSource, vUv).rgb;
    vec3 f = texture2D(uSource, vUv + vec2( 2.0*x,  0.0  )).rgb;
    vec3 g = texture2D(uSource, vUv + vec2(-2.0*x, -2.0*y)).rgb;
    vec3 h = texture2D(uSource, vUv + vec2( 0.0,   -2.0*y)).rgb;
    vec3 i = texture2D(uSource, vUv + vec2( 2.0*x, -2.0*y)).rgb;
    vec3 j = texture2D(uSource, vUv + vec2(-x,  y)).rgb;
    vec3 k = texture2D(uSource, vUv + vec2( x,  y)).rgb;
    vec3 l = texture2D(uSource, vUv + vec2(-x, -y)).rgb;
    vec3 m = texture2D(uSource, vUv + vec2( x, -y)).rgb;
    vec3 result;
    if (uFirstMip > 0.5) {
      vec3 b0 = (a + b + d + e) * 0.25;
      vec3 b1 = (b + c + e + f) * 0.25;
      vec3 b2 = (d + e + g + h) * 0.25;
      vec3 b3 = (e + f + h + i) * 0.25;
      vec3 b4 = (j + k + l + m) * 0.25;
      // box partial weights: corners 0.125, center 0.5; modulate by Karis weight
      float w0 = karis(b0) * 0.125, w1 = karis(b1) * 0.125, w2 = karis(b2) * 0.125,
            w3 = karis(b3) * 0.125, w4 = karis(b4) * 0.5;
      result = (b0*w0 + b1*w1 + b2*w2 + b3*w3 + b4*w4) / max(w0 + w1 + w2 + w3 + w4, 1e-5);
      result = max(result, 0.0);
    } else {
      result  = e * 0.125;
      result += (a + c + g + i) * 0.03125;
      result += (b + d + f + h) * 0.0625;
      result += (j + k + l + m) * 0.125;
    }
    gl_FragColor = vec4(result, 1.0);
  }
`;

// 3×3 tent upsample, accumulated additively into the next-larger mip.
const UP_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uSource;
  uniform float uRadius;
  void main() {
    float x = uRadius, y = uRadius;
    vec3 a = texture2D(uSource, vUv + vec2(-x,  y)).rgb;
    vec3 b = texture2D(uSource, vUv + vec2( 0.0, y)).rgb;
    vec3 c = texture2D(uSource, vUv + vec2( x,  y)).rgb;
    vec3 d = texture2D(uSource, vUv + vec2(-x,  0.0)).rgb;
    vec3 e = texture2D(uSource, vUv).rgb;
    vec3 f = texture2D(uSource, vUv + vec2( x,  0.0)).rgb;
    vec3 g = texture2D(uSource, vUv + vec2(-x, -y)).rgb;
    vec3 h = texture2D(uSource, vUv + vec2( 0.0,-y)).rgb;
    vec3 i = texture2D(uSource, vUv + vec2( x, -y)).rgb;
    vec3 result = e * 4.0 + (b + d + f + h) * 2.0 + (a + c + g + i);
    gl_FragColor = vec4(result * (1.0 / 16.0), 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uScene;
  uniform sampler2D uBloom;
  uniform float uStrength;
  void main() {
    vec3 scene = texture2D(uScene, vUv).rgb;
    vec3 bloom = texture2D(uBloom, vUv).rgb;
    gl_FragColor = vec4(mix(scene, bloom, uStrength), 1.0);
  }
`;

export class KarisBloomPass extends Pass {
  /** Composite mix factor (0..1). Threshold-free; bloom is the PSF tail of every pixel. */
  strength: number;
  /** Upsample tent radius, in UV. Larger = wider, softer glow. */
  filterRadius: number;

  private mips: RT[] = [];
  private mipW = 0;
  private mipH = 0;
  private readonly downMat: ShaderMaterial;
  private readonly upMat: ShaderMaterial;
  private readonly compositeMat: ShaderMaterial;
  private readonly quad: FullScreenQuad;

  constructor(strength = 0.08, filterRadius = 0.005) {
    super();
    this.strength = strength;
    this.filterRadius = filterRadius;

    this.downMat = new ShaderMaterial({
      uniforms: { uSource: { value: null }, uTexel: { value: new Vector2() }, uFirstMip: { value: 0 } },
      vertexShader: VERT, fragmentShader: DOWN_FRAG, blending: NoBlending, depthTest: false, depthWrite: false,
    });
    this.upMat = new ShaderMaterial({
      uniforms: { uSource: { value: null }, uRadius: { value: filterRadius } },
      vertexShader: VERT, fragmentShader: UP_FRAG, blending: AdditiveBlending, depthTest: false, depthWrite: false,
    });
    this.compositeMat = new ShaderMaterial({
      uniforms: { uScene: { value: null }, uBloom: { value: null }, uStrength: { value: strength } },
      vertexShader: VERT, fragmentShader: COMPOSITE_FRAG, blending: NoBlending, depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad();
  }

  private rebuildMips(width: number, height: number): void {
    for (const m of this.mips) m.dispose();
    this.mips = [];
    let w = width, h = height;
    for (let i = 0; i < MIP_COUNT; i++) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      this.mips.push(new WebGLRenderTarget(w, h, {
        type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter,
        wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false,
      }));
    }
    this.mipW = width;
    this.mipH = height;
  }

  render(renderer: WebGLRenderer, writeBuffer: RT, readBuffer: RT): void {
    if (!this.enabled) { this.needsSwap = false; return; }
    this.needsSwap = true;

    const srcW = readBuffer.width, srcH = readBuffer.height;
    if (srcW !== this.mipW || srcH !== this.mipH || this.mips.length === 0) {
      this.rebuildMips(srcW, srcH);
    }

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false; // additive upsample must not be wiped by an auto-clear

    // ── Downsample: scene → mip0 (Karis) → mip1 → … ──
    this.quad.material = this.downMat;
    this.downMat.uniforms.uFirstMip.value = 1;
    this.downMat.uniforms.uSource.value = readBuffer.texture;
    this.downMat.uniforms.uTexel.value.set(1 / srcW, 1 / srcH);
    renderer.setRenderTarget(this.mips[0]);
    this.quad.render(renderer);

    this.downMat.uniforms.uFirstMip.value = 0;
    for (let i = 1; i < this.mips.length; i++) {
      const prev = this.mips[i - 1];
      this.downMat.uniforms.uSource.value = prev.texture;
      this.downMat.uniforms.uTexel.value.set(1 / prev.width, 1 / prev.height);
      renderer.setRenderTarget(this.mips[i]);
      this.quad.render(renderer);
    }

    // ── Upsample: accumulate coarse mips additively into finer ones ──
    this.quad.material = this.upMat;
    this.upMat.uniforms.uRadius.value = this.filterRadius;
    for (let i = this.mips.length - 1; i > 0; i--) {
      this.upMat.uniforms.uSource.value = this.mips[i].texture;
      renderer.setRenderTarget(this.mips[i - 1]); // already holds its downsample; add on top
      this.quad.render(renderer);
    }

    // ── Composite: scene + accumulated bloom → writeBuffer ──
    this.quad.material = this.compositeMat;
    this.compositeMat.uniforms.uScene.value = readBuffer.texture;
    this.compositeMat.uniforms.uBloom.value = this.mips[0].texture;
    this.compositeMat.uniforms.uStrength.value = this.strength;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);

    renderer.autoClear = prevAutoClear;
  }

  setSize(width: number, height: number): void {
    // Mips track the input resolution; rebuild lazily on the next render if it changed.
    if (width !== this.mipW || height !== this.mipH) { this.mipW = -1; }
  }

  dispose(): void {
    for (const m of this.mips) m.dispose();
    this.downMat.dispose();
    this.upMat.dispose();
    this.compositeMat.dispose();
    this.quad.dispose();
  }
}
