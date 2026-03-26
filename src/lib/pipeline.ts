/**
 * Pipeline state machine.
 * Reads the filesystem + beads state to determine where a feature stands.
 */

import { existsSync } from "fs";
import { join } from "path";
import { readPlans, readFeaturePlan, type PlanInfo } from "./plans";
import { queryBeadsEpic, type EpicInfo } from "./beads";

export type Stage =
  | "no-project"     // No plans/ or docs/ dirs
  | "needs-brainstorm"
  | "needs-prd"
  | "needs-plan"
  | "needs-tasks"
  | "in-progress"
  | "needs-reflection"
  | "needs-graduation"
  | "complete";

export interface FeatureState {
  feature: string;
  stage: Stage;
  plan: PlanInfo;
  epic: EpicInfo | null;
  nextAction: string;
}

export interface PipelineState {
  hasProject: boolean;  // plans/ and docs/ exist
  features: FeatureState[];
}

export async function detectPipeline(cwd: string): Promise<PipelineState> {
  const plansDir = join(cwd, "plans");
  const docsDir = join(cwd, "docs");

  const hasProject = existsSync(plansDir) && existsSync(docsDir);

  if (!hasProject) {
    return { hasProject: false, features: [] };
  }

  const plans = readPlans(plansDir);
  const features: FeatureState[] = [];

  for (const plan of plans) {
    const epic = await queryBeadsEpic(plan.feature, cwd);
    const stage = determineStage(plan, epic);

    features.push({
      feature: plan.feature,
      stage,
      plan,
      epic,
      nextAction: suggestAction(plan.feature, stage),
    });
  }

  return { hasProject, features };
}

export async function detectFeature(cwd: string, feature: string): Promise<FeatureState> {
  const planDir = join(cwd, "plans", feature);
  const plan = readFeaturePlan(planDir, feature);
  const epic = await queryBeadsEpic(feature, cwd);
  const stage = determineStage(plan, epic);

  return {
    feature,
    stage,
    plan,
    epic,
    nextAction: suggestAction(feature, stage),
  };
}

function determineStage(plan: PlanInfo, epic: EpicInfo | null): Stage {
  if (!plan.hasBrainstorm && !plan.hasPrd) return "needs-brainstorm";
  if (plan.hasBrainstorm && !plan.hasPrd) return "needs-prd";
  if (!plan.hasPlan) return "needs-plan";
  if (!epic) return "needs-tasks";

  if (plan.status === "completed") return "complete";

  if (epic.allClosed && !plan.hasReflections) return "needs-reflection";
  if (epic.allClosed) return "needs-graduation";
  return "in-progress";
}

function suggestAction(feature: string, stage: Stage): string {
  switch (stage) {
    case "no-project":
      return "forge init";
    case "needs-brainstorm":
      return `forge brainstorm ${feature}`;
    case "needs-prd":
      return `forge prd ${feature}`;
    case "needs-plan":
      return `forge plan ${feature}`;
    case "needs-tasks":
      return `forge tasks ${feature}`;
    case "in-progress":
      return `bd ready`;
    case "needs-reflection":
      return `Write plans/${feature}/reflections.md`;
    case "needs-graduation":
      return `forge docs --ship ${feature}`;
    case "complete":
      return "—";
  }
}
