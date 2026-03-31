# Forge: Brainstorm

Divergent exploration of the problem space before committing to a PRD. Output: `plans/<feature>/brainstorm.md`.

## The Core Rule

> Explore before you converge. A PRD written without thorough brainstorming encodes assumptions as decisions.

---

## Process

### Step 1: Gather the problem

Ask the user for a long, detailed description of:

- The problem they're solving
- Any solution ideas they already have
- Who the users/actors are
- What exists today (if anything)

Let them talk. Don't interrupt with structure yet. The goal is to get everything out of their head and onto the page.

### Step 2: Explore the codebase

Before diving deeper, understand the current state:

- Read relevant source files to verify user assertions
- Understand existing architecture, patterns, and conventions
- Identify modules/components that will be affected
- Note testing patterns and infrastructure already in place
- Look for prior art — has something similar been attempted before?

### Step 3: Diverge — map the space

Generate and explore options freely. This is the creative phase — quantity over quality:

- What are all the ways we could solve this?
- What are the wild ideas? The conservative ones?
- What adjacent problems exist that we might address?
- What constraints might we be wrong about?
- What would the solution look like if we had no constraints?
- What would the minimum viable version look like?

Capture everything in `plans/<feature>/brainstorm.md`. This is raw material, not a polished document. Ideas that seem bad now may be useful later.

### Step 4: Identify actors and constraints

Map the people and systems involved:

- Who interacts with this? What are their goals?
- What external systems are involved?
- What are the hard constraints (technical, business, timeline)?
- What are the soft constraints (preferences, conventions)?

**Granularity check for toggles, filters, and settings.** If the solution involves any toggle, filter, preference, or configurable setting, ask explicitly:

- Does this apply **globally**, **per-entity**, **per-day**, or **per-entity-per-day**?
- Can different users/roles have different values?
- What is the default, and can it be changed after initial setup?

Toggle granularity is a common source of late scope changes. A "Slots toggle" that starts global but needs to be per-room-per-day is a full rework. Catching it during brainstorm is nearly free.

### Step 5: Surface open questions

List everything that isn't known yet:

- What do we need to find out before we can make decisions?
- What experiments or spikes would reduce uncertainty?
- Who else should we talk to?

### Step 6: Converge — identify the path

Help the user narrow down:

- Which ideas have the best effort/impact ratio?
- What are the deal-breaker constraints?
- What's the simplest thing that could work?
- What can we defer to a later phase?

When the brainstorm feels complete and the user has a clear direction, suggest running `/forge:prd <feature>` to formalize into a PRD.

---

## What Makes a Good Brainstorm

| Good | Bad |
|------|-----|
| Explores multiple approaches | Jumps to the first solution |
| Surfaces unknowns explicitly | Assumes away complexity |
| Captures "why not" for rejected ideas | Discards ideas without explanation |
| Maps constraints before converging | Converges before understanding the space |
| Includes codebase findings | Brainstorms in a vacuum |

## When to Skip Brainstorm

For small, well-understood changes (bug fixes, config changes, straightforward features), skip directly to `/forge:prd`. Brainstorm is for when the problem space is ambiguous, there are multiple viable approaches, or the stakes are high enough to warrant exploration.
