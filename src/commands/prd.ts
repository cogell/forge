/**
 * forge prd <feature>
 *
 * Check preconditions for PRD writing and scaffold the file.
 * The agent (via plugin command) runs the actual interview/writing process.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

export async function prd(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const feature = args.find((a) => !a.startsWith("-"));

  if (!feature) {
    console.error("Usage: forge prd <feature-name>");
    process.exit(1);
  }

  const cwd = process.cwd();
  const planDir = join(cwd, "plans", feature);
  const prdFile = join(planDir, "prd.md");
  const brainstormFile = join(planDir, "brainstorm.md");

  if (existsSync(prdFile)) {
    if (json) {
      console.log(JSON.stringify({ status: "exists", path: prdFile }));
    } else {
      console.log(`PRD already exists: plans/${feature}/prd.md`);
    }
    return;
  }

  mkdirSync(planDir, { recursive: true });

  const hasBrainstorm = existsSync(brainstormFile);
  const today = new Date().toISOString().split("T")[0];

  const content = `---
status: active
feature: ${feature}
created: ${today}
completed: null
---

# PRD: ${feature}

## Problem Statement

## Solution

## User Stories

1. As a [actor], I want [feature], so that [benefit]

## Implementation Decisions

## Testing Decisions

## Out of Scope

## Further Notes
`;

  writeFileSync(prdFile, content);

  if (json) {
    console.log(
      JSON.stringify({
        status: "created",
        path: prdFile,
        hasBrainstorm,
      })
    );
  } else {
    console.log(`Created: plans/${feature}/prd.md`);
    if (hasBrainstorm) {
      console.log(`Brainstorm available: plans/${feature}/brainstorm.md`);
    }
    console.log(`\nNext: complete the PRD, then run 'forge plan ${feature}'`);
  }
}
