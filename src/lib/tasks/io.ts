/**
 * Task file I/O: path resolution, discovery, reading, writing, and ID helpers.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { resolveRepoRoot } from "../worktree";
import type { Comment, Epic, Task, TasksFile } from "./types";
import { SCHEMA_VERSION, TASKS_FILENAME } from "./types";

// ─── Path Resolution ────────────────────────────────────────────────

/**
 * Validate that a feature name doesn't contain path traversal sequences.
 */
export function validateFeatureName(feature: string): void {
  if (
    feature.includes("..") ||
    feature.includes("/") ||
    feature.includes("\\")
  ) {
    throw new Error(
      `Invalid feature name "${feature}": must not contain path separators or traversal sequences`
    );
  }
}

/**
 * Resolve the path to a tasks.json, anchored to the repo root.
 * When feature is null, resolves to project-level plans/tasks.json.
 */
export function resolveTasksPath(feature: string | null, cwd?: string): string {
  const root = resolveRepoRoot(cwd);
  if (feature) {
    validateFeatureName(feature);
    return join(root, "plans", feature, TASKS_FILENAME);
  }
  return join(root, "plans", TASKS_FILENAME);
}

// ─── File Discovery ─────────────────────────────────────────────────

/**
 * Discover all tasks.json files under the plans/ directory.
 * Public API — resolves repo root from cwd.
 */
export function discoverTaskFiles(cwd?: string): string[] {
  return discoverTaskFilesFromRoot(resolveRepoRoot(cwd));
}

/**
 * Discover task files given a pre-resolved repo root.
 * Scans plans/tasks.json (root-level) + plans/<subdir>/tasks.json.
 * Skips directories prefixed with '.' or '_' (matching plans.ts convention).
 */
export function discoverTaskFilesFromRoot(root: string): string[] {
  const plansDir = join(root, "plans");

  if (!existsSync(plansDir)) return [];

  const found: string[] = [];

  const rootTasksPath = join(plansDir, TASKS_FILENAME);
  if (existsSync(rootTasksPath)) {
    found.push(rootTasksPath);
  }

  const entries = readdirSync(plansDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;

    const tasksPath = join(plansDir, entry.name, TASKS_FILENAME);
    if (existsSync(tasksPath)) {
      found.push(tasksPath);
    }
  }

  return found;
}

// ─── File Reading ───────────────────────────────────────────────────

/**
 * Read and parse a tasks.json file.
 *
 * Returns null if the file does not exist.
 * Throws a descriptive error if the file exists but contains invalid JSON
 * or does not match the expected schema shape.
 */
export function readTasksFile(filePath: string): TasksFile | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `Failed to parse ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`
    );
  }

  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray((data as Record<string, unknown>).epics) ||
    !Array.isArray((data as Record<string, unknown>).tasks)
  ) {
    throw new Error(
      `Invalid tasks.json schema in ${filePath}: expected object with "epics" and "tasks" arrays`
    );
  }

  const record = data as Record<string, unknown>;

  const version = record.version;
  if (typeof version === "number" && version > SCHEMA_VERSION) {
    throw new Error(
      `${filePath} has schema version ${version}, but this version of forge only supports up to version ${SCHEMA_VERSION}. Please upgrade forge.`
    );
  }

  const epics = record.epics as unknown[];
  const tasks = record.tasks as unknown[];

  for (let i = 0; i < epics.length; i++) {
    const e = epics[i];
    if (typeof e !== "object" || e === null || typeof (e as Record<string, unknown>).id !== "string") {
      throw new Error(
        `Invalid epic at index ${i} in ${filePath}: each epic must be an object with a string "id"`
      );
    }
  }

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (typeof t !== "object" || t === null) {
      throw new Error(`Invalid task at index ${i} in ${filePath}: must be an object`);
    }
    const tr = t as Record<string, unknown>;
    if (typeof tr.id !== "string") {
      throw new Error(`Invalid task at index ${i} in ${filePath}: missing or non-string "id"`);
    }
    if (typeof tr.status !== "string" || !["open", "in_progress", "closed"].includes(tr.status)) {
      throw new Error(
        `Invalid task "${tr.id ?? i}" in ${filePath}: status must be "open", "in_progress", or "closed"`
      );
    }
  }

  return data as TasksFile;
}

// ─── File Writing ───────────────────────────────────────────────────

function orderEpic(epic: Epic): Record<string, unknown> {
  return { id: epic.id, title: epic.title, created: epic.created };
}

function orderComment(comment: Comment): Record<string, unknown> {
  return { message: comment.message, timestamp: comment.timestamp };
}

function orderTask(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    labels: task.labels,
    description: task.description,
    design: task.design,
    acceptance: task.acceptance,
    notes: task.notes,
    dependencies: task.dependencies,
    comments: task.comments.map(orderComment),
    closeReason: task.closeReason,
  };
}

/**
 * Write a TasksFile to disk with canonical JSON formatting (no lock).
 * Used by locked write functions that already hold the lock.
 */
export function writeTasksFileRaw(filePath: string, data: TasksFile): void {
  const ordered = {
    version: data.version,
    epics: data.epics.map(orderEpic),
    tasks: data.tasks.map(orderTask),
  };
  writeFileSync(filePath, JSON.stringify(ordered, null, 2) + "\n", "utf-8");
}

// ─── ID Helpers ─────────────────────────────────────────────────────

export function idDepth(id: string): number {
  const dashIdx = id.indexOf("-");
  if (dashIdx === -1) return 0;
  return id.substring(dashIdx + 1).split(".").length;
}

// ─── Task Lookup ────────────────────────────────────────────────────

/**
 * Find which file contains a given task ID.
 * Accepts a pre-resolved repo root to avoid redundant resolution.
 *
 * When `featureHint` is provided, checks that feature's file first,
 * avoiding a full scan when the caller already knows the feature context.
 */
export function findTaskInRoot(
  taskId: string,
  root: string,
  featureHint?: string
): { filePath: string; data: TasksFile; taskIndex: number } {
  // Try the hinted file first to avoid scanning all files
  if (featureHint) {
    const hintPath = join(root, "plans", featureHint, TASKS_FILENAME);
    const data = readTasksFile(hintPath);
    if (data) {
      const taskIndex = data.tasks.findIndex((t) => t.id === taskId);
      if (taskIndex !== -1) {
        return { filePath: hintPath, data, taskIndex };
      }
    }
  }

  for (const filePath of discoverTaskFilesFromRoot(root)) {
    const data = readTasksFile(filePath);
    if (!data) continue;

    const taskIndex = data.tasks.findIndex((t) => t.id === taskId);
    if (taskIndex !== -1) {
      return { filePath, data, taskIndex };
    }
  }

  throw new Error(`Task "${taskId}" not found in any tasks.json file.`);
}

/**
 * Re-read a single file and locate a task by ID.
 * Used inside lock callbacks after we already know which file holds the task.
 */
export function reloadTask(
  filePath: string,
  taskId: string
): { data: TasksFile; taskIndex: number } {
  const data = readTasksFile(filePath);
  if (!data) throw new Error(`${filePath} disappeared during write`);
  const taskIndex = data.tasks.findIndex((t) => t.id === taskId);
  if (taskIndex === -1) throw new Error(`Task "${taskId}" disappeared from ${filePath} during write`);
  return { data, taskIndex };
}
