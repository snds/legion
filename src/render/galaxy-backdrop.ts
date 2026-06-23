// ═══════════════════════════════════════════════════════════════════
// GALAXY BACKDROP — bake the Milky Way to a cubemap, once, at boot
//
// At system tiers the live galaxy layer is culled, so without this the sky
// has no Milky Way. We bake the galaxy (volume + star particles + nebulae)
// from SCENE ORIGIN — getGalaxyOffset() places the home system there, so the
// cube is the sky as seen from the player's system — into a HalfFloat-1024
// cubemap used as `scene.background` below the sector tier. Zero per-frame
// cost; the EVE/Elite "bake the view" pattern (docs/galaxy-visual-redesign.md
// §5.2).
//
// WHY THIS WORKS NOW (it failed in June's first attempt): the volume marches
// the shared analytic model whose interior view is CI-PROVEN to be a thin
// band, not fog (galaxy-density.test.ts — band/pole 8–30×, GC/anticenter
// 2–4×, longitude variation ≥2×). The bake swaps a 256-step variant of the
// SAME material onto the volume mesh: no frame budget, and long in-plane
// rays get the sampling they need (§4.4).
//
// The cube is linear-HDR; tone mapping / auto-exposure / bloom apply when it
// is drawn through the post chain like any scene content.
// ═══════════════════════════════════════════════════════════════════

import {
  WebGLCubeRenderTarget, CubeCamera, HalfFloatType, LinearFilter,
  Color, ShaderMaterial, Mesh,
  type WebGLRenderer, type Scene, type Group, type CubeTexture,
} from 'three';
import { updateGalaxyLOD } from './galaxy';
import {
  galacticDiscVolumeVertexShader, galacticDiscVolumeFragmentShader,
} from './shaders/galactic-disc-volume';

/**
 * Render the galaxy group into a cubemap from scene origin and return the
 * CubeTexture (usable as `scene.background`). One-shot at boot: six renders
 * of the galaxy-only scene, with the volume temporarily upgraded to 256
 * march steps.
 */
export function bakeGalaxyBackdrop(
  renderer: WebGLRenderer,
  scene: Scene,
  galaxyGroup: Group,
  resolution = 1024,
): CubeTexture {
  // Hide everything except the galaxy; remember exact prior visibility.
  const saved = scene.children.map((c) => [c, c.visible] as const);
  for (const [c] of saved) c.visible = c === galaxyGroup;
  galaxyGroup.visible = true;

  // Force full LOD presence (star sizes/opacities are camDist-ramped). Phase
  // 2c-1: the disc presence + crossfade ramps now peak at galaxy-scale camDist
  // (~2e6), so seed past them or the bake captures an empty (transparent) disc.
  updateGalaxyLOD(1e7);

  // Bake the VOLUME ONLY. The galaxy's star Points and (billboard) nebula
  // sprites don't tile seamlessly into a cubemap — sprites orient to each of
  // the 6 face cameras, so they mismatch at face edges and read as a hard
  // cube-face seam in the dim backdrop. The resolved foreground stars now come
  // from the real HYG catalogue (star-field.ts), so the cube only needs the
  // smooth, view-continuous diffuse glow of the volume raymarch. Hide every
  // galaxy child except the volume mesh for the bake; restore after.
  const volumeMesh = galaxyGroup.getObjectByName('galactic-disc-volume') as Mesh | undefined;
  const savedChildren = galaxyGroup.children.map((c) => [c, c.visible] as const);
  for (const [c] of savedChildren) c.visible = c === volumeMesh;

  // Swap the 256-step bake variant onto the volume mesh (shared uniforms —
  // same medium, same single brightness knob).
  let liveMat: ShaderMaterial | null = null;
  let bakeMat: ShaderMaterial | null = null;
  if (volumeMesh) {
    liveMat = volumeMesh.material as ShaderMaterial;
    bakeMat = liveMat.clone();
    bakeMat.uniforms = liveMat.uniforms; // share — one set of medium constants
    bakeMat.defines = { ...(bakeMat.defines ?? {}), STEPS: '256' };
    bakeMat.needsUpdate = true;
    // No jitter for the bake: 256 steps don't band, and baking the per-pixel
    // jitter into static cube texels produced visible grain + a cube-face
    // seam in the dim backdrop. Uniforms are shared with liveMat, so restore
    // it to 1 afterward.
    if (bakeMat.uniforms.uJitter) bakeMat.uniforms.uJitter.value = 0;
    volumeMesh.material = bakeMat;
  }

  const prevBg = scene.background;
  scene.background = null; // capture the galaxy over a black sky

  const cubeRT = new WebGLCubeRenderTarget(resolution, {
    type: HalfFloatType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });
  // far 3.6e7: Phase 2c-1 lifts the galaxy to the unified frame (disc radius
  // ~1.5e7 WU; far disc edge ~2.3e7 from home), so the system-tier Milky Way
  // bake must reach past it or the band clips to a black hemisphere.
  const cubeCam = new CubeCamera(1, 3.6e7, cubeRT);
  cubeCam.position.set(0, 0, 0); // the home system's position in the galaxy
  scene.add(cubeCam);
  cubeCam.update(renderer, scene);
  scene.remove(cubeCam);

  // Restore everything exactly.
  scene.background = prevBg;
  if (volumeMesh && liveMat) {
    if (liveMat.uniforms.uJitter) liveMat.uniforms.uJitter.value = 1; // shared — re-enable for live
    volumeMesh.material = liveMat;
    bakeMat?.dispose();
  }
  for (const [c, v] of savedChildren) c.visible = v; // galaxy children
  for (const [c, v] of saved) c.visible = v;          // scene roots

  return cubeRT.texture;
}

/** Flat deep-space color used at the galactic tiers, where the live galaxy
 *  renders against it (matches scene.ts). */
export const DEEP_SPACE_BG = new Color(0x020208);
