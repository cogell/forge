/**
 * DAG validation: cycle detection, orphan references, duplicate IDs.
 */

import { join } from "path";
import { resolveRepoRoot } from "../worktree";
import type { Epic, Task, ValidationError, ValidationResult, ValidateScope } from "./types";
import { TASKS_FILENAME } from "./types";
import { discoverTaskFilesFromRoot, idDepth, readTasksFile } from "./io";

/**
 * Validate the task DAG for a feature, project-level tasks, or everything.
 *
 * When scoped to a feature, validates only that feature's tasks.json but
 * still loads all files for cross-file dependency resolution.
 */
export function validateDag(scope: ValidateScope, cwd?: string): ValidationResult {
  const root = resolveRepoRoot(cwd);
  const allFiles = discoverTaskFilesFromRoot(root);
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const info: ValidationError[] = [];

  // Determine which files to validate vs which are context-only
  let targetFiles: string[];
  switch (scope.kind) {
    case "project": {
      const projectPath = join(root, "plans", TASKS_FILENAME);
      targetFiles = allFiles.filter((f) => f === projectPath);
      if (targetFiles.length === 0) {
        errors.push({ type: "orphan-dep", severity: "error", message: "No project-level tasks.json found at plans/tasks.json", ids: [] });
        return { valid: false, errors, warnings, info };
      }
      break;
    }
    case "feature": {
      const featurePath = join(root, "plans", scope.name, TASKS_FILENAME);
      targetFiles = allFiles.filter((f) => f === featurePath);
      if (targetFiles.length === 0) {
        errors.push({ type: "orphan-dep", severity: "error", message: `No tasks.json found for feature "${scope.name}"`, ids: [] });
        return { valid: false, errors, warnings, info };
      }
      break;
    }
    case "all":
      targetFiles = allFiles;
      break;
  }

  // Load files for cross-file resolution. Two passes:
  //   Pass 1 — target files: load errors surface as type-conformance + abort.
  //   Pass 2 — non-target files: load errors swallowed (those files are
  //            context-only; if malformed, the user runs validate against them).
  const allTasks: Task[] = [];
  const allEpics: Epic[] = [];
  const fileEpicsMap = new Map<string, Set<string>>();
  const fileTasksMap = new Map<string, Task[]>();
  const targetSet = new Set(targetFiles);

  // Pass 1: target files
  for (const filePath of targetFiles) {
    let data;
    try {
      data = readTasksFile(filePath);
    } catch (caught) {
      errors.push({
        type: "type-conformance",
        severity: "error",
        message: caught instanceof Error ? caught.message : String(caught),
        ids: [],
      });
      return { valid: false, errors, warnings, info };
    }
    if (!data) continue;
    allTasks.push(...data.tasks);
    allEpics.push(...data.epics);
    fileEpicsMap.set(filePath, new Set(data.epics.map((e) => e.id)));
    fileTasksMap.set(filePath, data.tasks);
  }

  // Pass 2: non-target files (silent on error)
  for (const filePath of allFiles) {
    if (targetSet.has(filePath)) continue;
    let data;
    try {
      data = readTasksFile(filePath);
    } catch {
      continue;
    }
    if (!data) continue;
    allTasks.push(...data.tasks);
    allEpics.push(...data.epics);
    fileEpicsMap.set(filePath, new Set(data.epics.map((e) => e.id)));
    fileTasksMap.set(filePath, data.tasks);
  }

  const taskIdSet = new Set(allTasks.map((t) => t.id));

  // Collect tasks and epics from target files only (for scoped validation)
  const targetTasks: Task[] = [];
  for (const fp of targetFiles) {
    targetTasks.push(...(fileTasksMap.get(fp) ?? []));
  }

  // 1. Duplicate IDs (across all files — always global)
  const seenIds = new Set<string>();
  const allIds = [...allTasks.map((t) => t.id), ...allEpics.map((e) => e.id)];
  for (const id of allIds) {
    if (seenIds.has(id)) {
      errors.push({ type: "duplicate-id", severity: "error", message: `Duplicate ID: ${id}`, ids: [id] });
    }
    seenIds.add(id);
  }

  // 2. Orphan dependency references (scoped to target tasks)
  for (const task of targetTasks) {
    for (const depId of task.dependencies) {
      if (!taskIdSet.has(depId)) {
        errors.push({ type: "orphan-dep", severity: "error", message: `Task ${task.id} depends on non-existent ${depId}`, ids: [task.id, depId] });
      }
    }
  }

  // 3. Orphan epic references (scoped to target files)
  for (const filePath of targetFiles) {
    const fileEpicIds = fileEpicsMap.get(filePath);
    if (!fileEpicIds) continue;
    for (const task of fileTasksMap.get(filePath) ?? []) {
      const dashIdx = task.id.indexOf("-");
      if (dashIdx === -1) continue;
      const numericPart = task.id.substring(dashIdx + 1);
      const epicNum = numericPart.split(".")[0];
      const prefix = task.id.substring(0, dashIdx);
      const epicId = `${prefix}-${epicNum}`;
      if (!fileEpicIds.has(epicId)) {
        errors.push({ type: "orphan-epic", severity: "error", message: `Task ${task.id} references non-existent epic ${epicId}`, ids: [task.id, epicId] });
      }
    }
  }

  // 4. Cycle detection (DFS with coloring — uses all tasks for cross-file cycles)
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const task of allTasks) color.set(task.id, WHITE);

  const depMap = new Map<string, string[]>();
  for (const task of allTasks) depMap.set(task.id, task.dependencies);

  // Deduplicate cycles by normalizing: rotate so the smallest ID is first
  const reportedCycles = new Set<string>();

  function normalizeCycle(cycle: string[]): string {
    let minIdx = 0;
    for (let i = 1; i < cycle.length; i++) {
      if (cycle[i] < cycle[minIdx]) minIdx = i;
    }
    return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)].join(" → ");
  }

  function dfs(id: string, path: string[]): void {
    color.set(id, GRAY);
    path.push(id);

    for (const depId of depMap.get(id) ?? []) {
      if (!color.has(depId)) continue;
      if (color.get(depId) === GRAY) {
        const cycleStart = path.indexOf(depId);
        const cycle = path.slice(cycleStart);
        const key = normalizeCycle(cycle);
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          errors.push({ type: "cycle", severity: "error", message: `Cycle detected: ${cycle.join(" → ")} → ${depId}`, ids: cycle });
        }
      } else if (color.get(depId) === WHITE) {
        dfs(depId, path);
      }
    }

    path.pop();
    color.set(id, BLACK);
  }

  for (const task of allTasks) {
    if (color.get(task.id) === WHITE) {
      dfs(task.id, []);
    }
  }

  // 5. Empty acceptance warning (FORGE-6.3): open tasks with no acceptance
  // criteria. Closed and in_progress tasks are exempt.
  for (const task of targetTasks) {
    if (task.status === "open" && task.acceptance.length === 0) {
      warnings.push({
        type: "empty-acceptance",
        severity: "warning",
        message: `Task ${task.id} has no acceptance criteria`,
        ids: [task.id],
      });
    }
  }

  // 6. Orphan-label info (FORGE-6.4): bare labels appearing on exactly one
  // task within a sibling group. Sibling = same immediate parent, derived by
  // dropping the last '.N' segment of the ID. Labels containing ':' are
  // prefix-namespaced metadata (phase:N, gate:human, complexity:N) and are
  // exempt. Tasks at depth ≤ 1 (epic-shaped IDs) have no sibling group and
  // are skipped entirely.
  const groupMap = new Map<string, Task[]>();
  for (const task of targetTasks) {
    if (idDepth(task.id) <= 1) continue;
    const lastDot = task.id.lastIndexOf(".");
    if (lastDot === -1) continue;
    const parentId = task.id.substring(0, lastDot);
    const group = groupMap.get(parentId);
    if (group) {
      group.push(task);
    } else {
      groupMap.set(parentId, [task]);
    }
  }
  for (const [parentId, groupTasks] of groupMap) {
    // Count bare labels across the group.
    const labelCounts = new Map<string, number>();
    for (const task of groupTasks) {
      for (const label of task.labels) {
        if (label.includes(":")) continue;
        labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
      }
    }
    // Emit info for tasks carrying a label with count === 1.
    for (const task of groupTasks) {
      for (const label of task.labels) {
        if (label.includes(":")) continue;
        if (labelCounts.get(label) === 1) {
          info.push({
            type: "orphan-label",
            severity: "info",
            message: `Label '${label}' on task ${task.id} appears on only one task in the ${parentId} sibling group`,
            ids: [task.id],
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings, info };
}
