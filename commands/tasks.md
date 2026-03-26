---
description: Decompose an implementation plan into a beads epic with child tasks and dependencies
argument-hint: <feature-name>
---

Run `forge tasks $ARGUMENTS` to validate preconditions (plan exists, bd available).

Then decompose the plan into beads:

## Process

### Step 1: Create the phase epic

```bash
bd create "Phase N: <Phase Title>" -t epic -p 1 \
  -d "Source: plans/<feature>/plan.md — Phase N" \
  -l "phase:N"
```

### Step 2: Decompose into tasks

For each acceptance criterion or logical unit of work, create a child task.

**Principles:**
- Each task produces a testable, mergeable artifact
- Each task is additive — merging it alone cannot break existing functionality
- If a task would import something from a future task, the dependency is wrong

**Create with structured content:**

```bash
bd create "Task title" \
  -t task -p <0-4> \
  --parent <epic-id> \
  -l "complexity:<1-10>,phase:N" \
  -d "WHAT: 2-4 sentence problem statement" \
  --design "HOW: types, interfaces, file paths, pseudo-code" \
  --acceptance "- [ ] First criterion
- [ ] Second criterion" \
  --notes "Files: path/to/file.ts (create), path/to/other.ts (modify)"
```

### Step 3: Set dependencies

```bash
bd dep add <blocked-task> <blocking-task>
```

### Step 4: Score complexity

| Score | Meaning | Action |
|-------|---------|--------|
| 1-3 | Single file, boilerplate | Execute as-is |
| 4-6 | Multiple files, real logic | Execute as-is |
| 7-8 | Multiple concerns or unknowns | Expand into sub-children |
| 9-10 | Needs design work first | Must expand before starting |

Tasks scoring 7+ become mini-epics with children. Each child ≤6. Max nesting: 3 levels.

### Step 5: Validate the DAG

```bash
bd swarm validate <epic-id>
```

### Cross-boundary contracts

When tasks span layers (API → daemon → CLI), the `design` field of each task MUST use identical names for shared contracts. Name drift causes silent bugs.

## Deep Reference

See [tasks-process.md](../guidance/tasks-process.md) for the full decomposition protocol, complexity scoring formula, and structured content field reference.
