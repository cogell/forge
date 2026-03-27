---
description: Write a PRD through deep interviewing and codebase exploration
argument-hint: <feature-name>
---

Run `forge prd $ARGUMENTS` to scaffold the PRD file.

Then follow the detailed PRD process below. If a brainstorm file exists at `plans/<feature>/brainstorm.md`, use it as input.

## Process

### Step 1: Confirm inputs

Read `plans/<feature>/brainstorm.md` if it exists. If not, gather the problem directly from the user.

### Step 2: Explore the codebase

Before interviewing, understand the current state:

- Read relevant source files to verify user assertions
- Understand existing architecture, patterns, and conventions
- Identify modules/components that will be affected
- Note testing patterns and infrastructure already in place

### Step 3: Establish value

Before diving into design details, answer:

- **Why this, why now?** — What makes this more valuable than alternatives the team could work on?
- **What's the minimum that would solve the user's problem?** — Resist designing the full vision when a subset would ship real value sooner.

Capture the answers in the PRD's Problem Statement. See [value.md](../../guidance/value.md) for the full framework.

### Step 4: Interview relentlessly

Walk every branch of the design tree. Resolve decision dependencies one-by-one.

**Areas to cover:**

- Who are the actors/users?
- What are the edge cases and error states?
- What are the performance/scale expectations?
- What existing behavior must be preserved?
- What are the dependencies between design decisions?
- What is explicitly out of scope?

**Interview principles:**

- Don't accept surface-level answers. Push on edge cases, error states, and decision dependencies.
- When you find a design decision that depends on another, resolve the dependency first.
- Present trade-offs clearly. Frame options and let the user choose.
- Keep a running mental model of unresolved branches. Don't move on until each is settled.

### Step 5: Sketch modules

Identify modules that will be built or modified. Apply the **deep module principle**:

> A deep module encapsulates a lot of functionality behind a simple, testable interface that rarely changes.

For each module: responsibility, interface (inputs/outputs), connections to other modules.

### Step 6: Write the PRD

Write to `plans/<feature>/prd.md` with sections:

- **Problem Statement** — user's perspective
- **Solution** — user's perspective
- **User Stories** — exhaustive, covering every aspect (not just happy path)
- **Implementation Decisions** — what was decided and why (no file paths or code)
- **Testing Decisions** — what to test and how
- **Out of Scope** — explicit boundaries

### Step 7: Review gate

Before advancing to `/forge:plan`, run the review gate per [review-gates.md](../../guidance/review-gates.md). Run the self-review checklist first, then external review. Each review pass uses a fresh context with full tools. Advance when a pass surfaces no critical or major issues.

## Deep Reference

See [prd-process.md](../../guidance/prd-process.md) for the full interview protocol and writing rules.
