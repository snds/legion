// ═══════════════════════════════════════════════════════════════════
// SUN SYSTEM — Assembles all sun shader layers
// Creates: Perlin cubemap generator, surface mesh, glow shell, corona rays.
// Returns a group + update function called each frame.
// ═══════════════════════════════════════════════════════════════════

import {
  Group, Mesh, SphereGeometry, BoxGeometry, ShaderMaterial,
  WebGLCubeRenderTarget, CubeCamera, WebGLRenderer, Scene,
  RGBAFormat, UnsignedByteType,
  NoBlending, AdditiveBlending, BackSide, DoubleSide,
  BufferGeometry, Float32BufferAttribute,
  Color, Line, LineBasicMaterial, CubicBezierCurve3, Vector3,
} from 'three';
import { perlinVertexShader, perlinFragmentShader } from './shaders/sun-perlin';
import { sunSurfaceVertexShader, sunSurfaceFragmentShader } from './shaders/sun-surface';
import { sunGlowVertexShader, sunGlowFragmentShader } from './shaders/sun-glow';
import { sunRaysVertexShader, sunRaysFragmentShader } from './shaders/sun-rays';
import { VP } from './visual-params';

export interface SunSystem {
  group: Group;
  /** Call each frame with renderer + dt to update animated cubemap and uniforms */
  update: (renderer: WebGLRenderer, dt: number) => void;
  /** Release GPU resources (cubemap RT, geometries, materials) + the VP
   *  subscription — the system-loader dispose path on a system swap. */
  dispose: () => void;
}

export function createSunSystem(radius: number): SunSystem {
  const group = new Group();
  group.name = 'sun-system';
  let elapsedTime = 0;   // wrapped at 1000 s for shader uTime uniforms
  let coronalRotY = 0;   // wrapped at 2π for seamless coronal rotation

  // ── 1. Perlin Cubemap Generator ──────────────────────────────

  const cubeRes = VP.get('sunPerlinRes');
  const cubeRT = new WebGLCubeRenderTarget(cubeRes, {
    format: RGBAFormat,
    type: UnsignedByteType,
    generateMipmaps: false,
  });
  const cubeCam = new CubeCamera(0.1, 100, cubeRT);

  const perlinMat = new ShaderMaterial({
    vertexShader: perlinVertexShader,
    fragmentShader: perlinFragmentShader,
    side: BackSide,
    uniforms: {
      uTime: { value: 0 },
      uSpatialFrequency: { value: VP.get('sunNoiseSpatialFreq') },
      uTemporalFrequency: { value: VP.get('sunNoiseTemporalFreq') },
      uH: { value: 1.0 },
      uContrast: { value: 0.25 },
      uFlatten: { value: 0.72 },
    },
  });
  const perlinBox = new Mesh(new BoxGeometry(2, 2, 2), perlinMat);
  // Not added to scene — used only for cubemap rendering

  // Scene for cubemap rendering (separate from main scene)
  // We'll render this using cubeCam.update in the update function

  // ── 2. Sun Surface ───────────────────────────────────────────

  const surfaceMat = new ShaderMaterial({
    vertexShader: sunSurfaceVertexShader,
    fragmentShader: sunSurfaceFragmentShader,
    transparent: false,
    blending: NoBlending,
    depthTest: true,
    depthWrite: true,
    uniforms: {
      uTime: { value: 0 },
      uPerlinCube: { value: cubeRT.texture },
      uFresnelPower: { value: VP.get('sunFresnelPower') },
      uFresnelInfluence: { value: VP.get('sunFresnelInfluence') },
      uTint: { value: VP.get('sunTint') },
      uBase: { value: 1.0 },
      uBrightnessOffset: { value: VP.get('sunBrightnessOffset') },
      uBrightness: { value: VP.get('sunBrightness') },
    },
  });
  const surfaceMesh = new Mesh(new SphereGeometry(radius, 64, 64), surfaceMat);
  surfaceMesh.renderOrder = 0;
  group.add(surfaceMesh);

  // ── 3. Glow Shell ────────────────────────────────────────────

  const glowMat = new ShaderMaterial({
    vertexShader: sunGlowVertexShader,
    fragmentShader: sunGlowFragmentShader,
    side: BackSide,
    transparent: true,
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    uniforms: {
      uExpand: { value: VP.get('sunGlowExpand') },
      uInner: { value: VP.get('sunGlowInner') },
      uOuter: { value: VP.get('sunGlowOuter') },
      uIntensity: { value: VP.get('sunGlowIntensity') },
      uTint: { value: 0.55 },
      uBrightness: { value: 2.5 },
    },
  });
  const glowMesh = new Mesh(new SphereGeometry(radius * 0.98, 32, 32), glowMat);
  glowMesh.frustumCulled = false;
  glowMesh.renderOrder = 1;
  group.add(glowMesh);

  // ── 4. Corona Rays ───────────────────────────────────────────

  const rayCount = VP.get('sunRayCount');
  const segmentsPerRay = 4;
  const vertsPerSeg = 2;
  const totalVerts = rayCount * segmentsPerRay * vertsPerSeg;

  const posAttr = new Float32Array(totalVerts * 4); // aPos: phase, side, segment, unused
  const pos0Attr = new Float32Array(totalVerts * 3); // aPos0: ray origin on sphere
  const randomAttr = new Float32Array(totalVerts * 4); // aRandom

  const indices: number[] = [];
  let vertIdx = 0;

  // Generate clustered ray directions
  let baseDir = randomSpherePoint();
  for (let ray = 0; ray < rayCount; ray++) {
    // Cluster: ~10% chance of picking a new base direction
    if (Math.random() < 0.1) {
      baseDir = randomSpherePoint();
    }
    const dir = normalizeVec3(addJitter(baseDir, 0.025));
    const rnd = [Math.random(), Math.random(), Math.random(), Math.random()];

    for (let seg = 0; seg < segmentsPerRay; seg++) {
      const phase = seg / (segmentsPerRay - 1);
      for (let side = 0; side < 2; side++) {
        const s = side === 0 ? -1 : 1;
        const vi = vertIdx * 4;
        posAttr[vi] = phase;
        posAttr[vi + 1] = s;
        posAttr[vi + 2] = seg;
        posAttr[vi + 3] = 0;

        const vi3 = vertIdx * 3;
        pos0Attr[vi3] = dir[0] * radius;
        pos0Attr[vi3 + 1] = dir[1] * radius;
        pos0Attr[vi3 + 2] = dir[2] * radius;

        const vi4 = vertIdx * 4;
        randomAttr[vi4] = rnd[0];
        randomAttr[vi4 + 1] = rnd[1];
        randomAttr[vi4 + 2] = rnd[2];
        randomAttr[vi4 + 3] = rnd[3];

        vertIdx++;
      }
    }

    // Create quad strip indices for this ray
    const base = ray * segmentsPerRay * vertsPerSeg;
    for (let seg = 0; seg < segmentsPerRay - 1; seg++) {
      const a = base + seg * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const rayGeo = new BufferGeometry();
  rayGeo.setAttribute('aPos', new Float32BufferAttribute(posAttr, 4));
  rayGeo.setAttribute('aPos0', new Float32BufferAttribute(pos0Attr, 3));
  rayGeo.setAttribute('aRandom', new Float32BufferAttribute(randomAttr, 4));
  // Need a position attribute even though we compute positions in the shader
  const positionPlaceholder = new Float32Array(totalVerts * 3);
  rayGeo.setAttribute('position', new Float32BufferAttribute(positionPlaceholder, 3));
  rayGeo.setIndex(indices);

  const rayMat = new ShaderMaterial({
    vertexShader: sunRaysVertexShader,
    fragmentShader: sunRaysFragmentShader,
    transparent: true,
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uWidth: { value: VP.get('sunRayWidth') },
      uLength: { value: VP.get('sunRayLength') },
      uOpacity: { value: VP.get('sunRayOpacity') },
      uNoiseFrequency: { value: VP.get('sunNoiseFrequency') },
      uNoiseAmplitude: { value: VP.get('sunNoiseAmplitude') },
      uSunRadius: { value: radius },
    },
  });
  const rayMesh = new Mesh(rayGeo, rayMat);
  rayMesh.frustumCulled = false;
  rayMesh.renderOrder = 3;
  group.add(rayMesh);

  // ── 5. Coronal Flare Loops ──────────────────────────────────

  const coronalGroup = new Group();
  coronalGroup.name = 'coronal-loops';
  const LOOP_COUNT = 128;
  const loopMat = new LineBasicMaterial({
    color: new Color(1.0, 0.7, 0.3),
    transparent: true,
    opacity: 0.04,
    depthWrite: false,
  });

  for (let i = 0; i < LOOP_COUNT; i++) {
    // Pick two points on sphere surface
    const theta1 = Math.random() * Math.PI * 2;
    const phi1 = Math.acos(2 * Math.random() - 1);
    const p1 = new Vector3(
      Math.sin(phi1) * Math.cos(theta1) * radius,
      Math.sin(phi1) * Math.sin(theta1) * radius,
      Math.cos(phi1) * radius,
    );

    // Second point nearby (arc length 10-60 degrees)
    const arcAngle = (0.17 + Math.random() * 0.87); // radians (~10-60 deg)
    const theta2 = theta1 + arcAngle * (Math.random() > 0.5 ? 1 : -1);
    const phi2 = phi1 + (Math.random() - 0.5) * arcAngle * 0.5;
    const p2 = new Vector3(
      Math.sin(phi2) * Math.cos(theta2) * radius,
      Math.sin(phi2) * Math.sin(theta2) * radius,
      Math.cos(phi2) * radius,
    );

    // Control points arc outward from surface
    const mid = new Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    const outDir = mid.clone().normalize();
    const arcHeight = radius * (0.1 + Math.random() * 0.6);

    const ctrl1 = p1.clone().add(outDir.clone().multiplyScalar(arcHeight * 0.8));
    const ctrl2 = p2.clone().add(outDir.clone().multiplyScalar(arcHeight * 0.8));

    const curve = new CubicBezierCurve3(p1, ctrl1, ctrl2, p2);
    const points = curve.getPoints(12);
    const geo = new BufferGeometry().setFromPoints(points);
    const line = new Line(geo, loopMat);
    coronalGroup.add(line);
  }

  coronalGroup.renderOrder = 2;
  group.add(coronalGroup);

  // ── VP Sync ──────────────────────────────────────────────────
  // Unsubscribed in dispose() so a swapped-out sun stops receiving edits.

  const unsubscribeVP = VP.subscribe((key) => {
    switch (key) {
      // Surface
      case 'sunFresnelPower': surfaceMat.uniforms.uFresnelPower.value = VP.get(key); break;
      case 'sunFresnelInfluence': surfaceMat.uniforms.uFresnelInfluence.value = VP.get(key); break;
      case 'sunTint': surfaceMat.uniforms.uTint.value = VP.get(key); break;
      case 'sunBrightness': surfaceMat.uniforms.uBrightness.value = VP.get(key); break;
      case 'sunBrightnessOffset': surfaceMat.uniforms.uBrightnessOffset.value = VP.get(key); break;
      // Glow
      case 'sunGlowExpand': glowMat.uniforms.uExpand.value = VP.get(key); break;
      case 'sunGlowInner': glowMat.uniforms.uInner.value = VP.get(key); break;
      case 'sunGlowOuter': glowMat.uniforms.uOuter.value = VP.get(key); break;
      case 'sunGlowIntensity': glowMat.uniforms.uIntensity.value = VP.get(key); break;
      // Rays
      case 'sunRayWidth': rayMat.uniforms.uWidth.value = VP.get(key); break;
      case 'sunRayLength': rayMat.uniforms.uLength.value = VP.get(key); break;
      case 'sunRayOpacity': rayMat.uniforms.uOpacity.value = VP.get(key); break;
      case 'sunNoiseFrequency':
        rayMat.uniforms.uNoiseFrequency.value = VP.get(key);
        break;
      case 'sunNoiseAmplitude':
        rayMat.uniforms.uNoiseAmplitude.value = VP.get(key);
        break;
      // Perlin
      case 'sunNoiseSpatialFreq': perlinMat.uniforms.uSpatialFrequency.value = VP.get(key); break;
      case 'sunNoiseTemporalFreq': perlinMat.uniforms.uTemporalFrequency.value = VP.get(key); break;
    }
  });

  // ── Update Function ──────────────────────────────────────────

  // Create a tiny scene just for cubemap rendering
  const cubeScene = new Scene();
  cubeScene.add(perlinBox);

  function update(renderer: WebGLRenderer, dt: number): void {
    // Wrap the shader clock at 1000 s so the float32 uTime uniforms never
    // lose precision over a long session (The Witness, Castaño 2022). The
    // noise/surface/ray shaders tolerate the periodic wrap; coronal rotation
    // is kept pop-free below via a separate mod-2π accumulator.
    elapsedTime = (elapsedTime + dt) % 1000;

    // Update time uniforms
    perlinMat.uniforms.uTime.value = elapsedTime;
    surfaceMat.uniforms.uTime.value = elapsedTime;
    rayMat.uniforms.uTime.value = elapsedTime;

    // Slowly rotate coronal loops (accumulate mod 2π so it wraps seamlessly)
    coronalRotY = (coronalRotY + dt * 0.02) % (Math.PI * 2);
    coronalGroup.rotation.y = coronalRotY;
    coronalGroup.rotation.x = Math.sin(elapsedTime * 0.01) * 0.05;

    // Re-render Perlin cubemap
    cubeCam.position.copy(group.position);
    cubeCam.update(renderer, cubeScene);
  }

  function dispose(): void {
    unsubscribeVP();
    cubeRT.dispose();
    perlinBox.geometry.dispose();
    perlinMat.dispose();
    surfaceMesh.geometry.dispose();
    surfaceMat.dispose();
    glowMesh.geometry.dispose();
    glowMat.dispose();
    rayGeo.dispose();
    rayMat.dispose();
    for (const loop of coronalGroup.children) (loop as Line).geometry.dispose();
    loopMat.dispose();
  }

  return { group, update, dispose };
}

// ── Utility ──────────────────────────────────────────────────────

function randomSpherePoint(): [number, number, number] {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  return [
    Math.sin(phi) * Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
  ];
}

function addJitter(v: [number, number, number], amount: number): [number, number, number] {
  return [
    v[0] + (Math.random() - 0.5) * amount,
    v[1] + (Math.random() - 0.5) * amount,
    v[2] + (Math.random() - 0.5) * amount,
  ];
}

function normalizeVec3(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len === 0) return [0, 1, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}
