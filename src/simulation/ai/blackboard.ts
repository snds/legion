// ═══════════════════════════════════════════════════════════════════
// BLACKBOARD — Shared Knowledge Architecture for Multi-Bob AI
// Three-level blackboard prevents duplicate work and enables
// emergent coordination between independent Bob agents.
//
// Levels:
//   Global  — Known systems, threat map, faction standings
//   PerBob  — Personal goals, discoveries, current task
//   Tasks   — Available/claimed work items with ownership
//
// Pattern proven in Killzone 3 squad AI and documented in
// Game AI Pro. All data is JSON-serializable for save/load.
// ═══════════════════════════════════════════════════════════════════

// ── Task Definition ──────────────────────────────────────────────

export enum TaskStatus {
  Available = 0,
  Claimed   = 1,
  Active    = 2,
  Complete  = 3,
  Failed    = 4,
}

export enum TaskType {
  Explore     = 'explore',
  Colonize    = 'colonize',
  Build       = 'build',
  Defend      = 'defend',
  Research    = 'research',
  Trade       = 'trade',
  Replicate   = 'replicate',
  Scout       = 'scout',
  Patrol      = 'patrol',
}

export interface Task {
  id: string;
  type: TaskType;
  targetEid: number;        // system/planet/location eid
  priority: number;         // 0-100, higher = more urgent
  status: TaskStatus;
  claimedBy: number | null; // bob eid
  claimedAt: number | null; // game time when claimed
  data: Record<string, unknown>;
}

// ── Global Blackboard ────────────────────────────────────────────

interface ThreatEntry {
  systemEid: number;
  type: string;
  severity: number;       // 0-1
  detectedAt: number;     // game time
  confirmedBy: number[];  // bob eids that verified
}

interface SystemKnowledge {
  eid: number;
  explored: boolean;
  exploredBy: number | null;
  exploredAt: number | null;
  planetCount: number;
  threatLevel: number;
  resources: number;
  notes: string[];
}

class GlobalBlackboard {
  knownSystems = new Map<number, SystemKnowledge>();
  threats = new Map<number, ThreatEntry>();
  factionStandings = new Map<string, number>(); // faction → -1 to 1

  /** Register a newly discovered system */
  registerSystem(eid: number, data: Partial<SystemKnowledge>): void {
    const existing = this.knownSystems.get(eid);
    this.knownSystems.set(eid, {
      eid,
      explored: false,
      exploredBy: null,
      exploredAt: null,
      planetCount: 0,
      threatLevel: 0,
      resources: 0,
      notes: [],
      ...existing,
      ...data,
    });
  }

  /** Record a threat at a location */
  reportThreat(systemEid: number, type: string, severity: number, reporterEid: number, gameTime: number): void {
    const existing = this.threats.get(systemEid);
    if (existing) {
      existing.severity = Math.max(existing.severity, severity);
      if (!existing.confirmedBy.includes(reporterEid)) {
        existing.confirmedBy.push(reporterEid);
      }
    } else {
      this.threats.set(systemEid, {
        systemEid,
        type,
        severity,
        detectedAt: gameTime,
        confirmedBy: [reporterEid],
      });
    }
  }

  /** Get unexplored systems sorted by distance priority */
  getUnexploredSystems(): SystemKnowledge[] {
    return [...this.knownSystems.values()]
      .filter(s => !s.explored);
  }

  /** Get threatened systems sorted by severity */
  getThreatenedSystems(): ThreatEntry[] {
    return [...this.threats.values()]
      .sort((a, b) => b.severity - a.severity);
  }

  // ── Serialization ──

  serialize(): Record<string, unknown> {
    return {
      knownSystems: [...this.knownSystems.entries()],
      threats: [...this.threats.entries()],
      factionStandings: [...this.factionStandings.entries()],
    };
  }

  deserialize(data: Record<string, unknown>): void {
    if (Array.isArray(data.knownSystems)) {
      this.knownSystems = new Map(data.knownSystems as [number, SystemKnowledge][]);
    }
    if (Array.isArray(data.threats)) {
      this.threats = new Map(data.threats as [number, ThreatEntry][]);
    }
    if (Array.isArray(data.factionStandings)) {
      this.factionStandings = new Map(data.factionStandings as [string, number][]);
    }
  }
}

// ── Per-Bob Blackboard ───────────────────────────────────────────

export interface BobMemory {
  currentGoal: string | null;
  currentTaskId: string | null;
  visitedSystems: number[];
  discoveries: Array<{ systemEid: number; type: string; gameTime: number }>;
  lastCombatTime: number;
  morale: number;             // 0-1, affects decision curves
  idleTime: number;           // time since last meaningful action
}

class BobBlackboards {
  private boards = new Map<number, BobMemory>();

  get(bobEid: number): BobMemory {
    let memory = this.boards.get(bobEid);
    if (!memory) {
      memory = {
        currentGoal: null,
        currentTaskId: null,
        visitedSystems: [],
        discoveries: [],
        lastCombatTime: 0,
        morale: 1.0,
        idleTime: 0,
      };
      this.boards.set(bobEid, memory);
    }
    return memory;
  }

  set(bobEid: number, memory: BobMemory): void {
    this.boards.set(bobEid, memory);
  }

  remove(bobEid: number): void {
    this.boards.delete(bobEid);
  }

  serialize(): [number, BobMemory][] {
    return [...this.boards.entries()];
  }

  deserialize(data: [number, BobMemory][]): void {
    this.boards = new Map(data);
  }
}

// ── Task Board ───────────────────────────────────────────────────

class TaskBoard {
  private tasks = new Map<string, Task>();
  private nextId = 0;

  /** Create a new task. Returns the task ID. */
  post(type: TaskType, targetEid: number, priority: number, data: Record<string, unknown> = {}): string {
    const id = `task_${this.nextId++}`;
    this.tasks.set(id, {
      id,
      type,
      targetEid,
      priority,
      status: TaskStatus.Available,
      claimedBy: null,
      claimedAt: null,
      data,
    });
    return id;
  }

  /** Claim a task for a Bob. Returns false if already claimed. */
  claim(taskId: string, bobEid: number, gameTime: number): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== TaskStatus.Available) return false;

    task.status = TaskStatus.Claimed;
    task.claimedBy = bobEid;
    task.claimedAt = gameTime;
    return true;
  }

  /** Mark a task as actively being worked on */
  activate(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task && task.status === TaskStatus.Claimed) {
      task.status = TaskStatus.Active;
    }
  }

  /** Mark a task as complete */
  complete(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = TaskStatus.Complete;
    }
  }

  /** Release a claimed task back to available */
  release(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = TaskStatus.Available;
      task.claimedBy = null;
      task.claimedAt = null;
    }
  }

  /** Get available tasks sorted by priority */
  getAvailable(filterType?: TaskType): Task[] {
    return [...this.tasks.values()]
      .filter(t =>
        t.status === TaskStatus.Available &&
        (filterType === undefined || t.type === filterType),
      )
      .sort((a, b) => b.priority - a.priority);
  }

  /** Get tasks claimed by a specific Bob */
  getTasksForBob(bobEid: number): Task[] {
    return [...this.tasks.values()]
      .filter(t => t.claimedBy === bobEid);
  }

  /** Check if a target already has an active task of a given type */
  hasActiveTask(targetEid: number, type: TaskType): boolean {
    return [...this.tasks.values()].some(
      t => t.targetEid === targetEid &&
           t.type === type &&
           (t.status === TaskStatus.Available || t.status === TaskStatus.Claimed || t.status === TaskStatus.Active),
    );
  }

  /** Clean up completed/failed tasks older than threshold */
  prune(gameTime: number, maxAge: number): void {
    for (const [id, task] of this.tasks) {
      if (
        (task.status === TaskStatus.Complete || task.status === TaskStatus.Failed) &&
        task.claimedAt !== null &&
        (gameTime - task.claimedAt) > maxAge
      ) {
        this.tasks.delete(id);
      }
    }
  }

  serialize(): [string, Task][] {
    return [...this.tasks.entries()];
  }

  deserialize(data: [string, Task][]): void {
    this.tasks = new Map(data);
    // Restore nextId
    let maxId = 0;
    for (const [id] of data) {
      const num = parseInt(id.replace('task_', ''), 10);
      if (num > maxId) maxId = num;
    }
    this.nextId = maxId + 1;
  }
}

// ── Singleton Exports ────────────────────────────────────────────

export const globalBoard = new GlobalBlackboard();
export const bobBoards = new BobBlackboards();
export const taskBoard = new TaskBoard();

// ── Aggregate Serialization ──────────────────────────────────────

export function serializeBlackboards(): Record<string, unknown> {
  return {
    global: globalBoard.serialize(),
    bobs: bobBoards.serialize(),
    tasks: taskBoard.serialize(),
  };
}

export function deserializeBlackboards(data: Record<string, unknown>): void {
  if (data.global) globalBoard.deserialize(data.global as Record<string, unknown>);
  if (data.bobs) bobBoards.deserialize(data.bobs as [number, BobMemory][]);
  if (data.tasks) taskBoard.deserialize(data.tasks as [string, Task][]);
}
