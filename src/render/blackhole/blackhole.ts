// ═══════════════════════════════════════════════════════════════════
// BLACK HOLE — self-contained galaxy-tier set-piece
//
// Wraps the geodesic shader in a drop-in Object3D. It renders the black hole to
// a small half-res target with a FullScreenQuad (the real per-pixel null-
// geodesic tracer), then displays that target on a camera-facing billboard in
// the main scene — so it composites through the normal render + bloom + AgX
// pipeline with no extra post pass, and rides the galactic tier's floating
// origin via Broker.getResidual().
//
// Distance LOD: far away the lensing footprint shrinks below a few pixels, so
// the tracer is skipped and the hole becomes a clean additive point of light.
//
// Placement is deterministic — the caller supplies an absolute galactocentric
// scene-WU position; the residual is recomputed every frame from the Broker.
// ═══════════════════════════════════════════════════════════════════

import {
  Group, Mesh, PlaneGeometry, MeshBasicMaterial, Sprite, SpriteMaterial,
  WebGLRenderTarget, HalfFloatType, RGBAFormat, LinearFilter, ClampToEdgeWrapping,
  NormalBlending, AdditiveBlending, Vector3, Matrix4, Color, DataTexture,
  DoubleSide, MathUtils,
  type WebGLRenderer, type PerspectiveCamera, type Texture, type CubeTexture, type ShaderMaterial,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { Broker } from '../scale-manager';
import { createBlackholeMaterial, R_BOUND, DISK_ACCENT } from './blackhole-shader';
import { buildBlackbodyRamp } from './blackbody';

export interface BlackHoleOptions {
  /** Schwarzschild radius r_s = 2GM/c² in world units — sets the physical scale. */
  rsWorld: number;
  /** Absolute galactocentric scene-WU position (deterministic; rebased each frame). */
  absPos: Vector3;
  /** Star cubemap sampled by escaped rays (flat-space background). */
  background: CubeTexture;
  /** Optional prebuilt blackbody ramp; one is baked if omitted. */
  diskRamp?: Texture;
  /** Outer disk radius in r_s units (inner edge is the ISCO = 3 r_s). */
  diskOuter?: number;
  /** Peak effective disk temperature (K). */
  diskTempK?: number;
  /** Overall disk emission scale. */
  diskBrightness?: number;
  /** Background sampling gain. */
  bgIntensity?: number;
  /** Disk rotation sense: +1 prograde (default), −1 retrograde. */
  spin?: number;
  /** Disk-plane normal in world space (default +Y; tilt for a dramatic angle). */
  diskNormal?: Vector3;
  /** Max side length of the half-res target (default 512). */
  maxRTSize?: number;
  /** Footprint (in projected px) below which the hole LODs to a point sprite. */
  pointLodPx?: number;
}

/** Build a soft radial-glow DataTexture for the point-of-light LOD sprite. */
function buildGlowTexture(size = 64): Texture {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const r = Math.sqrt(dx * dx + dy * dy);
      const a = Math.max(0, 1 - r);
      const g = a * a * a; // tight core, soft halo
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(g * 255);
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Nearest power-of-two bucket in [min,max] for a target pixel size. */
function bucketPow2(px: number, min: number, max: number): number {
  let s = 64;
  while (s < px && s < max) s *= 2;
  return MathUtils.clamp(s, min, max);
}

export class BlackHole {
  /** Add this to the scene (or a galactic-tier group). */
  readonly group = new Group();

  private readonly absPos: Vector3;
  private readonly rsWorld: number;
  private readonly pointLodPx: number;
  private readonly maxRTSize: number;

  private readonly quad: FullScreenQuad;
  private readonly material: ShaderMaterial;
  private rt: WebGLRenderTarget;
  private rtSize = 0;

  private readonly billboard: Mesh;
  private readonly billboardMat: MeshBasicMaterial;
  private readonly sprite: Sprite;
  private readonly ownedRamp: Texture | null;
  private readonly glowTex: Texture;

  // Scratch — never allocate in the frame loop.
  private readonly _bhScene = new Vector3();
  private readonly _rel = new Vector3();
  private readonly _normal = new Vector3();
  private readonly _right = new Vector3();
  private readonly _up = new Vector3();
  private readonly _camUp = new Vector3();
  private readonly _basis = new Matrix4();
  private readonly _prevClear = new Color();

  constructor(opts: BlackHoleOptions) {
    this.absPos = opts.absPos.clone();
    this.rsWorld = opts.rsWorld;
    this.pointLodPx = opts.pointLodPx ?? 6;
    this.maxRTSize = opts.maxRTSize ?? 512;

    this.ownedRamp = opts.diskRamp ? null : buildBlackbodyRamp();
    const diskRamp = opts.diskRamp ?? this.ownedRamp!;

    this.material = createBlackholeMaterial({
      background: opts.background,
      diskRamp,
      diskOuter: opts.diskOuter ?? 12.0,
      diskTempK: opts.diskTempK ?? 12000,
      diskBrightness: opts.diskBrightness ?? 2.0,
      bgIntensity: opts.bgIntensity ?? 1.0,
      spin: opts.spin ?? 1.0,
    });
    if (opts.diskNormal) {
      (this.material.uniforms.uDiskNormal.value as Vector3).copy(opts.diskNormal).normalize();
    }
    this.quad = new FullScreenQuad(this.material);

    // Half-res target (HDR so the disk's g³ beaming survives into bloom).
    this.rt = this.makeRT(256);

    // Display billboard — samples the target; feathered alpha from the shader.
    this.billboardMat = new MeshBasicMaterial({
      map: this.rt.texture,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      side: DoubleSide,
      toneMapped: false, // linear HDR into the composer; single AgX in OutputPass
    });
    this.billboard = new Mesh(new PlaneGeometry(1, 1), this.billboardMat);
    this.billboard.frustumCulled = false;
    this.billboard.renderOrder = 3000; // after opaque scene, before HUD overlays
    this.group.add(this.billboard);

    // Point-of-light LOD sprite. Colour driven HDR-bright (>1) so the game's
    // bloom picks it up as a luminous point, matching the disk it replaces.
    this.glowTex = buildGlowTexture();
    const spriteMat = new SpriteMaterial({
      map: this.glowTex,
      color: new Color().copy(DISK_ACCENT).multiplyScalar(3.0),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    this.sprite = new Sprite(spriteMat);
    this.sprite.visible = false;
    this.group.add(this.sprite);
  }

  private makeRT(size: number): WebGLRenderTarget {
    this.rtSize = size;
    return new WebGLRenderTarget(size, size, {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
    });
  }

  /** World size that subtends `px` screen pixels at `dist`, for the given camera. */
  private worldSizeForPx(px: number, dist: number, camera: PerspectiveCamera, viewH: number): number {
    const worldPerPx = (2 * Math.tan(MathUtils.degToRad(camera.fov) * 0.5) * dist) / viewH;
    return px * worldPerPx;
  }

  /**
   * Per-frame update. Call after the camera + Broker.beginFrame have run.
   * `viewportHeight` is the drawing-buffer height in px (for LOD sizing).
   */
  update(renderer: WebGLRenderer, camera: PerspectiveCamera, viewportHeight: number): void {
    // Guard against a bogus 0/negative height (some headless canvases report
    // domElement.height === 0) — otherwise the footprint collapses and the hole
    // silently never leaves point-sprite LOD.
    const viewH = viewportHeight > 0 ? viewportHeight : 1080;

    // Deterministic placement rebased through the floating origin this frame.
    Broker.getResidual(this.absPos, this._bhScene);
    this.group.position.copy(this._bhScene);

    this._rel.copy(camera.position).sub(this._bhScene);
    const dist = this._rel.length();
    if (dist < 1e-6) { this.billboard.visible = false; this.sprite.visible = false; return; }

    const rBoundWorld = R_BOUND * this.rsWorld;
    // Projected footprint of the bounding sphere (diameter) in px.
    const footprintPx = (2 * rBoundWorld / dist)
      / (2 * Math.tan(MathUtils.degToRad(camera.fov) * 0.5)) * viewH;

    // ── Far LOD: clean point of light ──────────────────────────────
    if (footprintPx < this.pointLodPx) {
      this.billboard.visible = false;
      this.sprite.visible = true;
      // Keep the point ~pointLodPx wide so it reads as a star, never vanishing.
      const s = this.worldSizeForPx(Math.max(this.pointLodPx, 3), dist, camera, viewH);
      this.sprite.scale.setScalar(s);
      return;
    }

    // ── Near LOD: full geodesic trace ──────────────────────────────
    this.billboard.visible = true;
    this.sprite.visible = false;

    // Orient the billboard to face the camera (normal → camera), keeping the
    // camera's up so the disk tilt reads correctly as you orbit.
    this._normal.copy(this._rel).normalize();
    this._camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this._right.crossVectors(this._camUp, this._normal).normalize();
    if (this._right.lengthSq() < 1e-8) this._right.set(1, 0, 0); // camera looked along up
    this._up.crossVectors(this._normal, this._right).normalize();

    const half = rBoundWorld * 1.3; // margin so lensed rays (b→R_BOUND) are covered
    this._basis.makeBasis(this._right, this._up, this._normal);
    this.billboard.quaternion.setFromRotationMatrix(this._basis);
    this.billboard.scale.setScalar(2 * half);
    this.billboard.position.set(0, 0, 0); // centred on the BH within the group

    // Feed the geodesic shader (BH-centred, r_s units).
    const u = this.material.uniforms;
    (u.uCamPos.value as Vector3).copy(this._rel).divideScalar(this.rsWorld);
    (u.uBillboardCenter.value as Vector3).set(0, 0, 0);
    (u.uBillboardRight.value as Vector3).copy(this._right).multiplyScalar(half / this.rsWorld);
    (u.uBillboardUp.value as Vector3).copy(this._up).multiplyScalar(half / this.rsWorld);

    // Size the half-res target to the on-screen footprint (never above cap).
    const targetSize = bucketPow2(Math.ceil(footprintPx * 0.5), 64, this.maxRTSize);
    if (targetSize !== this.rtSize) {
      this.rt.dispose();
      this.rt = this.makeRT(targetSize);
      this.billboardMat.map = this.rt.texture;
      this.billboardMat.needsUpdate = true;
    }

    // Render the geodesic pass into the half-res target. Save/restore the full
    // renderer clear state so this leaves no side effects on the main pipeline.
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this._prevClear);
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    this.quad.render(renderer);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(this._prevClear, prevAlpha);
  }

  dispose(): void {
    this.rt.dispose();
    this.quad.dispose();
    this.material.dispose();
    this.billboard.geometry.dispose();
    this.billboardMat.dispose();
    (this.sprite.material as SpriteMaterial).dispose();
    this.glowTex.dispose();
    if (this.ownedRamp) this.ownedRamp.dispose();
    this.group.removeFromParent();
  }
}

/** Convenience factory mirroring the codebase's create* helpers. */
export function createBlackHole(opts: BlackHoleOptions): BlackHole {
  return new BlackHole(opts);
}
