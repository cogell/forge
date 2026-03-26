/**
 * forge plan <feature>
 *
 * Check preconditions and scaffold the implementation plan.
 * Verifies PRD exists. The agent handles the actual slicing.
 */

import { existsSync, writeFileSync } from "fs";
import { join } from "path";

export async function plan(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const feature = args.find((a) => !a.startsWith("-"));

  if (!feature) {
    console.error("Usage: forge plan <feature-name>");
    process.exit(1);
  }

  const cwd = process.cwd();
  const planDir = join(cwd, "plans", feature);
  const prdFile = join(planDir, "prd.md");
  const planFile = join(planDir, "plan.md");

  if (!existsSync(prdFile)) {
    if (json) {
      console.log(JSON.stringify({ error: "no-prd", feature }));
    } else {
      console.error(`No PRD found at plans/${feature}/prd.md`);
      console.error(`Run 'forge prd ${feature}' first.`);
    }
    process.exit(1);
  }

  if (existsSync(planFile)) {
    if (json) {
      console.log(JSON.stringify({ status: "exists", path: planFile }));
    } else {
      console.log(`Plan already exists: plans/${feature}/plan.md`);
    }
    return;
  }

  const today = new Date().toISOString().split("T")[0];
  const content = `---
status: active
feature: ${feature}
created: ${today}
completed: null
---

# Plan: ${feature}

> Source PRD: plans/${feature}/prd.md

## Architectural Decisions

## Phase 1: <Title>

**User stories**:

### What to build

### Acceptance criteria

- [ ]
`;

  writeFileSync(planFile, content);

  if (json) {
    console.log(JSON.stringify({ status: "created", path: planFile, prd: prdFile }));
  } else {
    console.log(`Created: plans/${feature}/plan.md`);
    console.log(`PRD:     plans/${feature}/prd.md`);
    console.log(`\nNext: fill out the plan, then run 'forge tasks ${feature}'`);
  }
}
