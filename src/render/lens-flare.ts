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
import { SYSTEM_TIER_SCALE } from '../core/metrics';
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
    // Lens flare reads at any tier where the local star is a real body in
    // the scene. At sector+ the star becomes an icon and a flare is meaningless.
    const isStarVisible =
      domain === 'surface' || domain === 'low-orbit' || domain === 'orbit' ||
      domain === 'inner-system' || domain === 'outer-system' || domain === 'heliopause';
    if (!isStarVisible) {
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

    // ZOOM SCALING: the flare used to hold one apparent size from surface all
    // the way to the heliopause, then hard-cut at the domain flip. Shrink the
    // glare/flare/halo with camera distance (full size inside ~6 AU, gently
    // receding beyond) and ease intensity out across the heliopause band so
    // the exit is a fade, not a pop.
    //
    // Scale-unification U2: these distance bands (60/1600/3000 WU) were tuned for
    // the legacy system-tier camDist magnitudes (1 AU = 10 WU). The unified metric
    // renders the system at TRUE scale, so camDist is SYSTEM_TIER_SCALE× smaller —
    // left raw it clamps sizeScale to 1 and pins helioFade at 1 across the whole
    // system, so the flare never shrinks or fades and blows out the frame as you
    // pull back. Convert camDist back to the legacy frame (÷ SYSTEM_TIER_SCALE) so
    // the bands ride the scale and the flare behaves exactly as before U2.
    const camDist = Game.data.camDist / SYSTEM_TIER_SCALE;
    const sizeScale = Math.min(1, Math.max(0.2, Math.pow(60 / Math.max(camDist, 1), 0.35)));
    const t = Math.min(1, Math.max(0, (camDist - 1600) / (3000 - 1600)));
    const helioFade = 1 - t * t * (3 - 2 * t);

    // Target intensity based on visibility
    let targetIntensity = 0;
    if (inFront && inViewport) {
      // Fade based on distance from screen center (stronger when looking directly at star)
      const centerDist = Math.sqrt(screenPos.x * screenPos.x + screenPos.y * screenPos.y);
      targetIntensity = Math.max(0, 1.0 - centerDist * 0.4) * helioFade;
    }

    // Exponential smoothing for smooth fade
    const alpha = 1 - Math.exp(-20 * dt);
    currentIntensity += (targetIntensity - currentIntensity) * alpha;

    // Update uniforms
    const mat = pass.material as ShaderMaterial;
    mat.uniforms.uIntensity.value = currentIntensity;
    mat.uniforms.uTime.value = elapsedTime;
    // Size uniforms per frame = VP base × zoom scale (the VP.subscribe writes
    // below are superseded for these three keys but kept harmless).
    mat.uniforms.uGlareSize.value = VP.get('lensFlareGlareSize') * sizeScale;
    mat.uniforms.uFlareSize.value = VP.get('lensFlareFlareSize') * sizeScale;
    mat.uniforms.uHaloScale.value = VP.get('lensFlareHaloScale') * sizeScale;

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
