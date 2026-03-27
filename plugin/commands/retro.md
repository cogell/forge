---
description: Root cause analysis when a reviewer finds issues on a "ready" PR
argument-hint: <feature-name>
---

Run `forge retro $ARGUMENTS` to check the feature state.

**When to use:** A reviewer (human or agent) found issues on a PR that was supposed to be ready. The review loop, salvage agents, and quality gates all missed it. This command triggers root cause analysis and system fixes.

## Process

### 1. Gather evidence

```bash
# Pull PR comments (if a PR exists)
gh pr list --head feat/<feature> --json number,url --jq '.[0]'
gh pr view <number> --comments --json comments,reviews
```

Ask the reviewer: "Is there anything else not captured in the PR comments?"

Read the existing retro doc if one exists: `plans/<feature>/retro.md`

### 2. Classify each issue into a root cause

| Category | The pipeline failed because... |
|----------|-------------------------------|
| **Review criteria gap** | Review agent prompt didn't check for this class of issue |
| **Task spec gap** | Task description or acceptance criteria were ambiguous/incomplete |
| **Project guidance gap** | Agent lacked domain knowledge that should be in `docs/guides/` or `docs/reference/` |
| **Tooling gap** | No linter rule, type constraint, or automated check covers this |
| **Forge workflow gap** | The pipeline structure (TDD protocol, review loop, task decomposition) has a blind spot |

### 3. For each issue, produce a concrete fix

Not a note. A diff. Change the file that would have prevented this:

- Review agent prompt → `guidance/run-process.md` (Review Agent section)
- Task agent instructions → `guidance/run-process.md` (Task Agent section)
- Project knowledge → `docs/guides/` or `docs/reference/`
- Automated checks → linter config, CI pipeline, pre-review checks
- Forge process → `guidance/*.md` or `plugin/commands/*.md`

### 4. Write the retro doc

Append to `plans/<feature>/retro.md`:

```markdown
# Retro: <feature>

Issues found during review that should have been caught upstream.

---

## Round <N> — <date>

### Issue: <short description>
**Category:** <category>
**Found by:** <human | agent>
**What happened:** <what was wrong>
**Why it escaped:** <why the pipeline missed it>
**Fix:** <what was changed, with file path>
```

Multiple rounds append — don't overwrite previous entries. Each round should find fewer issues than the last.

### 5. Apply fixes, then fix the PR

Commit system fixes (guidance, tooling, docs) separately from PR fixes (the actual code changes). The retro fixes the system; the PR fix addresses the immediate issue.

## The standard

Zero issues at human review. Every escape is a system defect. See [retro-process.md](../../guidance/retro-process.md) for the full protocol.
