---
description: Decompose an implementation plan into an epic with child tasks and dependencies
argument-hint: <feature-name>
---

Run `forge tasks $ARGUMENTS` to validate preconditions (plan exists).

Then decompose the plan into tasks:

## Process

### Step 1: Create the phase epic

```bash
forge tasks epic create "Phase N: <Phase Title>" -p 1 \
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
forge tasks create "Task title" \
  -p <0-4> \
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
forge tasks dep add <blocked-task> <blocking-task>
```

### Step 4: Score complexity

| Score | Meaning | Action |
|-------|---------|--------|
| 1-3 | Single file, boilerplate | Execute as-is |
| 4-6 | Multiple files, real logic | Execute as-is |
| 7-8 | Multiple concerns or unknowns | Expand into sub-children |
| 9-10 | Needs design work first | Must expand before starting |

Tasks scoring 7+ become mini-epics with children. Each child ≤6. Max nesting: 3 levels.

### Step 5: Cross-reference the plan

After decomposition, walk the plan section-by-section to catch items that got lost in translation:

1. **Testing scenarios** — Read the plan's testing section and PRD's Testing Decisions. Every test scenario must map to a task's acceptance criteria. If one doesn't, add it to the relevant task or create a dedicated test task.

2. **UX-sensitive language** — Scan the plan for *immediately, instant, real-time, without delay, seamless*. Translate each into concrete implementation requirements (e.g., "immediately" → "optimistic update with rollback on failure"). Don't leave UX contracts as vague task language.

3. **Zero-data states** — For every task consuming backend data with defaults, add: `- [ ] Works correctly when API returns empty/default response`. First-use is the most common untested path.

4. **Shared constants** — If durable decisions name constants, tasks must reference the constant name in `design`, not the raw value. If a default appears in 3+ tasks but isn't named, flag it.

5. **Visual changes** — For any task that modifies HTML, CSS, layout, or UI components: add an acceptance criterion requiring a screenshot saved to `plans/<feature>/screenshots/`. Add a task note with capture instructions (e.g., `playwright-cli` with JS disabled for skeletons, or dev server screenshot for component changes). Require the PR body's "How to Verify" section to include the screenshot inline. Skip for non-visual changes (build config, pure backend, etc.).

Confirm all items reconcile before proceeding. See [tasks-process.md](../../guidance/tasks-process.md) for the full cross-reference protocol.

### Step 6: Validate the DAG

```bash
forge tasks validate <epic-id>
```

### Cross-boundary contracts

When tasks span layers (API → daemon → CLI), the `design` field of each task MUST use identical names for shared contracts. Name drift causes silent bugs.

### Step 7: Review gate

Before advancing to `/forge:run`, run the review gate per [review-gates.md](../../guidance/review-gates.md). Run the self-review checklist first, then external review. Each review pass uses a fresh context with full tools. Advance when a pass surfaces no critical or major issues.

## Deep Reference

See [tasks-process.md](../../guidance/tasks-process.md) for the full decomposition protocol, complexity scoring formula, and structured content field reference.
