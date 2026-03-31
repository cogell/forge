---
description: Divergent exploration — gather ideas, map problem space, interview stakeholders
argument-hint: <feature-name>
---

Run `forge brainstorm $ARGUMENTS` to scaffold the brainstorm file.

Then conduct a thorough brainstorming session with the user:

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

### Step 3: Diverge — map the space

Generate and explore options freely:

- What are all the ways we could solve this?
- What are the wild ideas? The conservative ones?
- What adjacent problems exist?
- What constraints might we be wrong about?

Capture everything in `plans/<feature>/brainstorm.md` — this is raw material, not a polished document.

### Step 4: Granularity check

If the solution involves any toggle, filter, or setting, ask: does it apply **globally**, **per-entity**, **per-day**, or **per-entity-per-day**? Can different users/roles have different values? Toggle granularity is a common source of late rework — catch it now.

### Step 5: Converge — identify the path

Help the user narrow down:

- Which ideas have the best effort/impact ratio?
- What are the deal-breaker constraints?
- What's the simplest thing that could work?
- Is this the most valuable problem we could solve right now? Why this over alternatives?
- Who specifically benefits, and how soon would they see value?

See [value.md](../../guidance/value.md) for the value-thinking framework.

When the brainstorm feels complete, suggest running `/forge:prd <feature>` to formalize into a PRD.

## Deep Reference

See [brainstorm-process.md](../../guidance/brainstorm-process.md) for the full process protocol.
