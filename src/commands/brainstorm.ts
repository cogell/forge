/**
 * forge brainstorm <feature>
 *
 * Scaffold the brainstorm file and output guidance for the agent.
 * This is the divergent phase — gather ideas, explore problem space,
 * interview stakeholders, map constraints.
 *
 * The CLI creates the directory and starter file.
 * The agent (via the plugin command) runs the actual interview.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

export async function brainstorm(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const feature = args.find((a) => !a.startsWith("-"));

  if (!feature) {
    console.error("Usage: forge brainstorm <feature-name>");
    process.exit(1);
  }

  const cwd = process.cwd();
  const planDir = join(cwd, "plans", feature);
  const brainstormFile = join(planDir, "brainstorm.md");

  if (existsSync(brainstormFile)) {
    if (json) {
      console.log(JSON.stringify({ status: "exists", path: brainstormFile }));
    } else {
      console.log(`Brainstorm already exists: plans/${feature}/brainstorm.md`);
      console.log("Edit it directly or run 'forge prd' to write the PRD.");
    }
    return;
  }

  mkdirSync(planDir, { recursive: true });

  const today = new Date().toISOString().split("T")[0];
  const content = `---
feature: ${feature}
created: ${today}
status: draft
---

# Brainstorm: ${feature}

## Problem Space

<!-- What problem are we solving? Who has it? How painful is it? -->

## Current State

<!-- What exists today? What's working? What's broken? -->

## Ideas

<!-- Raw solution ideas — no filtering yet -->

## Actors / Users

<!-- Who interacts with this? What are their goals? -->

## Constraints

<!-- Technical, business, timeline, dependencies -->

## Open Questions

<!-- Things we need to figure out before writing the PRD -->

## Codebase Notes

<!-- Relevant files, patterns, and architecture discovered during exploration -->
`;

  writeFileSync(brainstormFile, content);

  if (json) {
    console.log(JSON.stringify({ status: "created", path: brainstormFile }));
  } else {
    console.log(`Created: plans/${feature}/brainstorm.md`);
    console.log(`\nNext: fill out the brainstorm, then run 'forge prd ${feature}'`);
  }
}
