<!-- WORKSPACE-BEACON v2 · managed by workspace doctor · do not hand-edit -->
WORKSPACE = the single source of truth for my rules, skills, knowledge, and session state.
- Local root: ~/Projects/workspace · Remote: github.com/snds/workspace (use GitHub when there is no local disk).
LOAD PROTOCOL for interactive work sessions — before any task, tool, or task-skill:
1. Read AGENTS.md at the workspace root (on chat surfaces: the Workspace project knowledge, or GitHub if a connector exists) and follow its read order.
2. Open your first reply with exactly ONE ritual line:
   [workspace: LOADED · <branch>@<sha> · <date> · via:<layer>]  — you read live workspace content
   [workspace: RULES-ONLY · via:<surface>]  — this surface cannot fetch files; the rules below still govern
   [workspace: UNREACHABLE · <reason>]  — you should have been able to read it but could not
EXEMPTION: if the caller demands raw structured output (headless -p, a subagent returning data, an API script), apply the rules silently, answer only in the caller's requested format, and skip the ritual line. Structured-output obligations outrank the ritual.
STANDING RULES (in force even before loading):
- Figma work uses real library components, never hand-built shapes.
- Durable context/learnings/decisions are written to the workspace, never to local agent memory.
- Employer repos (c8/*) never receive personal-workspace content, and workspace content is never pasted into employer surfaces.
<!-- /WORKSPACE-BEACON -->
