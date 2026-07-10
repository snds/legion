// ═══════════════════════════════════════════════════════════════════
// POST-PROCESSING — EffectComposer Pipeline
// Replaces direct renderer.render() with a multi-pass chain:
//   RenderPass → AutoExposure → SMAAPass → KarisBloom → Vignette → OutputPass
// ═══════════════════════════════════════════════════════════════════

import {
  WebGLRenderer, Scene, PerspectiveCamera,
  ShaderMaterial, type Texture, type WebGLRenderTarget, Vector2,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { KarisBloomPass } from './bloom';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { AutoExposurePass } from './auto-exposure';
import { GALAXY_PROMINENT_LAYER, GALAXY_DUST_LAYER } from './galaxy-sim';
import { VP } from './visual-params';

// ── NaN Sanitization Shader ──────────────────────────────────────
// Inserted before the bloom pass to prevent NaN from contaminating
// the bloom's multi-pass pipeline (bright extract → blur → composite).
// NaN pixels are clamped to black. Without this, a single NaN pixel
// from normalize(vec3(0)) propagates through bloom's additive blend
// and persists across frames in the EffectComposer's ping-pong buffers.

const NaNSanitizeShader = {
  uniforms: {
    tDiffuse: { value: null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // Clamp NaN/Inf to 0 — NaN fails both >= and <= comparisons
      if (!(c.r >= 0.0 || c.r <= 0.0)) c.r = 0.0;
      if (!(c.g >= 0.0 || c.g <= 0.0)) c.g = 0.0;
      if (!(c.b >= 0.0 || c.b <= 0.0)) c.b = 0.0;
      // Also clamp negative values and extreme HDR that could cause issues
      c.rgb = clamp(c.rgb, 0.0, 65504.0);
      gl_FragColor = vec4(c.rgb, 1.0);
    }
  `,
};

// ── Film Grain Shader ────────────────────────────────────────────
// Adds subtle noise to reduce banding in dark gradients (space
// backgrounds, nebulae). Monochromatic grain, intensity-responsive:
// stronger in dark areas where banding is most visible.

const FilmGrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uIntensity: { value: 0.035 },  // subtle — just enough to break banding
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uIntensity;
    varying vec2 vUv;

    // Hash-based noise (no texture dependency)
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      // Animate grain per frame
      float grain = hash(vUv * 1000.0 + uTime * 137.0) - 0.5;
      // Stronger in darks (where banding is visible), weaker in brights
      float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      float grainStrength = uIntensity * (1.0 - luminance * 0.7);
      color.rgb += grain * grainStrength;
      gl_FragColor = vec4(color.rgb, 1.0);
    }
  `,
};

// ── Color Grading Shader ─────────────────────────────────────────
// Cinematic look: cooled shadows, slightly warm highlights,
// crushed blacks, lifted whites. Inspired by Homeworld / The Expanse
// color science. No LUT texture needed — all parametric.

const ColorGradingShader = {
  uniforms: {
    tDiffuse: { value: null },
    // Space is black. No cool/warm tinting on shadows or highlights —
    // those biases were reading as "blue post-processing" against vacuum.
    uShadowTint: { value: [0.0, 0.0, 0.0] },
    uHighlightTint: { value: [0.0, 0.0, 0.0] },
    uBlackPoint: { value: 0.0 },     // crushed blacks (true vacuum)
    uContrast: { value: 1.04 },       // very gentle S-curve, no posterization
    uSaturation: { value: 1.0 },      // neutral — let source colors stand
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uShadowTint;
    uniform vec3 uHighlightTint;
    uniform float uBlackPoint;
    uniform float uContrast;
    uniform float uSaturation;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Luminance for tint blending
      float lum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));

      // Shadow/highlight tinting (blend by luminance)
      float shadowWeight = 1.0 - smoothstep(0.0, 0.4, lum);
      float highlightWeight = smoothstep(0.6, 1.0, lum);
      color.rgb += uShadowTint * shadowWeight;
      color.rgb += uHighlightTint * highlightWeight;

      // Contrast (pivot at 0.18 mid-gray, filmic standard)
      color.rgb = (color.rgb - 0.18) * uContrast + 0.18;

      // Black point lift (prevents banding in pure blacks)
      color.rgb = max(color.rgb, vec3(uBlackPoint));

      // Saturation (desaturate toward luminance)
      vec3 gray = vec3(lum);
      color.rgb = mix(gray, color.rgb, uSaturation);

      gl_FragColor = vec4(color.rgb, 1.0);
    }
  `,
};

// ── Chromatic Aberration ─────────────────────────────────────────
// Subtle radial RGB split — sells the "we are looking at a screen"
// diegesis. Strength ramps from 0 at center to uMaxOffset at corners.

const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null },
    uMaxOffset: { value: 0.0025 }, // ~2px on a 1080p canvas at corners
    uFalloff: { value: 1.8 },      // higher = effect stays near corners
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uMaxOffset;
    uniform float uFalloff;
    varying vec2 vUv;

    void main() {
      vec2 center = vec2(0.5);
      vec2 dir = vUv - center;
      float r = length(dir) * 2.0;             // 0 at center, ~1.4 at corners
      float strength = pow(clamp(r, 0.0, 1.0), uFalloff) * uMaxOffset;
      vec2 offset = normalize(dir + 1e-6) * strength;

      float red   = texture2D(tDiffuse, vUv + offset).r;
      float green = texture2D(tDiffuse, vUv).g;
      float blue  = texture2D(tDiffuse, vUv - offset).b;

      gl_FragColor = vec4(red, green, blue, 1.0);
    }
  `,
};

// ── Vignette Shader ──────────────────────────────────────────────

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: VP.get('vignetteIntensity') },
    uDropoff: { value: VP.get('vignetteDropoff') },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform float uDropoff;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      // NaN safety net — sanitize any corrupted pixels before vignette
      if (!(color.r >= 0.0 || color.r <= 0.0)) color.r = 0.0;
      if (!(color.g >= 0.0 || color.g <= 0.0)) color.g = 0.0;
      if (!(color.b >= 0.0 || color.b <= 0.0)) color.b = 0.0;
      vec2 d = abs(vUv - 0.5);
      float vx = smoothstep(0.5, 0.3, d.x);
      float vy = smoothstep(0.5, 0.3, d.y);
      float v = pow(vx * vy, uDropoff);
      color.rgb *= mix(1.0, v, uIntensity);
      gl_FragColor = vec4(color.rgb, 1.0);
    }
  `,
};

// ── Galaxy gas-blur composite ────────────────────────────────────
// Adds the physical galaxy's offscreen-blurred gas texture over the scene BEFORE tone-mapping. A value-preserving
// exp tone-map on the gas keeps the dense core's amber hue as it compresses (so it doesn't blow to white). The
// pass is disabled unless a gas texture is set for the frame (setGasBlur) — inert on every non-galaxy view.
const GasCompositeShader = {
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    uGasTex: { value: null as Texture | null },
    uGain: { value: 1.0 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D uGasTex; uniform float uGain; varying vec2 vUv;
    void main() {
      vec4 scene = texture2D(tDiffuse, vUv);
      vec3 g = texture2D(uGasTex, vUv).rgb * uGain;
      float v = max(max(g.r, g.g), g.b);
      float t = 1.0 - exp(-v);          // value-preserving compression: amber core stays amber, not white
      g = v > 1e-5 ? g * (t / v) : g;
      gl_FragColor = vec4(scene.rgb + g, scene.a);
    }`,
};

// ── Layer-overlay pass ───────────────────────────────────────────
// Renders ONE camera render-layer's objects over the composer's current buffer, IN PLACE (needsSwap=false,
// no clear), so their own material blending composites them — additive prominent stars over the gas, then dust
// NormalBlending darkening everything. Placed AFTER the gas composite + BEFORE tone-mapping, so those features
// read against the bright gas instead of being washed out by it. Gated off unless the galaxy disc is shown.
class LayerOverlayPass extends Pass {
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly layer: number;
  constructor(scene: Scene, camera: PerspectiveCamera, layer: number) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.layer = layer;
    this.needsSwap = false; // draw over the read buffer; next pass keeps reading it
    this.enabled = false;   // the galaxy loop enables this only at galaxy tier
  }
  render(renderer: WebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
    const prevMask = this.camera.layers.mask;
    const prevAutoClear = renderer.autoClear;
    const prevBg = this.scene.background;          // CRITICAL: null the sky so render() doesn't repaint the
    this.scene.background = null;                  // background over the composited buffer (wiping stars/gas)
    this.camera.layers.set(this.layer);           // render ONLY this galaxy layer
    renderer.autoClear = false;                    // composite onto the existing scene+gas
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
    this.camera.layers.mask = prevMask;            // restore for the following passes
    this.scene.background = prevBg;
  }
}

// ── Composer Setup ───────────────────────────────────────────────

export interface PostProcessingContext {
  composer: EffectComposer;
  autoExposurePass: AutoExposurePass;
  bloomPass: KarisBloomPass;
  smaaPass: SMAAPass;
  vignettePass: ShaderPass;
  filmGrainPass: ShaderPass;
  colorGradingPass: ShaderPass;
  resize: (w: number, h: number) => void;
  render: (elapsedTime?: number) => void;
  /** Feed the galaxy's blurred-gas texture (or null to disable) for this frame's composite. */
  setGasBlur: (tex: Texture | null, gain: number) => void;
  /** Enable/disable the galaxy overlay passes (prominent stars + dust-last). On only at galaxy tier. */
  setGalaxyOverlays: (show: boolean) => void;
  /** Index where lens flare pass should be inserted (after bloom, before vignette) */
  lensFlareInsertIndex: number;
}

export function createPostProcessing(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
): PostProcessingContext {
  const size = renderer.getSize(new Vector2());
  const pixelRatio = renderer.getPixelRatio();

  const composer = new EffectComposer(renderer);

  // 1. Render pass
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // 1.25. Galaxy gas-blur composite (right after the scene, before exposure/bloom/tone-map) — inert unless the
  // galaxy feeds it a blurred-gas texture each frame via setGasBlur().
  const gasCompositePass = new ShaderPass(GasCompositeShader);
  gasCompositePass.enabled = false;
  composer.addPass(gasCompositePass);

  // 1.5/1.75. Galaxy overlays rendered OVER the composited gas (so they aren't washed out by it): prominent
  // stars (additive, they punch through), then dust LAST (extinction darkens the composited stars+gas → lanes
  // read). Both inert unless setGalaxyOverlays(true) at galaxy tier. Layers match galaxy-sim's assignments.
  const prominentStarsPass = new LayerOverlayPass(scene, camera, GALAXY_PROMINENT_LAYER);
  composer.addPass(prominentStarsPass);
  const dustOverlayPass = new LayerOverlayPass(scene, camera, GALAXY_DUST_LAYER);
  composer.addPass(dustOverlayPass);

  // 1.5. Auto-exposure metering tap — reads the raw scene HDR and drives
  // renderer.toneMappingExposure (consumed by the AgX OutputPass). The VP
  // exposure becomes an EV bias on the metered value. needsSwap=false: it does
  // not disturb the chain, so SMAA below still receives the scene.
  const autoExposurePass = new AutoExposurePass(() => VP.get('toneMappingExposure'));
  composer.addPass(autoExposurePass);

  // 2. NaN sanitization — catch any NaN from scene shaders before bloom
  const nanSanitizePass = new ShaderPass(NaNSanitizeShader);
  composer.addPass(nanSanitizePass);

  // 3. Bloom — threshold-free Karis mip bloom (see ./bloom.ts). VP bloomRadius
  // (0..1) maps to the upsample tent radius; bloomThreshold is unused (no threshold).
  const bloomPass = new KarisBloomPass(VP.get('bloomStrength'), VP.get('bloomRadius') * 0.01);
  composer.addPass(bloomPass);

  // Track insert index for lens flare (after bloom)
  const lensFlareInsertIndex = composer.passes.length;

  // 3.5. Chromatic aberration (subtle radial RGB split for diegetic-screen feel).
  // Intensity + on/off are user-controllable via the Settings panel (VP).
  const chromaticAberrationPass = new ShaderPass(ChromaticAberrationShader);
  (chromaticAberrationPass.material as ShaderMaterial).uniforms.uMaxOffset.value = VP.get('chromaticAberration');
  chromaticAberrationPass.enabled = VP.get('chromaticAberration') > 0;
  composer.addPass(chromaticAberrationPass);

  // 4. Vignette
  const vignettePass = new ShaderPass(VignetteShader);
  composer.addPass(vignettePass);

  // 5. Color grading (cinematic: cool shadows, warm highlights, crushed blacks)
  const colorGradingPass = new ShaderPass(ColorGradingShader);
  composer.addPass(colorGradingPass);

  // 6. Output — AgX tone mapping + sRGB encoding. Must run BEFORE the
  // gamma-space passes below.
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // 7. SMAA — morphological AA, POST-tonemap. Its edge metric is calibrated for
  // gamma-space LDR; the previous chain ran it on linear HDR (pre-tonemap), where
  // it mis-detects edges (and the canvas `antialias` flag is inert behind the
  // composer). Running it here fixes planet limbs / ring / orbit-line edges.
  const smaaPass = new SMAAPass(size.x * pixelRatio, size.y * pixelRatio);
  smaaPass.enabled = VP.get('smaaEnabled');
  composer.addPass(smaaPass);

  // 8. Film grain LAST — post-tonemap, so it is neither exposure-amplified (it
  // previously ran pre-tonemap, so auto-exposure scaled it up in dark views) nor
  // smoothed away by the AA pass.
  const filmGrainPass = new ShaderPass(FilmGrainShader);
  (filmGrainPass.material as ShaderMaterial).uniforms.uIntensity.value = VP.get('filmGrainIntensity');
  filmGrainPass.enabled = VP.get('filmGrainIntensity') > 0;
  composer.addPass(filmGrainPass);

  // ── Resize Handler ──
  const resize = (w: number, h: number): void => {
    composer.setSize(w, h);
    smaaPass.setSize(w * pixelRatio, h * pixelRatio);
    bloomPass.setSize(w * pixelRatio, h * pixelRatio);
  };

  // ── VP Sync ──
  VP.subscribe((key) => {
    switch (key) {
      case 'bloomStrength':
        bloomPass.strength = VP.get('bloomStrength');
        break;
      case 'bloomRadius':
        bloomPass.filterRadius = VP.get('bloomRadius') * 0.01;
        break;
      // bloomThreshold is intentionally unwired — the Karis bloom is threshold-free.
      case 'vignetteIntensity':
        (vignettePass.material as ShaderMaterial).uniforms.uIntensity.value = VP.get('vignetteIntensity');
        break;
      case 'vignetteDropoff':
        (vignettePass.material as ShaderMaterial).uniforms.uDropoff.value = VP.get('vignetteDropoff');
        break;
      case 'smaaEnabled':
        smaaPass.enabled = VP.get('smaaEnabled');
        break;
      case 'chromaticAberration': {
        const v = VP.get('chromaticAberration');
        (chromaticAberrationPass.material as ShaderMaterial).uniforms.uMaxOffset.value = v;
        chromaticAberrationPass.enabled = v > 0;
        break;
      }
      case 'filmGrainIntensity': {
        const v = VP.get('filmGrainIntensity');
        (filmGrainPass.material as ShaderMaterial).uniforms.uIntensity.value = v;
        filmGrainPass.enabled = v > 0;
        break;
      }
    }
  });

  return {
    composer,
    autoExposurePass,
    bloomPass,
    smaaPass,
    vignettePass,
    filmGrainPass,
    colorGradingPass,
    resize,
    setGasBlur: (tex: Texture | null, gain: number) => {
      const u = (gasCompositePass.material as ShaderMaterial).uniforms;
      u.uGasTex.value = tex;
      u.uGain.value = gain;
      gasCompositePass.enabled = tex !== null;
    },
    setGalaxyOverlays: (show: boolean) => {
      prominentStarsPass.enabled = show;
      dustOverlayPass.enabled = show;
    },
    render: (elapsedTime?: number) => {
      // Update film grain time uniform for animated noise
      if (elapsedTime !== undefined) {
        (filmGrainPass.material as ShaderMaterial).uniforms.uTime.value = elapsedTime;
      }
      composer.render();
    },
    lensFlareInsertIndex,
  };
}
