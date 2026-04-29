---
created: 2026-04-28
status: feedback
target: forge:run skill
context: harness-setup phase 2.5 autopilot run, paused after 2 of 9 tasks
---

# `/forge:run` spec change requests

Captured from a real run of `/forge:run harness-setup phase 2.5`. Two tasks (CFT-10.1, CFT-10.2) executed cleanly to commits, but the orchestration around them produced enough friction that the autopilot paused early. Each item below is a concrete proposed change — prioritized by how much it cost the run.

---

## P0 — Worktree forks from a stale base

### Observed
The Agent tool's `isolation: "worktree"` creates a worktree that does NOT branch from the current feature-branch HEAD. CFT-10.2's worktree was based on `1fdfa00` (the merge of phase-2.1, basically `main`) — even though I had just merged CFT-10.1 (`42f62e8`) into `feat/harness-setup-phase-2.5` immediately before spawning the agent.

### Consequence
- The CFT-10.2 agent could not see `src/canvas/lessons.ts` or `HARNESS_LESSONS_KEY` (CFT-10.1's deliverables). It correctly inferred they were missing and re-created them inside its own commit.
- Merge back: my branch already had those files, so a fast-forward was impossible. I had to cherry-pick just the new files (`useLessons.tsx`, `useLessons.test.tsx`) and discard the agent's foundation re-add.
- Repeat ×7 for the remaining tasks would mean 7 cherry-pick dances, each with risk of content drift between my version and the agent's re-creation (e.g., the agent's `lessons.ts` had `as const satisfies Record<...>` typing where mine just had `as const` — minor but a real diff).

### Proposed change
Either:

**(A) Pin the worktree base to the current branch HEAD.** Before spawning, the orchestrator captures `git rev-parse HEAD` (on the feature branch) and passes that as the worktree's base. The Agent tool needs a `base` parameter on the worktree isolation option (or an env var the tool reads). If the SDK doesn't support this, file an upstream request.

**(B) Document the constraint and require push-before-spawn.** Orchestrator pushes the feature branch to origin before each spawn; agents start their worktree with `git fetch && git reset --hard origin/<feature-branch>`. Adds a network round-trip per task but predictable.

**(C) Drop worktree isolation for sequential tasks within a phase.** The whole point of worktrees is concurrent isolation. If tasks within a phase are strictly sequential (which they are when one task's deliverable is another task's import), in-place execution on the feature branch is simpler and faster. Worktrees only make sense for parallel-eligible tasks (post-`forge tasks ready` returning multiple unblocked items).

My pick: **C as default, A as escape hatch when parallelism is genuinely available.** The skill can detect parallelism by checking `forge tasks ready` count.

---

## P1 — HEAD gets reset to `main` between agent spawns

### Observed
After merging CFT-10.1 and spawning the next agent, my next prompt found `git branch --show-current` returning `main`. Reflog showed `HEAD@{0}: checkout: moving from feat/harness-setup-phase-2.5 to main` happened *between* my commands — not from anything I ran.

### Consequence
Before doing any work in the main repo (cherry-pick, commit, etc.), I had to defensively `git checkout feat/harness-setup-phase-2.5`. Easy to forget; if forgotten, commits land on the wrong branch.

### Likely cause
The Agent tool's worktree isolation appears to restore the parent repo's branch to whatever it considers "default" (probably `main`) on agent exit. Speculative — I don't have visibility into the Agent tool's internals.

### Proposed change
Either:
- **Fix in Agent tool**: don't reset parent-repo HEAD on worktree teardown. The parent's checkout is the orchestrator's concern, not the isolation's.
- **Fix in orchestrator**: at the top of every iteration of the task loop, re-checkout the feature branch (no-op if already there). Cheap insurance.

Recommend both: file the upstream Agent-tool bug AND add the defensive checkout to the loop.

---

## P1 — No triage between "agent-worthy" and "trivial" tasks

### Observed
9 tasks for Phase 2.5 broke down by complexity:
- Complexity 6: CFT-10.2 (useLessons, ~180 lines + 22 tests), CFT-10.3 (LessonPopover, similar)
- Complexity 4: CFT-10.9 (integration + screenshots)
- Complexity 3: CFT-10.5 (Chat anchor reg, ~15 lines + tests)
- Complexity 2: CFT-10.1 (pure data, 30 lines), CFT-10.4 / 10.6 / 10.7 / 10.8 (each is a 1–3 line trigger wiring + a test stub)

The current protocol spawns a full agent for *every* task. Setup overhead per agent: worktree creation (slow on first spawn — `pnpm install` in the worktree), agent thinking-time, agent's own multi-step exploration of the codebase before making a 5-line edit. For complexity-2 tasks this is wildly disproportionate.

### Consequence
Estimated cost for the 4 complexity-2 wiring tasks alone: 30+ minutes of agent time, hundreds of thousands of tokens, four separate cherry-pick dances. The output: ~20 lines of code total.

### Proposed change
**Triage tasks by complexity before spawning agents.** Suggested heuristic:

- **Complexity 1–2**: orchestrator does the work in-conversation. Read task content, write the diff with `Edit`/`Write`, run tests, commit. No agent spawn.
- **Complexity 3**: configurable — default in-conversation, override to agent if the user wants strict TDD/review per task.
- **Complexity 4+**: spawn agent.

Add a knob to `/forge:run` for users who want strict-isolation regardless of complexity (CI-like reproducibility): `forge run <feature> --strict`. Default is the heuristic.

This single change probably halves end-to-end time on a typical phase.

---

## P2 — Agent prompt template doesn't match task type

### Observed
The skill's task agent template assumes TDD (RED → GREEN → REFACTOR). CFT-10.1 was a pure-data task (a typed dictionary + one constant) — explicitly "no tests for this task" in the notes. The agent correctly skipped the TDD ceremony, but it had to read the task notes carefully to know to skip. A worse agent might have written useless tests.

### Proposed change
Add a `task_kind` field (or label-derived classification) per task: `behavior` (TDD applies), `data` (no tests, just implement), `wiring` (extend existing tests adjacent to the change), `validation` (no code, run + capture). The agent prompt template branches on `task_kind`.

If adding fields is too much, the orchestrator can infer from labels (`complexity:1-2` + zero acceptance criteria mentioning "tests" → `data`).

---

## P2 — Verbose agent reports bloat the orchestrator's context

### Observed
My agent prompts asked for "report under 200 words" and got 200–250 word reports back. Each report includes file paths, test counts, commit SHA, branch name, and "anything surprising" — useful but cumulative. Across 9 tasks that's 1800–2250 words of reports just from agents, plus my own diff inspections + test output + status messages to the user. Risks context exhaustion before the phase finishes.

### Proposed change
**Default report format: structured + terse.** A single line per task:
```
PASS · CFT-10.2 · 7a57c8a · 22 new tests · ⚠ added defensive dedup beyond spec
```
or
```
FAIL · CFT-10.5 · pnpm test failed: useChat.test.ts:142 · see worktree path
```

Verbose reports only when (a) FAIL, (b) agent flags `requires_human_attention: true`, or (c) orchestrator explicitly requests follow-up. The structured shape lets the orchestrator parse without re-reading every report.

---

## P2 — Review loop unspecified for trivial tasks

### Observed
The skill says "after task success, spawn a review agent." For CFT-10.1 (30-line pure-data file) this would have been pure ceremony — there's literally nothing to review beyond "are the strings copied verbatim." I made a judgment call to skip review for it. A worse agent might either (a) skip review on every task (corrosive to quality), or (b) spawn a review agent for every task (wasteful).

### Proposed change
Make review-skip explicit. Tier:
- **Complexity ≤ 2 AND `task_kind = data`**: skip review (orchestrator does a 30-second visual diff check)
- **Complexity 3–5**: review optional, default on
- **Complexity 6+**: review mandatory

---

## P2 — Possible cross-tree state bleed (one observation, not reproduced)

### Observed

During the `/forge:run cli-iteration-mode --phase 3` autopilot session (FORGE-5.2), the worktree agent for FORGE-5.2 returned PASS at commit `9768ac4` in its worktree branch. ~2 minutes later, when I ran `git status` in the main repo to set up the cherry-pick, the main repo at `/Users/cogell/projects/cogell/forge` showed staged changes for the same files the agent worked on:

```
On branch feat/cli-iteration-mode-phase-3
Changes to be committed:
  new file:   src/commands/__tests__/run.test.ts
  modified:   src/commands/run.ts
```

The staged content was byte-identical to the agent's first commit. Main repo working tree files had also been updated, with mtimes ~2 minutes after the agent commit. The agent's worktree itself was correct; this was an *additional* leak of the agent's work into the main repo's index and working tree.

### Cost on the original session

When I tried `git cherry-pick 9768ac4`, git rejected with "your local changes would be overwritten by cherry-pick." Recovery: `git reset HEAD <files>` + `git checkout HEAD -- <files>` + `rm <new files>` before the cherry-pick could proceed. ~3 minutes of debugging to identify what had happened.

### Spike — three controlled patterns, none reproduced the bleed

A focused 30-minute spike attempted reproduction in isolation. Each variation captured pre/post `git status --porcelain`, `.git/index` SHA, and file MD5s in the main repo immediately after agent return:

| Variation | What the agent did | Main repo after |
|---|---|---|
| A | Created a new file (`SPIKE-A-MARKER.txt`), staged, committed | Clean. No file, no staging, index SHA unchanged. |
| B' | Modified existing `README.md`, staged, committed | Clean. README MD5 unchanged in main, index unchanged. |
| C | (After agent return) called the orchestrator's `Edit` tool against the worktree's `README.md` via absolute path | Clean. Worktree's file modified; main's untouched. |

Worktree git-dir topology was normal in all three: per-worktree `.git/worktrees/<name>/` with shared `.git/` common-dir. No `core.worktree` config quirks. This is the expected git worktree layout.

### Hypotheses (not tested)

The original observation may require conditions the spike didn't replicate:
- Multiple concurrent worktree agents (FORGE-5.1 and FORGE-5.2 ran in parallel; the spike used one at a time).
- A non-isolated agent (review) spawned after a worktree agent.
- A specific tool sequence: agent return → orchestrator's `Edit` against worktree-absolute paths → `pnpm test` in worktree cwd → return to main repo.
- An accidental orchestrator-side bash command staging files (no audit trail to confirm or rule out).

### Proposed change

**Defensive `git status` check at the top of every post-agent block** in the orchestrator skill. No cost, catches anything weird regardless of root cause:

```bash
# After every Agent worktree return, before cherry-pick / review / merge:
if [ -n "$(git status --porcelain)" ]; then
  # Inspect. If main repo has staged or modified files that match the
  # agent's commit (and the orchestrator did not author them), reset:
  #   git reset HEAD <files>
  #   git checkout HEAD -- <files>
  #   rm <any new files staged but not authored by the orchestrator>
  # Then proceed with cherry-pick / merge as normal.
fi
```

Document this as standard hygiene. Don't try to fix the underlying mechanism until the spike conditions are reproduced — fixing a phantom is worse than catching it.

### Status

One observation; three controlled non-reproductions. Severity **P2**: real enough that the defensive check is worth adding, not severe enough to block adoption of worktree-mode agents. If a second observation lands, escalate to **P0b** and rerun the spike with the higher-order combinations.

---

## P3 — Worktree branches accumulate without cleanup

### Observed
`git worktree list` shows 30+ `worktree-agent-*` entries from prior sessions, all `locked`. Pollutes `git branch -a`, contributes to base-mismatch confusion (the Agent tool may be reading some of these as candidate bases?), and consumes disk.

### Proposed change
- The Agent tool should auto-clean worktrees with no commits on agent exit (per its own docs — verify this is actually working; suspicion is it's not).
- Orchestrator should run `forge worktrees prune <feature>` (or equivalent) at end of phase, before creating the PR.
- Document a cleanup command for users to run periodically: `forge worktrees prune --all-features --merged`.

---

## P3 — No defined "pause and check in" trigger

### Observed
I paused after 2 of 9 tasks because the orchestration friction was real and worth surfacing before plowing through 7 more. But the skill describes `/forge:run` as autopilot — there's no codified pause point besides "after each phase" (in `phase-prs` mode) or "at the end" (in `single-pr` mode).

### Proposed change
Define explicit pause triggers:
- After first task in a phase (sanity check that the orchestration is working before committing to N more)
- On any task FAIL that requires human intervention
- When a single task's friction (re-spawns, salvage cycles, cherry-pick dance) exceeds N minutes
- On context-budget threshold (orchestrator self-monitors and pauses if it estimates < 30% remaining)

Each pause posts a structured status to the user with: tasks done, tasks remaining, blockers, recommended next action. User responds with "continue", "abort", or specific guidance.

---

## P3 — Agent prompt is heavy on context that's already retrievable

### Observed
My agent prompts were 600–800 words each, embedding full task description, design, acceptance criteria, notes, plus context about the broader phase. Most of that is already in `forge tasks show <id>` and `plans/<feature>/plan.md`.

### Proposed change
**Lean prompt template** (~150 words):
```
Execute forge task CFT-X.Y. Run `forge tasks show CFT-X.Y` for full
brief. Read plans/<feature>/plan.md §<phase-section> for design context.

Constraints:
- Single commit. Conventional message: `feat(<scope>): <title> (CFT-X.Y)`.
- Don't modify files outside the task's scope (see Notes section).
- If anything is unclear or you find yourself doing speculative work,
  STOP and reply with a question instead of pushing through.

Report: 1-line PASS/FAIL + commit SHA + worktree branch name.
Verbose only on FAIL or unexpected discoveries.
```

The agent reads the brief itself. Removes 500+ words of redundant orchestrator-side context-passing.

---

## Summary of proposed changes (ranked)

| Priority | Change | Estimated impact |
|---|---|---|
| P0 | Worktree base = current branch HEAD (or drop worktree for sequential tasks) | Eliminates per-task cherry-pick dance |
| P1 | Defensive checkout at top of task loop | Prevents wrong-branch commits |
| P1 | Triage by complexity — don't spawn agents for ≤2 wiring tasks | Halves phase wall-clock time |
| P2 | Branch agent prompt template by `task_kind` | Fewer mismatches between protocol and reality |
| P2 | Structured 1-line agent reports by default | Saves 1500+ words of orchestrator context |
| P2 | Tier review-loop by complexity | Saves spend on trivial tasks |
| P2 | Defensive `git status` check after every worktree-agent return | Catches the unreproduced cross-tree state bleed |
| P3 | Worktree cleanup at phase end | Hygiene |
| P3 | Defined pause-and-check-in triggers | Avoids autopilot-overshoot |
| P3 | Lean agent prompt template | Less redundant token spend |

## What worked well (worth preserving)

- The CLI surface (`forge tasks show`, `forge tasks close`, `forge tasks ready`) was clean and parseable.
- The DAG validation (`forge tasks validate`) caught nothing because there was nothing wrong, but the speed and clarity were good.
- The `phase-prs` execution mode is a real win — phase boundaries are natural review/checkpoint points.
- The Agent tool worktree-isolation concept is the right primitive; it just needs a base-pinning option to be useful for sequential dependent work.
- The `forge run` precondition check (clean tree + plan exists) is good guardrail.

## Notes on scope

This is feedback on the orchestration layer (`/forge:run` + how it uses the Agent tool), not on `/forge:plan`, `/forge:tasks`, or `/forge:reflect`. Those worked fine in this run.
