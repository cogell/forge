# Research: Agent Orchestration with Docker + E2B + Inngest

> Synthesized from analysis of mngr, tracker, the-software-garden, forge, and the broader durable execution + agent sandbox landscape.

---

## The Problem

Running multi-step AI agent pipelines reliably requires solving three independent concerns:

1. **Orchestration** — sequencing steps, handling failure, checkpointing, resuming
2. **Execution** — a capable agent (LLM + tools) that can write code, run tests, browse the web
3. **Environment** — an isolated runtime with headless Chrome, file system, bash, and any other tools the agent needs

Every system in the space conflates these. The right architecture separates them cleanly.

---

## Systems Analyzed

### mngr (imbue-ai/mngr)
- CLI for managing agent lifecycles over SSH (local, Docker, Modal)
- "git for agents" — create/stop/clone/message persistent tmux sessions
- **Strength:** infrastructure abstraction, remote compute (Modal), agent persistence
- **Gap:** no orchestration; you write the sequencing logic yourself

### tracker (2389-research/tracker)
- Graph-based pipeline execution engine; pipelines defined in `.dip` (Dippin language) files
- Built-in: parallel fan-out, human gates (4 modes + autopilot), checkpoints, TUI
- Has a **Claude Code subprocess backend** — spawns `claude` CLI, no API key needed
- **Strength:** production-grade pipeline engine; most complete feature set
- **Gap:** local only; another DSL to learn

### the-software-garden
- Agent orchestration runtime for coding agents specifically
- Graphviz DOT workflow files + tmux sessions + web dashboard (Greenhouse)
- SQLite task graph, Claude Code hook integration, live terminal streaming
- **Strength:** visual DAG + interactive terminal + real-time dashboard; your own project
- **Gap:** local only; no durable execution; file mutations not tracked across replays

### forge
- Feature pipeline skill system (PRD → plan → tasks → code → docs)
- Orchestration lives inside the agent's context (skill prompts carry the protocol)
- **Strength:** full pipeline spec with quality gates, task decomposition, doc graduation
- **Gap:** context blowouts kill the pipeline; no parallelism; manual checkpointing (in progress via `agent-orchestrator` PRD)

---

## The 7 Core Primitives

Synthesized across all four systems. Each does one thing with a clean interface.

### Runner
One prompt in, one structured result out. Every system reinvents this.
```typescript
interface Runner {
  run(prompt: string, config?: RunConfig): Promise<RunResult>
}
```

### Workspace
Isolated file tree for one unit of work. Backed by git worktrees or Docker volumes.
```typescript
interface Workspace {
  create(base: string): Promise<WorkspaceHandle>
  collect(handle: WorkspaceHandle): Promise<Diff>
  destroy(handle: WorkspaceHandle): Promise<void>
}
```

### Queue
Dependency-ordered work list with `ready()` semantics. Forge has `tasks.json`; garden has SQLite. Same concept.
```typescript
interface Queue<T extends { id: string }> {
  add(item: T, deps?: string[]): string
  ready(): T[]
  claim(id: string): void
  complete(id: string, result?: unknown): void
  fail(id: string, reason?: string): void
}
```

### State
Checkpoint/resume for any multi-step process. Manual durable execution.
```typescript
interface State {
  read(runId: string): Promise<Record<string, StepState> | null>
  write(runId: string, step: string, state: StepState): Promise<void>
  clear(runId: string): Promise<void>
}
```

### Gate
A decision point that blocks progress until resolved. Implementations: HumanGate, ReviewGate (loops fresh-context runners up to N passes), AutopilotGate, AlwaysPassGate.
```typescript
interface Gate {
  ask(question: string, options?: GateOptions): Promise<GateResult>
}
```

### Pool
N runners in parallel, each with isolated workspace.
```typescript
interface Pool {
  run(tasks: PoolTask[], config?: PoolConfig): Promise<PoolResult[]>
}
```

### Bus
Typed event stream connecting everything. Observability layer.
```typescript
interface Bus {
  emit(event: Event): void
  on(pattern: string, handler: (e: Event) => void): Unsubscribe
  stream(): AsyncIterable<Event>
}
```

---

## Durable Execution

### What it is
The core promise: **your code runs as if it never crashes.** The runtime records each step's result. On restart, it replays history up to the crash point and continues. Your code never knows it restarted.

### Where it sits
```
┌─────────────────────────────────────────┐
│  Graph / Pipeline logic                  │
│  Runner · Queue · Gate · Pool · Bus      │
├─────────────────────────────────────────┤
│  State (manual checkpointing)            │  ← durable execution replaces this
├─────────────────────────────────────────┤
│  Durable Execution Runtime               │  ← Temporal, Inngest, Trigger.dev
│  (automatic replay, step persistence)    │
├─────────────────────────────────────────┤
│  Infrastructure (local, Docker, E2B)     │
└─────────────────────────────────────────┘
```

### The LLM problem
LLM calls are non-deterministic — replay breaks the determinism assumption. Fix: treat each LLM call as an **activity** whose result is recorded in execution history. On replay, the cached result is returned instead of re-calling the LLM.

### The file system catch
File mutations are side effects the runtime doesn't track. If an agent writes files then crashes and replays — the files from the first run are still there. Mitigation: use Workspace/worktrees as the isolation unit; collect diffs only after confirmed step completion.

---

## Orchestrator Comparison

| | Temporal | Trigger.dev | Inngest | CF Workflows |
|---|---|---|---|---|
| Durable execution | Yes (core) | Yes (core) | Yes (core) | Yes (core) |
| Self-hostable | Yes | Yes (OSS) | No | N/A (edge) |
| TypeScript DX | Good | Excellent | Excellent | Good |
| No execution timeout | No | Yes | No | No |
| E2B integration | Manual | Manual | First-party (AgentKit) | Not suitable |
| Browser/Chrome | Manual | Built-in Playwright ext | Manual | Not suitable |
| Claude Code subprocess | Manual | Manual | Manual | Not suitable |
| Free tier | Self-hosted | 5K runs/mo | 50K runs/mo | — |
| Local dev | Docker compose | `trigger.dev dev` CLI | `localhost:8288` | — |

**CF Workflows is not suitable** for this use case — V8 isolates have no native modules, no file system, no subprocess support.

---

## The Agent: @anthropic-ai/claude-agent-sdk

`@anthropic-ai/claude-agent-sdk` is the right execution primitive — not `@anthropic-ai/sdk` (bare API calls).

- Embeds the full Claude Code agentic loop as a managed subprocess
- Full tools: Read, Edit, Bash, Glob, etc.
- Loads CLAUDE.md, project skills, MCP servers
- **Uses OAuth token from `claude login`** — no API key needed (Max/Pro subscription compatible)
- Sessions persist to disk and can be resumed with a `session_id`

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk"

for await (const message of query({
  prompt: "Implement task FORGE-1.2: checkpoint module",
  options: {
    allowedTools: ["Read", "Edit", "Bash", "Glob"],
    permissionMode: "acceptEdits",
    maxTurns: 30,
    cwd: "/path/to/worktree",
    model: "claude-sonnet-4-6",
    settingSources: ["project"],
  }
})) {
  if (message.type === "result") return message.result
}
```

**No sandboxing in agent-kit:** agent-kit's tools run as plain async functions in the same Node.js process. E2B provides the isolation layer.

---

## Execution Environment: E2B

### What it is
- Firecracker microVMs (hardware-level isolation, same tech as AWS Lambda)
- Full Linux: file system, bash, Chrome (CDP on port 9222), install anything
- Boots in milliseconds; sessions persist up to 14 days
- Used by Manus for exactly this: multi-agent systems where executor agents browse, run terminal commands, manage files

### How to connect to Chrome
```typescript
const sandbox = await Sandbox.create("browser-chromium")
const cdpUrl = await sandbox.getChromeUrl()  // wss://...

const browser = await playwright.chromium.connectOverCDP(cdpUrl)
const page = await browser.newPage()
await page.goto("https://example.com")
const screenshot = await page.screenshot()
```

### Defining environments: e2b.Dockerfile

E2B templates are defined with a standard Dockerfile named `e2b.Dockerfile`:

```dockerfile
FROM e2bdev/code-interpreter:latest

# Install Chrome + Playwright deps
RUN apt-get install -y chromium

# Install Node tools
RUN npm install -g playwright

# Any other tools the agent needs
RUN pip install cowsay
```

Build and deploy:
```bash
npm install -g e2b
e2b template build --name my-agent-env   # → returns template ID
```

**Build System 2.0** (Oct 2025): code-defined templates, no separate Dockerfile file:
```typescript
const template = new Template()
  .fromImage("ubuntu:22.04")
  .run("apt-get install -y chromium nodejs")
```

### Constraints
- Debian-based images only (no Alpine)
- No multi-stage Dockerfiles
- Cloud-only (no local Firecracker equivalent)

---

## Docker Dev/Prod Parity

`e2b.Dockerfile` is a regular Dockerfile with a different name. The same file works for both:

```bash
# Local dev — standard Docker
docker build -f e2b.Dockerfile -t my-agent .
docker run --rm -it my-agent

# Cloud — E2B
e2b template build   # reads e2b.Dockerfile → microVM snapshot
```

Toggle in code:
```typescript
const sandbox = process.env.E2B_API_KEY
  ? await Sandbox.create("my-agent-template-id")   // E2B cloud
  : await LocalDocker.run("my-agent")              // local
```

Only gotchas that could create divergence: multi-stage builds (not supported in E2B), Alpine base (not supported), low-level kernel behavior (rare in practice).

---

## Recommended Stack

For the forge pipeline — code agents that write files, run tests, screenshot UIs, and iterate:

```
Inngest                     durable execution, 7-step pipeline, checkpointing
  + @anthropic-ai/claude-agent-sdk   full Claude Code instance per step (OAuth token)
  + E2B sandbox              isolated environment: Chrome, file system, bash per run
  + e2b.Dockerfile           defines the environment; reusable locally via Docker
```

### Why this combination

- **Inngest** has first-party E2B integration via AgentKit; dev server runs locally at `localhost:8288` with no infra
- **Claude Agent SDK** uses OAuth token (Max subscription, no per-token API cost); loads CLAUDE.md and project skills; full tool access
- **E2B** gives each pipeline run an isolated microVM with Chrome — parallel feature runs don't collide; screenshots and browser iteration work out of the box
- **Docker** provides local dev parity with the E2B environment via the same `e2b.Dockerfile`

### How a forge pipeline step looks

```typescript
inngest.createFunction(
  { id: "forge-run" },
  { event: "forge/run" },
  async ({ event, step }) => {
    const { feature, cwd } = event.data

    // Each step.run() is automatically checkpointed
    // Crash between steps = resume from last checkpoint

    const planResult = await step.run("plan", async () => {
      const sandbox = await Sandbox.create("forge-agent")
      try {
        for await (const msg of query({
          prompt: `Run /forge:plan ${feature}`,
          options: { cwd: sandbox.cwd, model: "claude-sonnet-4-6" }
        })) {
          if (msg.type === "result") return { sessionId: msg.session_id, result: msg.result }
        }
      } finally {
        await sandbox.kill()
      }
    })

    const reviewResult = await step.run("plan-review-gate", async () => {
      // Fresh agent, fresh sandbox, reads the plan artifact
      const sandbox = await Sandbox.create("forge-agent")
      try {
        for await (const msg of query({
          prompt: `Review the plan at plans/${feature}/plan.md against review-gates.md`,
          options: { cwd: sandbox.cwd, model: "claude-opus-4-6" }
        })) {
          if (msg.type === "result") return msg.result
        }
      } finally {
        await sandbox.kill()
      }
    })

    // ... tasks, execute, docs, pr steps
  }
)
```

---

## Human-in-the-Loop Surface

Inngest handles the *waiting* (via `step.waitForEvent()`) but provides no UI. A separate surface is needed to show artifacts for review, collect human decisions, and fire the unblocking event back to Inngest.

### The pattern

```
Pipeline step ──► step.waitForEvent("forge/review.completed") ──► pauses (costs nothing)
                                                                        │
Human surface ──► shows artifact (plan, diff, screenshot) ──────────────┤
                  collects decision + feedback                          │
                  calls inngest.send() ─────────────────────────────────► resumes
```

### Possible surfaces

| Surface | How it works | Best for |
|---|---|---|
| **Web dashboard** | Pending reviews list, approve/reject buttons | Primary UI for team use |
| **CLI** | `forge review list` / `forge review approve run-123` | Developer-local workflows |
| **Slack/Discord bot** | Posts artifact, collects reaction or thread reply | Async team review |
| **GitHub PR comment** | Webhook listens for magic keyword, fires event | Code review gates |
| **Email** | Approve/reject links | Lightweight notification-based flow |

### Minimal implementation

The core is a single API with two endpoints:

```typescript
// GET  /reviews      — list runs waiting for human input
// POST /reviews/:id  — send approval event to Inngest

app.get("/reviews", async (req, res) => {
  // Query Inngest for functions in "waiting" state
  // or maintain a local table of pending reviews
  res.json(pendingReviews)
})

app.post("/reviews/:runId", async (req, res) => {
  await inngest.send({
    name: "forge/review.completed",
    data: { runId: req.params.runId, ...req.body },
  })
  res.json({ ok: true })
})
```

Any UI (web, CLI, bot) is a thin layer on top of these two operations.

### Pipeline integration

```typescript
// Inside an Inngest function step
const planResult = await step.run("plan", async () => { /* ... */ })

// Gate: wait for human review (no compute cost while waiting)
const review = await step.waitForEvent("wait-for-plan-review", {
  event: "forge/review.completed",
  match: "data.runId",
  timeout: "7d",
})

if (review.data.approved) {
  await step.run("execute-tasks", async () => { /* ... */ })
} else {
  // Re-run planning with feedback incorporated
  await step.run("revise-plan", async () => {
    const feedback = review.data.feedback
    // ... fresh agent with feedback context
  })
}
```

### Relationship to the Gate primitive

The Gate interface (see Core Primitives above) abstracts over this. `HumanGate` maps to `waitForEvent` + a human surface; `ReviewGate` maps to a fresh-context agent loop; `AutopilotGate` skips the wait entirely. The pipeline doesn't know which gate type is active — swap between them without changing orchestration logic.

---

## Workspace Isolation: Per-Step vs Per-Run Sandboxes

### Per-step sandbox

Each step creates and destroys its own sandbox. Artifacts pass between steps as **data** (diffs, file contents) through Inngest's step return values.

```typescript
const planDiff = await step.run("plan", async () => {
  const sandbox = await Sandbox.create("forge-agent")
  await sandbox.commands.run(`git clone ${repoUrl} /workspace`)

  // agent works...

  const diff = await sandbox.commands.run("git diff", { cwd: "/workspace" })
  await sandbox.kill()
  return diff.stdout  // serialized into Inngest's step history
})

const implDiff = await step.run("implement", async () => {
  const sandbox = await Sandbox.create("forge-agent")
  await sandbox.commands.run(`git clone ${repoUrl} /workspace`)

  // apply prior step's output so this agent sees it
  await sandbox.files.write("/tmp/plan.patch", planDiff)
  await sandbox.commands.run("git apply /tmp/plan.patch", { cwd: "/workspace" })

  // agent works on top of plan's changes...

  const diff = await sandbox.commands.run("git diff", { cwd: "/workspace" })
  await sandbox.kill()
  return diff.stdout
})
```

**Workspace = create sandbox, clone, apply prior diffs, collect diff, kill.** Every step is self-contained. On replay, Inngest returns the cached `planDiff` string — no sandbox needed.

### Per-run sandbox

One sandbox lives for the entire pipeline. Steps share it by reference (sandbox ID).

```typescript
// Workspace created once, outside steps
const sandbox = await step.run("setup-workspace", async () => {
  const sb = await Sandbox.create("forge-agent", { timeout: 3600 })
  await sb.commands.run(`git clone ${repoUrl} /workspace`)
  return { sandboxId: sb.id }
})

await step.run("plan", async () => {
  const sb = await Sandbox.connect(sandbox.sandboxId)  // reconnect to same VM
  // agent works directly on /workspace — files persist
})

await step.run("implement", async () => {
  const sb = await Sandbox.connect(workspace.sandboxId)
  // plan's files are already there — no patching needed
})

// cleanup at the end
await step.run("teardown", async () => {
  const sb = await Sandbox.connect(workspace.sandboxId)
  const diff = await sb.commands.run("git diff", { cwd: "/workspace" })
  await sb.kill()
  return diff.stdout
})
```

**Workspace = one long-lived sandbox, steps reconnect to it by ID.** Simpler file flow, but replay is risky — if "plan" replays, `Sandbox.connect()` might find stale files from the crashed run, or the sandbox might be gone entirely.

### Comparison

| | Per-step | Per-run |
|---|---|---|
| Workspace code | Heavier — clone + apply patches each step | Lighter — just `connect(id)` |
| Data between steps | Explicit (diffs as return values) | Implicit (shared filesystem) |
| Replay safety | Clean — cached return value, no sandbox needed | Fragile — sandbox state may be stale or missing |
| Parallel steps | Natural — N sandboxes, no coordination | Problematic — N steps writing to one filesystem |
| Cost | More VM boots | One VM, longer lifetime |
| Debugging | Harder — artifacts are serialized diffs | Easier — SSH in and look around |

For a forge pipeline with parallel task execution, **per-step is the safer default**. The patch-passing overhead is real but mechanical, and you get clean replays and natural parallelism for free.

### Build vs buy

The Workspace primitive is simple enough to build for both environments:

- **Local dev** — git worktrees + a thin wrapper (~50 lines). `git worktree add`, agent works, `git diff`, `git worktree remove`.
- **Cloud (E2B)** — E2B SDK + git clone (~50 lines). `Sandbox.create()`, `git clone`, agent works, `git diff`, `sandbox.kill()`.

No off-the-shelf "workspace manager" is needed — it's an interface over tools already in the stack (git locally, E2B's SDK in cloud).

---

## Alternatives Considered

### Browserbase instead of E2B
If the primary tool need is browser automation (not general code execution), Browserbase is more focused — managed Chrome instances, $300M valuation. Less overhead than a full VM. Less suitable when the agent also needs file system access and bash.

### Trigger.dev instead of Inngest
Strong alternative — first-class Playwright extension (Chrome in container), no execution timeout (better for long agent runs), OSS self-hostable. No native E2B integration but straightforward to wire. Switch if self-hosting is a priority or Inngest's 50K/mo free tier becomes a constraint.

### Temporal instead of Inngest
Most battle-tested, best for complex distributed systems at scale. Higher operational overhead (Temporal server). Better Python story (OpenAI Agents SDK integration). Switch if the system grows to need multi-day workflows or legacy system integrations.

---

## Open Questions

- Can the Claude Agent SDK binary be installed inside an E2B sandbox for fully self-contained runs (agent + environment in one VM)?
- What is the right sandbox lifetime model — one sandbox per pipeline run, or one per step?
- How does session resume work across E2B sandbox restarts (sandbox killed, new one created, `resume: sessionId` pointed at persisted JSONL)?
- Is Inngest's 50K/mo free tier sufficient for forge pipeline volumes, or does Trigger.dev's self-hosted option make more sense?
