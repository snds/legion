// ═══════════════════════════════════════════════════════════════════
// GALAXY SIM — a standalone view of the NEW physically-generated galaxy (galaxy-physical.ts), so its look
// can be judged on its own before it's wired into the main engine's galaxy tier. No sectors, no image, no
// paint tools: one globally-sampled star set (exponential disc + bulge + density-wave arms) at the scene
// origin, with a free-fly camera. Load with ?galaxy-sim. (Kinematic rotation is the next step.)
// ═══════════════════════════════════════════════════════════════════

import { Group, PerspectiveCamera, Scene } from 'three';
import { OrbitFlyCamera } from './galaxy-paint';
import {
  samplePhysicalGalaxy, buildPhysicalGalaxyPoints, DEFAULT_PHYSICAL_CONFIG, type PhysicalGalaxyData,
} from './galaxy-physical';
import type { RendererContext } from './renderer';

export interface GalaxySim {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly cam: OrbitFlyCamera;
  readonly data: PhysicalGalaxyData;
}

/** Boot the standalone physical-galaxy view. `shouldRun` (the boot-gen check) self-terminates + cleans up
 *  on HMR/reload, mirroring the other shells. */
export function bootGalaxySim(renderCtx: RendererContext, shouldRun: () => boolean): GalaxySim {
  const scene = new Scene();
  const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 100, 2e8);
  const root = new Group();
  root.name = 'galaxy-sim-root';
  scene.add(root);

  const data = samplePhysicalGalaxy(DEFAULT_PHYSICAL_CONFIG);
  const { points, material } = buildPhysicalGalaxyPoints(data);
  root.add(points);

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

  const sim: GalaxySim = { scene, camera, cam, data };
  (globalThis as Record<string, unknown>).__galsim = sim;
  console.info(`[galaxy-sim] ${data.count.toLocaleString()} stars — physically sampled (disc + bulge + density-wave arms); drag/2-finger orbit, pinch/wheel zoom`);

  function loop(): void {
    if (!shouldRun()) {
      cam.dispose();
      points.geometry.dispose();
      material.dispose();
      window.removeEventListener('resize', onResize);
      return;
    }
    requestAnimationFrame(loop);
    cam.update();
    renderCtx.renderer.render(scene, camera);
  }
  loop();
  return sim;
}
