---
feature: forge tasks edit (editor mode)
created: 2026-04-16
status: draft
---

# Brainstorm: `forge tasks edit`

## Problem Space

The reviewer named this directly:

> The CLI is optimized for the creation pass (one-shot `forge tasks create` with all fields) but not the iteration pass. A `forge tasks edit SK-5.1` that opens the task in `$EDITOR` as YAML/markdown (then writes back to JSON on save) would collapse the whole review-fix cycle into a single tool call instead of the Python scripts I resorted to.

Review cycles (self-review → fix → external review → fix) are high-iteration: read a task, find the issue, update one field, re-validate, repeat. Today each field update is its own CLI invocation, and `--acceptance` only appends — forcing the reviewer to drop to Python and mutate `tasks.json` directly.

The existing `update`/`comment`/`label`/`dep` subcommands are optimized for **agents emitting precise mutations** (creation pass). `edit` is for **humans iterating in a buffer** (iteration pass). Both should coexist.

## Current State

- `forge tasks update <id> --field value` exists but:
  - `--acceptance` appends, no replace
  - One field per invocation; multi-field edits = N commands
  - No way to delete a task (reviewer's issue #7)
- `tasks.json` is the source of truth. Direct edits work but bypass schema enforcement.
- File lock infra exists at `src/lib/lock.ts` — reference for atomic-write patterns.

## Decisions (V1 scope)

| # | Question | Answer |
|---|----------|--------|
| 1 | Buffer format | **Markdown with YAML frontmatter.** Optimized for human readability; frontmatter holds structured fields, body holds prose fields that are already markdown-in-JSON. |
| 2 | Scope per invocation | Single task only. No multi-task / subtree editing in V1. |
| 3 | Non-editable fields | Shown as commented-out reference header in the buffer, for context. Not parsed on save. |
| 4 | Validation on save | **Crontab-style** — save fails → error shown → buffer re-opens with the user's edits preserved. User can abort to discard. |
| 5 | Concurrency | **Optimistic** — hash the task (or whole file) on open, verify on save. If changed underneath, refuse write and show what changed; user can abort or force. |

## Design sketch

### Buffer layout

```markdown
# SK-5.1: Set up Sentry for error tracking
#
# Fields below the '---' marker are editable. Fields in this header
# block are machine-maintained and shown for reference only.
#
#   id:          SK-5.1
#   status:      open
#   created:     2026-04-12T14:33:00Z
#   closeReason: (null)
#   comments:    2 entries — use `forge tasks comment SK-5.1` to add
#
# To cancel, exit your editor without saving, or delete all content.

---
title: Set up Sentry for error tracking
priority: 10
labels:
  - gate:human
  - phase:5.5
dependencies: []
---

## Description

We need error tracking before we ship the PWA warm-open perf work. Sentry is
the team's existing standard.

## Design

- Use the browser SDK with session replay disabled.
- Route DSN through `VITE_SENTRY_DSN` env var (gate:human → human sets up the
  account and populates the secret).

## Acceptance

- [ ] Sentry account created and DSN captured
- [ ] SDK installed and initialized in the PWA entry point
- [ ] A thrown error in dev shows up in the Sentry dashboard within 30s

## Notes

Ping @platform channel when the account is ready so the team can claim admin
seats.
```

**Frontmatter fields** (structured, YAML):
- `title: string`
- `priority: number`
- `labels: string[]`
- `dependencies: string[]`

**Body sections** (markdown, header-delimited):
- `## Description` → `task.description`
- `## Design` → `task.design`
- `## Acceptance` → parsed from `- [ ]` checkboxes into `task.acceptance: string[]` (natural acceptance-criteria rendering; solves reviewer issue #3 — full replacement is implicit)
- `## Notes` → `task.notes`

Missing sections → empty string (or empty array for acceptance). Extra sections → validation error.

### Command surface

```
forge tasks edit <task-id>
  [--format yaml]           # alternate: full YAML, no markdown, for scripting
  [--editor <cmd>]          # override $VISUAL/$EDITOR
  [--force]                 # skip optimistic concurrency check on save
  [--dry-run]               # print the would-be diff, don't write
```

Editor selection: `$VISUAL` → `$EDITOR` → `vi` (git convention).

### Save flow

1. Read `tasks.json`, locate the task, hash its serialized form.
2. Render to markdown buffer, write to a temp file in `$TMPDIR`.
3. Spawn the editor synchronously.
4. On editor exit:
   - If buffer is empty or unchanged → abort silently.
   - Parse the buffer. On parse error → crontab-style: re-open with error as a leading comment.
   - Re-read `tasks.json`, re-hash the task.
   - If hash differs from step 1 → concurrency conflict: show the diff, re-open buffer with a header comment explaining; user can abort or resolve.
   - Apply validation (type checks, DAG integrity for `dependencies` changes). On fail → crontab-style re-open.
   - Write back to `tasks.json` using the same atomic write path as other mutations.

### Parse rules (markdown → task)

- Frontmatter: standard YAML between `---` delimiters. Unknown keys → error.
- Body: split on `## Section` headers. Known sections only (Description / Design / Acceptance / Notes).
- Acceptance: each `- [ ]` or `- [x]` line becomes one `acceptance[]` entry (text only; we don't persist checked state in V1).
- Trim trailing whitespace from every captured field.

### Error re-open UX

When validation or parse fails, re-open the same buffer with a leading block comment:

```
# edit failed — fix the issues below and save again, or quit to abort:
#
#   - acceptance[0]: empty string
#   - dependencies: SK-9.9 does not exist
#
---
title: ...
```

User sees the exact issue inline without losing their edits. This is the crontab pattern.

## Wild ideas / deliberately deferred

- **Multi-task editing** — `forge tasks edit SK-5 --children` dumps all child tasks into one buffer. Powerful for bulk review fixes but merging and ID tracking are non-trivial. Revisit if single-task edit isn't fast enough.
- **Preserve comments across round-trip** — V1 shows comments as count in the read-only header. Full comment round-tripping in the buffer adds complexity; use `forge tasks comment` for adds.
- **Git-style three-way merge on concurrency conflict** — V1 bails with a diff. Three-way merge is a rabbit hole.
- **Inline validation hints** — render expected types / link to schema in the read-only header. Probably worthwhile, but not blocking V1.
- **`forge tasks edit --create`** — open an empty buffer to create a new task. Overlaps with `forge tasks create`; skip for V1.

## Actors

- **Human reviewer doing iteration** — primary user. Opens an editor they already know, edits multiple fields at once, saves.
- **Coding agent** — not the primary user for `edit`; agents should continue using `update`/`create` with explicit flags (creation-pass ergonomics). Agents CAN use `edit` via `--format yaml` + writing the buffer to a file + invoking with a custom `$EDITOR` command, but that's an escape hatch, not the happy path.
- **`forge tasks validate`** — shares the validation logic that `edit` uses on save.

## Constraints

- Must not require new dependencies for YAML parsing if we can avoid it; check what's already in the tree (a yaml lib is likely present via the plans tooling — verify during implementation).
- Atomic writes — use the same path as `update`/`create` mutations so `edit` doesn't create a new concurrency failure mode.
- Editor subprocess must inherit stdio so the user sees their editor as normal (no swallowed TTY).
- Behavior under `CI=true` or no TTY: fail fast with a clear message — `edit` is for interactive use.

## Codebase notes

- Mutations: `src/lib/tasks/mutations.ts`
- Validation: `src/lib/tasks/validate.ts`
- Types: `src/lib/tasks/types.ts:26`
- `forge tasks` dispatcher: `src/commands/tasks.ts:1` — add `edit` to `RESERVED` list and wire a handler.
- Lock file infra: `src/lib/lock.ts` — reference for atomic-write patterns.

## Open questions for PRD phase

1. Where does the YAML parser come from — existing dep, add one, or hand-roll a subset parser for the narrow frontmatter shape we accept?
2. Should `--dry-run` show a unified diff, a before/after pair, or just the structured field-by-field change list?
3. `--force` on concurrency conflict: does it blindly overwrite (risky) or re-apply on top of the current state (merge)?
4. Interplay with `forge tasks delete` (from the umbrella plan): if the user deletes all content, is that "abort" or "delete task"? Leaning: abort — deletion should be explicit via `forge tasks delete`.
5. How should the acceptance-criteria parser handle nested lists or prose paragraphs under `## Acceptance`? Strict (only top-level `- [ ]` lines) or lenient (first line of each list item)?

## Next step

Fold this + the `human-gated-tasks` brainstorm into an umbrella PRD: `forge prd cli-iteration-mode`.
