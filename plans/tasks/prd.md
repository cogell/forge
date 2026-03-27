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

Replace the bd integration with a lightweight, built-in task system. Tasks are stored as JSON files at `plans/<feature>/tasks.json` — co-located with planning artifacts, transparent in git diffs, and directly available to the reflection step. The forge CLI handles all task operations, including cross-worktree state updates by resolving back to the main worktree's task file through git internals.

## User Stories

### Decomposition

1. As a forge agent, I want to create an epic with child tasks and structured fields (description, design, acceptance criteria, notes) in `tasks.json`, so the full task DAG is captured alongside the plan.
2. As a forge agent, I want to set dependencies between tasks, so execution ordering is enforced.
3. As a forge agent, I want to validate the task DAG (no cycles, all dependency references exist), so structural errors are caught before execution begins.
4. As a forge agent, I want to expand a complex task (complexity 7+) into sub-tasks with nested IDs (e.g., `feature-1.1.1`), so complexity is decomposed to manageable units. Max 3 levels deep.

### Querying

5. As a forge agent, I want to query ready tasks (unblocked, not yet claimed), so I know what to work on next. A task is ready when its status is `open` and all dependencies are `closed` or `in_progress`.
6. As a forge user, I want to list all tasks for a feature with their statuses, so I can see progress at a glance.
7. As a forge agent, I want to show a single task's full details, so I can pass its description/design/acceptance criteria to a task agent.

### Status Updates

8. As a forge orchestrator agent, I want to close a task with a reason, so completion is tracked and available to the reflection step.
9. As a task agent running in a worktree, I want to mark my task as `in_progress`, so other agents and the orchestrator know it's claimed. The forge CLI resolves the task file location back to the main worktree regardless of which worktree I'm in.
10. As a forge agent, I want to add a comment to a task (review feedback, salvage diagnosis, failure notes), so the execution history is preserved in the task file.
11. As a forge agent, I want to add labels to a task (e.g., `needs-human`), so tasks can be categorized and filtered.

### Parallel Execution

12. As a forge orchestrator running parallel task agents, I want `in_progress` dependencies treated as non-blocking for the `ready` query, so parallel agents can proceed without waiting for sequential close ordering.
13. As a forge agent, I want to close a task whose dependency is still `in_progress` by passing `--force`, so parallel execution can complete out of dependency order.
14. As a forge agent in a worktree, I want concurrent writes to the task file to be safe via file locking, so parallel agents don't corrupt state.

### Pipeline Integration

15. As `forge status`, I want to read `tasks.json` to determine feature progress (total tasks, closed, open, in_progress), so the pipeline state machine works without bd.
16. As `forge reflect`, I want to read `tasks.json` to see what was planned vs. what happened — close reasons, comments, labels — so reflections are informed by execution history.
17. As `forge run`, I want to use `forge tasks` commands instead of `bd` commands throughout the orchestration flow, so bd is not required.

### Edge Cases

18. As a forge agent, when I try to close a task whose blocking dependency is still `open` (not `in_progress`, actually `open`), I want an error explaining which dependency is unmet, so I don't close tasks out of valid order.
19. As a forge user, when `tasks.json` doesn't exist for a feature, I want `forge status` to report `needs-tasks` (not crash), so the pipeline degrades gracefully.
20. As a forge user, I want `tasks.json` to be human-readable and produce clean git diffs, so I can review task changes in PRs.

## Implementation Decisions

### Storage format

Single JSON file per feature at `plans/<feature>/tasks.json`. This was chosen over SQLite because forge's philosophy is filesystem transparency — plans, PRDs, and now tasks are all readable files that travel with the repo. JSON produces clean git diffs and can be read by any tool.

The file schema:

```json
{
  "epic": {
    "id": "feature-1",
    "title": "Phase 1: Title",
    "feature": "feature",
    "created": "2026-03-27"
  },
  "tasks": [
    {
      "id": "feature-1.1",
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

The epic object is metadata. Its `status` field is not stored — it is computed on read (open if any task is open/in_progress, closed if all tasks are closed). The stored field in the schema above is for illustration; the implementation computes it from task states. The epic provides `epicId`, `title`, and `feature` fields that `forge status` needs to display progress. Comments are objects with `message` (string) and `timestamp` (ISO 8601). Parent-child relationships are implicit from the ID structure (dotted notation). Dependencies are stored as an array of task IDs on each task.

### ID format

`<feature>-<N>` for epics, `<feature>-<N>.<M>` for tasks, `<feature>-<N>.<M>.<K>` for sub-tasks. Sequential integers assigned at creation time. Max 3 levels of nesting.

Feature-prefixed IDs are globally unique across features, so agents can reference them unambiguously in logs, commits, and comments.

### Task statuses

Three statuses only: `open`, `in_progress`, `closed`. No custom statuses, no frozen/deferred. This covers forge's execution model (ready → claimed → done) without the complexity of bd's full status system.

### Dependency semantics

One type: `blocks`. A task's `dependencies` array lists the IDs of tasks that block it. A task is ready when all its dependencies are `closed` or `in_progress`. The `in_progress` exception enables parallel execution — matching the current behavior documented in `run-process.md`.

A `closed` task always satisfies its dependents, regardless of how it was closed (normal close, `--force` close, or closed with `needs-human` label). This is the key invariant for parallel execution: downstream tasks check only status, not close path.

Parent-child is structural (from dotted IDs), not a dependency type. Children are parallel by default; only explicit `dependencies` entries create sequence.

### Worktree path resolution

When the forge CLI runs inside a git worktree, it resolves back to the main worktree to find `plans/<feature>/tasks.json`. In a worktree, `.git` is a file containing `gitdir: /path/to/main/.git/worktrees/<name>`. The CLI follows this to find the real repo root, then reads/writes the task file there.

This enables task agents in worktrees to update their own status (e.g., mark `in_progress`) without the orchestrator acting as a proxy.

### File locking

Advisory file lock on `plans/<feature>/tasks.json.lock` for all write operations. Lock is held for the shortest possible duration: lock → read → modify → write → unlock. This prevents corruption from concurrent agent writes during parallel execution.

Lock acquisition waits up to 5 seconds with 100ms retry intervals. If the lock cannot be acquired, the command exits with a clear error: `"Could not acquire lock on tasks.json — another forge process may be writing. Retry in a moment."`

### CLI commands

The existing `forge tasks <feature>` command shifts to a subcommand model:

- `forge tasks <feature>` — validate preconditions (plan exists) and scaffold an empty `tasks.json` with the epic metadata. If `tasks.json` already exists, print existing epic info and task counts (matching current behavior) and exit normally. The agent then uses `forge tasks create`, `forge tasks dep add`, and `forge tasks validate` to populate the DAG — guided by the process in `plugin/commands/tasks.md`. This matches the current pattern: the CLI validates and scaffolds, the agent decomposes.
- `forge tasks ready [feature]` — list unblocked tasks. When `feature` is omitted, scans all features in `plans/` and returns ready tasks across the project (matching current `getReadyTasks()` behavior which returns all ready tasks globally).
- `forge tasks list [feature]` — list all tasks with status. When `feature` is omitted, lists tasks across all features.
- `forge tasks show <id>` — show full task details
- `forge tasks create <feature> "title" [--priority N] [--parent <id>] [--label ...] [-d "..."] [--design "..."] [--acceptance "..."] [--notes "..."]` — create a task and append to `tasks.json`
- `forge tasks close <id> [--reason "..."] [--force]` — close a task
- `forge tasks update <id> --status <status>` — update task status
- `forge tasks comment <id> "message"` — append a comment
- `forge tasks label <id> <label>` — add a label
- `forge tasks dep add <blocked> <blocker>` — add dependency
- `forge tasks dep remove <blocked> <blocker>` — remove dependency
- `forge tasks validate <feature>` — validate DAG integrity

All commands support `--json` for machine-readable output.

Subcommand names (`ready`, `list`, `show`, `create`, `close`, `update`, `comment`, `label`, `dep`, `validate`) are reserved — features must not use these as names. The CLI checks subcommands first; an unrecognized positional argument is treated as a feature name.

### Pipeline and source code changes

Replace `src/lib/beads.ts` (which shells out to `bd`) with a new `src/lib/tasks.ts` module that reads `plans/<feature>/tasks.json` directly. This module implements the existing `EpicInfo` and `ReadyTask` interfaces so the pipeline state machine and status formatting continue to work unchanged. When `tasks.json` does not exist, the query returns `null` — the pipeline interprets this as `needs-tasks` (matching current behavior when no bd epic is found).

Source files that import from `beads.ts` — `pipeline.ts`, `commands/tasks.ts`, `commands/run.ts`, and any status/format modules — update their imports to the new `tasks.ts` module. The `suggestAction()` function in `pipeline.ts` changes `bd ready` to `forge tasks ready` for the `in-progress` stage. The `isBdAvailable()` check is removed — forge no longer depends on an external CLI for task operations.

### Guidance updates

All `bd` command references change to the corresponding `forge tasks` commands. This covers: `guidance/` process docs, `plugin/commands/` agent-facing commands, `skills/forge/SKILL.md`, and `README.md`. The run-process orchestration flow, task agent prompts, review loop, and salvage agent prompts all update to use forge commands.

## Testing Decisions

### DAG logic (unit tests)

- Cycle detection: DAG with no cycles passes; DAG with a direct cycle fails; DAG with a transitive cycle fails
- Ready query: task with no deps is ready; task with all deps closed is ready; task with an `in_progress` dep is ready; task with an `open` dep is not ready
- Topological sort: produces valid execution order
- Validation: orphan dependency references flagged; disconnected subgraphs flagged

### File operations (unit tests)

- Worktree path resolution: finds main worktree from a child worktree's `.git` file
- File locking: concurrent writes don't corrupt JSON; lock timeout produces a clear error
- Malformed JSON: clear error message, no crash

### CLI commands (integration tests)

- Full lifecycle: create epic → add tasks → set deps → validate → ready → update status → close → verify state
- Parallel close: two tasks close with `--force` while deps are `in_progress`
- Feature with no tasks.json: commands degrade gracefully with helpful error

### Pipeline integration (integration tests)

- `forge status` reads `tasks.json` and reports correct stage
- Feature with tasks.json where all tasks are closed → stage is `needs-reflection`

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
