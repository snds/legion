// ═══════════════════════════════════════════════════════════════════
// POST-PROCESSING — EffectComposer Pipeline
// Replaces direct renderer.render() with a multi-pass chain:
//   RenderPass → SMAAPass → UnrealBloomPass → Vignette → OutputPass
// ═══════════════════════════════════════════════════════════════════

import {
  WebGLRenderer, Scene, PerspectiveCamera,
  ShaderMaterial, Vector2,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
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
    uShadowTint: { value: [0.02, 0.04, 0.08] },  // cool blue in darks
    uHighlightTint: { value: [0.02, 0.01, -0.01] }, // warm shift in brights
    uBlackPoint: { value: 0.01 },    // lift blacks slightly (prevents pure 0)
    uContrast: { value: 1.08 },       // subtle S-curve
    uSaturation: { value: 0.95 },     // very slight desaturation (space feel)
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

// ── Composer Setup ───────────────────────────────────────────────

export interface PostProcessingContext {
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
  smaaPass: SMAAPass;
  vignettePass: ShaderPass;
  filmGrainPass: ShaderPass;
  colorGradingPass: ShaderPass;
  resize: (w: number, h: number) => void;
  render: (elapsedTime?: number) => void;
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

  // 2. SMAA anti-aliasing
  const smaaPass = new SMAAPass(
    size.x * pixelRatio,
    size.y * pixelRatio,
  );
  smaaPass.enabled = VP.get('smaaEnabled');
  composer.addPass(smaaPass);

  // 2.5. NaN sanitization — catch any NaN from scene shaders before bloom
  const nanSanitizePass = new ShaderPass(NaNSanitizeShader);
  composer.addPass(nanSanitizePass);

  // 3. Bloom
  const bloomPass = new UnrealBloomPass(
    new Vector2(size.x, size.y),
    VP.get('bloomStrength'),
    VP.get('bloomRadius'),
    VP.get('bloomThreshold'),
  );
  composer.addPass(bloomPass);

  // Track insert index for lens flare (after bloom)
  const lensFlareInsertIndex = composer.passes.length;

  // 3.5. Chromatic aberration (subtle radial RGB split for diegetic-screen feel)
  const chromaticAberrationPass = new ShaderPass(ChromaticAberrationShader);
  composer.addPass(chromaticAberrationPass);

  // 4. Vignette
  const vignettePass = new ShaderPass(VignetteShader);
  composer.addPass(vignettePass);

  // 5. Color grading (cinematic: cool shadows, warm highlights, crushed blacks)
  const colorGradingPass = new ShaderPass(ColorGradingShader);
  composer.addPass(colorGradingPass);

  // 6. Film grain (reduces banding in dark space gradients)
  const filmGrainPass = new ShaderPass(FilmGrainShader);
  composer.addPass(filmGrainPass);

  // 7. Output (tone mapping + color space conversion)
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // ── Resize Handler ──
  const resize = (w: number, h: number): void => {
    composer.setSize(w, h);
    smaaPass.setSize(w * pixelRatio, h * pixelRatio);
  };

  // ── VP Sync ──
  VP.subscribe((key) => {
    switch (key) {
      case 'bloomStrength':
        bloomPass.strength = VP.get('bloomStrength');
        break;
      case 'bloomRadius':
        bloomPass.radius = VP.get('bloomRadius');
        break;
      case 'bloomThreshold':
        bloomPass.threshold = VP.get('bloomThreshold');
        break;
      case 'vignetteIntensity':
        (vignettePass.material as ShaderMaterial).uniforms.uIntensity.value = VP.get('vignetteIntensity');
        break;
      case 'vignetteDropoff':
        (vignettePass.material as ShaderMaterial).uniforms.uDropoff.value = VP.get('vignetteDropoff');
        break;
      case 'smaaEnabled':
        smaaPass.enabled = VP.get('smaaEnabled');
        break;
    }
  });

  return {
    composer,
    bloomPass,
    smaaPass,
    vignettePass,
    filmGrainPass,
    colorGradingPass,
    resize,
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
