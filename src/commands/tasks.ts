/**
 * forge tasks <feature>
 *
 * Validate preconditions for beads decomposition.
 * Checks: plan exists, bd CLI available, no existing epic.
 * The agent handles the actual decomposition via bd commands.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { isBdAvailable, queryBeadsEpic } from "../lib/beads";

export async function tasks(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const feature = args.find((a) => !a.startsWith("-"));

  if (!feature) {
    console.error("Usage: forge tasks <feature-name>");
    process.exit(1);
  }

  const cwd = process.cwd();
  const planFile = join(cwd, "plans", feature, "plan.md");

  // Check plan exists
  if (!existsSync(planFile)) {
    if (json) {
      console.log(JSON.stringify({ error: "no-plan", feature }));
    } else {
      console.error(`No plan found at plans/${feature}/plan.md`);
      console.error(`Run 'forge plan ${feature}' first.`);
    }
    process.exit(1);
  }

  // Check bd CLI
  const bdAvailable = await isBdAvailable();
  if (!bdAvailable) {
    if (json) {
      console.log(JSON.stringify({ error: "no-bd" }));
    } else {
      console.error("bd CLI not found. Install beads: https://github.com/steveyegge/beads");
    }
    process.exit(1);
  }

  // Check for existing epic
  const epic = await queryBeadsEpic(feature);
  if (epic) {
    if (json) {
      console.log(
        JSON.stringify({
          status: "exists",
          epic: epic.epicId,
          tasks: epic.totalTasks,
          closed: epic.closedTasks,
        })
      );
    } else {
      console.log(`Epic already exists: ${epic.epicId} — ${epic.title}`);
      console.log(`Tasks: ${epic.closedTasks}/${epic.totalTasks} closed`);
      console.log(`\nRun 'bd ready' to see unblocked work.`);
    }
    return;
  }

  // Count phases in plan
  const planContent = readFileSync(planFile, "utf-8");
  const phaseCount = (planContent.match(/^## Phase \d+/gm) || []).length;

  if (json) {
    console.log(
      JSON.stringify({
        status: "ready",
        feature,
        plan: planFile,
        phases: phaseCount,
      })
    );
  } else {
    console.log(`Ready to decompose: plans/${feature}/plan.md`);
    console.log(`Phases found: ${phaseCount}`);
    console.log(`\nThe agent will create a beads epic with child tasks.`);
  }
}
