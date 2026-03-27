/**
 * forge retro <feature>
 *
 * Check state for a retro: does the feature have a PR, reflections, etc.
 * The agent handles the actual root cause analysis and system fixes.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

export async function retro(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const feature = args.find((a) => !a.startsWith("-"));

  if (!feature) {
    console.error("Usage: forge retro <feature-name>");
    process.exit(1);
  }

  const cwd = process.cwd();
  const planDir = join(cwd, "plans", feature);
  const retroFile = join(planDir, "retro.md");
  const reflectionsFile = join(planDir, "reflections.md");

  const state = {
    feature,
    planExists: existsSync(planDir),
    hasRetro: existsSync(retroFile),
    hasReflections: existsSync(reflectionsFile),
    retroRounds: 0,
    prNumber: null as string | null,
  };

  if (!state.planExists) {
    if (json) console.log(JSON.stringify({ error: "no-plan", feature }));
    else console.error(`No plan found at plans/${feature}/. Nothing to retro.`);
    process.exit(1);
  }

  // Count existing retro rounds
  if (state.hasRetro) {
    const content = readFileSync(retroFile, "utf-8");
    const rounds = content.match(/^## Round \d+/gm);
    state.retroRounds = rounds ? rounds.length : 0;
  }

  // Try to find an open PR for this feature
  try {
    const proc = Bun.spawn(
      ["gh", "pr", "list", "--head", `feat/${feature}`, "--json", "number,url,state", "--jq", ".[0].number"],
      { stdout: "pipe", stderr: "pipe" }
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    if (stdout.trim()) state.prNumber = stdout.trim();
  } catch {
    // gh not available or no PR — fine
  }

  if (json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  console.log(`Feature: ${feature}`);
  console.log(`Plan:    plans/${feature}/`);
  if (state.prNumber) console.log(`PR:      #${state.prNumber}`);
  if (state.hasRetro) {
    console.log(`Retro:   plans/${feature}/retro.md (${state.retroRounds} round${state.retroRounds !== 1 ? "s" : ""})`);
  } else {
    console.log(`Retro:   (none yet — this will be round 1)`);
  }
  console.log();
  console.log("Ready for root cause analysis. The agent will:");
  console.log("  1. Gather PR review feedback");
  console.log("  2. Classify each issue by root cause");
  console.log("  3. Propose and apply system fixes");
  console.log(`  4. Append to plans/${feature}/retro.md`);
}
