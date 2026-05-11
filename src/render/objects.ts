// ═══════════════════════════════════════════════════════════════════
// OBJECT FACTORIES — 3D Mesh Creation for ECS Entities
// Creates Three.js Object3D groups for each entity type.
// Each factory returns a group containing the mesh + icon + label.
// The group gets registered in the renderObjectMap via its ECS eid.
//
// Mesh LOD: close → geometry, far → icon billboard.
// The visibility system handles crossfading between them.
// ═══════════════════════════════════════════════════════════════════

import {
  Group, Mesh, SphereGeometry, RingGeometry, MeshStandardMaterial,
  MeshBasicMaterial, ShaderMaterial, DoubleSide, BackSide, AdditiveBlending,
  Color, BufferGeometry, Vector3, TextureLoader, SRGBColorSpace,
  Float32BufferAttribute, EllipseCurve, Vector2, CanvasTexture, RepeatWrapping,
  type WebGLRenderer, type Texture,
} from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { createIcon, createLabel, type IconShape } from './icons';
import { createSunSystem, type SunSystem } from './sun';
import { planetSurfaceVertexShader, planetSurfaceFragmentShader } from './shaders/planet-surface';
import { planetAtmosphereVertexShader, planetAtmosphereFragmentShader } from './shaders/planet-atmosphere';
import { planetRingsVertexShader, planetRingsFragmentShader } from './shaders/planet-rings';
import { getAtmosphereColor } from './planet-colors';
import { VP } from './visual-params';
import { generatePlanetTexture, hasProceduralRecipe } from './procedural-textures';

// ── Color Helpers ────────────────────────────────────────────────

function numToHex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}

/** Generate a procedural ring texture via canvas when file textures are missing */
// Simple 1D hash for procedural noise (no external deps)
function hash1D(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Value noise with smooth interpolation
function valueNoise(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const t = f * f * (3 - 2 * f); // smoothstep
  return hash1D(i) * (1 - t) + hash1D(i + 1) * t;
}

// Fractal Brownian motion (1D) — stacks octaves for natural variation
function fbm1D(x: number, octaves: number): number {
  let val = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += valueNoise(x * freq) * amp;
    freq *= 2.1;
    amp *= 0.45;
  }
  return val;
}

function createProceduralRingTexture(): Texture {
  const W = 1024, H = 64; // wider for more radial detail
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  for (let x = 0; x < W; x++) {
    const t = x / W; // 0 = inner edge, 1 = outer edge

    // ── Band structure (overlapping sinusoids + noise) ──
    const band1 = Math.sin(t * Math.PI * 14) * 0.5 + 0.5;
    const band2 = Math.sin(t * Math.PI * 32 + 0.7) * 0.3 + 0.3;
    const band3 = Math.sin(t * Math.PI * 7 + 1.3) * 0.2 + 0.2;
    // High-frequency noise breaks up sine regularity
    const bandNoise = fbm1D(t * 60, 4) * 0.35;

    // ── Cassini division (wider, with soft edges) ──
    const cassDist = Math.abs(t - 0.5);
    const cassini = 1 - Math.exp(-(cassDist * cassDist) / 0.0008);
    // Secondary Encke-like gap
    const enckeDist = Math.abs(t - 0.72);
    const encke = 1 - Math.exp(-(enckeDist * enckeDist) / 0.00015) * 0.6;

    // ── Density falloff (thin at edges, dense in middle bands) ──
    const edgeFalloff = Math.sin(t * Math.PI) * 0.8 + 0.2;

    const density = Math.max(0, Math.min(1,
      (band1 + band2 + band3 + bandNoise) * cassini * encke * edgeFalloff * 0.5
    ));

    // ── Color: warm ice/silicate with per-band hue shift ──
    const hueShift = fbm1D(t * 20, 3) * 15;
    const r = Math.floor(Math.max(0, Math.min(255, 175 + t * 35 + hueShift)));
    const g = Math.floor(Math.max(0, Math.min(255, 160 + t * 28 + hueShift * 0.7)));
    const b = Math.floor(Math.max(0, Math.min(255, 148 + t * 18 + hueShift * 0.4)));

    for (let y = 0; y < H; y++) {
      // 2D noise for azimuthal variation (breaks up uniform bands)
      const yNoise = 0.75 + hash1D(x * 0.01 + y * 137.3) * 0.5;
      const alpha = density * yNoise;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  return tex;
}

// ── Star ─────────────────────────────────────────────────────────

/** Stored reference to the active sun system for per-frame updates */
let activeSunSystem: SunSystem | null = null;

export function createStarMesh(color: number, radius: number, name = 'ε ERIDANI', spectralInfo = 'K2V · HOME'): Group {
  const group = new Group();
  group.name = 'star';
  group.userData.type = 'star';
  group.userData.name = name;
  group.userData.spectralType = spectralInfo;

  // Procedural sun shader system (surface + glow + corona rays)
  const sunSys = createSunSystem(radius);
  activeSunSystem = sunSys;
  group.add(sunSys.group);

  // Star icon — visible at heliopause+ when mesh too small to see
  const icon = createIcon({
    shape: 'star',
    color: numToHex(color),
    label: name.toUpperCase(),
    sublabel: spectralInfo,
    glowColor: numToHex(color),
    size: 200,
  });
  icon.visible = false;
  icon.userData.isIcon = true;
  group.add(icon);

  return group;
}

/** Call each frame to update the sun's animated cubemap and shader uniforms */
export function updateSunSystem(renderer: WebGLRenderer, dt: number): void {
  activeSunSystem?.update(renderer, dt);
}

// ── Planet ───────────────────────────────────────────────────────

/** Tracked planet materials for per-frame sun direction updates */
interface PlanetMaterialEntry {
  group: Group;
  spinGroup: Group | null;
  surfaceMat: ShaderMaterial;
  atmosMat: ShaderMaterial | null;
  ringMat: ShaderMaterial | null;
  planetRadius: number;
  dayLength: number;  // in Earth days (0 = no rotation)
}
const trackedPlanets: PlanetMaterialEntry[] = [];

const textureLoader = new TextureLoader();

export function createPlanetMesh(
  color: number, size: number, planetType: number,
  hasAtmosphere: boolean, atmosColor: number,
  name: string, status: number,
  texturePath?: string, ringTexturePath?: string,
  axialTilt = 0, dayLength = 1,
): Group {
  const group = new Group();
  group.name = `planet-${name}`;
  group.userData.type = 'planet';
  group.userData.name = name;
  group.userData.hasAtmosphere = hasAtmosphere;
  group.userData.planetTypeId = planetType;

  const segments = VP.get('planetSegments');
  const c = new Color(color);

  // ── Spin Group (for rotation + axial tilt) ──
  const spinGroup = new Group();
  spinGroup.name = `spin-${name}`;
  spinGroup.rotation.z = axialTilt * (Math.PI / 180);
  group.add(spinGroup);

  // ── Surface ──
  const surfaceMat = new ShaderMaterial({
    vertexShader: planetSurfaceVertexShader,
    fragmentShader: planetSurfaceFragmentShader,
    uniforms: {
      uColor: { value: new Vector3(c.r, c.g, c.b) },
      uSunDir: { value: new Vector3(0, 0, 1) },
      uTerminatorSoftness: { value: VP.get('planetTerminatorSoftness') },
      uTerminatorOffset: { value: VP.get('planetTerminatorOffset') },
      uSpecularPower: { value: VP.get('planetSpecularPower') },
      uSpecularOffset: { value: VP.get('planetSpecularOffset') },
      uDayTexture: { value: null as Texture | null },
      uHasTexture: { value: false },
      uTime: { value: 0 },
      uHasAtmosphere: { value: hasAtmosphere },
      // Specular gating: Oceanic = 1.0 (sea glint), Ice giants = 0.55,
      // Rocky/Gas/Dwarf = 0 (no plausible specular highlight).
      uSpecularScale: { value: planetType === 1 ? 1.0 : planetType === 2 ? 0.55 : 0.0 },
      // Twilight scattering tint — warmer for thicker atmospheres.
      uTwilightTint: { value: new Vector3(
        planetType === 1 ? 1.0 : planetType === 0 ? 0.95 : 0.7,
        planetType === 1 ? 0.55 : planetType === 0 ? 0.45 : 0.35,
        planetType === 1 ? 0.25 : planetType === 0 ? 0.20 : 0.45,
      ) },
      uTwilightStrength: { value: hasAtmosphere ? 0.18 : 0.0 },
    },
  });

  // Load day texture if provided (file-based, e.g. Sol textures)
  if (texturePath) {
    textureLoader.load(texturePath, (tex) => {
      tex.colorSpace = SRGBColorSpace;
      surfaceMat.uniforms.uDayTexture.value = tex;
      surfaceMat.uniforms.uHasTexture.value = true;
      surfaceMat.needsUpdate = true;
    });
  } else if (hasProceduralRecipe(name)) {
    // Generate procedural texture for EE planets
    generatePlanetTexture(name, (_lod, tex) => {
      surfaceMat.uniforms.uDayTexture.value = tex;
      surfaceMat.uniforms.uHasTexture.value = true;
      surfaceMat.needsUpdate = true;
    });
  }

  const surfaceMesh = new Mesh(new SphereGeometry(size, segments, segments), surfaceMat);
  spinGroup.add(surfaceMesh);

  // ── Atmosphere ──
  let atmosMat: ShaderMaterial | null = null;
  if (hasAtmosphere) {
    const atmosColorSet = getAtmosphereColor(planetType);
    // Use the entity's atmosColor as primary, blend with type defaults
    const ac = new Color(atmosColor);
    const primary = new Vector3(
      ac.r * 0.8 + atmosColorSet.primary[0] * 0.2,
      ac.g * 0.8 + atmosColorSet.primary[1] * 0.2,
      ac.b * 0.8 + atmosColorSet.primary[2] * 0.2,
    );

    atmosMat = new ShaderMaterial({
      vertexShader: planetAtmosphereVertexShader,
      fragmentShader: planetAtmosphereFragmentShader,
      side: BackSide,
      transparent: true,
      blending: AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      uniforms: {
        uAtmosColor: { value: primary },
        uSunDir: { value: new Vector3(0, 0, 1) },
        uFresnelPower: { value: VP.get('atmosFresnelPower') },
        uCenterFalloff: { value: VP.get('atmosCenterFalloff') },
        uEdgeThreshold: { value: VP.get('atmosEdgeThreshold') },
        uEdgeSoftness: { value: VP.get('atmosEdgeSoftness') },
        uTwilightBias: { value: VP.get('atmosTwilightBias') },
      },
    });

    const scale = VP.get('atmosScale');
    const atmosMesh = new Mesh(new SphereGeometry(size * scale, segments / 2, segments / 2), atmosMat);
    atmosMesh.renderOrder = 2;

    // Ringed planets: no depth test on atmosphere to avoid z-fighting with rings
    if (ringTexturePath) {
      atmosMat.depthTest = false;
    }

    spinGroup.add(atmosMesh);
  }

  // ── Rings (any planet with ringTexturePath) ──
  let ringMat: ShaderMaterial | null = null;
  if (ringTexturePath) {
    const innerR = size * 1.8;
    const outerR = size * 3.2;
    const ringColor = new Color(color).offsetHSL(0, -0.2, 0.1);

    ringMat = new ShaderMaterial({
      vertexShader: planetRingsVertexShader,
      fragmentShader: planetRingsFragmentShader,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
      uniforms: {
        uRingColor: { value: new Vector3(ringColor.r, ringColor.g, ringColor.b) },
        uRingOpacity: { value: 0.55 },
        uSunDir: { value: new Vector3(0, 0, 1) },
        uPlanetCenter: { value: new Vector3(0, 0, 0) },
        uPlanetRadius: { value: size },
        uShadowAmbient: { value: VP.get('ringShadowAmbient') },
        uShadowSoftness: { value: VP.get('ringShadowSoftnessFactor') },
        uShadowStrength: { value: VP.get('ringShadowStrength') },
        uInnerRadius: { value: innerR },
        uOuterRadius: { value: outerR },
        uRingTexture: { value: null as Texture | null },
        uHasRingTexture: { value: false },
      },
    });

    textureLoader.load(
      ringTexturePath,
      (tex) => {
        ringMat!.uniforms.uRingTexture.value = tex;
        ringMat!.uniforms.uHasRingTexture.value = true;
        ringMat!.needsUpdate = true;
        console.info(`[Objects] Ring texture loaded for ${name}`);
      },
      undefined,
      (err) => {
        console.warn(`[Objects] Ring texture failed for ${name}, using procedural fallback`);
        const proceduralTex = createProceduralRingTexture();
        ringMat!.uniforms.uRingTexture.value = proceduralTex;
        ringMat!.uniforms.uHasRingTexture.value = true;
        ringMat!.needsUpdate = true;
      },
    );

    const ring = new Mesh(new RingGeometry(innerR, outerR, 256, 1), ringMat);
    // RingGeometry is in XY plane. Rotate to XZ (equatorial) plane first,
    // then apply axial tilt. Using a container group for clean tilt application.
    const ringTiltGroup = new Group();
    ringTiltGroup.name = `ring-tilt-${name}`;
    ring.rotation.x = -Math.PI / 2;  // Lay flat in XZ plane
    ring.renderOrder = 1;
    ringTiltGroup.add(ring);
    // Apply axial tilt (same as spinGroup) so ring aligns with planet equator
    ringTiltGroup.rotation.z = axialTilt * (Math.PI / 180);
    group.add(ringTiltGroup);
  }

  // Track for per-frame updates
  trackedPlanets.push({ group, spinGroup, surfaceMat, atmosMat, ringMat, planetRadius: size, dayLength });

  // Icon billboard
  const statusColors: Record<number, string> = {
    0: '#667788', 1: '#88aacc', 2: '#ddaa44', 3: '#55bb88', 4: '#44cc88', 5: '#ff8844',
  };
  const icon = createIcon({
    shape: 'circle',
    color: statusColors[status] ?? '#667788',
    label: name.toUpperCase(),
    sublabel: ['Uncharted', 'Surveyed', 'Mining', 'Harvesting', 'Habitable', 'Building'][status],
  });
  icon.visible = false;
  icon.userData.isIcon = true;
  group.add(icon);

  return group;
}

/** Apply opacity to a planet's surface, atmosphere, and ring materials. */
function applyPlanetOpacity(entry: PlanetMaterialEntry, opacity: number): void {
  if (opacity < 0.99) {
    entry.surfaceMat.transparent = true;
    entry.surfaceMat.opacity = opacity;
    entry.surfaceMat.depthWrite = opacity > 0.1;
    entry.surfaceMat.needsUpdate = true;
    if (entry.atmosMat) {
      entry.atmosMat.opacity = opacity;
      entry.atmosMat.needsUpdate = true;
    }
    if (entry.ringMat) {
      entry.ringMat.opacity = opacity;
      entry.ringMat.needsUpdate = true;
    }
  } else {
    // Restore full opacity
    if (entry.surfaceMat.transparent) {
      entry.surfaceMat.transparent = false;
      entry.surfaceMat.opacity = 1;
      entry.surfaceMat.depthWrite = true;
      entry.surfaceMat.needsUpdate = true;
    }
    if (entry.atmosMat && entry.atmosMat.opacity < 0.99) {
      entry.atmosMat.opacity = 1;
      entry.atmosMat.needsUpdate = true;
    }
    if (entry.ringMat && entry.ringMat.opacity < 0.99) {
      entry.ringMat.opacity = 1;
      entry.ringMat.needsUpdate = true;
    }
  }
}

/** Update all planet shader uniforms per frame (sun direction, rotation, ring shadows).
 *  Also fades out non-focused planets that subtend too much of the viewport,
 *  preventing orbiting planets from flashing across the camera at close zoom. */
export function updatePlanetShaders(
  gameTime = 0,
  cameraPosition?: Vector3,
  focusTarget?: { x: number; y: number; z: number } | null,
  zoomDomain?: string,
): void {
  const sunDir = new Vector3();

  // At surface/system zoom, determine which planet (if any) the camera is focused on.
  // The focused planet stays visible; all others get angular-size culling.
  const isCloseZoom =
    zoomDomain === 'surface' || zoomDomain === 'low-orbit' ||
    zoomDomain === 'orbit' || zoomDomain === 'inner-system';
  let focusedEntry: PlanetMaterialEntry | null = null;
  if (focusTarget && cameraPosition && isCloseZoom) {
    let bestDistSq = Infinity;
    for (const entry of trackedPlanets) {
      const p = entry.group.position;
      const dSq = (p.x - focusTarget.x) ** 2 + (p.y - focusTarget.y) ** 2 + (p.z - focusTarget.z) ** 2;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        focusedEntry = entry;
      }
    }
  }

  for (const entry of trackedPlanets) {
    const pos = entry.group.position;

    // Sun direction = normalize(origin - planetPos) = normalize(-planetPos)
    sunDir.set(-pos.x, -pos.y, -pos.z).normalize();
    // Fallback if planet is at origin (shouldn't happen)
    if (sunDir.lengthSq() === 0) sunDir.set(0, 0, 1);

    entry.surfaceMat.uniforms.uSunDir.value.copy(sunDir);
    entry.surfaceMat.uniforms.uTime.value = gameTime;

    // Planet rotation (spin group Y-axis)
    if (entry.spinGroup && entry.dayLength > 0) {
      const daySeconds = entry.dayLength * 86400;
      entry.spinGroup.rotation.y = (gameTime / daySeconds) * Math.PI * 2;
    }

    if (entry.atmosMat) {
      entry.atmosMat.uniforms.uSunDir.value.copy(sunDir);
    }

    if (entry.ringMat) {
      entry.ringMat.uniforms.uSunDir.value.copy(sunDir);
      entry.ringMat.uniforms.uPlanetCenter.value.copy(pos);
    }

    // ── Non-focused planet culling at close zoom ──
    // At surface/system zoom, planets other than the focused one can orbit
    // through the camera frustum, causing a distracting colored flash.
    // Fade them based on their angular size (how much of the viewport they fill).
    if (cameraPosition) {
      const dx = cameraPosition.x - pos.x;
      const dy = cameraPosition.y - pos.y;
      const dz = cameraPosition.z - pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const scaledRadius = entry.planetRadius * entry.group.scale.x;

      if (entry === focusedEntry) {
        // Focused planet: only apply very close proximity fade
        // (when literally inside the mesh)
        const fadeStart = scaledRadius * 2.5;
        const fadeEnd = scaledRadius * 1.0;
        if (dist < fadeStart) {
          const opacity = dist <= fadeEnd ? 0 : (dist - fadeEnd) / (fadeStart - fadeEnd);
          applyPlanetOpacity(entry, opacity);
        } else {
          applyPlanetOpacity(entry, 1);
        }
      } else if (isCloseZoom) {
        // Non-focused planet at surface/system zoom (or no planet focused):
        // Calculate angular diameter in radians: 2 * atan(radius / dist)
        // If it subtends more than ~2.9°, start fading.
        // At ~6.9°, fully invisible. This prevents orbiting planets from
        // sweeping across the viewport as large colored walls.
        const angularSize = 2 * Math.atan(scaledRadius / Math.max(dist, 0.01));
        const fadeStartAngle = 0.05; // ~2.9° — start fading
        const fadeEndAngle = 0.12;   // ~6.9° — fully invisible
        if (angularSize > fadeStartAngle) {
          const t = (angularSize - fadeStartAngle) / (fadeEndAngle - fadeStartAngle);
          const opacity = Math.max(0, 1 - Math.min(t, 1));
          applyPlanetOpacity(entry, opacity);
        } else {
          applyPlanetOpacity(entry, 1);
        }
      } else {
        // Heliopause+ zoom domains: basic proximity fade only
        const fadeStart = scaledRadius * 4;
        const fadeEnd = scaledRadius * 1.5;
        if (dist < fadeStart) {
          const opacity = dist <= fadeEnd ? 0 : (dist - fadeEnd) / (fadeStart - fadeEnd);
          applyPlanetOpacity(entry, opacity);
        } else {
          applyPlanetOpacity(entry, 1);
        }
      }
    }
  }

}

// VP sync for planet shader live editing
VP.subscribe((key) => {
  for (const entry of trackedPlanets) {
    switch (key) {
      case 'planetTerminatorSoftness':
        entry.surfaceMat.uniforms.uTerminatorSoftness.value = VP.get(key);
        break;
      case 'planetTerminatorOffset':
        entry.surfaceMat.uniforms.uTerminatorOffset.value = VP.get(key);
        break;
      case 'planetSpecularPower':
        entry.surfaceMat.uniforms.uSpecularPower.value = VP.get(key);
        break;
      case 'planetSpecularOffset':
        entry.surfaceMat.uniforms.uSpecularOffset.value = VP.get(key);
        break;
      case 'atmosFresnelPower':
        if (entry.atmosMat) entry.atmosMat.uniforms.uFresnelPower.value = VP.get(key);
        break;
      case 'atmosCenterFalloff':
        if (entry.atmosMat) entry.atmosMat.uniforms.uCenterFalloff.value = VP.get(key);
        break;
      case 'atmosEdgeThreshold':
        if (entry.atmosMat) entry.atmosMat.uniforms.uEdgeThreshold.value = VP.get(key);
        break;
      case 'atmosEdgeSoftness':
        if (entry.atmosMat) entry.atmosMat.uniforms.uEdgeSoftness.value = VP.get(key);
        break;
      case 'atmosTwilightBias':
        if (entry.atmosMat) entry.atmosMat.uniforms.uTwilightBias.value = VP.get(key);
        break;
      case 'ringShadowAmbient':
        if (entry.ringMat) entry.ringMat.uniforms.uShadowAmbient.value = VP.get(key);
        break;
      case 'ringShadowSoftnessFactor':
        if (entry.ringMat) entry.ringMat.uniforms.uShadowSoftness.value = VP.get(key);
        break;
      case 'ringShadowStrength':
        if (entry.ringMat) entry.ringMat.uniforms.uShadowStrength.value = VP.get(key);
        break;
    }
  }
});

// ── Moon ─────────────────────────────────────────────────────────

export function createMoonMesh(
  color: number, size: number, name: string,
  texturePath?: string, dayLength = 1,
): Group {
  const group = new Group();
  group.name = `moon-${name}`;
  group.userData.type = 'moon';
  group.userData.name = name;

  const segments = 32;
  const c = new Color(color);

  // Spin group for rotation
  const spinGroup = new Group();
  spinGroup.name = `spin-${name}`;
  group.add(spinGroup);

  // Surface — reuses planet surface shader (day/night terminator)
  const surfaceMat = new ShaderMaterial({
    vertexShader: planetSurfaceVertexShader,
    fragmentShader: planetSurfaceFragmentShader,
    uniforms: {
      uColor: { value: new Vector3(c.r, c.g, c.b) },
      uSunDir: { value: new Vector3(0, 0, 1) },
      uTerminatorSoftness: { value: VP.get('planetTerminatorSoftness') },
      uTerminatorOffset: { value: VP.get('planetTerminatorOffset') },
      uSpecularPower: { value: VP.get('planetSpecularPower') },
      uSpecularOffset: { value: VP.get('planetSpecularOffset') },
      uDayTexture: { value: null as Texture | null },
      uHasTexture: { value: false },
      uTime: { value: 0 },
      uHasAtmosphere: { value: false },
      uSpecularScale: { value: 0.0 }, // moons: no specular
      uTwilightTint: { value: new Vector3(0.95, 0.45, 0.20) },
      uTwilightStrength: { value: 0.0 },
    },
  });

  if (texturePath) {
    textureLoader.load(texturePath, (tex) => {
      tex.colorSpace = SRGBColorSpace;
      surfaceMat.uniforms.uDayTexture.value = tex;
      surfaceMat.uniforms.uHasTexture.value = true;
      surfaceMat.needsUpdate = true;
    });
  }

  const surfaceMesh = new Mesh(new SphereGeometry(size, segments, segments), surfaceMat);
  spinGroup.add(surfaceMesh);

  // Track for per-frame sun direction updates (reuse planet tracking)
  trackedPlanets.push({ group, spinGroup, surfaceMat, atmosMat: null, ringMat: null, planetRadius: size, dayLength });

  // Icon billboard
  const icon = createIcon({
    shape: 'circle',
    color: '#667788',
    label: name.toUpperCase(),
    sublabel: 'MOON',
  });
  icon.visible = false;
  icon.userData.isIcon = true;
  group.add(icon);

  return group;
}

// ── Bob (Von Neumann Probe) ──────────────────────────────────────

export function createBobMesh(
  color: number, name: string, callsign: string,
): Group {
  const group = new Group();
  group.name = `bob-${name}`;
  group.userData.type = 'bob';
  group.userData.name = name;
  group.userData.callsign = callsign;

  // Von Neumann probe body — octahedron (angular, industrial feel)
  const bodyGeo = new SphereGeometry(0.035, 4, 3); // low-poly faceted
  bodyGeo.computeVertexNormals(); // flat normals on low-poly = angular NASA aesthetic
  const probeColor = new Color(color);
  const bodyMat = new MeshStandardMaterial({
    color: 0x889099,                          // titanium gray base
    roughness: 0.35,                           // brushed metal finish
    metalness: 0.85,                           // strongly metallic
    emissive: probeColor,
    emissiveIntensity: 0.15,                   // subtle self-illumination
    flatShading: true,                         // industrial faceted look
  });
  const body = new Mesh(bodyGeo, bodyMat);
  group.add(body);

  // Antenna / sensor mast — thin accent line
  const antGeo = new SphereGeometry(0.006, 3, 2);
  const antMat = new MeshStandardMaterial({
    color: probeColor,
    roughness: 0.2,
    metalness: 0.9,
    emissive: probeColor,
    emissiveIntensity: 0.6,                    // bright identifier beacon
  });
  const antenna = new Mesh(antGeo, antMat);
  antenna.position.set(0, 0.045, 0);
  group.add(antenna);

  // Composite: use body as primary for raycasting
  const mesh = body;

  // Icon billboard
  const icon = createIcon({
    shape: 'diamond',
    color: numToHex(color),
    label: callsign.toUpperCase(),
    sublabel: name,
    glowColor: numToHex(color),
  });
  icon.visible = false;
  icon.userData.isIcon = true;
  group.add(icon);

  return group;
}

// ── Star System Marker (Regional View) ───────────────────────────

export function createSystemMarker(
  name: string, color: number, hasBobs: boolean, isHome: boolean,
): Group {
  const group = new Group();
  group.name = `system-${name}`;
  group.userData.type = 'system';
  group.userData.name = name;
  group.userData.hasBobs = hasBobs;
  group.userData.isHome = isHome;

  const shape: IconShape = isHome ? 'star' : (hasBobs ? 'diamond' : 'hex');
  const icon = createIcon({
    shape,
    color: numToHex(color),
    label: name.toUpperCase(),
    sublabel: isHome ? 'HOME SYSTEM' : (hasBobs ? 'BOB PRESENCE' : 'UNEXPLORED'),
    glowColor: isHome ? numToHex(color) : undefined,
  });
  group.add(icon);

  return group;
}

// ── Alien Influence Marker ───────────────────────────────────────

export function createAlienMarker(
  name: string, color: number, radius: number,
): Group {
  const group = new Group();
  group.name = `alien-${name}`;
  group.userData.type = 'alien';
  group.userData.name = name;
  group.userData.influenceRadius = radius;

  // Influence sphere
  const geo = new SphereGeometry(radius, 24, 24);
  const mat = new MeshBasicMaterial({
    color: new Color(color),
    transparent: true,
    opacity: 0.06,
    side: DoubleSide,
    depthWrite: false,
  });
  group.add(new Mesh(geo, mat));

  // Center icon
  const icon = createIcon({
    shape: 'triangle',
    color: numToHex(color),
    label: name.toUpperCase(),
    sublabel: 'ALIEN PRESENCE',
  });
  group.add(icon);

  return group;
}

// ── Orbit Line ───────────────────────────────────────────────────

/** Tracked orbit line materials for resolution updates on window resize */
const trackedOrbitMaterials: LineMaterial[] = [];

export function createOrbitLine(sma: number, ecc: number): Line2 {
  const AU_SCALE = 10;
  const a = sma * AU_SCALE;
  const b = a * Math.sqrt(1 - ecc * ecc);
  const curve = new EllipseCurve(
    -a * ecc, 0,  // center offset by focal distance
    a, b,
    0, Math.PI * 2,
    false, 0,
  );

  const points = curve.getPoints(128);
  const positions: number[] = [];
  for (let i = 0; i < points.length; i++) {
    positions.push(points[i].x, 0, points[i].y);
  }

  const geo = new LineGeometry();
  geo.setPositions(positions);

  const mat = new LineMaterial({
    color: 0x88a0b8,        // cooler blue-grey reads better against black
    linewidth: 1,
    transparent: true,
    opacity: 0.16,          // up from 0.03 — orbits should register, not vanish
    dashed: true,           // predicted-path vocabulary
    dashSize: 6,
    gapSize: 4,
    dashScale: 1,
    depthWrite: false,
    resolution: new Vector2(window.innerWidth, window.innerHeight),
  });
  // LineMaterial requires defines.USE_DASH to actually dash
  mat.defines = { ...(mat.defines ?? {}), USE_DASH: '' };
  mat.needsUpdate = true;

  trackedOrbitMaterials.push(mat);

  const line = new Line2(geo, mat);
  line.name = 'orbit-line';
  line.computeLineDistances();
  return line;
}

/** Update orbit line resolution on window resize */
export function updateOrbitLineResolution(w: number, h: number): void {
  for (const mat of trackedOrbitMaterials) {
    mat.resolution.set(w, h);
  }
}
