/**
 * Output formatting for terminal and JSON modes.
 * Uses raw ANSI escapes — zero dependencies.
 */

import type { FeatureState, PipelineState, Stage } from "./pipeline";
import type { ReadyTask } from "./tasks";
import type { ProjectState } from "../commands/global";

// ── ANSI helpers ──────────────────────────────────────────

const USE_COLOR =
  (process.stdout.isTTY || !!process.env.FORCE_COLOR) && !process.env.NO_COLOR;

const c = {
  reset: USE_COLOR ? "\x1b[0m" : "",
  bold: USE_COLOR ? "\x1b[1m" : "",
  dim: USE_COLOR ? "\x1b[2m" : "",
  green: USE_COLOR ? "\x1b[32m" : "",
  yellow: USE_COLOR ? "\x1b[33m" : "",
  cyan: USE_COLOR ? "\x1b[36m" : "",
  magenta: USE_COLOR ? "\x1b[35m" : "",
};

function stageColor(stage: Stage): string {
  switch (stage) {
    case "complete":
      return c.green;
    case "in-progress":
      return c.cyan;
    case "needs-reflection":
      return c.magenta;
    case "needs-graduation":
      return c.magenta;
    case "needs-tasks":
    case "needs-plan":
    case "needs-prd":
      return c.yellow;
    case "no-project":
      return c.dim;
  }
}

function progressBar(done: number, total: number, width = 10): string {
  if (total === 0) return c.dim + "\u2591".repeat(width) + c.reset;
  const filled = Math.round((done / total) * width);
  const color = done === total ? c.green : c.cyan;
  return (
    color +
    "\u2588".repeat(filled) +
    c.dim +
    "\u2591".repeat(width - filled) +
    c.reset
  );
}

// ── Stage labels ──────────────────────────────────────────

const STAGE_LABELS: Record<Stage, string> = {
  "no-project": "No project",
  "needs-prd": "Needs PRD",
  "needs-plan": "Needs plan",
  "needs-tasks": "Needs tasks",
  "in-progress": "In progress",
  "needs-reflection": "Needs reflection",
  "needs-graduation": "Needs graduation",
  complete: "Complete",
};

// ── Pipeline status (all features) ───────────────────────

export function formatPipelineStatus(
  state: PipelineState,
  readyTasks: ReadyTask[],
  json: boolean
): string {
  if (json) return JSON.stringify({ ...state, readyTasks }, null, 2);

  if (!state.hasProject) {
    return [
      `${c.dim}No forge project detected (missing plans/ or docs/).${c.reset}`,
      "",
      `Run: ${c.bold}forge init${c.reset}`,
    ].join("\n");
  }

  if (state.features.length === 0) {
    return [
      `${c.dim}Project initialized but no features found in plans/.${c.reset}`,
      "",
      `Run: ${c.bold}forge prd <feature-name>${c.reset}`,
    ].join("\n");
  }

  const n = state.features.length;
  const lines: string[] = [
    `${c.bold}forge${c.reset} ${c.dim}\u00b7${c.reset} ${n} feature${n !== 1 ? "s" : ""}`,
    "",
  ];

  const nameWidth = Math.max(
    ...state.features.map((f) => f.feature.length),
    16
  );

  for (const f of state.features) {
    lines.push(formatFeatureLine(f, nameWidth));
  }

  if (readyTasks.length > 0) {
    lines.push("");
    lines.push(
      `${c.bold}Ready tasks${c.reset} ${c.dim}(${readyTasks.length})${c.reset}`
    );
    for (const t of readyTasks) {
      const prio =
        t.priority != null ? `  ${c.yellow}P${t.priority}${c.reset}` : "";
      const labels = t.labels?.length
        ? `  ${c.dim}${t.labels.join(" ")}${c.reset}`
        : "";
      lines.push(
        `  ${c.dim}${t.id}${c.reset}  ${t.title}${prio}${labels}`
      );
    }
  }

  return lines.join("\n");
}

// ── Feature status (single feature) ─────────────────────

export function formatFeatureStatus(
  state: FeatureState,
  readyTasks: ReadyTask[],
  json: boolean
): string {
  if (json) return JSON.stringify({ ...state, readyTasks }, null, 2);

  const sc = stageColor(state.stage);
  const lines: string[] = [
    `${c.bold}${state.feature}${c.reset}`,
    `${sc}${STAGE_LABELS[state.stage]}${c.reset}`,
  ];

  if (state.epic) {
    const e = state.epic;
    const bar = progressBar(e.closedTasks, e.totalTasks);
    lines.push("");
    lines.push(`${bar}  ${e.closedTasks}/${e.totalTasks} tasks`);

    const parts: string[] = [];
    if (e.inProgressTasks > 0) parts.push(`${e.inProgressTasks} in progress`);
    if (e.openTasks > 0) parts.push(`${e.openTasks} open`);
    if (parts.length > 0) {
      lines.push(`${c.dim}${parts.join(", ")}${c.reset}`);
    }
  }

  if (readyTasks.length > 0) {
    lines.push("");
    lines.push(
      `${c.bold}Ready tasks${c.reset} ${c.dim}(${readyTasks.length})${c.reset}`
    );
    for (const t of readyTasks) {
      const prio =
        t.priority != null ? `  ${c.yellow}P${t.priority}${c.reset}` : "";
      const labels = t.labels?.length
        ? `  ${c.dim}${t.labels.join(" ")}${c.reset}`
        : "";
      lines.push(
        `  ${c.dim}${t.id}${c.reset}  ${t.title}${prio}${labels}`
      );
    }
  }

  if (state.stage !== "complete") {
    lines.push("");
    lines.push(
      `${c.dim}Next:${c.reset} ${c.bold}${state.nextAction}${c.reset}`
    );
  }

  return lines.join("\n");
}

// ── Global status (all projects) ─────────────────────────

export function formatGlobalStatus(
  projects: ProjectState[],
  root: string,
  json: boolean
): string {
  if (json) return JSON.stringify({ root, projects }, null, 2);

  const totalProjects = projects.length;
  const totalFeatures = projects.reduce(
    (sum, p) => sum + p.pipeline.features.length,
    0
  );

  const lines: string[] = [
    `${c.bold}forge global${c.reset} ${c.dim}\u00b7${c.reset} ${totalProjects} project${totalProjects !== 1 ? "s" : ""}, ${totalFeatures} feature${totalFeatures !== 1 ? "s" : ""}`,
    `${c.dim}${root}${c.reset}`,
    "",
  ];

  for (const project of projects) {
    const featureCount = project.pipeline.features.length;
    const header = `${c.bold}${project.name}${c.reset} ${c.dim}(${featureCount} feature${featureCount !== 1 ? "s" : ""})${c.reset}`;
    lines.push(header);

    if (featureCount === 0) {
      lines.push(`  ${c.dim}No features in plans/${c.reset}`);
    } else {
      const nameWidth = Math.max(
        ...project.pipeline.features.map((f) => f.feature.length),
        12
      );

      for (const f of project.pipeline.features) {
        lines.push(formatFeatureLine(f, nameWidth));
      }
    }

    lines.push("");
  }

  // Aggregate summary
  const stageCounts: Partial<Record<Stage, number>> = {};
  for (const p of projects) {
    for (const f of p.pipeline.features) {
      stageCounts[f.stage] = (stageCounts[f.stage] || 0) + 1;
    }
  }

  if (totalFeatures > 0) {
    const summary = Object.entries(stageCounts)
      .map(([stage, count]) => {
        const sc = stageColor(stage as Stage);
        return `${sc}${count} ${STAGE_LABELS[stage as Stage].toLowerCase()}${c.reset}`;
      })
      .join(`${c.dim}, ${c.reset}`);

    lines.push(`${c.dim}\u2500\u2500\u2500${c.reset}`);
    lines.push(summary);
  }

  return lines.join("\n");
}

// ── Helpers ──────────────────────────────────────────────

function formatFeatureLine(f: FeatureState, nameWidth: number): string {
  const sc = stageColor(f.stage);
  const name = f.feature.padEnd(nameWidth);
  const label = STAGE_LABELS[f.stage];

  if (f.epic) {
    const bar = progressBar(f.epic.closedTasks, f.epic.totalTasks);
    const count = `${f.epic.closedTasks}/${f.epic.totalTasks}`;
    return `  ${c.bold}${name}${c.reset}  ${sc}${label.padEnd(18)}${c.reset} ${bar}  ${count}`;
  }

  const action = `${c.dim}\u2192 ${f.nextAction}${c.reset}`;
  return `  ${c.bold}${name}${c.reset}  ${sc}${label.padEnd(18)}${c.reset} ${action}`;
}
