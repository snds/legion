// ═══════════════════════════════════════════════════════════════════
// BEHAVIOR TREES — Tactical Decision Layer (mistreevous)
// Once the Utility AI selects a GOAL, behavior trees determine
// HOW to accomplish it. Trees are defined as JSON for rapid
// iteration and visual debugging.
//
// mistreevous features used:
//   - Guards: dynamic interruption for priority threats
//   - Lotto nodes: weighted random for personality variation
//   - Seedable RNG: deterministic replay for debugging
//
// Each goal type has a corresponding behavior tree definition.
// Trees operate on the Bob's blackboard memory for state.
// ═══════════════════════════════════════════════════════════════════

// Import types for mistreevous JSON definitions.
// Actual mistreevous import happens in ai-manager.ts at runtime.

// ── Tree Definition Types ────────────────────────────────────────

export interface TreeNode {
  type: string;
  caption?: string;
  guard?: TreeGuard;
  children?: TreeNode[];
  args?: unknown[];
  weight?: number;
}

export interface TreeGuard {
  type: 'while' | 'until';
  condition: string;       // registered condition function name
}

export interface TreeDefinition {
  type: string;
  caption: string;
  children: TreeNode[];
}

// ── Explore Tree ─────────────────────────────────────────────────

export const exploreTree: TreeDefinition = {
  type: 'root',
  caption: 'Explore',
  children: [
    {
      type: 'selector',
      caption: 'FindAndExplore',
      children: [
        // Priority: flee if under threat
        {
          type: 'sequence',
          caption: 'FleeIfThreatened',
          guard: { type: 'while', condition: 'isThreatened' },
          children: [
            { type: 'action', caption: 'FindSafeSystem', args: ['findSafeSystem'] },
            { type: 'action', caption: 'TravelToSystem', args: ['travelToTarget'] },
          ],
        },
        // Normal exploration
        {
          type: 'sequence',
          caption: 'ExploreNewSystem',
          children: [
            { type: 'action', caption: 'PickUnexploredSystem', args: ['pickExplorationTarget'] },
            { type: 'action', caption: 'TravelToSystem', args: ['travelToTarget'] },
            { type: 'action', caption: 'SurveySystem', args: ['surveyCurrentSystem'] },
            { type: 'action', caption: 'ReportFindings', args: ['reportFindings'] },
          ],
        },
        // Fallback: wander
        {
          type: 'action',
          caption: 'Wander',
          args: ['wander'],
        },
      ],
    },
  ],
};

// ── Defend Tree ──────────────────────────────────────────────────

export const defendTree: TreeDefinition = {
  type: 'root',
  caption: 'Defend',
  children: [
    {
      type: 'selector',
      caption: 'DefendOrPatrol',
      children: [
        // Active threat response
        {
          type: 'sequence',
          caption: 'RespondToThreat',
          guard: { type: 'while', condition: 'hasThreatTarget' },
          children: [
            { type: 'action', caption: 'AssessThreat', args: ['assessThreat'] },
            {
              type: 'lotto',
              caption: 'TacticalChoice',
              children: [
                {
                  type: 'sequence',
                  caption: 'EngageDirectly',
                  weight: 60,
                  children: [
                    { type: 'action', caption: 'MoveToThreat', args: ['moveToThreat'] },
                    { type: 'action', caption: 'EngageCombat', args: ['engageCombat'] },
                  ],
                },
                {
                  type: 'sequence',
                  caption: 'CallReinforcements',
                  weight: 30,
                  children: [
                    { type: 'action', caption: 'BroadcastThreat', args: ['broadcastThreat'] },
                    { type: 'action', caption: 'HoldPosition', args: ['holdPosition'] },
                  ],
                },
                {
                  type: 'sequence',
                  caption: 'StrategicRetreat',
                  weight: 10,
                  children: [
                    { type: 'action', caption: 'FindSafeSystem', args: ['findSafeSystem'] },
                    { type: 'action', caption: 'TravelToSystem', args: ['travelToTarget'] },
                  ],
                },
              ],
            },
          ],
        },
        // No active threat — patrol
        {
          type: 'sequence',
          caption: 'PatrolRoute',
          children: [
            { type: 'action', caption: 'PickPatrolTarget', args: ['pickPatrolTarget'] },
            { type: 'action', caption: 'TravelToSystem', args: ['travelToTarget'] },
            { type: 'action', caption: 'ScanForThreats', args: ['scanForThreats'] },
          ],
        },
      ],
    },
  ],
};

// ── Build Tree ───────────────────────────────────────────────────

export const buildTree: TreeDefinition = {
  type: 'root',
  caption: 'Build',
  children: [
    {
      type: 'sequence',
      caption: 'FindAndBuild',
      children: [
        { type: 'action', caption: 'PickBuildTask', args: ['pickBuildTask'] },
        { type: 'action', caption: 'TravelToSite', args: ['travelToTarget'] },
        { type: 'action', caption: 'GatherResources', args: ['gatherResources'] },
        { type: 'action', caption: 'ConstructStructure', args: ['constructStructure'] },
      ],
    },
  ],
};

// ── Colonize Tree ────────────────────────────────────────────────

export const colonizeTree: TreeDefinition = {
  type: 'root',
  caption: 'Colonize',
  children: [
    {
      type: 'sequence',
      caption: 'FindAndColonize',
      children: [
        { type: 'action', caption: 'EvaluatePlanets', args: ['evaluateColonizationTargets'] },
        { type: 'action', caption: 'TravelToSystem', args: ['travelToTarget'] },
        { type: 'action', caption: 'EstablishPresence', args: ['establishPresence'] },
        { type: 'action', caption: 'SetupInfrastructure', args: ['beginConstruction'] },
      ],
    },
  ],
};

// ── Research Tree ────────────────────────────────────────────────

export const researchTree: TreeDefinition = {
  type: 'root',
  caption: 'Research',
  children: [
    {
      type: 'selector',
      caption: 'ResearchOrStudy',
      children: [
        {
          type: 'sequence',
          caption: 'FieldResearch',
          children: [
            { type: 'action', caption: 'PickResearchTarget', args: ['pickResearchTarget'] },
            { type: 'action', caption: 'TravelToTarget', args: ['travelToTarget'] },
            { type: 'action', caption: 'ConductResearch', args: ['conductResearch'] },
            { type: 'action', caption: 'PublishFindings', args: ['publishFindings'] },
          ],
        },
        {
          type: 'action',
          caption: 'AnalyzeData',
          args: ['analyzeExistingData'],
        },
      ],
    },
  ],
};

// ── Replicate Tree ───────────────────────────────────────────────

export const replicateTree: TreeDefinition = {
  type: 'root',
  caption: 'Replicate',
  children: [
    {
      type: 'sequence',
      caption: 'PrepareAndReplicate',
      children: [
        { type: 'action', caption: 'FindResources', args: ['findReplicationResources'] },
        { type: 'action', caption: 'GatherMaterials', args: ['gatherResources'] },
        { type: 'action', caption: 'SelfReplicate', args: ['selfReplicate'] },
        { type: 'action', caption: 'MentorOffspring', args: ['mentorNewBob'] },
      ],
    },
  ],
};

// ── Tree Registry ────────────────────────────────────────────────

export const treeRegistry: Record<string, TreeDefinition> = {
  explore:   exploreTree,
  defend:    defendTree,
  build:     buildTree,
  colonize:  colonizeTree,
  research:  researchTree,
  replicate: replicateTree,
};

/**
 * Get the behavior tree definition for a given goal type.
 */
export function getTreeForGoal(goal: string): TreeDefinition | null {
  return treeRegistry[goal] ?? null;
}
