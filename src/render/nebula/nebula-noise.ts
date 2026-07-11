// ═══════════════════════════════════════════════════════════════════
// NEBULA NOISE — deterministic value-noise + fBm, TS ↔ GLSL 1:1 mirror.
//
// The nebula primitive samples a procedural density field both on the CPU
// (determinism tests, rejection-free authoring) and on the GPU (the shell
// fragment shader). To keep the two honest, the value-noise → fBm helpers
// live here ONCE: `nbHash3/nbValueNoise3/nbFbm3` (TS) and `nebulaNoiseGLSL`
// (the byte-for-byte GLSL mirror of the same bodies).
//
// The implementation is the project's canonical hash-value-noise (identical
// shape to galaxy-density.ts's gdHash3/gdValueNoise3/gdFbm3), deliberately
// re-declared under an `nb*` namespace so the reusable primitive carries no
// dependency on the galaxy-specific density module. If either the TS body or
// the GLSL string is edited structurally, the other MUST change in the same
// commit (the vitest determinism snapshot locks the TS side).
// ═══════════════════════════════════════════════════════════════════

const fract = (x: number): number => x - Math.floor(x);
const smooth = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Hash of an integer lattice cell → [0,1). Matches the GLSL `nbHash3`. */
export function nbHash3(x: number, y: number, z: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
}

/** Trilinearly-interpolated value noise in [0,1]. Matches GLSL `nbValueNoise3`. */
export function nbValueNoise3(px: number, py: number, pz: number): number {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const ux = smooth(px - ix), uy = smooth(py - iy), uz = smooth(pz - iz);
  const c000 = nbHash3(ix, iy, iz);
  const c100 = nbHash3(ix + 1, iy, iz);
  const c010 = nbHash3(ix, iy + 1, iz);
  const c110 = nbHash3(ix + 1, iy + 1, iz);
  const c001 = nbHash3(ix, iy, iz + 1);
  const c101 = nbHash3(ix + 1, iy, iz + 1);
  const c011 = nbHash3(ix, iy + 1, iz + 1);
  const c111 = nbHash3(ix + 1, iy + 1, iz + 1);
  const x00 = lerp(c000, c100, ux), x10 = lerp(c010, c110, ux);
  const x01 = lerp(c001, c101, ux), x11 = lerp(c011, c111, ux);
  return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz);
}

/** 4-octave fBm in [0,1] (normalised). Matches GLSL `nbFbm3`. */
export function nbFbm3(px: number, py: number, pz: number): number {
  let v = 0, a = 0.5, fq = 1;
  for (let i = 0; i < 4; i++) {
    v += a * nbValueNoise3(px * fq, py * fq, pz * fq);
    a *= 0.5; fq *= 2;
  }
  return v / 0.9375; // Σ a = 0.5+0.25+0.125+0.0625
}

/** Domain-warped fBm (the ecency recipe): perturb the sample point by two fBm
 *  lookups before sampling density, killing banding and yielding filaments.
 *  `warp` scales the offset (0 = none). Matches GLSL `nbWarpedFbm3`. */
export function nbWarpedFbm3(px: number, py: number, pz: number, warp: number): number {
  const wx = nbFbm3(px * 3, py * 3, pz * 3);
  const wy = nbFbm3(px * 3 + 5, py * 3 + 5, pz * 3 + 5);
  const wz = nbFbm3(px * 3 + 9, py * 3 + 9, pz * 3 + 9);
  return nbFbm3(px + wx * warp * 0.2, py + wy * warp * 0.2, pz + wz * warp * 0.2);
}

/** The GLSL mirror of the four functions above. Consumed by nebula-shader.ts;
 *  bodies are 1:1 with the TS versions (see MIRROR note in the file header). */
export const nebulaNoiseGLSL = /* glsl */ `
  float nbHash3(vec3 i) {
    return fract(sin(i.x * 127.1 + i.y * 311.7 + i.z * 74.7) * 43758.5453);
  }
  float nbValueNoise3(vec3 p) {
    vec3 i = floor(p);
    vec3 fr = p - i;
    vec3 u = fr * fr * (3.0 - 2.0 * fr);
    float c000 = nbHash3(i);
    float c100 = nbHash3(i + vec3(1.0, 0.0, 0.0));
    float c010 = nbHash3(i + vec3(0.0, 1.0, 0.0));
    float c110 = nbHash3(i + vec3(1.0, 1.0, 0.0));
    float c001 = nbHash3(i + vec3(0.0, 0.0, 1.0));
    float c101 = nbHash3(i + vec3(1.0, 0.0, 1.0));
    float c011 = nbHash3(i + vec3(0.0, 1.0, 1.0));
    float c111 = nbHash3(i + vec3(1.0, 1.0, 1.0));
    float x00 = mix(c000, c100, u.x), x10 = mix(c010, c110, u.x);
    float x01 = mix(c001, c101, u.x), x11 = mix(c011, c111, u.x);
    return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
  }
  float nbFbm3(vec3 p) {
    float v = 0.0, a = 0.5, fq = 1.0;
    for (int i = 0; i < 4; i++) {
      v += a * nbValueNoise3(p * fq);
      a *= 0.5; fq *= 2.0;
    }
    return v / 0.9375;
  }
  // Domain warp (ecency): uv += vec2(fbm(p*3), fbm(p*3+5))*0.2 before sampling.
  float nbWarpedFbm3(vec3 p, float warp) {
    vec3 w = vec3(
      nbFbm3(p * 3.0),
      nbFbm3(p * 3.0 + 5.0),
      nbFbm3(p * 3.0 + 9.0)
    );
    return nbFbm3(p + w * warp * 0.2);
  }
`;
