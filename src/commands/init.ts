/**
 * forge init
 *
 * Set up plans/ and docs/ directory structure.
 * Idempotent — safe to run multiple times.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const DIRS = [
  "plans/_template",
  "plans/_archive",
  "docs/decisions",
  "docs/guides",
  "docs/reference",
];

export async function init(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const json = args.includes("--json");
  const created: string[] = [];
  const existed: string[] = [];

  for (const dir of DIRS) {
    const full = join(cwd, dir);
    if (existsSync(full)) {
      existed.push(dir);
    } else {
      mkdirSync(full, { recursive: true });
      created.push(dir);
    }
  }

  // Write templates if they don't exist
  const templates: [string, string][] = [
    ["plans/_template/prd.md", PRD_TEMPLATE],
    ["plans/_template/plan.md", PLAN_TEMPLATE],
    ["docs/decisions/template.md", ADR_TEMPLATE],
  ];

  for (const [path, content] of templates) {
    const full = join(cwd, path);
    if (!existsSync(full)) {
      writeFileSync(full, content);
      created.push(path);
    } else {
      existed.push(path);
    }
  }

  if (json) {
    console.log(JSON.stringify({ created, existed }, null, 2));
    return;
  }

  if (created.length > 0) {
    console.log("Created:");
    for (const p of created) console.log(`  + ${p}`);
  }
  if (existed.length > 0) {
    console.log("Already existed:");
    for (const p of existed) console.log(`  . ${p}`);
  }
  if (created.length === 0) {
    console.log("Project already initialized. Nothing to do.");
  }
}

const PRD_TEMPLATE = `---
status: active
feature: <feature-name>
created: <YYYY-MM-DD>
completed: null
---

# PRD: <Feature Name>

## Problem Statement

## Solution

## User Stories

1. As a [actor], I want [feature], so that [benefit]

## Implementation Decisions

## Testing Decisions

## Out of Scope

## Further Notes
`;

const PLAN_TEMPLATE = `---
status: active
feature: <feature-name>
created: <YYYY-MM-DD>
completed: null
---

# Plan: <Feature Name>

> Source PRD: plans/<feature-name>/prd.md

## Architectural Decisions

## Phase 1: <Title>

**User stories**:

### What to build

### Acceptance criteria

- [ ]
`;

const ADR_TEMPLATE = `# ADR-NNN: <Title>

## Status

Proposed

## Context

## Decision

## Consequences

-
`;
