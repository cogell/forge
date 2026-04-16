/**
 * Read-only task queries: feature stats and ready task computation.
 */

import { join } from "path";
import { resolveRepoRoot } from "../worktree";
import type { EpicInfo, ReadyTask, Task, TaskStatus } from "./types";
import { TASKS_FILENAME } from "./types";
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
