---
description: Autopilot — plan, decompose, implement (TDD), review, graduate docs, and create PR
argument-hint: <feature-name>
---

Run `forge run $ARGUMENTS` to validate preconditions and see the execution plan.

**How this works:** The CLI checks prerequisites and reports what steps are needed. You (the agent) then follow the orchestration protocol below, spawning task/review/salvage agents in worktrees. The CLI handles state detection; you handle execution.

## Prerequisites

- `plans/<feature>/prd.md` must exist (written via `/forge:prd`)
- Git repo with a clean working tree

## Orchestration Flow

### Phase 0: Setup

1. **Ensure plan exists.** If no plan, run the `/forge:plan` process. No human input needed — the PRD has the answers.
2. **Ensure tasks DAG exists.** If no epic, run the `/forge:tasks` process.
3. **Read execution strategy** from `plans/<feature>/plan.md` frontmatter (`execution` field):
   - `phase-prs` → one PR per phase, stop after each for human review
   - `single-pr` → one branch, one PR at the end
4. **Create feature branch:** `git checkout -b feat/<feature>`
5. **Consume the precondition JSON** (`forge run <feature> --json`).

### Phase 0.5: Read the precondition JSON

Run `forge run <feature> --json` and read these top-level keys from the output object:

| Key | Type | Meaning |
|---|---|---|
| `epic` | string \| null | Explicit `--epic` flag value, if supplied. |
| `phase` | number \| null | Explicit `--phase` flag value, if supplied. |
| `suggestedPhase` | number \| null | Auto-detected lowest open phase from `nextOpenPhase(feature)`. `null` if `--epic` was supplied (auto-detect skipped) or if no phase resolves. |
| `suggestedPhaseDiagnostic` | string \| null | Halt or skip explanation when `suggestedPhase` is `null`. Pass through verbatim to the user when no phase resolves. |
| `planningArtifactsDirty` | boolean | True when `plans/<feature>/plan.md` or `plans/<feature>/tasks.json` is dirty in git. The skill commits these before starting the task loop. |

#### Step A — Commit dirty planning artifacts (if `planningArtifactsDirty: true`)

Stage and commit the planning files using the format defined by the `COMMIT_PLAN_TEMPLATE` constant in `src/lib/tasks/types.ts`. The constant currently resolves to:

```
chore(<feature>): add Phase <N> plan + tasks
```

Substitute `<feature>` with the feature name and `<N>` with the resolved phase number (from Step B).

```bash
git add plans/<feature>/plan.md plans/<feature>/tasks.json
git commit -m "chore(<feature>): add Phase <N> plan + tasks"
```

**Special case — `--epic` alone (no feature positional):** The CLI emits `planningArtifactsDirty: false` for this case (no path scope is available). The skill MUST NOT attempt to commit planning artifacts, MUST NOT fabricate a `<feature>` or `<N>` substitution, and MUST proceed directly to Step B's epic-dispatch branch.

#### Step B — Resolve which phase to run (four explicit branches)

1. **If `epic` is non-null** → dispatch with `--epic <id>` and skip phase resolution entirely. The epic ID is project-wide unique via `.epic-lock`.
2. **Else if `phase` is non-null** (the user supplied `--phase <N>` explicitly) → use that exact integer for the task loop and for any commit-message `<N>` substitution.
3. **Else if `suggestedPhase` is non-null** → use that integer (the auto-detect picked the lowest open phase).
4. **Else** → stop and print `suggestedPhaseDiagnostic` verbatim to the user. Do not start the task loop. Common diagnostics:
   - `"all phases closed for this feature"` — nothing to do.
   - `"phase N has in-progress tasks — resume explicitly via --phase N or close them first"` — user must resume manually.
   - `"no tasks.json found for feature"` — run `/forge:tasks` first.
   - `"--epic supplied explicitly; phase auto-detect skipped"` — only fires when `epic` is also non-null, so branch (1) handles it before we reach here.

### Phase 1-N: Execute Each Plan Phase

#### Task loop

```
while forge tasks ready returns tasks for this phase's epic:
    1. Pick highest-priority ready task
    2. Spawn a task agent (worktree isolation, TDD workflow)
    3. On task failure → spawn salvage agent (uses debugging.md protocol)
    4. On task success → run review loop:
       a. Spawn review agent with task content + git diff
       b. PASS → merge worktree branch, close task
       c. FAIL → spawn fix agent with review feedback
       d. Spawn review agent again
       e. PASS → merge worktree branch, close task
       f. FAIL (2nd) → label needs-human, skip task
    5. Repeat
```

#### Docs graduation (mandatory after each phase)

Check each before proceeding:
- ADR-worthy? New pattern, library, schema change → `docs/decisions/`
- Guide-worthy? New repeatable workflow → `docs/guides/`
- Reference changed? Config, env vars, API surface → `docs/reference/`
- Architecture changed? New component → `docs/architecture.md`

#### Phase PR (if phase-PR mode)

Push, create PR, stop and notify user for review. Don't start next phase until merged.

### Final: Ship

1. Run full docs graduation: `/forge:docs --ship <feature>`
2. Create final PR (if single-PR mode)
3. Notify user — include: PR link, summary, and `forge retro <feature>` if issues are found

### After review

- **PR clean** — merge, done.
- **Issues found** — reviewer (human or agent) runs `/forge:retro <feature>` to classify root causes, fix the system, and fix the PR. Multiple rounds may occur. See [retro-process.md](../../guidance/retro-process.md).

## Task Agent

Each task agent receives: task title, description (WHAT), design (HOW), acceptance criteria, and notes. Agent works in a worktree using the **TDD cycle** (RED → GREEN → REFACTOR per [tdd.md](../../guidance/tdd.md)):

1. RED — write failing tests from acceptance criteria
2. GREEN — minimum implementation to pass tests
3. REFACTOR — clean up, run tests after each change
4. Commit all changes

## Review Loop

After task success, the orchestrator spawns a **review agent** that checks:
- **Spec compliance**: every acceptance criterion has a test, interface matches design, only in-scope files modified
- **Code quality**: deep module principle, no speculative code, tests assert behavior not implementation

Output: `PASS` or `FAIL` with specific issues. On FAIL, a **fix agent** addresses the feedback, then review runs once more. Two FAILs → `needs-human`.

## Salvage Agent

On task failure, a salvage agent uses the **systematic debugging protocol** ([debugging.md](../../guidance/debugging.md)):
1. Classify the failure type
2. Judge if previous agent was directionally correct or wrong
3. Reproduce before fixing
4. Narrow scope → one hypothesis → test it → confirm root cause

If salvage fails: comment on task with diagnosis, label `needs-human`, skip and continue.

## Error Recovery

The tasks DAG is the source of truth. Run `/forge:run <feature>` again after any interruption — it detects existing state and picks up where it left off.

## Deep Reference

See [run-process.md](../../guidance/run-process.md) for the full orchestration protocol including agent prompt templates, review loop details, and salvage agent instructions.
