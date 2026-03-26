# Forge

Feature pipeline CLI + Claude Plugin: **Brainstorm → PRD → Plan → Tasks → Code → Docs**.

Forge gives you a structured, repeatable process for shipping features. The CLI handles state detection (where is this feature in the pipeline?), and the plugin commands give AI agents the process knowledge to execute each step.

## Install

### Prerequisites

- [Bun](https://bun.sh) (runtime)
- [beads](https://github.com/steveyegge/beads) (`bd` CLI) for task decomposition and tracking

### CLI

```bash
git clone https://github.com/cogell/forge.git
cd forge
pnpm install
pnpm build           # builds bin/forge

# Add to PATH (pick one)
ln -s "$(pwd)/bin/forge" ~/.local/bin/forge
# or
export PATH="$PATH:$(pwd)/bin"
```

Verify:

```bash
forge --help
```

### Claude Plugin

Register forge as a local Claude Code plugin (two steps):

```bash
claude plugin marketplace add /path/to/forge   # register as local marketplace
claude plugin install forge                     # install the plugin
```

Restart Claude Code after installing. This gives you `/forge:brainstorm`, `/forge:prd`, `/forge:plan`, `/forge:tasks`, `/forge:run`, `/forge:docs`, `/forge:status`, and `/forge:init` as slash commands.

On session start, the plugin runs `forge status --json` to inject pipeline context automatically.

### Skillshare (for Cursor, Codex, etc.)

If you use [skillshare](https://github.com/cogell/skillshare) to sync skills across AI tools:

```bash
skillshare add /path/to/forge/skills/forge
skillshare sync
```

This makes the skill available to any target that doesn't support the Claude Plugin system.

## Usage

### Quick start

```bash
cd your-project
forge init                        # create plans/ and docs/ structure
forge brainstorm my-feature       # explore the problem space
forge prd my-feature              # interview → write PRD
forge plan my-feature             # slice into phased implementation plan
forge tasks my-feature            # decompose into beads DAG
bd ready                          # start executing tasks
forge docs --ship my-feature      # graduate docs after shipping
```

### Autopilot

```bash
forge prd my-feature              # write the PRD (human + agent)
forge run my-feature              # agent does the rest: plan → tasks → implement → docs → PR
```

### Check pipeline state

```bash
forge status                      # all features
forge status my-feature           # one feature
forge status --json               # machine-readable
```

## Architecture

```
forge/
├── src/                 # Bun CLI — state machine, filesystem + beads queries
├── plugin/              # Claude Plugin (marketplace installable)
│   ├── .claude-plugin/  #   plugin manifest
│   └── commands/        #   agent-facing /forge:* slash commands
├── guidance/            # Deep process docs — referenced by commands
└── skills/forge/        # Skillshare skill — for non-plugin AI tools
```

**Three layers of a forge project:**

| Layer | Directory | Lifecycle |
|-------|-----------|-----------|
| Planning | `plans/` | Feature-scoped: active → completed → archived |
| Knowledge | `docs/` | Evergreen: trimmed, never "completed" |
| Execution | `.beads/` | Transient: closed and compacted |

## Pipeline stages

| Stage | Next action |
|-------|-------------|
| No project | `forge init` |
| Needs brainstorm | `forge brainstorm <feature>` |
| Needs PRD | `forge prd <feature>` |
| Needs plan | `forge plan <feature>` |
| Needs tasks | `forge tasks <feature>` |
| In progress | `bd ready` |
| Needs graduation | `forge docs --ship <feature>` |
| Complete | — |

## Development

```bash
pnpm dev -- status              # run without building
pnpm build                      # compile to bin/forge
pnpm typecheck                  # tsc --noEmit
```
