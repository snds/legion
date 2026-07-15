// ═══════════════════════════════════════════════════════════════════
// CPU SIMPLEX — a faithful TypeScript port of the GLSL Ashima 3D simplex
// (glsl.ts GLSL_SIMPLEX) so the CPU bake can domain-warp the macro field with
// the EXACT SAME isotropic noise the live shader uses. This is what closes the
// baked/unbaked parity gap: warpDir() here must equal the warp in glsl.ts
// terrainHeight(). It is float-precision-identical to the GPU because the
// permutation arithmetic ( ((x*34)+1)*x , x<289 ⇒ <2.8M ) stays under 2^24,
// exact in both float32 and float64 — see knowledge ledger P-05 (value noise is
// anisotropic and was the WRONG tool for a warp field; simplex is isotropic).
//
// PURE + deterministic. Vector ops from the GLSL are expanded to scalars.
// ═══════════════════════════════════════════════════════════════════

import type { Vec3 } from './plates';

// GLSL mod(x, 289) — note this differs from JS % for negative x (floored, not truncated).
function mod289(x: number): number { return x - Math.floor(x / 289) * 289; }
// permute(x) = mod(((x*34)+1)*x, 289), component-wise.
function permute(x: number): number { return mod289((x * 34 + 1) * x); }

/** Ashima 3D simplex noise, snoise(vec3) → ~[-1,1]. Byte-for-gradient-index
 *  identical to the GLSL `snoise` in glsl.ts. */
export function snoise3(vx: number, vy: number, vz: number): number {
  const Cx = 1 / 6, Cy = 1 / 3;
  // i = floor(v + dot(v, C.yyy));   x0 = v - i + dot(i, C.xxx);
  const s = (vx + vy + vz) * Cy;
  let ix = Math.floor(vx + s), iy = Math.floor(vy + s), iz = Math.floor(vz + s);
  const t = (ix + iy + iz) * Cx;
  const x0x = vx - ix + t, x0y = vy - iy + t, x0z = vz - iz + t;

  // g = step(x0.yzx, x0.xyz); l = 1 - g;  (GLSL step(edge,x) = x>=edge?1:0)
  const gx = x0x >= x0y ? 1 : 0, gy = x0y >= x0z ? 1 : 0, gz = x0z >= x0x ? 1 : 0;
  const lx = 1 - gx, ly = 1 - gy, lz = 1 - gz;
  // i1 = min(g.xyz, l.zxy); i2 = max(g.xyz, l.zxy);
  const i1x = Math.min(gx, lz), i1y = Math.min(gy, lx), i1z = Math.min(gz, ly);
  const i2x = Math.max(gx, lz), i2y = Math.max(gy, lx), i2z = Math.max(gz, ly);

  const x1x = x0x - i1x + Cx, x1y = x0y - i1y + Cx, x1z = x0z - i1z + Cx;
  const x2x = x0x - i2x + 2 * Cx, x2y = x0y - i2y + 2 * Cx, x2z = x0z - i2z + 2 * Cx;
  const x3x = x0x - 1 + 3 * Cx, x3y = x0y - 1 + 3 * Cx, x3z = x0z - 1 + 3 * Cx;

  ix = mod289(ix); iy = mod289(iy); iz = mod289(iz);

  // p = permute(permute(permute( i.z + [0,i1.z,i2.z,1] ) + i.y + [...]) + i.x + [...])
  let p0 = permute(iz + 0), p1 = permute(iz + i1z), p2 = permute(iz + i2z), p3 = permute(iz + 1);
  p0 = permute(p0 + iy + 0); p1 = permute(p1 + iy + i1y); p2 = permute(p2 + iy + i2y); p3 = permute(p3 + iy + 1);
  p0 = permute(p0 + ix + 0); p1 = permute(p1 + ix + i1x); p2 = permute(p2 + ix + i2x); p3 = permute(p3 + ix + 1);

  const nsx = 2 / 7, nsy = 0.5 / 7 - 1, nsz = 1 / 7;

  const gradComp = (p: number): [number, number, number] => {
    const j = p - 49 * Math.floor(p * nsz * nsz);
    const xf = Math.floor(j * nsz);
    const yf = Math.floor(j - 7 * xf);
    const gx = xf * nsx + nsy;
    const gy = yf * nsx + nsy;
    const h = 1 - Math.abs(gx) - Math.abs(gy);
    return [gx, gy, h];
  };
  const [gx0, gy0, h0] = gradComp(p0);
  const [gx1, gy1, h1] = gradComp(p1);
  const [gx2, gy2, h2] = gradComp(p2);
  const [gx3, gy3, h3] = gradComp(p3);

  // Reassemble gradient vectors: p_i = vec3( a_i.xy, h_i ) after the b/s/sh dance.
  // b0=(gx0,gx1,gy0,gy1), b1=(gx2,gx3,gy2,gy3); s=floor(b)*2+1; sh=-(h<=0);
  // a0 = b0.xzyw + s0.xzyw*sh.xxyy; a1 = b1.xzyw + s1.xzyw*sh.zzww.
  const s00 = Math.floor(gx0) * 2 + 1, s01 = Math.floor(gx1) * 2 + 1, s02 = Math.floor(gy0) * 2 + 1, s03 = Math.floor(gy1) * 2 + 1;
  const s10 = Math.floor(gx2) * 2 + 1, s11 = Math.floor(gx3) * 2 + 1, s12 = Math.floor(gy2) * 2 + 1, s13 = Math.floor(gy3) * 2 + 1;
  const sh0 = 0 >= h0 ? -1 : 0, sh1 = 0 >= h1 ? -1 : 0, sh2 = 0 >= h2 ? -1 : 0, sh3 = 0 >= h3 ? -1 : 0;
  // a0.xyzw = (b0.x+s0.x*sh.x, b0.z+s0.z*sh.x, b0.y+s0.y*sh.y, b0.w+s0.w*sh.y)
  //   b0.x=gx0,b0.z=gy0,b0.y=gx1,b0.w=gy1 ; s0 same order ; sh.xxyy=(sh0,sh0,sh1,sh1)
  let n0x = gx0 + s00 * sh0, n0y = gy0 + s02 * sh0, n0z = h0;
  let n1x = gx1 + s01 * sh1, n1y = gy1 + s03 * sh1, n1z = h1;
  //   b1.x=gx2,b1.z=gy2,b1.y=gx3,b1.w=gy3 ; sh.zzww=(sh2,sh2,sh3,sh3)
  let n2x = gx2 + s10 * sh2, n2y = gy2 + s12 * sh2, n2z = h2;
  let n3x = gx3 + s11 * sh3, n3y = gy3 + s13 * sh3, n3z = h3;

  // norm = taylorInvSqrt(dot(p_i,p_i)); p_i *= norm_i
  const inv = (r: number): number => 1.79284291400159 - 0.85373472095314 * r;
  const nr0 = inv(n0x * n0x + n0y * n0y + n0z * n0z);
  const nr1 = inv(n1x * n1x + n1y * n1y + n1z * n1z);
  const nr2 = inv(n2x * n2x + n2y * n2y + n2z * n2z);
  const nr3 = inv(n3x * n3x + n3y * n3y + n3z * n3z);
  n0x *= nr0; n0y *= nr0; n0z *= nr0;
  n1x *= nr1; n1y *= nr1; n1z *= nr1;
  n2x *= nr2; n2y *= nr2; n2z *= nr2;
  n3x *= nr3; n3y *= nr3; n3z *= nr3;

  // m = max(0.6 - dot(xi,xi), 0)^2 ; return 42 * dot(m*m, dot(p_i, x_i))
  let m0 = Math.max(0.6 - (x0x * x0x + x0y * x0y + x0z * x0z), 0);
  let m1 = Math.max(0.6 - (x1x * x1x + x1y * x1y + x1z * x1z), 0);
  let m2 = Math.max(0.6 - (x2x * x2x + x2y * x2y + x2z * x2z), 0);
  let m3 = Math.max(0.6 - (x3x * x3x + x3y * x3y + x3z * x3z), 0);
  m0 *= m0; m1 *= m1; m2 *= m2; m3 *= m3;
  const d0 = n0x * x0x + n0y * x0y + n0z * x0z;
  const d1 = n1x * x1x + n1y * x1y + n1z * x1z;
  const d2 = n2x * x2x + n2y * x2y + n2z * x2z;
  const d3 = n3x * x3x + n3y * x3y + n3z * x3z;
  return 42 * (m0 * m0 * d0 + m1 * m1 * d1 + m2 * m2 * d2 + m3 * m3 * d3);
}

/** 6-octave fBm of snoise — mirrors GLSL `fbm(vec3)`. ~[-1,1]. */
export function fbm3(px: number, py: number, pz: number): number {
  let f = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 6; i++) {
    f += amp * snoise3(px * freq, py * freq, pz * freq);
    freq *= 2; amp *= 0.5;
  }
  return f;
}

/**
 * Domain-warp a unit direction — the EXACT mirror of glsl.ts terrainHeight()'s
 * macro warp (`wdir`), so the CPU bake and the live shader place continents,
 * coasts and plate boundaries identically. `seed` is the body's uNoiseSeed.
 */
export function warpDir(dir: Vec3, warp: number, seed: Vec3): Vec3 {
  if (warp <= 0) return dir;
  const px = dir[0] * 1.7 + seed[0], py = dir[1] * 1.7 + seed[1], pz = dir[2] * 1.7 + seed[2];
  const lo0 = fbm3(px * 0.6 + 11.3, py * 0.6 + 11.3, pz * 0.6 + 11.3);
  const lo1 = fbm3(px * 0.6 + 47.7, py * 0.6 + 47.7, pz * 0.6 + 47.7);
  const lo2 = fbm3(px * 0.6 + 83.1, py * 0.6 + 83.1, pz * 0.6 + 83.1);
  const hi0 = fbm3(px * 2.3 + 5.1, py * 2.3 + 5.1, pz * 2.3 + 5.1);
  const hi1 = fbm3(px * 2.3 + 27.9, py * 2.3 + 27.9, pz * 2.3 + 27.9);
  const hi2 = fbm3(px * 2.3 + 61.4, py * 2.3 + 61.4, pz * 2.3 + 61.4);
  const wx = dir[0] + warp * (0.55 * lo0 + 0.18 * hi0);
  const wy = dir[1] + warp * (0.55 * lo1 + 0.18 * hi1);
  const wz = dir[2] + warp * (0.55 * lo2 + 0.18 * hi2);
  const l = Math.hypot(wx, wy, wz) || 1;
  return [wx / l, wy / l, wz / l];
}
