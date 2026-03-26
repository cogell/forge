/**
 * forge status [feature]
 *
 * Detect pipeline state and suggest next steps.
 * With no args: show all features.
 * With feature name: show that feature's state.
 */

import { detectPipeline, detectFeature } from "../lib/pipeline";
import { formatPipelineStatus, formatFeatureStatus } from "../lib/format";
import { getReadyTasks } from "../lib/beads";

export async function status(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const feature = args.find((a) => !a.startsWith("-"));
  const cwd = process.cwd();

  const readyTasks = await getReadyTasks();

  if (feature) {
    const state = await detectFeature(cwd, feature);
    console.log(formatFeatureStatus(state, readyTasks, json));
  } else {
    const state = await detectPipeline(cwd);
    console.log(formatPipelineStatus(state, readyTasks, json));
  }
}
