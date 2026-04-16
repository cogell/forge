---
status: active
feature: cli-iteration-mode
created: 2026-04-16
completed: null
---

# PRD: cli-iteration-mode

## Problem Statement

The forge CLI is optimized for the **creation pass** — emit a fully-formed task in one shot via `forge tasks create` with all flags. That pass works well for both humans and coding agents.

The **iteration pass** — read a task's current state, mutate one field, re-validate, repeat — is under-supported. During self-review and external-review cycles (the cycles where the most real work happens), both humans and agents fall back to:
- Raw `tasks.json` hand-edits
- Python scripts to batch-mutate fields
- Multiple sequential `forge tasks update` calls (one field per command)

An external reviewer used forge across a 4-phase project with 16 ready tasks and surfaced 11 issues. All cluster around iteration-pass friction. Their direct quote:

> The CLI is optimized for the creation pass but not the iteration pass. A `forge tasks edit SK-5.1` that opens the task in `$EDITOR` (then writes back to JSON on save) would collapse the whole review-fix cycle into a single tool call instead of the Python scripts I resorted to.

Two operator classes experience this:
- **Coding agents** iterate the most — a single review loop can trigger dozens of field updates per task. Tool-call count adds up fast.
- **Humans** iterate less often but more painfully — they hit the append-only `--acceptance` limitation and drop to Python immediately.

Today the agent's escape hatch is to emit parallel tool calls; the human's is raw JSON. Neither should be necessary.

### Why this, why now

The reviewer is a real, active user. Every day without this shipping means:
- Agents burn tool-call budget on sequential field updates.
- Humans edit JSON by hand, bypassing schema enforcement (issue #4 is the exact symptom).
- `forge run` is blocked from being a one-shot driver because humans must manually pick the epic and commit plan artifacts themselves.

The forge team also dogfoods forge on itself; these issues affect our own productivity.

### Minimum that solves the problem

The reviewer's workflow must complete end-to-end in the CLI — zero Python scripts, zero raw JSON edits — across the full review cycle (self-review → fix → external review → fix). That's the one binary success criterion.

Everything in this PRD ladders to that. Anything that doesn't is explicitly out of scope.

## Solution

Five phases, ordered to ship the highest-ROI surface first. Each phase is independently shippable and independently valuable.

- **Phase 1 — CLI polish.** Seven small, independent additions that close the most common iteration-pass gaps. Small blast radius, fast to land, unblocks the rest.
- **Phase 2 — `forge tasks edit` (editor-mode).** The headline feature. Collapses N `update` calls into one editor buffer for humans. Full design in `plans/tasks-editor-mode/brainstorm.md`.
- **Phase 3 — `forge run` orchestration gaps.** Auto-commit planning artifacts; accept `--epic`/`--phase`; auto-detect next open phase per feature. Note: `forge run` has a two-layer architecture — the CLI binary (`src/commands/run.ts`) is a precondition reporter that emits JSON; the actual orchestration is a skill (`plugin/commands/run.md`) invoked by the user via `/forge:run`. Phase 3 changes touch **both layers** (see Implementation Decisions).
- **Phase 4 — Validation hardening.** Catch at write-time what direct JSON edits slip through. Deeper `forge tasks validate`.
- **Phase 5 — Human-gated tasks.** Label-based `gate:human` convention with `forge tasks gate clear` + interactive prompt in `forge run`. Full design in `plans/human-gated-tasks/brainstorm.md`.

### Framing in the CLI

Creation-pass and iteration-pass subcommands coexist:
- **Creation** — `forge tasks create`, `forge tasks epic create`. Agent-friendly one-shot.
- **Iteration** — `forge tasks edit`, `forge tasks delete`, `forge tasks gate clear`, `forge tasks update`. Field-level mutations, agent- or human-driven.

## User Stories

### Phase 1 — CLI polish
1. As an agent mid-review, I want `forge tasks delete SK-5.99 --confirm` so I can remove a typo'd task without editing JSON.
2. As an agent creating a task with a known blocker, I want `forge tasks create ... --blocked-by SK-5.1` so I don't need a second `dep add` call.
3. As the `forge run` orchestrator, I want `forge tasks ready --label <L>` (general) and `--phase <N>` (sugar for `--label phase:<N>`) so the work loop is scoped correctly without mental filtering.
4. As a human reviewing phase progress, I want `forge tasks show SK-5 --children --full` so I can read all child task detail in one call instead of a shell loop.
5. As a task author, I want `forge tasks epic create --id SK-5.5` so the epic ID matches the phase number in my plan.

### Phase 2 — `forge tasks edit`
6. As a human reviewer, I want `forge tasks edit SK-5.1` to open the task in `$EDITOR` as markdown-with-frontmatter so I can fix multiple fields in one save.
7. As a human reviewer, I want full replacement of `acceptance[]` (not append) because I regenerate criteria during review fixes.
8. As a human editing, I want non-editable fields (`id`, `status`, `created`, `closeReason`, `comments`) shown as a commented-out header for reference, not parsed on save.
9. As a human whose save fails validation, I want the buffer to re-open crontab-style with errors inline, preserving my edits.
10. As a human who finishes editing while another forge process also wrote to `tasks.json`, I want an optimistic-locking error that prints the conflict and refuses the write — so I never silently lose data. To resolve: exit-without-saving to abort, or re-invoke with `--force` to overwrite the concurrent write. No merge path in V1.
11. As an agent, I can continue using `update`/`create` with explicit flags (creation-pass remains supported); `edit` is not the agent's happy path.

### Phase 3 — `forge run` orchestration
12. As a user running `forge run <feature>`, I want planning artifacts (plan.md, tasks.json) auto-committed to the feature branch as `chore: add Phase N plan + tasks` before the task loop starts, so the feature branch holds its own source of truth.
13. As a user running `forge run <feature>`, I want `--epic <id>` or `--phase <N>` to target a specific phase explicitly.
14. As a user running `forge run <feature>` without `--epic`/`--phase`, I want the next open phase auto-detected for that feature, so I don't manually pick an already-closed epic.

### Phase 4 — Validation hardening
15. As a user editing `tasks.json` directly (editor-mode or by hand), I want `forge tasks validate` to catch type mismatches (`acceptance: str` instead of `list[str]`) — not just DAG cycles.
16. As a reviewer, I want `validate` to warn on empty `acceptance[]` arrays (probably a mistake, not an error — so warn not fail).
17. As a reviewer, I want `validate` to warn on orphan labels (a label used on one task in a phase but missing from siblings) — cheap consistency check.

### Phase 5 — Human-gated tasks
18. As a task author creating a task that needs out-of-band human setup, I want to add label `gate:human` so the orchestration loop knows to pause.
19. As `forge tasks ready` consumer, I want gated tasks to appear with `gated: true` in the output so I can decide to include or skip them.
20. As `forge run`, I want to prompt "SK-5.1 is human-gated — completed? (y/N)" before dispatching an agent. `y` strips the label (clears the gate); `N` skips to the next ready task.
21. As a human who did the setup out-of-band, I want `forge tasks gate clear <id>` for scripted/batch clearance without running `forge run`.

## Implementation Decisions

### Framing & scope
- Iteration-pass ergonomics benefit **both** humans and agents. Agents iterate more frequently (per review loop); humans iterate more painfully (per review cycle). Both matter.
- Optimize V1 for **solo devs + their coding agents** (the current forge user profile). Team concurrency is not a target.
- Phases are independently shippable. No phase blocks another for *merging*, but the suggested order maximizes early value.

### Phase ordering rationale
Phase 1 (polish) ships first because:
- Seven small, independent additions — lands in a day
- `delete` is needed to answer design questions in Phase 2 (editor-mode)
- Unblocks more agent workflows immediately than the bigger chunks

Phase 2 (editor-mode) is the headline but the largest single chunk.

Phase 5 (human gates) is last because it's the only phase with meaningful design uncertainty remaining — if V1 label-based approach proves limiting, a future PRD can revisit.

### Phase 1 — CLI polish decisions

Six additions (not five — `ready --label` is the general-form companion to `--phase`):

- `forge tasks delete <id>` requires `--confirm`. Cascade: refuses if the task has **any descendants** (matched via ID prefix, same pattern `getReadyTasks` uses to detect containers at `src/lib/tasks/queries.ts:113-128`). User must delete descendants bottom-up.
- `forge tasks create --blocked-by <id>` accepts the flag multiple times to wire multiple deps at creation time.
- `forge tasks ready --label <L>` filters to tasks containing that exact label. This is the **new general form**; `ready` currently has no label filter (verified `src/commands/tasks.ts` — `ready` takes only an optional feature positional).
- `forge tasks ready --phase <N>` is **sugar** over `--label phase:<N>`. `phase` stays a label convention; no schema change.
- `forge tasks show <epic-id> --children` expands direct children only. `--children --full` recurses through all descendants. Default (without `--children`) is unchanged summary.
- `forge tasks epic create --id <explicit-id>` accepts an explicit ID. Validated project-wide via the existing `.epic-lock` mechanism (`src/lib/tasks/mutations.ts:36-86`) — collision with any epic in any tasks.json under `plans/` fails. Without `--id`, current auto-increment behavior stands.

**Dispatcher updates** (`src/commands/tasks.ts`):
- `RESERVED` (line 35) gains: `edit`, `delete`, `gate` (for Phase 2 and Phase 5).
- `VALUE_FLAGS` (line 43) gains: `--blocked-by`, `--phase`, `--editor`, `--id`.
- `BOOLEAN_FLAGS` (line 50) gains: `--confirm`, `--children`, `--full`, `--force`, `--dry-run`.

### Phase 2 — `forge tasks edit` decisions

- Buffer format: **markdown with YAML frontmatter**. Frontmatter = structured fields (`title`, `priority`, `labels[]`, `dependencies[]`). Body = prose fields (`## Description`, `## Design`, `## Acceptance`, `## Notes`).
- `## Acceptance` parses both `- [ ]` and `- [x]` lines into `acceptance[]` (text only). **Check state is not persisted in V1** — the schema has no such field. If any `- [x]` is present on save, print a `warning:` line to stderr before writing: *"checked acceptance items were accepted but check state is not stored; all items will render as `- [ ]` on next open."* User is not blocked; the warning acknowledges the footgun.
- Single task per invocation. No multi-task/subtree editing.
- Non-editable fields (id, status, created, closeReason, comments) shown as commented-out header for reference, not parsed.
- Validation-on-save: **crontab-style** — on error, re-open buffer with error as leading comment, preserving user edits. Abort = exit editor without saving.
- Concurrency: **optimistic with binary resolution**. Hash task state on open; verify on save. On mismatch: print a diff, refuse write, user must either (a) exit-without-saving to abort or (b) re-invoke with `--force` to overwrite the concurrent write. **No merge or three-way-resolution path in V1** (this closes `plans/tasks-editor-mode/brainstorm.md` open question 3).
- Editor selection: `$VISUAL` → `$EDITOR` → `vi`.
- No TTY / `CI=true` → fail fast with a clear message. `edit` is interactive-only.
- Empty buffer on save = **abort** (not delete). Deletion is an explicit separate operation via `forge tasks delete <id> --confirm` (Phase 1). This closes `plans/tasks-editor-mode/brainstorm.md` open question 4 and is why Phase 1 ships before Phase 2.
- Existing `forge tasks update` with flag-per-field is unchanged. Agents continue to use it; `edit` is for humans.

### Phase 3 — `forge run` orchestration decisions

**Two-layer architecture.** `forge run` is split across:
- `src/commands/run.ts` — CLI binary, reports preconditions as JSON, exits. **No orchestration.**
- `plugin/commands/run.md` — skill markdown invoked via `/forge:run`. Reads the CLI JSON and does the actual branch management, task loop, and agent dispatch.

Phase 3 changes touch both layers. Decisions below identify which.

**CLI layer (`src/commands/run.ts`):**
- Accept new flags: `--epic <id>` and `--phase <N>`. Mutually exclusive — passing both is an arg-parse error (exit 2, stderr message). Emit the chosen value in the precondition JSON output for the skill to honor.
- `--epic <id>` is sufficient on its own (epics are project-wide unique via `.epic-lock`); the feature positional may be omitted when `--epic` is passed. `--phase <N>` still requires a feature positional because phase labels are scoped per-feature.
- Without explicit selectors, emit a `suggestedPhase` field containing the auto-detected next open phase (algorithm below), or `null` if none can be chosen.
- Add precondition check: detect dirty planning files (`plan.md`, `tasks.json`) on the current branch; emit `planningArtifactsDirty: boolean` in the JSON.
- `forge run <feature>` still requires a feature argument. No global "next phase" across features.

**Skill layer (`plugin/commands/run.md`):**
- Before starting the task loop, if `planningArtifactsDirty: true`, commit the planning artifacts as `chore(<feature>): add Phase <N> plan + tasks` (where `<N>` is the chosen phase). Commit happens on the feature branch.
- Honor `--epic`/`--phase` from the CLI output when selecting the epic to drive.
- If neither flag is set and the CLI emitted a `suggestedPhase`, use it. If `suggestedPhase` is `null`, refuse to run and surface the reason (no open phases / unresolved `in_progress` task / etc.).

**"Next open phase" auto-detect algorithm.**
Input: all tasks across the feature's tasks files.
Procedure:
1. Collect the set of `phase:N` labels present on any task in the feature, parsing `N` as a number. Tasks without any `phase:*` label are ignored by this selector (the user can still drive them explicitly via `--epic`).
2. For each phase `N` in ascending numeric order:
   - Let `T(N)` = the tasks labeled `phase:N`.
   - If any task in `T(N)` has `status: in_progress`, **halt the scan** and return `null` with a diagnostic: "phase `N` has in-progress tasks — resume explicitly via `--phase N` or close them first". (Rationale: protects against double-dispatch on crash-recovery by forcing the user to decide explicitly.)
   - Else if any task in `T(N)` has `status: open`, return `N`. This is the next open phase.
   - Else (`T(N)` fully closed), continue to `N+1`.
3. If the scan completes with no match, return `null` ("all phases closed for this feature").

Tie-breaking by "lowest N first" is implicit in the ascending order; there are no ties.

### Phase 4 — Validation decisions

**Type check location.** Runs at the **serialization boundary** — inside `readTasksFile` (`src/lib/tasks/io.ts`). Every load of `tasks.json` validates the parsed JSON against the schema and throws on type mismatch. This catches raw-JSON edits the instant any command touches the file (including reads from `list`, `show`, `ready`, and all mutations via the read-mutate-write flow). Rationale: write-time checks can't catch pre-existing bad state; load-time checks can.

**`forge tasks validate` additions** on top of DAG integrity:
- **Type conformance** — structural schema check (same code path as the load-time check, but invoked explicitly; errors, not warnings).
- **Empty `acceptance[]` warning** — task has `status: open` and `acceptance: []`. Warn (not error) because intermediate states during authoring are valid.
- **Orphan label warning** — a label value that is bare (no `:` prefix) and appears on exactly one task within a grouping. Grouping is: tasks sharing the same immediate parent ID, where parent is derived from the ID (e.g. `SK-5.2` and `SK-5.3` share parent `SK-5`; `SK-5.2.1` and `SK-5.2.2` share parent `SK-5.2`). Checked at every nesting level independently.

**Orphan-label carve-outs.** Labels with a known prefix-convention are exempt from the orphan check, because they're expected to be sparse:
- `phase:*` — phase-tagging is per-task, not per-sibling-group.
- `gate:*` — a single human-gated task in a phase is the Phase 5 happy path.
- Any label containing `:` — reserved for future prefix conventions (e.g. `owner:alice`).

The check only fires for bare labels like `frontend`, `needs-testing`, `wip`. Rationale: those are the labels most likely to have drifted during edits; prefix-labels are structured and their presence/absence is meaningful.

**Warnings vs errors.** Errors fail the command (exit 1). Warnings print to stderr, exit 0. `forge tasks validate` prints a summary line so callers can grep: `validate: 0 errors, 2 warnings`.

**No migration tooling.** First load after this phase ships will surface any existing bad state; users fix manually. The load-time check means bad state can't persist unnoticed past the first run — but it also means a malformed `tasks.json` will cause *any* command (including read-only `list` / `show`) to fail with a type error. This is intentional: silent partial reads are what caused issue #4. The error message must cite the field and expected type so `forge tasks edit` (Phase 2) is an obvious next step to fix it.

### Phase 5 — Human-gated tasks decisions
- Gate convention: `labels` contains `gate:human`.
- `forge tasks ready` output gains `gated: boolean` field. Gated tasks are included (not filtered out) so callers decide.
- `forge tasks gate clear <task-id>` removes the `gate:human` label. Idempotent (silent no-op if already cleared).
- `forge run` prompts interactively before dispatching a gated task. Default answer is `N` (skip). `y` clears the gate (persistent) and dispatches.
- Tasks only (not epics). No gate taxonomy beyond `human` in V1.
- Adding a gate at task-create time: use existing `--label gate:human`. No dedicated `--gate` flag in V1.

## Testing Decisions

### What to test

Per phase, the CLI surface:

- **Phase 1**: each new subcommand/flag has unit coverage for happy path + at least one error case (e.g. `delete` refuses non-empty via descendant-by-prefix detection, `--blocked-by` rejects unknown ID, `epic --id` rejects project-wide duplicate via `.epic-lock`, `ready --label` / `--phase` sugar equivalence).
- **Phase 2**: parsing (buffer → task), serialization (task → buffer), round-trip equivalence, crontab-style re-open on validation error, optimistic lock conflict detection (`--force` overwrite path + abort path), `[x]`-present warning emitted to stderr, empty-buffer-on-save treated as abort (not delete). Editor subprocess itself is mocked in tests.
- **Phase 3**: auto-detect picks lowest numeric `phase:N` label value with open tasks; halts on any `in_progress` task in the candidate phase and returns `null` with diagnostic; returns `null` with distinct diagnostic when all phases fully closed; tasks without any `phase:*` label are ignored by the selector. Auto-commit behavior tested under clean vs dirty feature branch (CLI emits the `planningArtifactsDirty` flag; skill-layer commit message format verified separately via skill integration test). `--epic` and `--phase` mutual exclusion enforced at CLI arg-parse time.
- **Phase 4**: each new validation rule has positive + negative tests; validate run on existing dirty fixtures (bad types, empty acceptance, orphan bare-label, prefix-labels like `phase:*` and `gate:*` correctly exempted) produces expected outputs. Separate test: load-time type check fires when `readTasksFile` reads a malformed file.
- **Phase 5**: `ready` output shape includes `gated`; `gate clear` idempotence; `forge run` prompt-then-dispatch flow with both `y` and `N` paths.

### How to test

- Follow existing patterns in `src/__tests__/` and `src/lib/tasks/` (co-located test conventions).
- Use real `tasks.json` fixtures over mocks where possible; mock only the editor subprocess and user TTY input.
- Integration-level test for the "reviewer workflow" success criterion: a fixture representing a pre-review task state; run the full review-fix cycle end-to-end through the CLI; assert the final state matches expected and no shell-out to Python / raw JSON write happened.

## Out of Scope

- **Multi-task editing** in `edit` (`forge tasks edit SK-5 --children`). Single task only in V1.
- **Gate taxonomy beyond `human`** — no `gate:service:*`, `gate:secret:*`, `gate:hardware:*`. V1 is binary.
- **Gates on epics** — task-level only.
- **Three-way merge** on editor-mode concurrency conflict — V1 refuses with a diff; user aborts or `--force` to overwrite.
- **`edit --create`** to open an empty buffer for new tasks — overlaps with `create`.
- **Comment round-tripping** in `edit` buffer — read-only count in header; mutations via `forge tasks comment`.
- **Auto-clearing gates** (e.g. agent detects `SENTRY_DSN` in env) — human-only clearance in V1.
- **Migration tooling** for existing `tasks.json` files — fix on first run is sufficient.
- **Team concurrency** features (distributed locking, multi-user conflict resolution) — solo-dev + agents is the target profile.
- **Observability/metrics** on iteration-pass success (tool-call counts, time-to-first-dispatch, etc.) — the binary success criterion is sufficient.

## Further Notes

### Success criteria (for review gate and close-out)

1. **Primary gate (binary):** The reviewer's full review-fix workflow — self-review → fix → external review → fix → ship — completes end-to-end inside the forge CLI with zero Python scripts and zero raw `tasks.json` edits. Verified by replaying the reviewer's documented workflow against the shipped build (integration test noted in Testing Decisions).
2. **Qualitative sanity check (not a measured gate):** Authors of this PRD dogfood the shipped build on a forge feature and note whether any escape hatches were reached for. No instrumentation required; observation only. If escape hatches keep appearing, a follow-up PRD is warranted.

### Linked brainstorms

- `plans/tasks-editor-mode/brainstorm.md` — Phase 2 design detail
- `plans/human-gated-tasks/brainstorm.md` — Phase 5 design detail

### Reviewer-issue → phase crosswalk

| # | Issue | Phase |
|---|---|---|
| 1 | Auto-commit planning artifacts | 3 |
| 2 | `forge run --epic` argument | 3 |
| 3 | `update --acceptance` replace vs append | 1 (`update --acceptance --replace` flag) + 2 (editor-mode's markdown buffer is implicitly full-replace). Phase 1 provides a direct fix; Phase 2 provides the ergonomic fix. |
| 4 | Acceptance field type not schema-enforced | 4 |
| 5 | Human-gated / prerequisite tasks | 5 |
| 6 | `create --blocked-by` | 1 |
| 7 | `tasks delete` | 1 |
| 8 | Epic ID vs phase number mismatch | 1 (`epic create --id`) |
| 9 | No batch `show --children --full` | 1 |
| 10 | `ready --label/--phase` filter | 1 |
| 11 | Deeper `validate` checks | 4 |
