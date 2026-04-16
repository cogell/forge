---
feature: agent-orchestrator
created: 2026-04-02
status: draft
---

# Brainstorm: agent-orchestrator

## Problem Space

The forge pipeline (plan → tasks → execute → docs → PR) works well when a human manually shepherds each step — running self-reviews, spawning fresh-context reviews, fixing issues, repeating until clean. But this manual orchestration is painful:

1. **Manual review loops** — after writing a plan, the user manually runs self-review, then spawns fresh-context review agents, reads the output, fixes issues, spawns another review, repeats. This happens 4-5+ times per artifact (plan, tasks). It's tedious and the user shouldn't need to be in the loop for mechanical review passes.

2. **Agent forgetfulness** — a single agent running the full pipeline sometimes forgets steps, skips review passes, or does shallow reviews as its context fills up.

3. **Context exhaustion** — 4-5+ review passes on plan + 4-5+ on tasks + task execution + reviews = the orchestrating agent's context degrades long before the pipeline completes, even when reviews are offloaded to subagents.

4. **No restartability** — if the agent goes off the rails mid-pipeline, there's no checkpoint to resume from. The user has to manually assess where things stand and re-prompt.

### Who has this problem

Anyone using forge to ship features end-to-end. Today that's Cedric, running each step manually and babysitting the review loops.

### How painful is it

Very — it's the difference between "kick off and walk away" and "sit there for 30+ minutes shepherding review passes." The pipeline is well-defined enough to be automated; the manual parts are purely mechanical.

## Current State

### What exists

- **`/forge:run`** — already describes the full post-PRD pipeline as a skill prompt. It handles plan creation, task creation, task execution with TDD, review loops on tasks, salvage, docs graduation, and PR creation.
- **`/forge:plan`** and **`/forge:tasks`** — individual skills that create the plan and task DAG.
- **`guidance/review-gates.md`** — defines the review protocol: self-review → fresh-context review loop until no critical/major issues.
- **`guidance/run-process.md`** — full orchestration reference with agent prompt templates.

### What's missing

- `/forge:run` **assumes plan and tasks already passed review**. It says "ensure plan exists" and "ensure tasks DAG exists" but doesn't run the review-loop-until-clean process on them.
- No **checkpoint/progress file** — if context compresses or the conversation restarts, the agent can't pick up where it left off.
- No structured **review loop enforcement** — the review-gate protocol is documented but not mechanically enforced. The agent might do 1 review pass and move on.

### What works well

- Fresh-context reviews via the Agent tool — offloads context, gets independent judgment.
- The task DAG as source of truth for execution state — `forge tasks ready` already enables restartability for the task execution phase.
- The review-gates protocol itself is well-defined and produces good results when followed.

## Ideas

### Idea 1: `/forge:plan-to-pr` — enhanced single-skill prompt (Layer 1)

Create a new skill that's essentially `/forge:run` but with:
- **Explicit review gates** baked into the plan and tasks creation steps (not just task execution)
- **A checkpoint file** (`plans/<feature>/pipeline.yaml`) that the agent maintains as it progresses
- The agent reads the checkpoint at the start, writes it after each step, so it can resume after restart

The checkpoint file would look something like:
```yaml
feature: my-feature
started: 2026-04-02T10:00:00Z
current-step: tasks-review
steps:
  plan:
    status: complete
    passes: 3
  plan-self-review:
    status: complete
  plan-review-gate:
    status: complete
    passes: 3
    last-result: PASS
  tasks:
    status: complete
  tasks-self-review:
    status: complete
  tasks-review-gate:
    status: in-progress
    passes: 2
    last-result: "FAIL - 1 major: task 3 design references FooService but no task creates it"
  execute:
    status: pending
  docs-graduation:
    status: pending
  pr:
    status: pending
```

**Pros:** Minimal new code. Just a well-written skill prompt + checkpoint convention. Tests whether a single agent can handle it.

**Cons:** Still relies on the agent to faithfully follow the prompt and maintain the checkpoint. If the agent is unreliable, the checkpoint won't save it.

### Idea 2: External orchestrator CLI (Layer 2)

A standalone CLI (`forge orchestrate <feature>`) that mechanically drives the pipeline by:
- Spawning `claude` CLI subprocesses for each step
- Parsing structured output (PASS/FAIL/severity) from review agents
- Maintaining the checkpoint file itself (not the agent)
- Enforcing the review loop — the CLI decides when to loop, not the agent

**Pros:** Mechanical enforcement. The agent can't skip steps or forget the loop.

**Cons:** More code. Needs to parse agent output. Harder to handle edge cases the agent would naturally handle.

### Idea 3: Hybrid — skill prompt with mechanical checkpoints

The skill prompt handles the orchestration logic (agent decides what to do), but forge CLI provides:
- `forge pipeline init <feature>` — creates the checkpoint file
- `forge pipeline status <feature>` — shows current state
- `forge pipeline advance <feature> <step>` — marks a step complete
- The skill prompt uses these commands, so even if the agent gets confused, it can re-read the checkpoint

### Idea 4: Pipeline as code (TypeScript DSL)

Define the pipeline as a TypeScript function with typed steps:
```typescript
const postPrd = pipeline("post-prd", ({ feature }) => [
  run(`/forge:plan ${feature}`),
  selfReview({ target: `plans/${feature}/plan.md` }),
  reviewLoop({
    target: `plans/${feature}/plan.md`,
    source: `plans/${feature}/prd.md`,
    passWhen: "no-critical-no-major",
  }),
  run(`/forge:tasks epic create ${feature}`),
  // ...
]);
```

**Pros:** Type-safe, composable, testable.

**Cons:** Over-engineered for the current need. The pipeline shape is pretty stable — it doesn't need to be user-configurable yet.

### Idea 5: Just improve `/forge:run`

Don't create a new skill. Instead:
- Add the review-gate loop to the existing run process for plan and tasks creation
- Add the checkpoint file convention to the existing run guidance
- Make `/forge:run` the single entry point for everything post-PRD

**Pros:** No new concepts. One skill to rule them all.

**Cons:** The run.md prompt is already long. Adding review loops for plan + tasks makes it even longer. More instructions = more chance the agent skips something.

## Actors / Users

1. **Cedric (primary)** — kicks off the pipeline after writing a PRD, wants to walk away and come back to a PR
2. **The orchestrating agent** — follows the skill prompt, spawns subagents, maintains checkpoints
3. **Review subagents** — fresh-context agents that evaluate artifacts for critical/major/minor issues
4. **Task/fix/salvage subagents** — existing agent types from forge:run

## Constraints

- **Must work within Claude Code** — this runs as a skill/slash command, not a separate tool
- **Must handle context compression** — the main agent's context will compress during long pipelines. Checkpoints must survive this.
- **Must be restartable** — user should be able to kill the conversation and restart with `/forge:plan-to-pr <feature>` and have it pick up where it left off
- **Review output must be parseable** — review agents already output "PASS" or "FAIL" on line 1 with severity-classified issues. This format is stable.
- **Should reuse existing forge skills** — not rebuild plan creation or task creation from scratch

## Open Questions

1. ~~**Naming**~~ → **Decided: enhance existing `/forge:run`**. It's already the "do everything" entry point.
2. **Checkpoint format** — YAML? JSON? Markdown with frontmatter? The task system already uses JSON; YAML would be more readable for debugging.
3. ~~**Max review passes**~~ → **Decided: cap at 7** before escalating to human with `needs-human`.
4. ~~**Layer 1 vs Layer 2**~~ → **Decided: Layer 1 first** (enhanced skill prompt + checkpoints). Build Layer 2 only if agent proves unreliable.
5. ~~**Granularity of checkpoint**~~ → **Decided: capture review feedback in the checkpoint file** so fixing agents can read prior feedback from the file rather than relying on context.

## Codebase Notes

- `plugin/commands/run.md` — existing autopilot skill, 102 lines. Already handles task execution, review loop, salvage, docs graduation. Does NOT handle review gates on plan/tasks creation.
- `guidance/run-process.md` — full orchestration reference, 460 lines. Agent prompt templates for task, review, fix, salvage agents.
- `guidance/review-gates.md` — review protocol with severity definitions, stage-specific criteria for PRD/plan/tasks review. Already defines the loop: `repeat: spawn reviewer → classify issues → if no critical/major: advance → else: fix and review again`.
- `src/lib/pipeline.ts` — state machine that detects feature stage. Could be extended to detect checkpoint state.
- `src/lib/tasks/` — task DAG system. `getReadyTasks()` already provides restartability for the execution phase.
- The forge CLI already has `forge status --json` for programmatic state detection.

## Convergence

### Recommended approach: Start with Idea 1+5 (enhanced `/forge:run` with checkpoints)

**Rationale:**
- The pipeline shape is stable — we don't need a DSL or external orchestrator yet
- The gap is narrow: add review gates to plan/tasks creation + add checkpoint file
- A checkpoint file is low-cost and high-value regardless of whether we later build an orchestrator
- If this approach fails (agent still unreliable), the checkpoint file and review-gate protocol transfer directly to a Layer 2 orchestrator — no wasted work

**What v1 looks like:**
1. New or enhanced skill prompt that covers: plan → review gate → tasks → review gate → execute → docs → PR
2. A `plans/<feature>/pipeline.yaml` checkpoint file maintained by the agent
3. On start, read checkpoint and resume from last incomplete step
4. Review gates use Agent tool for fresh-context reviews, loop until clean
5. Max 5 review passes before escalating with `needs-human`

**What tells us we need Layer 2:**
- Agent consistently fails to maintain the checkpoint accurately
- Agent skips review passes even with explicit instructions
- Context compression causes the agent to lose track of the pipeline state despite the checkpoint file existing
