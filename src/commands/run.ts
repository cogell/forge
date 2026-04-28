/**
 * forge run [<feature>]
 *
 * Validate preconditions for automated execution.
 * Checks: PRD exists, forge.json configured, git clean.
 * Reports what needs to happen (plan, tasks, or execute).
 * The agent handles the actual orchestration.
 *
 * FORGE-5.2: also supports --epic <id> and --phase <N> flags.
 *  - Mutually exclusive (exit 2).
 *  - --epic alone is sufficient (no feature positional required).
 *  - --phase still requires a feature positional.
 */

import { existsSync } from "fs";
import { join } from "path";
import { queryFeatureTasks, readProjectPrefix } from "../lib/tasks";

interface ParsedArgs {
  feature: string | undefined;
  epicFlag: string | null;
  phaseFlag: string | null;
  json: boolean;
}

/**
 * Walk args once, splitting into positional values, boolean flags, and
 * value-flag pairs for --epic and --phase. The first non-empty positional
 * is treated as the feature.
 */
function parseRunArgs(args: string[]): ParsedArgs {
  const valueFlags = new Set(["--epic", "--phase"]);
  const positionals: string[] = [];
  let epicFlag: string | null = null;
  let phaseFlag: string | null = null;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") {
      json = true;
      continue;
    }
    if (valueFlags.has(a)) {
      const next = args[i + 1];
      if (a === "--epic") epicFlag = next ?? null;
      else if (a === "--phase") phaseFlag = next ?? null;
      i++; // consume value
      continue;
    }
    if (a.startsWith("-")) {
      // unknown boolean flag — ignore, do not treat as positional
      continue;
    }
    positionals.push(a);
  }

  // Empty-string positional is treated as no-feature.
  const feature = positionals.find((p) => p.length > 0);
  return { feature, epicFlag, phaseFlag, json };
}

export async function run(args: string[]): Promise<void> {
  const { feature, epicFlag, phaseFlag, json } = parseRunArgs(args);

  // Mutex check first.
  if (epicFlag && phaseFlag) {
    console.error("--epic and --phase are mutually exclusive");
    process.exit(2);
  }

  // Relax the no-feature guard before numeric validation, so
  // 'forge run --phase abc' (no feature) reports the more specific
  // '--phase requires a feature positional' message rather than the
  // generic integer-validation error.
  if (!feature) {
    if (epicFlag) {
      // --epic alone path: skip feature-scoped precondition checks entirely.
      const cwd = process.cwd();
      let forgeConfigured = false;
      try {
        readProjectPrefix(cwd);
        forgeConfigured = true;
      } catch {
        forgeConfigured = false;
      }

      const meta = {
        forgeConfigured,
        gitClean: await isGitClean(),
      };

      const phaseValue = phaseFlag !== null ? Number(phaseFlag) : null;
      const payload = {
        epic: epicFlag,
        phase: phaseValue,
        ...meta,
      };

      if (json) {
        console.log(JSON.stringify(payload));
      } else {
        console.log(`Epic:    ${epicFlag}`);
        if (phaseValue !== null) console.log(`Phase:   ${phaseValue}`);
        console.log(`Git:     ${meta.gitClean ? "clean" : "dirty (will stash)"}`);
      }
      return;
    }
    if (phaseFlag) {
      console.error("--phase requires a feature positional");
      process.exit(1);
    }
    console.error("Usage: forge run <feature-name>");
    process.exit(1);
  }

  // Validate --phase numeric (after no-feature relaxation per design order).
  if (phaseFlag !== null) {
    const n = Number(phaseFlag);
    if (!Number.isInteger(n)) {
      console.error(`--phase requires an integer value (got '${phaseFlag}')`);
      process.exit(1);
    }
  }

  // Feature-scoped path: feature is defined here.
  const cwd = process.cwd();
  const prdFile = join(cwd, "plans", feature, "prd.md");
  const planFile = join(cwd, "plans", feature, "plan.md");

  // Check forge.json exists
  let forgeConfigured = false;
  try {
    readProjectPrefix(cwd);
    forgeConfigured = true;
  } catch {
    forgeConfigured = false;
  }

  // Precondition checks
  const checks = {
    hasPrd: existsSync(prdFile),
    hasPlan: existsSync(planFile),
    forgeConfigured,
    gitClean: await isGitClean(),
    hasEpic: false,
    epicId: null as string | null,
  };

  const epic = queryFeatureTasks(feature, cwd);
  if (epic) {
    checks.hasEpic = true;
    checks.epicId = epic.primaryEpicId;
  }

  if (!checks.hasPrd) {
    if (json) console.log(JSON.stringify({ error: "no-prd", feature }));
    else console.error(`No PRD found. Run 'forge prd ${feature}' first.`);
    process.exit(1);
  }

  if (!checks.forgeConfigured) {
    if (json) console.log(JSON.stringify({ error: "no-forge-json" }));
    else console.error("No forge.json found. Run 'forge init' first.");
    process.exit(1);
  }

  // Determine what needs to happen
  const steps: string[] = [];
  if (!checks.hasPlan) steps.push("plan");
  if (!checks.hasEpic) steps.push("tasks");
  steps.push("execute");
  steps.push("docs");

  const phaseValue = phaseFlag !== null ? Number(phaseFlag) : null;

  if (json) {
    console.log(
      JSON.stringify({
        status: "ready",
        feature,
        epic: epicFlag ?? null,
        phase: phaseValue,
        checks,
        steps,
      }),
    );
  } else {
    console.log(`Feature: ${feature}`);
    console.log(`PRD:     plans/${feature}/prd.md`);
    if (checks.hasPlan) console.log(`Plan:    plans/${feature}/plan.md`);
    if (checks.hasEpic) console.log(`Epic:    ${checks.epicId}`);
    if (epicFlag) console.log(`--epic:  ${epicFlag}`);
    if (phaseValue !== null) console.log(`--phase: ${phaseValue}`);
    console.log(`Git:     ${checks.gitClean ? "clean" : "dirty (will stash)"}`);
    console.log(`\nPipeline steps: ${steps.join(" → ")}`);
  }
}

async function isGitClean(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["git", "status", "--porcelain"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    return stdout.trim() === "";
  } catch {
    return false;
  }
}
