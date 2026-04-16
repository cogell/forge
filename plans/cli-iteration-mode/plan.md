---
status: active
feature: cli-iteration-mode
created: 2026-04-16
completed: null
execution: phase-prs
---

# Plan: cli-iteration-mode

> Source PRD: plans/cli-iteration-mode/prd.md

## Architectural Decisions

### Two-layer `forge run`
- **CLI layer** — `src/commands/run.ts` reports preconditions as JSON and exits. No orchestration.
- **Skill layer** — `plugin/commands/run.md` is invoked via `/forge:run`, reads the CLI JSON, and performs branch management, task loop, and agent dispatch.
- Phase 3 changes touch both layers; all other phases that reference "forge run" (Phase 5's interactive gate prompt) touch the skill layer only.

### Subcommand dispatcher is the stable extension point
- `src/commands/tasks.ts` holds the `RESERVED` (line 35), `VALUE_FLAGS` (line 43), and `BOOLEAN_FLAGS` (line 50) arrays. Every phase that adds a subcommand or flag updates these lists. No architecture change; mechanical growth.

### I/O boundary for validation
- `src/lib/tasks/io.ts:readTasksFile` is the single serialization boundary. Phase 4 adds a structural schema check here. Every command already goes through this function, so raw-JSON-edit issues surface the instant any command runs.

### Mutation helpers are the single path to writes
- `src/lib/tasks/mutations.ts` holds every write operation. New mutations (`deleteTask`, `clearGate`) land here. The existing `.epic-lock` at `src/lib/tasks/mutations.ts:36-86` guarantees project-wide epic-ID uniqueness; Phase 1's `epic create --id` uses it unchanged.

### Editor-mode isolation
- Phase 2 lands as a new module `src/lib/tasks/editor.ts` that handles buffer render, parse, editor-subprocess plumbing, and optimistic-lock hash. `src/commands/tasks.ts` only dispatches to it. Keeps the new complexity contained.

### Label conventions are the V1 extension mechanism
- `phase:N` — per-task phase tag. Used by `ready --phase <N>`, `forge run` auto-detect, and validate's orphan-label carve-out.
- `gate:human` — human gate marker. Used by `ready` output (`gated: true`), `gate clear`, `forge run` prompt.
- **Any label containing `:`** — reserved prefix convention. Validate's orphan-label check exempts all `:` labels; bare labels are the only ones checked.

### Named constants (avoid magic strings in task agents)

```
GATE_LABEL_HUMAN     = "gate:human"
PHASE_LABEL_PREFIX   = "phase:"
COMMIT_PLAN_TEMPLATE = "chore(<feature>): add Phase <N> plan + tasks"
```

All three appear in 3+ files across phases. Declare these in `src/lib/tasks/types.ts` alongside `SCHEMA_VERSION` and import from there.

### Test layout convention

Existing pattern: one flat test file per module lives in `src/lib/__tests__/` or `src/commands/__tests__/` (e.g. `src/lib/__tests__/tasks.test.ts` covers all of `src/lib/tasks/*`). Match this convention:
- Extend `src/lib/__tests__/tasks.test.ts` and `src/commands/__tests__/tasks.test.ts` for additions to existing modules.
- When a phase introduces a distinct new surface large enough to warrant its own file, add a sibling test file (e.g. Phase 2 → `src/lib/__tests__/tasks-editor.test.ts`; Phase 3 → `src/commands/__tests__/run.test.ts (new)`).
- Do **not** introduce nested `__tests__` directories under subpackages — that would split the convention.

### File structure map

| Path | Phases that touch |
|---|---|
| `src/commands/tasks.ts` | 1, 2, 5 |
| `src/commands/run.ts` | 3 |
| `plugin/commands/run.md` | 3, 5 |
| `src/lib/tasks/types.ts` | 1 (constants), 5 (ReadyTask.gated) |
| `src/lib/tasks/mutations.ts` | 1 (deleteTask, createWithDeps), 5 (clearGate) |
| `src/lib/tasks/queries.ts` | 1 (ready label filter), 5 (gated flag, showWithChildren) |
| `src/lib/tasks/validate.ts` | 4 (type conformance error, empty-acceptance warning, orphan-label info) |
| `src/lib/tasks/io.ts` | 4 (load-time schema check) |
| `src/lib/tasks/editor.ts` *(new)* | 2 |
| `src/lib/__tests__/tasks.test.ts` | every phase (extend) |
| `src/lib/__tests__/tasks-editor.test.ts` *(new)* | 2 |
| `src/commands/__tests__/tasks.test.ts` | 1, 2, 5 (extend) |
| `src/commands/__tests__/run.test.ts` *(new)* | 3 |

## Phase 1: CLI polish — seven iteration-pass additions

**User stories**: 1, 2, 3, 4, 5, plus a Phase-1 slice of reviewer issue #3 (`update --acceptance --replace`) to de-risk it from Phase 2's timeline.

### Files

**Modified:**
- `src/commands/tasks.ts` — grow `RESERVED`/`VALUE_FLAGS`/`BOOLEAN_FLAGS`; add handlers for `delete`, wire `--blocked-by` into `create`, wire `--label`/`--phase` into `ready`, wire `--children`/`--full` into `show`, wire `--id` into `epic create`.
- `src/lib/tasks/mutations.ts` — add `deleteTask(id, { confirm })`; extend `createTask` to accept optional `blockedBy: string[]`; extend `createEpic` to accept optional explicit `id`.
- `src/lib/tasks/queries.ts` — extend `getReadyTasks` signature to accept `{ labels?: string[] }` filter; extend `showTask` to support `{ children: boolean, full: boolean }`.
- `src/lib/tasks/types.ts` — add `PHASE_LABEL_PREFIX`, `GATE_LABEL_HUMAN`, `COMMIT_PLAN_TEMPLATE` constants.

**Test files modified/added** under `src/lib/__tests__/` and `src/commands/__tests__/` mirroring the above.

### What to build

Seven independent additions wired through the existing subcommand dispatcher:

1. **`forge tasks delete <id> --confirm`** — refuses if any descendant exists (ID-prefix scan, same pattern as `getReadyTasks` container detection at `src/lib/tasks/queries.ts:113-128`). Without `--confirm`, prints a preview and exits non-zero. With `--confirm`, removes the task and any dependencies pointing at it from other tasks' `dependencies[]`.
2. **`forge tasks create ... --blocked-by <id>`** — repeatable flag. Each value is added to the new task's `dependencies[]` at creation time. Unknown IDs fail creation; creation is atomic (no partial writes).
3. **`forge tasks ready --label <L>`** — general-form label filter. `--label gate:human` returns only tasks carrying that exact label. Multiple `--label` flags AND together. **`forge tasks ready --phase <N>`** — sugar, translates to `--label phase:<N>` internally.
4. **`forge tasks show <epic-id> --children`** — expands direct children as a nested block. **`--children --full`** recurses through all descendants and renders all fields (description/design/acceptance/notes), not just the summary.
5. **`forge tasks epic create --id <explicit-id>`** — validates uniqueness via the existing `.epic-lock` mechanism (`src/lib/tasks/mutations.ts:36-86`) before writing. Rejects any project-wide collision.
6. **`forge tasks update --acceptance <txt> --replace`** — `--replace` flag that, when paired with `--acceptance`, overwrites `task.acceptance[]` instead of appending. Without `--replace`, existing append behavior is unchanged (backward-compatible). Directly closes reviewer issue #3 in Phase 1 — the Phase 2 editor-mode provides the ergonomic version for humans, but agents and scripts get an immediate flag-driven path that doesn't depend on Phase 2 shipping.
7. **Dispatcher updates in `src/commands/tasks.ts`** — only tokens introduced *by* Phase 1 land here:
   - `RESERVED` gains `delete`.
   - `VALUE_FLAGS` gains `--blocked-by`, `--phase`, `--id`. (`--label` is already present at line 44.)
   - `BOOLEAN_FLAGS` gains `--confirm`, `--children`, `--full`, `--replace`. (`--force` is already present at line 51.)

   Phase 2 adds its own dispatcher entries (`edit` to `RESERVED`; `--editor` to `VALUE_FLAGS`; `--dry-run` to `BOOLEAN_FLAGS`). Phase 5 adds `gate` to `RESERVED`. No scope leakage between phases.

### Acceptance criteria

- [ ] `forge tasks delete SK-5.99 --confirm` removes the task; `delete` without `--confirm` previews and exits non-zero; `delete` on a task with descendants exits non-zero with a message naming the descendants.
- [ ] `forge tasks create <feature> "title" --blocked-by SK-5.1 --blocked-by SK-5.2` creates the task with both IDs in `dependencies[]`; unknown blocker ID fails with non-zero exit; `tasks.json` is unmodified on failure.
- [ ] `forge tasks ready --label gate:human` returns only tasks carrying that label; `--phase 5` returns the same results as `--label phase:5`; multiple `--label` flags intersect (AND).
- [ ] `forge tasks show SK-5 --children` renders direct children in a nested block; `--children --full` renders full fields recursively through descendants.
- [ ] `forge tasks epic create --project --id SK-5.5 "title"` creates the epic with ID `SK-5.5`. A second `--id SK-5.5` anywhere in the project is rejected by the duplicate-ID check performed inside the `.epic-lock` critical section (not by lock contention — by the existence scan that runs under the lock); the second call exits non-zero with a message naming the conflicting epic.
- [ ] `RESERVED` contains `delete`; `VALUE_FLAGS` contains `--blocked-by`, `--phase`, `--id`; `BOOLEAN_FLAGS` contains `--confirm`, `--children`, `--full`, `--replace`. No Phase 2 / Phase 5 tokens added yet.
- [ ] `forge tasks update <id> --acceptance 'a' --acceptance 'b' --replace` sets `acceptance` to exactly `['a', 'b']` regardless of prior contents; same invocation without `--replace` appends (backward compat). `--replace` without `--acceptance` is a no-op.
- [ ] Every new subcommand/flag has at least one happy-path test and one error-case test in the co-located `__tests__/` directories.
- [ ] `pnpm test` passes; `pnpm typecheck` passes.

## Phase 2: `forge tasks edit` — editor-mode for humans

**User stories**: 6, 7, 8, 9, 10, 11

### Files

**Created:**
- `src/lib/tasks/editor.ts` — buffer render/parse, editor subprocess plumbing, optimistic-lock hash.

**Modified:**
- `src/commands/tasks.ts` — add `edit` handler (minimal; delegates to `editor.ts`).
- `src/lib/tasks/index.ts` — re-export `editor.ts` public API.

**Test files:**
- `src/lib/__tests__/tasks-editor.test.ts` — parse, render, round-trip, `[x]` warning, validation re-open, concurrency conflict.
- `src/commands/__tests__/tasks.test.ts (extend)` — subcommand integration, stdio inheritance mocked, `--force` and `--dry-run` paths.

### What to build

- **Buffer renderer** — task → markdown with YAML frontmatter. Frontmatter holds `title`, `priority`, `labels`, `dependencies`. Body holds `## Description`, `## Design`, `## Acceptance`, `## Notes`. Non-editable fields (`id`, `status`, `created`, `closeReason`, `comments`) in a leading comment block for reference only.
- **Buffer parser** — markdown → task. Reject unknown frontmatter keys. Reject unknown body sections. Acceptance parser captures `- [ ]` and `- [x]` lines (text only). If any `- [x]` is present, emit a stderr warning line on save — do not block.
- **Editor subprocess** — spawn with `stdio: inherit`. Editor selected by `$VISUAL` → `$EDITOR` → `vi`. Override via `--editor <cmd>`. Fail fast with a clear message when `process.stdout.isTTY` is false or `CI=true`.
- **Optimistic lock** — hash the task's serialized JSON on open. On save, re-read `tasks.json` and re-hash. If different, print a diff of the server-side change and exit non-zero with guidance to re-run with `--force` (discards the concurrent write) or abort.
- **Crontab-style re-open** — on parse or validation failure, re-open the editor on the same temp file with a leading comment block describing the errors. Preserves user edits. Exit-without-saving aborts.
- **Empty buffer** — treat as abort, not delete. Print a confirmation and exit 0 with no write. (Delete is `forge tasks delete` from Phase 1.)
- **`--dry-run`** — renders the buffer, opens the editor, parses on save, prints the field-by-field diff to stdout, and exits without writing. No concurrency check required.
- **Dispatcher updates in `src/commands/tasks.ts`** — `RESERVED` gains `edit`; `VALUE_FLAGS` gains `--editor`; `BOOLEAN_FLAGS` gains `--dry-run`. (`--force` is already present from the existing codebase.)

### Acceptance criteria

- [ ] `forge tasks edit SK-5.1` opens `$EDITOR` with a correctly rendered buffer; saving unchanged exits with no write; changing one field writes only that change to `tasks.json`.
- [ ] Full round-trip: render → parse → re-render produces byte-identical output. Fixture must include, at minimum, one task per combination of these shapes: empty vs populated `description`/`design`/`notes`, zero vs 1 vs 3+ `acceptance[]` entries, zero vs ≥1 labels (including `phase:N` and `gate:human`), zero vs ≥1 dependencies, `closeReason: null` vs string. The fixture lives at `src/lib/__tests__/fixtures/tasks-roundtrip.json`.
- [ ] On parse error, editor re-opens with the error comment preserved and user edits intact; exit-without-saving aborts cleanly.
- [ ] On validation error (e.g. unknown dependency ID), editor re-opens with the error; abort path exits non-zero with no write.
- [ ] Concurrency conflict: simulate a concurrent write; the second save detects the hash mismatch, prints a diff, and exits non-zero without writing; re-running with `--force` overwrites.
- [ ] `- [x]` in `## Acceptance` emits a stderr line matching the prescribed warning; the write still succeeds; the saved `acceptance[]` contains the text of each item without check-state.
- [ ] Empty buffer on save is treated as abort (no write, exit 0). Does not invoke any delete path.
- [ ] `--dry-run` emits a field-by-field diff to stdout and writes nothing.
- [ ] No TTY / `CI=true` → fails fast with a clear message before spawning the editor.
- [ ] `pnpm test` passes; `pnpm typecheck` passes.

## Phase 3: `forge run` orchestration — two-layer changes

**User stories**: 12, 13, 14

### Files

**Modified:**
- `src/commands/run.ts` — add `--epic`/`--phase` flags (mutually exclusive, exit 2 on both); **relax the existing `if (!feature)` guard at line 18** so that `--epic <id>` alone is accepted without a feature positional (`--phase <N>` still requires the feature); detect dirty planning files; compute `suggestedPhase` via the auto-detect algorithm; emit all of these in the precondition JSON.
- `plugin/commands/run.md` — consume the new JSON fields; commit planning artifacts as `chore(<feature>): add Phase <N> plan + tasks` when dirty; honor explicit `--epic`/`--phase`; use `suggestedPhase` as the default; surface `null` with the CLI-provided diagnostic when neither is available.
- `src/lib/tasks/queries.ts` — add `nextOpenPhase(feature: string): { phase: number | null, diagnostic: string | null }` that implements the auto-detect algorithm from the PRD.

**Test files:**
- `src/lib/__tests__/tasks.test.ts (extend)` — algorithm unit tests covering every branch (all closed, in_progress halt, no phase labels, multiple phases ascending).
- `src/commands/__tests__/run.test.ts (new)` — CLI flag parsing, mutex, JSON output shape including `planningArtifactsDirty`, `suggestedPhase`, `suggestedPhaseDiagnostic`.

### What to build

**CLI layer (`src/commands/run.ts`):**
- Parse `--epic <id>` and `--phase <N>`. Mutually exclusive — if both, exit 2 with a stderr message.
- `--epic` alone is sufficient (project-wide unique via `.epic-lock`); may omit the feature positional. `--phase` still requires the positional.
- Call `nextOpenPhase(feature)` and emit `suggestedPhase: number | null` plus `suggestedPhaseDiagnostic: string | null`.
- Detect dirty planning artifacts: `git status --porcelain -- plans/<feature>/plan.md plans/<feature>/tasks.json` returns non-empty → `planningArtifactsDirty: true`.

**Skill layer (`plugin/commands/run.md`):**
- Before starting the task loop: if `planningArtifactsDirty: true`, stage `plans/<feature>/plan.md` and `plans/<feature>/tasks.json` and commit with message from `COMMIT_PLAN_TEMPLATE` where `<feature>` is the feature name and `<N>` is the chosen phase number.
- Use `--epic` if present; else `--phase`; else `suggestedPhase`. If none of these resolve to a number, stop and print `suggestedPhaseDiagnostic`.

**Query (`src/lib/tasks/queries.ts:nextOpenPhase`):**
- Collect all `phase:N` label values across tasks in the feature. Parse `N` as a number.
- Ascending scan. For each `N`:
  - If any `phase:N` task is `in_progress` → return `{ phase: null, diagnostic: "phase N has in-progress tasks — resume explicitly via --phase N or close them first" }`.
  - Else if any is `open` → return `{ phase: N, diagnostic: null }`.
  - Else continue.
- Exhausted → `{ phase: null, diagnostic: "all phases closed for this feature" }`.

### Acceptance criteria

- [ ] `forge run <feature> --epic X --phase Y` exits 2 with a stderr message; either alone is honored in the JSON output.
- [ ] `forge run --epic SK-5` without a feature positional succeeds and emits the epic in JSON. In this case `suggestedPhase` is `null` and `suggestedPhaseDiagnostic` is `"--epic supplied explicitly; phase auto-detect skipped"` (no feature means no label scope for the auto-detect). `forge run --phase 5` without a feature positional exits 1 (reusing the existing missing-feature guard pattern) with a message matching `"--phase requires a feature positional"`.
- [ ] `nextOpenPhase` returns `{ phase: 2, ... }` when phases 1 and 2 have tasks, phase 1 is all closed, phase 2 has an open task; returns `{ phase: null, diagnostic: "...in-progress..." }` when any `phase:N` task is `in_progress`; returns `{ phase: null, diagnostic: "...all phases closed..." }` on exhaustion; ignores tasks with no `phase:*` label.
- [ ] `forge run <feature>` JSON output includes `suggestedPhase`, `suggestedPhaseDiagnostic`, `planningArtifactsDirty`.
- [ ] When `planningArtifactsDirty` is true, the skill's documented flow commits the artifacts before starting the task loop; commit message matches `COMMIT_PLAN_TEMPLATE`.
- [ ] Manual QA (not a CI gate, documented in the phase-close-out notes): one-time verification that running `forge run cli-iteration-mode` on a dirty plan.md in a throwaway branch produces the expected commit via the skill flow. Record outcome in the phase PR description.
- [ ] `pnpm test` passes; `pnpm typecheck` passes.

## Phase 4: Validation hardening — load-time + deeper `validate`

**User stories**: 15, 16, 17

### Files

**Modified:**
- `src/lib/tasks/io.ts` — extend `readTasksFile` with a structural schema check; throw a typed error on mismatch.
- `src/lib/tasks/validate.ts` — add three checks (type conformance error, empty `acceptance[]` warning, orphan-label info); teach `validateDag` callers to produce a structured result with errors, warnings, and info entries.
- `src/commands/tasks.ts` — `validate` subcommand prints a summary line `validate: N errors, M warnings`.

**Test files:**
- `src/lib/__tests__/tasks.test.ts (extend)` — malformed JSON surfaces through every command path.
- `src/lib/__tests__/tasks.test.ts (extend)` — each new rule, positive + negative; carve-outs for `phase:*`, `gate:*`, and `:`-labels.

### What to build

**Load-time schema check in `readTasksFile`:**
- `readTasksFile` (`src/lib/tasks/io.ts:109-155`) already performs partial validation (checks `epics[].id`, `tasks[].id`, `tasks[].status` enum, and errors on `version > SCHEMA_VERSION`). **Extend** this check — do not replace, do not tighten the version check — to cover every field in the `Task` interface: `title: string`, `priority: number`, `labels: string[]`, `description: string`, `design: string`, **`acceptance: string[]`** (the reviewer-reported blind spot), `notes: string`, `dependencies: string[]`, `comments: Comment[]`, `closeReason: string | null`. The existing one-way version tolerance stays (`version > SCHEMA_VERSION` errors; lower or equal passes).
- On mismatch, throw an error naming the field and expected type. The error message **must** include the literal substring `forge tasks update` as the recovery hint — `update` is the incumbent mutation command and always exists, so this stays phase-independent. The message may additionally mention `forge tasks edit` as a "preferred when available" hint, but must not rely on its existence. Update any existing error messages in `readTasksFile` to include the `forge tasks update` substring too (so the recovery hint is consistent).
- Applies to every caller (list, show, ready, every mutation). No command silently reads partial state.

**Extended `validate` checks:**
- **Type conformance** — invoke the same structural checker from `io.ts`; surface issues as errors (exit 1).
- **Empty acceptance warning** — for every task with `status: "open"` and `acceptance.length === 0`, emit a warning (exit still 0).
- **Orphan label info** (not warning — see below) — group tasks by immediate parent (derived from ID: `SK-5.2` → parent `SK-5`; `SK-5.2.1` → parent `SK-5.2`). For each sibling group and each bare label (no `:` in the label), if the label appears on exactly one task in the group → emit an `info:` line. Labels containing `:` are exempt (carve-out for `phase:*`, `gate:*`, future prefix conventions).

**Info vs warning rationale:** bare labels like `needs-testing`, `wip`, `blocked-external` are legitimately applied to exactly one task in a group (surgical tagging). A warning would cry wolf and train users to ignore `validate` output. `info:` is passive — it surfaces the asymmetry for a human to judge, without implying an action is required. It does not count toward the `M warnings` tally in the summary line.

**Summary line:** `validate: N errors, M warnings` printed last. Greppable for scripts. Info lines print to stderr but are not tallied.

**Severity mapping:**
- `error:` — type conformance mismatch. Fails the command (exit 1). Counted as N errors.
- `warning:` — empty `acceptance[]` on an open task. Exit 0. Counted as M warnings.
- `info:` — orphan bare-label. Exit 0. Not counted.

### Acceptance criteria

- [ ] A `tasks.json` manually edited to set `acceptance: "a string"` causes `forge tasks list` (and every other command) to fail at the load boundary with an error naming `acceptance` and `string[]`.
- [ ] Error message from the load-time check includes the literal phrase `forge tasks update` so users see the recovery path (independent of whether Phase 2's `edit` has shipped).
- [ ] `forge tasks validate` fails with exit 1 on a fixture with a type error; passes with exit 0 on a fixture with empty `acceptance[]` and the warning is present on stderr.
- [ ] Orphan-label check: a fixture with three sibling tasks where only one carries label `frontend` emits an `info:` line (not a `warning:` line) and does **not** increment the `M warnings` tally; same fixture where only one carries label `phase:5` emits no info line; same fixture where only one carries label `gate:human` emits no info line.
- [ ] Version handling unchanged: a `tasks.json` with `version` greater than `SCHEMA_VERSION` errors at the load boundary (existing behavior); a file at `SCHEMA_VERSION` or earlier loads without the version check firing.
- [ ] Summary line `validate: N errors, M warnings` prints last on stdout.
- [ ] `pnpm test` passes; `pnpm typecheck` passes.

## Phase 5: Human-gated tasks

**User stories**: 18, 19, 20, 21

### Files

**Modified:**
- `src/lib/tasks/types.ts` — extend `ReadyTask` with `gated: boolean`.
- `src/lib/tasks/queries.ts:getReadyTasks` — compute `gated` for every returned task (true iff `labels` contains `GATE_LABEL_HUMAN`).
- `src/lib/tasks/mutations.ts` — add `clearGate(id)` that removes `GATE_LABEL_HUMAN` from the task's `labels`. Idempotent.
- `src/commands/tasks.ts` — add `gate` subcommand with `clear <task-id>` action; `gate` joins `RESERVED`.
- `plugin/commands/run.md` — before dispatching any task where `gated: true`, prompt the user: `"SK-5.1 is human-gated.\n  Title: <title>\n  Have you completed the prerequisite? (y/N)"`. `y` calls `forge tasks gate clear <id>`, then proceeds. `N` (default) skips to the next ready task.

**Test files:**
- `src/lib/__tests__/tasks.test.ts (extend)` — gated flag correctness across shapes.
- `src/lib/__tests__/tasks.test.ts (extend)` — idempotence, unknown-ID behavior.
- `src/commands/__tests__/tasks.test.ts (extend)` — subcommand integration.

### What to build

- Extend `ReadyTask` to include `gated: boolean`. `getReadyTasks` sets it per task; filter composition with Phase 1's `--label` flag is unchanged (a task labeled `gate:human` still appears, still marked `gated: true`).
- `clearGate(id)` — mutation that removes `GATE_LABEL_HUMAN` from `labels`. Silent no-op if the label isn't present. Uses existing atomic-write path.
- `forge tasks gate clear <task-id>` — thin dispatcher over `clearGate`. Unknown task ID fails with non-zero exit and clear message.
- Skill-layer prompt in `plugin/commands/run.md` — described above. The prompt is documented as part of the skill's orchestration flow; the CLI binary does not change for this.
- Task authors continue to use the existing `--label gate:human` at creation time. No `--gate` flag in V1.
- **Dispatcher updates in `src/commands/tasks.ts`** — `RESERVED` gains `gate`.

### Acceptance criteria

- [ ] `forge tasks ready --json` output includes `gated: boolean` on every entry; true iff `labels` contains `gate:human`.
- [ ] `forge tasks ready --label gate:human` returns only gated tasks (Phase 1 filter composes correctly).
- [ ] `forge tasks gate clear SK-5.1` removes `gate:human` from that task's labels; running it again is a no-op (exit 0, no diff).
- [ ] `forge tasks gate clear UNKNOWN-ID` exits non-zero with a clear message; `tasks.json` is unmodified.
- [ ] `plugin/commands/run.md` contains the literal prompt string `"is human-gated"` and the decision logic described in Phase 5's "What to build" (grep-test on the skill markdown, not a runtime test).
- [ ] Manual QA (not a CI gate): add a `gate:human` label to a test task, run `/forge:run cli-iteration-mode`, confirm the prompt appears and `N` skips to the next ready task. Record outcome in the phase PR description.
- [ ] `pnpm test` passes; `pnpm typecheck` passes.
