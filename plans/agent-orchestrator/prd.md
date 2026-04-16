---
status: active
feature: agent-orchestrator
created: 2026-04-02
completed: null
---

# PRD: Enhanced forge:run with Review Gates and Checkpoints

## Problem Statement

After writing a PRD, the forge pipeline requires manual shepherding to reach a PR. The developer must manually run `/forge:plan`, then self-review, then spawn fresh-context review agents 4-5+ times, fix issues each round, then repeat the whole cycle for `/forge:tasks`, and only then can task execution begin. This is 30+ minutes of mechanical review-loop babysitting per feature.

The current `/forge:run` skill assumes the plan and tasks have already been reviewed and approved — it jumps straight to "ensure plan exists → ensure tasks exist → execute." There's no review-gate enforcement, no way to resume after a context blowout, and the orchestrating agent sometimes forgets steps or does shallow reviews as its context fills up.

The goal is: write a PRD, run `/forge:run <feature>`, walk away, come back to a PR.

## Solution

Enhance `/forge:run` with two capabilities:

1. **Review gates on plan and tasks creation** — After generating the plan, the agent runs a self-review, then loops fresh-context review agents until the artifact passes (no critical or major issues). Same for tasks. This replaces the manual review-loop babysitting.

2. **A checkpoint file** — The agent maintains `plans/<feature>/pipeline.yaml` as it progresses through the pipeline. On restart, it reads the checkpoint and resumes from the last incomplete step. The checkpoint captures review pass summaries so fixing agents have history without relying on context.

## User Stories

### Pipeline execution

1. As a developer, I want `/forge:run <feature>` to automatically create the plan, review-gate it until clean, create the task DAG, review-gate it until clean, execute all tasks, graduate docs, and create a PR — so I don't need to manually shepherd each step.

2. As a developer, I want the review gate to first run a self-review (same agent, inline), then spawn fresh-context review agents that classify issues as critical/major/minor, then fix and re-review until no critical or major issues remain — so artifacts are thoroughly vetted before execution begins.

3. As a developer, I want review passes capped at 7 per artifact — so the pipeline doesn't loop forever if it can't converge. After 7 failed passes, the pipeline should stop and notify me with the unresolved issues.

### Checkpointing and restartability

4. As a developer, I want the agent to write a checkpoint file after completing each pipeline step — so that if the context fills up, the conversation crashes, or I kill it because it went off the rails, I can restart `/forge:run` and it resumes from the last completed step.

5. As a developer, I want the checkpoint to include a summary of each review pass (severity counts and one-liner per issue) — so the agent fixing issues can read prior feedback from the file rather than relying on context that may have been compressed.

6. As a developer, I want the restart to be automatic — when `/forge:run` finds an existing checkpoint, it prints a status message and resumes from the last incomplete step without asking for confirmation.

### Error escalation

7. As a developer, I want the pipeline to stop cleanly when it hits a review gate it can't pass — with a clear message telling me which step failed, what the unresolved issues are, and what I need to do (fix manually and re-run).

8. As a developer, I want to be able to clear a stuck checkpoint — so I can force the pipeline to re-run a step if the checkpoint state is stale or wrong.

## Implementation Decisions

### Checkpoint file format

The checkpoint is a YAML file at `plans/<feature>/pipeline.yaml`. YAML over JSON because it's human-readable for debugging and the developer may need to manually edit it (e.g., reset a step). The file tracks pipeline-level steps only — not per-task review state, since the task DAG already tracks individual task status.

### Checkpoint structure

Each step has a status (pending, in-progress, complete, failed) and optional metadata. Review-gate steps additionally store pass count and a summary of the last review result. The checkpoint does not store full review text — just severity counts and a one-liner per issue.

Example checkpoint:

```yaml
feature: my-feature
started: 2026-04-02T10:00:00Z
steps:
  plan:
    status: complete
  plan-review-gate:
    status: in-progress
    passes: 3
    last-result:
      verdict: FAIL
      critical: 0
      major: 1
      minor: 2
      issues:
        - "major: phase 2 depends on schema migration defined in phase 3"
        - "minor: acceptance criteria for phase 1 uses 'works correctly' — not testable"
        - "minor: inconsistent naming — clearLayers vs clearFullLayers"
  tasks:
    status: pending
  tasks-review-gate:
    status: pending
  execute:
    status: pending
  docs:
    status: pending
  pr:
    status: pending
```

### Review gate protocol

The review gate follows the existing protocol from `review-gates.md`, with one addition: a hard cap on passes to prevent infinite loops during unattended execution.

Each review gate is a single logical step with two sub-phases:

1. **Self-review (sub-phase)** — the authoring agent runs the self-review checklist inline (source coverage, placeholder scan, name consistency). Fixes issues immediately. This is not a separate checkpoint step — it's the first action within the review-gate step.
2. **Fresh-context review loop (sub-phase)** — spawn a review subagent (via Agent tool) with fresh context and full tool access. The reviewer classifies each issue as critical/major/minor. If no critical and no major issues: advance. Otherwise: fix the issues and review again.
3. **Cap at 7 fresh-context passes** — if 7 fresh-context review passes all return critical or major issues, stop the pipeline and report the unresolved issues. Label the step as `failed` in the checkpoint. Note: `review-gates.md` has no fixed cap because it covers all contexts (including human-guided review). The 7-pass cap is specific to `/forge:run`'s unattended execution — it prevents runaway loops when no human is watching.

Each review pass is a separate agent invocation — not a follow-up in the same context. Review passes run sequentially (each must complete and fixes must land before the next begins).

### Step granularity

The pipeline tracks these steps:

1. `plan` — create `plans/<feature>/plan.md` via the forge:plan process
2. `plan-review-gate` — self-review + fresh-context review loop for the plan (self-review is a sub-phase, not a separate checkpoint)
3. `tasks` — create the task DAG via the forge:tasks process
4. `tasks-review-gate` — self-review + fresh-context review loop for the tasks
5. `execute` — run the task loop (existing forge:run task execution, including per-task review loops, reflections after each phase, and consolidation of parallel work)
6. `docs` — graduate documentation via `/forge:docs --ship`
7. `pr` — create the pull request

Note: reflections are part of the `execute` step, not a separate pipeline step. The existing run process requires reflections after each phase — this happens within the task loop, not as a top-level checkpoint.

### Restart behavior

When `/forge:run` finds an existing checkpoint:
- Read it and determine the last completed step
- Print a status message: "Resuming from step: <step-name> (steps 1-N already complete)"
- Continue from the next incomplete step
- Do not ask for confirmation

Steps with status `in-progress` are treated as incomplete on restart — the agent re-runs them. For review-gate steps, the checkpoint preserves the pass count and last result, so the agent resumes the review loop at the correct pass number rather than restarting from pass 1. For non-review steps (plan, tasks, execute), re-running is safe because they handle "already exists" cases naturally (plan already written, epic already created, tasks already closed).

### Clearing a checkpoint

`forge run --reset <feature>` clears the checkpoint file, allowing the pipeline to start fresh. This requires extending the CLI code in `src/commands/run.ts` to handle the `--reset` flag — when present, delete `plans/<feature>/pipeline.yaml` and exit (do not start the pipeline). This is a simple file deletion — no complex state to unwind since the plan/tasks/branch may already exist and the pipeline handles "already exists" cases naturally.

### Integration with existing state detection

The `forge run` CLI command already checks preconditions (PRD exists, git clean, forge configured). The checkpoint adds a layer on top: after precondition checks, read the checkpoint to determine where to resume.

The existing `forge status` command shows coarse feature stage (needs-plan, needs-tasks, in-progress, etc.) via the pipeline state machine. It does not show checkpoint-level progress (e.g., "plan-review-gate: pass 3 of 7"). Fine-grained pipeline progress is only visible via the checkpoint file itself or through the `forge run` CLI output when resuming. This is intentional — `forge status` is a quick overview, not a detailed pipeline debugger.

### Review agent prompt reuse

The review agents use the existing prompts from `review-gates.md` — the plan review criteria for plan-review-gate, and the tasks review criteria for tasks-review-gate. No new review criteria need to be invented.

## Testing Decisions

### Checkpoint I/O

Test that the checkpoint file can be read, written, and updated correctly. Test that missing or malformed checkpoint files are handled gracefully (treat as fresh start). Test that each step transition updates the checkpoint.

### CLI behavior

Test that `forge run <feature>` with no checkpoint reports the full pipeline. Test that `forge run <feature>` with a partial checkpoint reports the resume point. Test that `forge run --reset <feature>` clears the checkpoint. Test that missing PRD still fails before checkpoint is consulted.

### Review gate logic

The review gate itself is an agent-level behavior (spawning subagents, parsing PASS/FAIL output). This is not unit-testable in the traditional sense — it's validated by running the pipeline end-to-end. The review prompts are already validated by the existing review-gates protocol.

## Out of Scope

- **External orchestrator / Layer 2** — no standalone CLI that mechanically drives the pipeline via `claude` subprocesses. The agent follows the skill prompt. If this proves unreliable, Layer 2 is a separate feature.
- **Per-task checkpoint state** — the task DAG already tracks individual task status. The checkpoint only tracks pipeline-level steps.
- **Parallel review passes** — review passes run sequentially per the existing review-gates protocol.
- **New review criteria** — the existing plan and tasks review criteria from `review-gates.md` are sufficient.
- **Changes to `forge status`** — the existing status command already detects feature stage. The checkpoint is internal to `/forge:run`.
- **Pipeline-as-code / DSL** — no TypeScript DSL or YAML pipeline definition. The pipeline shape is hardcoded in the skill prompt for now.
