/**
 * forge reflect <feature>
 *
 * Check state for reflection: are there closed beads to reflect on?
 * Reports what's available. The agent handles the actual reflection.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { queryBeadsEpic } from "../lib/beads";

export async function reflect(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const feature = args.find((a) => !a.startsWith("-"));

  if (!feature) {
    console.error("Usage: forge reflect <feature-name>");
    process.exit(1);
  }

  const cwd = process.cwd();
  const planDir = join(cwd, "plans", feature);
  const reflectionsFile = join(planDir, "reflections.md");

  const state = {
    feature,
    planExists: existsSync(planDir),
    hasReflections: existsSync(reflectionsFile),
    existingPhases: 0,
    epic: null as { totalTasks: number; closedTasks: number } | null,
  };

  if (!state.planExists) {
    if (json) console.log(JSON.stringify({ error: "no-plan", feature }));
    else console.error(`No plan found at plans/${feature}/. Nothing to reflect on.`);
    process.exit(1);
  }

  // Count existing reflection phases
  if (state.hasReflections) {
    const content = readFileSync(reflectionsFile, "utf-8");
    const phases = content.match(/^## Phase \d+/gm);
    state.existingPhases = phases ? phases.length : 0;
  }

  // Check beads for closed tasks to reflect on
  const epic = await queryBeadsEpic(feature);
  if (epic) {
    state.epic = { totalTasks: epic.totalTasks, closedTasks: epic.closedTasks };
  }

  if (json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  console.log(`Feature: ${feature}`);
  console.log(`Plan:    plans/${feature}/`);
  if (state.hasReflections) {
    console.log(`Reflect: plans/${feature}/reflections.md (${state.existingPhases} phase${state.existingPhases !== 1 ? "s" : ""})`);
  } else {
    console.log(`Reflect: (none yet — will create reflections.md)`);
  }
  if (state.epic) {
    console.log(`Tasks:   ${state.epic.closedTasks}/${state.epic.totalTasks} closed`);
  }
  console.log();
  console.log("Ready for reflection. The agent will:");
  console.log("  1. Review closed beads and implementation work");
  console.log("  2. Identify platform gotchas, debugging discoveries,");
  console.log("     validated patterns, and process improvements");
  console.log(`  3. Append to plans/${feature}/reflections.md`);
}
