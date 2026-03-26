/**
 * forge docs [--phase|--ship] [feature]
 *
 * Documentation lifecycle management.
 *   forge docs              → health check (read-only scan)
 *   forge docs --phase feat → phase-complete graduation
 *   forge docs --ship feat  → full ship graduation
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

interface DocsReport {
  mode: "health" | "phase" | "ship";
  feature?: string;
  structure: CheckResult[];
  staleness: CheckResult[];
  completeness: CheckResult[];
}

interface CheckResult {
  check: string;
  ok: boolean;
  detail?: string;
}

export async function docs(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const phase = args.includes("--phase");
  const ship = args.includes("--ship");
  const feature = args.find((a) => !a.startsWith("-"));

  const cwd = process.cwd();

  if (phase || ship) {
    if (!feature) {
      console.error(`Usage: forge docs ${phase ? "--phase" : "--ship"} <feature>`);
      process.exit(1);
    }
  }

  const mode = ship ? "ship" : phase ? "phase" : "health";
  const report = await buildReport(cwd, mode, feature);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report);
}

async function buildReport(
  cwd: string,
  mode: "health" | "phase" | "ship",
  feature?: string
): Promise<DocsReport> {
  const docsDir = join(cwd, "docs");
  const plansDir = join(cwd, "plans");

  const structure: CheckResult[] = [
    {
      check: "docs/ exists",
      ok: existsSync(docsDir),
    },
    {
      check: "docs/decisions/ exists",
      ok: existsSync(join(docsDir, "decisions")),
    },
    {
      check: "plans/ exists",
      ok: existsSync(plansDir),
    },
    {
      check: "plans/_template/ exists",
      ok: existsSync(join(plansDir, "_template")),
    },
  ];

  const readme = join(cwd, "README.md");
  if (existsSync(readme)) {
    const lines = readFileSync(readme, "utf-8").split("\n").length;
    structure.push({
      check: "README.md under 200 lines",
      ok: lines <= 200,
      detail: `${lines} lines`,
    });
  }

  const staleness: CheckResult[] = [];
  const completeness: CheckResult[] = [];

  // Check active plans
  if (existsSync(plansDir)) {
    const entries = readdirSync(plansDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith("."))
        continue;

      const planDir = join(plansDir, entry.name);
      const hasPrd = existsSync(join(planDir, "prd.md"));
      const hasPlan = existsSync(join(planDir, "plan.md"));

      completeness.push({
        check: `plans/${entry.name}/ has prd.md`,
        ok: hasPrd,
      });

      if (hasPrd) {
        completeness.push({
          check: `plans/${entry.name}/ has plan.md`,
          ok: hasPlan,
        });
      }

      if (hasPlan) {
        const hasReflections = existsSync(join(planDir, "reflections.md"));
        completeness.push({
          check: `plans/${entry.name}/ has reflections.md`,
          ok: hasReflections,
          detail: hasReflections
            ? "exists"
            : "missing — write reflections before graduation",
        });
      }
    }
  }

  if (mode === "ship" && feature) {
    const planDir = join(plansDir, feature);
    const hasReflections = existsSync(join(planDir, "reflections.md"));
    completeness.push({
      check: `plans/${feature}/reflections.md reviewed for graduation`,
      ok: hasReflections,
      detail: hasReflections
        ? "exists — review for graduation"
        : "missing — required before ship",
    });
  }

  return { mode, feature, structure, staleness, completeness };
}

function printReport(report: DocsReport): void {
  const modeLabel =
    report.mode === "health"
      ? "Health Check"
      : report.mode === "phase"
        ? `Phase Graduation: ${report.feature}`
        : `Ship Graduation: ${report.feature}`;

  console.log(`Docs ${modeLabel}\n`);

  printSection("Structure", report.structure);
  if (report.staleness.length > 0) printSection("Staleness", report.staleness);
  printSection("Completeness", report.completeness);
}

function printSection(title: string, checks: CheckResult[]): void {
  console.log(`${title}:`);
  for (const c of checks) {
    const icon = c.ok ? "  ok" : "  !!";
    const detail = c.detail ? ` (${c.detail})` : "";
    console.log(`  ${icon}  ${c.check}${detail}`);
  }
  console.log();
}
