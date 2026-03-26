# Forge: Create Implementation Plan

Break a PRD into a phased implementation plan using vertical slices (tracer bullets). Output: `plans/<feature>/plan.md`.

## Process

### Step 1: Confirm the PRD

The PRD should be in context. If not, read `plans/<feature>/prd.md`. If it doesn't exist, tell the user to run `/forge:prd <feature>` first.

### Step 2: Explore the codebase

If you haven't already, explore to understand:

- Current architecture and integration layers
- Existing patterns and conventions
- Testing infrastructure
- Build/deploy pipeline

### Step 3: Identify durable architectural decisions

Before slicing, identify high-level decisions unlikely to change during implementation:

- Route structures / URL patterns
- Database schema shape
- Key data models and their relationships
- Authentication / authorization approach
- Third-party service boundaries
- Package/module boundaries

These go in the plan header so every phase can reference them.

### Step 4: Draft vertical slices

Break the PRD into **tracer bullet** phases. Each phase is a thin vertical slice through ALL layers.

**Vertical slice rules:**

- Each slice delivers a narrow but COMPLETE path through every layer (schema → API → UI → tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
- DO include durable decisions: route paths, schema shapes, data model names
- Do NOT include specific file names, function names, or implementation details likely to change as later phases are built

**Sequencing principles:**

- Phase 1 should be the thinnest possible end-to-end slice — prove the architecture works
- Each subsequent phase adds a layer of functionality
- Infrastructure/setup tasks are part of Phase 1, not a separate "Phase 0"
- If a phase has no user-visible behavior, it's probably a horizontal slice — reconsider

### Step 5: Quiz the user

Present the proposed breakdown as a numbered list. For each phase show:

- **Title**: short descriptive name
- **User stories covered**: which user stories from the PRD this addresses

Ask:

- Does the granularity feel right? (too coarse / too fine)
- Should any phases be merged or split further?
- Does the sequence make sense?

Iterate until approved.

### Step 6: Write the plan

Create the plan using the template from [templates.md](templates.md). Save to `plans/<feature>/plan.md`.

Each phase gets:

- Title and covered user stories
- "What to build" — concise end-to-end behavior description
- Acceptance criteria — markdown checkboxes
