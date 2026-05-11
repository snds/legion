// ═══════════════════════════════════════════════════════════════════
// UTILITY AI — Personality-Driven Strategic Goal Scoring
// Top-level AI decision layer. Evaluates competing goals (explore,
// colonize, defend, build, research, trade) using response curves
// parameterized by each Bob's personality traits.
//
// An aggressive Bob scores "attack" higher; a curious Bob scores
// "explore" higher. This mirrors Stellaris's ai_weight system
// with base + modifier blocks driven by empire personality.
//
// Response curves shape how raw inputs map to desirability scores.
// Personality traits modify curve parameters, producing graduated
// rather than binary behavior differences between Bobs.
// ═══════════════════════════════════════════════════════════════════

import { Personality, BobState, BobFocus } from '../../core/components';
import { globalBoard, bobBoards, taskBoard, TaskType } from './blackboard';

// ── Response Curve Types ─────────────────────────────────────────

export enum CurveType {
  Linear     = 'linear',
  Quadratic  = 'quadratic',
  Logistic   = 'logistic',
  Inverse    = 'inverse',
  Step       = 'step',
}

export interface ResponseCurve {
  type: CurveType;
  slope: number;       // steepness
  shift: number;       // horizontal offset (0-1)
  exponent: number;    // power modifier
  clampMin: number;    // output floor
  clampMax: number;    // output ceiling
}

/** Evaluate a response curve for input value t (0-1) */
function evaluateCurve(curve: ResponseCurve, t: number): number {
  const x = Math.max(0, Math.min(1, t));
  let y: number;

  switch (curve.type) {
    case CurveType.Linear:
      y = curve.slope * (x - curve.shift);
      break;

    case CurveType.Quadratic:
      y = curve.slope * Math.pow(x - curve.shift, curve.exponent);
      break;

    case CurveType.Logistic:
      y = 1 / (1 + Math.exp(-curve.slope * (x - curve.shift)));
      break;

    case CurveType.Inverse:
      y = 1 - (1 / (1 + curve.slope * Math.pow(x, curve.exponent)));
      break;

    case CurveType.Step:
      y = x >= curve.shift ? curve.clampMax : curve.clampMin;
      break;

    default:
      y = x;
  }

  return Math.max(curve.clampMin, Math.min(curve.clampMax, y));
}

// ── Goal Definitions ─────────────────────────────────────────────

export enum GoalType {
  Explore   = 'explore',
  Colonize  = 'colonize',
  Defend    = 'defend',
  Build     = 'build',
  Research  = 'research',
  Trade     = 'trade',
  Replicate = 'replicate',
  Idle      = 'idle',
}

export interface GoalScore {
  goal: GoalType;
  score: number;           // 0-1 final utility
  reasoning: string;       // human-readable explanation
}

// ── Consideration Functions ──────────────────────────────────────
// Each consideration evaluates one axis of the decision space.
// Returns 0-1 representing how much this factor favors the goal.

interface Consideration {
  name: string;
  weight: number;
  evaluate: (bobEid: number, gameTime: number) => number;
}

function makeConsiderations(goal: GoalType): Consideration[] {
  switch (goal) {
    case GoalType.Explore:
      return [
        {
          name: 'unexplored_systems',
          weight: 0.4,
          evaluate: () => {
            const unexplored = globalBoard.getUnexploredSystems().length;
            const total = globalBoard.knownSystems.size || 1;
            return Math.min(1, unexplored / total);
          },
        },
        {
          name: 'curiosity_trait',
          weight: 0.35,
          evaluate: (bobEid) => Personality.curiosity[bobEid],
        },
        {
          name: 'idle_time',
          weight: 0.25,
          evaluate: (bobEid) => {
            const mem = bobBoards.get(bobEid);
            return Math.min(1, mem.idleTime / 100); // 100 day idle = max
          },
        },
      ];

    case GoalType.Defend:
      return [
        {
          name: 'threat_level',
          weight: 0.45,
          evaluate: () => {
            const threats = globalBoard.getThreatenedSystems();
            if (threats.length === 0) return 0;
            return threats[0].severity;
          },
        },
        {
          name: 'aggression_trait',
          weight: 0.3,
          evaluate: (bobEid) => Personality.aggression[bobEid],
        },
        {
          name: 'caution_inverse',
          weight: 0.25,
          evaluate: (bobEid) => 1 - Personality.caution[bobEid],
        },
      ];

    case GoalType.Colonize:
      return [
        {
          name: 'habitable_planets',
          weight: 0.4,
          evaluate: () => {
            // Favor colonization when explored systems have habitable planets
            let habitable = 0;
            for (const sys of globalBoard.knownSystems.values()) {
              if (sys.explored && sys.resources > 0.5) habitable++;
            }
            return Math.min(1, habitable / 5);
          },
        },
        {
          name: 'sociability_trait',
          weight: 0.35,
          evaluate: (bobEid) => Personality.sociability[bobEid],
        },
        {
          name: 'available_tasks',
          weight: 0.25,
          evaluate: () => {
            const tasks = taskBoard.getAvailable(TaskType.Colonize);
            return tasks.length > 0 ? 0.8 : 0.1;
          },
        },
      ];

    case GoalType.Build:
      return [
        {
          name: 'infrastructure_need',
          weight: 0.45,
          evaluate: (bobEid) => {
            const systemEid = BobState.systemEid[bobEid];
            // Simplified: check if current system has build tasks
            return taskBoard.hasActiveTask(systemEid, TaskType.Build) ? 0.3 : 0.7;
          },
        },
        {
          name: 'focus_industrial',
          weight: 0.3,
          evaluate: (bobEid) => {
            return BobState.focusType[bobEid] === BobFocus.Industrial ? 0.9 : 0.4;
          },
        },
        {
          name: 'independence_trait',
          weight: 0.25,
          evaluate: (bobEid) => Personality.independence[bobEid] * 0.5 + 0.25,
        },
      ];

    case GoalType.Research:
      return [
        {
          name: 'curiosity_trait',
          weight: 0.5,
          evaluate: (bobEid) => Personality.curiosity[bobEid],
        },
        {
          name: 'focus_research',
          weight: 0.3,
          evaluate: (bobEid) => {
            return BobState.focusType[bobEid] === BobFocus.Research ? 0.9 : 0.3;
          },
        },
        {
          name: 'discovery_momentum',
          weight: 0.2,
          evaluate: (bobEid) => {
            const mem = bobBoards.get(bobEid);
            // Recent discoveries boost research motivation
            const recent = mem.discoveries.filter(d => d.gameTime > 0).length;
            return Math.min(1, recent / 10);
          },
        },
      ];

    case GoalType.Replicate:
      return [
        {
          name: 'health_level',
          weight: 0.3,
          evaluate: (bobEid) => {
            return BobState.health[bobEid] > 80 ? 0.8 : 0.2;
          },
        },
        {
          name: 'system_count_need',
          weight: 0.4,
          evaluate: () => {
            const unexplored = globalBoard.getUnexploredSystems().length;
            // More unexplored systems = more need for replication
            return Math.min(1, unexplored / 20);
          },
        },
        {
          name: 'independence_trait',
          weight: 0.3,
          evaluate: (bobEid) => Personality.independence[bobEid],
        },
      ];

    case GoalType.Trade:
      return [
        {
          name: 'sociability_trait',
          weight: 0.5,
          evaluate: (bobEid) => Personality.sociability[bobEid],
        },
        {
          name: 'alien_contact',
          weight: 0.5,
          evaluate: () => {
            // Favor trade when friendly factions exist
            let friendlyCount = 0;
            for (const standing of globalBoard.factionStandings.values()) {
              if (standing > 0.3) friendlyCount++;
            }
            return Math.min(1, friendlyCount / 3);
          },
        },
      ];

    default:
      return [
        {
          name: 'baseline',
          weight: 1,
          evaluate: () => 0.1,
        },
      ];
  }
}

// ── Scorer ───────────────────────────────────────────────────────

const ALL_GOALS: GoalType[] = [
  GoalType.Explore,
  GoalType.Colonize,
  GoalType.Defend,
  GoalType.Build,
  GoalType.Research,
  GoalType.Replicate,
  GoalType.Trade,
];

/**
 * Score all goals for a Bob entity and return sorted results.
 * The highest-scoring goal is the one the Bob should pursue.
 */
export function scoreGoals(bobEid: number, gameTime: number): GoalScore[] {
  const results: GoalScore[] = [];

  for (const goal of ALL_GOALS) {
    const considerations = makeConsiderations(goal);
    let totalScore = 0;
    let totalWeight = 0;
    const parts: string[] = [];

    for (const c of considerations) {
      const raw = c.evaluate(bobEid, gameTime);
      const weighted = raw * c.weight;
      totalScore += weighted;
      totalWeight += c.weight;
      parts.push(`${c.name}=${raw.toFixed(2)}×${c.weight}`);
    }

    // Normalize by total weight
    const normalized = totalWeight > 0 ? totalScore / totalWeight : 0;

    results.push({
      goal,
      score: normalized,
      reasoning: parts.join(', '),
    });
  }

  // Sort descending by score
  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Get the single best goal for a Bob.
 * Includes a small random factor to prevent all Bobs from
 * choosing identically when scores are close (weighted by humor trait).
 */
export function pickGoal(bobEid: number, gameTime: number): GoalScore {
  const scores = scoreGoals(bobEid, gameTime);
  const humor = Personality.humor[bobEid];

  // Add personality-scaled noise to top choices
  const jittered = scores.map(s => ({
    ...s,
    score: s.score + (Math.random() * 0.1 * humor),
  }));

  jittered.sort((a, b) => b.score - a.score);
  return jittered[0];
}
