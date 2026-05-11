// ═══════════════════════════════════════════════════════════════════
// RENDERER — WebGL 2 with ACES Filmic Tone Mapping
// Matches the monolithic prototype's rendering pipeline.
// ═══════════════════════════════════════════════════════════════════

import { WebGLRenderer, ACESFilmicToneMapping } from 'three';
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
    antialias: true,
    logarithmicDepthBuffer: true,
  });

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = ACESFilmicToneMapping;
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
