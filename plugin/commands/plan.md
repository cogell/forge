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

### Step 4: Draft vertical slices

Break the PRD into **tracer bullet** phases. Each phase is a thin vertical slice through ALL layers.

**Rules:**
- Each slice delivers a narrow but COMPLETE path through every layer (schema → API → UI → tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
- DO include durable decisions: route paths, schema shapes, data model names
- Do NOT include specific file names, function names, or implementation details

**Sequencing:**
- Phase 1 = thinnest possible end-to-end slice — prove the architecture
- Each subsequent phase adds a layer of functionality
- No "Phase 0" — infrastructure is part of Phase 1
- If a phase has no user-visible behavior, it's probably a horizontal slice — reconsider

### Step 5: Quiz the user

Present the proposed breakdown. For each phase: title + user stories covered. Ask about granularity, merging/splitting, and sequence. Iterate until approved.

### Step 6: Write the plan

Save to `plans/<feature>/plan.md`. Each phase gets: title, covered user stories, "what to build" description, and acceptance criteria checkboxes.

## Deep Reference

See [plan-process.md](../../guidance/plan-process.md) for the full vertical slicing protocol.
