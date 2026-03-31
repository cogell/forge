---
name: forge
description: End-to-end feature pipeline from brainstorm through PRD, implementation plan, task decomposition, execution, and documentation graduation. Use when user wants to brainstorm, write a PRD, create an implementation plan, decompose into tasks, manage docs lifecycle, or mentions "forge", "ship a feature", or "pipeline".
targets: [claude, cursor, windsurf, codex, gemini]
---

# Forge

Ship features through a structured pipeline: Brainstorm → PRD → Plan → Tasks → Code → Docs.

## Commands

When used as a Claude Plugin, these are available as `/forge:<command>`. Otherwise, use the `forge` CLI or follow the process docs.

| Command | What it does | Output |
|---------|-------------|--------|
| `forge status [feature]` | Detect pipeline state, suggest next step | status report |
| `forge init` | Set up `plans/_template/` and `docs/` structure | dirs + templates |
| `forge brainstorm <feature>` | Divergent exploration: map problem space | `plans/<feature>/brainstorm.md` |
| `forge prd <feature>` | Interview → write PRD | `plans/<feature>/prd.md` |
| `forge plan <feature>` | Slice PRD into phased plan | `plans/<feature>/plan.md` |
| `forge tasks <feature>` | Decompose plan into tasks DAG | `plans/<feature>/tasks.json` |
| `forge run <feature>` | Autopilot: plan → tasks → implement → docs → PR | feature branch + PR |
| `forge docs [--phase\|--ship] <f>` | Documentation lifecycle management | `docs/` updates |

## Pipeline Stages

| Stage | Evidence | Next action |
|-------|----------|-------------|
| No project | Missing `plans/` or `docs/` directories | `forge init` |
| Needs brainstorm | No `plans/<feature>/` directory | `forge brainstorm <feature>` |
| Needs PRD | brainstorm.md exists, no prd.md | `forge prd <feature>` |
| Needs plan | PRD exists, no plan.md | `forge plan <feature>` |
| Needs tasks | Plan exists, no tasks epic | `forge tasks <feature>` |
| In progress | Epic open, tasks remaining | `forge tasks ready` |
| Needs graduation | Epic closed, docs not updated | `forge docs --ship <feature>` |
| Complete | Plan `status: completed`, docs graduated | — |

## The Three-Layer Model

| Layer | Directory | Lifecycle |
|-------|-----------|-----------|
| **Planning** | `plans/` | Feature-scoped: active → completed → historical |
| **Knowledge** | `docs/` | Evergreen: trimmed, never "completed" |
| **Execution** | `plans/<feature>/tasks.json` | Transient: closed and compacted |

## Quick Workflows

**New feature end-to-end (automated):**

```
forge brainstorm my-feature    # explore problem space
forge prd my-feature           # interview → PRD
forge run my-feature           # autopilot: plan → tasks → implement → docs → PR
```

**New feature end-to-end (manual):**

```
forge init                     # first time only
forge brainstorm my-feature    # diverge
forge prd my-feature           # converge → PRD
forge plan my-feature          # vertical slices → phased plan
forge tasks my-feature         # decompose → epic + tasks DAG
forge tasks ready              # start executing
forge docs --ship my-feature   # graduate docs after shipping
```

## Reference

Each command has detailed process documentation in the `guidance/` directory:

- [brainstorm-process.md](../../guidance/brainstorm-process.md) — Divergent exploration protocol
- [prd-process.md](../../guidance/prd-process.md) — Interview process, deep modules, PRD structure
- [plan-process.md](../../guidance/plan-process.md) — Vertical slicing, tracer bullets, durable decisions
- [tasks-process.md](../../guidance/tasks-process.md) — Task decomposition, complexity scoring, DAG validation
- [run-process.md](../../guidance/run-process.md) — Automated execution: task loop, review loop, salvage, PR strategy
- [docs-process.md](../../guidance/docs-process.md) — Init, health check, graduation, pruning
- [tdd.md](../../guidance/tdd.md) — RED → GREEN → REFACTOR cycle for task execution
- [debugging.md](../../guidance/debugging.md) — Systematic debugging protocol for salvage agents
- [philosophy.md](../../guidance/philosophy.md) — Three-layer model, Diataxis, writing practices
- [templates.md](../../guidance/templates.md) — Canonical PRD, plan, and ADR templates
