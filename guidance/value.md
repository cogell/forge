# Forge: Value Thinking

Guidance for deciding what to build, how much to build, and when to stop. Applied during brainstorm, PRD, and planning — before execution begins.

## The Core Rule

> Value starts only when software is in users' hands. Build the most valuable thing first, ship it early, and let what you learn steer what comes next.

---

## Why This Matters

You can execute the pipeline perfectly — clean vertical slices, thorough TDD, polished docs — and still ship the wrong thing. Value thinking is the lens that prevents that. It operates upstream of the pipeline: influencing what enters it, what gets prioritized within it, and when to stop.

---

## Principles

### 1. Value is what the user needs, not what we planned

Value is subjective and contextual. It might be revenue, speed, reliability, information, or user happiness. Don't try to reduce it to a single number. Instead: take any two things, ask which is more valuable *right now*, and ask why. Build shared understanding, not spreadsheets.

### 2. Smaller, sooner beats bigger, later

Most users don't use most features. A smaller set of features shipped sooner delivers real value earlier — and gives you information about whether you're heading in the right direction. That information is itself valuable.

### 3. Every phase should be a viable stopping point

When slicing a plan into phases, each phase should deliver enough value that you could ship it and move on. Phase 1 is not scaffolding for Phase 3 — it's a product increment that stands on its own. If you learn after Phase 1 that the problem is solved, the remaining phases are waste you avoided.

### 4. Don't build foundation first

The temptation to build infrastructure before features defers all value and inhibits your ability to steer. Infrastructure belongs *inside* Phase 1 — just enough to support the thinnest valuable slice. Grow the foundation as features demand it.

### 5. Steering beats predicting

You will never know the right plan upfront. Ship early, observe what happens, and adjust. The goal is not to predict the future — it's to stay responsive to what you learn.

---

## How to Apply

### During Brainstorm

When converging on a direction, ask:
- Is this the most valuable problem we could solve right now?
- What's the cheapest experiment that would tell us if we're right?
- Who specifically benefits, and how soon?

### During PRD

Before writing, establish:
- **Why this, why now?** — What makes this more valuable than alternatives?
- **What's the minimum that would solve the user's problem?** — Resist the urge to design the full vision when a subset would ship real value.

### During Planning

When slicing phases:
- Rank phases by value delivered, not by technical dependency alone.
- Identify the earliest phase that constitutes a shippable product increment.
- Ask: "If we stopped after Phase N, would users get real value?"
- Choose an execution strategy based on how much human steering you want between phases (see [plan command](../plugin/commands/plan.md)).

---

## Anti-Patterns

| Pattern | Why it fails |
|---|---|
| Treating every feature that enters the pipeline as equally worth completing | You execute perfectly on low-value work while high-value work waits |
| Building all planned phases because "we already planned them" | Sunk-cost thinking — the plan is a tool, not a commitment |
| Deferring all value to a "big launch" | You learn nothing until it's too late to change course |
| Measuring value purely in numbers | Trailing indicators arrive too late; small differences don't matter; build shared understanding instead |
| Building foundation before features | Defers value, removes steering ability, over-invests in assumptions |
