# Research: Agent Orchestration with Claude Agent SDK + Inngest

> Context: Exploring whether the forge pipeline's agent orchestration can be built on top of `@anthropic-ai/claude-agent-sdk` (full Claude Code instances as execution units) and Inngest (durable execution). Follows from research in `plans/durable-execution/research.md`.

---

## The Core Question

Agent-kit (Inngest's first-party AI library) uses bare LLM API calls as its execution unit. For forge, the execution unit is a full Claude Code agent — one that can write files, run tests, make commits, and load CLAUDE.md/skills. Those are different things. Is there a system that provides agent-kit's orchestration features but where each node is a full Claude Code instance?

---

## The Answer: Build It from Two Primitives

No packaged system does this today. But the two right primitives exist and compose cleanly:

- **`@anthropic-ai/claude-agent-sdk`** — full Claude Code instances as a library
- **Inngest** — durable execution, step checkpointing, event-driven orchestration

---

## Primitive 1: @anthropic-ai/claude-agent-sdk

### What it is

Not the standard `@anthropic-ai/sdk` (stateless API calls). The Agent SDK embeds the same agentic loop that powers the Claude Code CLI as a managed subprocess. Each `query()` call spawns a full Claude Code instance with all its capabilities.

Previously called `@anthropic-ai/claude-code-sdk`, now stabilized as `@anthropic-ai/claude-agent-sdk` (v0.2.x, tracking Claude Code v2.1.x).

### What you get that agent-kit doesn't have

- **Full tool access**: Bash, Read, Edit, Glob, MultiEdit — not tools you define, tools Claude Code already has
- **OAuth token support**: spawns the same Claude Code binary, so `claude login` credentials work — no `ANTHROPIC_API_KEY` needed (Max/Pro subscription compatible)
- **CLAUDE.md + skills loaded**: `settingSources: ["project"]` loads the project's instructions and skills automatically
- **MCP servers**: pass any MCP server config, Claude Code connects to it
- **Session persistence + resume**: sessions persist to `~/.claude/projects/<cwd>/<session-id>.jsonl`; resume with `resume: sessionId`
- **Worktree isolation**: each `query()` call takes a `cwd` — point it at a git worktree for isolation

### Primary API

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk"

for await (const message of query({
  prompt: "Implement task FORGE-1.2: checkpoint module",
  options: {
    allowedTools: ["Read", "Edit", "Bash", "Glob"],
    permissionMode: "acceptEdits",
    maxTurns: 30,
    cwd: "/path/to/worktree",
    systemPrompt: "You are implementing a specific task. Write tests first.",
    model: "claude-sonnet-4-6",
    settingSources: ["project"],         // loads CLAUDE.md, skills
    outputFormat: { type: "json_schema", schema: mySchema }, // structured result
    mcpServers: {
      playwright: { command: "npx", args: ["@playwright/mcp@latest"] }
    },
  }
})) {
  if (message.type === "result" && message.subtype === "success") {
    console.log(message.result)           // structured output or text
    console.log(message.total_cost_usd)
    console.log(message.session_id)       // capture for resume
  }
}
```

### Session resume (within-step crash recovery)

```typescript
// First run — capture session_id
const result = await runQuery(prompt, { cwd, sessionId: crypto.randomUUID() })
// Store result.session_id

// On crash mid-turn — resume from where Claude Code left off
const resumed = await runQuery("continue", { cwd, resume: storedSessionId })
```

### Full exported surface

- `query()` — primary entry point, `AsyncGenerator<SDKMessage>` with control methods (`interrupt()`, `rewindFiles()`, `setPermissionMode()`, `setModel()`, `close()`)
- `tool()` — create typed MCP tool definitions with Zod schemas
- `createSdkMcpServer()` — in-process MCP servers
- `listSessions()`, `getSessionMessages()`, `getSessionInfo()` — session introspection
- `renameSession()`, `tagSession()`, `forkSession()` — session management
- `startup()` — pre-warm subprocess (~20x faster first query)
- `unstable_v2_createSession()`, `unstable_v2_resumeSession()`, `unstable_v2_prompt()` — multi-turn V2 API (preview)

### Result message shape

```typescript
type ResultMessage = {
  type: "result"
  subtype: "success" | "error_max_turns" | "error_max_budget_usd"
           | "error_during_execution" | "error_max_structured_output_retries"
  result: string              // text or JSON (if outputFormat specified)
  total_cost_usd: number
  session_id: string
  num_turns: number
  stop_reason: string
  usage: TokenUsage
}
```

### Auth

Inherits Claude Code's auth resolution order:
1. `ANTHROPIC_API_KEY` env var
2. OAuth token from `~/.claude/` (i.e., `claude login` — Max/Pro subscription)
3. Bedrock: `CLAUDE_CODE_USE_BEDROCK=1`
4. Vertex: `CLAUDE_CODE_USE_VERTEX=1`
5. Azure: `CLAUDE_CODE_USE_FOUNDRY=1`

---

## Primitive 2: Inngest (durable execution)

See `plans/durable-execution/research.md` for full coverage. Key points relevant here:

- `step.run("step-name", fn)` — checkpoints after each step; crash between steps = resume from last checkpoint
- Dev server runs locally (`npx inngest-cli@latest dev`) — no cloud account needed to kick the tires
- Each step result is stored in Inngest's execution history — retries replay from the last successful step
- Steps are the granularity of durability — within a step, the Agent SDK's `resume` option handles crashes

---

## How They Compose

### Failure surface coverage

```
Within a step (mid-LLM-turn crash):
  → Agent SDK session resume (resume: sessionId)

Between steps (process crash after step N, before step N+1):
  → Inngest step.run() checkpoint replay

Both together:
  → full crash safety at every granularity
```

### The forge pipeline as an Inngest function

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk"
import { inngest } from "./client"

inngest.createFunction(
  { id: "forge-run" },
  { event: "forge/run" },
  async ({ event, step }) => {
    const { feature, cwd } = event.data

    // Each step.run() is checkpointed — crash between steps = resume here
    const planResult = await step.run("plan", async () => {
      const sessionId = `forge-${feature}-plan`
      for await (const msg of query({
        prompt: planPrompt(feature),
        options: { cwd, sessionId, settingSources: ["project"], maxTurns: 50 }
      })) {
        if (msg.type === "result") return { text: msg.result, sessionId: msg.session_id }
      }
    })

    const planReview = await step.run("plan-review-gate", async () => {
      for await (const msg of query({
        prompt: reviewPrompt(planResult.text, planCriteria),
        options: { cwd, maxTurns: 20 }
      })) {
        if (msg.type === "result") return JSON.parse(msg.result) // { verdict, issues }
      }
    })

    if (planReview.verdict === "fail") {
      // loop — re-run plan with review feedback, up to MAX_REVIEW_PASSES
    }

    const tasksResult = await step.run("tasks", async () => { /* ... */ })
    const tasksReview = await step.run("tasks-review-gate", async () => { /* ... */ })

    // Parallel task execution — fan out to Pool
    const readyTasks = await step.run("get-ready-tasks", () => queue.ready())

    const taskResults = await step.run("execute", async () => {
      return Promise.all(readyTasks.map(task =>
        runTaskAgent(task, { cwd: worktreeFor(task) })
      ))
    })

    await step.run("docs", async () => { /* ... */ })
    await step.run("pr",   async () => { /* ... */ })
  }
)
```

### Worktree isolation per task agent

```typescript
async function runTaskAgent(task: Task, { cwd }: { cwd: string }) {
  const sessionId = `forge-task-${task.id}`
  for await (const msg of query({
    prompt: taskPrompt(task),   // title + description + design + acceptance criteria
    options: {
      cwd,                       // isolated git worktree for this task
      sessionId,
      allowedTools: ["Read", "Edit", "Bash", "Glob", "MultiEdit"],
      permissionMode: "acceptEdits",
      settingSources: ["project"],
      maxTurns: 100,
      outputFormat: {
        type: "json_schema",
        schema: TaskResultSchema   // { status, commitHash, notes }
      }
    }
  })) {
    if (msg.type === "result") return JSON.parse(msg.result)
  }
}
```

---

## Comparison: Agent SDK + Inngest vs. agent-kit + Inngest

| | Agent SDK + Inngest | agent-kit + Inngest |
|---|---|---|
| **OAuth token (Max/Pro sub)** | Yes — inherits `claude login` | No — requires `ANTHROPIC_API_KEY` |
| **Full file system / Bash access** | Yes — built into Claude Code | You define as tools |
| **CLAUDE.md / skills loaded** | Yes — `settingSources: ["project"]` | No |
| **MCP servers** | Yes — `mcpServers` option | Via custom adapter |
| **Worktree isolation** | `cwd` option per query | You build it |
| **Session resume (within-step)** | Built-in — `resume: sessionId` | N/A |
| **Durable execution (between steps)** | You wire `step.run()` around it | Built-in via `step` |
| **Structured output** | `outputFormat: json_schema` | Native |
| **Multi-model** | Claude only | OpenAI, Anthropic, Gemini |
| **Parallel agents** | `Promise.all()` in a step | `parallel` node type |

---

## What Exists Today vs. What Needs Building

### Exists
- `@anthropic-ai/claude-agent-sdk` — stable V1 API (`query()`)
- Inngest dev server — full local development, no cloud account
- Session persistence + resume — built into the Agent SDK
- `step.run()` checkpointing — Inngest core primitive

### Doesn't exist (the build surface)
- No npm package wires these together
- No reusable `ForgeRunner` that wraps `query()` with consistent error handling, session tracking, and structured output
- No `ReviewGate` implementation using `query()` for fresh-context review passes
- No `WorktreePool` that fans out `query()` calls across isolated git worktrees
- No Inngest function template for the full forge 7-step pipeline

The build surface is small. The forge pipeline would be ~150–200 lines of Inngest function code wrapping `query()` calls — one per step, session IDs stored in Inngest state for resume, worktree paths passed as `cwd`.

---

## Related Systems

| System | Approach | Gap vs. this |
|---|---|---|
| **tracker** | Claude Code CLI subprocess + `.dip` pipeline engine | No durable execution; local only |
| **the-software-garden** | Claude Code in tmux + DOT workflows | No durable execution; local only |
| **mngr** | Claude Code in tmux/SSH/Modal | No orchestration engine at all |
| **agent-kit** | LLM API calls + Inngest | No full Claude Code instances; API key required |

The Agent SDK + Inngest combination is "tracker with durable execution" — the missing piece that makes long unattended pipeline runs production-safe.

---

## Next Steps

1. **Spike**: write a minimal `query()` wrapper and run a single forge step (e.g., `plan`) through it — verify OAuth token works, CLAUDE.md loads, output is structured
2. **Wire Inngest**: wrap the spike in `step.run()`, run the dev server, verify checkpoint behavior on simulated crash
3. **Review gate**: implement `ReviewGate` as a `query()` call with structured output (`{ verdict, issues }`) — test the loop-until-pass pattern
4. **Parallel tasks**: fan out `query()` calls across worktrees via `Promise.all()` inside a single `step.run()` — or as separate steps if per-task checkpointing is needed
5. **Decision**: does this replace the `agent-orchestrator` PRD (checkpoint module in the CLI) or complement it? The CLI checkpoint is for agent-driven runs; this is for script-driven runs — they can coexist.
