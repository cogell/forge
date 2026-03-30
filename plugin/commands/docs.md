---
description: Documentation lifecycle — health check, phase graduation, or full ship graduation
argument-hint: "[--phase|--ship] [feature-name]"
---

Run `forge docs $ARGUMENTS` to get a structured report.

Then act on the findings:

## Modes

### Health Check (`/forge:docs` — no flags)

Read-only scan. Reports findings without making changes.

**Checks:**
- Structure: docs/, decisions/, plans/, _template/ exist
- README.md under 200 lines
- No stale references to removed tools/APIs
- Architecture reflects current system
- No plans with `status: active` that are actually completed
- Every doc reachable from README or table of contents
- Active plans have both prd.md and plan.md
- Diataxis compliance: guides are task-oriented, reference is factual

Output a report with Good / Needs Attention / Missing sections.

### Phase Graduation (`/forge:docs --phase <feature>`)

Run when a task phase finishes. Lightweight pass:

1. Identify what shipped — check recently closed tasks
2. Decision-worthy? New technical approach, library, schema change → ADR in `docs/decisions/`
3. Guide-worthy? New repeatable workflow → guide in `docs/guides/`
4. Reference changed? Config, env vars, API surface → update `docs/reference/`
5. Architecture changed? New component → update `docs/architecture.md`
6. Graduate reflections from `plans/<feature>/reflections.md`

### Full Ship (`/forge:docs --ship <feature>`)

Run when entire PRD/plan is complete. Full graduation:

1. Mark plan completed — update frontmatter `status: completed`
2. Walk every phase — run phase-complete checklist for each
3. Graduate ALL reflections — every entry must be graduated or marked kept
4. Capstone ADR for significant features
5. Prune existing docs against new reality
6. Dead doc sweep — find docs describing removed features
7. Archive plan: `mv plans/<feature> plans/_archive/<feature>`
8. Verify completeness

## Deep Reference

See [docs-process.md](../../guidance/docs-process.md) for the full health check checklist, Diataxis compliance checks, and pruning guidelines.
