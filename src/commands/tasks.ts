/**
 * forge tasks — subcommand dispatcher for the built-in task system.
 *
 * Subcommands: scaffold (default), epic create, create, dep add/remove,
 * close, update, comment, label, validate, list, show, ready.
 */

import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import {
  readProjectPrefix,
  readTasksFile,
  writeTasksFile,
  createEpic,
  createTask,
  addDep,
  removeDep,
  closeTask,
  updateTask,
  addComment,
  addLabel,
  validateDag,
  discoverTaskFiles,
  getReadyTasks,
  resolveTasksPath,
  SCHEMA_VERSION,
  TASKS_FILENAME,
  type ValidateScope,
  type TasksFile,
  type Task,
  type TaskStatus,
  type Epic,
} from "../lib/tasks";

const RESERVED = [
  "ready", "list", "show", "create", "close", "update",
  "comment", "label", "dep", "validate", "epic",
];

const VALID_STATUSES: TaskStatus[] = ["open", "in_progress", "closed"];

/** Flags that consume the next arg as their value. */
const VALUE_FLAGS = new Set([
  "--parent", "--priority", "--acceptance", "--label",
  "-d", "--description", "--design", "--notes",
  "--status", "--title", "--reason",
]);

/** Extract positional args by skipping flags and their values. */
function extractPositional(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (VALUE_FLAGS.has(arg)) {
      i++; // skip the flag's value
    } else if (!arg.startsWith("-")) {
      result.push(arg);
    }
  }
  return result;
}

function fail(msg: string, json: boolean): never {
  if (json) console.log(JSON.stringify({ error: msg }));
  else console.error(msg);
  process.exit(1);
}

export async function tasks(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const project = args.includes("--project");

  const positional = extractPositional(args);

  const subcommand = positional[0];
  const cwd = process.cwd();

  try {
    readProjectPrefix(cwd);
  } catch (err) {
    fail((err as Error).message, json);
  }

  if (subcommand && RESERVED.includes(subcommand)) {
    switch (subcommand) {
      case "epic": return handleEpic(args, positional, json, project, cwd);
      case "create": return handleCreate(args, positional, json, project, cwd);
      case "close": return handleClose(positional, json, args, cwd);
      case "update": return handleUpdate(args, positional, json, cwd);
      case "comment": return handleComment(positional, json, cwd);
      case "label": return handleLabel(positional, json, cwd);
      case "validate": return handleValidate(positional, json, project, cwd);
      case "dep": return handleDep(positional, json, cwd);
      case "list": return handleList(positional, json, project, cwd);
      case "show": return handleShow(positional, json, cwd);
      case "ready": return handleReady(positional, json, cwd);
      default:
        fail(`Subcommand "${subcommand}" is not yet implemented.`, json);
    }
  } else {
    return handleScaffold(positional, json, project, cwd);
  }
}

// ── Scaffold handler ────────────────────────────────────

async function handleScaffold(
  positional: string[],
  json: boolean,
  project: boolean,
  cwd: string
): Promise<void> {
  const feature = project ? null : positional[0] || null;

  if (!project && !feature) {
    fail("Usage: forge tasks <feature-name> or forge tasks --project", json);
  }

  if (!project && feature) {
    const planFile = join(dirname(resolveTasksPath(feature, cwd)), "plan.md");
    if (!existsSync(planFile)) {
      fail(`No plan found at plans/${feature}/plan.md. Run 'forge plan ${feature}' first.`, json);
    }
  }

  const filePath = resolveTasksPath(feature, cwd);
  const existing = readTasksFile(filePath);

  if (existing) {
    const counts = countByStatus(existing.tasks);

    if (json) {
      console.log(JSON.stringify({ status: "exists", feature: feature || "project", epicCount: existing.epics.length, taskCount: existing.tasks.length, statusCounts: counts }));
    } else {
      console.log(feature ? `Feature: ${feature}` : "Project-level tasks");
      console.log(`Epics: ${existing.epics.length}`);
      console.log(`Tasks: ${existing.tasks.length}`);
      console.log(`  open: ${counts.open}, in_progress: ${counts.in_progress}, closed: ${counts.closed}`);
    }
    return;
  }

  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const emptyData: TasksFile = { version: SCHEMA_VERSION, epics: [], tasks: [] };
  await writeTasksFile(filePath, emptyData);

  const location = feature ? `plans/${feature}/tasks.json` : "plans/tasks.json";
  if (json) console.log(JSON.stringify({ status: "created", feature: feature || "project", path: location }));
  else console.log(`Scaffolded ${location}`);
}

// ── Epic create handler ─────────────────────────────────

async function handleEpic(
  _args: string[],
  positional: string[],
  json: boolean,
  project: boolean,
  cwd: string
): Promise<void> {
  const action = positional[1];
  if (action !== "create") {
    fail(`Unknown epic subcommand: ${action}. Usage: forge tasks epic create <feature|--project> "title"`, json);
  }

  let feature: string | null;
  let title: string;

  if (project) {
    feature = null;
    title = positional[2];
  } else {
    feature = positional[2] || null;
    title = positional[3];
  }

  if (!title) fail('Missing epic title. Usage: forge tasks epic create <feature|--project> "title"', json);
  if (!project && !feature) fail('Missing feature name. Usage: forge tasks epic create <feature> "title"', json);

  const id = await createEpic(feature, title, cwd);

  if (json) console.log(JSON.stringify({ id, title, feature: feature || "project" }));
  else console.log(`Created epic: ${id} — ${title}`);
}

// ── Create task handler ─────────────────────────────────

async function handleCreate(
  args: string[],
  positional: string[],
  json: boolean,
  project: boolean,
  cwd: string
): Promise<void> {
  let feature: string | null;
  let title: string;

  if (project) {
    feature = null;
    title = positional[1];
  } else {
    feature = positional[1] || null;
    title = positional[2];
  }

  if (!title) fail('Missing task title. Usage: forge tasks create <feature|--project> "title" --parent <id>', json);
  if (!project && !feature) fail('Missing feature name. Usage: forge tasks create <feature> "title" --parent <id>', json);

  // Parse flags
  let parentId: string | undefined;
  let priority: number | undefined;
  const acceptance: string[] = [];
  const labels: string[] = [];
  let description: string | undefined;
  let design: string | undefined;
  let notes: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--parent" && next) { parentId = next; i++; }
    else if (arg === "--priority" && next) { priority = parseInt(next, 10); i++; }
    else if (arg === "--acceptance" && next) { acceptance.push(next); i++; }
    else if (arg === "--label" && next) { labels.push(next); i++; }
    else if ((arg === "-d" || arg === "--description") && next) { description = next; i++; }
    else if (arg === "--design" && next) { design = next; i++; }
    else if (arg === "--notes" && next) { notes = next; i++; }
  }

  // Default parent to sole epic
  if (!parentId) {
    const filePath = resolveTasksPath(feature, cwd);
    const data = readTasksFile(filePath);
    if (!data) fail(`No tasks.json found${feature ? ` for ${feature}` : ""}. Run scaffold first.`, json);
    if (data!.epics.length === 1) {
      parentId = data!.epics[0].id;
    } else if (data!.epics.length === 0) {
      fail("No epics found. Create an epic first with: forge tasks epic create", json);
    } else {
      const ids = data!.epics.map((e) => e.id).join(", ");
      fail(`Multiple epics found (${ids}). Specify --parent <epic-id>.`, json);
    }
  }

  const id = await createTask(feature, title, parentId, {
    priority, labels: labels.length > 0 ? labels : undefined,
    description, design, acceptance: acceptance.length > 0 ? acceptance : undefined, notes,
  }, cwd);

  if (json) console.log(JSON.stringify({ id, title, parent: parentId, feature: feature || "project" }));
  else console.log(`Created task: ${id} — ${title}`);
}

// ── Dep add/remove handler ──────────────────────────────

async function handleDep(positional: string[], json: boolean, cwd: string): Promise<void> {
  const action = positional[1];
  const blockedId = positional[2];
  const blockerId = positional[3];

  if (!action || !["add", "remove"].includes(action)) {
    fail("Usage: forge tasks dep add|remove <blocked> <blocker>", json);
  }

  if (!blockedId || !blockerId) {
    fail("Both blocked and blocker task IDs are required.", json);
  }

  try {
    if (action === "add") {
      await addDep(blockedId, blockerId, cwd);
      if (json) console.log(JSON.stringify({ action: "added", blocked: blockedId, blocker: blockerId }));
      else console.log(`Added dependency: ${blockedId} blocked by ${blockerId}`);
    } else {
      await removeDep(blockedId, blockerId, cwd);
      if (json) console.log(JSON.stringify({ action: "removed", blocked: blockedId, blocker: blockerId }));
      else console.log(`Removed dependency: ${blockedId} no longer blocked by ${blockerId}`);
    }
  } catch (err) {
    fail((err as Error).message, json);
  }
}

// ── Close handler ───────────────────────────────────────

async function handleClose(positional: string[], json: boolean, args: string[], cwd: string): Promise<void> {
  const force = args.includes("--force");
  const id = positional[1];

  if (!id) fail('Usage: forge tasks close <id> [--reason "..."] [--force]', json);

  let reason: string | undefined;
  const reasonIdx = args.indexOf("--reason");
  if (reasonIdx !== -1 && reasonIdx + 1 < args.length) reason = args[reasonIdx + 1];

  try {
    await closeTask(id, { reason, force }, cwd);
    if (json) console.log(JSON.stringify({ status: "closed", id, reason: reason || "completed" }));
    else console.log(`Closed task ${id} (reason: ${reason || "completed"})`);
  } catch (err) {
    fail((err as Error).message, json);
  }
}

// ── Update handler ──────────────────────────────────────

async function handleUpdate(args: string[], positional: string[], json: boolean, cwd: string): Promise<void> {
  const id = positional[1];
  if (!id) fail("Usage: forge tasks update <id> [--status <s>] [--priority <n>] [--title ...] [-d ...] [--design ...] [--notes ...]", json);

  const fields: Partial<Pick<Task, "status" | "priority" | "title" | "description" | "design" | "notes">> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--status" && next) {
      if (!VALID_STATUSES.includes(next as TaskStatus)) {
        fail(`Invalid status "${next}". Must be one of: ${VALID_STATUSES.join(", ")}`, json);
      }
      fields.status = next as TaskStatus;
      i++;
    }
    else if (arg === "--priority" && next) { fields.priority = parseInt(next, 10); i++; }
    else if (arg === "--title" && next) { fields.title = next; i++; }
    else if ((arg === "-d" || arg === "--description") && next) { fields.description = next; i++; }
    else if (arg === "--design" && next) { fields.design = next; i++; }
    else if (arg === "--notes" && next) { fields.notes = next; i++; }
  }

  try {
    await updateTask(id, fields, cwd);
    if (json) console.log(JSON.stringify({ status: "updated", id, fields }));
    else console.log(`Updated task ${id}`);
  } catch (err) {
    fail((err as Error).message, json);
  }
}

// ── Comment handler ─────────────────────────────────────

async function handleComment(positional: string[], json: boolean, cwd: string): Promise<void> {
  const id = positional[1];
  const message = positional[2];
  if (!id || !message) fail('Usage: forge tasks comment <id> "message"', json);

  try {
    await addComment(id, message, cwd);
    if (json) console.log(JSON.stringify({ status: "commented", id }));
    else console.log(`Added comment to ${id}`);
  } catch (err) {
    fail((err as Error).message, json);
  }
}

// ── Label handler ───────────────────────────────────────

async function handleLabel(positional: string[], json: boolean, cwd: string): Promise<void> {
  const id = positional[1];
  const label = positional[2];
  if (!id || !label) fail("Usage: forge tasks label <id> <label>", json);

  try {
    await addLabel(id, label, cwd);
    if (json) console.log(JSON.stringify({ status: "labeled", id, label }));
    else console.log(`Added label "${label}" to ${id}`);
  } catch (err) {
    fail((err as Error).message, json);
  }
}

// ── Validate handler ────────────────────────────────────

async function handleValidate(positional: string[], json: boolean, project: boolean, cwd: string): Promise<void> {
  const scope: ValidateScope = project
    ? { kind: "project" }
    : positional[1]
      ? { kind: "feature", name: positional[1] }
      : { kind: "all" };
  const result = validateDag(scope, cwd);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.valid) {
    console.log("DAG is valid. No errors found.");
  } else {
    console.error(`DAG validation found ${result.errors.length} error(s):\n`);
    for (const err of result.errors) {
      console.error(`  [${err.type}] ${err.message}`);
    }
  }

  if (!result.valid) process.exit(1);
}

// ── List handler ────────────────────────────────────────

async function handleList(positional: string[], json: boolean, project: boolean, cwd: string): Promise<void> {
  const feature = project ? null : positional[1] || undefined;

  if (feature !== undefined || project) {
    const filePath = resolveTasksPath(feature ?? null, cwd);
    const data = readTasksFile(filePath);
    if (!data) {
      if (json) console.log(JSON.stringify({ tasks: [], epics: [] }));
      else console.log("No tasks found.");
      return;
    }
    outputTaskList(data, json);
    return;
  }

  // All features
  const files = discoverTaskFiles(cwd);
  if (files.length === 0) {
    if (json) console.log(JSON.stringify({ tasks: [], epics: [] }));
    else console.log("No task files found.");
    return;
  }

  const allEpics: Epic[] = [];
  const allTasks: Task[] = [];
  for (const filePath of files) {
    const data = readTasksFile(filePath);
    if (!data) continue;
    allEpics.push(...data.epics);
    allTasks.push(...data.tasks);
  }

  outputTaskList({ version: SCHEMA_VERSION, epics: allEpics, tasks: allTasks }, json);
}

function outputTaskList(data: TasksFile, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ epics: data.epics, tasks: data.tasks }, null, 2));
    return;
  }

  if (data.tasks.length === 0 && data.epics.length === 0) {
    console.log("No tasks found.");
    return;
  }

  for (const epic of data.epics) {
    console.log(`\n${epic.id} — ${epic.title}`);
    console.log("-".repeat(epic.id.length + 3 + epic.title.length));

    const epicTasks = data.tasks.filter((t) => t.id.startsWith(epic.id + "."));
    if (epicTasks.length === 0) { console.log("  (no tasks)"); continue; }

    console.log(`  ${"ID".padEnd(20)} ${"Title".padEnd(40)} ${"Status".padEnd(14)} ${"Pri".padEnd(4)} Labels`);
    for (const task of epicTasks) {
      const status = task.status.replace("_", " ");
      const lbl = task.labels.length > 0 ? task.labels.join(", ") : "";
      console.log(`  ${task.id.padEnd(20)} ${task.title.slice(0, 40).padEnd(40)} ${status.padEnd(14)} P${task.priority}   ${lbl}`);
    }
  }
}

// ── Show handler ────────────────────────────────────────

async function handleShow(positional: string[], json: boolean, cwd: string): Promise<void> {
  const taskId = positional[1];
  if (!taskId) fail("Usage: forge tasks show <task-id>", json);

  const files = discoverTaskFiles(cwd);
  for (const filePath of files) {
    const data = readTasksFile(filePath);
    if (!data) continue;

    const epic = data.epics.find((e) => e.id === taskId);
    if (epic) {
      const epicTasks = data.tasks.filter((t) => t.id.startsWith(epic.id + "."));
      const counts = countByStatus(epicTasks);

      if (json) console.log(JSON.stringify({ type: "epic", ...epic, tasks: epicTasks.length, statusCounts: counts }, null, 2));
      else {
        console.log(`Epic: ${epic.id}`);
        console.log(`Title: ${epic.title}`);
        console.log(`Created: ${epic.created}`);
        console.log(`Tasks: ${epicTasks.length}`);
        console.log(`  open: ${counts.open}, in_progress: ${counts.in_progress}, closed: ${counts.closed}`);
      }
      return;
    }

    const task = data.tasks.find((t) => t.id === taskId);
    if (task) {
      if (json) { console.log(JSON.stringify(task, null, 2)); return; }

      console.log(`Task: ${task.id}`);
      console.log(`Title: ${task.title}`);
      console.log(`Status: ${task.status}`);
      console.log(`Priority: P${task.priority}`);
      if (task.labels.length > 0) console.log(`Labels: ${task.labels.join(", ")}`);
      if (task.description) console.log(`\nDescription:\n  ${task.description}`);
      if (task.design) console.log(`\nDesign:\n  ${task.design}`);
      if (task.acceptance.length > 0) {
        console.log(`\nAcceptance Criteria:`);
        for (const ac of task.acceptance) console.log(`  - ${ac}`);
      }
      if (task.notes) console.log(`\nNotes:\n  ${task.notes}`);
      if (task.dependencies.length > 0) console.log(`\nDependencies: ${task.dependencies.join(", ")}`);
      if (task.comments.length > 0) {
        console.log(`\nComments:`);
        for (const c of task.comments) console.log(`  [${c.timestamp}] ${c.message}`);
      }
      if (task.closeReason) console.log(`\nClose Reason: ${task.closeReason}`);
      return;
    }
  }

  fail(`Task "${taskId}" not found.`, json);
}

// ── Ready handler ───────────────────────────────────────

async function handleReady(positional: string[], json: boolean, cwd: string): Promise<void> {
  const feature = positional[1];
  const ready = getReadyTasks(cwd, feature);

  if (json) { console.log(JSON.stringify(ready, null, 2)); return; }

  if (ready.length === 0) { console.log("No ready tasks."); return; }

  console.log(`Ready tasks (${ready.length}):\n`);
  console.log(`${"ID".padEnd(20)} ${"Title".padEnd(40)} ${"Pri".padEnd(4)} Labels`);
  for (const task of ready) {
    const lbl = task.labels.length > 0 ? task.labels.join(", ") : "";
    console.log(`${task.id.padEnd(20)} ${task.title.slice(0, 40).padEnd(40)} P${task.priority}   ${lbl}`);
  }
}

// ── Helpers ─────────────────────────────────────────────

function countByStatus(tasks: Task[]): { open: number; in_progress: number; closed: number } {
  let open = 0, in_progress = 0, closed = 0;
  for (const t of tasks) {
    if (t.status === "open") open++;
    else if (t.status === "in_progress") in_progress++;
    else if (t.status === "closed") closed++;
  }
  return { open, in_progress, closed };
}
