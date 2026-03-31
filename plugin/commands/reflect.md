---
description: Capture learnings from implementation — what surprised, what worked, what to reuse
argument-hint: <feature-name>
---

Run `forge reflect $ARGUMENTS` to check the feature state.

Then review the implementation work and write reflections.

## Process

### Step 1: Gather context

```bash
# Check what's been done
forge reflect <feature>

# Read tasks for this feature (filter closed tasks from output)
forge tasks list <feature> --json

# Read existing reflections (if any)
cat plans/<feature>/reflections.md
```

Read the git log for the feature branch to see what was built and how.

### Step 2: Ask the four questions

For each completed phase (or for the feature as a whole if reflecting at the end), review the closed tasks and ask:

1. **Platform gotchas** — did anything behave unexpectedly? Runtime quirks, API surprises, tooling friction?
2. **Debugging discoveries** — what was hard to diagnose? What would have saved time?
3. **Validated patterns** — what approach worked well and should be reused?
4. **Process improvements** — what would you do differently next time?

If the user is present, interview them — they may have context the agent doesn't.

### Step 3: Write reflections

Append to `plans/<feature>/reflections.md`. If the file doesn't exist, create it:

```markdown
# Reflections: <feature>

Append-only log of learnings discovered during implementation.

## Phase <N>: <phase name>
- <learning>
- <learning>
```

If a phase was straightforward and produced no surprises, a single line is fine:

```markdown
## Phase 1: core data model
- Clean phase, no surprises.
```

The point is to force the pause and look back — not to generate volume.

### Step 4: Check for graduation candidates

Review each reflection entry. If it meets graduation criteria, flag it for `forge docs --ship`:

- Describes a validated, reusable pattern
- Future work in this project would benefit from finding it
- Describes a durable constraint (not a one-off workaround)

Mark graduation candidates inline:

```markdown
- [graduate] Structured logging with correlation IDs cut debugging time in half — write a guide
- Bun's test runner doesn't support --bail yet — one-off workaround, no graduation needed
```

## Deep Reference

See the Reflections section in [philosophy.md](../../guidance/philosophy.md) for graduation criteria and scoping rationale.
