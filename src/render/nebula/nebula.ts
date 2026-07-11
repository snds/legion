// ═══════════════════════════════════════════════════════════════════
// NEBULA — reusable rendering primitive (stellar-phenomena plan, P1).
//
// A nebula is a stack of nested iso-density SHELL meshes (Orlando's INAF
// technique: multilayer iso-density surfaces at graduated opacities) tinted by
// a physically-motivated line-emission ramp — [OIII] teal at the hot/dense
// core, H-alpha red across the broader ionized gas, dust as an absorption
// term. The shells approximate the emission volume at real-time cost without
// per-pixel raymarching (reserved for future "hero" objects).
//
// This module is the PRIMITIVE only: it owns geometry + material + the typed
// parameter schema, and is deliberately decoupled from the galaxy tier (its
// sole engine import is WU_PER_PC for authoring in parsecs). The galaxy-tier
// wiring — real galPos placement, floating-origin re-rooting, zoom LOD gating —
// lives in test-nebula.ts. Everything here is DETERMINISTIC from `seed`
// (mulberry32/seedFrom), so a given params object always yields byte-identical
// shells (locked by nebula.test.ts).
//
// Designed for the later phases: `galPosPc` accepts real Edenhofer/WISE-catalog
// positions; `colorMix`/`density` are the archetype parameters the procedural
// generator (P4) will sample from fitted distributions.
// ═══════════════════════════════════════════════════════════════════

import {
  AdditiveBlending, Color, Group, IcosahedronGeometry, Mesh, ShaderMaterial, Vector3,
} from 'three';
import { WU_PER_PC } from '../../core/metrics';
import { mulberry32, seedFrom } from '../../data/system-gen';
import { nebulaVertexShader, nebulaFragmentShader } from './nebula-shader';

/** A galactocentric position in parsecs (Sgr A* at the origin) — the same
 *  float64 frame curated systems use via `galPos()`. Real (catalog) or
 *  procedurally generated. */
export interface NebulaVec3 {
  x: number;
  y: number;
  z: number;
}

/** Line-emission balance — physically the ratio of [OIII]/H-alpha emission and
 *  dust extinction. Colors default to the real line wavelengths; strengths let
 *  the archetype library push a nebula toward reflection-blue, dark-dusty, etc. */
export interface NebulaColorMix {
  /** [OIII] 500.7nm — teal-green, hottest/most-ionized gas near the source. */
  oiii?: number;
  /** H-alpha 656.3nm — deep red, the broad ionized envelope. */
  halpha?: number;
  /** Dust extinction tint (the absorption term's residual scatter color). */
  dust?: number;
  oiiiStrength?: number;
  halphaStrength?: number;
  dustStrength?: number;
}

/** The typed, reusable parameter schema. `galPosPc` + `radiusPc` place and size
 *  the object in real units; `seed` makes it deterministic; `colorMix` + LOD
 *  fields tune the look. Later phases feed this from the dust map / HII catalog. */
export interface NebulaParams {
  /** Galactocentric center, parsecs. */
  galPosPc: NebulaVec3;
  /** Characteristic radius, parsecs (the outer shell's radius). */
  radiusPc: number;
  /** Number of nested iso-density shells (≥ 2). */
  shellCount: number;
  /** Deterministic density-field seed (string identity or numeric). */
  seed: string | number;
  /** Emission/absorption balance. */
  colorMix?: NebulaColorMix;
  /** Overall emission gain (default 1). */
  brightness?: number;
  /** Fraction of `radiusPc` the innermost (core) shell occupies (default 0.34). */
  coreFraction?: number;
  /** Optional label for the scene-graph node. */
  name?: string;
}

/** Deterministic per-shell authored spec. Pure function of the params — this is
 *  what the determinism test snapshots (the GLSL is a downstream mirror). */
export interface NebulaShellSpec {
  /** 0 (core) → 1 (outer). */
  t: number;
  /** Shell radius, world units. */
  radiusWU: number;
  /** Base coverage/opacity (denser toward the core). */
  opacity: number;
  /** Emission ramp param passed to the shader (teal→red→dust). */
  colorT: number;
  /** Domain-warp strength (outer shells more filamentary). */
  warp: number;
  /** Vertex displacement as a fraction of radius (raggedness). */
  warpAmp: number;
  /** Field frequency over the unit sphere. */
  freq: number;
  /** Icosphere subdivision level. */
  detail: number;
  /** Deterministic per-shell field offset. */
  seed: [number, number, number];
}

const DEFAULT_COLORS = {
  oiii: 0x2fe6c8,   // teal-green [OIII]
  halpha: 0xff2d3a, // deep red H-alpha
  dust: 0x2a1408,   // dark red-brown dust
} as const;

/** Physically-motivated defaults: [OIII] slightly weaker than H-alpha (real HII
 *  regions are H-alpha dominated overall, [OIII] concentrated in the hot core). */
const DEFAULT_MIX: Required<NebulaColorMix> = {
  oiii: DEFAULT_COLORS.oiii,
  halpha: DEFAULT_COLORS.halpha,
  dust: DEFAULT_COLORS.dust,
  oiiiStrength: 1.15,
  halphaStrength: 1.0,
  dustStrength: 1.3,
};

function smoothClamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Derive the deterministic shell stack from params. Pure + snapshot-locked. */
export function buildShellSpecs(params: NebulaParams): NebulaShellSpec[] {
  const shellCount = Math.max(2, Math.floor(params.shellCount));
  const coreFraction = params.coreFraction ?? 0.34;
  const rOuterWU = params.radiusPc * WU_PER_PC;
  const rng = mulberry32(seedFrom(`nebula|${params.seed}|${shellCount}`));

  const specs: NebulaShellSpec[] = [];
  for (let i = 0; i < shellCount; i++) {
    const t = i / (shellCount - 1); // 0 core → 1 outer
    // Radius grows core→outer; opacity falls off so the core reads brightest
    // and the envelope is a faint haze (graduated opacities = the technique).
    const radiusWU = rOuterWU * (coreFraction + (1 - coreFraction) * t);
    const opacity = smoothClamp01(0.9 * Math.pow(1 - t, 1.6) + 0.06);
    // Outer shells: more warp + displacement + finer frequency → ragged wisps;
    // core shells smoother + rounder → a bright compact heart.
    const warp = 0.4 + 0.9 * t;
    const warpAmp = 0.14 + 0.30 * t;
    const freq = 1.6 + 2.2 * t;
    const detail = t < 0.5 ? 4 : 5;
    specs.push({
      t,
      radiusWU,
      opacity,
      colorT: t,
      warp,
      warpAmp,
      freq,
      detail,
      seed: [rng() * 100, rng() * 100, rng() * 100],
    });
  }
  return specs;
}

export interface NebulaHandle {
  /** Scene node — parent under the galactic tier; position it per frame. */
  group: Group;
  /** The (defaulted) params this nebula was built from. */
  readonly params: NebulaParams;
  /** Absolute center, galactocentric parsecs (for placement math). */
  readonly galPosPc: Readonly<Vector3>;
  /** Set the zoom-LOD gate [0..1]; 0 hides the whole nebula. */
  setPresence(v: number): void;
  /** Advance the subtle drift animation by `dtSeconds`. */
  advance(dtSeconds: number): void;
  /** Free GPU resources. */
  dispose(): void;
}

/** Build a nebula primitive: a Group of nested iso-density shell meshes. */
export function createNebula(params: NebulaParams): NebulaHandle {
  const mix = { ...DEFAULT_MIX, ...(params.colorMix ?? {}) };
  const brightness = params.brightness ?? 1;
  const specs = buildShellSpecs(params);

  const group = new Group();
  group.name = params.name ?? `nebula|${params.seed}`;

  const oiii = new Color(mix.oiii);
  const halpha = new Color(mix.halpha);
  const dust = new Color(mix.dust);
  const materials: ShaderMaterial[] = [];

  for (const spec of specs) {
    const geo = new IcosahedronGeometry(1, spec.detail); // unit sphere; radius via uniform
    const mat = new ShaderMaterial({
      vertexShader: nebulaVertexShader,
      fragmentShader: nebulaFragmentShader,
      uniforms: {
        uRadius: { value: spec.radiusWU },
        uWarp: { value: spec.warp },
        uWarpAmp: { value: spec.warpAmp },
        uFreq: { value: spec.freq },
        uSeed: { value: new Vector3(spec.seed[0], spec.seed[1], spec.seed[2]) },
        uTime: { value: 0 },
        uPresence: { value: 0 }, // hidden until the LOD gate raises it
        uBrightness: { value: brightness },
        uOpacity: { value: spec.opacity },
        uColorT: { value: spec.colorT },
        uOIII: { value: oiii.clone() },
        uHalpha: { value: halpha.clone() },
        uDust: { value: dust.clone() },
        uOIIIStr: { value: mix.oiiiStrength },
        uHalphaStr: { value: mix.halphaStrength },
        uDustStr: { value: mix.dustStrength },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const mesh = new Mesh(geo, mat);
    mesh.name = `${group.name}|shell${specs.indexOf(spec)}`;
    mesh.raycast = () => {}; // diffuse volume — never pickable
    mesh.frustumCulled = false; // large, group re-rooted per frame
    group.add(mesh);
    materials.push(mat);
  }

  const galPosPc = new Vector3(params.galPosPc.x, params.galPosPc.y, params.galPosPc.z);
  let time = 0;

  return {
    group,
    params,
    galPosPc,
    setPresence(v: number): void {
      const p = smoothClamp01(v);
      for (const mat of materials) mat.uniforms.uPresence.value = p;
      group.visible = p > 0.003;
    },
    advance(dtSeconds: number): void {
      time += dtSeconds;
      for (const mat of materials) mat.uniforms.uTime.value = time;
    },
    dispose(): void {
      for (const child of group.children) {
        const m = child as Mesh;
        m.geometry.dispose();
        (m.material as ShaderMaterial).dispose();
      }
    },
  };
}
