# Forge: Automated Execution

Orchestrate the full post-PRD pipeline: plan → tasks → implement → docs → PR. The human writes the PRD; the agent does the rest.

**Architecture note:** The `forge run` CLI command validates preconditions and reports pipeline state. The orchestration protocol below is executed by the agent — spawning task, review, salvage, and fix agents in worktrees. The CLI provides the state machine; the agent provides the execution engine.

## Prerequisites

- `plans/<feature>/prd.md` must exist (human-authored via `/forge:prd`)
- `bd` CLI installed and initialized in the project
- Git repo with a clean working tree

## Orchestration Flow

### Phase 0: Setup

1. **Ensure plan exists.** If no `plans/<feature>/plan.md`, run the `/forge:plan` process. No human input needed — the PRD has the answers.
2. **Ensure beads DAG exists.** If no beads epic for this feature, run the `/forge:tasks` process.
3. **Read execution strategy.** Parse the `execution` field from `plans/<feature>/plan.md` frontmatter:
   - `phase-prs` → **phase PRs** (one PR per phase, stop after each for human review before continuing)
   - `single-pr` → **single PR** (one branch, one PR at the end)
   - If the field is missing, default to `single-pr`.
4. **Create feature branch.** `git checkout -b feat/<feature>` from main/master.

### Phase 1-N: Execute Each Plan Phase

#### Step 1: Execute the task loop

```
while bd ready returns tasks for this phase's epic:
    1. Pick the highest-priority ready task
    2. Spawn a task agent (see "Task Agent" below)
    3. On task failure → spawn salvage agent (see "Salvage Agent" below)
    4. On task success → run review loop (see "Review Loop" below):
       a. Spawn review agent with bead content + git diff
       b. PASS → merge worktree branch, close bead
       c. FAIL → spawn fix agent with review feedback
       d. Spawn review agent again
       e. PASS → merge worktree branch, close bead
       f. FAIL (2nd) → label needs-human, skip task
    5. Repeat
```

#### Step 2: Reflect on the phase (mandatory)

After all tasks in a phase are closed, pause and write reflections **before** graduating docs. Append to `plans/<feature>/reflections.md`.

If the file doesn't exist yet, create it with this structure:

```markdown
# Reflections: <feature>

Append-only log of learnings discovered during implementation.

## Phase <N>: <phase name>
- <learning>
```

For each completed phase, review the closed beads and ask:

1. **Platform gotchas** — did anything behave unexpectedly? Runtime quirks, API surprises, tooling friction?
2. **Debugging discoveries** — what was hard to diagnose? What would have saved time?
3. **Validated patterns** — what approach worked well and should be reused?
4. **Process improvements** — what would you do differently next time?

If a phase was straightforward and produced no surprises, a single line is fine:

```markdown
## Phase 1: core data model
- Clean phase, no surprises.
```

The point is to force the pause and look back — not to generate volume.

#### Step 3: Graduate docs for this phase (mandatory)

This is NOT optional. Run the phase-complete workflow from [docs-process.md](docs-process.md) before moving to the next phase or creating a PR.

Checklist — confirm each before proceeding:

```
[ ] ADR-worthy? — new pattern, library, schema change, or architectural decision → docs/decisions/
[ ] Guide-worthy? — new repeatable workflow (API, CLI, testing) → docs/guides/
[ ] Reference changed? — config, env vars, API surface, CLI flags → docs/reference/
[ ] Architecture changed? — new component or service → docs/architecture.md
```

If none apply, that's fine — but you must check.

#### Step 4: Phase PR (if phase-PR mode)

Push, create PR, stop and notify user for review. Don't start next phase until merged.

### Final: Ship

1. **Ensure reflections exist** — `plans/<feature>/reflections.md` must exist before graduation. If phases were reflected on individually, review and add any final cross-cutting learnings.
2. **Run full docs graduation (mandatory)** — `/forge:docs --ship <feature>`. Do NOT skip this.
3. **Create final PR** (if single-PR mode)
4. **Notify the human** that the feature is ready for review. Include in the notification:
   - Link to the PR
   - Summary of what shipped
   - If issues are found: `forge retro <feature>` to trigger root cause analysis

### After human review

The orchestrator's job ends at PR creation. What happens next depends on the reviewer:

- **PR approved, no issues** — merge, done. The system worked.
- **PR has issues** — the reviewer (human or agent) runs `/forge:retro <feature>`. This triggers root cause analysis: classify each issue, patch the system (guidance, review criteria, tooling), fix the PR, and append to `plans/<feature>/retro.md`. See [retro-process.md](retro-process.md) for the full protocol.

Multiple review/retro rounds may occur. Each round appends to the retro doc. The goal is convergence to zero issues.

---

## Task Agent

Each task is executed by a subagent spawned in a **worktree** for isolation.

### What the task agent receives

```
You are implementing a single task for the <feature> feature.

## Task: <title>
**Bead ID**: <id>

## What (description)
<bead description field>

## How (design)
<bead design field>

## Acceptance Criteria
<bead acceptance_criteria field>

## Notes
<bead notes field>

## Instructions
1. Read the files mentioned in Notes to understand current state
2. RED — write failing tests first
   - Translate each acceptance criterion into a test assertion
   - Run the test suite — new tests MUST fail before you write any implementation
   - If a new test passes without implementation, the test is wrong — fix it
3. GREEN — implement until tests pass
   - Write only the code needed to make the failing tests pass
   - Do not handle cases not yet covered by a test — write the test first
   - Run the full test suite (not just the new tests) before proceeding
4. REFACTOR — clean up without changing behavior
   - Run tests after each individual change to confirm still green
5. Commit your changes (see commit rule below)
6. Do NOT modify files outside the scope of this task
7. If you hit anything surprising (platform gotcha, unexpected behavior,
   a pattern that worked well), append a bullet to
   plans/<feature>/reflections.md before committing. One line is enough.

See tdd.md for the full protocol.

## CRITICAL: You MUST commit before finishing
When your work is done, stage and commit all changes in the worktree:
  git add <files> && git commit -m "feat(<feature>): <task title>"
The orchestrator will merge your BRANCH, not copy raw files.
Do NOT leave uncommitted changes in the working tree.
```

### On success

The task agent returns with its changes **committed** in the worktree branch. The orchestrator does NOT merge immediately — it runs the review loop first (see "Review Loop" below).

Once review passes, the orchestrator merges — never copies raw files:

```bash
git merge <worktree-branch> --no-ff -m "feat(<feature>): <task title>

Bead: <bead-id>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

bd close <bead-id> --reason "Implemented, tests passing, review passed"
```

### Parallel agents and close ordering

When running tasks in parallel, agents may finish out of dependency order (e.g., task 5 finishes before its dependency task 4). This is expected — `bd ready` treats `in_progress` deps as unblocked so parallel work can proceed.

If `bd close` rejects because a dependency is still `in_progress`, use `--force`:

```bash
bd close <bead-id> --force --reason "Implemented; dep still in_progress from parallel agent"
```

### On failure

The task agent returns an error or fails to pass tests. Proceed to salvage.

---

## Review Loop

After each task agent succeeds, the orchestrator runs a two-stage review before merging. The review agent is spawned from the orchestrator — subagents cannot spawn agents themselves.

```
attempt = 1
while attempt <= 2:
    spawn review agent (bead content + git diff)
    if PASS → merge + close bead, exit loop
    if FAIL:
        if attempt == 1 → spawn fix agent with review feedback, attempt = 2
        if attempt == 2 → label needs-human, skip task, exit loop
```

### Pre-review: automated quality checks

Before spawning the review agent, run the project's linter and type checker in the worktree:

```bash
# Example — adapt to project tooling
<lint command>       # e.g., pnpm lint
<typecheck command>  # e.g., pnpm tsc --noEmit
```

If either fails, spawn a fix agent with the lint/type errors before proceeding to review. Do not send a review agent a diff that doesn't pass automated checks — human-readable review time is too valuable for issues a machine can catch.

### Review Agent

Receives the bead's full content plus the diff of the worktree branch.

```
You are a code reviewer for a single completed task. Do not implement anything.

## Task: <title>
**Bead ID**: <id>

## What (description)
<bead description field>

## How (design)
<bead design field>

## Acceptance Criteria
<bead acceptance_criteria field>

## Files in scope
<bead notes field — files list>

## What was implemented
<git diff of worktree branch>

## Stage 1: Spec Compliance
Check each item. Flag any failure with a specific, concrete description.
- Every acceptance criterion has a corresponding passing test
- Implementation uses the interface specified in the design field — no silent drift
- Only files listed in the Notes files list were modified
- No acceptance criteria were skipped or silently reinterpreted

## Stage 2: Code Quality
- New interfaces are simple relative to what they encapsulate (deep module principle)
- No code written for cases not covered by the current tests
- New patterns are consistent with what is visible in the diff context
- Tests assert behavior, not implementation details
- No repeated I/O inside loops — prefer batch/bulk operations when operating on a collection of items
- Data from external sources (WebSocket, API responses, IPC) is validated before use — unknown/malformed input has a defined handling path

## Output format
First line must be exactly PASS or FAIL.
If FAIL, list each specific issue on its own line — be concrete:
  "criterion 2 (parseConfig returns error on null) has no test"
  not "test coverage is incomplete"
```

### Fix Agent

Spawned when the review agent returns FAIL. Receives the original task content plus the review feedback.

```
A review agent reviewed your implementation and found issues. Fix them.

## Original Task
<same content as task agent received>

## Current Implementation
<git diff of worktree branch>

## Review Feedback
<full FAIL output from review agent>

## Instructions
1. Read each issue in the review feedback carefully
2. Fix only what the review flagged — do not refactor unrelated code
3. Re-run the full test suite after fixing
4. Commit your changes before returning

## CRITICAL: You MUST commit before finishing
  git add <files> && git commit -m "fix(<feature>): address review feedback for <task title>"
```

### Review failure escalation

If the review agent returns FAIL on the second attempt:

```bash
bd comment <bead-id> "Review failed after fix attempt.

Issues found:
<review feedback from attempt 2>

Needs human attention."

bd update <bead-id> --status open
bd label <bead-id> needs-human
```

Skip this task and continue with the next unblocked task.

---

## Salvage Agent

When a task agent fails, spawn a **salvage agent** before giving up.

### What the salvage agent receives

```
A previous agent attempted this task and failed. Your job is to
diagnose the failure and fix it using systematic debugging.

## Original Task
<same task content as task agent received>

## Previous Attempt
**Error output:**
<captured error/test output from the failed agent>

**Files changed:**
<git diff from the worktree, if any>

## Instructions

### Step 1: Classify the failure
Assign it to one type: assertion failure, type/compile error, runtime crash,
import/dependency error, or test infrastructure failure. Read debugging.md
for what to investigate per type.

### Step 2: Judge the previous agent's direction
- **Directionally correct but incomplete**: the approach is right, the
  execution is wrong. Build on the existing changes.
- **Directionally wrong**: the approach itself is flawed. Revert the
  previous agent's changes and start fresh from the spec.

Do not mix strategies — pick one and commit to it.

### Step 3: Reproduce before fixing
Run the failing test in isolation and confirm you can trigger the failure.
If you cannot reproduce it, stop and report — do not guess.

### Step 4: Apply the debugging protocol
Follow debugging.md: narrow scope → form one hypothesis → test it → confirm
root cause. One change at a time.

### Step 5: Verify
Run the full test suite. All tests (old and new) must pass before committing.

### Step 6: Commit
  git add <files> && git commit -m "fix(<feature>): salvage <task title>"

If you cannot fix this after a thorough attempt following the above protocol,
report exactly: what you found, what you tried, what you believe the root
cause is, and what a human would need to do to unblock it.
```

### Salvage outcomes

- **Salvage succeeds** → run review loop (same as normal success)
- **Salvage fails** → do NOT merge. Instead:
  ```bash
  bd comment <bead-id> "Auto-implementation failed after salvage attempt.

  Error: <summary of what went wrong>
  Attempted approaches: <what both agents tried>
  Likely root cause: <best diagnosis>

  Needs human attention."

  bd update <bead-id> --status open
  bd label <bead-id> needs-human
  ```
  Then **skip this task** and continue with the next unblocked task. The DAG handles this — tasks that depend on the failed one will stay blocked, but independent tasks proceed.

---

## Error Recovery

### Agent crashes or context fills up

The beads DAG is the source of truth. To resume after any interruption:

```bash
bd ready   # shows what's unblocked and unclaimed
```

Run `/forge:run <feature>` again — it detects existing plan, tasks, and branch, and picks up where it left off.

### Merge conflicts

If merging a worktree branch causes conflicts:

1. Spawn a salvage agent with the conflict details
2. Salvage agent resolves conflicts, favoring the newer task's changes for files it owns
3. If unresolvable → skip task, label `needs-human`

### Test failures after merge

After merging each task, run the full test suite (not just the task's tests):

```bash
# After merge, before closing the bead
<project test command>   # e.g., pnpm test
```

If unrelated tests break, spawn a salvage agent to fix the regression before continuing.
