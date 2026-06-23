// ═══════════════════════════════════════════════════════════════════
// RENDERER — WebGL 2 with AgX Tone Mapping
// AgX (Sobotka) replaces ACES Filmic: ACES has the "notorious six" hue skew
// (saturated blues → purple, oranges → red) which destroys exactly the
// blackbody O/B-blue vs M-orange star colors the scene depends on. AgX rolls
// saturated emissives to white with far less hue distortion via inset/outset
// gamut compression + a log2 sigmoid. Applied by the post chain's OutputPass.
// See docs/space-engine-techniques-for-legion.md §5.8.
// ═══════════════════════════════════════════════════════════════════

import { WebGLRenderer, AgXToneMapping } from 'three';
import { VP } from './visual-params'; // ADMIN VISUAL EDITOR — REMOVE

export interface RendererContext {
  renderer: WebGLRenderer;
  canvas: HTMLCanvasElement;
  backend: 'webgl';
  maxAnisotropy: number;
  dispose: () => void;
}

export async function createRenderer(
  container: HTMLElement,
): Promise<RendererContext> {
  const renderer = new WebGLRenderer({
    // GPU hardware acceleration: ask the browser for the discrete / high-perf
    // GPU rather than the integrated one (the default on dual-GPU laptops). Big
    // win on MacBook Pro / gaming laptops; no-op on single-GPU machines.
    powerPreference: 'high-performance',
    // AA is done by the post chain's SMAAPass (post-processing.ts), and the
    // scene renders to the EffectComposer's render target — so a multisampled
    // DEFAULT framebuffer (antialias:true) only AA's the final full-screen quad
    // (nothing to AA) while costing an MSAA buffer + resolve. Turn it off.
    antialias: false,
    logarithmicDepthBuffer: true,
  });

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = VP.get('toneMappingExposure');
  renderer.sortObjects = true;

  // Accessibility
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    '3D space visualization — use scroll to zoom, right-drag to orbit',
  );
  canvas.style.display = 'block';
  // Touch devices: claim all gestures on the canvas (orbit/pinch handled in
  // input.ts) — prevents iOS page scroll, rubber-banding, and double-tap zoom.
  canvas.style.touchAction = 'none';

  container.prepend(canvas);

  // Resize handler
  const onResize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  // ADMIN VISUAL EDITOR — REMOVE
  VP.subscribe((key) => {
    if (key === 'toneMappingExposure') {
      renderer.toneMappingExposure = VP.get('toneMappingExposure');
    }
  });

  console.info(
    `[Renderer] WebGL initialized | Anisotropy: ${maxAnisotropy} | DPR: ${renderer.getPixelRatio()}`,
  );

  return {
    renderer,
    canvas,
    backend: 'webgl',
    maxAnisotropy,
    dispose: () => {
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    },
  };
}
