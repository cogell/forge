# PRD: Admin Agent Pipeline

> A web-based control surface that lets non-technical project owners request website changes via a conversational agent, which kicks off a fully automated coding pipeline that opens a PR and merges + deploys it automatically if AI review confidence is high.

---

## Problem

Non-technical owners of a web app want to request changes to their site without needing to write tickets, explain themselves to an engineer, or wait in a queue. Engineers are a bottleneck for changes that are well-understood and low-risk.

At the same time, a fully autonomous "just do it" pipeline without any oversight is risky — low-confidence changes should still get an engineer in the loop before merge.

The gap: there's no system that (1) understands the codebase well enough to evaluate requests, (2) interviews the owner to clarify intent, (3) executes the change, and (4) routes to human review only when necessary.

---

## Concrete Use Case

**Project:** `regen-house` — a Cloudflare Workers + React web app for managing multi-event operations.

**User:** An admin (event organizer, non-technical owner) logged into the regen-house web app.

**Flow:**
1. Admin navigates to `/admin/agent`
2. Opens a chat interface and describes a change they want ("add a FAQ section to the sponsor detail page")
3. An interview agent — aware of the codebase — asks clarifying questions, confirms scope, flags if the request is too complex
4. If complexity is acceptable, the pipeline kicks off automatically in the background
5. A coding agent implements the change in an isolated environment, opens a PR
6. A review agent scores the PR diff for confidence
7. If high confidence → auto-merge + deploy; if low confidence → engineer is flagged to review before merge

---

## Architecture

### Overview

```
Admin browser
  ↕ WebSocket
Durable Object (interview session)
  ↕ E2B SDK
E2B sandbox (interview agent)
  — codebase cloned, Claude Agent SDK, Read/Glob/Grep tools
  — when interview complete: fires Inngest event

Inngest cloud (coding pipeline)
  ↕ E2B SDK (per step)
E2B sandbox (coding agent, per step)
  — codebase cloned, Claude Agent SDK, full tool access
  — agent writes code, runs tests, commits

GitHub API
  — open PR
  — merge PR (on approval)

Cloudflare deploy (on merge to main via existing GitHub Actions)
```

---

### Component 1: Interview Agent

**Purpose:** Understand what the owner wants. Use codebase knowledge to evaluate feasibility and complexity. Produce a structured spec for the coding pipeline.

**Runtime:** E2B sandbox + Claude Agent SDK

**Why E2B:** The agent needs live access to the codebase — docs, plans, source files — to give grounded answers ("that component already exists", "here's how the current FAQ section works"). Context-loading at session start is an alternative for small codebases but doesn't scale and can't discover things dynamically mid-conversation.

**Session lifecycle:**
- Session created when admin opens `/admin/agent`
- Codebase cloned into sandbox at session start
- Sandbox persists for the duration of the interview (terminated on spec completion or abandonment)

**Streaming to browser:**
- Durable Object bridges browser WebSocket ↔ E2B sandbox
- DO hibernates between turns (zero compute cost while user is thinking)
- Each turn: user message → DO wakes → agent runs in E2B → tokens stream back → DO hibernates

**Interview outputs:**
```typescript
type InterviewSpec = {
  request: string           // plain-language summary of what was asked
  clarifications: string[]  // key decisions made during interview
  relevant_files: string[]  // files the agent identified as in-scope
  complexity: "low" | "medium" | "high"
  confidence: number        // 0–1, agent's confidence it understood the request
  proceed: boolean          // false if complexity too high or request unclear
  rejection_reason?: string // if proceed: false
}
```

**If `proceed: false`:** agent explains why to the owner, suggests how to break it down or bring in an engineer. No pipeline kicked off.

**If `proceed: true`:** DO fires `inngest.send({ name: "pipeline/run", data: spec })` and terminates the sandbox.

---

### Component 2: Coding Pipeline

**Purpose:** Implement the change, open a PR, review it, merge or flag for human review.

**Runtime:** Inngest (orchestration) + E2B per step (execution)

**Why per-step sandboxes:** Cleaner replay safety, natural parallelism, no stale state between steps. Each step: create sandbox → clone repo → apply prior diffs → do work → collect diff → kill sandbox.

**Why `step.waitForEvent` not fire-and-poll:** Each step that kicks off long-running E2B work returns immediately after starting the sandbox process. The E2B sandbox calls a webhook on completion. Inngest resumes the function via the webhook event. No CF Worker request stays open longer than ~5 seconds.

**Pipeline steps:**

```
1. implement
   → E2B sandbox, coding agent with full tool access
   → implements spec against codebase
   → runs tests if applicable
   → commits, pushes branch
   → returns { branchName, commitSha, diff }

2. open-pr
   → GitHub API: create PR with spec summary as description
   → returns { prNumber, prUrl }

3. review
   → E2B sandbox, review agent
   → reads diff, checks against spec, evaluates test coverage, checks for regressions
   → returns { confidence: number, concerns: string[], recommendation: "merge" | "flag" }

4a. auto-merge (if confidence >= threshold)
    → GitHub API: approve + merge PR
    → existing GitHub Actions deploys on merge to main
    → notify admin: "your change is live"

4b. flag-for-engineer (if confidence < threshold)
    → GitHub PR: add review request to engineer
    → notify engineer (Slack / GitHub notification / email — TBD)
    → pipeline pauses: step.waitForEvent("pipeline/engineer-reviewed", timeout: "7d")
    → on approval: merge + deploy
    → on rejection: notify admin with engineer's feedback
```

**Confidence threshold:** Configurable. Default `0.85`. Below this, an engineer reviews before merge.

---

### Component 3: Admin UI

**Location:** `/admin/agent` — gated by existing `requireRole("admin")` auth

**Views:**

| View | Purpose |
|---|---|
| Chat interface | Real-time interview with streaming responses |
| Run history | List of past pipeline runs with status |
| Review queue | Runs waiting for engineer review (low-confidence PRs) |
| Run detail | Step-by-step status, diff, agent reasoning, PR link |

**Notifications:** When a run completes (auto-merged or flagged), the admin gets an in-app notification or email.

---

### Component 4: Cloudflare Worker Topology

Two separate CF Workers — not one. The pipeline worker is independent so it can be deployed, rolled back, and iterated on without touching the main app.

```
regen-house Worker (existing)
  — all existing routes
  — /admin/agent (new page, static React)
  — /api/chat/* (interview agent API — DO + WebSocket)

pipeline Worker (new)
  — POST /api/inngest        (Inngest function handler)
  — POST /api/webhooks/e2b   (E2B completion callbacks)
  — GET  /api/runs           (run status, polled by UI)
  — POST /api/runs/:id/review (engineer review submission)
```

The regen-house Worker reads run state from the pipeline Worker API. The two Workers share nothing — no KV namespace, no DO. Decoupled by design.

---

## User Flow (End to End)

```
Admin logs in → navigates to /admin/agent
  → Durable Object created, E2B sandbox started, codebase cloned

Admin: "I want to add a testimonials section to the home page"
  → agent reads home page component, checks docs, asks 2-3 clarifying questions
  → "Should testimonials be static text you manage in code, or pulled from a spreadsheet like vendor data?"
  → admin answers, agent confirms spec, marks complexity: low

Admin: "Looks good, let's do it"
  → agent fires inngest event
  → UI transitions: "Your request is being implemented..."

  [pipeline runs in background — 5–15 minutes]

Admin (or engineer) gets notified:
  → high confidence: "Your change is live at regen.house"
  → low confidence:  "An engineer is reviewing before we merge"
```

---

## Out of Scope (for now)

- Multi-project support — this PRD targets regen-house specifically; see open questions below
- Rollback UI — revert a merged change via the admin panel
- Scheduled changes — "make this change go live on Friday"
- Non-code changes — CMS-style content edits that bypass the pipeline entirely
- Streaming pipeline logs to the UI — run detail shows step status, not live token output

---

## Open Questions

### 1. Where does this live relative to regen-house?

Three possible shapes:

**A. Everything inside regen-house**
- Pipeline Worker lives in the regen-house repo as a second Worker
- Simplest for a single project
- Doesn't generalize — next project needs to copy/fork

**B. Forge as a standalone multi-project pipeline service**
- A separate `forge` Worker (or Fly.io / Railway app) that accepts pipeline requests from any project
- regen-house admin UI talks to the forge service
- Projects register themselves: `{ repoUrl, deployBranch, codebaseContext }`
- Forge handles all Inngest + E2B logic centrally
- Cleanest long-term, but more infrastructure to stand up

**C. Forge as an npm package / library**
- Pipeline logic is a library consumed by each project's Worker
- Each project runs its own Inngest endpoint
- No central service; each project owns its own pipeline Worker
- Good balance: reusable code, decentralized operation

**Leaning toward B or C** — A is a dead end as soon as a second project wants this. The shape of B vs C depends on whether a shared Inngest account + centralized run history is valuable.

### 2. Where does the interview agent's codebase clone come from?

Options: GitHub API (read files on demand, no full clone), git clone via E2B commands (full clone, heavier startup), or pre-snapshot the docs/plans at session start (cheapest, loses live file access). For regen-house the codebase is small — any option works. For larger codebases, on-demand GitHub API reads may be preferable to a full clone.

### 3. Engineer notification surface

When a PR is flagged for human review, how is the engineer notified? GitHub review request is the zero-infrastructure default (engineer sees it in their normal PR workflow). Slack DM or email requires additional config. GitHub is the right default — defer the rest.

### 4. Confidence threshold and calibration

`0.85` is a placeholder. The right number depends on empirical data from running the review agent against real PRs. Consider making it configurable per project and logging every review decision so the threshold can be tuned over time.

### 5. Interview agent model choice

The interview agent needs codebase comprehension + good conversation skills. `claude-sonnet-4-6` is the default. The coding agent likely wants `claude-sonnet-4-6` for speed. The review agent might warrant `claude-opus-4-6` for higher accuracy on the confidence score — but this is a cost vs. accuracy tradeoff to calibrate.

### 6. What happens when the pipeline fails mid-run?

Inngest retries failed steps automatically. But if a coding agent produces broken code (tests fail), the pipeline needs a recovery path: retry with a fresh agent and the failure context, or surface the failure to the admin. This is not designed yet.

### 7. Is the Durable Object + E2B interview complexity worth it for a small codebase?

For regen-house specifically, loading all docs and key source files into a system prompt at session start might be sufficient — the codebase is small and stable. The DO + E2B approach is the right long-term pattern but adds setup cost. Could start with context-loading and upgrade to live file access when it demonstrably falls short.
