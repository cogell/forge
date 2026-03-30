---
status: active
feature: tasks
created: 2026-03-27
completed: null
---

# PRD: Built-in Task System

## Problem Statement

Forge requires the beads (`bd`) CLI for task decomposition and execution tracking. Beads is a powerful tool — forge uses roughly 5% of its capabilities (create, list, ready, close, dep add, validate). This creates a distribution barrier: users must install and configure a heavyweight external dependency before they can use forge's full pipeline. A built-in task system covering forge's actual needs would make forge self-contained and easier to adopt.

## Solution

Replace the bd integration with a lightweight, built-in task system. Tasks are stored as JSON files — `plans/<feature>/tasks.json` for feature-scoped work and `plans/tasks.json` for project-level tasks not tied to any feature. Each file can contain multiple epics (e.g., one per plan phase). Task IDs use a configurable project key (set in `forge.json`), making them globally unique and unambiguous regardless of feature or epic naming. The forge CLI handles all task operations, including cross-worktree state updates by resolving back to the main worktree's task file through git internals.

## User Stories

### Decomposition

1. As a forge agent, I want to create an epic with child tasks and structured fields (description, design, acceptance criteria, notes) in `tasks.json`, so the full task DAG is captured alongside the plan.
2. As a forge agent, I want to create multiple epics per feature (e.g., one per plan phase), so phased work is organized within a single task file.
3. As a forge agent, I want to set dependencies between tasks — including across epics — so execution ordering is enforced.
4. As a forge agent, I want to validate the task DAG (no cycles, all dependency references exist, every task's epic exists, no duplicate IDs), so structural errors are caught before execution begins.
5. As a forge agent, I want to expand a complex task (complexity 7+) into sub-tasks with nested IDs (e.g., `FORGE-1.1.1`), so complexity is decomposed to manageable units. Max 3 levels deep.

### Querying

6. As a forge agent, I want to query ready tasks (unblocked, not yet claimed), so I know what to work on next. A task is ready when it is a leaf (no children), its status is `open`, and all dependencies are `closed` or `in_progress`.
7. As a forge user, I want to list all tasks for a feature with their statuses, so I can see progress at a glance.
8. As a forge agent, I want to show a single task's full details, so I can pass its description/design/acceptance criteria to a task agent.

### Status Updates

9. As a forge orchestrator agent, I want to close a task with a reason, so completion is tracked and available to the reflection step.
10. As a task agent running in a worktree, I want to mark my task as `in_progress`, so other agents and the orchestrator know it's claimed. The forge CLI resolves the task file location back to the main worktree regardless of which worktree I'm in.
11. As a forge agent, I want to add a comment to a task (review feedback, salvage diagnosis, failure notes), so the execution history is preserved in the task file.
12. As a forge agent, I want to add labels to a task (e.g., `needs-human`), so tasks can be categorized and filtered.
13. As a forge agent, I want to update task fields (title, description, design, notes, priority) after creation, so tasks can be refined during execution.

### Parallel Execution

14. As a forge orchestrator running parallel task agents, I want `in_progress` dependencies treated as non-blocking for the `ready` query, so parallel agents can proceed without waiting for sequential close ordering.
15. As a forge agent, I want to close a task whose `in_progress` dependency hasn't closed yet by passing `--force`, so parallel execution can complete out of dependency order.
16. As a forge agent in a worktree, I want concurrent writes to the task file to be safe via file locking, so parallel agents don't corrupt state.

### Project-level Tasks

17. As a forge user, I want to create tasks in `plans/tasks.json` that aren't tied to any feature, so cross-cutting or administrative work is tracked in the same system.
18. As a forge user, I want `forge tasks ready` (no feature) to return ready tasks from all features AND project-level tasks, so I see all available work.

### Pipeline Integration

19. As `forge status`, I want to read `tasks.json` to determine feature progress (total tasks, closed, open, in_progress), aggregated across all epics in the file, so the pipeline state machine works without bd.
20. As `forge reflect`, I want to read `tasks.json` to see what was planned vs. what happened — close reasons, comments, labels — so reflections are informed by execution history.
21. As `forge run`, I want to use `forge tasks` commands instead of `bd` commands throughout the orchestration flow, so bd is not required.

### Edge Cases

22. As a forge agent, when I try to close a task whose blocking dependency is still `open`, I want an error explaining which dependency is unmet — even with `--force` — so structurally invalid closes are prevented.
23. As a forge user, when `tasks.json` doesn't exist for a feature, I want `forge status` to report `needs-tasks` (not crash), so the pipeline degrades gracefully.
24. As a forge user, I want `tasks.json` to be human-readable and produce clean git diffs, so I can review task changes in PRs.
25. As a forge agent, when I update a task's status back to `open`, I want `closeReason` automatically cleared, so stale close metadata doesn't persist.

## Implementation Decisions

### Project key

Task IDs use a project key prefix configured in `forge.json` at the project root:

```json
{
  "prefix": "FORGE"
}
```

The prefix must be uppercase alphanumeric (no hyphens), 2-10 characters. `forge init` prompts for a prefix and writes `forge.json`. Any `forge tasks` command that needs the prefix checks for `forge.json` first — if missing, it exits with: `"No project key configured. Run forge init to set one."` All task IDs across the project share this prefix, making them globally unique and unambiguously parseable: split on the first `-`, left side is the prefix, right side is the dot-separated numeric path.

### Storage format

Two file locations, same schema:

- `plans/<feature>/tasks.json` — tasks scoped to a feature, co-located with its PRD and plan
- `plans/tasks.json` — project-level tasks not tied to any feature

The file schema:

```json
{
  "version": 1,
  "epics": [
    {
      "id": "FORGE-1",
      "title": "Phase 1: Core Foundation",
      "created": "2026-03-27"
    },
    {
      "id": "FORGE-2",
      "title": "Phase 2: CLI Integration",
      "created": "2026-03-28"
    }
  ],
  "tasks": [
    {
      "id": "FORGE-1.1",
      "title": "Task title",
      "status": "open",
      "priority": 2,
      "labels": ["complexity:3", "phase:1"],
      "description": "WHAT: 2-4 sentence problem statement",
      "design": "HOW: types, interfaces, file paths, pseudo-code",
      "acceptance": ["First criterion", "Second criterion"],
      "notes": "Files: path/to/file.ts (create), path/to/other.ts (modify)",
      "dependencies": [],
      "comments": [
        { "message": "Review feedback text", "timestamp": "2026-03-27T14:30:00Z" }
      ],
      "closeReason": null
    }
  ]
}
```

Epic-to-task membership is structural: task `FORGE-1.1` belongs to epic `FORGE-1` because its ID starts with the epic's numeric prefix. A file can contain multiple epics (e.g., one per plan phase). The `version` field enables future schema migrations.

Epic status is computed on read — an epic is open if it has zero tasks OR any of its tasks are open or in_progress; closed only if it has at least one task and all its tasks are closed. Comments are objects with `message` (string) and `timestamp` (ISO 8601). Parent-child relationships between tasks are implicit from the ID structure (dotted notation). Dependencies are stored as an array of task IDs on each task. Cross-epic dependencies are allowed (task `FORGE-2.1` can depend on `FORGE-1.3`).

Feature context is derived from the file's directory path (`plans/<feature>/tasks.json`), not stored in the schema. For project-level tasks (`plans/tasks.json`), there is no feature association.

**Empty file handling:** A scaffolded tasks.json with no epics or no tasks (`"epics":[]` or all epics have zero tasks) is treated as `null` by the query layer — the pipeline maps this to `needs-tasks`, not `in-progress`. The file's existence alone does not signal that decomposition is complete.

**JSON formatting:** All writers (CLI commands and direct agent writes) must produce 2-space-indented JSON with a trailing newline. Keys appear in schema definition order (version, epics, tasks; then within tasks: id, title, status, priority, labels, description, design, acceptance, notes, dependencies, comments, closeReason). Consistent formatting prevents noisy git diffs.

### ID format

`<PREFIX>-<N>` for epics, `<PREFIX>-<N>.<M>` for tasks, `<PREFIX>-<N>.<M>.<K>` for sub-tasks. Sequential integers assigned at creation time. Max 3 levels of nesting.

Epic numbers are globally sequential across the project. When creating a new epic, the CLI scans all `plans/**/tasks.json` files for the maximum epic number and increments. This guarantees global uniqueness without cross-file coordination.

Since the prefix is a known, configured value (no hyphens), parsing is unambiguous: split the ID on the first `-` to separate prefix from numeric path. This allows feature names to contain hyphens freely.

### Task statuses

Three statuses only: `open`, `in_progress`, `closed`. No custom statuses, no frozen/deferred. This covers forge's execution model (ready → claimed → done) without the complexity of bd's full status system.

When a task's status is set back to `open` (from `in_progress` or `closed`), `closeReason` is automatically cleared to prevent stale metadata.

### Dependency semantics

One type: `blocks`. A task's `dependencies` array lists the IDs of tasks that block it. A task is ready when it is a leaf (no children), its status is `open`, and all dependencies are `closed` or `in_progress`. The `in_progress` exception enables parallel execution — matching the current behavior documented in `run-process.md`.

Cross-epic dependencies are allowed. Task `FORGE-2.1` can depend on `FORGE-1.3`, even across different files. The CLI resolves IDs across all `plans/**/tasks.json` files when checking dependencies.

### Close validation

Closing a task checks all entries in its `dependencies` array:

| Dep status     | `close`   | `close --force` |
|----------------|-----------|------------------|
| `closed`       | allowed   | allowed          |
| `in_progress`  | error     | allowed          |
| `open`         | error     | error            |

`--force` relaxes the `in_progress` constraint for parallel execution (tasks finishing out of dependency order). An `open` dependency always blocks closing — even with `--force` — because it means upstream work hasn't started, making downstream completion structurally invalid.

A `closed` task always satisfies its dependents, regardless of close path (normal close, `--force` close, or closed with `needs-human` label). Downstream tasks check only status, not how closure happened.

### Parent-child lifecycle

Parent-child is structural (from dotted IDs), not a dependency type. A task that has children is a **container** — it is not directly workable and does not appear in `ready` query results.

- The `ready` query returns only **leaf tasks** (tasks with no children)
- When all children of a container are `closed`, the container **auto-closes** with `closeReason: "all children closed"`
- Auto-close cascades upward — if a container's auto-close causes all siblings of its parent to be closed, the grandparent auto-closes too
- Closing a container directly is an error if it has open or in_progress children
- Children are parallel by default; only explicit `dependencies` entries create sequencing
- Auto-close is **synchronous** — it happens within the same file-locked write operation that closes the last child. This prevents a race window where concurrent agents see a stale open container between the child close and the auto-close

### Worktree path resolution

When the forge CLI runs inside a git worktree, it resolves back to the main worktree to find task files. In a worktree, `.git` is a file containing `gitdir: /path/to/main/.git/worktrees/<name>`. The CLI follows this to find the real repo root, then reads/writes the task file there.

This enables task agents in worktrees to update their own status (e.g., mark `in_progress`) without the orchestrator acting as a proxy.

### File locking

Advisory file lock on `<tasks-file>.lock` (e.g., `plans/<feature>/tasks.json.lock`) for all write operations. Lock is held for the shortest possible duration: lock → read → modify → write → unlock. This prevents corruption from concurrent agent writes during parallel execution.

Lock acquisition waits up to 5 seconds with 100ms retry intervals. If the lock cannot be acquired, the command exits with a clear error: `"Could not acquire lock on tasks.json — another forge process may be writing. Retry in a moment."`

**Stale lock recovery:** The lock file stores the PID of the holding process. On acquisition failure, the CLI checks whether the PID is still alive. If the process is dead, the lock is considered stale and automatically reclaimed. This prevents permanent lockout from crashed processes.

### CLI commands

The `forge tasks` command uses a subcommand model:

- `forge tasks <feature>` — validate preconditions (plan exists) and scaffold an empty `tasks.json` (`{"version":1,"epics":[],"tasks":[]}`). If `tasks.json` already exists, show epic and task summary and exit normally. The agent then creates epics and tasks using the commands below — guided by the process in `plugin/commands/tasks.md`. For project-level tasks, use `forge tasks --project` to scaffold `plans/tasks.json`.
- `forge tasks epic create <feature|--project> "title"` — create a new epic, return its ID. Scans all `plans/**/tasks.json` files to assign the next sequential epic number.
- `forge tasks create <feature|--project> "title" --parent <id> [--priority N] [--label <label>]... [-d "..."] [--design "..."] [--acceptance "criterion"]... [--notes "..."]` — create a task under the given parent (epic or task). `--parent` defaults to the sole epic when only one exists; required when multiple epics are present. `--acceptance` and `--label` accept multiple values via repeated flags.
- `forge tasks ready [feature]` — list unblocked leaf tasks. When `feature` is omitted, scans all `plans/**/tasks.json` files and returns ready tasks across the project (matching current `getReadyTasks()` behavior).
- `forge tasks list [feature]` — list all tasks with status. When `feature` is omitted, lists across all features and project-level.
- `forge tasks show <id>` — show full task details.
- `forge tasks close <id> [--reason "..."] [--force]` — close a task. See close validation table.
- `forge tasks update <id> [--status <status>] [--priority <N>] [--title "..."] [-d "..."] [--design "..."] [--notes "..."]` — update one or more task fields. Setting status to `open` auto-clears `closeReason`.
- `forge tasks comment <id> "message"` — append a comment with auto-generated timestamp.
- `forge tasks label <id> <label>` — add a label.
- `forge tasks dep add <blocked> <blocker>` — add dependency.
- `forge tasks dep remove <blocked> <blocker>` — remove dependency.
- `forge tasks validate <feature|--project>` — validate DAG integrity: no cycles, no duplicate IDs, all dependency references exist (including cross-file), every task's epic (derived from ID) exists in the epics array.

All commands support `--json` for machine-readable output.

**Bulk creation:** During decomposition, the agent is the sole writer — there is no parallel execution risk. The agent may write `tasks.json` directly (bypassing CLI commands and file locking) for efficiency, then run `forge tasks validate <feature>` to verify structural integrity before execution begins. Direct file writes must use the canonical JSON formatting (2-space indent, schema key order, trailing newline). **Important:** Direct writes are only valid from the main worktree context. Task agents running in git worktrees must use CLI commands, which handle worktree path resolution to the main repo's task file. CLI commands remain available for atomic, lock-safe operations during execution.

Subcommand names (`ready`, `list`, `show`, `create`, `close`, `update`, `comment`, `label`, `dep`, `validate`, `epic`) are reserved — features must not use these as names. The CLI checks subcommands first; an unrecognized positional argument is treated as a feature name.

### Pipeline and source code changes

Replace `src/lib/beads.ts` (which shells out to `bd`) with a new `src/lib/tasks.ts` module that reads `plans/**/tasks.json` directly. This module provides equivalent data to the existing `EpicInfo` and `ReadyTask` interfaces — aggregating task counts across all epics in a feature's task file — so the pipeline state machine and status formatting continue to work. The `EpicInfo` interface evolves to include an `epics` field listing individual epic IDs and titles for display. The query returns `null` when `tasks.json` does not exist OR when it exists but contains no tasks (empty scaffold) — both map to `needs-tasks`. For `allClosed`, an epic with zero tasks is NOT considered closed; all epics must have at least one task and all tasks must be closed.

Source files that import from `beads.ts` — `pipeline.ts`, `commands/tasks.ts`, `commands/run.ts`, `commands/reflect.ts`, `commands/status.ts`, and `format.ts` — update their imports to the new `tasks.ts` module. The `suggestAction()` function in `pipeline.ts` changes `bd ready` to `forge tasks ready` for the `in-progress` stage. The `isBdAvailable()` check is removed — forge no longer depends on an external CLI for task operations.

### Guidance updates

All `bd` command references change to the corresponding `forge tasks` commands. Affected files:

**Guidance:**
- `guidance/tasks-process.md` — all `bd create`, `bd dep add`, `bd swarm validate` examples
- `guidance/run-process.md` — `bd ready`, `bd close`, `bd comment`, `bd update`, `bd label`, prerequisites
- `guidance/review-gates.md` — "Tasks review (beads)" section, `bd list` output format, `bd swarm validate`
- `guidance/philosophy.md` — `.beads/` directory reference in three-layer model
- `guidance/docs-process.md` — `.beads/` layer reference
- `guidance/plan-process.md` — beads DAG reference

**Plugin commands:**
- `plugin/commands/tasks.md` — full decomposition process, bd command examples
- `plugin/commands/run.md` — prerequisites, task loop, orchestration protocol
- `plugin/commands/status.md` — `bd ready` reference, stage descriptions
- `plugin/commands/reflect.md` — beads reference
- `plugin/commands/docs.md` — beads reference
- `plugin/commands/plan.md` — beads reference

**Other:**
- `skills/forge/SKILL.md` — description, command table, stage mapping, layer model
- `README.md` — prerequisites, quick start examples

## Testing Decisions

### DAG logic (unit tests)

- Cycle detection: DAG with no cycles passes; DAG with a direct cycle fails; DAG with a transitive cycle fails
- Ready query: leaf task with no deps is ready; leaf task with all deps closed is ready; leaf task with an `in_progress` dep is ready; leaf task with an `open` dep is not ready; container task (has children) is never ready
- Parent-child: auto-close triggers when last child closes; auto-close cascades to grandparent; closing container with open children is an error
- Close validation: all 6 cells of the close validation table produce correct behavior
- Topological sort: produces valid execution order
- Validation: cycles flagged; orphan dependency references flagged; orphan epic references flagged (task ID references epic not in epics array); duplicate IDs flagged
- Cross-epic dependencies: task in epic 2 blocked by task in epic 1 resolves correctly
- Status revert: setting status back to `open` clears `closeReason`
- Empty epic not closed: epic with 0 tasks is not considered closed for `allClosed` aggregation

### File operations (unit tests)

- Worktree path resolution: finds main worktree from a child worktree's `.git` file
- File locking: concurrent writes don't corrupt JSON; lock timeout produces a clear error
- Malformed JSON: clear error message, no crash
- Multi-file scanning: `ready` and `list` without feature aggregate across all `plans/**/tasks.json` files
- Global epic numbering: new epic gets next sequential number across all files
- Stale lock recovery: dead PID in lock file is detected and lock is reclaimed

### CLI commands (integration tests)

- Full lifecycle: scaffold → create epic → add tasks → set deps → validate → ready → update status → close → verify state
- Multi-epic: two epics in same feature, tasks in each, cross-epic dependency
- Parallel close: two tasks close with `--force` while deps are `in_progress`
- Close rejected: `--force` with `open` dep still errors
- Feature with no tasks.json: commands degrade gracefully with helpful error
- Bulk write: agent writes tasks.json directly, validate passes
- Project-level tasks: scaffold with `--project`, create epic and tasks, verify `ready` includes them
- Update fields: update title, priority, description via `forge tasks update`
- Cross-file deps: task in feature A depends on task in feature B, close validation resolves correctly
- Cross-file cycle: cycle spanning two features' tasks.json files is detected by validate
- Empty tasks.json: scaffolded file with no tasks → pipeline reports `needs-tasks`, not `in-progress`
- forge.json missing: `forge tasks` exits with clear error directing to `forge init`
- Prefix validation: rejects hyphens, empty, too short (<2), too long (>10), lowercase
- Auto-close synchronicity: close last child under concurrent access, verify parent auto-closes atomically

### Pipeline integration (integration tests)

- `forge status` reads `tasks.json` and reports correct stage
- Feature with tasks.json where all tasks are closed → stage is `needs-reflection`
- Feature with multiple epics, all tasks closed → stage is `needs-reflection`
- Project-level tasks don't affect feature pipeline stages

## Out of Scope

- Migration tool from bd to forge tasks — users start fresh with forge's built-in system
- bd adapter or compatibility layer — this is a full replacement, not a wrapper
- Molecule/formula/template system — forge's pipeline is managed by its own state machine
- Memory system (bd remember/recall) — forge has its own guidance files and reflection artifacts
- Custom statuses beyond open/in_progress/closed
- Custom dependency types beyond blocks
- DAG visualization (mermaid/ASCII output) — could add later
- Audit logging (bd audit) — task comments and close reasons provide sufficient history
- Sync/federation — tasks travel with the repo via git
- Task search by text query — list and show cover forge's needs
- Multiple project keys — one prefix per project
- Task deletion — close with reason covers the use case; editing the file directly is available for corrections
- Label removal — not needed for forge's current workflow
- Acceptance criteria update via CLI — edit the file directly or re-create the task
