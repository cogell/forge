# Forge: Philosophy & Principles

Reference material for the principles behind the forge pipeline.

## The Three-Layer Model

| Layer | Directory | Contains | Lifecycle |
|-------|-----------|----------|-----------|
| **Planning** | `plans/` | PRDs, plans, reflections | Feature-scoped: active → completed → historical |
| **Knowledge** | `docs/` | Architecture, guides, reference, ADRs | Evergreen: trimmed and updated, never "completed" |
| **Execution** | `.beads/` | Tasks, DAGs, swarms, progress | Transient: closed and compacted |

Planning artifacts *produce* knowledge artifacts. Execution *produces* reflections. When a feature ships, insights graduate into `docs/`.

## The Pipeline

```
1. Brainstorm    (plans/<feature>/brainstorm.md)   — divergent exploration
2. PRD           (plans/<feature>/prd.md)           — the "what and why"
3. Plan          (plans/<feature>/plan.md)          — the "how, in what order"
4. Tasks         (.beads/)                           — the "do it now"
5. Code                                              — the output
6. Reflections   (plans/<feature>/reflections.md)   — learnings during execution
7. Docs          (docs/)                             — graduated knowledge
```

## Reflections

`plans/<feature>/reflections.md` is an append-only log of learnings discovered during implementation.

**Why scoped to the plan, not global?**
- Discoverable in context next to the work that produced them
- Archiving a plan forces review (natural graduation trigger)
- No single global file growing unbounded

**What to capture:** Platform gotchas, debugging discoveries, validated patterns, process improvements.

**Graduation criteria:** validated pattern, future work needs to find it, describes a reusable constraint.

## The Diataxis Framework

| | Learning | Working |
|---|----------|---------|
| **Practical** | Tutorials | How-to Guides |
| **Theoretical** | Explanation | Reference |

A document should be one type. Don't mix.

## Core Principles

- Docs in the same PR as code changes
- Dead docs are bugs
- Trim like a bonsai tree
- The best system is the one your team actually maintains
