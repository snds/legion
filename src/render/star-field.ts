// ═══════════════════════════════════════════════════════════════════
// STAR FIELD — the REAL sky from the HYG v3.8 catalog.
//
// Replaces the old random-sphere-shell fictional starfield with the actual
// 24.9k resolved stars (apparent mag ≤ 7.5), rotated to galactic coords at
// build time (scripts/build-star-catalog.mjs). Each star's DIRECTION gives
// the real constellations; per-star apparent magnitude drives point size +
// brightness, and B−V colour index drives a blackbody tint. Rendered as one
// InterleavedBuffer Points draw at a fixed large shell radius — a true-to-sky
// backdrop that the diffuse Milky Way (baked galaxy cube) sits behind.
//
// 3D-navigable parallax (real positions, not just directions) is future work;
// the packed binary already stores real parsec positions for it.
// ═══════════════════════════════════════════════════════════════════

import {
  Points, BufferGeometry, BufferAttribute, ShaderMaterial, AdditiveBlending,
} from 'three';
import { asset } from '../core/assets';

const SHELL_RADIUS = 95000; // WU — far enough to read as an infinity backdrop

const starVertexShader = /* glsl */ `
  attribute float aMag;   // apparent magnitude
  attribute float aBV;    // B−V colour index
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vBright;

  // B−V → approximate stellar RGB (blue-hot → red-cool), photometric-ish.
  vec3 bvColor(float bv){
    bv = clamp(bv, -0.35, 2.0);
    vec3 c = mix(vec3(0.61,0.71,1.00), vec3(0.79,0.86,1.00), smoothstep(-0.35,0.0,bv)); // blue→blue-white
    c = mix(c, vec3(1.00,0.97,0.94), smoothstep(0.0,0.40,bv));   // → white
    c = mix(c, vec3(1.00,0.91,0.72), smoothstep(0.40,0.80,bv));  // → yellow-white
    c = mix(c, vec3(1.00,0.80,0.55), smoothstep(0.80,1.30,bv));  // → orange
    c = mix(c, vec3(1.00,0.66,0.42), smoothstep(1.30,2.00,bv));  // → red
    return c;
  }

  void main(){
    vColor = bvColor(aBV);
    // Brightness from magnitude (Pogson): each mag = ×2.512 flux. Reference
    // mag 7.5 ≈ faint floor; brighter stars get larger & more luminous.
    float flux = pow(2.512, (7.5 - aMag));
    vBright = clamp(0.18 + log(flux + 1.0) * 0.22, 0.18, 1.6);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Fixed pixel size (no attenuation — sky backdrop), scaled by magnitude.
    gl_PointSize = clamp(1.1 + log(flux + 1.0) * 0.85, 1.1, 7.0) * uPixelRatio;
  }
`;

const starFragmentShader = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vBright;

  void main(){
    // Soft round PSF: bright tight core + gentle halo.
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = smoothstep(1.0, 0.0, d);
    float halo = smoothstep(1.0, 0.55, d) * 0.5;
    float a = (core + halo);
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * vBright, a * uOpacity);
  }
`;

export function createCatalogStars(): Points {
  const geo = new BufferGeometry();
  // Start empty; filled when the catalog binary arrives.
  geo.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));

  const mat = new ShaderMaterial({
    vertexShader: starVertexShader,
    fragmentShader: starFragmentShader,
    uniforms: {
      uOpacity: { value: 0.85 },
      // gl_PointSize is in framebuffer pixels; scale by DPR so apparent size
      // is consistent across displays (renderer caps pixelRatio at 2).
      uPixelRatio: { value: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2) },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const points = new Points(geo, mat);
  points.name = 'background-stars';
  points.frustumCulled = false; // shell surrounds the camera at all tiers

  // Async load — fill the geometry when the packed catalog arrives.
  fetch(asset('star-catalog-v1.bin'))
    .then((r) => { if (!r.ok) throw new Error(`star catalog ${r.status}`); return r.arrayBuffer(); })
    .then((ab) => {
      const data = new Float32Array(ab);          // [x,y,z(pc), mag, bv] × N
      const n = (data.length / 5) | 0;
      const pos = new Float32Array(n * 3);
      const mag = new Float32Array(n);
      const bv = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = data[i * 5], y = data[i * 5 + 1], z = data[i * 5 + 2];
        const inv = SHELL_RADIUS / Math.max(1e-6, Math.hypot(x, y, z)); // direction → fixed shell
        pos[i * 3] = x * inv; pos[i * 3 + 1] = y * inv; pos[i * 3 + 2] = z * inv;
        mag[i] = data[i * 5 + 3];
        bv[i] = data[i * 5 + 4];
      }
      const g = points.geometry;
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setAttribute('aMag', new BufferAttribute(mag, 1));
      g.setAttribute('aBV', new BufferAttribute(bv, 1));
      g.computeBoundingSphere();
      console.info(`[StarField] real sky: ${n} HYG stars loaded`);
    })
    .catch((e) => console.warn('[StarField] catalog load failed; sky uses galaxy backdrop only:', e));

  return points;
}
