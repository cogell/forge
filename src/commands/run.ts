/**
 * forge run <feature>
 *
 * Validate preconditions for automated execution.
 * Checks: PRD exists, forge.json configured, git clean.
 * Reports what needs to happen (plan, tasks, or execute).
 * The agent handles the actual orchestration.
 */

import { existsSync } from "fs";
import { join } from "path";
import { queryFeatureTasks, readProjectPrefix } from "../lib/tasks";

export async function run(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const feature = args.find((a) => !a.startsWith("-"));

  if (!feature) {
    console.error("Usage: forge run <feature-name>");
    process.exit(1);
  }

  const cwd = process.cwd();
  const prdFile = join(cwd, "plans", feature, "prd.md");
  const planFile = join(cwd, "plans", feature, "plan.md");

  // Check forge.json exists (replaces bd availability check)
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

  if (json) {
    console.log(JSON.stringify({ status: "ready", feature, checks, steps }));
  } else {
    console.log(`Feature: ${feature}`);
    console.log(`PRD:     plans/${feature}/prd.md`);
    if (checks.hasPlan) console.log(`Plan:    plans/${feature}/plan.md`);
    if (checks.hasEpic) console.log(`Epic:    ${checks.epicId}`);
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
