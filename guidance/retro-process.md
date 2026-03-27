# Forge: Retro — Root Cause Analysis for Review Escapes

When a reviewer (human or agent) finds issues on a PR that was marked "ready for review," the upstream pipeline failed to catch something it should have. The retro process diagnoses why and patches the system so the same class of failure cannot recur.

**Key distinction:** Review loops, salvage agents, and fix agents catching issues during `forge run` is the system working correctly. The retro triggers only when issues survive to the review stage — past all automated checks, review agents, and quality gates.

## When to trigger

- A human reviews a PR and requests changes
- An agent reviewing a completed PR finds issues
- Any issue found after the orchestrator marked the work "ready"

The retro is not a pipeline gate. It's an event-driven process invoked by whoever finds the problem.

## Inputs

1. **PR review feedback** — pulled from GitHub via `gh`, pasted by the human, or provided by the reviewing agent
2. **Human context** (optional) — anything not captured in PR comments ("this felt wrong but I couldn't articulate it in a comment")

## Process

### Step 1: Gather the evidence

```bash
# Pull PR review comments
gh pr view <pr-number> --comments --json comments,reviews

# Read the feature's existing retro doc (if any)
cat plans/<feature>/retro.md
```

Ask the reviewer (human or agent): "Is there anything else not captured in the PR comments?"

### Step 2: Classify each issue

For each issue found in the review, assign it to exactly one root cause category:

| Category | Signal | Example |
|----------|--------|---------|
| **Review criteria gap** | The review agent's prompt didn't check for this | Review agent passed code with a race condition because concurrency isn't in the review checklist |
| **Task spec gap** | The task description or acceptance criteria were ambiguous or incomplete | Task said "handle errors" but didn't specify which errors, so the agent guessed wrong |
| **Project guidance gap** | The agent didn't know something domain-specific | Agent used `console.log` for logging instead of the project's structured logger because no guide mentioned it |
| **Tooling gap** | No automated check exists that would have caught this | No linter rule for the pattern that was violated; type system couldn't express the constraint |
| **Forge workflow gap** | The pipeline structure allowed the issue through | The TDD protocol doesn't cover integration tests, so unit tests passed but the feature is broken end-to-end |

### Step 3: Propose a fix for each issue

Every classified issue must produce a **concrete, actionable fix** — not a note, not a reminder. The fix is a diff to one of:

- `guidance/run-process.md` — review agent prompt, task agent prompt, workflow steps
- `guidance/*.md` — forge-level process or philosophy changes
- `docs/guides/` — project-level guides the agent should have had
- `docs/reference/` — project-level reference docs
- Linter config, CI checks, or other automated tooling
- `plugin/commands/*.md` — command-level guidance

If the fix requires a change to forge itself (not just the project), note it clearly — forge changes apply to all future projects, not just this one.

### Step 4: Write the retro doc

Append to `plans/<feature>/retro.md`. If the file doesn't exist, create it:

```markdown
# Retro: <feature>

Issues found during review that should have been caught upstream.
Each entry includes the root cause and the fix applied.

---

## Round 1 — <date>

### Issue: <short description>
**Category:** <one of the five categories>
**Found by:** <human | agent>
**What happened:** <1-2 sentences — what was wrong>
**Why it escaped:** <1-2 sentences — why the pipeline didn't catch it>
**Fix:** <what was changed, with file path>
**Commit:** <hash, if applicable>
```

The retro doc is an append-only list. Multiple review rounds produce multiple sections (`Round 1`, `Round 2`, etc.). Each round may have multiple issues. Each issue stands alone with its own classification and fix.

### Step 5: Apply the fixes

Make the changes. Commit them. If the fix is to forge itself (guidance, templates, review prompts), commit it in the forge repo. If the fix is to the project (guides, reference, tooling), commit it on the feature branch.

### Step 6: Fix the PR

After addressing the systemic fixes, also fix the actual PR issues that triggered the retro. These are separate commits — the retro fixes the system, the PR fix addresses the immediate code.

---

## Multiple rounds

Reviews and retros can repeat. A reviewer finds issues → retro runs → fixes are applied → PR is updated → reviewer looks again → more issues → another retro round.

Each round appends to the same `retro.md` under an incrementing heading. This creates a clear trail of what was caught and when.

The goal is convergence: each round should find fewer issues than the last. If a retro round produces zero issues, the system is working.

---

## Graduation

When the feature ships (`forge docs --ship`), the retro doc is reviewed alongside reflections:

- Fixes that were applied to forge itself have already taken effect — the retro entry serves as the historical record (similar to an ADR).
- Fixes that were applied to project guides/reference are already in `docs/` — no graduation needed.
- The retro doc archives with the plan to `plans/_archive/<feature>/retro.md`.

---

## The standard to hold

The bar is zero issues at human review. Not "few issues." Not "only minor issues." Zero.

Every escape is a system defect. The retro exists to close the gap between the current system and that standard. If the system is working, `forge retro` never needs to run.
