# Forge: Decompose Plan into Beads

Take an implementation plan and decompose each phase into a beads epic with child tasks, dependencies (DAG), and structured content. Requires `bd` CLI.

## Process

### Step 1: Create the phase epic

```bash
bd create "Phase N: <Phase Title>" -t epic -p 1 \
  -d "Source: plans/<feature>/plan.md — Phase N" \
  -l "phase:N"
```

Note the returned ID (e.g., `bd-a3f8`).

### Step 2: Decompose into tasks

Read the plan phase. For each acceptance criterion or logical unit of work, create a child task.

**Decomposition principles:**

- Each task produces a testable, mergeable artifact
- Each task is additive — merging it alone cannot break existing functionality
- If a task would import something from a future task, the dependency is wrong
- If two parallel tasks both need DB migrations, add a dependency between them

**Create each task with structured content:**

```bash
bd create "Task title" \
  -t task -p <0-4> \
  --parent <epic-id> \
  -l "complexity:<1-10>,phase:N" \
  -d "WHAT: 2-4 sentence problem statement" \
  --design "HOW: types, interfaces, file paths, pseudo-code" \
  --acceptance "- [ ] First criterion
- [ ] Second criterion" \
  --notes "Files: path/to/file.ts (create), path/to/other.ts (modify)
Migration: none (or 0002_add_foo.sql — description)"
```

### Step 3: Set dependencies

```bash
bd dep add bd-a3f8.2 bd-a3f8.1   # .2 is blocked by .1
```

Direction: first arg is **blocked by** second arg.

### Step 4: Score complexity

| Score | Meaning | Action |
|-------|---------|--------|
| 1-3 | Single file, config, boilerplate | Execute as-is |
| 4-6 | Multiple files, real logic, tests | Execute as-is |
| 7-8 | Multiple concerns or unknowns | Expand into sub-children |
| 9-10 | Needs design work first | Must expand before starting |

**Scoring formula:** Count files touched (+1 each) + non-trivial logic (+2) + unknowns (+2) + coordination (+1) + new library (+1).

### Step 5: Collapse coupled tasks

After scoring, check whether any set of tasks shares a **breaking change** — a type rename, interface restructure, or schema migration that cannot be merged incrementally without breaking consumers.

**Collapse heuristic:** If the tasks sharing a breaking change touch **≤10 files total** AND their combined complexity is **≤15**, collapse them into a single task. The "additive merge" principle from Step 2 cannot hold for these changes — renaming `Space` to `Spaces` across 7 files is one atomic operation, not three independent tasks.

**Why:** Worktree agents that see TypeScript errors from incomplete renames in other files will scope-creep, attempting fixes outside their task boundary. A single task avoids this entirely.

**Signs that tasks should be collapsed:**

- A type, interface, or enum is renamed and multiple tasks consume it
- A function signature changes and callers span several tasks
- A database column rename requires coordinated migration + code changes

When collapsing, sum the file lists from each task's `notes` field into one task, merge acceptance criteria, and pick the highest priority among the collapsed tasks.

### Step 6: Expand complex tasks (7+)

Tasks scoring 7+ become mini-epics with children:

```bash
bd create "Sub-task title" -t task -p 1 \
  --parent bd-a3f8.3 \
  -l "complexity:3,phase:N" \
  --design "..." --acceptance "..."
# Creates bd-a3f8.3.1
```

Update downstream dependencies to point at specific children, not the parent. Each child should score ≤6. Max nesting: 3 levels.

### Step 7: Cross-reference the plan

After initial decomposition, walk the plan section-by-section and verify nothing was dropped in translation. This is the single highest-leverage quality gate — plans contain the right information, but tasks routinely lose it.

**7a. Map testing scenarios to tasks**

Read the plan's testing section (and the PRD's Testing Decisions). For each test scenario, find the task whose acceptance criteria covers it. If a scenario has no home:

- Add it to the most relevant task's acceptance criteria, OR
- Create a dedicated test task (depends on the implementation task, blocks downstream)

A task that ships endpoints without the plan's specified integration tests is incomplete.

**7b. Translate UX-sensitive language**

Scan the plan for words that imply timing or interaction guarantees: *immediately, instant, without delay, real-time, without page reload, seamless, live*. These are UX contracts, not implementation suggestions. Translate each into a concrete implementation requirement in the task's acceptance criteria:

| Plan says | Task acceptance criterion should say |
|-----------|--------------------------------------|
| "immediately" / "instant" | Optimistic update with rollback on failure |
| "without page reload" | Local state update, no refetch required |
| "real-time" | WebSocket/SSE push, no polling interval visible to user |
| "seamless" | No loading spinner, no layout shift |

If the plan uses UX language that doesn't have a clear technical translation, flag it for clarification before creating the task.

**7c. Generate zero-data state criteria**

For every task that consumes backend data with defaults (the plan says "default X" or "falls back to Y"), add an acceptance criterion:

```
- [ ] Works correctly when API returns empty/default response (no prior user configuration)
```

This is especially important for features that layer on top of optional configuration — the first-use experience is the most common untested path.

**7d. Verify durable decisions are actionable**

Walk the plan's Architectural Decisions / Durable Decisions section. For each decision:

- If it names a shared constant (e.g., `DEFAULT_OP_START = 8`), verify the relevant tasks reference that constant name in their `design` field — not the raw value.
- If a decision defines a default value that will appear in 3+ tasks, and it's NOT named as a constant, flag it back to the plan author. Hardcoded magic numbers across files are a maintenance hazard.

**7e. Reconciliation checklist**

After the pass, confirm:

- [ ] Every test scenario in the plan maps to at least one task's acceptance criteria
- [ ] Every UX-sensitive word in the plan has a concrete technical translation in a task
- [ ] Every task consuming defaultable backend data has a zero-data acceptance criterion
- [ ] Every shared constant from durable decisions appears by name (not raw value) in task designs

Items that fail reconciliation get added to tasks or flagged to the user. Do not proceed to DAG validation until the checklist passes.

### Step 8: Validate the DAG

```bash
bd swarm validate <epic-id>
```

Checks for: correct direction, orphans, cycles, disconnected subgraphs. Reports ready fronts, parallelism, and estimated worker-sessions. Fix issues before proceeding.

## Structured Content Fields

| Field | Flag | Purpose | Content |
|-------|------|---------|---------|
| `description` | `-d` | The WHAT | Problem statement, context (2-4 sentences) |
| `design` | `--design` | The HOW | Types, interfaces, signatures, file paths |
| `acceptance_criteria` | `--acceptance` | Done when | Markdown checkboxes |
| `notes` | `--notes` | Everything else | Files list, migrations, gotchas, test strategy |

### Cross-boundary contracts

When tasks span layers (e.g., API → daemon → CLI), the `design` field of each task MUST use identical names for shared contracts: query param names, field names, type names, endpoint paths. If the API task says `document_id`, the daemon and CLI tasks must also say `document_id` — not `noteId` or `docId`. Name drift between tasks causes silent bugs that pass type-checking but break at runtime.

### System boundary validation

When a task consumes data from outside the process (WebSocket messages, API responses, file reads, IPC), the acceptance criteria MUST include a malformed-input case. The design field MUST specify what happens on invalid data — log and ignore, fallback to default, surface an error, etc. If the plan identified a system boundary (Step 4), the corresponding task inherits this requirement.

### Test companions for branching logic

In-task TDD (RED → GREEN → REFACTOR) covers most work. But when a task introduces complex conditional logic — multiple branches, state machines, lifecycle transitions — the in-task tests may stay shallow because the implementer is focused on making it work, not on edge coverage.

Create a **sibling test task** when:

- The logic has ≥3 distinct branches or state transitions
- The logic can't be tested through a single public API (e.g., engine internals that are only exercised through orchestration)
- The task introduces a new naming/numbering scheme (visit counts, suffixes, ID formats)

The test task depends on the implementation task and blocks downstream work. Its acceptance criteria name specific cases:

```
--acceptance "- [ ] session created for shell/task nodes
- [ ] session NOT created for start/exit/conditional/human
- [ ] visit-count naming produces -2, -3 suffixes on loop-back
- [ ] failed handler marks session as crashed
- [ ] createNodeSession failure does not block handler execution"
```

## Priority Reference

| Priority | Value | When |
|----------|-------|------|
| Critical | 0 | Blocks everything, security, data loss |
| High | 1 | Core functionality, critical path |
| Medium | 2 | Standard work (default) |
| Low | 3 | Polish, optimization |
| Backlog | 4 | Future ideas |
