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
import { asset } from '@core/assets';

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
  group.userData.bodyRadius = radius;

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
  // Ring shadow casting (set only for ringed planets). Radii in planet-local
  // units; normal is the ring plane's world-space normal (constant — the planet
  // root group is positioned + uniformly scaled, never rotated).
  ringInnerLocal: number;
  ringOuterLocal: number;
  ringNormal: Vector3 | null;
}
const trackedPlanets: PlanetMaterialEntry[] = [];

// Planetshine tuning. strength = clamp(GAIN · (parentRadius/dist)², MAX). Both
// radius and distance scale with the visual scale, so the ratio is scale-free.
const PLANETSHINE_GAIN = 2.5;
const PLANETSHINE_MAX = 0.22;
const _bounceVec = new Vector3();

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
  group.userData.bodyRadius = size;  // for camera per-object scale

  const segments = VP.get('planetSegments');
  const c = new Color(color);

  // ── Spin Group (for rotation + axial tilt) ──
  const spinGroup = new Group();
  spinGroup.name = `spin-${name}`;
  spinGroup.rotation.z = axialTilt * (Math.PI / 180);
  // Oblateness: gas giants are visibly flattened by fast rotation (real
  // Jupiter ~6.5%, Saturn ~9.8%); ice giants mildly (~2%). Surface AND
  // atmosphere shells live in spinGroup, so both squash consistently.
  const oblate = planetType === 3 ? 0.93 : planetType === 4 ? 0.98 : 1.0;
  spinGroup.scale.y = 1 - (1 - oblate) * VP.get('planetOblatenessScale');
  group.add(spinGroup);

  // Airless bodies have knife-edge terminators; the soft VP default is an
  // atmosphere look (docs/planet-visual-realism.md §lighting).
  const terminatorSoftness = hasAtmosphere ? VP.get('planetTerminatorSoftness') : 0.15;

  // ── Surface ──
  const surfaceMat = new ShaderMaterial({
    vertexShader: planetSurfaceVertexShader,
    fragmentShader: planetSurfaceFragmentShader,
    uniforms: {
      uColor: { value: new Vector3(c.r, c.g, c.b) },
      uSunDir: { value: new Vector3(0, 0, 1) },
      uTerminatorSoftness: { value: terminatorSoftness },
      uTerminatorOffset: { value: VP.get('planetTerminatorOffset') },
      uSpecularPower: { value: VP.get('planetSpecularPower') },
      uSpecularOffset: { value: VP.get('planetSpecularOffset') },
      uDayTexture: { value: null as Texture | null },
      uHasTexture: { value: false },
      uTime: { value: 0 },
      uHasAtmosphere: { value: hasAtmosphere },
      // Specular gating: Oceanic(1) = 1.0 (sea glint), IceGiant(4) = 0.55,
      // Rocky/Desert/Gas/Dwarf = 0 (no plausible specular highlight).
      // (Was `=== 2`, which is Desert in the PlanetType enum — ice giants
      // were getting zero specular and deserts a sea glint.)
      uSpecularScale: { value: planetType === 1 ? 1.0 : planetType === 4 ? 0.55 : 0.0 },
      // Twilight scattering tint — warmer for thicker atmospheres.
      uTwilightTint: { value: new Vector3(
        planetType === 1 ? 1.0 : planetType === 0 ? 0.95 : 0.7,
        planetType === 1 ? 0.55 : planetType === 0 ? 0.45 : 0.35,
        planetType === 1 ? 0.25 : planetType === 0 ? 0.20 : 0.45,
      ) },
      uTwilightStrength: { value: hasAtmosphere ? 0.18 : 0.0 },
      // Planetshine (set per-frame by updatePlanetShaders; 0 = no bright neighbour).
      uBounceDir: { value: new Vector3(0, 1, 0) },
      uBounceColor: { value: new Vector3(1, 1, 1) },
      uBounceStrength: { value: 0.0 },
      // Ring shadow (set per-frame for ringed planets; uHasRingShadow gates it).
      uHasRingShadow: { value: false },
      uRingNormal: { value: new Vector3(0, 1, 0) },
      uPlanetCenter: { value: new Vector3(0, 0, 0) },
      uRingInner: { value: 0.0 },
      uRingOuter: { value: 0.0 },
      uRingShadowStrength: { value: 0.0 },
      // Jónsson limb darkening — gas/ice giants only (types 3/4).
      uLimbDarken: { value: planetType === 3 || planetType === 4 ? 1.0 : 0.0 },
      uLimbK: { value: VP.get('planetLimbK') },
      uLimbCe: { value: VP.get('planetLimbCe') },
    },
  });

  // Load day texture if provided (file-based, e.g. Sol textures)
  if (texturePath) {
    textureLoader.load(asset(texturePath), (tex) => {
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
  let ringInnerLocal = 0;
  let ringOuterLocal = 0;
  let ringNormal: Vector3 | null = null;
  if (ringTexturePath) {
    const innerR = size * 1.8;
    const outerR = size * 3.2;
    ringInnerLocal = innerR;
    ringOuterLocal = outerR;
    // Ring plane normal in world space. RingGeometry (normal +Z) is laid flat by
    // ring.rotation.x = -π/2 → normal +Y, then tilted by ringTiltGroup.rotation.z
    // = axialTilt around Z ⇒ Rz(tilt)·(0,1,0) = (−sin tilt, cos tilt, 0). The
    // planet root group is never rotated, so this is also the world normal.
    const tiltRad = axialTilt * (Math.PI / 180);
    ringNormal = new Vector3(-Math.sin(tiltRad), Math.cos(tiltRad), 0);
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
      asset(ringTexturePath),
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
  trackedPlanets.push({
    group, spinGroup, surfaceMat, atmosMat, ringMat, planetRadius: size, dayLength,
    ringInnerLocal, ringOuterLocal, ringNormal,
  });

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
 *  preventing orbiting planets from flashing across the camera at close zoom.
 *  @param gameTime   sim seconds — drives planet ROTATION (must track warp)
 *  @param shaderTime bounded wall-clock seconds — drives cosmetic shader
 *                    animation (storm flicker). Was fed gameTime, which made
 *                    flicker speed scale with time compression and overflow
 *                    float32 within a session. */
export function updatePlanetShaders(
  gameTime = 0,
  shaderTime = 0,
  cameraPosition?: Vector3,
  focusTarget?: { x: number; y: number; z: number } | null,
  zoomDomain?: string,
): void {
  const sunDir = new Vector3();

  // Planetshine sources — moons receive a diffuse bounce from their nearest planet.
  const planetEntries = trackedPlanets.filter((e) => e.group.userData?.type === 'planet');

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
    entry.surfaceMat.uniforms.uTime.value = shaderTime;

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

    // Ring shadow cast onto the planet's own surface (ringed planets only).
    // Convert local annulus radii to world via the uniform visual scale.
    if (entry.ringNormal) {
      const sm = entry.surfaceMat.uniforms;
      const s = entry.group.scale.x;
      sm.uHasRingShadow.value = true;
      sm.uRingNormal.value.copy(entry.ringNormal);
      sm.uPlanetCenter.value.copy(pos);
      sm.uRingInner.value = entry.ringInnerLocal * s;
      sm.uRingOuter.value = entry.ringOuterLocal * s;
      sm.uRingShadowStrength.value = VP.get('ringShadowStrength');
    }

    // ── Planetshine ──
    // A moon's night side facing its parent is lit by the planet's reflected
    // sunlight. Bounce source = nearest planet; tint = that planet's albedo
    // color; intensity falls off as (parentRadius / distance)². Planets
    // themselves get negligible planetshine (strength 0).
    if (entry.group.userData?.type === 'moon' && planetEntries.length > 0) {
      let parent: PlanetMaterialEntry | null = null;
      let bestDsq = Infinity;
      for (const p of planetEntries) {
        const pp = p.group.position;
        const dsq = (pp.x - pos.x) ** 2 + (pp.y - pos.y) ** 2 + (pp.z - pos.z) ** 2;
        if (dsq < bestDsq) { bestDsq = dsq; parent = p; }
      }
      if (parent) {
        const pp = parent.group.position;
        _bounceVec.set(pp.x - pos.x, pp.y - pos.y, pp.z - pos.z);
        const dist = Math.max(_bounceVec.length(), 1e-4);
        _bounceVec.multiplyScalar(1 / dist);
        const parentRadius = parent.planetRadius * parent.group.scale.x;
        const ratio = parentRadius / dist;
        const strength = Math.min(PLANETSHINE_GAIN * ratio * ratio, PLANETSHINE_MAX);
        entry.surfaceMat.uniforms.uBounceDir.value.copy(_bounceVec);
        entry.surfaceMat.uniforms.uBounceColor.value.copy(parent.surfaceMat.uniforms.uColor.value);
        entry.surfaceMat.uniforms.uBounceStrength.value = strength;
      }
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
  group.userData.bodyRadius = size;

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
      // Moons are airless: knife-edge terminator.
      uTerminatorSoftness: { value: 0.15 },
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
      // Planetshine — moons get a meaningful bounce from their parent body.
      uBounceDir: { value: new Vector3(0, 1, 0) },
      uBounceColor: { value: new Vector3(1, 1, 1) },
      uBounceStrength: { value: 0.0 },
      // Ring shadow — moons have no rings; uniforms present for the shared shader.
      uHasRingShadow: { value: false },
      uRingNormal: { value: new Vector3(0, 1, 0) },
      uPlanetCenter: { value: new Vector3(0, 0, 0) },
      uRingInner: { value: 0.0 },
      uRingOuter: { value: 0.0 },
      uRingShadowStrength: { value: 0.0 },
      // No limb darkening on moons (airless rocky bodies).
      uLimbDarken: { value: 0.0 },
      uLimbK: { value: VP.get('planetLimbK') },
      uLimbCe: { value: VP.get('planetLimbCe') },
    },
  });

  if (texturePath) {
    textureLoader.load(asset(texturePath), (tex) => {
      tex.colorSpace = SRGBColorSpace;
      surfaceMat.uniforms.uDayTexture.value = tex;
      surfaceMat.uniforms.uHasTexture.value = true;
      surfaceMat.needsUpdate = true;
    });
  }

  const surfaceMesh = new Mesh(new SphereGeometry(size, segments, segments), surfaceMat);
  spinGroup.add(surfaceMesh);

  // Track for per-frame sun direction updates (reuse planet tracking)
  trackedPlanets.push({
    group, spinGroup, surfaceMat, atmosMat: null, ringMat: null, planetRadius: size, dayLength,
    ringInnerLocal: 0, ringOuterLocal: 0, ringNormal: null,
  });

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
  // NO label/sublabel: regional markers currently share placeholder positions
  // (DIST 0.0), so now-legible child labels would superimpose into a smear.
  // The galactic-tier system markers (galaxy.ts) carry their own labels;
  // regional marker labels return with the marker-positioning + clustering
  // pass (docs/zoom-overlay-patterns.md Phases 2-3).
  const icon = createIcon({
    shape,
    color: numToHex(color),
    // Every marker gets a colored glow — readable against the warm
    // galaxy disc backdrop now that the disc is visible at sector tier.
    glowColor: numToHex(color),
    outlineWidth: isHome ? 4 : 3,
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

  // Center icon — no child labels (same placeholder-position stacking
  // rationale as createSystemMarker).
  const icon = createIcon({
    shape: 'triangle',
    color: numToHex(color),
  });
  group.add(icon);

  return group;
}

// ── Orbit Line ───────────────────────────────────────────────────

/** Tracked orbit line materials for resolution updates on window resize */
const trackedOrbitMaterials: LineMaterial[] = [];

// Orbit-line styling: planetary bodies get SOLID low-opacity white; other
// system bodies (comets etc.) use their own colors. Hovering a body brightens
// its orbit line via the registry below.
const ORBIT_BASE_OPACITY = 0.08;  // subtle at rest (bloom lifts perceived brightness)
const ORBIT_HOVER_OPACITY = 0.55;
const orbitLineByBody = new Map<string, LineMaterial>();

export interface OrbitLineOptions {
  /** Body name — registers the line for hover brightening. */
  bodyName?: string;
  /** Line color (default: white for planetary bodies). */
  color?: number;
  /** Resting opacity (default ORBIT_BASE_OPACITY). */
  opacity?: number;
}

export interface OrbitLineElements {
  sma: number;          // AU
  ecc: number;
  inclination: number;  // i (radians)
  argPeriapsis: number; // ω (radians)
  longAscNode: number;  // Ω (radians)
}

export function createOrbitLine(el: OrbitLineElements, opts: OrbitLineOptions = {}): Line2 {
  const AU_SCALE = 10;
  const a = el.sma * AU_SCALE;
  const b = a * Math.sqrt(1 - el.ecc * el.ecc);
  // Perifocal-plane ellipse with the focus (star) at the local origin.
  const curve = new EllipseCurve(
    -a * el.ecc, 0,  // center offset by focal distance
    a, b,
    0, Math.PI * 2,
    false, 0,
  );

  // Rotate perifocal → reference frame by R = R_z(Ω)·R_x(i)·R_z(ω) and apply
  // the same Y-up axis mapping the propagator uses (systems.ts orbitalSystem:
  // world (X,Y,Z) = (px, pz, py)). The line MUST share the propagator's exact
  // transform or bodies with real i/Ω/ω drift off their drawn paths — the
  // user-visible "planet offset from its orbit line" bug.
  const cosO = Math.cos(el.longAscNode), sinO = Math.sin(el.longAscNode);
  const cosw = Math.cos(el.argPeriapsis), sinw = Math.sin(el.argPeriapsis);
  const cosi = Math.cos(el.inclination),  sini = Math.sin(el.inclination);

  const points = curve.getPoints(128);
  const positions: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const xp = points[i].x;
    const yp = points[i].y;
    const px = xp * (cosO * cosw - sinO * sinw * cosi) + yp * (-cosO * sinw - sinO * cosw * cosi);
    const py = xp * (sinO * cosw + cosO * sinw * cosi) + yp * (-sinO * sinw + cosO * cosw * cosi);
    const pz = xp * (sinw * sini) + yp * (cosw * sini);
    positions.push(px, pz, py);
  }

  const geo = new LineGeometry();
  geo.setPositions(positions);

  const mat = new LineMaterial({
    color: opts.color ?? 0xffffff,  // planetary bodies: solid low-opacity white
    linewidth: 1,
    transparent: true,
    opacity: opts.opacity ?? ORBIT_BASE_OPACITY,
    depthWrite: false,
    resolution: new Vector2(window.innerWidth, window.innerHeight),
  });
  mat.userData.baseOpacity = opts.opacity ?? ORBIT_BASE_OPACITY;

  trackedOrbitMaterials.push(mat);
  if (opts.bodyName) orbitLineByBody.set(opts.bodyName, mat);

  const line = new Line2(geo, mat);
  line.name = 'orbit-line';
  // Raycast identity: lets the hover system brighten the line when the LINE
  // itself is hovered (raycaster.params.Line2.threshold gives it a fat,
  // screen-constant hit corridor despite the 1px draw width).
  if (opts.bodyName) line.userData = { type: 'orbit', name: opts.bodyName };
  line.computeLineDistances();
  return line;
}

/**
 * Brighten the orbit line of the hovered body (null clears). Called by the
 * raycast hover handler so hovering a planet/moon highlights its path.
 */
let highlightedOrbit: string | null = null;
export function setOrbitHighlight(bodyName: string | null): void {
  if (bodyName === highlightedOrbit) return;
  if (highlightedOrbit) {
    const prev = orbitLineByBody.get(highlightedOrbit);
    if (prev) prev.opacity = (prev.userData.baseOpacity as number) ?? ORBIT_BASE_OPACITY;
  }
  highlightedOrbit = bodyName;
  if (bodyName) {
    const mat = orbitLineByBody.get(bodyName);
    if (mat) mat.opacity = ORBIT_HOVER_OPACITY;
  }
}

/** Update orbit line resolution on window resize */
export function updateOrbitLineResolution(w: number, h: number): void {
  for (const mat of trackedOrbitMaterials) {
    mat.resolution.set(w, h);
  }
}
