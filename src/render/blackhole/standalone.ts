// ═══════════════════════════════════════════════════════════════════
// BLACK-HOLE STANDALONE TEST SCENE
//
// A minimal harness to view the geodesic renderer in isolation — no game, no
// streaming, just a procedural star cubemap, a draggable orbit camera, and one
// BlackHole. Served at /blackhole.html in dev (npm run dev). Use it to eyeball
// the shadow, photon ring, Einstein lensing of the starfield, and the Doppler-
// asymmetric accretion disk without booting the whole galaxy.
//
// Controls: drag to orbit · scroll to zoom · [ ] to shrink/grow the disk tilt.
// ═══════════════════════════════════════════════════════════════════

import {
  WebGLRenderer, Scene, PerspectiveCamera, Vector3, Color,
  Points, BufferGeometry, Float32BufferAttribute, PointsMaterial,
  CubeCamera, WebGLCubeRenderTarget, HalfFloatType, LinearFilter, Vector2,
  AdditiveBlending, AgXToneMapping, type CubeTexture,
} from 'three';
import { createBlackHole } from './blackhole';

/** Bake a procedural star cubemap: a sphere of coloured point-stars, rendered
 *  once through a CubeCamera. Gives the geodesic shader a real samplerCube to
 *  lens. */
function bakeStarCubemap(renderer: WebGLRenderer, count = 4000, resolution = 1024): CubeTexture {
  const scene = new Scene();
  scene.background = new Color(0x01010a);

  const positions: number[] = [];
  const colors: number[] = [];
  const palette = [
    new Color(0xffffff), new Color(0xbfd0ff), new Color(0x9fb8ff),
    new Color(0xffe6c0), new Color(0xffd0a0), new Color(0xfff4e0),
  ];
  // Deterministic PRNG so the starfield is identical run-to-run.
  let seed = 1337;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < count; i++) {
    // Uniform point on a sphere.
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const dir = new Vector3(r * Math.cos(theta), u, r * Math.sin(theta)).multiplyScalar(2000);
    positions.push(dir.x, dir.y, dir.z);
    const c = palette[(rand() * palette.length) | 0];
    const b = 0.4 + rand() * rand() * 3.0; // a few bright, many faint (HDR)
    colors.push(c.r * b, c.g * b, c.b * b);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const mat = new PointsMaterial({
    size: 6, sizeAttenuation: true, vertexColors: true,
    blending: AdditiveBlending, depthWrite: false, transparent: true,
  });
  scene.add(new Points(geo, mat));

  const cubeRT = new WebGLCubeRenderTarget(resolution, {
    type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter,
  });
  const cubeCam = new CubeCamera(1, 5000, cubeRT);
  cubeCam.update(renderer, scene);

  geo.dispose();
  mat.dispose();
  return cubeRT.texture;
}

export function startBlackholeStandalone(container: HTMLElement = document.body): () => void {
  // Some headless/embedded browser panes report window.innerHeight === 0 for
  // layout APIs; fall back to a sane fixed size so the renderer and the LOD
  // math (which need a real viewport height) stay well-defined.
  const viewport = (): { w: number; h: number } => ({
    w: window.innerWidth || 1280,
    h: window.innerHeight || 720,
  });

  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  { const v = viewport(); renderer.setSize(v.w, v.h); }
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;';
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(50, viewport().w / viewport().h, 0.1, 100000);

  const starCube = bakeStarCubemap(renderer);
  scene.background = starCube;

  // r_s = 1 WU → bounding sphere 25 WU, disk out to 12 r_s. Tilt the disk so we
  // see its face and the lensed far side arcing over the top (the Interstellar look).
  const bh = createBlackHole({
    rsWorld: 1,
    absPos: new Vector3(0, 0, 0),
    background: starCube,
    diskOuter: 12,
    diskTempK: 13000,
    diskBrightness: 1.2,
    bgIntensity: 1.0,
    spin: 1,
    diskNormal: new Vector3(0.32, 1.0, 0.0).normalize(),
  });
  scene.add(bh.group);
  // Single debug handle for the test harness (inspect uniforms, force LOD, etc.).
  Object.assign(window as unknown as Record<string, unknown>, { __blackhole: { scene, camera, renderer, bh } });

  // ── Minimal orbit controls ─────────────────────────────────────
  let radius = 90, azim = 0.6, elev = 0.28;
  const applyCam = (): void => {
    const ce = Math.cos(elev);
    camera.position.set(
      radius * ce * Math.sin(azim),
      radius * Math.sin(elev),
      radius * ce * Math.cos(azim),
    );
    camera.lookAt(0, 0, 0);
  };
  applyCam();

  let dragging = false, lx = 0, ly = 0;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    azim -= (e.clientX - lx) * 0.005;
    elev = Math.max(-1.4, Math.min(1.4, elev + (e.clientY - ly) * 0.005));
    lx = e.clientX; ly = e.clientY;
    applyCam();
  });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    radius = Math.max(30, Math.min(4000, radius * (1 + Math.sign(e.deltaY) * 0.08)));
    applyCam();
  }, { passive: false });

  const onResize = (): void => {
    const v = viewport();
    camera.aspect = v.w / v.h;
    camera.updateProjectionMatrix();
    renderer.setSize(v.w, v.h);
  };
  window.addEventListener('resize', onResize);

  let raf = 0, alive = true;
  const _bufSize = new Vector2();
  const loop = (): void => {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    const viewH = renderer.getDrawingBufferSize(_bufSize).y || viewport().h;
    bh.update(renderer, camera, viewH);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  };
  loop();

  return (): void => {
    alive = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    bh.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

// Auto-start when loaded as a page entry.
if (typeof document !== 'undefined' && document.getElementById('blackhole-root')) {
  startBlackholeStandalone(document.getElementById('blackhole-root')!);
}
