/**
 * forge status [feature]
 *
 * Detect pipeline state and suggest next steps.
 * With no args: show all features.
 * With feature name: show that feature's state.
 */

import { detectPipeline, detectFeature } from "../lib/pipeline";
import { formatPipelineStatus, formatFeatureStatus } from "../lib/format";
import { getReadyTasks } from "../lib/tasks";

export async function status(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const feature = args.find((a) => !a.startsWith("-"));
  const cwd = process.cwd();

  if (feature) {
    const state = detectFeature(cwd, feature);
    const readyTasks = getReadyTasks(cwd, feature);
    console.log(formatFeatureStatus(state, readyTasks, json));
  } else {
    const state = detectPipeline(cwd);
    const readyTasks = getReadyTasks(cwd);
    console.log(formatPipelineStatus(state, readyTasks, json));
  }
}
