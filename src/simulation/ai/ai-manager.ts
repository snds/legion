// ═══════════════════════════════════════════════════════════════════
// AI MANAGER — Orchestration & Performance Budget
// Coordinates the three-layer AI architecture:
//   1. Strategic (Utility AI) — every 1-5 seconds
//   2. Tactical (Behavior Trees) — every 0.5-1 seconds
//   3. Operational (Steering) — every frame
//
// Staggered evaluation: for N Bobs, evaluate N/10 per frame
// so the full cycle completes in 10 frames. This keeps AI
// computation well within frame budget while maintaining
// responsive behavior for all agents.
// ═══════════════════════════════════════════════════════════════════

import { defineQuery, type IWorld } from 'bitecs';
import { BobState, Personality, Identity, IsLocal } from '../../core/components';
import { Events } from '../../core/events';
import { pickGoal, type GoalScore, GoalType } from './utility-scorer';
import { getTreeForGoal } from './behavior-trees';
import { bobBoards, taskBoard, TaskType, TaskStatus } from './blackboard';

// ── Queries ──────────────────────────────────────────────────────

const bobQuery = defineQuery([BobState, Personality, Identity, IsLocal]);

// ── Agent State ──────────────────────────────────────────────────

interface AgentState {
  currentGoal: GoalType;
  goalScore: number;
  lastStrategicEval: number;   // game time of last utility scoring
  lastTacticalEval: number;    // game time of last tree step
  treeState: string;           // serialized tree state
  actionInProgress: string | null;
}

const agentStates = new Map<number, AgentState>();

function getAgentState(bobEid: number): AgentState {
  let state = agentStates.get(bobEid);
  if (!state) {
    state = {
      currentGoal: GoalType.Idle,
      goalScore: 0,
      lastStrategicEval: 0,
      lastTacticalEval: 0,
      treeState: '',
      actionInProgress: null,
    };
    agentStates.set(bobEid, state);
  }
  return state;
}

// ── Evaluation Intervals ─────────────────────────────────────────

const STRATEGIC_INTERVAL = 2.0;  // seconds between utility evaluations
const TACTICAL_INTERVAL = 0.5;   // seconds between tree steps
const BOBS_PER_FRAME = 10;       // max Bobs evaluated per frame

// ── Round-Robin Scheduling ───────────────────────────────────────

let strategicOffset = 0;
let tacticalOffset = 0;

// ── Strategic Layer ──────────────────────────────────────────────

function runStrategicLayer(
  world: IWorld,
  gameTime: number,
  bobs: readonly number[],
): void {
  if (bobs.length === 0) return;

  const count = Math.min(BOBS_PER_FRAME, bobs.length);
  const start = strategicOffset % bobs.length;

  for (let i = 0; i < count; i++) {
    const idx = (start + i) % bobs.length;
    const bobEid = bobs[idx];
    const agent = getAgentState(bobEid);

    // Skip if evaluated recently
    if (gameTime - agent.lastStrategicEval < STRATEGIC_INTERVAL) continue;

    const result = pickGoal(bobEid, gameTime);
    const previousGoal = agent.currentGoal;

    agent.currentGoal = result.goal as GoalType;
    agent.goalScore = result.score;
    agent.lastStrategicEval = gameTime;

    // Update blackboard
    const memory = bobBoards.get(bobEid);
    memory.currentGoal = result.goal;

    // Emit event if goal changed
    if (previousGoal !== result.goal) {
      Events.emit('ai:goal-changed', {
        bobEid,
        from: previousGoal,
        to: result.goal,
      });
    }
  }

  strategicOffset += count;
}

// ── Tactical Layer ───────────────────────────────────────────────

function runTacticalLayer(
  world: IWorld,
  gameTime: number,
  bobs: readonly number[],
): void {
  if (bobs.length === 0) return;

  const count = Math.min(BOBS_PER_FRAME, bobs.length);
  const start = tacticalOffset % bobs.length;

  for (let i = 0; i < count; i++) {
    const idx = (start + i) % bobs.length;
    const bobEid = bobs[idx];
    const agent = getAgentState(bobEid);

    // Skip if evaluated recently
    if (gameTime - agent.lastTacticalEval < TACTICAL_INTERVAL) continue;

    agent.lastTacticalEval = gameTime;

    // Get behavior tree for current goal
    const treeDef = getTreeForGoal(agent.currentGoal);
    if (!treeDef) continue;

    // Simplified tree stepping — in production this would use
    // mistreevous BehaviourTree.step() with registered action callbacks.
    // For now, we model the decision output as task claims.
    const goalToTaskType: Record<string, TaskType> = {
      [GoalType.Explore]:   TaskType.Explore,
      [GoalType.Defend]:    TaskType.Defend,
      [GoalType.Colonize]:  TaskType.Colonize,
      [GoalType.Build]:     TaskType.Build,
      [GoalType.Research]:  TaskType.Research,
      [GoalType.Replicate]: TaskType.Replicate,
    };

    const taskType = goalToTaskType[agent.currentGoal];
    if (!taskType) continue;

    // Check if Bob already has an active task
    const memory = bobBoards.get(bobEid);
    if (memory.currentTaskId) {
      // Continue current task — no new claim needed
      continue;
    }

    // Try to claim an available task matching the current goal
    const available = taskBoard.getAvailable(taskType);
    if (available.length > 0) {
      const task = available[0];
      const claimed = taskBoard.claim(task.id, bobEid, gameTime);
      if (claimed) {
        memory.currentTaskId = task.id;
        agent.actionInProgress = task.type;

        Events.emit('ai:action-started', {
          bobEid,
          action: `${task.type}@${task.targetEid}`,
        });
      }
    }
  }

  tacticalOffset += count;
}

// ── Public API ───────────────────────────────────────────────────

export interface AIFrameContext {
  world: IWorld;
  gameTime: number;          // in-game days
  dt: number;                // wall-clock delta seconds
  timeCompression: number;   // tc factor
}

/**
 * Run all AI layers for this frame. Call once per frame from the game loop.
 * Respects performance budget through staggered evaluation.
 */
export function updateAI(ctx: AIFrameContext): void {
  if (ctx.timeCompression === 0) return; // paused

  const bobs = bobQuery(ctx.world);
  if (bobs.length === 0) return;

  // Update idle time for all Bobs
  for (const bobEid of bobs) {
    const memory = bobBoards.get(bobEid);
    if (!memory.currentTaskId) {
      memory.idleTime += ctx.dt * ctx.timeCompression;
    } else {
      memory.idleTime = 0;
    }
  }

  // Strategic: evaluate goal priorities (staggered)
  runStrategicLayer(ctx.world, ctx.gameTime, bobs);

  // Tactical: step behavior trees (staggered)
  runTacticalLayer(ctx.world, ctx.gameTime, bobs);

  // Prune completed tasks every ~10 seconds of game time
  if (Math.floor(ctx.gameTime) % 10 === 0) {
    taskBoard.prune(ctx.gameTime, 100);
  }
}

// ── Serialization ────────────────────────────────────────────────

export function serializeAIState(): Record<string, unknown> {
  return {
    agents: [...agentStates.entries()],
    strategicOffset,
    tacticalOffset,
  };
}

export function deserializeAIState(data: Record<string, unknown>): void {
  if (Array.isArray(data.agents)) {
    agentStates.clear();
    for (const [eid, state] of data.agents as [number, AgentState][]) {
      agentStates.set(eid, state);
    }
  }
  if (typeof data.strategicOffset === 'number') strategicOffset = data.strategicOffset;
  if (typeof data.tacticalOffset === 'number') tacticalOffset = data.tacticalOffset;
}

// ── Debug ────────────────────────────────────────────────────────

export function getAIDebugInfo(): {
  totalAgents: number;
  goalDistribution: Record<string, number>;
  activeActions: number;
} {
  const distribution: Record<string, number> = {};
  let activeActions = 0;

  for (const state of agentStates.values()) {
    distribution[state.currentGoal] = (distribution[state.currentGoal] ?? 0) + 1;
    if (state.actionInProgress) activeActions++;
  }

  return {
    totalAgents: agentStates.size,
    goalDistribution: distribution,
    activeActions,
  };
}
