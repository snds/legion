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
import { WU_PER_PC, KPC_TO_WU, SOL_GAL_PC } from '../core/metrics';
import { driftedRegionalScenePos, driftGalPc, DRIFT_MIN_STEP_MYR } from '../core/galactic-drift';
import { BV_COLOR_GLSL } from './star-field';

// Galaxy-group native frame: 1 pc = KPC_TO_WU/1000 WU (children of the galaxy
// group are authored in this frame and ride its ×GALAXY_MODEL_SCALE lift —
// same convention as the curated gal_system markers).
const PC_TO_NATIVE = KPC_TO_WU / 1000;

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

// GALACTIC-frame representation: the same catalogue as small, slightly
// warm-white-boosted highlight particles embedded in the generative disc.
// Fixed pixel size (the galaxy group is ×GALAXY_MODEL_SCALE-scaled; px sizes
// don't inherit scale) — they read as "surveyed" stars among the procedural
// field rather than a second sky.
const galacticVertexShader = /* glsl */ `
  attribute float aAbsMag;
  attribute float aBV;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vBright;
  ${BV_COLOR_GLSL}
  void main(){
    vColor = mix(bvColor(aBV), vec3(1.0), 0.25); // highlight lift vs the disc field
    float dM = 4.83 - aAbsMag;
    vBright = clamp(0.55 + dM * 0.08, 0.4, 1.2);
    gl_PointSize = clamp(1.8 + dM * 0.25, 1.4, 3.6) * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export interface CatalogSystemsHandle {
  /** Mount this into the scene (regional-frame chart); fills itself when the
   *  catalogue arrives. */
  group: Group;
  /** GALACTIC-frame representation of the SAME stars — mount as a child of
   *  the galaxy group (native-333 coords, rides its rotation + model scale).
   *  Crossfades IN as the regional chart dissolves, so the space-agency
   *  highlights persist as particles at arm/galaxy framing. */
  galacticGroup: Group;
  /** Deduped catalogue stars, index-aligned with the position buffer. */
  stars: CatalogStar[];
  /** Heliocentric parsecs [x0,y0,z0, x1,…] — float64 authority for drift. */
  basePc: Float64Array;
  points: Points | null;
  galacticPoints: Points | null;
  ready: Promise<void>;
  /** Re-derive scene positions (BOTH frames) for the galactic-drift clock
   *  (Myr). Gated internally to DRIFT_MIN_STEP_MYR, so calling every frame is
   *  free at normal time compression. */
  updateDrift(tMyr: number): void;
  /** Per-frame presence (visibility.ts zoom-seam crossfade): drives the
   *  regional chart's uOpacity. No-op until the async catalogue load lands. */
  setOpacity(v: number): void;
  /** Per-frame presence of the galactic-frame representation. */
  setGalacticOpacity(v: number): void;
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
  const galacticGroup = new Group();
  galacticGroup.name = 'catalog-systems-galactic';

  let lastDriftMyr = 0; // positions are built at the epoch (t = 0)
  const pcScratch = { x: 0, y: 0, z: 0 };
  const wuScratch = { x: 0, y: 0, z: 0 };

  const handle: CatalogSystemsHandle = {
    group, galacticGroup, stars: [], basePc: new Float64Array(0),
    points: null, galacticPoints: null,
    ready: Promise.resolve(),
    updateDrift(tMyr: number): void {
      if (!handle.points || Math.abs(tMyr - lastDriftMyr) < DRIFT_MIN_STEP_MYR) return;
      lastDriftMyr = tMyr;
      const attr = handle.points.geometry.getAttribute('position') as BufferAttribute;
      const gattr = handle.galacticPoints?.geometry.getAttribute('position') as BufferAttribute | undefined;
      const base = handle.basePc;
      for (let i = 0; i < handle.stars.length; i++) {
        pcScratch.x = base[i * 3]; pcScratch.y = base[i * 3 + 1]; pcScratch.z = base[i * 3 + 2];
        driftedRegionalScenePos(pcScratch, tMyr, wuScratch);
        attr.setXYZ(i, wuScratch.x, wuScratch.y, wuScratch.z);
        if (gattr) {
          // Galactic frame: absolute galactocentric orbit (same transform as
          // the curated gal_system markers, native-333 coords).
          driftGalPc(
            SOL_GAL_PC.x + pcScratch.x, SOL_GAL_PC.y + pcScratch.y, SOL_GAL_PC.z + pcScratch.z,
            tMyr, wuScratch,
          );
          gattr.setXYZ(i, wuScratch.x * PC_TO_NATIVE, wuScratch.y * PC_TO_NATIVE, wuScratch.z * PC_TO_NATIVE);
        }
      }
      attr.needsUpdate = true;
      handle.points.geometry.computeBoundingSphere();
      if (gattr) {
        gattr.needsUpdate = true;
        handle.galacticPoints!.geometry.computeBoundingSphere();
      }
    },
    setOpacity(v: number): void {
      if (!handle.points) return;
      const mat = handle.points.material as ShaderMaterial;
      mat.uniforms.uOpacity.value = v;
      // Fully dissolved (full-galaxy framing) ⇒ skip the draw AND the
      // raycast pick — invisible points must not steal clicks.
      handle.points.visible = v > 0.005;
    },
    setGalacticOpacity(v: number): void {
      if (!handle.galacticPoints) return;
      const mat = handle.galacticPoints.material as ShaderMaterial;
      mat.uniforms.uOpacity.value = v;
      handle.galacticPoints.visible = v > 0.005;
    },
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
        // Born at 0 — the per-frame visibility crossfade (setOpacity) fades the
        // layer in when the async load lands, instead of a full-strength pop.
        uOpacity: { value: 0 },
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

    // ── Galactic-frame representation (same stars, disc-embedded) ──
    const gpos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      gpos[i * 3]     = (SOL_GAL_PC.x + basePc[i * 3])     * PC_TO_NATIVE;
      gpos[i * 3 + 1] = (SOL_GAL_PC.y + basePc[i * 3 + 1]) * PC_TO_NATIVE;
      gpos[i * 3 + 2] = (SOL_GAL_PC.z + basePc[i * 3 + 2]) * PC_TO_NATIVE;
    }
    const ggeo = new BufferGeometry();
    ggeo.setAttribute('position', new BufferAttribute(gpos, 3));
    ggeo.setAttribute('aAbsMag', new BufferAttribute(absMag, 1));
    ggeo.setAttribute('aBV', new BufferAttribute(bv, 1));
    ggeo.computeBoundingSphere();
    const gmat = new ShaderMaterial({
      vertexShader: galacticVertexShader, fragmentShader,
      uniforms: {
        uOpacity: { value: 0 }, // faded in by the zoom-seam crossfade
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    const galacticPoints = new Points(ggeo, gmat);
    galacticPoints.name = 'catalog-system-points-galactic';
    galacticPoints.visible = false; // until its crossfade lifts it
    galacticGroup.add(galacticPoints);

    handle.stars = stars;
    handle.basePc = basePc;
    handle.points = points;
    handle.galacticPoints = galacticPoints;
    console.info(`[CatalogSystems] ${n} real systems placed (25 pc neighbourhood + galactic frame)`);
  });

  return handle;
}
