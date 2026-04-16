---
feature: Human-gated / prerequisite tasks for forge
created: 2026-04-16
status: draft
---

# Brainstorm: Human-gated tasks

## Problem Space

Some tasks can't be executed by an agent until a human does something outside the repo — e.g. SK-5.1 requires a Sentry account set up via sentry.io click-through. Today:

- `forge tasks ready` happily returns the task as ready (it has no dependencies it can see).
- `forge run` spawns an agent, which immediately fails.
- The human has no signal that a task needs their attention before agent time is wasted.

Feedback source: external reviewer using forge on a project with 4 phases / 16 ready tasks, including phases that require external-service setup.

## Current State

Task schema (`src/lib/tasks/types.ts`):
- `Task.status: "open" | "in_progress" | "closed"` — lifecycle only, no "blocked" variant.
- `Task.labels: string[]` — free-form, no conventions enforced.
- `Task.dependencies: string[]` — refers to other task IDs; no external-world concept.

`getReadyTasks` (`src/lib/tasks/queries.ts:93`) filters to leaf + open + deps-satisfied. No awareness of anything external.

`forge run` (per reviewer) consumes `ready` output and dispatches agents without a human-gate check.

## Decisions (V1 scope)

| # | Question | Answer |
|---|----------|--------|
| 1 | What counts as a gate? | Human-only action. No service/secret/hardware taxonomy in V1. |
| 2 | Schema shape | **Label convention** — `gate:human`. Zero schema change, ships fast. |
| 3 | How human clears | **Both** — batch command (`forge tasks gate clear <id>`) + interactive prompt inside `forge run`. |
| 4 | `ready` default | **Include but mark** — gated tasks appear in output with `gated: true` so callers decide. |
| 5 | Scope | Tasks only (not epics). |
| 6 | Clearance persistence | **Strip the label** — interactive "y" mutates the file, same as the batch command. |

## Design sketch

### Convention
A task is "gated" iff its `labels` contains `gate:human`.

### `forge tasks ready` output shape
```json
[
  { "id": "SK-5.2", "title": "...", "priority": 10, "labels": [...], "gated": false },
  { "id": "SK-5.1", "title": "Set up Sentry", "priority": 10, "labels": ["gate:human"], "gated": true }
]
```
Sort order unchanged. Callers (orchestration, humans, `--json` consumers) can filter on `gated`.

### `forge tasks gate clear <task-id>`
- Removes `gate:human` from the task's labels.
- Idempotent: no error if already cleared.
- Can be scripted or typed by the human after they've done the out-of-band work.

### `forge run` interactive prompt
When the loop picks up a task with `gated: true`:
```
SK-5.1 is human-gated.
  Title: Set up Sentry for error tracking
  Have you completed the prerequisite? (y/N)
```
- `y` → calls the equivalent of `gate clear` (strips the label), proceeds to dispatch agent.
- `N` (default) → skips this task, moves to the next ready one.

### Creation flow
For V1, add the label the same way any other label is added:
```
forge tasks create <feature> "Set up Sentry" --label gate:human
```
(Could add a `--gate human` shortcut later if it proves common; not needed V1.)

## Wild ideas / deliberately deferred

- **Richer gate taxonomy** (`gate:secret:SENTRY_DSN`, `gate:service:sentry-account`) — defer until V1 tells us whether "just human" is enough.
- **First-class `gates[]` field** on Task — more powerful but requires schema migration. Reconsider if we ever need multi-gate tasks or structured gate metadata.
- **Gate reason field** — right now the human has to read `description`/`notes` to know what's required. If labels-only feels opaque, add `gateInstructions: string` later.
- **Auto-detection** — e.g. agent checks for presence of `SENTRY_DSN` in env and clears a secret-gate automatically. Interesting, but out of scope for a human-only V1.
- **Gates on epics** — blocks all children. Deferred; easy to add later since it'd use the same label convention.

## Actors

- **Task author** — adds `gate:human` at creation time when they know a task needs out-of-band setup.
- **Human operator** — receives `forge run`'s prompt; clears gates after doing the work.
- **Orchestration loop (`forge run`)** — reads `gated: true` from `ready`, prompts before dispatch.
- **`--json` consumers** (CI, dashboards) — can filter or visualize gated tasks without agent involvement.

## Constraints

- Schema change must be zero (V1) — labels are already `string[]`.
- `forge tasks ready` output is consumed by `forge run` and possibly external scripts; adding a `gated` field is additive and safe, but worth noting.
- `forge tasks gate clear` needs to route through existing label-removal code (label mutations already exist per `mutations.ts`).

## Codebase notes

- `Task` type: `src/lib/tasks/types.ts:26`
- `getReadyTasks`: `src/lib/tasks/queries.ts:93`
- Label mutations live in `src/lib/tasks/mutations.ts`
- `forge tasks` dispatcher: `src/commands/tasks.ts:1`
- Reserved subcommand list: `src/commands/tasks.ts:35` — `gate` would be added here if we make it a top-level subcommand. Alternative: nest as `forge tasks gate clear` (two-word subcommand) for future extensibility.

## Open questions for PRD phase

1. Does `forge tasks gate clear` require the task to actually have the label, or silent no-op either way? (Leaning: silent — idempotent is friendlier.)
2. Should `--json` output include `gated` unconditionally, or only when true? (Leaning: unconditionally, for schema stability.)
3. In `forge run`'s prompt, should the default answer be `N` (skip) or `y` (proceed)? (Leaning: `N` — safer, encourages intentionality.)
4. Does the interactive prompt's "y" answer write through the same atomic write path used by `label remove`, to avoid races with other forge commands? (Assumed yes; verify during implementation.)

## Next step

Ready for `forge prd human-gated-tasks` once these open questions are resolved — or fold this directly into the umbrella "CLI iteration-mode" PRD as one of its phases.
