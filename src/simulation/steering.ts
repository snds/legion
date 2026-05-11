// ═══════════════════════════════════════════════════════════════════
// STEERING — Fleet Movement & Formation (Yuka)
// Intra-system fleet movement using steering behaviors.
// Virtual Leader pattern: invisible leader follows the path,
// individual ships maintain formation positions via Offset Pursuit.
//
// Yuka is engine-agnostic — we bridge agent positions to ECS
// Position components via the same sync pattern as Three.js.
// ═══════════════════════════════════════════════════════════════════

import {
  Vehicle, ArriveBehavior, OffsetPursuitBehavior,
  SeparationBehavior, CohesionBehavior, AlignmentBehavior,
  PursuitBehavior, EvadeBehavior, EntityManager, Vector3 as YVector3,
} from 'yuka';
import { Position, Velocity } from '../core/components';

// ── Fleet Manager ────────────────────────────────────────────────

export interface FleetConfig {
  leaderEid: number;        // Bob entity leading the fleet
  memberEids: number[];     // All member entity IDs
  destination: { x: number; y: number; z: number };
  speed: number;            // max speed (world units/day)
  formationType: FormationType;
}

export enum FormationType {
  Wedge    = 'wedge',
  Line     = 'line',
  Diamond  = 'diamond',
  Sphere   = 'sphere',
}

interface Fleet {
  id: number;
  leader: Vehicle;
  members: Map<number, Vehicle>;  // eid → Vehicle
  formationType: FormationType;
  arrived: boolean;
}

// ── Entity Manager ───────────────────────────────────────────────

const entityManager = new EntityManager();
const activeFleets = new Map<number, Fleet>();
let nextFleetId = 0;

// ── Formation Offsets ────────────────────────────────────────────

function getFormationOffset(
  index: number,
  total: number,
  type: FormationType,
  spacing = 8,
): YVector3 {
  switch (type) {
    case FormationType.Wedge: {
      const row = Math.floor(Math.sqrt(index));
      const col = index - row * row;
      const xOff = (col - row / 2) * spacing;
      const zOff = -row * spacing;
      return new YVector3(xOff, 0, zOff);
    }

    case FormationType.Line: {
      const xOff = (index - (total - 1) / 2) * spacing;
      return new YVector3(xOff, 0, 0);
    }

    case FormationType.Diamond: {
      const angle = (index / total) * Math.PI * 2;
      const radius = spacing * Math.ceil(index / 4);
      return new YVector3(
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius,
      );
    }

    case FormationType.Sphere: {
      // Fibonacci sphere distribution
      const phi = Math.acos(1 - 2 * (index + 0.5) / total);
      const theta = Math.PI * (1 + Math.sqrt(5)) * index;
      const r = spacing * 2;
      return new YVector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      );
    }
  }
}

// ── Fleet Creation ───────────────────────────────────────────────

/**
 * Create a fleet with formation movement toward a destination.
 * Returns a fleet ID for tracking.
 */
export function createFleet(config: FleetConfig): number {
  const fleetId = nextFleetId++;

  // Create virtual leader
  const leader = new Vehicle();
  leader.maxSpeed = config.speed;
  leader.position.set(
    Position.x[config.leaderEid],
    Position.y[config.leaderEid],
    Position.z[config.leaderEid],
  );

  // Arrive behavior: smooth deceleration at destination
  const arriveBehavior = new ArriveBehavior(
    new YVector3(config.destination.x, config.destination.y, config.destination.z),
    3,   // deceleration rate
    20,  // arrival tolerance
  );
  leader.steering.add(arriveBehavior);
  entityManager.add(leader);

  // Create member vehicles with offset pursuit
  const members = new Map<number, Vehicle>();

  config.memberEids.forEach((eid, index) => {
    const vehicle = new Vehicle();
    vehicle.maxSpeed = config.speed * 0.95; // slightly slower than leader
    vehicle.position.set(
      Position.x[eid],
      Position.y[eid],
      Position.z[eid],
    );

    // Offset Pursuit: maintain formation position relative to leader
    const offset = getFormationOffset(
      index,
      config.memberEids.length,
      config.formationType,
    );
    const offsetPursuit = new OffsetPursuitBehavior(leader, offset);
    offsetPursuit.weight = 1.0;
    vehicle.steering.add(offsetPursuit);

    // Separation: avoid collisions between fleet members
    const separation = new SeparationBehavior();
    separation.weight = 0.5;
    vehicle.steering.add(separation);

    entityManager.add(vehicle);
    members.set(eid, vehicle);
  });

  const fleet: Fleet = {
    id: fleetId,
    leader,
    members,
    formationType: config.formationType,
    arrived: false,
  };

  activeFleets.set(fleetId, fleet);
  return fleetId;
}

/**
 * Disband a fleet, removing all steering behaviors.
 */
export function disbandFleet(fleetId: number): void {
  const fleet = activeFleets.get(fleetId);
  if (!fleet) return;

  entityManager.remove(fleet.leader);
  for (const vehicle of fleet.members.values()) {
    entityManager.remove(vehicle);
  }
  activeFleets.delete(fleetId);
}

/**
 * Change a fleet's destination mid-flight.
 */
export function redirectFleet(
  fleetId: number,
  destination: { x: number; y: number; z: number },
): void {
  const fleet = activeFleets.get(fleetId);
  if (!fleet) return;

  // Update the arrive behavior target
  const arriveBehavior = fleet.leader.steering.behaviors[0];
  if (arriveBehavior instanceof ArriveBehavior) {
    arriveBehavior.target = new YVector3(
      destination.x, destination.y, destination.z,
    );
  }
  fleet.arrived = false;
}

// ── Frame Update ─────────────────────────────────────────────────

/**
 * Update all active fleets and sync positions to ECS components.
 * Call once per frame.
 *
 * @param dt - Wall-clock delta in seconds
 * @param tc - Time compression factor
 */
export function updateSteering(dt: number, tc: number): void {
  if (tc === 0 || activeFleets.size === 0) return;

  const gameDt = dt * tc;

  // Step Yuka entity manager
  entityManager.update(gameDt);

  // Sync Yuka positions → ECS components
  for (const fleet of activeFleets.values()) {
    // Check if leader has arrived
    const leaderVel = fleet.leader.velocity;
    if (leaderVel.length() < 0.01) {
      fleet.arrived = true;
    }

    // Sync each member
    for (const [eid, vehicle] of fleet.members) {
      Position.x[eid] = vehicle.position.x;
      Position.y[eid] = vehicle.position.y;
      Position.z[eid] = vehicle.position.z;

      Velocity.x[eid] = vehicle.velocity.x;
      Velocity.y[eid] = vehicle.velocity.y;
      Velocity.z[eid] = vehicle.velocity.z;
    }
  }
}

// ── Queries ──────────────────────────────────────────────────────

export function getFleet(fleetId: number): Fleet | undefined {
  return activeFleets.get(fleetId);
}

export function hasFleetArrived(fleetId: number): boolean {
  return activeFleets.get(fleetId)?.arrived ?? false;
}

export function getActiveFleetCount(): number {
  return activeFleets.size;
}

// ── Serialization ────────────────────────────────────────────────

export function serializeSteering(): Record<string, unknown> {
  const fleets: Record<string, unknown>[] = [];

  for (const fleet of activeFleets.values()) {
    const memberPositions: Record<number, { x: number; y: number; z: number }> = {};
    for (const [eid, vehicle] of fleet.members) {
      memberPositions[eid] = {
        x: vehicle.position.x,
        y: vehicle.position.y,
        z: vehicle.position.z,
      };
    }

    fleets.push({
      id: fleet.id,
      formationType: fleet.formationType,
      arrived: fleet.arrived,
      leaderPos: {
        x: fleet.leader.position.x,
        y: fleet.leader.position.y,
        z: fleet.leader.position.z,
      },
      memberPositions,
    });
  }

  return { fleets, nextFleetId };
}
