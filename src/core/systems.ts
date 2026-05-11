// ═══════════════════════════════════════════════════════════════════
// ECS SYSTEMS — Pure functions that process entity queries each frame
// Each system reads/writes specific component sets. Systems are
// stateless — all data lives in components. This enables trivial
// serialization, deterministic replay, and network sync.
//
// Systems run in a fixed order via runSystems(). Each receives
// a FrameContext with dt, game time, and shared references.
// ═══════════════════════════════════════════════════════════════════

import { defineQuery, enterQuery, exitQuery, type IWorld } from 'bitecs';
import {
  Position, Velocity, Orbit, Identity, EntityType,
  BobState, Transit, NeedsSyncToRender, IsLocal,
} from './components';
import type { Object3D } from 'three';
import { getEffectiveScale } from '../render/scale-manager';

// ── Frame Context ────────────────────────────────────────────────

export interface FrameContext {
  dt: number;                              // wall-clock delta (seconds)
  gameTime: number;                        // in-game days elapsed
  timeCompression: number;                 // tc factor (0 = paused)
  zoomLevel: number;                       // 0-100
  renderMap: Map<number, Object3D>;        // eid → Object3D
}

// ── Queries ──────────────────────────────────────────────────────

const orbitalQuery = defineQuery([Orbit, Position, IsLocal]);
const velocityQuery = defineQuery([Position, Velocity]);
const transitQuery = defineQuery([Transit, BobState]);
const transitEnter = enterQuery(transitQuery);
const transitExit = exitQuery(transitQuery);
const renderSyncQuery = defineQuery([Position, NeedsSyncToRender]);

// ── Orbital Motion System ────────────────────────────────────────

function orbitalSystem(w: IWorld, ctx: FrameContext): void {
  if (ctx.timeCompression === 0) return;

  const eids = orbitalQuery(w);
  const gameDt = ctx.dt * ctx.timeCompression; // days of game-time this frame

  // Two-pass: primary bodies first (parentEid === 0), then moons (parentEid > 0)
  // This ensures parent positions are computed before moons offset from them.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < eids.length; i++) {
      const eid = eids[i];
      const parentEid = Orbit.parentEid[eid];
      const isMoon = parentEid > 0;
      if (pass === 0 && isMoon) continue;   // skip moons on first pass
      if (pass === 1 && !isMoon) continue;  // skip primaries on second pass

      const sma = Orbit.semiMajorAxis[eid];
      const ecc = Orbit.eccentricity[eid];
      const incl = Orbit.inclination[eid];

      // Advance mean anomaly
      Orbit.meanAnomaly[eid] += Orbit.meanMotion[eid] * gameDt;

      // Solve Kepler equation (Newton-Raphson, 5 iterations)
      let M = Orbit.meanAnomaly[eid] % (Math.PI * 2);
      let E = M;
      for (let j = 0; j < 5; j++) {
        E = E - (E - ecc * Math.sin(E) - M) / (1 - ecc * Math.cos(E));
      }

      // True anomaly
      const cosE = Math.cos(E);
      const sinE = Math.sin(E);
      const nu = Math.atan2(
        Math.sqrt(1 - ecc * ecc) * sinE,
        cosE - ecc,
      );

      // Radius
      const r = sma * (1 - ecc * cosE);

      if (isMoon) {
        // Moon: sma is in parent-local visual units, not AU.
        // Position relative to parent, no AU_SCALE.
        Position.x[eid] = Position.x[parentEid] + r * Math.cos(nu);
        Position.y[eid] = Position.y[parentEid] + r * Math.sin(nu) * Math.sin(incl);
        Position.z[eid] = Position.z[parentEid] + r * Math.sin(nu) * Math.cos(incl);
      } else {
        // Primary body: position in AU, scaled
        const AU_SCALE = 10; // 1 AU = 10 world units
        Position.x[eid] = r * Math.cos(nu) * AU_SCALE;
        Position.y[eid] = r * Math.sin(nu) * Math.sin(incl) * AU_SCALE;
        Position.z[eid] = r * Math.sin(nu) * Math.cos(incl) * AU_SCALE;
      }
    }
  }
}

// ── Velocity System ──────────────────────────────────────────────

function velocitySystem(w: IWorld, ctx: FrameContext): void {
  if (ctx.timeCompression === 0) return;

  const eids = velocityQuery(w);
  const gameDt = ctx.dt * ctx.timeCompression;

  for (let i = 0; i < eids.length; i++) {
    const eid = eids[i];
    Position.x[eid] += Velocity.x[eid] * gameDt;
    Position.y[eid] += Velocity.y[eid] * gameDt;
    Position.z[eid] += Velocity.z[eid] * gameDt;
  }
}

// ── Transit System ───────────────────────────────────────────────

function transitSystem(w: IWorld, ctx: FrameContext): void {
  if (ctx.timeCompression === 0) return;

  const eids = transitQuery(w);
  const gameDt = ctx.dt * ctx.timeCompression;

  for (let i = 0; i < eids.length; i++) {
    const eid = eids[i];
    const totalDays = Transit.travelYears[eid] * 365;
    if (totalDays > 0) {
      Transit.progress[eid] += gameDt / totalDays;
      if (Transit.progress[eid] >= 1) {
        Transit.progress[eid] = 1;
        BobState.systemEid[eid] = Transit.toSystemEid[eid];
        // Transit component gets removed by AI/sim layer
      }
    }
  }

  // Log new transits
  const entering = transitEnter(w);
  for (const eid of entering) {
    const name = Identity.nameIndex[eid];
    console.info(`[Transit] Entity ${eid} (name#${name}) started transit`);
  }

  // Log completed transits
  const exiting = transitExit(w);
  for (const eid of exiting) {
    console.info(`[Transit] Entity ${eid} arrived`);
  }
}

// ── Render Sync System ───────────────────────────────────────────

const localRenderQuery = defineQuery([Position, NeedsSyncToRender, IsLocal]);

function renderSyncSystem(w: IWorld, ctx: FrameContext): void {
  const eids = renderSyncQuery(w);
  const localEids = new Set(localRenderQuery(w));
  const visualScale = getEffectiveScale();

  for (let i = 0; i < eids.length; i++) {
    const eid = eids[i];
    const obj = ctx.renderMap.get(eid);
    if (!obj) continue;

    obj.position.set(
      Position.x[eid],
      Position.y[eid],
      Position.z[eid],
    );

    // Apply visual scale to local entities (planets, star, bobs)
    if (localEids.has(eid)) {
      obj.scale.setScalar(visualScale);
    }
  }
}

// ── System Runner ────────────────────────────────────────────────

const systems = [
  orbitalSystem,
  velocitySystem,
  transitSystem,
  renderSyncSystem,
];

/**
 * Run all ECS systems in order. Called once per frame from the game loop.
 * System execution order is deterministic and matches the array above.
 */
export function runSystems(w: IWorld, ctx: FrameContext): void {
  for (const system of systems) {
    system(w, ctx);
  }
}
