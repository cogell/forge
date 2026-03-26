# Forge: Documentation Lifecycle

Initialize, review, prune, and graduate documentation using the three-layer model.

## Init (`/forge:init`)

Set up `plans/` and `docs/` in a new or existing codebase.

### Step 1: Audit what exists

```
[ ] Check for existing docs/, plans/, specs/, wiki/, documentation/ directories
[ ] Check README.md length (>200 lines = content should move to docs/)
[ ] Check for ADRs, RFCs, or decision records anywhere
[ ] Check for PRDs, specs, or planning docs anywhere
[ ] List all .md files in repo root and top-level directories
```

### Step 2: Propose structure

Present one of these and confirm with the user before creating anything:

**Minimum (small projects):**
```
plans/_template/        # PRD + plan templates
plans/_archive/         # Completed plans (historical record)
docs/decisions/         # ADR template
```

**Standard (most projects):**
```
plans/_template/
plans/_archive/
docs/
├── getting-started.md
├── architecture.md
├── decisions/
├── guides/
└── reference/
```

**Full (large projects):** add `docs/explanation/`, `docs/runbooks/`, `docs/assets/`.

### Step 3: Create structure

Create directories and write templates.

### Step 4: Migrate misplaced content

| Found in | Move to |
|----------|---------|
| `wiki/`, `documentation/`, `doc/` | `docs/` |
| `specs/` | `plans/` |
| `adr/`, `adrs/` | `docs/decisions/` |
| Root-level design docs | `plans/<feature>/` or `docs/explanation/` |
| PRDs in `docs/` | `plans/<feature>/` |
| Long README sections | Extract to `docs/`, replace with links |

---

## Health Check (`/forge:docs` with no flags)

Read-only scan. Reports findings without making changes.

### Checklist

```
STRUCTURE
[ ] docs/ exists with decisions/ subdirectory
[ ] plans/ exists with _template/
[ ] README.md under 200 lines, links to docs/

STALENESS
[ ] No docs reference removed tools, versions, or APIs
[ ] docs/architecture.md reflects current system
[ ] No plans/ with status: active that are actually completed
[ ] No completed plans still in plans/ (should be in plans/_archive/)

ORPHANS
[ ] Every file in docs/ reachable from README or table of contents
[ ] No misplaced markdown files at repo root
[ ] No empty directories

REFLECTIONS
[ ] Active plans with closed beads have a reflections.md
[ ] No reflections.md in archived plans without graduation annotations
[ ] No global agents/reflections.md — reflections scoped to plans/<feature>/

COMPLETENESS
[ ] Recent shipped features have ADRs (if architecturally significant)
[ ] docs/guides/ covers workflows engineers actually perform
[ ] Active plans have both prd.md and plan.md

DIATAXIS
[ ] docs/guides/ — task-oriented (how-to), not mixed with explanation
[ ] docs/reference/ — factual lookups, not tutorials
[ ] docs/explanation/ — conceptual, not step-by-step
```

---

## Phase Complete (`/forge:docs --phase <feature>`)

Run when a beads phase finishes. Lightweight pass.

1. Identify what shipped — check recently closed beads
2. Decision-worthy? → ADR in `docs/decisions/`
3. Guide-worthy? → guide in `docs/guides/`
4. Reference changed? → update `docs/reference/`
5. Architecture changed? → update `docs/architecture.md`
6. Graduate reflections from `plans/<feature>/reflections.md`

---

## Full Ship (`/forge:docs --ship <feature>`)

Run when an entire PRD/plan is complete. Full graduation ceremony.

1. Mark plan completed — `status: completed`, add `completed: <date>`
2. Walk every phase — run phase-complete checklist for each
3. Graduate ALL reflections — every entry must be graduated or marked kept
4. Capstone ADR for significant features
5. Prune existing docs against new reality
6. Dead doc sweep
7. Archive: `mv plans/<feature> plans/_archive/<feature>`
8. Verify completeness
9. Report summary
