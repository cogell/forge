/**
 * Core task system types, constants, and file I/O.
 *
 * Replaces the external `bd` CLI dependency (beads.ts) with a built-in
 * tasks.json schema stored alongside plans/.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { withLock } from "./lock";
import { resolveRepoRoot } from "./worktree";

// ─── Constants ────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 1;
export const TASKS_FILENAME = "tasks.json";
export const MAX_NESTING_DEPTH = 3;

// ─── Types ────────────────────────────────────────────────────────────

export type TaskStatus = "open" | "in_progress" | "closed";

export interface Comment {
  message: string;
  timestamp: string;
}

export interface Epic {
  id: string;
  title: string;
  created: string;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number;
  labels: string[];
  description: string;
  design: string;
  acceptance: string[];
  notes: string;
  dependencies: string[];
  comments: Comment[];
  closeReason: string | null;
}

export interface TasksFile {
  version: number;
  epics: Epic[];
  tasks: Task[];
}

export interface EpicInfo {
  epics: Array<{ id: string; title: string }>;
  primaryEpicId: string;
  totalTasks: number;
  closedTasks: number;
  openTasks: number;
  inProgressTasks: number;
  allClosed: boolean;
}

export interface ReadyTask {
  id: string;
  title: string;
  priority: number;
  labels: string[];
}

export interface ValidationError {
  type: "cycle" | "orphan-dep" | "orphan-epic" | "duplicate-id";
  message: string;
  ids: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export type ValidateScope =
  | { kind: "all" }
  | { kind: "project" }
  | { kind: "feature"; name: string };

const PREFIX_REGEX = /^[A-Z0-9]{2,10}$/;

// ─── Path Resolution ────────────────────────────────────────────────

/**
 * Resolve the path to a tasks.json, anchored to the repo root.
 * When feature is null, resolves to project-level plans/tasks.json.
 */
export function resolveTasksPath(feature: string | null, cwd?: string): string {
  const root = resolveRepoRoot(cwd);
  if (feature) return join(root, "plans", feature, TASKS_FILENAME);
  return join(root, "plans", TASKS_FILENAME);
}

// ─── Config ──────────────────────────────────────────────────────────

/**
 * Read the project prefix from forge.json in the given directory.
 * Throws if forge.json is missing or prefix is invalid.
 */
export function readProjectPrefix(cwd?: string): string {
  const dir = resolveRepoRoot(cwd);
  const filePath = join(dir, "forge.json");

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error("No project key configured. Run forge init to set one.");
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("forge.json contains invalid JSON. Run forge init to fix it.");
  }

  const prefix = (data as Record<string, unknown>)?.prefix;

  if (typeof prefix !== "string" || !PREFIX_REGEX.test(prefix)) {
    throw new Error(
      `Invalid project prefix${prefix ? `: "${prefix}"` : ""}. ` +
        "Must be 2-10 uppercase alphanumeric characters (e.g., FORGE)."
    );
  }

  return prefix;
}

/**
 * Validate a prefix string. Returns true if valid, false otherwise.
 */
export function isValidPrefix(prefix: string): boolean {
  return PREFIX_REGEX.test(prefix);
}

// ─── File I/O ─────────────────────────────────────────────────────────

/**
 * Discover all tasks.json files under the plans/ directory.
 * Public API — resolves repo root from cwd.
 */
export function discoverTaskFiles(cwd?: string): string[] {
  return discoverTaskFilesFromRoot(resolveRepoRoot(cwd));
}

/**
 * Internal: discover task files given a pre-resolved repo root.
 * Scans plans/tasks.json (root-level) + plans/<subdir>/tasks.json.
 * Skips directories prefixed with '.' or '_' (matching plans.ts convention).
 */
function discoverTaskFilesFromRoot(root: string): string[] {
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

/**
 * Read and parse a tasks.json file.
 *
 * Returns null if the file does not exist.
 * Throws a descriptive error if the file exists but contains invalid JSON.
 */
export function readTasksFile(filePath: string): TasksFile | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  try {
    return JSON.parse(raw) as TasksFile;
  } catch (cause) {
    throw new Error(
      `Failed to parse ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`
    );
  }
}

// ─── Query Functions ─────────────────────────────────────────────────

/**
 * Query task stats for a feature's tasks.json.
 *
 * Reads plans/<feature>/tasks.json, aggregates task status counts across
 * all epics, and returns an EpicInfo summary.
 *
 * Returns null when the file is missing or has no tasks (empty scaffold).
 */
export function queryFeatureTasks(feature: string, cwd?: string): EpicInfo | null {
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
 */
export function getReadyTasks(cwd?: string, feature?: string): ReadyTask[] {
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

  // Build container set in O(n log n) via sorted IDs instead of O(n^2) nested loop
  const containerSet = new Set<string>();
  const sortedIds = allTasks.map((t) => t.id).sort();
  for (let i = 0; i < sortedIds.length - 1; i++) {
    if (sortedIds[i + 1].startsWith(sortedIds[i] + ".")) {
      containerSet.add(sortedIds[i]);
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

    ready.push({
      id: task.id,
      title: task.title,
      priority: task.priority,
      labels: task.labels,
    });
  }

  return ready;
}

// ─── Internal Write Helpers ─────────────────────────────────────────

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
function writeTasksFileRaw(filePath: string, data: TasksFile): void {
  const ordered = {
    version: data.version,
    epics: data.epics.map(orderEpic),
    tasks: data.tasks.map(orderTask),
  };
  writeFileSync(filePath, JSON.stringify(ordered, null, 2) + "\n", "utf-8");
}

function idDepth(id: string): number {
  const dashIdx = id.indexOf("-");
  if (dashIdx === -1) return 0;
  return id.substring(dashIdx + 1).split(".").length;
}

/**
 * Find which file contains a given task ID.
 * Accepts a pre-resolved repo root to avoid redundant resolution.
 */
function findTaskInRoot(
  taskId: string,
  root: string
): { filePath: string; data: TasksFile; taskIndex: number } {
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
function reloadTask(
  filePath: string,
  taskId: string
): { data: TasksFile; taskIndex: number } {
  const data = readTasksFile(filePath);
  if (!data) throw new Error(`${filePath} disappeared during write`);
  const taskIndex = data.tasks.findIndex((t) => t.id === taskId);
  if (taskIndex === -1) throw new Error(`Task "${taskId}" disappeared from ${filePath} during write`);
  return { data, taskIndex };
}

/**
 * Build a map of task-id → status across all task files.
 */
function buildStatusMap(root: string): Map<string, TaskStatus> {
  const map = new Map<string, TaskStatus>();
  for (const filePath of discoverTaskFilesFromRoot(root)) {
    const data = readTasksFile(filePath);
    if (!data) continue;
    for (const task of data.tasks) map.set(task.id, task.status);
  }
  return map;
}

// ─── Public Write Functions ─────────────────────────────────────────

/**
 * Write a TasksFile to disk with canonical JSON formatting.
 * 2-space indent, trailing newline, key order enforced via insertion order.
 */
export async function writeTasksFile(filePath: string, data: TasksFile): Promise<void> {
  return withLock(filePath, () => writeTasksFileRaw(filePath, data));
}

/**
 * Create an epic with globally sequential numbering.
 * Uses a project-level lock (plans/.epic-lock) to prevent duplicate IDs
 * when concurrent createEpic calls target different feature files.
 */
export async function createEpic(feature: string | null, title: string, cwd?: string): Promise<string> {
  const root = resolveRepoRoot(cwd);
  const prefix = readProjectPrefix(root);

  const plansDir = join(root, "plans");
  const epicLockPath = join(plansDir, ".epic-lock");

  const featureDir = feature ? join(plansDir, feature) : plansDir;
  const filePath = join(featureDir, TASKS_FILENAME);

  // Project-level lock serializes epic ID allocation globally.
  // Per-file lock inside protects the feature's tasks.json from
  // concurrent writes (e.g., updateTask on the same file).
  return withLock(epicLockPath, async () => {
    const files = discoverTaskFilesFromRoot(root);
    const epicPattern = new RegExp(`^${prefix}-(\\d+)$`);
    let maxN = 0;

    for (const fp of files) {
      const d = readTasksFile(fp);
      if (!d) continue;
      for (const epic of d.epics) {
        const match = epic.id.match(epicPattern);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > maxN) maxN = n;
        }
      }
    }

    const newId = `${prefix}-${maxN + 1}`;
    const today = new Date().toISOString().split("T")[0];

    return withLock(filePath, () => {
      if (!existsSync(featureDir)) {
        mkdirSync(featureDir, { recursive: true });
      }

      let data = readTasksFile(filePath);
      if (!data) {
        data = { version: SCHEMA_VERSION, epics: [], tasks: [] };
      }

      data.epics.push({ id: newId, title, created: today });
      writeTasksFileRaw(filePath, data);

      return newId;
    });
  });
}

/**
 * Create a task under a parent (epic or task).
 * Validates parent existence and nesting depth.
 */
export async function createTask(
  feature: string | null,
  title: string,
  parentId: string,
  opts: {
    priority?: number;
    labels?: string[];
    description?: string;
    design?: string;
    acceptance?: string[];
    notes?: string;
  },
  cwd?: string
): Promise<string> {
  const root = resolveRepoRoot(cwd);
  readProjectPrefix(root);

  const filePath = resolveTasksPath(feature, root);

  return withLock(filePath, () => {
    const data = readTasksFile(filePath);
    if (!data) {
      throw new Error(
        `No ${TASKS_FILENAME} found${feature ? ` for feature "${feature}"` : ""}. Create an epic first.`
      );
    }

    const isEpic = data.epics.some((e) => e.id === parentId);
    const isTask = data.tasks.some((t) => t.id === parentId);
    if (!isEpic && !isTask) {
      throw new Error(
        `Parent ID "${parentId}" not found. It must be an existing epic or task ID.`
      );
    }

    const parentDepth = idDepth(parentId);
    const childDepth = parentDepth + 1;
    if (childDepth > MAX_NESTING_DEPTH) {
      throw new Error(
        `Maximum nesting depth is ${MAX_NESTING_DEPTH}. ` +
          `Parent "${parentId}" is at depth ${parentDepth}, ` +
          `child would be at depth ${childDepth}.`
      );
    }

    const childPrefix = parentId + ".";
    let maxChild = 0;
    for (const t of data.tasks) {
      if (t.id.startsWith(childPrefix)) {
        const remainder = t.id.substring(childPrefix.length);
        const firstSegment = remainder.split(".")[0];
        const n = parseInt(firstSegment, 10);
        if (!isNaN(n) && n > maxChild) maxChild = n;
      }
    }

    const newId = `${parentId}.${maxChild + 1}`;

    data.tasks.push({
      id: newId,
      title,
      status: "open",
      priority: opts.priority ?? 2,
      labels: opts.labels ?? [],
      description: opts.description ?? "",
      design: opts.design ?? "",
      acceptance: opts.acceptance ?? [],
      notes: opts.notes ?? "",
      dependencies: [],
      comments: [],
      closeReason: null,
    });

    writeTasksFileRaw(filePath, data);
    return newId;
  });
}

/**
 * Add a dependency: blockedId is blocked by blockerId.
 */
export async function addDep(blockedId: string, blockerId: string, cwd?: string): Promise<void> {
  const root = resolveRepoRoot(cwd);
  const { filePath } = findTaskInRoot(blockedId, root);

  // Validate blocker exists somewhere in the project
  const allTaskIds = new Set<string>();
  for (const fp of discoverTaskFilesFromRoot(root)) {
    const d = readTasksFile(fp);
    if (d) for (const t of d.tasks) allTaskIds.add(t.id);
  }
  if (!allTaskIds.has(blockerId)) {
    throw new Error(`Blocker task "${blockerId}" not found in any tasks.json file.`);
  }

  return withLock(filePath, () => {
    const { data, taskIndex } = reloadTask(filePath, blockedId);
    const task = data.tasks[taskIndex];
    if (!task.dependencies.includes(blockerId)) {
      task.dependencies.push(blockerId);
    }
    writeTasksFileRaw(filePath, data);
  });
}

/**
 * Remove a dependency.
 */
export async function removeDep(blockedId: string, blockerId: string, cwd?: string): Promise<void> {
  const root = resolveRepoRoot(cwd);
  const { filePath } = findTaskInRoot(blockedId, root);

  return withLock(filePath, () => {
    const { data, taskIndex } = reloadTask(filePath, blockedId);
    data.tasks[taskIndex].dependencies = data.tasks[taskIndex].dependencies.filter(
      (id) => id !== blockerId
    );
    writeTasksFileRaw(filePath, data);
  });
}

/**
 * Close a task with dependency validation.
 *
 * | Dep status   | close   | close --force |
 * |-------------|---------|---------------|
 * | closed      | allowed | allowed       |
 * | in_progress | error   | allowed       |
 * | open        | error   | error         |
 */
export async function closeTask(
  id: string,
  opts: { reason?: string; force?: boolean } = {},
  cwd?: string
): Promise<void> {
  const root = resolveRepoRoot(cwd);
  const { reason, force = false } = opts;
  const { filePath } = findTaskInRoot(id, root);

  return withLock(filePath, () => {
    const { data, taskIndex } = reloadTask(filePath, id);
    const task = data.tasks[taskIndex];

    // Build status map from fresh locked data + other (unlocked) files.
    // Cross-file statuses are read without locks — a concurrent close on
    // another file could cause a stale read. Use --force to work around.
    const statusMap = new Map<string, TaskStatus>();
    for (const t of data.tasks) statusMap.set(t.id, t.status);
    for (const fp of discoverTaskFilesFromRoot(root)) {
      if (fp === filePath) continue; // already have fresh data
      const d = readTasksFile(fp);
      if (d) for (const t of d.tasks) statusMap.set(t.id, t.status);
    }

    for (const depId of task.dependencies) {
      const depStatus = statusMap.get(depId);

      if (depStatus === undefined) {
        throw new Error(`Cannot close ${id}: dependency ${depId} not found`);
      }
      if (depStatus === "open") {
        throw new Error(`Cannot close ${id}: dependency ${depId} is still open`);
      }
      if (depStatus === "in_progress" && !force) {
        throw new Error(
          `Cannot close ${id}: dependency ${depId} is in_progress (use --force to override)`
        );
      }
    }

    // Prevent closing a container that has open/in_progress children
    const hasOpenChildren = data.tasks.some(
      (t) => t.id !== id && t.id.startsWith(id + ".") && t.status !== "closed"
    );
    if (hasOpenChildren) {
      throw new Error(`Cannot close ${id}: it has open or in_progress children. Close children first.`);
    }

    task.status = "closed";
    task.closeReason = reason || "completed";

    checkAutoClose(data, id);
    writeTasksFileRaw(filePath, data);
  });
}

/**
 * Check if closing a task should auto-close its parent container.
 * Cascades upward until hitting an epic boundary.
 *
 * Uses startsWith(parentId + ".") to check ALL descendants (not just
 * immediate children). This means a parent won't auto-close if any
 * grandchild is still open — which is correct because you can't close
 * a container while any descendant is open in normal flow.
 */
function checkAutoClose(data: TasksFile, taskId: string): void {
  const dashIdx = taskId.indexOf("-");
  if (dashIdx === -1) return;

  const numericPart = taskId.substring(dashIdx + 1);
  const segments = numericPart.split(".");

  // Single segment = epic level — epics don't auto-close
  if (segments.length <= 1) return;

  const parentNumeric = segments.slice(0, -1).join(".");
  const prefix = taskId.substring(0, dashIdx);
  const parentId = `${prefix}-${parentNumeric}`;

  if (data.epics.some((e) => e.id === parentId)) return;

  const parentTask = data.tasks.find((t) => t.id === parentId);
  if (!parentTask) return;

  const allDescendantsClosed = data.tasks
    .filter((t) => t.id !== parentId && t.id.startsWith(parentId + "."))
    .every((t) => t.status === "closed");

  if (allDescendantsClosed) {
    parentTask.status = "closed";
    parentTask.closeReason = "all children closed";
    checkAutoClose(data, parentId);
  }
}

/**
 * Update one or more fields on a task.
 * Setting status to "open" clears closeReason.
 * Setting status to "closed" via update is rejected — use closeTask instead,
 * which enforces dependency validation and triggers auto-close cascade.
 */
export async function updateTask(
  id: string,
  fields: Partial<Pick<Task, "status" | "priority" | "title" | "description" | "design" | "notes">>,
  cwd?: string
): Promise<void> {
  if (fields.status === "closed") {
    throw new Error(`Cannot set status to "closed" via update. Use closeTask (forge tasks close) instead.`);
  }

  const root = resolveRepoRoot(cwd);
  const { filePath } = findTaskInRoot(id, root);

  return withLock(filePath, () => {
    const { data, taskIndex } = reloadTask(filePath, id);
    const task = data.tasks[taskIndex];

    if (fields.status !== undefined) task.status = fields.status;
    if (fields.priority !== undefined) task.priority = fields.priority;
    if (fields.title !== undefined) task.title = fields.title;
    if (fields.description !== undefined) task.description = fields.description;
    if (fields.design !== undefined) task.design = fields.design;
    if (fields.notes !== undefined) task.notes = fields.notes;

    if (task.status === "open") task.closeReason = null;

    writeTasksFileRaw(filePath, data);
  });
}

/**
 * Append a comment to a task.
 */
export async function addComment(id: string, message: string, cwd?: string): Promise<void> {
  const root = resolveRepoRoot(cwd);
  const { filePath } = findTaskInRoot(id, root);

  return withLock(filePath, () => {
    const { data, taskIndex } = reloadTask(filePath, id);
    data.tasks[taskIndex].comments.push({ message, timestamp: new Date().toISOString() });
    writeTasksFileRaw(filePath, data);
  });
}

/**
 * Add a label to a task (idempotent — no duplicates).
 */
export async function addLabel(id: string, label: string, cwd?: string): Promise<void> {
  const root = resolveRepoRoot(cwd);
  const { filePath } = findTaskInRoot(id, root);

  return withLock(filePath, () => {
    const { data, taskIndex } = reloadTask(filePath, id);
    const task = data.tasks[taskIndex];
    if (!task.labels.includes(label)) {
      task.labels.push(label);
      writeTasksFileRaw(filePath, data);
    }
  });
}

// ─── DAG Validation ─────────────────────────────────────────────────

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

  function dfs(id: string, path: string[]): void {
    color.set(id, GRAY);
    path.push(id);

    for (const depId of depMap.get(id) ?? []) {
      if (!color.has(depId)) continue;
      if (color.get(depId) === GRAY) {
        const cycleStart = path.indexOf(depId);
        const cycle = path.slice(cycleStart);
        errors.push({ type: "cycle", message: `Cycle detected: ${cycle.join(" → ")} → ${depId}`, ids: cycle });
        // Don't return — continue to find other cycles in the graph
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
