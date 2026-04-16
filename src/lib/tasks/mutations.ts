/**
 * Task write operations: create, close, update, comment, label, dep.
 * All mutations acquire file locks for concurrent safety.
 */

import { existsSync, mkdirSync } from "fs";
import { basename, dirname, join } from "path";
import { withLock } from "../lock";
import { resolveRepoRoot } from "../worktree";
import type { Task, TasksFile, TaskStatus } from "./types";
import { MAX_NESTING_DEPTH, SCHEMA_VERSION, TASKS_FILENAME } from "./types";
import { readProjectPrefix } from "./config";
import {
  discoverTaskFilesFromRoot,
  findTaskInRoot,
  idDepth,
  readTasksFile,
  reloadTask,
  resolveTasksPath,
  writeTasksFileRaw,
} from "./io";

/**
 * Write a TasksFile to disk with canonical JSON formatting.
 * 2-space indent, trailing newline, key order enforced via insertion order.
 */
export async function writeTasksFile(filePath: string, data: TasksFile): Promise<void> {
  return withLock(filePath, () => writeTasksFileRaw(filePath, data));
}

/**
 * Derive a human-friendly feature name from a tasks.json file path.
 * `plans/tasks.json` → "project"; `plans/<feature>/tasks.json` → "<feature>".
 */
function featureNameFromFilePath(filePath: string, plansDir: string): string {
  const parent = dirname(filePath);
  if (parent === plansDir) return "project";
  return basename(parent);
}

/**
 * Create an epic with globally sequential numbering.
 * Uses a project-level lock (plans/.epic-lock) to prevent duplicate IDs
 * when concurrent createEpic calls target different feature files.
 *
 * When `opts.explicitId` is provided, the epic is created with that id.
 * The id shape is validated BEFORE the lock is acquired; duplicate-id
 * detection runs inside the .epic-lock critical section via an existence
 * scan over every tasks.json under plans/. On duplicate, throws with a
 * message naming the conflicting feature and epic title; no write occurs.
 */
export async function createEpic(
  feature: string | null,
  title: string,
  cwd?: string,
  opts?: { explicitId?: string }
): Promise<string> {
  const root = resolveRepoRoot(cwd);
  const prefix = readProjectPrefix(root);

  const plansDir = join(root, "plans");
  const epicLockPath = join(plansDir, ".epic-lock");

  const featureDir = feature ? join(plansDir, feature) : plansDir;
  const filePath = join(featureDir, TASKS_FILENAME);

  // Pre-lock shape validation for --id: reject malformed ids before
  // we acquire the cross-feature lock, so a bad input never blocks or
  // touches on-disk state.
  const explicitId = opts?.explicitId;
  if (explicitId !== undefined) {
    const shape = new RegExp(`^${prefix}-\\d+$`);
    if (!shape.test(explicitId)) {
      throw new Error(`invalid epic id ${explicitId}: expected ${prefix}-<number>`);
    }
  }

  // Lock ordering: .epic-lock THEN per-file lock. All code that
  // acquires both must follow this order to avoid deadlocks.
  // Currently only createEpic acquires .epic-lock; other write
  // functions only acquire per-file locks.
  return withLock(epicLockPath, async () => {
    const files = discoverTaskFilesFromRoot(root);
    const epicPattern = new RegExp(`^${prefix}-(\\d+)$`);
    let maxN = 0;

    for (const fp of files) {
      const d = readTasksFile(fp);
      if (!d) continue;
      for (const epic of d.epics) {
        // Duplicate-id existence scan (inside the lock). When an explicit
        // id was requested, flag the collision before computing maxN so
        // the caller sees the conflicting feature + title.
        if (explicitId !== undefined && epic.id === explicitId) {
          const owner = featureNameFromFilePath(fp, plansDir);
          throw new Error(
            `epic id ${explicitId} already exists in feature "${owner}" (title: "${epic.title}")`
          );
        }
        const match = epic.id.match(epicPattern);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > maxN) maxN = n;
        }
      }
    }

    const newId = explicitId ?? `${prefix}-${maxN + 1}`;
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
    blockedBy?: string[];
  },
  cwd?: string
): Promise<string> {
  const root = resolveRepoRoot(cwd);
  readProjectPrefix(root);

  const filePath = resolveTasksPath(feature, root);

  // Validate blockedBy ids against all task ids across the project BEFORE
  // acquiring the per-file lock. Batch-report every unknown id so callers
  // see the full list. No write occurs on failure, so tasks.json is untouched.
  if (opts.blockedBy && opts.blockedBy.length > 0) {
    const allIds = new Set<string>();
    for (const fp of discoverTaskFilesFromRoot(root)) {
      const d = readTasksFile(fp);
      if (d) for (const t of d.tasks) allIds.add(t.id);
    }
    const unknown = opts.blockedBy.filter((id) => !allIds.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown blocker task ID(s): ${unknown.join(", ")}. ` +
          `Each --blocked-by value must reference an existing task.`
      );
    }
  }

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
      dependencies: opts.blockedBy ? [...opts.blockedBy] : [],
      comments: [],
      closeReason: null,
    });

    writeTasksFileRaw(filePath, data);
    return newId;
  });
}

/**
 * Add a dependency: blockedId is blocked by blockerId.
 *
 * Note: blocker existence is validated before acquiring the per-file lock.
 * A concurrent deletion between validation and the locked write could create
 * a dangling reference. Run `forge tasks validate` after parallel operations
 * to catch any such inconsistencies.
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
  fields: Partial<Pick<Task, "status" | "priority" | "title" | "description" | "design" | "notes">> & {
    addAcceptance?: string[];
    addLabels?: string[];
    /**
     * When true AND addAcceptance is a non-empty array, overwrite
     * task.acceptance with the new array instead of appending.
     * When addAcceptance is absent or empty, this flag is a no-op for
     * the acceptance field (existing criteria are preserved).
     */
    replaceAcceptance?: boolean;
  },
  cwd?: string
): Promise<void> {
  if (fields.status === "closed") {
    throw new Error(`Cannot set status to "closed" via update. Use "forge tasks close <id>" instead.`);
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
    if (fields.addAcceptance && fields.addAcceptance.length > 0) {
      if (fields.replaceAcceptance) {
        task.acceptance = [...fields.addAcceptance];
      } else {
        for (const ac of fields.addAcceptance) task.acceptance.push(ac);
      }
    }
    if (fields.addLabels) {
      for (const lbl of fields.addLabels) {
        if (!task.labels.includes(lbl)) task.labels.push(lbl);
      }
    }

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
 * Preview of a pending deleteTask operation.
 */
export interface DeletePreview {
  id: string;
  title: string;
  /** IDs of tasks whose id starts with `${id}.` (would block a delete). */
  descendants: string[];
  /** IDs of other tasks that list `id` in their dependencies[]. */
  dependents: string[];
}

/**
 * Delete a task (with descendant-scan).
 *
 * Without `opts.confirm`: scans all task files and returns a DeletePreview.
 * No write occurs. Unknown ids throw.
 *
 * With `opts.confirm`:
 *  - If the task has any descendants (tasks whose id starts with `${id}.`),
 *    throws with a message naming them. No write occurs.
 *  - Otherwise removes the task from its owner file atomically (under that
 *    file's lock, with a re-scan of all files for descendants inside the
 *    lock to narrow TOCTOU) and then sweeps every other task file to strip
 *    `id` from dangling `dependencies[]`.
 *
 * Concurrency caveat: cross-file cleanup is NOT atomic — each file is
 * locked and written independently. A crash mid-sweep can leave dangling
 * `dependencies[]` entries in files that weren't reached yet. Similarly,
 * a concurrent createTask that targets a different feature file can add
 * a descendant between the owner-file write and a later sweep. Both are
 * edge cases in a single-user CLI but are not prevented here.
 *
 * Returns `DeletePreview` in dry-run mode, `void` after a successful delete.
 */
export async function deleteTask(
  id: string,
  opts: { confirm: boolean },
  cwd?: string
): Promise<DeletePreview | void> {
  const root = resolveRepoRoot(cwd);
  const allFiles = discoverTaskFilesFromRoot(root);

  // Locate the task and gather descendants + dependents across every file.
  let ownerFile: string | null = null;
  let ownerTask: Task | null = null;
  const descendants: string[] = [];
  const dependents: string[] = [];

  for (const fp of allFiles) {
    const data = readTasksFile(fp);
    if (!data) continue;
    for (const t of data.tasks) {
      if (t.id === id) {
        ownerFile = fp;
        ownerTask = t;
      } else if (t.id.startsWith(id + ".")) {
        descendants.push(t.id);
      }
      if (t.id !== id && t.dependencies.includes(id)) {
        dependents.push(t.id);
      }
    }
  }

  if (!ownerFile || !ownerTask) {
    throw new Error(`Task "${id}" not found in any tasks.json file.`);
  }

  if (!opts.confirm) {
    return {
      id,
      title: ownerTask.title,
      descendants,
      dependents,
    };
  }

  if (descendants.length > 0) {
    throw new Error(
      `Cannot delete ${id}: it has ${descendants.length} descendant(s): ${descendants.join(", ")}. ` +
        `Delete the descendants first.`
    );
  }

  // Remove the task from its owner file under lock. Before mutating, re-scan
  // every task file for descendants so a concurrent createTask that snuck a
  // child in between the initial scan and here is still caught (narrowest
  // TOCTOU window we can give without a project-level lock).
  await withLock(ownerFile, () => {
    const lateDescendants: string[] = [];
    for (const fp of allFiles) {
      const d = readTasksFile(fp);
      if (!d) continue;
      for (const t of d.tasks) {
        if (t.id !== id && t.id.startsWith(id + ".")) {
          lateDescendants.push(t.id);
        }
      }
    }
    if (lateDescendants.length > 0) {
      throw new Error(
        `Cannot delete ${id}: it has ${lateDescendants.length} descendant(s): ${lateDescendants.join(", ")}. ` +
          `Delete the descendants first.`
      );
    }

    const data = readTasksFile(ownerFile!);
    if (!data) throw new Error(`${ownerFile} disappeared during write`);
    const idx = data.tasks.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`Task "${id}" disappeared from ${ownerFile} during write`);
    data.tasks.splice(idx, 1);
    // Also clean dangling deps inside the same file before writing.
    for (const t of data.tasks) {
      if (t.dependencies.includes(id)) {
        t.dependencies = t.dependencies.filter((d) => d !== id);
      }
    }
    writeTasksFileRaw(ownerFile!, data);
  });

  for (const fp of allFiles) {
    if (fp === ownerFile) continue;
    // Skip files that don't reference the id at all.
    const preview = readTasksFile(fp);
    if (!preview) continue;
    const needsCleanup = preview.tasks.some((t) => t.dependencies.includes(id));
    if (!needsCleanup) continue;

    await withLock(fp, () => {
      const data = readTasksFile(fp);
      if (!data) return;
      let changed = false;
      for (const t of data.tasks) {
        if (t.dependencies.includes(id)) {
          t.dependencies = t.dependencies.filter((d) => d !== id);
          changed = true;
        }
      }
      if (changed) writeTasksFileRaw(fp, data);
    });
  }
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
