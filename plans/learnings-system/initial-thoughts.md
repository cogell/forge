# Learnings System — Initial Thoughts

Captured from brainstorm conversation on 2026-03-27.

## The Problem

Forge's pipeline captures learnings (reflections) during implementation, but they effectively die after graduation. Future agents repeat mistakes that were already documented. There's no mechanism for a future agent working on a different feature to discover relevant learnings from past reflections at the moment they matter.

Two failure modes:
1. **Learning never surfaces** — it sits in `plans/_archive/` or a generic `docs/guides/` page, and the agent working on a related problem never encounters it
2. **Learning surfaces at the wrong time** — dumping everything into CLAUDE.md means every agent reads every learning, wasting context on irrelevant stuff

## Trigger Surfaces

Where an agent naturally looks during work — these are the only viable places to surface learnings:

| Surface | When agent looks | Scope |
|---------|-----------------|-------|
| CLAUDE.md | Always (auto-loaded) | Universal rules |
| `docs/` files | When researching "how does X work here" | Domain/topic |
| Code comments | When reading/modifying code | Exact location |
| Beads task description | When picking up a task | Task-specific |
| Plan files | When starting a new feature in the same area | Feature-scoped |

## Approaches (Blended)

### A. Domain-keyed learning files

Instead of graduating reflections into generic guides, organize by trigger domain:

```
docs/learnings/
  cloudflare-d1.md
  auth-middleware.md
  bun-test-runner.md
```

Each file has frontmatter with metadata:

```yaml
---
domain: cloudflare-d1
severity: gotcha
source: user-onboarding
verified: 2026-03-27
---
D1 batch inserts silently truncate at 1000 rows. Always chunk.
```

Free-form domain tags. Single `verified` date that gets bumped when someone confirms the learning is still true.

### B. Code breadcrumbs

When a learning relates to a specific code area, leave a one-line pointer:

```typescript
// LEARNING: D1 batch inserts silently truncate at 1000 rows
// See docs/learnings/cloudflare-d1.md#batch-limit
```

Agent touches the code, sees the breadcrumb, reads the full learning. Organic discovery.

Written at graduation time (by the `forge docs --ship` agent), not during implementation. One place to get it right, more systematic.

### C. Local FTS5 index (SQLite)

SQLite with FTS5 full-text search as the query layer. No embeddings, no vector DB, fully local.

```sql
CREATE VIRTUAL TABLE learnings USING fts5(
  text,
  domain,
  source_feature,
  source_phase,
  severity,
  created
);
```

- DB lives at `.forge/learnings.db`, `.gitignore`d
- Source of truth is the `docs/learnings/*.md` markdown files
- `forge learnings rebuild` regenerates the DB from source files
- Keeps PRs clean — no binary diffs in review

### D. Selective CLAUDE.md graduation

Reserve CLAUDE.md for only the highest-signal learnings — things that burned time or broke prod. Very choosy. Everything else stays in domain-scoped docs.

### E. Pipeline query integration

Two natural trigger points:

1. **`forge:tasks`** — when decomposing a plan into beads, query the index against each task description. Inject relevant learnings into task descriptions.
2. **`forge:run`** — at the start of each phase, query against the phase scope. Surface as a "before you start" context block.

Lightweight addition — a single query before work starts.

## Composed Graduation Flow

When a reflection gets graduated, each entry goes through triage:

```
reflection entry
  +-- universal gotcha (rare, ~5%)     -> CLAUDE.md (D)
  +-- domain pattern (most, ~70%)      -> docs/learnings/<domain>.md (A)
  +-- code-area-specific (~25%)        -> code breadcrumb (B)
  +-- ALL entries regardless            -> SQLite index (C)
```

The SQLite index is the catch-all. Even things in CLAUDE.md or breadcrumbs also get indexed.

```
plans/<feature>/reflections.md          # raw capture (exists today)
        |
        v  graduation triage
        |
   +----+---------------------+
   v    v                     v
CLAUDE.md  docs/learnings/*.md   code breadcrumbs
(rare)     (source of truth)     (pointers only)
              |
              v  forge learnings rebuild
        .forge/learnings.db
        (derived, .gitignored)
              |
              v  queried by
     forge:tasks  /  forge:run
     (inject into task descriptions / phase context)
```

## Value Ordering

1. **Domain-keyed learning files + FTS5 index** (A + C) — core. Without queryable storage, nothing else matters.
2. **Pipeline query integration** (E) — makes the system self-triggering.
3. **Code breadcrumbs** (B) — nice but lower leverage.
4. **CLAUDE.md graduation** (D) — almost zero effort, just a guidance update.

## Open Questions (for PRD)

1. **Who writes the domain-keyed files?** The graduating agent during `forge docs --ship`. But who decides the domain tag — the reflecting agent at capture time (annotation on the bullet) or the graduating agent infers it?

2. **Rebuild trigger** — should `forge learnings rebuild` run automatically as part of `forge:run` setup (Phase 0)?

3. **Query UX in task injection** — when `forge:tasks` finds relevant learnings, where do they go? Into `--notes`? A new `--learnings` field? Or printed for the decomposing agent to incorporate manually?

4. **Scope of the index** — just `docs/learnings/*.md`? Or also index un-graduated reflections from `plans/_archive/*/reflections.md`?
