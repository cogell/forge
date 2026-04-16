---
status: active
feature: agent-orchestration-mngr
created: 2026-04-02
completed: null
---

# PRD: forge:run as an External mngr Orchestration Script

## Problem Statement

`/forge:run` is a monolithic in-agent orchestrator: one long-running Claude Code session that must write its own checkpoint, spawn subagents via the Agent tool, manage review loops, and remember where it was — all while its context window fills up. Three failure modes compound as features get complex:

1. **Context blowout** — the orchestrating agent's context fills after several tasks. It forgets steps, does shallow reviews, or halts entirely. Restarting means re-reading the checkpoint and hoping the agent re-orients correctly.
2. **Unreliable checkpoint writing** — the agent is responsible for writing `pipeline.yaml` after each step. If it forgets, or gets cut off, the checkpoint is stale or missing. There's no external enforcement.
3. **No parallelism** — the orchestrator runs one task at a time because it's a single agent thread. Independent tasks in a phase block on each other.

The deeper issue: orchestration logic embedded in a skill prompt is fragile by nature. The agent must follow a multi-page protocol while also doing the actual work. Those two concerns don't belong in the same context window.

## Solution

Move orchestration out of the agent and into a Python script that uses mngr to manage discrete, single-purpose agents per pipeline step.

The script owns:
- Checkpoint state (reads and writes `pipeline.yaml` directly)
- Agent lifecycle (create, message, monitor, destroy via `mngr` CLI)
- Review gate loops (spawns fresh review agents, tracks pass count, spawns fix agents on FAIL)
- Error escalation (timeout handling, failure reporting)

Each step agent owns:
- One thing only: create plan.md, or review tasks.json, or run the task execution loop
- Signaling completion by writing a result file (`plans/<feature>/step-results/<step>.json`)

The script and the agents communicate through the filesystem. The script never parses transcript text.

## User Stories

### Execution

1. As a developer, I want to run `scripts/forge-run-mngr <feature>` and walk away — so the script drives the full pipeline (plan → review → tasks → review → execute → docs → PR) without me shepherding it.

2. As a developer, I want the review gate for plan and tasks to be script-managed — so the pass count and issue history are tracked in the checkpoint regardless of what happens to the step agent's context.

3. As a developer, I want review passes capped at 7 for plan and tasks — so the script doesn't loop forever if it can't converge. After 7 failed passes, the script stops and reports the unresolved issues.

4. As a developer, I want the execute step to handle its own internal task loop (including per-task review, salvage, and fix agents) — so the script only needs to wait for the execute agent to finish, not micromanage individual tasks.

### Restartability

5. As a developer, I want the script to resume from the last completed step on restart — so a crash, timeout, or manual kill doesn't require starting over.

6. As a developer, I want resume to be automatic with no confirmation prompt — when the script finds an existing checkpoint, it prints which steps are done and continues.

7. As a developer, I want `scripts/forge-run-mngr --reset <feature>` to clear the checkpoint and exit — so I can force a clean restart when the checkpoint state is stale.

### Visibility and error escalation

8. As a developer, I want to run `scripts/forge-run-mngr --status <feature>` to see which steps are complete, in-progress, or pending — without reading agent transcripts.

9. As a developer, I want the script to stop cleanly when a review gate fails at the cap — with a message showing which step failed, the unresolved issues, and what I need to do (fix manually, then re-run).

10. As a developer, I want step agents that time out to be treated as failures — so the script doesn't hang indefinitely waiting for a stalled agent.

## Implementation Decisions

### Communication via result files

Step agents signal completion by writing a JSON result file:

```
plans/<feature>/step-results/<step>.json
```

The script polls for this file (30-second interval). When the file appears, the script reads the result and decides next action. This avoids transcript parsing entirely.

Result file schema:

```json
{
  "step": "plan",
  "status": "complete" | "failed",
  "summary": "one-line description of what was done or what went wrong"
}
```

Review agent result files additionally include:

```json
{
  "step": "plan-review",
  "status": "complete",
  "verdict": "PASS" | "FAIL",
  "critical": 0,
  "major": 2,
  "minor": 1,
  "issues": [
    "major: phase 2 depends on schema migration defined in phase 3",
    "minor: acceptance criteria uses 'works correctly' — not testable"
  ]
}
```

### Review gate — script-managed

For plan and tasks, the review gate loop runs in the script, not in the step agent. Protocol:

1. After the step agent writes its result file (`complete`), the script enters the review gate
2. Script spawns a review agent via `mngr create` + `mngr message`
3. Review agent reads the artifact, classifies issues as critical/major/minor, writes result file
4. If PASS (no critical, no major): advance to next step
5. If FAIL: script spawns fix agent (receives artifact + issues from result file), waits for fix agent result, then spawns another review agent
6. Pass count increments on each review agent invocation
7. At 7 passes with no PASS: mark step `failed` in checkpoint, print unresolved issues, exit

Self-review (from `review-gates.md`) is embedded in the plan and tasks step prompts — not a separate script-managed step. The step agent runs self-review inline before writing its result file.

### Execute step — agent-managed internally

The execute step is a single mngr agent that runs the full task loop as defined in `run-process.md`: picks unblocked tasks, spawns task agents in worktrees, runs per-task review loops, writes reflections per phase, and consolidates parallel work. The script just waits for the execute agent's result file.

This keeps Phase 1 simple. The execute agent uses the Agent tool internally to spawn task/review/salvage/fix subagents — same as the current forge:run does.

### Checkpoint format

Same 7-step structure as `plans/agent-orchestrator/prd.md` — YAML at `plans/<feature>/pipeline.yaml`. The script reads and writes this directly using Python's `yaml` module. Review-gate steps store pass count and last result summary.

### mngr agent naming

- Step agents: `forge-{feature}-{step}` (e.g., `forge-my-feature-plan`)
- Review agents: `forge-{feature}-{step}-review-{n}` (e.g., `forge-my-feature-plan-review-1`)
- Fix agents: `forge-{feature}-{step}-fix-{n}`

On restart, the script destroys any in-progress agents from the prior session before re-running that step. Step names are deterministic so the script can find and clean up leftover agents.

### Local-only for Phase 1

All agents run on the local host (default mngr behavior, `@local`). Filesystem is shared — step agents write result files and artifacts to the same `plans/` directory the script reads from. Remote host support (Modal, Docker) requires file sync and is out of scope.

### Step prompt files

Each step gets a dedicated prompt at `scripts/step-prompts/<step>.md`. These are minimal: reference the relevant guidance doc, specify what to do, and end with the result file writing instruction. The fix agent prompt is assembled by the script at runtime (template with review feedback injected).

### Timeout

Default per-step timeout: 30 minutes. Configurable via `--timeout <minutes>` flag. On timeout, the script terminates the mngr agent, marks the step `failed` in the checkpoint, and exits with a clear message.

## Testing Decisions

### Script unit tests

Test checkpoint read/write/clear, result file polling logic, review gate loop state machine, and timeout handling. Use mock `mngr` subprocess calls — no real agents needed for unit tests.

### Dry-run mode

`--dry-run` flag prints the sequence of mngr commands the script would issue without creating any agents. Used for integration testing and debugging.

### Manual validation

Run the script against a small test feature end-to-end. Confirm: agents created, result files written, checkpoint updated after each step, resume from checkpoint works after kill, `--reset` clears checkpoint.

## Out of Scope

- **Remote host support** (Modal, Docker) — local-only for Phase 1
- **Parallel task execution** — execute step runs tasks sequentially; parallelism is a future phase
- **Integration into forge CLI** — standalone script in `scripts/`, not a `forge` subcommand
- **Replacing existing `/forge:run`** — both coexist; this is additive
- **Per-task checkpoint state** — task DAG already tracks individual task status; checkpoint tracks pipeline steps only
- **New review criteria** — reuses existing prompts from `review-gates.md`
- **Transcript-based signaling** — all agent communication is via result files, never transcript parsing
