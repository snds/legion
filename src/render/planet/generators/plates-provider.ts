import type { PlanetVisualType } from '../../../data/system-gen';
import type { PlanetRenderParams } from '../presets';
import { generatePlates, macroHeight, type MacroParams, type PlateField } from '../plates';
import { warpDir, fbm3, snoise3 } from '../simplex';
import type { Vec3 } from '../cube-sphere';
import type { PlateTectonicsProvider } from './types';
import { iceCapCoverage } from './ice';

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function fract(x: number): number {
  return x - Math.floor(x);
}

/** GLSL hash13 parity (glsl.ts). */
function hash13(x: number, y: number, z: number): number {
  let px = fract(x * 0.1031);
  let py = fract(y * 0.1031);
  let pz = fract(z * 0.1031);
  const d = px * (pz + 31.32) + py * (py + 31.32) + pz * (px + 31.32);
  px += d; py += d; pz += d;
  return fract((px + py) * pz);
}

/** GLSL hash33 parity (glsl.ts). */
function hash33(x: number, y: number, z: number): [number, number, number] {
  let px = fract(x * 0.1031);
  let py = fract(y * 0.1030);
  let pz = fract(z * 0.0973);
  // dot(p3, p3.yxz + 33.33)
  const d = px * (py + 33.33) + py * (px + 33.33) + pz * (pz + 33.33);
  px += d; py += d; pz += d;
  // fract((p3.xxy + p3.yzz) * p3.zyx)
  return [
    fract((px + py) * pz),
    fract((px + pz) * py),
    fract((py + pz) * px),
  ];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const den = e1 - e0;
  if (Math.abs(den) < 1e-12) return x >= e1 ? 1 : 0;
  const t = clamp01((x - e0) / den);
  return t * t * (3 - 2 * t);
}

/**
 * Mercury/Mars crater profile — CPU port of GLSL craterField.
 * Flat floor + raised rim (orbit-readable), not soft fBm dimples.
 */
function craterField(dir: Vec3, coverage: number, freq: number, depth: number): number {
  if (coverage <= 0.001 || depth <= 0) return 0;
  const f = Math.max(2, freq);
  const ipx = Math.floor(dir[0] * f);
  const ipy = Math.floor(dir[1] * f);
  const ipz = Math.floor(dir[2] * f);
  let h = 0;
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const cx = ipx + x, cy = ipy + y, cz = ipz + z;
        if (hash13(cx + 3.7, cy + 3.7, cz + 3.7) > coverage) continue;
        const j = hash33(cx + 1.9, cy + 1.9, cz + 1.9);
        const jx = (j[0] - 0.5) * 0.98;
        const jy = (j[1] - 0.5) * 0.98;
        const jz = (j[2] - 0.5) * 0.98;
        let ox = cx + jx, oy = cy + jy, oz = cz + jz;
        const olen = Math.hypot(ox, oy, oz) || 1;
        ox /= olen; oy /= olen; oz /= olen;
        const sizeF = 0.25 + 0.33 * j[0];
        const rad = sizeF / f;
        const t = Math.acos(Math.min(1, Math.max(-1, dir[0] * ox + dir[1] * oy + dir[2] * oz))) / rad;
        if (t > 1.7) continue;
        const floorTerm = -(1 - smoothstep(0.55, 1.0, t));
        const rim = Math.exp(-(((t - 1) * 4.5) ** 2));
        const s = smoothstep(1.7, 1.02, t);
        h += (0.95 * floorTerm + 0.6 * rim) * (sizeF * 2.4) * s;
      }
    }
  }
  return h * depth;
}

/** Rift canyons — CPU port of GLSL canyonField (iso-contour troughs). */
function canyonField(
  dir: Vec3,
  coverage: number,
  freq: number,
  depth: number,
  seed: Vec3,
): number {
  if (coverage <= 0.001 || depth <= 0) return 0;
  const f = Math.max(1, freq);
  const px = dir[0] * f + seed[0] * 1.7;
  const py = dir[1] * f + seed[1] * 1.7;
  const pz = dir[2] * f + seed[2] * 1.7;
  const n = snoise3(px, py, pz)
    + 0.35 * snoise3(px * 2.6 + 17, py * 2.6, pz * 2.6);
  const band = Math.abs(n - 0.08);
  const w = 0.05;
  if (band > w) return 0;
  const maskN = fbm3(px * 0.55 + 31.7, py * 0.55, pz * 0.55) * 0.5 + 0.5;
  const edge0 = 1 - coverage * 0.75;
  const edge1 = 1.12 - coverage * 0.75;
  const mt = clamp01((maskN - edge0) / Math.max(1e-6, edge1 - edge0));
  const mask = mt * mt * (3 - 2 * mt);
  if (mask <= 0.001) return 0;
  const carveT = clamp01((band - w * 0.35) / Math.max(1e-6, w - w * 0.35));
  const carve = 1 - (carveT * carveT * (3 - 2 * carveT));
  const dv = 0.55 + 0.9 * (fbm3(px * 1.3 + 53.1, py * 1.3, pz * 1.3) * 0.5 + 0.5);
  return -carve * mask * dv * depth;
}

function syncFieldFromMacro(field: PlateField, m: MacroParams): void {
  field.uplift = m.uplift;
  field.rangeWidth = m.rangeWidth;
  field.coastAmp = m.coastAmp;
  field.coastFreq = m.coastFreq;
  field.rangeVar = m.rangeVar;
}

/** Wrap plates.ts + simplex warp/detail as the Continuum terrain master. */
export function createPlateProvider(
  seed: number,
  type: PlanetVisualType,
  paramsRef: { current: PlanetRenderParams },
  macroRef: { current: MacroParams },
): PlateTectonicsProvider {
  let field: PlateField = generatePlates(seed, type);
  syncFieldFromMacro(field, macroRef.current);

  const terrainHeight = (dir: Vec3): number => {
    const p = paramsRef.current;
    const mp = macroRef.current;
    syncFieldFromMacro(field, mp);
    const seed3 = p.noiseSeed as Vec3;
    const wdir = warpDir(dir, p.warp, seed3);
    const macro = macroHeight(field, wdir);
    const ds = Math.max(1, mp.detailScale);
    const sx = dir[0] * 1.7 * ds, sy = dir[1] * 1.7 * ds, sz = dir[2] * 1.7 * ds;
    const d = fbm3(sx + 11.3, sy + 47.7, sz + 83.1) * 0.5 + 0.5;
    const relief = 0.16 + 0.16 * Math.max(0, Math.min(1, (macro - 0.55) / 0.3));
    let h = macro + (d - 0.5) * relief * (0.5 + 0.5 * p.ridged);
    h += craterField(wdir, mp.craters, mp.craterFreq, mp.craterDepth);
    h += canyonField(wdir, mp.canyons, mp.canyonFreq, mp.canyonDepth, seed3);
    const cap = iceCapCoverage(dir, h, p.seaLevel, p.latitudeIce, seed3);
    if (cap > 0) {
      const shelf = Math.max(h, p.seaLevel + 0.10);
      h = h + (shelf - h) * cap;
    }
    return Math.max(0, Math.min(1, h));
  };

  return {
    get type() { return type; },
    get field() { return field; },
    macroHeight(dir: Vec3) {
      const p = paramsRef.current;
      syncFieldFromMacro(field, macroRef.current);
      return macroHeight(field, warpDir(dir, p.warp, p.noiseSeed as Vec3));
    },
    terrainHeight,
    invalidate() {
      field = generatePlates(seed, type);
      syncFieldFromMacro(field, macroRef.current);
    },
  };
}
