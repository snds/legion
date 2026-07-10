// ═══════════════════════════════════════════════════════════════════
// CATALOG SYSTEMS — every real HYG star within 25 pc at its TRUE 3D
// position in the regional frame (home = ε Eridani at the origin,
// 1 pc = 1000 WU). Fills the neighbourhood between the 16 curated
// (photorealistic) systems with the full navigable catalogue — ~3k stars
// with real names / designations / spectral types. Data: HYG v3.8,
// CC BY-SA 4.0 — credited in Settings → CREDITS (src/data/data-sources.ts).
//
// One Points draw. Size/brightness follow ABSOLUTE magnitude — this is a
// MAP, not a sky: a red dwarf 1 pc from the camera must not outshine
// Sirius. (The sky-shell backdrop still shows these same stars as far-field
// DIRECTIONS; these points sit at parallax-true positions among the nav
// markers, so the two read as sky vs. chart.)
//
// Curated systems are excluded by designation (they carry full markers).
// The base HELIOCENTRIC parsec positions are kept on the handle so the
// galactic-drift system can re-derive scene positions as sim time advances.
// ═══════════════════════════════════════════════════════════════════

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Group, Points, ShaderMaterial,
} from 'three';
import { loadStarSystems, type CatalogStar } from '../data/star-systems';
import { CURATED_SYSTEMS, HOME_SYSTEM } from '../data/curated-systems';
import { WU_PER_PC } from '../core/metrics';
import { BV_COLOR_GLSL } from './star-field';

const vertexShader = /* glsl */ `
  attribute float aAbsMag; // absolute magnitude M
  attribute float aBV;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vBright;
  ${BV_COLOR_GLSL}
  void main(){
    vColor = bvColor(aBV);
    // Chart scaling about the Sun's M = 4.83: brighter absolute mag → larger,
    // brighter dot. Floors keep the faintest red dwarfs visible as nav targets.
    float dM = 4.83 - aAbsMag;
    vBright = clamp(0.42 + dM * 0.11, 0.28, 1.35);
    gl_PointSize = clamp(2.6 + dM * 0.45, 1.3, 6.5) * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vBright;
  void main(){
    vec2 uv = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.12, length(uv));
    gl_FragColor = vec4(vColor * vBright, a * uOpacity);
  }
`;

export interface CatalogSystemsHandle {
  /** Mount this into layers.regional; fills itself when the catalogue arrives. */
  group: Group;
  /** Deduped catalogue stars, index-aligned with the position buffer. */
  stars: CatalogStar[];
  /** Heliocentric parsecs [x0,y0,z0, x1,…] — float64 authority for drift. */
  basePc: Float64Array;
  points: Points | null;
  ready: Promise<void>;
}

/** True if a catalogue star duplicates a curated system (matched the same way
 *  curated positions were baked: by designation token, plus name as a guard). */
function isCurated(star: CatalogStar, desigs: Set<string>, names: Set<string>): boolean {
  if (names.has(star.name)) return true;
  for (const tok of star.desig.split(' · ')) if (desigs.has(tok)) return true;
  return false;
}

export function createCatalogSystems(): CatalogSystemsHandle {
  const group = new Group();
  group.name = 'catalog-systems';

  const handle: CatalogSystemsHandle = {
    group, stars: [], basePc: new Float64Array(0), points: null,
    ready: Promise.resolve(),
  };

  handle.ready = loadStarSystems().then((all) => {
    const desigs = new Set(CURATED_SYSTEMS.map((s) => s.desig));
    const names = new Set(CURATED_SYSTEMS.map((s) => s.name));
    const stars = all.filter((s) => !isCurated(s, desigs, names));

    const n = stars.length;
    const pos = new Float32Array(n * 3);
    const basePc = new Float64Array(n * 3);
    const absMag = new Float32Array(n);
    const bv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = stars[i];
      basePc[i * 3] = s.x; basePc[i * 3 + 1] = s.y; basePc[i * 3 + 2] = s.z;
      // Regional scene frame: heliocentric − home offset, 1 pc = 1000 WU.
      pos[i * 3]     = (s.x - HOME_SYSTEM.solPc.x) * WU_PER_PC;
      pos[i * 3 + 1] = (s.y - HOME_SYSTEM.solPc.y) * WU_PER_PC;
      pos[i * 3 + 2] = (s.z - HOME_SYSTEM.solPc.z) * WU_PER_PC;
      // M = m − 5·(log10(d_pc) − 1); heliocentric distance is the catalogued one.
      const dPc = Math.max(Math.hypot(s.x, s.y, s.z), 0.1);
      absMag[i] = s.mag - 5 * (Math.log10(dPc) - 1);
      bv[i] = s.ci;
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aAbsMag', new BufferAttribute(absMag, 1));
    geo.setAttribute('aBV', new BufferAttribute(bv, 1));
    geo.computeBoundingSphere();

    const mat = new ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        uOpacity: { value: 0.9 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });

    const points = new Points(geo, mat);
    points.name = 'catalog-system-points';
    // Selection metadata: raycast resolves a Points hit to an index; the
    // stars array (below) maps that index back to the catalogue record.
    points.userData.type = 'catalog_star_points';
    group.add(points);

    handle.stars = stars;
    handle.basePc = basePc;
    handle.points = points;
    console.info(`[CatalogSystems] ${n} real systems placed (25 pc neighbourhood)`);
  });

  return handle;
}
