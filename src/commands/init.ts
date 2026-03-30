/**
 * forge init
 *
 * Set up plans/ and docs/ directory structure.
 * Optionally configure project prefix via --prefix flag or interactive prompt.
 * Idempotent — safe to run multiple times.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import { isValidPrefix } from "../lib/tasks";

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

  // --- Prefix / forge.json handling ---
  const forgeJsonPath = join(cwd, "forge.json");
  const forgeJsonExists = existsSync(forgeJsonPath);

  if (!forgeJsonExists) {
    const prefixIdx = args.indexOf("--prefix");
    const prefixArg = prefixIdx !== -1 ? args[prefixIdx + 1] : undefined;

    if (prefixArg !== undefined) {
      // Validate prefix from --prefix flag
      if (!isValidPrefix(prefixArg)) {
        if (json) {
          console.log(
            JSON.stringify({
              error: "invalid-prefix",
              prefix: prefixArg,
              message:
                "Must be 2-10 uppercase alphanumeric characters (e.g., FORGE).",
            })
          );
        } else {
          console.error(
            `Invalid prefix: "${prefixArg}". Must be 2-10 uppercase alphanumeric characters (e.g., FORGE).`
          );
        }
        process.exit(1);
      }

      writeFileSync(
        forgeJsonPath,
        JSON.stringify({ prefix: prefixArg }, null, 2) + "\n"
      );
      created.push("forge.json");
    } else if (process.stdin.isTTY && !json) {
      // Interactive prompt
      const prefix = await promptForPrefix();
      if (prefix) {
        writeFileSync(
          forgeJsonPath,
          JSON.stringify({ prefix }, null, 2) + "\n"
        );
        created.push("forge.json");
      }
    }
    // Non-interactive without --prefix: skip silently
  } else {
    existed.push("forge.json");
  }

  // --- Directory creation (original behavior preserved) ---
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

/**
 * Prompt the user for a project prefix interactively.
 * Loops until a valid prefix is entered.
 */
function promptForPrefix(): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let resolved = false;

    function ask() {
      rl.question("Project prefix (e.g., FORGE): ", (answer) => {
        const trimmed = answer.trim();
        if (isValidPrefix(trimmed)) {
          resolved = true;
          rl.close();
          resolve(trimmed);
        } else {
          console.log(
            "Invalid prefix. Must be 2-10 uppercase alphanumeric characters."
          );
          ask();
        }
      });
    }

    rl.on("close", () => {
      // If closed without valid answer (e.g., Ctrl+D), resolve null
      if (!resolved) {
        resolve(null);
      }
    });

    ask();
  });
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
