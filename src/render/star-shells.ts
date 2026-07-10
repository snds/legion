// ═══════════════════════════════════════════════════════════════════
// STAR SHELLS — progressive LOD shells of stars bridging the real 25-pc
// survey sphere (catalog-systems) to the galaxy disc's global particles.
//
// The player's ask: past the ~100 ly ring the star field used to END —
// a void until the generative disc soup. Each shell is an ANNULUS of
// procedural stars around home, rejection-sampled from the SAME analytic
// galactic density field the disc volume integrates (sector-stars.ts
// emissionAtGalPc — "agree by construction"), with OB-blue bias on the
// arm ridges. As the camera zooms outward each shell fades IN at its
// scale while the finer one fades OUT — spheres of stars progressively
// appearing all the way to galaxy framing, where the last shell hands
// off to the physical galaxy's own particles.
//
// Shells tile space (annuli don't overlap) so there is no double-draw.
// They are STATISTICAL filler — not pickable (raycast no-op), not drifted
// (the catalog + disc carry the motion story) — authored in the regional
// frame (home at origin, 1 pc = 1000 WU) and re-rooted with the regional
// tier under the floating origin.
// ═══════════════════════════════════════════════════════════════════

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Group, Points, ShaderMaterial,
} from 'three';
import { WU_PER_PC } from '../core/metrics';
import { HOME_GAL_PC } from './sector/sector';
import { emissionAtGalPc, armPhaseAt } from './sector/sector-stars';
import { mulberry32, seedFrom } from '../data/system-gen';
import { BV_COLOR_GLSL } from './star-field';

interface ShellSpec {
  rMinPc: number;
  rMaxPc: number;
  count: number;
}

// Annuli tile 25 pc → 2.6 kpc in ~×3 steps; the last shell's fade-out
// overlaps the physical galaxy's presence ramp (2e6 WU →) so its stars
// dissolve into the disc field.
const SHELLS: ShellSpec[] = [
  { rMinPc: 25,   rMaxPc: 85,   count: 4000 },
  { rMinPc: 85,   rMaxPc: 300,  count: 5000 },
  { rMinPc: 300,  rMaxPc: 900,  count: 5000 },
  { rMinPc: 900,  rMaxPc: 2600, count: 6000 },
];

const vertexShader = /* glsl */ `
  attribute float aMag;  // synthetic absolute-ish magnitude
  attribute float aBV;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vBright;
  ${BV_COLOR_GLSL}
  void main(){
    vColor = bvColor(aBV);
    float dM = 4.83 - aMag;
    vBright = clamp(0.35 + dM * 0.09, 0.22, 1.1);
    gl_PointSize = clamp(2.0 + dM * 0.35, 1.1, 5.0) * uPixelRatio;
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

function smooth01(x: number, lo: number, hi: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** Shell presence over camDist (WU): fades in as the camera pulls back to the
 *  shell's scale, out once the framing is far beyond its outer edge. */
function shellPresence(camDist: number, spec: ShellSpec): number {
  const rMin = spec.rMinPc * WU_PER_PC;
  const rMax = spec.rMaxPc * WU_PER_PC;
  const fadeIn = smooth01(camDist, rMin * 0.12, rMin * 0.35);
  const fadeOut = 1 - smooth01(camDist, rMax * 1.2, rMax * 3.5);
  return fadeIn * fadeOut;
}

export interface StarShellsHandle {
  /** Mount into the scene; ride the REGIONAL tier root each frame. */
  group: Group;
  /** Per-frame crossfade driver (visibility.ts). */
  updatePresence(camDist: number): void;
  /** Resolves when every shell has finished its async build. */
  ready: Promise<void>;
}

/** Build one shell's geometry: rejection-sample the annulus against the
 *  galactic emission field. Chunked over macrotasks — a full build touches
 *  the FBM-backed density model tens of thousands of times, which would
 *  stall boot if done synchronously (the shells are invisible until the
 *  first zoom-out, so late arrival costs nothing). */
async function buildShell(spec: ShellSpec, shellIndex: number): Promise<BufferGeometry> {
  const rng = mulberry32(seedFrom(`star-shell|${shellIndex}|${spec.rMinPc}-${spec.rMaxPc}`));
  const r3min = spec.rMinPc ** 3;
  const r3max = spec.rMaxPc ** 3;

  // Probe the annulus (midplane-weighted) for a rejection ceiling.
  let peak = 1e-9;
  for (let i = 0; i < 240; i++) {
    const r = Math.cbrt(r3min + (r3max - r3min) * rng());
    const th = rng() * Math.PI * 2;
    const y = (rng() - 0.5) * 2 * Math.min(300, r * 0.25); // disc-biased probe
    const e = emissionAtGalPc(
      HOME_GAL_PC.x + r * Math.cos(th), HOME_GAL_PC.y + y, HOME_GAL_PC.z + r * Math.sin(th),
    );
    if (e > peak) peak = e;
  }
  peak *= 1.15;

  const pos = new Float32Array(spec.count * 3);
  const mag = new Float32Array(spec.count);
  const bv = new Float32Array(spec.count);
  let placed = 0;
  let tries = 0;
  const maxTries = spec.count * 30;
  const CHUNK = 1500;

  while (placed < spec.count && tries < maxTries) {
    const budget = Math.min(CHUNK, maxTries - tries);
    for (let i = 0; i < budget && placed < spec.count; i++) {
      tries++;
      // Uniform-in-volume point in the annulus; the density rejection then
      // shapes it into the disc/arm structure.
      const r = Math.cbrt(r3min + (r3max - r3min) * rng());
      const th = rng() * Math.PI * 2;
      const cosPhi = rng() * 2 - 1;
      const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
      const lx = r * sinPhi * Math.cos(th);
      const ly = r * cosPhi;
      const lz = r * sinPhi * Math.sin(th);
      const gx = HOME_GAL_PC.x + lx, gy = HOME_GAL_PC.y + ly, gz = HOME_GAL_PC.z + lz;
      if (emissionAtGalPc(gx, gy, gz) / peak < rng()) continue;

      pos[placed * 3] = lx * WU_PER_PC;
      pos[placed * 3 + 1] = ly * WU_PER_PC;
      pos[placed * 3 + 2] = lz * WU_PER_PC;
      // Synthetic population: faint-weighted magnitudes; OB-blue bias on the
      // arm ridges (same armPhaseAt classifier the sector stars use).
      const u = rng();
      mag[placed] = 10 - 9 * u * u;
      const ridge = armPhaseAt(gx, gz);
      bv[placed] = ridge.armRidge > 0.6 && rng() < ridge.crestiness
        ? -0.3 + rng() * 0.5
        : -0.1 + 1.7 * rng() ** 2;
      placed++;
    }
    // Yield the main thread between chunks.
    await new Promise((res) => setTimeout(res, 0));
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos.subarray(0, placed * 3), 3));
  geo.setAttribute('aMag', new BufferAttribute(mag.subarray(0, placed), 1));
  geo.setAttribute('aBV', new BufferAttribute(bv.subarray(0, placed), 1));
  geo.computeBoundingSphere();
  return geo;
}

export function createStarShells(): StarShellsHandle {
  const group = new Group();
  group.name = 'star-shells';
  const materials: (ShaderMaterial | null)[] = SHELLS.map(() => null);

  const ready = (async () => {
    for (let s = 0; s < SHELLS.length; s++) {
      const geo = await buildShell(SHELLS[s], s);
      const mat = new ShaderMaterial({
        vertexShader, fragmentShader,
        uniforms: {
          uOpacity: { value: 0 }, // presence-driven; fades in at its band
          uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        },
        transparent: true, depthWrite: false, blending: AdditiveBlending,
      });
      const points = new Points(geo, mat);
      points.name = `star-shell-${SHELLS[s].rMinPc}-${SHELLS[s].rMaxPc}pc`;
      points.raycast = () => {}; // statistical filler — never pickable
      points.visible = false;
      group.add(points);
      materials[s] = mat;
      console.info(`[StarShells] shell ${s} built: ${geo.getAttribute('position').count} stars `
        + `(${SHELLS[s].rMinPc}–${SHELLS[s].rMaxPc} pc)`);
    }
  })();

  return {
    group,
    ready,
    updatePresence(camDist: number): void {
      for (let s = 0; s < SHELLS.length; s++) {
        const mat = materials[s];
        if (!mat) continue;
        const p = shellPresence(camDist, SHELLS[s]);
        mat.uniforms.uOpacity.value = p;
        (group.children[s] as Points).visible = p > 0.004;
      }
    },
  };
}
