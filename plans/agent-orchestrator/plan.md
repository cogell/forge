---
status: active
feature: agent-orchestrator
created: 2026-04-02
completed: null
execution: single-pr
---

# Plan: agent-orchestrator

> Source PRD: plans/agent-orchestrator/prd.md

## Architectural Decisions

- **Checkpoint file**: `plans/<feature>/pipeline.yaml` — plain YAML file. Add `js-yaml` as a direct dependency (`pnpm add js-yaml`) and `@types/js-yaml` as a dev dependency (`pnpm add -D @types/js-yaml`). Use `js-yaml` for parsing and serializing. It is currently only a transitive dependency of `gray-matter` and not directly importable under pnpm strict mode.
- **Checkpoint module**: `src/lib/checkpoint.ts` — read/write/clear functions for the checkpoint file. Filesystem-based, no mutable state. Uses `(feature, cwd)` signature pattern consistent with `src/lib/tasks/io.ts`.
- **Constants**: `MAX_REVIEW_PASSES = 7`, `PIPELINE_FILENAME = "pipeline.yaml"` — defined in the checkpoint module.
- **Pipeline steps**: `plan`, `plan-review-gate`, `tasks`, `tasks-review-gate`, `execute`, `docs`, `pr` — 7 steps total. Each has status: `pending | in-progress | complete | failed`.
- **CLI extension**: `forge run --reset <feature>` deletes the checkpoint file and exits.
- **Skill prompt update**: `plugin/commands/run.md` rewritten to include review gates and checkpoint maintenance. `guidance/run-process.md` updated to document review gates on plan/tasks creation.

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/checkpoint.ts` | create | Checkpoint types, read/write/clear, constants |
| `src/lib/__tests__/checkpoint.test.ts` | create | Checkpoint I/O tests |
| `src/commands/run.ts` | modify | Add `--reset` flag, read/display checkpoint on resume |
| `src/commands/__tests__/run.test.ts` | create | CLI tests for `--reset` and checkpoint display |
| `plugin/commands/run.md` | modify | Rewrite with review gates + checkpoint protocol |
| `guidance/run-process.md` | modify | Add review gates for plan/tasks, checkpoint documentation |

## Phase 1: Checkpoint-driven run with review gates

**User stories**: 1, 2, 3, 4, 5, 6, 7, 8

### What to build

Add a checkpoint system to `/forge:run` and integrate review gates for plan and tasks creation.

**Checkpoint module** (`src/lib/checkpoint.ts`): Define the `PipelineCheckpoint` type with 7 named steps, each carrying a status and optional review metadata (pass count, last verdict, severity counts, issue summaries). Provide `readCheckpoint(feature, cwd)` to read `plans/<feature>/pipeline.yaml` (returns null if missing or malformed), `writeCheckpoint(feature, checkpoint, cwd)` to write it, and `clearCheckpoint(feature, cwd)` to delete it.

**CLI changes** (`src/commands/run.ts`): Add `--reset` flag handling — when present, call `clearCheckpoint()`, print confirmation, and exit without starting the pipeline. When no `--reset`, after existing precondition checks, call `readCheckpoint()`. If a checkpoint exists, print a resume status message showing completed steps and the next step to run. Include checkpoint state in the `--json` output.

**Skill prompt** (`plugin/commands/run.md`): Rewrite to include the full 7-step pipeline with explicit review gate protocol. The agent must:
1. Read or create the checkpoint at pipeline start
2. Skip completed steps
3. For review-gate steps: run self-review inline, then loop fresh-context review agents (via Agent tool) up to 7 passes, updating the checkpoint after each pass
4. On review pass failure at cap: mark step `failed`, stop pipeline, report unresolved issues
5. Update checkpoint status after each step completes

**Process documentation** (`guidance/run-process.md`): Add a section on review gates for plan and tasks creation. Document that the review-gate protocol from `review-gates.md` applies to plan and tasks within `/forge:run`, with the 7-pass cap specific to unattended execution.

### Acceptance criteria

- [ ] `readCheckpoint("feat", cwd)` returns null when no `pipeline.yaml` exists
- [ ] `readCheckpoint("feat", cwd)` returns a valid `PipelineCheckpoint` when `pipeline.yaml` exists
- [ ] `readCheckpoint` handles malformed YAML gracefully (returns null, does not throw)
- [ ] `writeCheckpoint("feat", checkpoint, cwd)` creates/overwrites `plans/feat/pipeline.yaml` with valid YAML
- [ ] Checkpoint YAML includes: feature name, started timestamp, and all 7 steps with status
- [ ] Review-gate steps in the checkpoint include: passes count, last verdict (PASS/FAIL), severity counts (critical/major/minor), and issue one-liners
- [ ] `clearCheckpoint("feat", cwd)` deletes `plans/feat/pipeline.yaml`
- [ ] `clearCheckpoint` does not throw if the file doesn't exist
- [ ] `forge run --reset <feature>` deletes the checkpoint and exits with a confirmation message — bypasses all precondition checks (PRD, forge.json, git clean)
- [ ] `forge run --reset` with no feature prints usage error and exits with code 1
- [ ] `forge run <feature>` with no checkpoint shows the full pipeline steps (existing behavior preserved)
- [ ] `forge run <feature>` with a partial checkpoint prints "Resuming from step: <step>" and shows completed/remaining steps — does not prompt for confirmation
- [ ] `forge run <feature> --json` includes checkpoint state in the JSON output as a `checkpoint` field on the existing response object (e.g., `{ status: "ready", feature, checks, steps, checkpoint: { ... } }`); `checkpoint` is `null` when no checkpoint exists
- [ ] `plugin/commands/run.md` includes the 7-step pipeline with review gates
- [ ] `plugin/commands/run.md` instructs the agent to read/create checkpoint at start
- [ ] `plugin/commands/run.md` instructs the agent to skip completed steps on resume
- [ ] `plugin/commands/run.md` instructs the agent to run self-review then fresh-context review loop for plan-review-gate and tasks-review-gate
- [ ] `plugin/commands/run.md` specifies the 7-pass cap with escalation to `failed` status and human notification
- [ ] `plugin/commands/run.md` instructs the agent to update the checkpoint after each step and review pass
- [ ] `plugin/commands/run.md` instructs the agent to resume review loops at the correct pass number (not restart from 1) when checkpoint shows in-progress review gate
- [ ] `guidance/run-process.md` documents review gates for plan and tasks creation
- [ ] `guidance/run-process.md` documents the 7-pass cap as forge:run-specific (not overriding review-gates.md general guidance)
- [ ] `guidance/run-process.md` documents the checkpoint file format and restart behavior
- [ ] `forge run <feature>` with a checkpoint containing a `failed` step prints the failure info (which step, unresolved issues) and exits — does not re-attempt the failed step
- [ ] Manual verification: run `/forge:run` on a test feature and confirm the agent follows the checkpoint protocol — creates checkpoint, updates it after each step, and resumes correctly after restart

### Testing plan

- **Unit tests** (`src/lib/__tests__/checkpoint.test.ts`): Test read/write/clear for checkpoint files. Test null return on missing file, null return on malformed YAML, round-trip write+read, partial checkpoint handling, and `clearCheckpoint` idempotency.
- **CLI tests** (`src/commands/__tests__/run.test.ts`): Test `--reset` flag deletes checkpoint and exits. Test resume output with partial checkpoint. Test `--json` output includes checkpoint state.
- **Prompt/guidance validation**: Manual — run `/forge:run` on a test feature and verify the agent follows the checkpoint protocol.
