---
status: active
feature: agent-orchestration-mngr
created: 2026-04-02
completed: null
execution: single-pr
---

# Plan: agent-orchestration-mngr

> Source PRD: plans/agent-orchestration-mngr/prd.md

## Architectural Decisions

- **Language**: Python 3.11+ script. External to the forge TypeScript CLI. Uses `subprocess` to invoke `mngr` commands and `yaml` (stdlib `tomllib`-style — use `python-yaml` / `PyYAML`) for checkpoint I/O. No new npm dependencies.
- **Entry point**: `scripts/forge-run-mngr` — a single executable Python file (`chmod +x`). Shebang: `#!/usr/bin/env python3`. No install step; run directly.
- **Step prompts**: `scripts/step-prompts/<step>.md` — one file per step (plan, plan-review, tasks, tasks-review, execute, docs, pr). Fix agent prompt assembled in-script from a template.
- **Result file path**: `plans/<feature>/step-results/<step>.json` — written by step agents to signal completion. Script polls with 30-second interval.
- **Checkpoint path**: `plans/<feature>/pipeline.yaml` — same format as `plans/agent-orchestrator/prd.md` specifies. Script owns reads and writes.
- **mngr agent naming**: `forge-{feature}-{step}` for step agents; `forge-{feature}-{step}-review-{n}` for review agents; `forge-{feature}-{step}-fix-{n}` for fix agents.
- **Constants**: `MAX_REVIEW_PASSES = 7`, `DEFAULT_TIMEOUT_MINUTES = 30`, `POLL_INTERVAL_SECONDS = 30` — defined at top of script.
- **Local-only**: All agents run on local host. No `@modal` or `@docker` targeting.

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/forge-run-mngr` | create | Main orchestration script — checkpoint, agent lifecycle, review gate loop, CLI |
| `scripts/step-prompts/plan.md` | create | Prompt for plan creation agent (self-review + result file instruction) |
| `scripts/step-prompts/plan-review.md` | create | Prompt for fresh-context plan review agent |
| `scripts/step-prompts/tasks.md` | create | Prompt for task DAG creation agent (self-review + result file instruction) |
| `scripts/step-prompts/tasks-review.md` | create | Prompt for fresh-context tasks review agent |
| `scripts/step-prompts/execute.md` | create | Prompt for execute step agent (full task loop) |
| `scripts/step-prompts/docs.md` | create | Prompt for docs graduation agent |
| `scripts/step-prompts/pr.md` | create | Prompt for PR creation agent |
| `scripts/__tests__/test_forge_run_mngr.py` | create | Unit tests for checkpoint I/O, polling logic, review gate state machine |

## Phase 1: Core orchestration script

**User stories**: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10

### What to build

**Main script** (`scripts/forge-run-mngr`):

CLI interface:
```
forge-run-mngr <feature>                    # run pipeline (resume if checkpoint exists)
forge-run-mngr --reset <feature>            # clear checkpoint and exit
forge-run-mngr --status <feature>           # print checkpoint state and exit
forge-run-mngr --timeout <minutes> <feature> # override per-step timeout (default: 30)
forge-run-mngr --dry-run <feature>          # print mngr commands without executing
```

Core logic:

```python
STEPS = ["plan", "plan-review-gate", "tasks", "tasks-review-gate", "execute", "docs", "pr"]

def run_pipeline(feature, timeout_minutes, dry_run):
    checkpoint = read_checkpoint(feature) or init_checkpoint(feature)

    for step in STEPS:
        if checkpoint["steps"][step]["status"] == "complete":
            print(f"  ✓ {step}")
            continue

        print(f"  → {step}")
        run_step(feature, step, checkpoint, timeout_minutes, dry_run)

def run_step(feature, step, checkpoint, timeout_minutes, dry_run):
    if step in ("plan-review-gate", "tasks-review-gate"):
        run_review_gate(feature, step, checkpoint, timeout_minutes, dry_run)
    else:
        run_agent_step(feature, step, checkpoint, timeout_minutes, dry_run)

def run_agent_step(feature, step, checkpoint, timeout_minutes, dry_run):
    agent = f"forge-{feature}-{step}"
    prompt = load_prompt(step, feature)
    mark_step(checkpoint, feature, step, "in-progress")

    mngr("create", agent)  # claude is the default type
    mngr("message", agent, "--message-file", prompt_path)
    result = poll_result(feature, step, timeout_minutes)
    mngr("destroy", "--force", agent)

    if result["status"] == "failed":
        mark_step(checkpoint, feature, step, "failed")
        sys.exit(f"Step '{step}' failed: {result['summary']}")

    mark_step(checkpoint, feature, step, "complete")

def run_review_gate(feature, step, checkpoint, timeout_minutes, dry_run):
    artifact = step.replace("-review-gate", "")  # "plan" or "tasks"
    passes = checkpoint["steps"][step].get("passes", 0)
    mark_step(checkpoint, feature, step, "in-progress")

    while passes < MAX_REVIEW_PASSES:
        passes += 1
        review_agent = f"forge-{feature}-{artifact}-review-{passes}"
        prompt = load_prompt(f"{artifact}-review", feature)

        review_prompt_path = f"scripts/step-prompts/{artifact}-review.md"
        mngr("create", review_agent)
        mngr("message", review_agent, "--message-file", review_prompt_path)
        result = poll_result(feature, f"{artifact}-review", timeout_minutes)
        mngr("destroy", "--force", review_agent)

        update_review_step(checkpoint, feature, step, passes, result)

        if result["verdict"] == "PASS":
            mark_step(checkpoint, feature, step, "complete")
            return

        # Fix pass — prompt assembled in-script (template + injected issues)
        fix_agent = f"forge-{feature}-{artifact}-fix-{passes}"
        fix_prompt_text = build_fix_prompt(artifact, feature, result["issues"])
        fix_prompt_path = write_temp_prompt(fix_prompt_text)
        mngr("create", fix_agent)
        mngr("message", fix_agent, "--message-file", fix_prompt_path)
        poll_result(feature, f"{artifact}-fix", timeout_minutes)
        mngr("destroy", "--force", fix_agent)

    # Cap reached
    issues = checkpoint["steps"][step]["last-result"]["issues"]
    mark_step(checkpoint, feature, step, "failed")
    sys.exit(f"Review gate for '{artifact}' failed after {MAX_REVIEW_PASSES} passes.\n"
             f"Unresolved issues:\n" + "\n".join(f"  - {i}" for i in issues))
```

Checkpoint functions:
- `read_checkpoint(feature)` — read `plans/<feature>/pipeline.yaml`, return dict or None if missing/malformed
- `init_checkpoint(feature)` — create fresh checkpoint with all steps `pending`, write to file
- `write_checkpoint(feature, checkpoint)` — serialize and write checkpoint YAML
- `clear_checkpoint(feature)` — delete `plans/<feature>/pipeline.yaml`, no-op if missing
- `mark_step(checkpoint, feature, step, status)` — update step status and write checkpoint
- `update_review_step(checkpoint, feature, step, passes, result)` — update passes + last-result, write checkpoint

Polling:
- `poll_result(feature, step, timeout_minutes)` — loop every `POLL_INTERVAL_SECONDS`, raise `TimeoutError` at `timeout_minutes * 60`

mngr wrapper:
- `mngr(*args, dry_run=False)` — `subprocess.run(["mngr"] + list(args))`, in dry-run mode prints command instead
- `write_temp_prompt(text)` — writes fix prompt text to a temp file, returns path (used because fix prompts are assembled at runtime, not static files)

**Step prompts** (`scripts/step-prompts/`):

Each prompt wraps the relevant guidance doc reference and appends the result file instruction. Example structure for `plan.md`:

```markdown
You are creating an implementation plan for the <FEATURE> feature.

Follow the process in guidance/plan-process.md exactly.

## Source material
Read: plans/<FEATURE>/prd.md

## After writing the plan

Run the self-review checklist from guidance/review-gates.md (self-review section)
inline — fix any issues before writing your result file.

## When done

Write this JSON to plans/<FEATURE>/step-results/plan.json:
{"step": "plan", "status": "complete", "summary": "<one-line description>"}

If you cannot complete the task, write:
{"step": "plan", "status": "failed", "summary": "<what went wrong>"}
```

The `plan-review.md` prompt wraps the plan review criteria from `review-gates.md` verbatim, with the feature path injected. Result file includes `verdict`, `critical`, `major`, `minor`, and `issues` fields.

The `execute.md` prompt references `run-process.md` for the full task loop protocol.

**Fix agent prompt** (assembled in-script):

```python
def build_fix_prompt(artifact, feature, issues):
    return f"""A review agent found issues in the {artifact} artifact for the {feature} feature.
Fix the issues, then write your result file.

## Artifact
Read: plans/{feature}/{artifact}.md  (or tasks.json for tasks)

## Issues to fix
{chr(10).join(f'- {i}' for i in issues)}

## Instructions
Fix only the listed issues. Do not restructure or expand scope.
Re-run the self-review checklist from guidance/review-gates.md after fixing.

## When done
Write: plans/{feature}/step-results/{artifact}-fix.json
{{"step": "{artifact}-fix", "status": "complete", "summary": "fixed N issues"}}
"""
```

**Unit tests** (`scripts/__tests__/test_forge_run_mngr.py`):

- `read_checkpoint` returns None for missing file
- `read_checkpoint` returns None for malformed YAML (does not raise)
- `init_checkpoint` creates file with all 7 steps `pending`
- `write_checkpoint` + `read_checkpoint` round-trip preserves all fields
- `mark_step` updates status and writes checkpoint
- `clear_checkpoint` deletes file; second call is no-op
- `poll_result` raises `TimeoutError` when file not created within timeout
- `poll_result` returns parsed JSON when file appears
- Review gate loop: PASS on first review advances step to `complete`
- Review gate loop: FAIL then PASS advances step to `complete` with passes=2
- Review gate loop: 7 consecutive FAILs exits with non-zero code and failure message
- `--reset` calls `clear_checkpoint` and exits without running pipeline
- `--status` prints step statuses without running pipeline
- `--dry-run` calls `mngr()` mock with `dry_run=True`, prints commands, does not execute

### Acceptance criteria

- [ ] `scripts/forge-run-mngr <feature>` with no checkpoint runs all 7 steps in order
- [ ] `scripts/forge-run-mngr <feature>` with a partial checkpoint skips completed steps and resumes — no confirmation prompt
- [ ] `scripts/forge-run-mngr --reset <feature>` deletes `plans/<feature>/pipeline.yaml` and exits; does not start pipeline
- [ ] `scripts/forge-run-mngr --status <feature>` prints the status of all 7 steps and exits
- [ ] `scripts/forge-run-mngr --dry-run <feature>` prints all mngr commands without executing them
- [ ] Checkpoint is written after each step completes or fails — not only at the end
- [ ] In-progress steps on restart are re-run from the beginning (step agents are stateless relative to the script)
- [ ] Review gate loop: on PASS, step marked `complete`, pipeline advances
- [ ] Review gate loop: on FAIL, fix agent spawned, then review agent spawned again; pass count increments
- [ ] Review gate loop: at 7 FAIL passes, step marked `failed`, script exits with unresolved issues printed
- [ ] Checkpoint `plan-review-gate` and `tasks-review-gate` steps include `passes`, `last-result.verdict`, `last-result.critical`, `last-result.major`, `last-result.minor`, and `last-result.issues` after each review pass
- [ ] Step agent timeout: after `--timeout` minutes (default 30) with no result file, agent destroyed, step marked `failed`, script exits
- [ ] `mngr destroy` called for every agent after its result is read (success or failure)
- [ ] Each step prompt references the correct guidance doc and includes the result file writing instruction
- [ ] Plan step prompt includes self-review checklist instruction (inline, not a subagent)
- [ ] Tasks step prompt includes self-review checklist instruction (inline, not a subagent)
- [ ] Plan review prompt uses the plan review criteria verbatim from `guidance/review-gates.md`
- [ ] Tasks review prompt uses the tasks review criteria verbatim from `guidance/review-gates.md`
- [ ] Execute step prompt references `guidance/run-process.md` and instructs the agent to write result file when the full task loop completes
- [ ] Result files are written to `plans/<feature>/step-results/<step>.json` — not to any other location
- [ ] Script is executable (`chmod +x`) with `#!/usr/bin/env python3` shebang
- [ ] Manual validation: run against a test feature end-to-end, confirm all steps execute, checkpoint is updated, PR is created

### Testing plan

- **Unit tests** (`scripts/__tests__/test_forge_run_mngr.py`): Mock `subprocess.run` (mngr calls) and filesystem I/O. Test checkpoint functions, polling timeout, review gate state machine, and CLI flag handling. Run with `python -m pytest scripts/__tests__/`.
- **Dry-run smoke test**: `scripts/forge-run-mngr --dry-run test-feature` — verify all 7 mngr command sequences print correctly without errors.
- **Manual end-to-end**: Run against a real minimal test feature (existing PRD, no plan yet). Confirm: checkpoint created, each step produces result file, checkpoint updated, resume works after `kill`, `--reset` clears state.
