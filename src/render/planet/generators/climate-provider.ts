import type { PlanetRenderParams, RGB } from '../presets';
import type { Vec3 } from '../cube-sphere';
import { fbm3 } from '../simplex';
import type { ClimateProvider, SurfaceSample } from './types';
import { iceCapCoverage, snowCover } from './ice';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / Math.max(1e-6, e1 - e0));
  return t * t * (3 - 2 * t);
}
function mixRgb(a: RGB, b: RGB, t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function biomeColor(temp: number, moist: number): [number, number, number] {
  const dry = mixRgb([0.200, 0.185, 0.150], [0.330, 0.265, 0.165], clamp01((temp - 0.3) / 0.45));
  const midA: RGB = [0.105, 0.150, 0.092];
  const midB: RGB = [0.185, 0.175, 0.100];
  const midC: RGB = [0.215, 0.185, 0.095];
  const mid = mixRgb(midA, mixRgb(midB, midC, clamp01((temp - 0.55) / 0.3)), clamp01((temp - 0.1) / 0.28));
  const wetA: RGB = [0.042, 0.070, 0.058];
  const wetB: RGB = [0.050, 0.095, 0.045];
  const wetC: RGB = [0.042, 0.100, 0.038];
  let wet = mixRgb(wetA, wetB, clamp01((temp - 0.22) / 0.3));
  wet = mixRgb(wet, wetC, clamp01((temp - 0.62) / 0.26));
  const c = mixRgb(dry, mid, clamp01((moist - 0.16) / 0.26));
  return mixRgb(c, wet, clamp01((moist - 0.44) / 0.26));
}

function sampleRamp(params: PlanetRenderParams, h: number): [number, number, number] {
  const ramp = params.ramp;
  if (!ramp.length) return [0.5, 0.5, 0.5];
  const lastUsable = Math.max(0, ramp.length - 2);
  if (h <= ramp[0].at) return [...ramp[0].color] as [number, number, number];
  for (let i = 1; i <= lastUsable; i++) {
    if (h <= ramp[i].at) {
      const t = (h - ramp[i - 1].at) / Math.max(1e-6, ramp[i].at - ramp[i - 1].at);
      return mixRgb(ramp[i - 1].color, ramp[i].color, t);
    }
  }
  const last = ramp[lastUsable];
  return [...last.color] as [number, number, number];
}

/** CPU climate field — latitude + altitude + moisture drivers from presets. */
export function createClimateProvider(paramsRef: { current: PlanetRenderParams }): ClimateProvider {
  return {
    sample(
      dir: Vec3,
      height: number,
      climateElev?: number,
    ): Pick<SurfaceSample, 'temp' | 'moisture' | 'ice' | 'habit' | 'color' | 'sea'> {
      const p = paramsRef.current;
      const seed = p.noiseSeed as Vec3;
      const sea = p.seaLevel > 0 && height < p.seaLevel;
      const lat = Math.abs(dir[1]);
      // Relief elev for ramp / display height normalization.
      const hh = p.seaLevel > 0
        ? clamp01((height - p.seaLevel) / Math.max(1e-3, 1 - p.seaLevel))
        : height;
      // Continuous macro elev for climate thresholds (matches Legacy plateMacro path).
      const elevRaw = climateElev ?? height;
      const elevHh = p.seaLevel > 0
        ? clamp01((elevRaw - p.seaLevel) / Math.max(1e-3, 1 - p.seaLevel))
        : elevRaw;

      let temp = clamp01(1 - 0.95 * lat * lat * lat - elevHh * p.lapseRate * 0.85);
      temp = clamp01(temp + fbm3(
        dir[0] * 3.7 + seed[0] * 0.37,
        dir[1] * 3.7 + seed[1] * 0.37,
        dir[2] * 3.7 + seed[2] * 0.37,
      ) * 0.06);

      const belt = Math.sin(lat * Math.PI * 2.2);
      let moist = p.moisture;
      moist -= p.aridBelts * 0.35 * Math.max(0, belt);
      moist += p.patchiness * 0.25 * (fbm3(dir[0] * 4.1, dir[1] * 4.1 + 9, dir[2] * 4.1) * 0.5 + 0.5 - 0.5);
      moist -= p.continental * 0.2 * elevHh;
      moist -= p.altitudeDry * 0.25 * elevHh;

      // Windward wetting / rain shadow from wind bearing (lon relative to wind).
      const lon = Math.atan2(dir[2], dir[0]);
      const windDot = Math.cos(lon - p.windBearing);
      const slope = clamp01(elevHh * 1.8);
      moist += p.orographic * 0.28 * Math.max(0, windDot) * slope;
      moist -= p.rainShadow * 0.32 * Math.max(0, -windDot) * slope;
      // Allow lab moisture > 1 to push wet biomes harder before clamp.
      const moistRaw = moist;
      moist = clamp01(moist);

      const cap = iceCapCoverage(dir, height, p.seaLevel, p.latitudeIce, seed);
      const snow = snowCover(temp, lat, elevHh, p.latitudeIce, p.snowfall);
      let ice = sea
        ? Math.max(cap, snow * 0.45)
        : Math.max(cap, snow * 0.72);

      let color: [number, number, number];
      if (sea) {
        const depth = clamp01((p.seaLevel - height) / Math.max(p.seaLevel, 1e-3));
        // Narrow shelf fringe only (Legacy shaders.ts). Wide depth*2.2 ramps
        // painted every trench/shelf into orbit albedo — open ocean must read
        // as opaque deep water from mid-AU.
        color = mixRgb(p.oceanShallow, p.oceanDeep, smoothstep(0, 0.10, depth));
        const abyss: RGB = [
          p.oceanDeep[0] * 0.72, p.oceanDeep[1] * 0.72, p.oceanDeep[2] * 0.72,
        ];
        color = mixRgb(color, abyss, smoothstep(0.10, 0.55, depth));
        // F7: this second darken term used to span smoothstep(0.45, 1, depth) —
        // a 0.55-wide window covering most of the open-ocean floor, so ordinary
        // seafloor undulation (well short of true trenches) still traced a
        // visible light/dark gradient into orbit albedo (P-LOOK-04). Narrowed
        // to the same 0.10 width as the shelf fringe above and pushed to the
        // deepest slice only — open ocean between the shelf and the abyssal
        // floor now reads as one flat colour; only the deepest trenches darken.
        const darken = mix(1, 0.72, smoothstep(0.90, 1.0, depth));
        color = [color[0] * darken, color[1] * darken, color[2] * darken];
        if (ice > 0.02) {
          const seaIce: RGB = [0.72, 0.82, 0.94];
          color = mixRgb(color, seaIce, clamp01(cap * 0.95 + snow * 0.35));
        }
      } else {
        // Land-dominant: paint albedo mostly from macro elev (climateElev). Full
        // ridged/crater terrainHeight stamped altitude isolines into Continuum
        // rocky/desert orbit albedo; mesh still carries the detailed height.
        let hhRamp = hh;
        if (p.seaLevel < 0.05) {
          hhRamp = clamp01(elevHh * 0.82 + hh * 0.18);
          const warp = fbm3(
            dir[0] * 6.3 + seed[0] * 0.21,
            dir[1] * 6.3 + seed[1] * 0.21,
            dir[2] * 6.3 + seed[2] * 0.21,
          );
          hhRamp = clamp01(hhRamp + (warp - 0.5) * 0.035);
        }
        color = sampleRamp(p, hhRamp);
        // Legacy parity (shaders.ts): treeline is a TEMPERATURE gate, not elev cutoff.
        // moistRaw > 1 (lab Base humidity) deepens canopy without needing elev=0.
        const moistForBiome = clamp01(moistRaw);
        const wetBoost = clamp01((moistRaw - 1.0) / 0.5); // 0..1 when moisture 1..1.5
        const cover = smoothstep(p.treeline - 0.06, p.treeline + 0.10, temp)
          * (0.35 + 0.65 * smoothstep(0.05, 0.35, moistForBiome));
        const lush = Math.min(1.35, p.lushDepth * (1.0 + 0.35 * wetBoost));
        color = mixRgb(color, biomeColor(temp, moistForBiome), Math.min(1, cover * lush));
        if (ice > 0.001) {
          const landIce: RGB = [0.93, 0.945, 0.96];
          const show = clamp01(cap * 0.92 + snow * 0.55);
          color = mixRgb(color, landIce, show);
        }
        // Do NOT bake night-lights into albedo — that warm [1,0.82,0.55] mix
        // washed continents beige on the day side. City glow is view-dependent
        // in the Continuum fragment shader only.
        if (p.emissiveStrength > 0.01) {
          color = mixRgb(color, p.emissive, clamp01(p.emissiveStrength * 0.15 * (1 - hh)));
        }
      }

      const habit = sea ? 0 : clamp01(
        (0.42 * (1 - clamp01(elevHh / 0.12)) + 0.54 * clamp01((moist - 0.22) / 0.28))
        * clamp01((temp - 0.26) / 0.29)
        * (1 - clamp01(cap * 1.4 + snow * 0.5)),
      );

      return { temp, moisture: moist, ice, habit, color, sea };
    },
    invalidate() { /* paramsRef is live */ },
  };
}
