---
status: completed
feature: tasks
created: 2026-03-30
completed: 2026-03-30
execution: single-pr
---

# Plan: Built-in Task System

> Source PRD: plans/tasks/prd.md

## Architectural Decisions

**Module structure:** Flat layout matching existing codebase. `src/lib/tasks.ts` is the single data-layer module (types, I/O, DAG, queries, mutations). `src/lib/lock.ts` and `src/lib/worktree.ts` are small, focused utilities. `src/commands/tasks.ts` is rewritten as a subcommand dispatcher — thin wrappers over the library.

**Interface evolution:** `EpicInfo` adds an `epics: Array<{id: string, title: string}>` field. `ReadyTask` is unchanged. Both remain in `src/lib/tasks.ts` (the canonical home, replacing `beads.ts`). All consumers update imports in the same phase they start using the new module.

**Test runner:** `bun test` (built-in, zero config). Test files colocated: `src/lib/__tests__/*.test.ts`.

**Config file:** `forge.json` at project root. Read via `readFileSync` + `JSON.parse` — no new dependencies. `forge init` writes it.

**Exec helper removal:** `beads.ts` has an `exec()` helper (Bun.spawn wrapper for shell commands). This is not reused — the new task system reads JSON files directly. `run.ts` has its own `isGitClean()` using `Bun.spawn` which remains unchanged.

**Dual-type coexistence (Phases 1-3):** During Phases 1-3, two `EpicInfo` types coexist — the old one in `beads.ts` (with `epicId`, `title`) and the new one in `tasks.ts` (with `epics[]`). This is safe because they live in separate modules with separate import chains: `pipeline.ts`/`format.ts`/`status.ts` import from `tasks.ts`, while `run.ts`/`reflect.ts` continue importing from `beads.ts`. TypeScript enforces no cross-contamination. The old type and `beads.ts` are deleted in Phase 4 when those consumers migrate. Note: `commands/tasks.ts` also continues importing from `beads.ts` during Phase 1 — this means `forge tasks <feature>` still requires `bd` until the Phase 2 rewrite. This is acceptable: the old command works for existing users while the new system is built underneath.

**Config utility:** `readProjectPrefix(cwd?): string` lives in `src/lib/tasks.ts` alongside the other task utilities. It reads `forge.json` from the project root (or resolved worktree root in Phase 4), parses the `prefix` field, and throws a clear error if the file is missing or the prefix is invalid. Created in Phase 2.

**Prompting for prefix:** `forge init` uses Node's built-in `readline` module (available in Bun) for the interactive prefix prompt — no new dependencies. The prompt is a single question ("Project prefix (e.g., FORGE):") with validation. Non-interactive contexts (no TTY, CI) skip the prompt if `--prefix` is not provided.

**File scanning utility:** A shared `discoverTaskFiles(cwd?): string[]` function in `tasks.ts` handles finding all `plans/**/tasks.json` files. Implementation: `readdirSync` on `plans/`, check for `tasks.json` in each feature subdirectory + project-level `plans/tasks.json`. This matches the existing pattern in `plans.ts` (`readPlans` uses `readdirSync`). No need for `Bun.Glob` — the scan is one level of directories plus one root file.

**Test infrastructure:** `bun test` discovers `*.test.ts` files automatically. Phase 1 creates the `src/lib/__tests__/` directory implicitly by writing the first test file. `package.json` gains a `"test": "bun test"` script in Phase 1 for convention.

**Named constants:**

```
LOCK_TIMEOUT_MS = 5000
LOCK_RETRY_MS = 100
MAX_NESTING_DEPTH = 3
TASKS_FILENAME = "tasks.json"
LOCK_EXTENSION = ".lock"
SCHEMA_VERSION = 1
```

## Phase 1: Read path — data layer + pipeline integration

**User stories:** 14, 19, 23, 24, partial 6, partial 7

### File structure

| File | Op | Responsibility |
|---|---|---|
| `src/lib/tasks.ts` | create | Types (`TasksFile`, `Epic`, `Task`, `EpicInfo`, `ReadyTask`), read tasks.json, compute epic stats, ready query |
| `src/lib/pipeline.ts` | modify | Swap `import { queryBeadsEpic, type EpicInfo } from "./beads"` → `import { queryFeatureTasks, type EpicInfo } from "./tasks"` |
| `src/lib/format.ts` | modify | Swap `import type { ReadyTask } from "./beads"` → `import type { ReadyTask } from "./tasks"` |
| `src/commands/status.ts` | modify | Swap `import { getReadyTasks } from "../lib/beads"` → `import { getReadyTasks } from "../lib/tasks"` |
| `src/lib/__tests__/tasks.test.ts` | create | Unit tests for read, query, ready, edge cases |
| `package.json` | modify | Add `"test": "bun test"` script |

### What to build

**Types** — Define TypeScript interfaces matching the PRD schema:
- `Epic`: `{ id, title, created }`
- `Task`: `{ id, title, status, priority, labels, description, design, acceptance, notes, dependencies, comments, closeReason }`
- `Comment`: `{ message, timestamp }`
- `TasksFile`: `{ version, epics, tasks }`
- `EpicInfo` — the complete new interface:
  ```typescript
  interface EpicInfo {
    epics: Array<{ id: string; title: string }>;
    primaryEpicId: string; // epics[0]?.id ?? ""
    totalTasks: number;
    closedTasks: number;
    openTasks: number;
    inProgressTasks: number;
    allClosed: boolean; // totalTasks > 0 && closedTasks === totalTasks && every epic has ≥1 task
  }
  ```
  Drops old `epicId` and `title` (singular). Consumers that used `epicId` update to `primaryEpicId`. The aggregation fields (`totalTasks`, `closedTasks`, `openTasks`, `inProgressTasks`, `allClosed`) are preserved — `format.ts` and `pipeline.ts` depend on them.
- Preserve existing `ReadyTask` interface unchanged: `{ id, title, priority, labels }`
- `TaskStatus`: union type `"open" | "in_progress" | "closed"`

**Read operations** (all synchronous, matching the `readFileSync` pattern in `plans.ts`):
- `discoverTaskFiles(cwd?): string[]` — find all `plans/**/tasks.json` files. Uses `readdirSync` on `plans/` directory: checks each subdirectory for `tasks.json`, plus `plans/tasks.json` at root. Returns absolute paths.
- `readTasksFile(filePath): TasksFile | null` — read + parse JSON, return null on missing file, throw on malformed JSON with a descriptive error ("tasks.json is corrupt: <parse error>"). The null-vs-throw distinction matters: query functions (pipeline, status) treat null as "no tasks" gracefully, while mutation functions (Phase 3) can rely on a non-null return meaning valid data and a throw meaning corruption that should surface to the user.
- `queryFeatureTasks(feature, cwd?): EpicInfo | null` — read `plans/<feature>/tasks.json`, aggregate stats across all epics. Return null when file missing OR when file has no tasks (empty scaffold). `allClosed = totalTasks > 0 && closedTasks === totalTasks` and every epic must have at least one task.
- `getReadyTasks(cwd?, feature?): ReadyTask[]` — when `feature` is provided, reads only that feature's tasks.json but resolves cross-file dependencies by loading all files for dep status lookup. When omitted, scans all files. Returns leaf tasks that are `open` with all deps `closed` or `in_progress`.

Note: `getReadyTasks` and `queryFeatureTasks` are synchronous (return `ReadyTask[]` and `EpicInfo | null`, not Promises). The existing callers in `status.ts` use `await` on the current async beads version — awaiting a sync return value is harmless in JS/TS and requires no caller changes.

**Ready computation logic:**
1. Collect all tasks across all files
2. Build a set of task IDs that have children (by checking if any other task's ID is a prefix + `.`)
3. Filter to leaf tasks (not in children set)
4. Filter to `status === "open"`
5. For each remaining task, check all `dependencies` — each dep must be `closed` or `in_progress`
6. Return matching tasks as `ReadyTask[]`

**Pipeline wiring:**
- `pipeline.ts`: replace `queryBeadsEpic(feature, cwd)` call with `queryFeatureTasks(feature, cwd)`. The return type is the same `EpicInfo | null`. The `determineStage()` and `suggestAction()` functions don't change yet (suggestAction still returns `bd ready` for in-progress — updated in Phase 4).
- `format.ts`: change the type import source only. No logic changes.
- `status.ts`: change the import source only. No logic changes.

### Acceptance criteria

- [ ] `TasksFile`, `Epic`, `Task`, `EpicInfo`, `ReadyTask` types defined matching PRD schema
- [ ] `queryFeatureTasks(feature)` reads `plans/<feature>/tasks.json` and returns correct `EpicInfo`
- [ ] Missing tasks.json → returns null → pipeline shows `needs-tasks`
- [ ] Empty tasks.json (no epics or no tasks) → returns null → pipeline shows `needs-tasks`
- [ ] Epic with 0 tasks → not considered closed for `allClosed`
- [ ] `getReadyTasks()` scans all `plans/**/tasks.json` and returns ready leaf tasks
- [ ] Container tasks (have children) excluded from ready results
- [ ] Task with `open` dep excluded from ready results
- [ ] Task with `in_progress` dep included in ready results
- [ ] `forge status` renders correct stage, progress bar, and ready tasks from tasks.json
- [ ] `--json` output includes correct EpicInfo with new `epics` field
- [ ] Unit tests pass for all read/query/ready edge cases

## Phase 2: Write path — CLI commands + forge.json

**User stories:** 1, 2, 3, 5, 6, 7, 8, 17, 18

### File structure

| File | Op | Responsibility |
|---|---|---|
| `src/commands/init.ts` | modify | Add `forge.json` creation with prefix prompt/flag |
| `src/commands/tasks.ts` | rewrite | Subcommand dispatch: scaffold, epic create, create, dep add/remove, list, show, ready |
| `src/index.ts` | modify | Update HELP text: `tasks` description reflects subcommand model, remove beads reference |
| `src/lib/tasks.ts` | modify | Add write operations: writeTasksFile, createEpic, createTask, addDep, removeDep, ID generation |

### What to build

**forge.json config:**
- `forge init` gains `--prefix <PREFIX>` flag (for non-interactive use by agents)
- If interactive (no `--prefix` flag and TTY), prompt for prefix
- If non-interactive and no `--prefix` flag: skip forge.json creation (preserving existing behavior — init remains usable in CI without hanging on a prompt)
- If `forge.json` already exists: skip prefix step entirely (idempotent, like existing dir/template checks)
- Validate: uppercase alphanumeric, 2-10 chars, no hyphens
- Write `{ "prefix": "VALUE" }` to `forge.json` at project root
- `readProjectPrefix(cwd?): string` — reads forge.json, throws clear error if missing
- Existing directory and template creation behavior is fully preserved — `--prefix` is additive

**Scaffold command** (`forge tasks <feature>`):
- Check `forge.json` exists → error if not: `"No project key configured. Run forge init to set one."`
- Check `plans/<feature>/plan.md` exists → error if not
- If `tasks.json` exists → show epic count + task count summary, exit 0
- If not → write `{"version":1,"epics":[],"tasks":[]}` with canonical formatting, report created
- `forge tasks --project` variant → scaffold `plans/tasks.json` (no plan.md check)

**Epic create** (`forge tasks epic create <feature> "title"`):
- Read prefix from forge.json
- Scan all `plans/**/tasks.json` for max epic number → next = max + 1
- Append epic to file's epics array
- Return created epic ID
- `--project` variant for project-level

**Task create** (`forge tasks create <feature> "title" --parent <id> [flags]`):
- Resolve parent: if `--parent` omitted, default to sole epic (error if 0 or 2+ epics)
- Validate parent exists (epic or task) and nesting depth (max 3 levels)
- Assign next sequential number under parent (scan existing tasks)
- Parse repeated flags: `--acceptance "criterion"` (multiple), `--label <label>` (multiple)
- Parse single flags: `--priority N`, `-d "..."`, `--design "..."`, `--notes "..."`
- Append task to file's tasks array with defaults: `status: "open"`, `dependencies: []`, `comments: []`, `closeReason: null`
- Return created task ID

**Dep commands:**
- `forge tasks dep add <blocked> <blocker>` — find task by ID across all files, append blocker to dependencies array
- `forge tasks dep remove <blocked> <blocker>` — remove from array

**Query commands:**
- `forge tasks list [feature]` — tabular output: ID, title, status, priority, labels. Group by epic. `--json` returns full tasks array.
- `forge tasks show <id>` — find task across files, display all fields. `--json` returns full task object.
- `forge tasks ready [feature]` — uses `getReadyTasks()` from Phase 1, formatted output with ID, title, priority, labels.

**Subcommand dispatch** in `tasks.ts`:
- Parse first positional arg
- If it matches a reserved name (`ready`, `list`, `show`, `create`, `close`, `update`, `comment`, `label`, `dep`, `validate`, `epic`) → dispatch to handler
- Otherwise → treat as feature name (scaffold command)
- `--project` flag → set feature context to project-level

### Acceptance criteria

- [ ] `forge init --prefix FORGE` creates `forge.json` with `{"prefix":"FORGE"}`
- [ ] Prefix validation rejects: lowercase, hyphens, empty, <2 chars, >10 chars
- [ ] `forge tasks <feature>` scaffolds empty tasks.json with canonical formatting
- [ ] `forge tasks <feature>` with existing tasks.json shows summary, exits 0
- [ ] `forge tasks --project` scaffolds `plans/tasks.json`
- [ ] `forge tasks` without forge.json → clear error directing to `forge init`
- [ ] `forge tasks epic create <feature> "title"` creates epic with globally sequential ID
- [ ] Epic numbering scans all tasks.json files for max
- [ ] `forge tasks create` with `--parent` creates task with correct nested ID
- [ ] `--parent` defaults to sole epic; errors when 0 or 2+ epics and not specified
- [ ] Max 3 nesting levels enforced
- [ ] `--acceptance` and `--label` accept multiple repeated flags
- [ ] `forge tasks dep add/remove` works across files
- [ ] `forge tasks list` shows ID, title, status, priority, labels grouped by epic
- [ ] `forge tasks show <id>` displays all task fields (description, design, acceptance, notes, deps, comments)
- [ ] `forge tasks ready` returns correct ready tasks; `ready <feature>` scopes to that feature
- [ ] All commands support `--json`
- [ ] All writes produce canonical JSON formatting (2-space indent, schema key order, trailing newline)

## Phase 3: Lifecycle — mutations + DAG validation

**User stories:** 4, 9, 11, 12, 13, 15, 22, 25

### File structure

| File | Op | Responsibility |
|---|---|---|
| `src/lib/tasks.ts` | modify | Add close validation, auto-close cascade, validate, update/comment/label mutations |
| `src/commands/tasks.ts` | modify | Add close, update, comment, label, validate subcommands |
| `src/lib/__tests__/tasks.test.ts` | modify | Add DAG validation, close rules, auto-close tests |

### What to build

**Note:** Phase 3 write operations are lock-free (file locking is wired in Phase 4). This is safe because Phase 3 targets single-process usage — concurrent agent execution requires Phase 4.

**Close command** (`forge tasks close <id> [--reason "..."] [--force]`):
- Find task across files (using `discoverTaskFiles` utility from Phase 1)
- Check all entries in task's `dependencies` array:
  - All `closed` → allowed
  - Any `in_progress` without `--force` → error naming the dep
  - Any `in_progress` with `--force` → allowed
  - Any `open` → error naming the dep (even with `--force`)
- Set `status: "closed"`, `closeReason` to provided reason or `"completed"`
- **Trigger auto-close:** after closing, check if parent (derived from ID) has all children closed → if so, auto-close parent with `closeReason: "all children closed"` → cascade upward
- Auto-close is synchronous within the same write operation

**Update command** (`forge tasks update <id> [flags]`):
- `--status <status>` — change status. If setting to `open`, clear `closeReason` to null
- `--priority N` — change priority
- `--title "..."`, `-d "..."`, `--design "..."`, `--notes "..."` — change field value
- Error if task is a container and status is being set to `closed` (use child close + auto-close instead)

**Comment command** (`forge tasks comment <id> "message"`):
- Append `{ message, timestamp: new Date().toISOString() }` to task's comments array

**Label command** (`forge tasks label <id> <label>`):
- Append label to task's labels array (if not already present)

**Library function signatures for mutations:**
- `closeTask(id: string, options: { reason?: string, force?: boolean }, cwd?: string): void`
- `updateTask(id: string, fields: Partial<Pick<Task, "status" | "priority" | "title" | "description" | "design" | "notes">>, cwd?: string): void`
- `addComment(id: string, message: string, cwd?: string): void`
- `addLabel(id: string, label: string, cwd?: string): void`
- `validateDag(feature: string | null, cwd?: string): ValidationResult` — returns `{ valid: boolean, errors: Array<{type, message, ids}> }`

**Validate command** (`forge tasks validate <feature|--project>`):
- Read all `plans/**/tasks.json` files (full project context for cross-file checks)
- **Cycle detection:** build directed graph from `dependencies`, detect cycles (DFS with coloring)
- **Orphan dependency refs:** every ID in every `dependencies` array must exist as a task
- **Orphan epic refs:** every task's epic (first segment of numeric path) must exist in its file's epics array
- **Duplicate IDs:** no two tasks or epics share the same ID across the project
- Report all issues found. Exit 1 if any errors, exit 0 if clean.

**Auto-close cascade logic:**
```
function checkAutoClose(file, taskId):
  parentId = taskId with last segment removed
  if parentId has no dots in numeric portion → it's an epic ID, skip (epics don't auto-close)
  parent = find task by parentId
  if all children of parent have status "closed":
    parent.status = "closed"
    parent.closeReason = "all children closed"
    checkAutoClose(file, parentId)  // recurse upward
```

### Acceptance criteria

- [ ] Close with all deps `closed` → succeeds
- [ ] Close with `in_progress` dep without `--force` → error naming dep
- [ ] Close with `in_progress` dep with `--force` → succeeds
- [ ] Close with `open` dep → error (even with `--force`)
- [ ] Close with `--reason` stores closeReason
- [ ] Auto-close triggers when last child closes
- [ ] Auto-close cascades to grandparent
- [ ] Direct close of container with open children → error
- [ ] `update --status open` clears closeReason
- [ ] `update` handles --title, -d, --design, --notes, --priority
- [ ] `comment` appends with ISO 8601 timestamp
- [ ] `label` adds (idempotent — no duplicates)
- [ ] `validate` detects cycles (direct + transitive)
- [ ] `validate` detects orphan dependency references
- [ ] `validate` detects orphan epic references
- [ ] `validate` detects duplicate IDs across files
- [ ] `validate` reports cross-file cycles
- [ ] Unit tests for all 6 close validation cells
- [ ] Unit tests for auto-close scenarios (single level + cascade)
- [ ] Unit tests for each validation check

## Phase 4: Concurrency, migration, and docs

**User stories:** 10, 16, 20, 21

### File structure

| File | Op | Responsibility |
|---|---|---|
| `src/lib/lock.ts` | create | Advisory file lock: acquire, release, PID stale detection |
| `src/lib/worktree.ts` | create | Resolve git worktree → main repo root |
| `src/lib/tasks.ts` | modify | Wire locking into all writes, worktree resolution into file path lookup |
| `src/commands/run.ts` | modify | Swap beads → tasks imports, remove `isBdAvailable` check |
| `src/commands/reflect.ts` | modify | Swap beads → tasks imports |
| `src/lib/pipeline.ts` | modify | Update `suggestAction()`: `bd ready` → `forge tasks ready` |
| `src/lib/beads.ts` | delete | Fully replaced |
| `src/lib/__tests__/lock.test.ts` | create | Lock acquire, timeout, stale recovery tests |
| `src/lib/__tests__/worktree.test.ts` | create | Worktree resolution tests |
| `guidance/tasks-process.md` | modify | `bd create/dep/swarm` → `forge tasks` commands |
| `guidance/run-process.md` | modify | `bd ready/close/comment/update/label` → `forge tasks`, remove bd prerequisite |
| `guidance/review-gates.md` | modify | "Tasks review (beads)" section → "Tasks review", `bd list/swarm` → `forge tasks` |
| `guidance/philosophy.md` | modify | `.beads/` → `plans/<feature>/tasks.json` in layer model |
| `guidance/docs-process.md` | modify | `.beads/` reference → tasks.json |
| `guidance/plan-process.md` | modify | beads DAG reference → forge tasks |
| `plugin/commands/tasks.md` | modify | Full rewrite: `bd` commands → `forge tasks` commands |
| `plugin/commands/run.md` | modify | bd prerequisite, task loop, orchestration → forge tasks |
| `plugin/commands/status.md` | modify | `bd ready` → `forge tasks ready` |
| `plugin/commands/reflect.md` | modify | beads reference → tasks.json |
| `plugin/commands/docs.md` | modify | beads reference → tasks.json |
| `plugin/commands/plan.md` | modify | beads reference → tasks.json |
| `skills/forge/SKILL.md` | modify | description, commands, stages, layers |
| `README.md` | modify | Remove bd prerequisite, update quick start |

### What to build

**File locking** (`src/lib/lock.ts`):
- `acquireLock(filePath): Promise<void>` — create `.lock` file with PID content. Retry every `LOCK_RETRY_MS` up to `LOCK_TIMEOUT_MS`. On timeout, check if PID in existing lockfile is alive (`process.kill(pid, 0)`) — if dead, reclaim. If alive, throw with clear error.
- `releaseLock(filePath): void` — delete `.lock` file
- `withLock(filePath, fn): Promise<T>` — acquire → fn() → release (in finally block)

**Worktree resolution** (`src/lib/worktree.ts`):
- `resolveRepoRoot(cwd?): string` — check if `.git` is a file (worktree) or directory (main). If file, parse `gitdir:` line, follow to main repo root. Return the root path.
- Used by tasks.ts to resolve `plans/` directory regardless of CWD context.

**Wire into tasks.ts:**
- All write functions (`writeTasksFile`, `createEpic`, `createTask`, `closeTask`, `updateTask`, `addComment`, `addLabel`, `addDep`, `removeDep`) wrapped with `withLock()`
- File path resolution uses `resolveRepoRoot()` to find `plans/` dir

**Pipeline migration:**
- `run.ts`: remove `isBdAvailable` import and check. Remove `queryBeadsEpic` import. Import `queryFeatureTasks` from tasks. Replace `checks.epicId = epic.epicId` with `checks.epicId = epic.primaryEpicId`. Replace the "no-bd" error path with a "no forge.json" check (call `readProjectPrefix` — if it throws, exit with error). The JSON output field `epicId` becomes `primaryEpicId` for display; the `hasEpic` boolean check remains (`epic !== null`).
- `reflect.ts`: swap `queryBeadsEpic` → `queryFeatureTasks` import. The return type changes shape (`EpicInfo` evolves), but `reflect.ts` only accesses `epic.totalTasks` and `epic.closedTasks` — both fields are preserved on the new `EpicInfo`. No logic changes needed beyond the import swap.
- `pipeline.ts`: update `suggestAction("in-progress")` from `"bd ready"` to `"forge tasks ready"`.

**Docs updates:** Mechanical find-replace across all listed files. Key patterns:
- `bd create` → `forge tasks create` / `forge tasks epic create`
- `bd dep add` → `forge tasks dep add`
- `bd swarm validate` → `forge tasks validate`
- `bd ready` → `forge tasks ready`
- `bd close` → `forge tasks close`
- `bd comment` → `forge tasks comment`
- `bd update` → `forge tasks update`
- `bd label` → `forge tasks label`
- `bd list` → `forge tasks list`
- `.beads/` → `plans/<feature>/tasks.json`
- "beads" (concept) → "tasks" or "forge tasks"
- Remove "bd CLI installed" from prerequisites

### Acceptance criteria

- [ ] Lock acquired and released around all write operations
- [ ] Lock timeout after 5s with clear error message
- [ ] Stale lock (dead PID) automatically reclaimed
- [ ] Worktree resolution follows `.git` file → main repo → `plans/` path
- [ ] Non-worktree (normal repo) returns cwd unchanged
- [ ] Task agents in worktrees can `forge tasks update <id> --status in_progress`
- [ ] `run.ts` no longer imports from beads — no `isBdAvailable()` check
- [ ] `reflect.ts` no longer imports from beads
- [ ] `suggestAction("in-progress")` returns `"forge tasks ready"`
- [ ] `src/lib/beads.ts` deleted
- [ ] No remaining `bd ` command references in guidance/ (6 files)
- [ ] No remaining `bd ` command references in plugin/commands/ (6 files)
- [ ] SKILL.md updated: description, command table, stage mapping, layer model
- [ ] README.md: bd removed from prerequisites, quick start uses `forge tasks`
- [ ] Lock unit tests pass (acquire, timeout, stale recovery)
- [ ] Worktree unit tests pass (main repo, worktree, nested)
- [ ] Full pipeline integration test: create feature tasks → close all → status shows `needs-reflection`
