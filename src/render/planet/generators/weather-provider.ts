import type { PlanetRenderParams } from '../presets';
import type { Vec3 } from '../cube-sphere';
import { fbm3 } from '../simplex';
import { channel } from '../rng';
import type { PlateTectonicsProvider, StormSlot, WeatherProvider } from './types';

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function dirFromLonLat(lon: number, lat: number): Vec3 {
  const cl = Math.sqrt(Math.max(1 - lat * lat, 0));
  return [Math.cos(lon) * cl, lat, Math.sin(lon) * cl];
}

/** Lightweight weather field + CPU cyclone slots (ocean-gated via plates). */
export function createWeatherProvider(
  seed: number,
  paramsRef: { current: PlanetRenderParams },
  plates: PlateTectonicsProvider,
): WeatherProvider {
  let clock = 0;
  const rng = channel(seed >>> 0, 'weather');
  const storms: { lon: number; lat: number; drift: number; born: number; life: number }[] = [];

  const oceanAt = (dir: Vec3): number => {
    const p = paramsRef.current;
    const h = plates.terrainHeight(dir);
    const sea = p.seaLevel;
    if (sea <= 0) return 0;
    const t = Math.min(1, Math.max(0, (h - (sea - 0.04)) / 0.1));
    return 1 - t * t * (3 - 2 * t);
  };

  const spawn = (slot: number, bornT: number) => {
    let best = { lon: 0, lat: 0.3, drift: 1, g: -1 };
    for (let k = 0; k < 6; k++) {
      const lon = rng() * Math.PI * 2;
      const lat = (0.12 + 0.38 * rng()) * (slot % 2 === 0 ? 1 : -1);
      const drift = 0.7 + 0.6 * rng();
      const g = oceanAt(dirFromLonLat(lon, lat));
      if (g > best.g) best = { lon, lat, drift, g };
      if (g >= 0.55) break;
    }
    return { lon: best.lon, lat: best.lat, drift: best.drift, born: bornT - 4, life: 18 + 10 * rng() + slot * 3 };
  };

  const slots = (): StormSlot[] => {
    const p = paramsRef.current;
    const T = clock * p.cloudSpeed;
    if (storms.length === 0) for (let i = 0; i < 3; i++) storms.push(spawn(i, T));
    const out: StormSlot[] = [];
    for (let i = 0; i < 3; i++) {
      if (p.cyclones <= 0) {
        out.push({ pos: [0, 1, 0], strength: 0 });
        continue;
      }
      let s = storms[i];
      if (T - s.born >= s.life) s = storms[i] = spawn(i, T);
      const age = T - s.born;
      const lon = s.lon - age * 0.03 * s.drift;
      const gate = oceanAt(dirFromLonLat(lon, s.lat));
      const grow = clamp01(age / 1.2);
      const fade = 1 - clamp01((age - (s.life - 3.5)) / 3.5);
      const str = p.cyclones * gate * grow * fade * Math.sign(s.lat);
      out.push({ pos: dirFromLonLat(lon, s.lat), strength: str });
    }
    return out;
  };

  return {
    cloudDensity(dir: Vec3, timeSec: number): number {
      const p = paramsRef.current;
      if (p.cloudCover <= 0) return 0;
      const T = timeSec * p.cloudSpeed;
      const lat = dir[1];
      const zonal = 0.6 * Math.cos(lat * 4.712) + 0.15 * Math.cos(lat * 12.566);
      const adv = 0.35 * T * 0.02 + 0.35 * zonal * Math.sin(T * 0.0044);
      const ca = Math.cos(p.cloudFlow * adv), sa = Math.sin(p.cloudFlow * adv);
      const dx = ca * dir[0] + sa * dir[2];
      const dz = -sa * dir[0] + ca * dir[2];
      const det = Math.max(p.cloudDetail, 0.25);
      let f = fbm3(dx * 3.2 * det + p.noiseSeed[0], dir[1] * 3.2 * det + p.noiseSeed[1], dz * 3.2 * det + p.noiseSeed[2]) * 0.5 + 0.5;
      f += (0.18 + 0.2 * p.cloudTurb) * (fbm3(dx * 8 + 17, dir[1] * 8, dz * 8) * 0.5 + 0.5);
      // Terrain coupling: mountains thin the deck; basins thicken it.
      const h = plates.terrainHeight(dir);
      const elev = p.seaLevel > 0
        ? Math.max(0, (h - p.seaLevel) / Math.max(1e-3, 1 - p.seaLevel))
        : h;
      f -= p.cloudTerrain * 0.28 * elev;
      f += p.cloudTerrain * 0.12 * Math.max(0, p.seaLevel - h);
      const region = fbm3(dx * 1.5 + 9, dir[1] * 1.5, dz * 1.5);
      f += (region - 0.5) * (0.12 + 0.28 * p.cloudRegion);
      for (const st of slots()) {
        if (Math.abs(st.strength) < 0.01) continue;
        const d = Math.acos(Math.max(-1, Math.min(1,
          dir[0] * st.pos[0] + dir[1] * st.pos[1] + dir[2] * st.pos[2])));
        const ang = d / Math.max(p.cycloneSize, 0.01);
        f += 0.35 * Math.exp(-ang * ang) * Math.abs(st.strength) * (1 - 0.35 * p.cloudWisp);
      }
      const c0 = 1 - p.cloudCover * 0.85;
      const t = (f - (c0 - 0.12)) / 0.3;
      return clamp01(t * t * (3 - 2 * t));
    },
    storms: slots,
    tick(dt: number, cloudSpeed = 1) {
      clock += dt * Math.max(cloudSpeed, 0);
      if (clock > 10000) { clock %= 10000; storms.length = 0; }
    },
    invalidate() { storms.length = 0; },
  };
}
