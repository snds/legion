// ═══════════════════════════════════════════════════════════════════
// ACTIVE REGIONS — the star's magnetic architecture (S2+).
//
// Solar activity is organised around bipolar ACTIVE REGIONS: a pair of
// opposite-polarity sunspots joined by arching CORONAL LOOPS of hot plasma that
// trace the magnetic field. Flares and CMEs erupt from these regions where the
// field tangles and reconnects (solarscience.msfc.nasa.gov/research/3d_fields,
// spaceplace.nasa.gov/solar-activity). This module is the single source of that
// structure, all deterministic from the star seed:
//
//   • footpoints  → fed to the SURFACE shader as dark umbra + bright plage
//     (so the spots and the loops share the same magnetic anchor), and
//   • coronal loops (this file) → additive plasma-flowing arcs between each
//     region's footpoints, brightening on a seeded flare schedule, with a
//     radial CME burst on the strongest flares.
//
// Everything rides the star body (object space, body-radius units) so it
// inherits the star group's SYSTEM_TIER_SCALE + floating origin and LODs away
// with the disc (uDetailFade). Count + violence scale with the record's
// magnetic `activity` / `flareRate` (young cool dwarfs churn; O/B are quiet).
// ═══════════════════════════════════════════════════════════════════

import {
  AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, Group,
  LineSegments, Points, ShaderMaterial, Vector3, type Camera,
} from 'three';
import { mulberry32 } from '../../data/system-gen';
import { kelvinToRGB } from './kelvin';
import { flareRate, type StarRecord } from './star-physics';

/** Hard caps (also the fixed loop bound in the surface shader — keep in sync). */
export const MAX_REGIONS = 5;
export const MAX_FOOTPOINTS = MAX_REGIONS * 2;

const LOOPS_PER_REGION = 8;
const SEGMENTS = 22;              // arc resolution
const CME_PARTICLES = 60;

export interface ActiveRegionField {
  /** Parent under the star group; carries loops + CME particles. */
  group: Group;
  /** Footpoint unit directions (object space), MAX_FOOTPOINTS×vec3, for the surface shader. */
  readonly footDir: Float32Array;
  /** Per-footpoint strength ∈[0,1] (0 = unused slot). */
  readonly footStr: Float32Array;
  /** Active footpoint count (≤ MAX_FOOTPOINTS). */
  readonly footCount: number;
  /** Per-frame: advance plasma flow, flares, CME; fade with the disc. */
  update(time: number, camera: Camera, detailFade: number): void;
  dispose(): void;
}

const _v = new Vector3();
const _axis = new Vector3();

/** Rotate `v` around unit `axis` by `angle` (Rodrigues), in place into `out`. */
function rotateAround(v: Vector3, axis: Vector3, angle: number, out: Vector3): Vector3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  const dot = axis.dot(v);
  // v*cos + (axis×v)*sin + axis*(axis·v)*(1-cos)
  const cx = axis.y * v.z - axis.z * v.y;
  const cy = axis.z * v.x - axis.x * v.z;
  const cz = axis.x * v.y - axis.y * v.x;
  return out.set(
    v.x * c + cx * s + axis.x * dot * (1 - c),
    v.y * c + cy * s + axis.y * dot * (1 - c),
    v.z * c + cz * s + axis.z * dot * (1 - c),
  );
}

/** Great-circle interpolation from unit a→b at t (bulge is applied by caller). */
function slerpUnit(a: Vector3, b: Vector3, t: number, out: Vector3): Vector3 {
  const d = Math.max(-1, Math.min(1, a.dot(b)));
  const ang = Math.acos(d);
  if (ang < 1e-4) return out.copy(a);
  const s = Math.sin(ang);
  const wa = Math.sin((1 - t) * ang) / s;
  const wb = Math.sin(t * ang) / s;
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb).normalize();
}

interface Region {
  footA: Vector3; footB: Vector3;
  strength: number;
  flarePhase: number; flareRate: number;
  cmePhase: number; cmeRate: number; cmeAxis: Vector3;
}

// ── Loop shader — additive arcs with travelling plasma + flare brightening ──
const loopVert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aT;        // 0..1 along the loop
attribute float aSeed;     // per-loop phase
attribute float aFlare;    // per-region flare level (JS-updated)
uniform float uTime;
uniform float uDetailFade;
varying float vBright;
varying float vT;
void main() {
  vT = aT;
  // Plasma clumps travel along the field line; a soft base keeps the loop lit.
  float wave = sin((aT * 3.0 - uTime * 0.5 + aSeed) * 6.2831853);
  float plasma = 0.55 + 0.90 * pow(max(wave, 0.0), 3.0);
  // Footpoints (aT→0,1) always glow hotter/brighter than the apex.
  float foot = pow(abs(aT - 0.5) * 2.0, 2.0);
  vBright = (plasma * (0.7 + 0.5 * foot) + aFlare * 3.0) * uDetailFade;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;
const loopFrag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColorHot;    // footpoint colour (hot)
uniform vec3 uColorCool;   // apex colour (cooler)
varying float vBright;
varying float vT;
void main() {
  #include <logdepthbuf_fragment>
  if (vBright < 0.001) discard;
  float foot = pow(abs(vT - 0.5) * 2.0, 1.5);
  vec3 col = mix(uColorCool, uColorHot, foot) * vBright;
  gl_FragColor = vec4(col, 1.0); // additive
}
`;

// ── CME shader — radial particle burst on the strongest flares ──
const cmeVert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aDir;       // outward direction (object space)
attribute float aRegion;   // which region's cme phase drives this particle
attribute float aRand;     // 0..1 spread
uniform float uTime;
uniform float uDetailFade;
uniform float uCmePhase[${MAX_REGIONS}];   // 0..1 expansion, resets each burst
uniform float uCmeStr[${MAX_REGIONS}];
uniform float uRs;
varying float vAlpha;
void main() {
  int ri = int(aRegion + 0.5);
  float phase = 0.0; float str = 0.0;
  for (int i = 0; i < ${MAX_REGIONS}; i++) {
    if (i == ri) { phase = uCmePhase[i]; str = uCmeStr[i]; }
  }
  // Expand from the surface outward; fade over the burst lifetime.
  float dist = uRs * (1.0 + phase * (2.2 + aRand * 2.0));
  vec3 p = aDir * dist;
  vAlpha = str * (1.0 - phase) * (1.0 - phase) * uDetailFade;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = mix(2.0, 5.0, aRand) * (1.0 - 0.5 * phase);
  #include <logdepthbuf_vertex>
}
`;
const cmeFrag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
varying float vAlpha;
void main() {
  #include <logdepthbuf_fragment>
  if (vAlpha < 0.002) discard;
  vec2 d = gl_PointCoord - 0.5;
  float g = smoothstep(0.5, 0.0, length(d));
  gl_FragColor = vec4(uColor * vAlpha * g, 1.0); // additive
}
`;

/** Build the magnetic active-region field for a star record. */
export function createActiveRegions(record: StarRecord, bodyRadiusWU: number): ActiveRegionField {
  const group = new Group();
  group.name = 'star-active-regions';
  const Rs = bodyRadiusWU;
  const rate = flareRate(record); // 0 (O/B, quiet) → 1 (young M/K)

  // Region count scales with magnetic activity; an active star keeps ≥2 so the
  // limb usually shows a loop as the star rotates.
  const count = rate > 0.03 ? Math.max(2, Math.round(rate * MAX_REGIONS)) : 0;
  const rng = mulberry32(record.seed ^ 0x5bd1e995);

  const regions: Region[] = [];
  const footDir = new Float32Array(MAX_FOOTPOINTS * 3);
  const footStr = new Float32Array(MAX_FOOTPOINTS);
  let footCount = 0;

  for (let i = 0; i < count; i++) {
    // Region centre — uniform on the sphere.
    const u = rng() * 2 - 1;
    const th = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    const center = new Vector3(r * Math.cos(th), u, r * Math.sin(th));
    // A tangent direction → the bipolar axis; footpoints straddle the centre.
    const tRef = Math.abs(center.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const tangent = _v.copy(tRef).cross(center).normalize().clone();
    const sep = 0.14 + rng() * 0.16; // angular half-separation (rad)
    const footA = rotateAround(center, tangent, sep, new Vector3()).normalize();
    const footB = rotateAround(center, tangent, -sep, new Vector3()).normalize();
    const strength = 0.5 + 0.5 * rng();
    regions.push({
      footA, footB, strength,
      flarePhase: rng() * Math.PI * 2,
      flareRate: 0.12 + rng() * 0.5,
      cmePhase: rng(), cmeRate: 0.02 + rng() * 0.05,
      cmeAxis: center.clone(),
    });
    // Publish footpoints for the surface shader (both spots of the pair).
    for (const f of [footA, footB]) {
      footDir[footCount * 3] = f.x; footDir[footCount * 3 + 1] = f.y; footDir[footCount * 3 + 2] = f.z;
      footStr[footCount] = strength;
      footCount++;
    }
  }

  // ── Build loop geometry (all regions in one LineSegments) ──
  const positions: number[] = [];
  const aT: number[] = [];
  const aSeed: number[] = [];
  const aFlareRegion: number[] = []; // region index per vertex → maps to aFlare each frame
  const pA = new Vector3(), pB = new Vector3(), prev = new Vector3(), cur = new Vector3();

  regions.forEach((reg, ri) => {
    for (let l = 0; l < LOOPS_PER_REGION; l++) {
      const lf = LOOPS_PER_REGION > 1 ? l / (LOOPS_PER_REGION - 1) : 0.5; // 0..1 across the fan
      // Tall enough that the arch clears the limb (reads against dark sky) — the
      // classic coronal-loop silhouette rather than lines lost on the bright disc.
      const height = Rs * (0.22 + 0.85 * Math.sin(Math.PI * lf) + 0.12 * rng()); // apex height
      const twist = (lf - 0.5) * 0.55; // fan the loops sideways around the A–B axis
      const seed = rng() * 6.2831;
      _axis.copy(reg.footA).cross(reg.footB).normalize();
      for (let s = 0; s <= SEGMENTS; s++) {
        const t = s / SEGMENTS;
        slerpUnit(reg.footA, reg.footB, t, cur);
        if (twist !== 0) rotateAround(cur, _axis, twist * Math.sin(Math.PI * t), cur);
        const h = Math.sin(Math.PI * t) * height;
        cur.multiplyScalar(Rs + h);
        if (s > 0) {
          positions.push(prev.x, prev.y, prev.z, cur.x, cur.y, cur.z);
          aT.push((s - 1) / SEGMENTS, t);
          aSeed.push(seed, seed);
          aFlareRegion.push(ri, ri);
        }
        prev.copy(cur);
      }
    }
  });

  const loopGeo = new BufferGeometry();
  loopGeo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  loopGeo.setAttribute('aT', new Float32BufferAttribute(aT, 1));
  loopGeo.setAttribute('aSeed', new Float32BufferAttribute(aSeed, 1));
  const flareAttr = new Float32BufferAttribute(new Float32Array(aFlareRegion.length), 1);
  flareAttr.setUsage(35048); // DynamicDraw
  loopGeo.setAttribute('aFlare', flareAttr);

  const hot = kelvinToRGB(Math.min(record.tempK * 1.5, 12000));
  const cool = kelvinToRGB(Math.min(record.tempK, 6500));
  const loopMat = new ShaderMaterial({
    vertexShader: loopVert, fragmentShader: loopFrag,
    transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: true,
    uniforms: {
      uTime: { value: 0 },
      uDetailFade: { value: 1 },
      uColorHot: { value: new Color(hot[0], hot[1], hot[2]) },
      uColorCool: { value: new Color(cool[0] * 1.1, cool[1] * 0.7, cool[2] * 0.45) }, // reddened apex
    },
  });
  const loops = count > 0 ? new LineSegments(loopGeo, loopMat) : null;
  if (loops) { loops.frustumCulled = false; loops.renderOrder = 2; group.add(loops); }

  // ── CME particles (one buffer, region-indexed) ──
  const cmePos: number[] = []; const cmeDir: number[] = []; const cmeReg: number[] = []; const cmeRand: number[] = [];
  regions.forEach((reg, ri) => {
    for (let p = 0; p < CME_PARTICLES; p++) {
      // Spread in a cone around the region's radial axis.
      const spread = 0.5;
      const uu = 1 - rng() * spread;
      const ph = rng() * Math.PI * 2;
      const rr = Math.sqrt(Math.max(0, 1 - uu * uu));
      const local = _v.set(rr * Math.cos(ph), uu, rr * Math.sin(ph));
      // Orient the cone's +y to the region axis.
      const dir = orientToAxis(local, reg.cmeAxis).normalize();
      cmePos.push(0, 0, 0);
      cmeDir.push(dir.x, dir.y, dir.z);
      cmeReg.push(ri);
      cmeRand.push(rng());
    }
  });
  const cmeGeo = new BufferGeometry();
  cmeGeo.setAttribute('position', new Float32BufferAttribute(cmePos, 3));
  cmeGeo.setAttribute('aDir', new Float32BufferAttribute(cmeDir, 3));
  cmeGeo.setAttribute('aRegion', new Float32BufferAttribute(cmeReg, 1));
  cmeGeo.setAttribute('aRand', new Float32BufferAttribute(cmeRand, 1));
  const cmeMat = new ShaderMaterial({
    vertexShader: cmeVert, fragmentShader: cmeFrag,
    transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: true,
    uniforms: {
      uTime: { value: 0 }, uDetailFade: { value: 1 }, uRs: { value: Rs },
      uColor: { value: new Color(1.4, 0.6, 0.3) },
      uCmePhase: { value: new Array(MAX_REGIONS).fill(0) },
      uCmeStr: { value: new Array(MAX_REGIONS).fill(0) },
    },
  });
  const cme = count > 0 ? new Points(cmeGeo, cmeMat) : null;
  if (cme) { cme.frustumCulled = false; cme.renderOrder = 2; group.add(cme); }

  const flareArr = flareAttr.array as Float32Array;
  const cmePhaseU: number[] = cmeMat.uniforms.uCmePhase.value;
  const cmeStrU: number[] = cmeMat.uniforms.uCmeStr.value;

  function update(time: number, _camera: Camera, detailFade: number): void {
    if (loops) {
      loopMat.uniforms.uTime.value = time;
      loopMat.uniforms.uDetailFade.value = detailFade;
      // Per-region flare level (sharp, infrequent) → per-vertex aFlare.
      let vi = 0;
      for (let s = 0; s < aFlareRegion.length; s++) {
        const reg = regions[aFlareRegion[s]];
        const cyc = Math.sin(time * reg.flareRate + reg.flarePhase) * 0.5 + 0.5;
        flareArr[vi++] = Math.pow(cyc, 6) * reg.strength * rate;
      }
      flareAttr.needsUpdate = true;
    }
    if (cme) {
      cmeMat.uniforms.uTime.value = time;
      cmeMat.uniforms.uDetailFade.value = detailFade;
      for (let i = 0; i < regions.length; i++) {
        const reg = regions[i];
        // A burst every ~1/cmeRate; only the strong ones actually eject.
        const raw = (time * reg.cmeRate + reg.cmePhase) % 1;
        cmePhaseU[i] = raw;
        cmeStrU[i] = reg.strength * rate * 1.3;
      }
    }
  }

  function dispose(): void {
    loopGeo.dispose(); loopMat.dispose();
    cmeGeo.dispose(); cmeMat.dispose();
  }

  return { group, footDir, footStr, footCount, update, dispose };
}

/** Rotate a cone sample (whose +y is the axis) onto an arbitrary unit axis. */
function orientToAxis(local: Vector3, axis: Vector3): Vector3 {
  const up = new Vector3(0, 1, 0);
  const d = up.dot(axis);
  if (d > 0.9999) return local.clone();
  if (d < -0.9999) return local.clone().multiplyScalar(-1);
  const rotAxis = new Vector3().crossVectors(up, axis).normalize();
  const angle = Math.acos(Math.max(-1, Math.min(1, d)));
  return rotateAround(local, rotAxis, angle, new Vector3());
}
