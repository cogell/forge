---
description: Slice a PRD into a phased implementation plan using vertical slices
argument-hint: <feature-name>
---

Run `forge plan $ARGUMENTS` to check preconditions and scaffold the plan file.

Then follow the planning process:

## Process

### Step 1: Confirm the PRD

Read `plans/<feature>/prd.md`. If it doesn't exist, tell the user to run `/forge:prd <feature>` first.

### Step 2: Explore the codebase

Understand current architecture, integration layers, existing patterns, testing infrastructure, and build/deploy pipeline.

### Step 3: Identify durable architectural decisions

Before slicing, identify high-level decisions unlikely to change:

- Route structures / URL patterns
- Database schema shape
- Key data models and relationships
- Auth approach
- Third-party service boundaries
- Package/module boundaries

These go in the plan header so every phase can reference them.

**Name shared constants:** When a decision defines a default value that will appear in 3+ files, declare it as a named constant (e.g., `DEFAULT_OP_START = 8`). Prose-only defaults get hardcoded as magic numbers by task agents.

### Step 4: Map file structure

Before slicing, map out which files will be created or modified and what each is responsible for. This is where decomposition decisions get locked in:

- Each file should have one clear responsibility
- Files that change together should live together — split by responsibility, not by technical layer
- In existing codebases, follow established patterns; if a file has grown unwieldy, including a split is reasonable

This structure informs the vertical slices and feeds directly into task decomposition.

### Step 5: Draft vertical slices

Break the PRD into **tracer bullet** phases. Each phase is a thin vertical slice through ALL layers.

**Rules:**
- Each slice delivers a narrow but COMPLETE path through every layer (schema → API → UI → tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
- Include durable decisions: route paths, schema shapes, data model names
- Include file paths from the file structure map — which files each phase creates or modifies

**Sequencing:**
- Phase 1 = thinnest possible end-to-end slice — prove the architecture
- Each subsequent phase adds a layer of functionality
- No "Phase 0" — infrastructure is part of Phase 1
- If a phase has no user-visible behavior, it's probably a horizontal slice — reconsider

**Value:**
- Each phase should be a viable stopping point — shippable and valuable on its own
- Rank phases by value delivered, not just technical dependency
- Identify the earliest phase where a user could get real value
- See [value.md](../../guidance/value.md) for the value-thinking framework

### Step 6: Scope check

If the plan spans multiple independent subsystems with no shared interfaces, consider whether it should be separate plans — one per subsystem. Each plan should produce working, testable software on its own. However, a single plan that crosses subsystems is fine when the phases share data models, APIs, or other contracts — the task decomposition (beads DAG) gives enough structure to manage the complexity.

### Step 7: Quiz the user

Present the proposed breakdown. For each phase: title + user stories covered. Ask about granularity, merging/splitting, and sequence. Iterate until approved.

### Step 8: Choose execution strategy

Ask the user how they want `/forge:run` to execute this plan:

- **`phase-prs`** — Run one phase at a time. After each phase, create a PR and stop. The human reviews, merges, and re-runs to continue. Use this when you want to steer between phases or when early phases might be sufficient.
- **`single-pr`** — Run all phases in one shot. Create a single PR at the end. Use this for well-understood features where all phases are clearly needed.

Record the choice in the plan frontmatter as `execution: phase-prs` or `execution: single-pr`.

### Step 9: Write the plan

Save to `plans/<feature>/plan.md`. Each phase gets: title, covered user stories, file structure (files created/modified), "what to build" description, and acceptance criteria checkboxes.

### Step 10: Review gate

Before advancing to `/forge:tasks`, run the review gate per [review-gates.md](../../guidance/review-gates.md). Run the self-review checklist first, then external review. Each review pass uses a fresh context with full tools. Advance when a pass surfaces no critical or major issues.

## Deep Reference

See [plan-process.md](../../guidance/plan-process.md) for the full vertical slicing protocol.
