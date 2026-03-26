#!/usr/bin/env bun

import { status } from "./commands/status";
import { init } from "./commands/init";
import { brainstorm } from "./commands/brainstorm";
import { prd } from "./commands/prd";
import { plan } from "./commands/plan";
import { tasks } from "./commands/tasks";
import { run } from "./commands/run";
import { docs } from "./commands/docs";

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  status,
  init,
  brainstorm,
  prd,
  plan,
  tasks,
  run,
  docs,
};

const HELP = `
forge — feature pipeline CLI

Usage: forge <command> [feature] [options]

Commands:
  status [feature]          Detect pipeline state, suggest next step
  init                      Set up plans/ and docs/ structure
  brainstorm <feature>      Divergent exploration: gather ideas, map problem space
  prd <feature>             Convergent: write PRD from brainstorm output
  plan <feature>            Slice PRD into phased implementation plan
  tasks <feature>           Decompose plan into beads DAG
  run <feature>             Autopilot: plan → tasks → implement → docs → PR
  docs [--phase|--ship] <f> Documentation lifecycle management

Options:
  --help, -h                Show this help
  --json                    Output as JSON (for agent consumption)
`.trim();

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    if (args.length === 0) {
      // No args = status
      await status(args);
      return;
    }
    console.log(HELP);
    return;
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  if (command in COMMANDS) {
    await COMMANDS[command](commandArgs);
  } else {
    console.error(`Unknown command: ${command}`);
    console.error(`Run 'forge --help' for usage.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
