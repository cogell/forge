/**
 * Read and parse plans/ directory structure.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import matter from "gray-matter";

export interface PlanInfo {
  feature: string;
  hasBrainstorm: boolean;
  hasPrd: boolean;
  hasPlan: boolean;
  hasReflections: boolean;
  status: string;
  planDir: string;
}

/**
 * Read a single feature's plan info from its directory.
 */
export function readFeaturePlan(planDir: string, feature: string): PlanInfo {
  const hasBrainstorm = existsSync(join(planDir, "brainstorm.md"));
  const hasPrd = existsSync(join(planDir, "prd.md"));
  const hasPlan = existsSync(join(planDir, "plan.md"));
  const hasReflections = existsSync(join(planDir, "reflections.md"));

  let status = "unknown";
  if (hasPrd) {
    try {
      const content = readFileSync(join(planDir, "prd.md"), "utf-8");
      const parsed = matter(content);
      status = (parsed.data.status as string) || "active";
    } catch {
      status = "active";
    }
  }

  return { feature, hasBrainstorm, hasPrd, hasPlan, hasReflections, status, planDir };
}

/**
 * Read all feature plans from the plans/ directory.
 */
export function readPlans(plansDir: string): PlanInfo[] {
  if (!existsSync(plansDir)) return [];

  const entries = readdirSync(plansDir, { withFileTypes: true });
  const plans: PlanInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;

    plans.push(readFeaturePlan(join(plansDir, entry.name), entry.name));
  }

  return plans;
}
