/**
 * Output formatting for terminal and JSON modes.
 * Uses raw ANSI escapes — zero dependencies.
 */

import type { FeatureState, PipelineState, Stage } from "./pipeline";
import type { ReadyTask } from "./beads";

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
    case "needs-graduation":
      return c.magenta;
    case "needs-tasks":
    case "needs-plan":
    case "needs-prd":
      return c.yellow;
    case "needs-brainstorm":
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
  "needs-brainstorm": "Needs brainstorm",
  "needs-prd": "Needs PRD",
  "needs-plan": "Needs plan",
  "needs-tasks": "Needs tasks",
  "in-progress": "In progress",
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
      `Run: ${c.bold}forge brainstorm <feature-name>${c.reset}`,
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
