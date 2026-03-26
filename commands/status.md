---
description: Detect pipeline state and suggest next steps for all features or a specific one
argument-hint: [feature-name]
---

Run `forge status $ARGUMENTS` to get the current pipeline state.

If the CLI is not available, manually inspect:

1. Scan `plans/*/` for PRDs and plans. Read `status:` frontmatter.
2. Query beads: `bd search <feature>` — look for epics and their task states.
3. Report each feature's current stage and suggest the next action.

| Stage | Evidence | Next action |
|-------|----------|-------------|
| No project | Missing `plans/` or `docs/` directories | `/forge:init` |
| Needs brainstorm | No `plans/<feature>/` directory | `/forge:brainstorm <feature>` |
| Needs PRD | brainstorm.md exists, no prd.md | `/forge:prd <feature>` |
| Needs plan | PRD exists, no plan.md | `/forge:plan <feature>` |
| Needs tasks | Plan exists, no beads epic | `/forge:tasks <feature>` |
| In progress | Beads epic open, tasks remaining | `bd ready` |
| Needs graduation | Epic closed, docs not updated | `/forge:docs --ship <feature>` |
| Complete | Plan `status: completed`, docs graduated | — |
