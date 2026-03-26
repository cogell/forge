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

### Step 5: Expand complex tasks (7+)

Tasks scoring 7+ become mini-epics with children:

```bash
bd create "Sub-task title" -t task -p 1 \
  --parent bd-a3f8.3 \
  -l "complexity:3,phase:N" \
  --design "..." --acceptance "..."
# Creates bd-a3f8.3.1
```

Update downstream dependencies to point at specific children, not the parent. Each child should score ≤6. Max nesting: 3 levels.

### Step 6: Validate the DAG

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

## Priority Reference

| Priority | Value | When |
|----------|-------|------|
| Critical | 0 | Blocks everything, security, data loss |
| High | 1 | Core functionality, critical path |
| Medium | 2 | Standard work (default) |
| Low | 3 | Polish, optimization |
| Backlog | 4 | Future ideas |
