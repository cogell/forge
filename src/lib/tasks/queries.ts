/**
 * Read-only task queries: feature stats and ready task computation.
 */

import { join } from "path";
import { resolveRepoRoot } from "../worktree";
import type { EpicInfo, ReadyTask, Task, TaskStatus } from "./types";
import { GATE_LABEL_HUMAN, PHASE_LABEL_PREFIX, TASKS_FILENAME } from "./types";
import { discoverTaskFilesFromRoot, readTasksFile, validateFeatureName } from "./io";

/**
 * Query task stats for a feature's tasks.json.
 *
 * Reads plans/<feature>/tasks.json, aggregates task status counts across
 * all epics, and returns an EpicInfo summary.
 *
 * Returns null when the file is missing or has no tasks (empty scaffold).
 */
export function queryFeatureTasks(feature: string, cwd?: string): EpicInfo | null {
  validateFeatureName(feature);
  const root = resolveRepoRoot(cwd);
  const filePath = join(root, "plans", feature, TASKS_FILENAME);
  const file = readTasksFile(filePath);

  if (!file) return null;
  if (file.tasks.length === 0) return null;

  const epics = file.epics.map((e) => ({ id: e.id, title: e.title }));
  const primaryEpicId = epics[0]?.id ?? "";

  let closedTasks = 0;
  let openTasks = 0;
  let inProgressTasks = 0;

  for (const task of file.tasks) {
    switch (task.status) {
      case "closed":
        closedTasks++;
        break;
      case "open":
        openTasks++;
        break;
      case "in_progress":
        inProgressTasks++;
        break;
    }
  }

  const totalTasks = file.tasks.length;

  // allClosed requires: all tasks closed AND every epic has at least 1 task
  let allClosed = totalTasks > 0 && closedTasks === totalTasks;
  if (allClosed && file.epics.length > 0) {
    const epicsWithTasks = new Set<string>();
    for (const task of file.tasks) {
      for (const epic of file.epics) {
        if (task.id.startsWith(epic.id + ".")) {
          epicsWithTasks.add(epic.id);
        }
      }
    }
    for (const epic of file.epics) {
      if (!epicsWithTasks.has(epic.id)) {
        allClosed = false;
        break;
      }
    }
  }

  return {
    epics,
    primaryEpicId,
    totalTasks,
    closedTasks,
    openTasks,
    inProgressTasks,
    allClosed,
  };
}

/**
 * Options for filtering ready tasks.
 */
export interface GetReadyTasksOptions {
  /** Require each listed label to be present on the task (AND semantics). */
  labels?: string[];
}

/**
 * Get ready (unblocked) leaf tasks.
 *
 * A task is "ready" when:
 *   1. It is a leaf task (no other task's ID starts with this task's ID + ".")
 *   2. Its status is "open"
 *   3. All its dependencies are "closed" or "in_progress"
 *
 * When `feature` is provided, only tasks from that feature's tasks.json
 * are returned, but ALL task files are loaded to resolve cross-file
 * dependency statuses.
 *
 * When `opts.labels` is provided and non-empty, the result is further
 * filtered to tasks whose `labels[]` contains ALL of the listed labels.
 */
export function getReadyTasks(
  cwd?: string,
  feature?: string,
  opts?: GetReadyTasksOptions,
): ReadyTask[] {
  const root = resolveRepoRoot(cwd);

  const allFiles = discoverTaskFilesFromRoot(root);
  const allTasks: Task[] = [];
  const tasksByFile = new Map<string, Task[]>();

  for (const filePath of allFiles) {
    const file = readTasksFile(filePath);
    if (file) {
      allTasks.push(...file.tasks);
      tasksByFile.set(filePath, file.tasks);
    }
  }

  const statusMap = new Map<string, TaskStatus>();
  for (const task of allTasks) {
    statusMap.set(task.id, task.status);
  }

  // Build container set: a task is a container if any other task's ID
  // starts with its ID + "." (meaning it has children).
  const allIds = new Set(allTasks.map((t) => t.id));
  const containerSet = new Set<string>();
  for (const id of allIds) {
    // Walk up the ID to mark all ancestors as containers.
    // e.g., FORGE-1.2.3 marks FORGE-1.2 and FORGE-1 (if they exist as tasks)
    const dashIdx = id.indexOf("-");
    if (dashIdx === -1) continue;
    const parts = id.substring(dashIdx + 1).split(".");
    const prefix = id.substring(0, dashIdx);
    for (let i = 1; i < parts.length; i++) {
      const ancestorId = `${prefix}-${parts.slice(0, i).join(".")}`;
      if (allIds.has(ancestorId)) containerSet.add(ancestorId);
    }
  }

  let candidateTasks: Task[];
  if (feature) {
    const featurePath = join(root, "plans", feature, TASKS_FILENAME);
    candidateTasks = tasksByFile.get(featurePath) ?? [];
  } else {
    candidateTasks = allTasks;
  }

  const ready: ReadyTask[] = [];

  const requiredLabels = opts?.labels ?? [];

  for (const task of candidateTasks) {
    if (containerSet.has(task.id)) continue;
    if (task.status !== "open") continue;

    let allDepsReady = true;
    for (const depId of task.dependencies) {
      const depStatus = statusMap.get(depId);
      if (depStatus !== "closed" && depStatus !== "in_progress") {
        allDepsReady = false;
        break;
      }
    }
    if (!allDepsReady) continue;

    if (requiredLabels.length > 0) {
      let hasAllLabels = true;
      for (const label of requiredLabels) {
        if (!task.labels.includes(label)) {
          hasAllLabels = false;
          break;
        }
      }
      if (!hasAllLabels) continue;
    }

    ready.push({
      id: task.id,
      title: task.title,
      priority: task.priority,
      labels: task.labels,
      gated: task.labels.includes(GATE_LABEL_HUMAN),
    });
  }

  // Sort by priority ascending (0 = highest priority)
  ready.sort((a, b) => a.priority - b.priority);

  return ready;
}

/**
 * Get descendant tasks of a parent, by ID-prefix walk.
 *
 * Direction: parent DOWN (inverse of the container-detection logic in
 * getReadyTasks, which walks leaves UP). We iterate all tasks across all
 * feature files and pick those whose id starts with `${parentId}.`.
 *
 * - scope 'direct': only tasks exactly one dot-level below the parent.
 *   e.g., parentId='FORGE-3' matches 'FORGE-3.1' but NOT 'FORGE-3.1.1'.
 * - scope 'all': every descendant at any depth.
 *
 * Result is sorted by id ascending for deterministic output.
 */
export function getDescendants(
  parentId: string,
  scope: "direct" | "all",
  cwd?: string,
): Task[] {
  const root = resolveRepoRoot(cwd);
  const allFiles = discoverTaskFilesFromRoot(root);
  const allTasks: Task[] = [];
  for (const filePath of allFiles) {
    const file = readTasksFile(filePath);
    if (file) allTasks.push(...file.tasks);
  }

  const prefix = `${parentId}.`;
  const matches: Task[] = [];

  for (const task of allTasks) {
    if (!task.id.startsWith(prefix)) continue;
    if (scope === "direct") {
      // Suffix after parent prefix must have no internal dots (i.e. is the
      // direct child segment, not a deeper descendant).
      const suffix = task.id.slice(prefix.length);
      if (suffix.includes(".")) continue;
    }
    matches.push(task);
  }

  matches.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return matches;
}

/**
 * Auto-detect the lowest phase number with open work for a feature.
 *
 * Scans tasks in plans/<feature>/tasks.json that carry a label of the form
 * `${PHASE_LABEL_PREFIX}${N}` (with N a parseable integer). For each phase N
 * (ascending):
 *   - If any task is `in_progress` → halt with a diagnostic instructing the
 *     caller to resume explicitly via `--phase N`.
 *   - Else if any task is `open` → return that phase.
 *   - Else continue.
 *
 * Returns:
 *   - `{ phase: N, diagnostic: null }` when phase N has open work and no
 *     in_progress tasks.
 *   - `{ phase: null, diagnostic: <halt-message> }` when the lowest
 *     non-closed phase has in_progress tasks.
 *   - `{ phase: null, diagnostic: 'all phases closed for this feature' }`
 *     when every phase task is closed (or the feature has zero tasks).
 *   - `{ phase: null, diagnostic: 'no phase labels found ...' }` when tasks
 *     exist but none carry a parseable `phase:N` label — typically a
 *     malformed-labels symptom (e.g. one task with `["complexity:3,phase:1"]`
 *     instead of two separate labels).
 *   - `{ phase: null, diagnostic: 'no tasks.json found for feature' }`
 *     when the feature directory / tasks.json is missing — distinct from
 *     exhaustion so callers can disambiguate.
 *
 * Tasks with no `phase:*` label are ignored entirely. A task carrying
 * multiple `phase:N` labels participates in each phase's set independently.
 *
 * Label parsing: values are parsed via `parseInt(N, 10)`. Unparseable or
 * empty values (e.g., `phase:`, `phase:abc`) are discarded. `phase:01` → 1.
 */
export function nextOpenPhase(
  feature: string,
  cwd?: string,
): { phase: number | null; diagnostic: string | null } {
  validateFeatureName(feature);
  const root = resolveRepoRoot(cwd);
  const filePath = join(root, "plans", feature, TASKS_FILENAME);
  const file = readTasksFile(filePath);

  if (!file) {
    return { phase: null, diagnostic: "no tasks.json found for feature" };
  }

  // For each phase number, collect statuses of tasks bearing that label.
  // A task with multiple phase:N labels participates in each set.
  const phaseStatuses = new Map<number, TaskStatus[]>();

  for (const task of file.tasks) {
    for (const label of task.labels) {
      if (!label.startsWith(PHASE_LABEL_PREFIX)) continue;
      const value = label.slice(PHASE_LABEL_PREFIX.length);
      if (value.length === 0) continue;
      const parsed = parseInt(value, 10);
      if (Number.isNaN(parsed)) continue;
      const list = phaseStatuses.get(parsed);
      if (list) {
        list.push(task.status);
      } else {
        phaseStatuses.set(parsed, [task.status]);
      }
    }
  }

  const phases = Array.from(phaseStatuses.keys()).sort((a, b) => a - b);

  if (phases.length === 0 && file.tasks.length > 0) {
    return {
      phase: null,
      diagnostic:
        `no phase labels found on any of ${file.tasks.length} task(s) — check tasks.json label format ` +
        `(use separate -l flags: -l "phase:1" -l "complexity:3", not -l "phase:1,complexity:3")`,
    };
  }

  for (const n of phases) {
    const statuses = phaseStatuses.get(n)!;
    if (statuses.some((s) => s === "in_progress")) {
      return {
        phase: null,
        diagnostic: `phase ${n} has in-progress tasks — resume explicitly via --phase ${n} or close them first`,
      };
    }
    if (statuses.some((s) => s === "open")) {
      return { phase: n, diagnostic: null };
    }
    // else: all closed → continue
  }

  return { phase: null, diagnostic: "all phases closed for this feature" };
}
