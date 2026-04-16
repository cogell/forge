# Research: Durable Execution in Agent Orchestration Pipelines

> Context: Synthesized from analysis of mngr, tracker (2389-research), the-software-garden, and forge — four systems all solving agent orchestration from different angles.

---

## Background: The Four Systems

### mngr (imbue-ai/mngr)
- CLI for managing agent lifecycles over SSH (local, Docker, Modal)
- "git for agents" — create/stop/clone/message persistent tmux sessions
- No pipeline engine; no DAG; no checkpoints — orchestration is your problem
- Strength: infrastructure abstraction (remote compute, agent persistence)
- Gap: no orchestration logic whatsoever

### tracker (2389-research/tracker)
- Graph-based pipeline execution engine using `.dip` files (Dippin language)
- Built-in: parallel fan-out, human gates (4 modes + autopilot), checkpoints, TUI dashboard
- Claude Code CLI subprocess or native API backends
- Strength: production-grade pipeline engine with observability
- Gap: local only, another DSL to learn

### the-software-garden
- Agent orchestration runtime for coding agents specifically
- Graphviz DOT workflow files + tmux session management + web dashboard (Greenhouse)
- SQLite-backed task graph, Claude Code hook integration, live terminal streaming
- Strength: visual DAG authoring + interactive terminal access + real-time dashboard
- Gap: local only; file system side-effects not tracked across replays

### forge
- Feature pipeline skill system (PRD → plan → tasks → code → docs)
- Orchestration lives inside the agent's context (skill prompts carry the protocol)
- State machine with `forge status`, task DAG in `tasks.json`
- Strength: full pipeline spec with quality gates, task decomposition, doc graduation
- Gap: orchestration fragile to context blowouts; no parallelism; manual checkpointing (in progress via `agent-orchestrator` PRD)

---

## The 7 Core Primitives

Synthesized from all four systems — each does one thing, has a clean interface, and can be used independently or composed.

### 1. Runner
*One prompt in, one structured result out.*

```typescript
interface Runner {
  run(prompt: string, config?: RunConfig): Promise<RunResult>
}

interface RunConfig {
  model?:     string
  backend?:   'api' | 'claude-cli' | 'codex-cli' | 'gemini'
  workspace?: WorkspaceHandle
  timeout?:   number
}

interface RunResult {
  status:      'complete' | 'failed'
  output:      string
  structured?: unknown   // when prompt requests JSON
  cost?:       { tokens: number; usd: number }
}
```

Every system reinvents this. mngr wraps it in tmux. tracker wraps it in `codergen`. Garden wraps it in a tmux window. It should be a standalone primitive.

---

### 2. Workspace
*Isolated file tree for one unit of work.*

```typescript
interface Workspace {
  create(base: string): Promise<WorkspaceHandle>
  collect(handle: WorkspaceHandle): Promise<Diff>
  destroy(handle: WorkspaceHandle): Promise<void>
}
```

Backed by git worktrees locally, Docker volume mounts remotely. tracker, garden, and forge all implement this ad-hoc. Pool (below) depends on it.

---

### 3. Queue
*Dependency-ordered work list.*

```typescript
interface Queue<T extends { id: string }> {
  add(item: T, deps?: string[]): string
  ready(): T[]           // items with all deps complete
  claim(id: string): void
  complete(id: string, result?: unknown): void
  fail(id: string, reason?: string): void
  status(): QueueSummary
}
```

Forge has this as `tasks.json`. Garden has it in SQLite. They're the same concept — a dependency graph with `ready()` semantics. Should be a standalone library, storage-agnostic (in-memory, file, SQLite).

---

### 4. State
*Checkpoint/resume for any multi-step process.*

```typescript
interface State {
  read(runId: string): Promise<Record<string, StepState> | null>
  write(runId: string, step: string, state: StepState): Promise<void>
  clear(runId: string): Promise<void>
}

interface StepState {
  status:     'pending' | 'in-progress' | 'complete' | 'failed'
  startedAt?: string
  result?:    unknown
}
```

This is exactly what the `agent-orchestrator` PRD is building for forge. tracker has it. Garden has it in SQLite. The interface is simple — the complexity is in who writes it (agent vs. engine vs. script).

---

### 5. Gate
*A decision point that blocks progress until resolved.*

```typescript
interface Gate {
  ask(question: string, options?: GateOptions): Promise<GateResult>
}

interface GateOptions {
  mode:       'choice' | 'freeform' | 'review-loop'
  choices?:   string[]
  maxPasses?: number      // for review-loop mode
  criteria?:  string[]    // what to evaluate against
}

interface GateResult {
  verdict:  'pass' | 'fail' | 'escalate'
  response: string
  passes?:  number
}

// Implementations:
class HumanGate implements Gate { /* CLI prompt or web panel */ }
class ReviewGate implements Gate { /* spawns fresh Runner per pass */ }
class AutopilotGate implements Gate { /* LLM decides */ }
class AlwaysPassGate implements Gate { /* for testing */ }
```

tracker has 4 human gate modes. Forge has the review loop in prompt. Garden has it as a DOT node. All three are implementations of the same interface.

---

### 6. Pool
*N runners in parallel, each isolated.*

```typescript
interface Pool {
  run(tasks: PoolTask[], config?: PoolConfig): Promise<PoolResult[]>
}

interface PoolTask {
  id:         string
  prompt:     string
  workspace?: boolean   // get an isolated Workspace
}

interface PoolConfig {
  concurrency?: number
  backend?:     RunConfig['backend']
}

interface PoolResult {
  id:     string
  result: RunResult
  diff?:  Diff   // collected from workspace if workspace: true
}
```

tracker has this as the `parallel` node. Garden has parallel DOT edges. Both implement it ad-hoc. Pool + Workspace + Runner compose naturally.

---

### 7. Bus
*Typed event stream connecting everything.*

```typescript
interface Bus {
  emit(event: Event): void
  on(pattern: string, handler: (e: Event) => void): Unsubscribe
  stream(): AsyncIterable<Event>
}

// pattern: "runner.*", "gate.pass", "queue.complete", etc.
type EventType =
  | 'runner.start'  | 'runner.complete'  | 'runner.fail'
  | 'queue.ready'   | 'queue.complete'   | 'queue.fail'
  | 'gate.open'     | 'gate.pass'        | 'gate.fail'
  | 'pool.start'    | 'pool.complete'
  | 'state.write'   | 'state.clear'
```

Garden has a full EventBus. tracker has JSONL run logs. Forge has nothing. This is the observability layer — everything else emits to it, consumers subscribe.

---

### Meta-primitive: Graph
*Wires the 7 primitives together into a DAG.*

Once you have the 7 primitives, a `Graph` is a traversal engine that dispatches nodes to handlers based on a DAG definition with outcome-conditioned edges. That's what tracker's engine and garden's dot-engine both are — the same thing with different DSLs (`.dip` vs `.dot`).

A clean synthesis defines the graph in terms of the primitives above and lets the DSL be a thin layer on top — or skips the DSL entirely and uses code.

---

## How They Compose

```
forge:run   = Queue → Pool → ReviewGate → State
              (tasks)  (parallel tasks)  (checkpoint)

tracker     = Graph traversal over { Runner | Gate | Pool } + State + Bus

garden      = DOT Graph → { Runner | Shell | Gate } + Workspace + Bus + SQLite Queue

your-script = State.read → Queue.ready → Pool.run → ReviewGate.ask → State.write → loop
```

---

## Durable Execution

### What it is

The core promise: **your code runs as if it never crashes.** The runtime automatically records each step's result. On restart, it replays history up to the crash point and continues — your code never knows it restarted.

Systems: Temporal, Inngest, Cloudflare Workflows, Restate.

### Where it sits

Durable execution is not a peer to the 7 primitives — it's the **substrate beneath them:**

```
┌─────────────────────────────────────────┐
│  Graph / Pipeline logic                  │
│  Runner · Queue · Gate · Pool · Bus      │
├─────────────────────────────────────────┤
│  State (manual checkpointing)            │  ← durable execution replaces this
├─────────────────────────────────────────┤
│  Durable Execution Runtime               │  ← Temporal, Inngest, CF Workflows
│  (automatic replay, step persistence)    │
├─────────────────────────────────────────┤
│  Infrastructure (local, Docker, Modal)   │
└─────────────────────────────────────────┘
```

`State` as defined above is **manual durable execution** — you write checkpoints by hand at each step. A real durable execution runtime makes that automatic and more reliable. If you adopt one, `State` mostly disappears as a service you manage.

### The LLM problem

Traditional durable execution assumes **deterministic functions** — replay produces identical results. LLM calls are non-deterministic, which breaks the replay assumption.

The fix: treat each LLM call as an **activity** — a side-effectful operation whose result gets recorded in the execution history. On replay, the runtime returns the cached result instead of re-calling the LLM.

```typescript
// Without durable execution — will re-call LLM on replay:
const result = await runner.run(prompt)

// With durable execution (Temporal-style):
const result = await workflow.executeActivity(runner.run, prompt)
// On replay: returns cached result, no LLM call
```

Retries also become free — if the network flakes mid-call, the runtime retries automatically at the right granularity.

### What it changes for each primitive

| Primitive | Without durable execution | With durable execution |
|---|---|---|
| `State` | Written manually at each step | Handled automatically by runtime |
| `Runner` | Stateless function; crash = lost work | Becomes an activity — result cached in history |
| `Queue` | You manage ready/claim/complete | Runtime schedules work durably |
| `Gate` | Blocks the process (risky on long runs) | Signal/event in the runtime — process can sleep |
| `Pool` | Manual fan-out with your own tracking | Parallel activities; runtime tracks all |
| `Bus` | You wire it up | Often provided natively by the runtime |

### The practical tradeoff

**Without durable execution (current state of all 4 systems):**
- Simple to set up — just files and processes
- Manual `State` is good enough for short pipelines
- Crash mid-step = lose that step's work, restart it
- Fine for local dev, risky for long unattended runs

**With durable execution:**
- Crash mid-step = resume exactly where you left off, at LLM-call granularity
- Sleep a workflow for hours/days and it wakes up correctly
- File system side-effects still need care — the runtime doesn't undo file writes on replay
- Adds real infrastructure (Temporal server, or Inngest/CF Workflows account)

### The file system catch

For coding agents specifically, durable execution has a sharp edge: **file mutations are side effects the runtime doesn't track.** If a Runner writes files, then crashes, and replays — the files from the first run are still there. You'd need to either:

- Apply mutations only at step boundaries (record intent, apply atomically at end)
- Use Workspace/worktrees as the isolation unit and collect diffs only after confirmed completion
- Accept that replay is "best effort" for file state

This is why none of the four systems use a durable execution runtime — the file system problem makes it non-trivial.

### Runtime options

**Temporal**
- Most mature; battle-tested at scale
- Requires running a Temporal server (or Temporal Cloud)
- Activities = side-effectful operations (LLM calls, shell commands)
- Signals = async events that wake sleeping workflows (human gates)
- Best for: production at scale, complex branching, long sleep intervals

**Inngest**
- Lowest friction to adopt — workflow functions are just HTTP handlers
- No server to run locally; cloud-hosted event system
- `step.run()` checkpoints each step automatically
- Native AI support (wraps LLM calls as recorded steps)
- Best for: serverless environments, fastest path to durable LLM pipelines

**Cloudflare Workflows**
- Durable execution at the edge; zero infrastructure overhead if already on Workers
- Each `step.do()` is checkpointed automatically
- File system problem punted to external storage (R2, D1)
- Best for: Workers-native projects; pairs naturally with D1 for Queue and State

**Restate**
- Newer; gRPC-based; strong TypeScript SDK
- Journal-based replay like Temporal but lighter weight
- Best for: teams that want Temporal semantics without the operational overhead

### Recommended synthesis

```
Durable execution runtime  →  replaces State; makes Runner/Gate/Pool reliable
Workspace                  →  still needed; durable execution doesn't help with files
Queue                      →  can be built on top of the runtime's scheduling
Graph                      →  becomes a durable workflow function
Bus                        →  pull from the runtime's event/history system
```

For the forge use case specifically:
- **Short runs, local dev**: manual `State` (the `agent-orchestrator` PRD approach) is sufficient
- **Long unattended runs, remote compute**: Inngest or Cloudflare Workflows is the right substrate
- Durable execution is the thing that turns "works in demos" into "works unattended at 3am"

---

## What Doesn't Exist Yet

None of the four systems expose these primitives as standalone, importable libraries with clean interfaces. They're all embedded in their respective runtimes. The synthesis opportunity is publishing them as a composable toolkit — a `@pipeline/*` monorepo — where you can:

```typescript
import { Queue, Runner, ReviewGate } from '@pipeline/core'
import { IngestState } from '@pipeline/inngest'
import { WorktreeWorkspace } from '@pipeline/git'
```

...and wire them up however fits your workflow, with durable execution as an opt-in substrate rather than a hard dependency.

That's the gap between where all four systems are and where they're all pointing.
