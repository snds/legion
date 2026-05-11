// ═══════════════════════════════════════════════════════════════════
// COMMANDS — Serializable Game Actions (Command Pattern)
// Every game mutation is expressed as a Command object.
// Single-player: executed locally. Multiplayer: sent to server.
//
// This separation is the #1 prerequisite for adding networking
// later without rewriting game logic. All commands are:
//   1. Serializable (JSON-safe for network/save)
//   2. Deterministic (same state + command = same result)
//   3. Reversible (optional undo support)
// ═══════════════════════════════════════════════════════════════════

// ── Command Types ────────────────────────────────────────────────

export enum CommandType {
  // Fleet & Movement
  MoveFleet        = 'move_fleet',
  SetFleetFormation = 'set_fleet_formation',

  // Bob Management
  SetBobFocus      = 'set_bob_focus',
  SetBobAutonomy   = 'set_bob_autonomy',
  ReplicateBob     = 'replicate_bob',

  // Construction
  QueueBuild       = 'queue_build',
  CancelBuild      = 'cancel_build',

  // Diplomacy
  InitiateContact  = 'initiate_contact',
  SetDiplomacy     = 'set_diplomacy',

  // Time
  SetTimeSpeed     = 'set_time_speed',
  TogglePause      = 'toggle_pause',

  // System
  Save             = 'save_game',
  Load             = 'load_game',
}

// ── Command Payloads ─────────────────────────────────────────────

export interface MoveFleetPayload {
  bobEids: number[];
  targetSystemEid: number;
  route?: number[];        // pre-computed path of system eids
}

export interface SetBobFocusPayload {
  bobEid: number;
  focus: number;           // BobFocus enum
}

export interface SetBobAutonomyPayload {
  bobEid: number;
  autonomy: number;        // BobAutonomy enum
}

export interface ReplicateBobPayload {
  parentEid: number;
  name: string;
  callsign: string;
}

export interface QueueBuildPayload {
  stationEid: number;
  itemIndex: number;
}

export interface CancelBuildPayload {
  stationEid: number;
  queueIndex: number;
}

export interface SetTimeSpeedPayload {
  index: number;
}

export interface SetDiplomacyPayload {
  alienEid: number;
  stance: number;
}

// ── Command Union ────────────────────────────────────────────────

export type CommandPayload =
  | MoveFleetPayload
  | SetBobFocusPayload
  | SetBobAutonomyPayload
  | ReplicateBobPayload
  | QueueBuildPayload
  | CancelBuildPayload
  | SetTimeSpeedPayload
  | SetDiplomacyPayload
  | Record<string, never>;  // empty payload for toggle/save/load

export interface GameCommand {
  type: CommandType;
  payload: CommandPayload;
  tick: number;            // game tick when issued
  playerId?: string;       // for multiplayer attribution
  timestamp?: number;      // wall-clock time
}

// ── Command Factory ──────────────────────────────────────────────

let currentTick = 0;

export function setCommandTick(tick: number): void {
  currentTick = tick;
}

export function createCommand(
  type: CommandType,
  payload: CommandPayload,
): GameCommand {
  return {
    type,
    payload,
    tick: currentTick,
    timestamp: Date.now(),
  };
}

// ── Serialization ────────────────────────────────────────────────

export function serializeCommand(cmd: GameCommand): string {
  return JSON.stringify(cmd);
}

export function deserializeCommand(json: string): GameCommand {
  return JSON.parse(json) as GameCommand;
}
