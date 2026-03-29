# Forge: Write a PRD

Collaboratively create a PRD through deep interviewing and codebase exploration. Output: `plans/<feature>/prd.md`.

## Process

### Step 1: Gather the problem

Ask the user for a long, detailed description of:

- The problem they're solving
- Any solution ideas they already have
- Who the users/actors are
- What exists today (if anything)

Let them talk. Don't interrupt with structure yet.

### Step 2: Explore the codebase

Before interviewing, understand the current state:

- Read relevant source files to verify user assertions
- Understand existing architecture, patterns, and conventions
- Identify modules/components that will be affected
- Note testing patterns and infrastructure already in place

### Step 3: Interview relentlessly

Walk every branch of the design tree. Resolve decision dependencies one-by-one until you reach shared understanding.

**Areas to cover (as relevant):**

- Who are the actors/users?
- What are the edge cases and error states?
- What are the performance/scale expectations?
- What existing behavior must be preserved?
- What are the dependencies between design decisions?
- What is explicitly out of scope?
- **Granularity of toggles/filters/settings** — For any toggle, filter, or configurable setting: does it apply globally, per-entity, per-day, or per-entity-per-day? Can different users/roles have different values? This is a common source of late rework if left ambiguous.

**Interview principles:**

- Don't accept surface-level answers. Push on edge cases, error states, and decision dependencies.
- When you find a design decision that depends on another decision, resolve the dependency first.
- Present trade-offs clearly. Don't make the decision for the user — frame the options and let them choose.
- Keep a running mental model of unresolved branches. Don't move on until each is settled.

### Step 4: Sketch modules

Identify the modules that will be built or modified. Apply the **deep module principle**:

> A **deep module** encapsulates a lot of functionality behind a simple, testable interface that rarely changes. Contrast with a **shallow module** that has a complex interface relative to what it provides.

For each module, briefly describe:

- What it does (responsibility)
- Its interface (inputs/outputs, API surface)
- How it connects to other modules

Confirm the module sketch with the user. Ask which modules need tests and what kind.

### Step 5: Write the PRD

Create `plans/<feature>/` if it doesn't exist. Write the PRD using the template from [templates.md](templates.md).

**Writing rules:**

- User stories are exhaustive — cover every aspect, not just the happy path
- No file paths or code snippets — they go stale quickly
- Implementation decisions capture *what was decided and why*, not how to implement it
- Out of scope is explicit — silence is ambiguous
