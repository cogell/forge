/**
 * DAG validation: cycle detection, orphan references, duplicate IDs.
 */

import { join } from "path";
import { resolveRepoRoot } from "../worktree";
import type { Epic, Task, ValidationError, ValidationResult, ValidateScope } from "./types";
import { TASKS_FILENAME } from "./types";
import { discoverTaskFilesFromRoot, readTasksFile } from "./io";

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

  // Determine which files to validate vs which are context-only
  let targetFiles: string[];
  switch (scope.kind) {
    case "project": {
      const projectPath = join(root, "plans", TASKS_FILENAME);
      targetFiles = allFiles.filter((f) => f === projectPath);
      if (targetFiles.length === 0) {
        errors.push({ type: "orphan-dep", message: "No project-level tasks.json found at plans/tasks.json", ids: [] });
        return { valid: false, errors };
      }
      break;
    }
    case "feature": {
      const featurePath = join(root, "plans", scope.name, TASKS_FILENAME);
      targetFiles = allFiles.filter((f) => f === featurePath);
      if (targetFiles.length === 0) {
        errors.push({ type: "orphan-dep", message: `No tasks.json found for feature "${scope.name}"`, ids: [] });
        return { valid: false, errors };
      }
      break;
    }
    case "all":
      targetFiles = allFiles;
      break;
  }

  // Load all files for cross-file resolution
  const allTasks: Task[] = [];
  const allEpics: Epic[] = [];
  const fileEpicsMap = new Map<string, Set<string>>();
  const fileTasksMap = new Map<string, Task[]>();

  for (const filePath of allFiles) {
    const data = readTasksFile(filePath);
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
      errors.push({ type: "duplicate-id", message: `Duplicate ID: ${id}`, ids: [id] });
    }
    seenIds.add(id);
  }

  // 2. Orphan dependency references (scoped to target tasks)
  for (const task of targetTasks) {
    for (const depId of task.dependencies) {
      if (!taskIdSet.has(depId)) {
        errors.push({ type: "orphan-dep", message: `Task ${task.id} depends on non-existent ${depId}`, ids: [task.id, depId] });
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
        errors.push({ type: "orphan-epic", message: `Task ${task.id} references non-existent epic ${epicId}`, ids: [task.id, epicId] });
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
          errors.push({ type: "cycle", message: `Cycle detected: ${cycle.join(" → ")} → ${depId}`, ids: cycle });
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

  return { valid: errors.length === 0, errors };
}
