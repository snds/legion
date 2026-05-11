// ═══════════════════════════════════════════════════════════════════
// LENS FLARE — Procedural Lens Flare Post-Processing Pass
// Projects star position to screen space, checks viewport bounds,
// applies exponential fade for smooth transitions, and inserts
// a ShaderPass into the post-processing chain.
// ═══════════════════════════════════════════════════════════════════

import { Vector3, Vector2, PerspectiveCamera, Raycaster, ShaderMaterial } from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { lensFlareVertexShader, lensFlareFragmentShader } from './shaders/lens-flare';
import { VP } from './visual-params';
import { Game } from '../core/state';
import type { PostProcessingContext } from './post-processing';

export interface LensFlareSystem {
  pass: ShaderPass;
  /** Call each frame with star world position and camera */
  update: (starWorldPos: Vector3, camera: PerspectiveCamera, dt: number) => void;
}

export function createLensFlare(postCtx: PostProcessingContext): LensFlareSystem {
  const shader = {
    uniforms: {
      tDiffuse: { value: null },
      uLightPos: { value: new Vector2(0.5, 0.5) },
      uIntensity: { value: 0 },
      uOpacity: { value: VP.get('lensFlareOpacity') },
      uStarPoints: { value: VP.get('lensFlareStarPoints') },
      uGlareSize: { value: VP.get('lensFlareGlareSize') },
      uFlareSize: { value: VP.get('lensFlareFlareSize') },
      uFlareSpeed: { value: VP.get('lensFlareFlareSpeed') },
      uHaloScale: { value: VP.get('lensFlareHaloScale') },
      uColorGain: { value: new Vector3(
        VP.get('lensFlareColorR'),
        VP.get('lensFlareColorG'),
        VP.get('lensFlareColorB'),
      ) },
      uTime: { value: 0 },
    },
    vertexShader: lensFlareVertexShader,
    fragmentShader: lensFlareFragmentShader,
  };

  const pass = new ShaderPass(shader);
  pass.enabled = VP.get('lensFlareEnabled');

  // Insert into composer at the reserved index (after bloom, before vignette)
  postCtx.composer.insertPass(pass, postCtx.lensFlareInsertIndex);

  // Smoothed intensity for fade transitions
  let currentIntensity = 0;
  let elapsedTime = 0;

  // Projected screen position (reusable)
  const screenPos = new Vector3();

  function update(starWorldPos: Vector3, camera: PerspectiveCamera, dt: number): void {
    if (!VP.get('lensFlareEnabled')) {
      pass.enabled = false;
      return;
    }
    pass.enabled = true;
    elapsedTime += dt;

    // Only active in local/solar system view
    const domain = Game.data.zoomDomain;
    if (domain !== 'surface' && domain !== 'system' && domain !== 'heliopause') {
      currentIntensity = 0;
      (pass.material as ShaderMaterial).uniforms.uIntensity.value = 0;
      return;
    }

    // Project star to screen space
    screenPos.copy(starWorldPos);
    screenPos.project(camera);

    // Check if star is in front of camera and within viewport
    const inFront = screenPos.z < 1;
    const inViewport = Math.abs(screenPos.x) < 1.3 && Math.abs(screenPos.y) < 1.3;

    // Target intensity based on visibility
    let targetIntensity = 0;
    if (inFront && inViewport) {
      // Fade based on distance from screen center (stronger when looking directly at star)
      const centerDist = Math.sqrt(screenPos.x * screenPos.x + screenPos.y * screenPos.y);
      targetIntensity = Math.max(0, 1.0 - centerDist * 0.4);
    }

    // Exponential smoothing for smooth fade
    const alpha = 1 - Math.exp(-20 * dt);
    currentIntensity += (targetIntensity - currentIntensity) * alpha;

    // Update uniforms
    const mat = pass.material as ShaderMaterial;
    mat.uniforms.uIntensity.value = currentIntensity;
    mat.uniforms.uTime.value = elapsedTime;

    // Convert from NDC (-1 to 1) to UV (0 to 1)
    mat.uniforms.uLightPos.value.set(
      screenPos.x * 0.5 + 0.5,
      screenPos.y * 0.5 + 0.5,
    );
  }

  // VP sync
  VP.subscribe((key) => {
    const mat = pass.material as ShaderMaterial;
    switch (key) {
      case 'lensFlareEnabled':
        pass.enabled = VP.get('lensFlareEnabled');
        break;
      case 'lensFlareOpacity':
        mat.uniforms.uOpacity.value = VP.get(key);
        break;
      case 'lensFlareStarPoints':
        mat.uniforms.uStarPoints.value = VP.get(key);
        break;
      case 'lensFlareGlareSize':
        mat.uniforms.uGlareSize.value = VP.get(key);
        break;
      case 'lensFlareFlareSize':
        mat.uniforms.uFlareSize.value = VP.get(key);
        break;
      case 'lensFlareFlareSpeed':
        mat.uniforms.uFlareSpeed.value = VP.get(key);
        break;
      case 'lensFlareHaloScale':
        mat.uniforms.uHaloScale.value = VP.get(key);
        break;
      case 'lensFlareColorR':
      case 'lensFlareColorG':
      case 'lensFlareColorB':
        mat.uniforms.uColorGain.value.set(
          VP.get('lensFlareColorR'),
          VP.get('lensFlareColorG'),
          VP.get('lensFlareColorB'),
        );
        break;
    }
  });

  return { pass, update };
}
