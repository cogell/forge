---
description: Autopilot — plan, decompose, implement (TDD), review, graduate docs, and create PR
argument-hint: <feature-name>
---

Run `forge run $ARGUMENTS` to validate preconditions and see the execution plan.

**How this works:** The CLI checks prerequisites and reports what steps are needed. You (the agent) then follow the orchestration protocol below, spawning task/review/salvage agents in worktrees. The CLI handles state detection; you handle execution.

## Prerequisites

- `plans/<feature>/prd.md` must exist (written via `/forge:prd`)
- `bd` CLI installed and initialized
- Git repo with a clean working tree

## Orchestration Flow

### Phase 0: Setup

1. **Ensure plan exists.** If no plan, run the `/forge:plan` process. No human input needed — the PRD has the answers.
2. **Ensure beads DAG exists.** If no epic, run the `/forge:tasks` process.
3. **Decide PR strategy:**
   - Count phases with ≥3 tasks as "large"
   - If >3 large phases → phase PRs (one per phase)
   - Otherwise → single PR
4. **Create feature branch:** `git checkout -b feat/<feature>`

### Phase 1-N: Execute Each Plan Phase

#### Task loop

```
while bd ready returns tasks for this phase's epic:
    1. Pick highest-priority ready task
    2. Spawn a task agent (worktree isolation, TDD workflow)
    3. On task failure → spawn salvage agent (uses debugging.md protocol)
    4. On task success → run review loop:
       a. Spawn review agent with bead content + git diff
       b. PASS → merge worktree branch, close bead
       c. FAIL → spawn fix agent with review feedback
       d. Spawn review agent again
       e. PASS → merge worktree branch, close bead
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
3. Notify user

## Task Agent

Each task agent receives: bead title, description (WHAT), design (HOW), acceptance criteria, and notes. Agent works in a worktree using the **TDD cycle** (RED → GREEN → REFACTOR per [tdd.md](../../guidance/tdd.md)):

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

If salvage fails: comment on bead with diagnosis, label `needs-human`, skip and continue.

## Error Recovery

The beads DAG is the source of truth. Run `/forge:run <feature>` again after any interruption — it detects existing state and picks up where it left off.

## Deep Reference

See [run-process.md](../../guidance/run-process.md) for the full orchestration protocol including agent prompt templates, review loop details, and salvage agent instructions.
