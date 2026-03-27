# Forge: Canonical Templates

Single source of truth for all document templates.

---

## Brainstorm Template

File: `plans/<feature>/brainstorm.md`

```markdown
---
feature: <feature-name>
created: <YYYY-MM-DD>
status: draft
---

# Brainstorm: <Feature Name>

## Problem Space

## Current State

## Ideas

## Actors / Users

## Constraints

## Open Questions

## Codebase Notes
```

---

## PRD Template

File: `plans/<feature>/prd.md`

```markdown
---
status: active
feature: <feature-name>
created: <YYYY-MM-DD>
completed: null
---

# PRD: <Feature Name>

## Problem Statement

## Solution

## User Stories

1. As a [actor], I want [feature], so that [benefit]

## Implementation Decisions

## Testing Decisions

## Out of Scope

## Further Notes
```

---

## Implementation Plan Template

File: `plans/<feature>/plan.md`

```markdown
---
status: active
feature: <feature-name>
created: <YYYY-MM-DD>
completed: null
execution: phase-prs | single-pr
---

# Plan: <Feature Name>

> Source PRD: plans/<feature-name>/prd.md

## Architectural Decisions

---

## Phase 1: <Title>

**User stories**:

### What to build

### Acceptance criteria

- [ ]
```

---

## ADR Template

File: `docs/decisions/NNN-<title>.md`

```markdown
# ADR-NNN: <Title>

## Status

Proposed | Accepted | Superseded by ADR-NNN

## Context

## Decision

## Consequences

-
```

Rules: numbered sequentially, never deleted (only superseded), one decision per record.
