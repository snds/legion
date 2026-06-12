// ═══════════════════════════════════════════════════════════════════
// ASTEROID BELT — InstancedMesh with Deformed Icosahedrons
// Creates thousands of individually lit, flat-shaded rocky objects.
// Features: geometry variants with craters, Kirkwood gap avoidance,
// clustered color distribution, center-biased radial placement.
// ═══════════════════════════════════════════════════════════════════

import {
  Group, InstancedMesh, ShaderMaterial,
  IcosahedronGeometry, Matrix4, Quaternion, Euler,
  Vector3, Color, InstancedBufferAttribute,
} from 'three';
import { asteroidVertexShader, asteroidFragmentShader } from './shaders/asteroid';
import { VP } from './visual-params';

const AU_SCALE = 10;

// Kirkwood gap resonance radii (AU) — where asteroids are depleted
// These are Jupiter resonances adapted to a generic asteroid belt
const KIRKWOOD_GAPS = [
  { center: 2.50, width: 0.05 },  // 3:1 resonance
  { center: 2.82, width: 0.04 },  // 5:2 resonance
  { center: 2.96, width: 0.04 },  // 7:3 resonance
  { center: 3.28, width: 0.06 },  // 2:1 resonance
];

/**
 * Create a deformed icosahedron geometry variant.
 * Applies vertex noise + optional craters for rocky appearance.
 */
function createAsteroidGeometry(
  detail: number,
  noiseMag: number,
  addCrater: boolean,
): IcosahedronGeometry {
  const geo = new IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;

  // Random vertex deformation
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const len = Math.sqrt(x * x + y * y + z * z);

    // Noise displacement along radial direction
    const noise = 1.0 + (Math.random() - 0.5) * noiseMag * 2;
    pos.setXYZ(i, x * noise, y * noise, z * noise);
  }

  // Add crater (indent a random region)
  if (addCrater) {
    const craterDir = new Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5,
    ).normalize();
    const craterRadius = 0.3 + Math.random() * 0.3;
    const craterDepth = 0.15 + Math.random() * 0.15;

    for (let i = 0; i < pos.count; i++) {
      const v = new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const dist = v.clone().normalize().dot(craterDir);
      if (dist > 1.0 - craterRadius) {
        const factor = (dist - (1.0 - craterRadius)) / craterRadius;
        const indent = factor * craterDepth;
        const dir = v.clone().normalize();
        v.sub(dir.multiplyScalar(indent));
        pos.setXYZ(i, v.x, v.y, v.z);
      }
    }
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Check if a given semi-major axis falls within a Kirkwood gap.
 * Returns true if the SMA should be rejected.
 */
function inKirkwoodGap(smaAU: number): boolean {
  for (const gap of KIRKWOOD_GAPS) {
    if (Math.abs(smaAU - gap.center) < gap.width) return true;
  }
  return false;
}

/**
 * Generate a center-biased random SMA within the belt range.
 * Averages multiple random samples for center bias.
 */
function centeredSMA(innerAU: number, outerAU: number): number {
  // Average 3 random samples for center bias
  const r = (Math.random() + Math.random() + Math.random()) / 3;
  return innerAU + r * (outerAU - innerAU);
}

/**
 * Generate a random HSL color for an asteroid.
 */
function randomAsteroidColor(): Color {
  const h = VP.get('asteroidMinHue') +
    Math.random() * (VP.get('asteroidMaxHue') - VP.get('asteroidMinHue'));
  const s = VP.get('asteroidMinSat') +
    Math.random() * (VP.get('asteroidMaxSat') - VP.get('asteroidMinSat'));
  // Realistic rock albedo: C-type asteroids ~0.05, S-type ~0.15-0.25. The old
  // 0.58-0.88 lightness read as chalky bright blobs; rocks should be DARK,
  // their form carried by lit/shadow facet contrast, not base brightness.
  const l = 0.22 + Math.random() * 0.23; // lightness 0.22 - 0.45
  return new Color().setHSL(h, s, l);
}

/** Shared star-lighting uniforms for belt materials. Single star at origin
 *  today; MAX_STARS=2 in the shader so binary systems are a uniform update. */
function starLightUniforms(beltMidRadiusWU: number) {
  return {
    uStarPos: { value: [new Vector3(0, 0, 0), new Vector3(0, 0, 0)] },
    uStarColor: { value: [new Color(1, 0.98, 0.94), new Color(0, 0, 0)] },
    uStarCount: { value: 1 },
    uRefDist: { value: beltMidRadiusWU },
  };
}

export interface AsteroidBeltSystem {
  group: Group;
}

/**
 * Create an asteroid belt with main body rocks and dust particles.
 */
export function createAsteroidBelt(
  innerAU: number,
  outerAU: number,
): AsteroidBeltSystem {
  const group = new Group();
  group.name = 'asteroid-belt';

  const asteroidCount = VP.get('asteroidCount');
  const dustCount = VP.get('dustCount');
  const detail = VP.get('asteroidDetail');
  const noiseMag = VP.get('asteroidNoiseMagnitude');
  const craterProb = VP.get('asteroidCraterProbability');

  // ── Generate geometry variants ──
  const VARIANT_COUNT = 12;
  const geoVariants: IcosahedronGeometry[] = [];
  for (let i = 0; i < VARIANT_COUNT; i++) {
    geoVariants.push(createAsteroidGeometry(
      detail,
      noiseMag,
      Math.random() < craterProb,
    ));
  }

  // ── Main asteroids ──
  const beltMidWU = ((innerAU + outerAU) / 2) * AU_SCALE;
  const mainMat = new ShaderMaterial({
    vertexShader: asteroidVertexShader,
    fragmentShader: asteroidFragmentShader,
    uniforms: {
      uLightIntensity: { value: VP.get('asteroidLightIntensity') },
      ...starLightUniforms(beltMidWU),
    },
  });

  // Group instances by geometry variant
  const instancesPerVariant = Math.ceil(asteroidCount / VARIANT_COUNT);
  const matrix = new Matrix4();
  const quat = new Quaternion();
  const euler = new Euler();
  const pos = new Vector3();
  const scale = new Vector3();

  for (let v = 0; v < VARIANT_COUNT; v++) {
    const count = Math.min(instancesPerVariant, asteroidCount - v * instancesPerVariant);
    if (count <= 0) break;

    const mesh = new InstancedMesh(geoVariants[v], mainMat, count);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      // Generate SMA avoiding Kirkwood gaps
      let sma: number;
      let attempts = 0;
      do {
        sma = centeredSMA(innerAU, outerAU);
        attempts++;
      } while (inKirkwoodGap(sma) && attempts < 20);

      const r = sma * AU_SCALE;
      const theta = Math.random() * Math.PI * 2;
      const yOffset = (Math.random() - 0.5) * 0.5;

      pos.set(
        r * Math.cos(theta),
        yOffset,
        r * Math.sin(theta),
      );

      // Random rotation
      euler.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      );
      quat.setFromEuler(euler);

      // Anisotropic scale (elongated rocks)
      const baseScale = 0.03 + Math.random() * 0.06;
      scale.set(
        baseScale * (0.6 + Math.random() * 0.8),
        baseScale * (0.6 + Math.random() * 0.8),
        baseScale * (0.6 + Math.random() * 0.8),
      );

      matrix.compose(pos, quat, scale);
      mesh.setMatrixAt(i, matrix);

      // Per-instance color
      const col = randomAsteroidColor();
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.setAttribute('instanceColor',
      new InstancedBufferAttribute(colors, 3),
    );
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  // ── Dust particles (smaller, brighter) ──
  const dustMat = new ShaderMaterial({
    vertexShader: asteroidVertexShader,
    fragmentShader: asteroidFragmentShader,
    uniforms: {
      uLightIntensity: { value: VP.get('dustLightIntensity') },
      ...starLightUniforms(beltMidWU),
    },
  });

  // Use a single low-detail geometry for dust
  const dustGeo = new IcosahedronGeometry(1, 0);
  const dustMesh = new InstancedMesh(dustGeo, dustMat, dustCount);
  const dustColors = new Float32Array(dustCount * 3);

  for (let i = 0; i < dustCount; i++) {
    let sma: number;
    let attempts = 0;
    do {
      sma = centeredSMA(innerAU, outerAU);
      attempts++;
    } while (inKirkwoodGap(sma) && attempts < 20);

    const r = sma * AU_SCALE;
    const theta = Math.random() * Math.PI * 2;
    const yOffset = (Math.random() - 0.5) * 0.6;

    pos.set(r * Math.cos(theta), yOffset, r * Math.sin(theta));

    euler.set(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
    );
    quat.setFromEuler(euler);

    const dustScale = 0.008 + Math.random() * 0.02;
    scale.set(dustScale, dustScale, dustScale);

    matrix.compose(pos, quat, scale);
    dustMesh.setMatrixAt(i, matrix);

    // Slightly brighter colors for dust
    const col = randomAsteroidColor();
    dustColors[i * 3] = col.r * 1.2;
    dustColors[i * 3 + 1] = col.g * 1.2;
    dustColors[i * 3 + 2] = col.b * 1.2;
  }

  dustMesh.instanceMatrix.needsUpdate = true;
  dustMesh.geometry.setAttribute('instanceColor',
    new InstancedBufferAttribute(dustColors, 3),
  );
  dustMesh.frustumCulled = false;
  group.add(dustMesh);

  // ── VP Sync ──
  VP.subscribe((key) => {
    switch (key) {
      case 'asteroidLightIntensity':
        mainMat.uniforms.uLightIntensity.value = VP.get(key);
        break;
      case 'dustLightIntensity':
        dustMat.uniforms.uLightIntensity.value = VP.get(key);
        break;
    }
  });

  return { group };
}
