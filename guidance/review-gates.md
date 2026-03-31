# Forge: Review Gates

Every artifact must pass review before the pipeline advances. Reviews are run in a **fresh context window** with the smartest available model and full tool access. Each review is independent — no carryover from the authoring session.

## The protocol

### Self-review (before external review)

The authoring agent runs this checklist itself — not a subagent dispatch:

1. **Source coverage** — skim each requirement in the source material. Can you point to a section/task that addresses it? List any gaps.
2. **Placeholder scan** — search the artifact for red flags from the placeholder list below. Fix them inline.
3. **Name consistency** — do types, method signatures, field names, and file paths used in later sections match what was defined in earlier sections? A function called `clearLayers()` in Phase 1 but `clearFullLayers()` in Phase 3 is a bug.

Fix issues inline. If you find a requirement with no coverage, add it. Then proceed to external review.

### External review

```
pass = 0
repeat:
  spawn a review agent (fresh context, full tools)
  reviewer classifies each issue: critical / major / minor
  if no critical and no major:
    advance to next stage
  else:
    fix the issues
    pass += 1
    review again
```

Minor issues may be noted inline but do not block advancement. Critical and major issues must be resolved.

## Severity definitions

| Severity | Definition | Examples |
|----------|-----------|----------|
| **Critical** | The artifact is structurally wrong — advancing will waste implementation effort or produce the wrong thing | PRD: contradictory requirements, undefined core behavior. Plan: phase depends on work not in any phase, wrong sequencing. Task: acceptance criteria test something different from what the design describes. |
| **Major** | A gap or ambiguity that will force the implementing agent to guess, and a wrong guess is expensive | PRD: edge case mentioned but not resolved, decision left open. Plan: phase has no acceptance criteria, vertical slice is actually horizontal. Task: design references an interface that doesn't exist, missing dependency. |
| **Minor** | A quality issue that won't derail implementation but should be fixed | Unclear wording, redundant user story, inconsistent naming, missing "out of scope" entry for an obvious non-goal. |

## What the review agent receives

The review agent always gets:

1. **The artifact** being reviewed (PRD, plan, or task definitions)
2. **The source material** it was derived from (brainstorm → PRD, PRD → plan, plan → tasks)
3. **Codebase access** — full tool access to read files, grep, explore

## Placeholder scan (all artifacts)

Every review pass checks for placeholder content. These are **always major or critical** — they force the implementing agent to guess:

- "TBD", "TODO", "to be decided", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases" — without specifying which errors, what validation, or what edge cases
- "Write tests for the above" — without actual test criteria or cases
- "Similar to Task N" — repeat the content; the implementer may read tasks out of order
- Steps that describe what to do without showing how — code/command steps need code/commands
- References to types, functions, or interfaces not defined in any task or existing code

## Stage-specific review criteria

### PRD review

Source: brainstorm (if exists) + user interview

```
You are reviewing a PRD for completeness and coherence. You have full
codebase access. Do not rewrite — only identify issues.

## Artifact
<contents of plans/<feature>/prd.md>

## Source material
<contents of plans/<feature>/brainstorm.md, if exists>

## Check each item. Classify every issue as critical, major, or minor.

### Placeholder scan
- No TBD, TODO, "to be decided", "implement later", or vague directives
- No "add appropriate error handling" without specifying which errors and how
- No references to types/functions not defined in any task or existing code

### Completeness
- Every user story covers both happy path and error/edge cases
- Implementation decisions resolve all design branches
- Out of scope is explicit — no obvious adjacent features left unaddressed
- Testing decisions specify what to test and how, not just "write tests"

### Coherence
- User stories are consistent with each other — no contradictions
- Implementation decisions follow from the problem statement — no unmotivated choices
- Module sketch matches the scope of the user stories — nothing missing, nothing extra

### Codebase alignment
- Read the files/modules referenced or implied by the PRD
- Implementation decisions are compatible with existing patterns and architecture
- No assumptions that contradict the current codebase state

### Value
- Problem statement answers "why this, why now"
- Scope is the minimum that solves the stated problem — flag gold-plating

## Output format
For each issue, one line:
  <severity>: <specific description>
  e.g., "major: user story 3 says 'handle auth errors' but implementation
         decisions don't specify which auth errors or how to handle them"

End with a summary line: PASS (no critical/major) or FAIL (list counts).
```

### Plan review

Source: PRD

```
You are reviewing an implementation plan against its PRD. You have full
codebase access. Do not rewrite — only identify issues.

## Artifact
<contents of plans/<feature>/plan.md>

## Source material
<contents of plans/<feature>/prd.md>

## Check each item. Classify every issue as critical, major, or minor.

### Placeholder scan
- No TBD, TODO, vague directives, or "similar to Phase N"
- Acceptance criteria are specific and testable — not "works correctly"

### Coverage
- Every PRD user story appears in at least one phase
- No phase includes work not traceable to the PRD
- Out-of-scope items from the PRD are not smuggled into any phase

### Vertical slicing
- Each phase touches all necessary layers (schema → API → UI → tests)
- Each phase is demoable or verifiable on its own
- No phase is purely infrastructure with no user-visible behavior
- Phase 1 is the thinnest possible end-to-end slice

### Sequencing
- No phase depends on work defined in a later phase
- Durable architectural decisions (schema, routes, models) are in Phase 1
- Each phase is a viable stopping point

### Codebase alignment
- Read the existing code for areas the plan touches
- Plan's assumptions about current architecture are correct
- Proposed changes are compatible with existing patterns

### Acceptance criteria
- Every phase has concrete, testable acceptance criteria
- Criteria are specific enough that an agent can write tests from them
- No criteria that require subjective judgment ("works well", "is fast")

## Output format
Same as PRD review: <severity>: <description>, end with PASS or FAIL.
```

### Tasks review

Source: plan

```
You are reviewing task definitions against their source plan.
You have full codebase access. Do not rewrite — only identify issues.

## Artifact
<forge tasks list --parent <epic-id> output, including description, design,
 acceptance_criteria, and notes for each task>

## Source material
<contents of plans/<feature>/plan.md — the relevant phase>

## Check each item. Classify every issue as critical, major, or minor.

### Placeholder scan
- No TBD, TODO, vague directives, or "similar to Task N"
- Design fields show actual types/interfaces/code, not descriptions of what to write
- No references to types or functions not defined in any task or existing code

### Coverage
- Every acceptance criterion from the plan phase maps to at least one task
- No task includes work not in the plan phase
- All tasks together fully cover the phase — no gaps

### Task quality
- Each task has a clear WHAT (description), HOW (design), and DONE (acceptance criteria)
- Acceptance criteria are testable — an agent can translate each into an assertion
- Design field specifies interfaces, types, and file paths — not vague direction
- Notes field lists specific files to create or modify

### Dependencies
- Dependency graph matches the implementation order implied by the plan
- No circular dependencies
- No task imports from or calls interfaces defined in a task it doesn't depend on
- Run `forge tasks validate <epic-id>` — DAG must be valid

### Cross-boundary contracts
- Tasks that share interfaces (API routes, data models, function signatures) use
  identical names in their design fields
- No name drift between producer and consumer tasks

### Complexity
- No task scores above 6 without being decomposed into sub-tasks
- Each sub-task is independently testable and mergeable

### Collapse check
- Tasks sharing a breaking type/interface change (rename, signature change, schema migration) with combined complexity ≤15 and ≤10 files should be a single task, not a multi-task DAG
- No task DAG where merging any single task would break existing functionality due to a shared rename or interface change — this violates the additive-merge principle and causes worktree agent scope-creep

## Output format
Same as PRD review: <severity>: <description>, end with PASS or FAIL.
```

## When to stop reviewing

There is no fixed pass count. A review is **done** when the latest pass surfaces no critical or major issues. That might be the first pass or the fifth — it depends on the artifact's complexity and how clean it comes out of authoring.

Use judgment: a small, well-scoped feature may pass on the first review. A complex plan touching many modules may need several rounds. The signal is always the same — a clean pass means advance.

## Why fresh context windows?

The authoring agent has spent its context building the artifact. It has normalized its own assumptions and can no longer see its blind spots. A fresh context window with no carryover from the authoring session is the cheapest way to get independent judgment.

Each review pass should be a separate agent invocation — not a follow-up message in the same conversation. Review passes run **sequentially**, not in parallel — each pass must complete and any fixes must land before the next pass begins.
