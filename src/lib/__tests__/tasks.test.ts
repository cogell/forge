/**
 * Tests for src/lib/tasks.ts — types, constants, and file I/O.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { makeTmpDir } from "../../__tests__/helpers";
import {
  SCHEMA_VERSION,
  TASKS_FILENAME,
  MAX_NESTING_DEPTH,
  discoverTaskFiles,
  readTasksFile,
  readProjectPrefix,
  queryFeatureTasks,
  getReadyTasks,
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
  resolveTasksPath,
  isValidPrefix,
} from "../tasks";
import type { TasksFile, Task, Epic, Comment, TaskStatus, EpicInfo, ReadyTask, ValidateScope } from "../tasks";

// ─── Helpers ──────────────────────────────────────────────────────────
function writePlansDir(root: string, structure: Record<string, object | null>): void {
  const plansDir = join(root, "plans");
  mkdirSync(plansDir, { recursive: true });

  for (const [subdir, tasksData] of Object.entries(structure)) {
    if (subdir === "__root__") {
      // Write tasks.json directly in plans/
      if (tasksData !== null) {
        writeFileSync(join(plansDir, "tasks.json"), JSON.stringify(tasksData));
      }
    } else {
      const subdirPath = join(plansDir, subdir);
      mkdirSync(subdirPath, { recursive: true });
      if (tasksData !== null) {
        writeFileSync(join(subdirPath, "tasks.json"), JSON.stringify(tasksData));
      }
    }
  }
}

// ─── Constants ────────────────────────────────────────────────────────
describe("constants", () => {
  it("SCHEMA_VERSION is 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("TASKS_FILENAME is 'tasks.json'", () => {
    expect(TASKS_FILENAME).toBe("tasks.json");
  });

  it("MAX_NESTING_DEPTH is 3", () => {
    expect(MAX_NESTING_DEPTH).toBe(3);
  });
});

// ─── discoverTaskFiles ───────────────────────────────────────────────
describe("discoverTaskFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    mkdirSync(join(tmpDir, ".git"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when plans/ does not exist", () => {
    const result = discoverTaskFiles(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns empty array when plans/ has no subdirectories with tasks.json", () => {
    mkdirSync(join(tmpDir, "plans"), { recursive: true });
    const result = discoverTaskFiles(tmpDir);
    expect(result).toEqual([]);
  });

  it("discovers tasks.json in plan subdirectories", () => {
    const tasksData = { version: 1, epics: [], tasks: [] };
    writePlansDir(tmpDir, {
      "feature-a": tasksData,
      "feature-b": tasksData,
    });

    const result = discoverTaskFiles(tmpDir);
    expect(result).toHaveLength(2);
    expect(result).toContain(join(tmpDir, "plans", "feature-a", "tasks.json"));
    expect(result).toContain(join(tmpDir, "plans", "feature-b", "tasks.json"));
  });

  it("discovers plans/tasks.json at root level", () => {
    const tasksData = { version: 1, epics: [], tasks: [] };
    writePlansDir(tmpDir, {
      __root__: tasksData,
    });

    const result = discoverTaskFiles(tmpDir);
    expect(result).toHaveLength(1);
    expect(result).toContain(join(tmpDir, "plans", "tasks.json"));
  });

  it("discovers both root-level and subdirectory tasks.json files", () => {
    const tasksData = { version: 1, epics: [], tasks: [] };
    writePlansDir(tmpDir, {
      __root__: tasksData,
      "feature-x": tasksData,
    });

    const result = discoverTaskFiles(tmpDir);
    expect(result).toHaveLength(2);
    expect(result).toContain(join(tmpDir, "plans", "tasks.json"));
    expect(result).toContain(join(tmpDir, "plans", "feature-x", "tasks.json"));
  });

  it("skips directories without tasks.json", () => {
    const tasksData = { version: 1, epics: [], tasks: [] };
    writePlansDir(tmpDir, {
      "has-tasks": tasksData,
      "no-tasks": null, // directory exists but no tasks.json
    });

    const result = discoverTaskFiles(tmpDir);
    expect(result).toHaveLength(1);
    expect(result).toContain(join(tmpDir, "plans", "has-tasks", "tasks.json"));
  });

  it("skips dot-prefixed and underscore-prefixed directories", () => {
    const tasksData = { version: 1, epics: [], tasks: [] };
    writePlansDir(tmpDir, {
      "visible-feature": tasksData,
      ".hidden": tasksData,
      "_private": tasksData,
    });

    const result = discoverTaskFiles(tmpDir);
    expect(result).toHaveLength(1);
    expect(result).toContain(join(tmpDir, "plans", "visible-feature", "tasks.json"));
  });

  it("returns absolute paths", () => {
    const tasksData = { version: 1, epics: [], tasks: [] };
    writePlansDir(tmpDir, { "my-feature": tasksData });

    const result = discoverTaskFiles(tmpDir);
    for (const p of result) {
      expect(p.startsWith("/")).toBe(true);
    }
  });
});

// ─── readTasksFile ───────────────────────────────────────────────────
describe("readTasksFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when file does not exist", () => {
    const result = readTasksFile(join(tmpDir, "nonexistent.json"));
    expect(result).toBeNull();
  });

  it("parses a valid TasksFile", () => {
    const data: TasksFile = {
      version: 1,
      epics: [
        { id: "E-001", title: "Auth Epic", created: "2026-03-30" },
      ],
      tasks: [
        {
          id: "T-001",
          title: "Implement login",
          status: "open",
          priority: 1,
          labels: ["auth"],
          description: "Build the login flow",
          design: "Use OAuth2",
          acceptance: ["User can log in", "Session is created"],
          notes: "",
          dependencies: [],
          comments: [{ message: "Started design", timestamp: "2026-03-30T10:00:00Z" }],
          closeReason: null,
        },
      ],
    };

    const filePath = join(tmpDir, "tasks.json");
    writeFileSync(filePath, JSON.stringify(data));

    const result = readTasksFile(filePath);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.epics).toHaveLength(1);
    expect(result!.epics[0].id).toBe("E-001");
    expect(result!.tasks).toHaveLength(1);
    expect(result!.tasks[0].id).toBe("T-001");
    expect(result!.tasks[0].status).toBe("open");
    expect(result!.tasks[0].comments).toHaveLength(1);
    expect(result!.tasks[0].closeReason).toBeNull();
  });

  it("throws descriptive error on corrupt JSON", () => {
    const filePath = join(tmpDir, "bad.json");
    writeFileSync(filePath, "{ this is not valid json }}}");

    expect(() => readTasksFile(filePath)).toThrow();
    try {
      readTasksFile(filePath);
    } catch (e: any) {
      // Error message should mention the file path so the user can find the problem
      expect(e.message).toContain(filePath);
    }
  });

  it("throws descriptive error on non-JSON content", () => {
    const filePath = join(tmpDir, "plain.json");
    writeFileSync(filePath, "just some plain text");

    expect(() => readTasksFile(filePath)).toThrow();
    try {
      readTasksFile(filePath);
    } catch (e: any) {
      expect(e.message).toContain(filePath);
    }
  });
});

// ─── Type-level checks (compile-time only) ──────────────────────────
describe("type definitions", () => {
  it("TaskStatus union accepts valid values", () => {
    const statuses: TaskStatus[] = ["open", "in_progress", "closed"];
    expect(statuses).toHaveLength(3);
  });

  it("EpicInfo shape is correct", () => {
    const info: EpicInfo = {
      epics: [{ id: "E-001", title: "Test" }],
      primaryEpicId: "E-001",
      totalTasks: 5,
      closedTasks: 2,
      openTasks: 2,
      inProgressTasks: 1,
      allClosed: false,
    };
    expect(info.epics).toHaveLength(1);
    expect(info.primaryEpicId).toBe("E-001");
  });

  it("ReadyTask shape is correct", () => {
    const task: ReadyTask = {
      id: "T-001",
      title: "Do something",
      priority: 1,
      labels: ["backend"],
    };
    expect(task.id).toBe("T-001");
    expect(task.labels).toContain("backend");
  });
});

// ─── Helper: create a minimal task ──────────────────────────────────
function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    status: "open",
    priority: 2,
    labels: [],
    description: "",
    design: "",
    acceptance: [],
    notes: "",
    dependencies: [],
    comments: [],
    closeReason: null,
    ...overrides,
  };
}

function makeTasksFile(epics: Epic[], tasks: Task[]): TasksFile {
  return { version: 1, epics, tasks };
}

// ─── queryFeatureTasks ──────────────────────────────────────────────
describe("queryFeatureTasks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    mkdirSync(join(tmpDir, ".git"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when tasks.json does not exist", () => {
    // No plans/ directory at all
    const result = queryFeatureTasks("my-feature", tmpDir);
    expect(result).toBeNull();
  });

  it("returns null when tasks.json exists but has no tasks (empty scaffold)", () => {
    const data = makeTasksFile(
      [{ id: "feat-1", title: "Phase 1", created: "2026-03-30" }],
      [],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = queryFeatureTasks("my-feature", tmpDir);
    expect(result).toBeNull();
  });

  it("returns correct EpicInfo with aggregated counts", () => {
    const data = makeTasksFile(
      [{ id: "feat-1", title: "Phase 1", created: "2026-03-30" }],
      [
        makeTask({ id: "feat-1.1", title: "Task A", status: "closed" }),
        makeTask({ id: "feat-1.2", title: "Task B", status: "open" }),
        makeTask({ id: "feat-1.3", title: "Task C", status: "in_progress" }),
        makeTask({ id: "feat-1.4", title: "Task D", status: "closed" }),
      ],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = queryFeatureTasks("my-feature", tmpDir);
    expect(result).not.toBeNull();
    expect(result!.epics).toEqual([{ id: "feat-1", title: "Phase 1" }]);
    expect(result!.primaryEpicId).toBe("feat-1");
    expect(result!.totalTasks).toBe(4);
    expect(result!.closedTasks).toBe(2);
    expect(result!.openTasks).toBe(1);
    expect(result!.inProgressTasks).toBe(1);
    expect(result!.allClosed).toBe(false);
  });

  it("sets allClosed to true when all tasks are closed and every epic has tasks", () => {
    const data = makeTasksFile(
      [{ id: "feat-1", title: "Phase 1", created: "2026-03-30" }],
      [
        makeTask({ id: "feat-1.1", title: "Task A", status: "closed" }),
        makeTask({ id: "feat-1.2", title: "Task B", status: "closed" }),
      ],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = queryFeatureTasks("my-feature", tmpDir);
    expect(result).not.toBeNull();
    expect(result!.allClosed).toBe(true);
    expect(result!.totalTasks).toBe(2);
    expect(result!.closedTasks).toBe(2);
  });

  it("allClosed is false when an epic has zero tasks", () => {
    // Two epics: one with tasks, one without
    const data = makeTasksFile(
      [
        { id: "feat-1", title: "Phase 1", created: "2026-03-30" },
        { id: "feat-2", title: "Phase 2", created: "2026-03-30" },
      ],
      [
        // Only tasks for feat-1, none for feat-2
        makeTask({ id: "feat-1.1", title: "Task A", status: "closed" }),
        makeTask({ id: "feat-1.2", title: "Task B", status: "closed" }),
      ],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = queryFeatureTasks("my-feature", tmpDir);
    expect(result).not.toBeNull();
    expect(result!.allClosed).toBe(false);
  });

  it("handles multiple epics with correct aggregation", () => {
    const data = makeTasksFile(
      [
        { id: "feat-1", title: "Phase 1", created: "2026-03-30" },
        { id: "feat-2", title: "Phase 2", created: "2026-03-30" },
      ],
      [
        makeTask({ id: "feat-1.1", title: "Task A", status: "closed" }),
        makeTask({ id: "feat-2.1", title: "Task B", status: "open" }),
        makeTask({ id: "feat-2.2", title: "Task C", status: "in_progress" }),
      ],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = queryFeatureTasks("my-feature", tmpDir);
    expect(result).not.toBeNull();
    expect(result!.epics).toHaveLength(2);
    expect(result!.primaryEpicId).toBe("feat-1");
    expect(result!.totalTasks).toBe(3);
    expect(result!.closedTasks).toBe(1);
    expect(result!.openTasks).toBe(1);
    expect(result!.inProgressTasks).toBe(1);
    expect(result!.allClosed).toBe(false);
  });

  it("is synchronous (does not return a Promise)", () => {
    const data = makeTasksFile(
      [{ id: "feat-1", title: "Phase 1", created: "2026-03-30" }],
      [makeTask({ id: "feat-1.1", title: "Task A", status: "open" })],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = queryFeatureTasks("my-feature", tmpDir);
    // If it were async, result would be a Promise
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("returns primaryEpicId as empty string when no epics", () => {
    // Edge case: tasks exist but no epics array entries
    const data = makeTasksFile(
      [],
      [makeTask({ id: "feat-1.1", title: "Task A", status: "open" })],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = queryFeatureTasks("my-feature", tmpDir);
    expect(result).not.toBeNull();
    expect(result!.primaryEpicId).toBe("");
    expect(result!.epics).toEqual([]);
  });
});

// ─── getReadyTasks ──────────────────────────────────────────────────
describe("getReadyTasks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    mkdirSync(join(tmpDir, ".git"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no plans/ directory", () => {
    const result = getReadyTasks(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns open leaf tasks with no dependencies", () => {
    const data = makeTasksFile(
      [{ id: "feat-1", title: "Phase 1", created: "2026-03-30" }],
      [
        makeTask({ id: "feat-1.1", title: "Task A", status: "open" }),
        makeTask({ id: "feat-1.2", title: "Task B", status: "open" }),
      ],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = getReadyTasks(tmpDir);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.id).sort()).toEqual(["feat-1.1", "feat-1.2"]);
  });

  it("excludes container tasks (non-leaf tasks)", () => {
    const data = makeTasksFile(
      [{ id: "feat-1", title: "Phase 1", created: "2026-03-30" }],
      [
        makeTask({ id: "feat-1.1", title: "Container", status: "open" }),
        makeTask({ id: "feat-1.1.1", title: "Leaf child", status: "open" }),
        makeTask({ id: "feat-1.1.2", title: "Leaf child 2", status: "open" }),
        makeTask({ id: "feat-1.2", title: "Stand-alone leaf", status: "open" }),
      ],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = getReadyTasks(tmpDir);
    const ids = result.map((t) => t.id).sort();
    // feat-1.1 is a container (has children feat-1.1.1 and feat-1.1.2), so excluded
    expect(ids).toEqual(["feat-1.1.1", "feat-1.1.2", "feat-1.2"]);
  });

  it("excludes tasks with open dependencies", () => {
    const data = makeTasksFile(
      [{ id: "feat-1", title: "Phase 1", created: "2026-03-30" }],
      [
        makeTask({ id: "feat-1.1", title: "Blocker", status: "open" }),
        makeTask({
          id: "feat-1.2",
          title: "Blocked by 1.1",
          status: "open",
          dependencies: ["feat-1.1"],
        }),
      ],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = getReadyTasks(tmpDir);
    // feat-1.1 is ready (no deps), feat-1.2 is blocked by open feat-1.1
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("feat-1.1");
  });

  it("includes tasks whose dependencies are all closed", () => {
    const data = makeTasksFile(
      [{ id: "feat-1", title: "Phase 1", created: "2026-03-30" }],
      [
        makeTask({ id: "feat-1.1", title: "Done", status: "closed" }),
        makeTask({
          id: "feat-1.2",
          title: "Unblocked",
          status: "open",
          dependencies: ["feat-1.1"],
        }),
      ],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = getReadyTasks(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("feat-1.2");
  });

  it("includes tasks whose dependencies are in_progress (parallel execution)", () => {
    const data = makeTasksFile(
      [{ id: "feat-1", title: "Phase 1", created: "2026-03-30" }],
      [
        makeTask({ id: "feat-1.1", title: "In progress", status: "in_progress" }),
        makeTask({
          id: "feat-1.2",
          title: "Depends on in_progress",
          status: "open",
          dependencies: ["feat-1.1"],
        }),
      ],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = getReadyTasks(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("feat-1.2");
  });

  it("excludes closed and in_progress tasks from ready list", () => {
    const data = makeTasksFile(
      [{ id: "feat-1", title: "Phase 1", created: "2026-03-30" }],
      [
        makeTask({ id: "feat-1.1", title: "Closed", status: "closed" }),
        makeTask({ id: "feat-1.2", title: "In progress", status: "in_progress" }),
        makeTask({ id: "feat-1.3", title: "Open", status: "open" }),
      ],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = getReadyTasks(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("feat-1.3");
  });

  it("scopes to a single feature when feature is provided", () => {
    const dataA = makeTasksFile(
      [{ id: "alpha-1", title: "Alpha Phase", created: "2026-03-30" }],
      [makeTask({ id: "alpha-1.1", title: "Alpha Task", status: "open" })],
    );
    const dataB = makeTasksFile(
      [{ id: "beta-1", title: "Beta Phase", created: "2026-03-30" }],
      [makeTask({ id: "beta-1.1", title: "Beta Task", status: "open" })],
    );
    writePlansDir(tmpDir, { alpha: dataA, beta: dataB });

    const result = getReadyTasks(tmpDir, "alpha");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("alpha-1.1");
  });

  it("resolves cross-file dependencies when scoped to a feature", () => {
    const dataA = makeTasksFile(
      [{ id: "alpha-1", title: "Alpha Phase", created: "2026-03-30" }],
      [makeTask({ id: "alpha-1.1", title: "Alpha Blocker", status: "open" })],
    );
    const dataB = makeTasksFile(
      [{ id: "beta-1", title: "Beta Phase", created: "2026-03-30" }],
      [
        makeTask({
          id: "beta-1.1",
          title: "Depends on alpha",
          status: "open",
          dependencies: ["alpha-1.1"],
        }),
      ],
    );
    writePlansDir(tmpDir, { alpha: dataA, beta: dataB });

    // beta-1.1 depends on alpha-1.1 which is open => blocked
    const result = getReadyTasks(tmpDir, "beta");
    expect(result).toHaveLength(0);
  });

  it("resolves cross-file dependencies: unblocked when dep is closed", () => {
    const dataA = makeTasksFile(
      [{ id: "alpha-1", title: "Alpha Phase", created: "2026-03-30" }],
      [makeTask({ id: "alpha-1.1", title: "Alpha Done", status: "closed" })],
    );
    const dataB = makeTasksFile(
      [{ id: "beta-1", title: "Beta Phase", created: "2026-03-30" }],
      [
        makeTask({
          id: "beta-1.1",
          title: "Depends on alpha closed",
          status: "open",
          dependencies: ["alpha-1.1"],
        }),
      ],
    );
    writePlansDir(tmpDir, { alpha: dataA, beta: dataB });

    const result = getReadyTasks(tmpDir, "beta");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("beta-1.1");
  });

  it("returns all features' ready tasks when no feature is specified", () => {
    const dataA = makeTasksFile(
      [{ id: "alpha-1", title: "Alpha Phase", created: "2026-03-30" }],
      [makeTask({ id: "alpha-1.1", title: "Alpha Task", status: "open" })],
    );
    const dataB = makeTasksFile(
      [{ id: "beta-1", title: "Beta Phase", created: "2026-03-30" }],
      [makeTask({ id: "beta-1.1", title: "Beta Task", status: "open" })],
    );
    writePlansDir(tmpDir, { alpha: dataA, beta: dataB });

    const result = getReadyTasks(tmpDir);
    expect(result).toHaveLength(2);
    const ids = result.map((t) => t.id).sort();
    expect(ids).toEqual(["alpha-1.1", "beta-1.1"]);
  });

  it("returns ReadyTask shape with correct fields", () => {
    const data = makeTasksFile(
      [{ id: "feat-1", title: "Phase 1", created: "2026-03-30" }],
      [
        makeTask({
          id: "feat-1.1",
          title: "My Task",
          status: "open",
          priority: 3,
          labels: ["backend", "complexity:5"],
        }),
      ],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = getReadyTasks(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "feat-1.1",
      title: "My Task",
      priority: 3,
      labels: ["backend", "complexity:5"],
    });
  });

  it("is synchronous (does not return a Promise)", () => {
    const data = makeTasksFile(
      [{ id: "feat-1", title: "Phase 1", created: "2026-03-30" }],
      [makeTask({ id: "feat-1.1", title: "Task A", status: "open" })],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = getReadyTasks(tmpDir);
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("handles mixed: container excluded, blocked excluded, ready returned", () => {
    const data = makeTasksFile(
      [{ id: "feat-1", title: "Phase 1", created: "2026-03-30" }],
      [
        // Container task (has child feat-1.1.1)
        makeTask({ id: "feat-1.1", title: "Container", status: "open" }),
        makeTask({ id: "feat-1.1.1", title: "Leaf under container", status: "open" }),
        // Blocker chain
        makeTask({ id: "feat-1.2", title: "Blocker", status: "open" }),
        makeTask({
          id: "feat-1.3",
          title: "Blocked",
          status: "open",
          dependencies: ["feat-1.2"],
        }),
        // Already done
        makeTask({ id: "feat-1.4", title: "Already done", status: "closed" }),
        // In progress
        makeTask({ id: "feat-1.5", title: "Working on it", status: "in_progress" }),
        // Ready standalone
        makeTask({ id: "feat-1.6", title: "Free leaf", status: "open" }),
      ],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = getReadyTasks(tmpDir);
    const ids = result.map((t) => t.id).sort();
    // Ready: feat-1.1.1 (leaf, no deps), feat-1.2 (leaf, no deps), feat-1.6 (leaf, no deps)
    // Excluded: feat-1.1 (container), feat-1.3 (blocked by open feat-1.2), feat-1.4 (closed), feat-1.5 (in_progress)
    expect(ids).toEqual(["feat-1.1.1", "feat-1.2", "feat-1.6"]);
  });

  it("handles dependency on missing task ID gracefully (treats as open/blocking)", () => {
    // A dependency that references a non-existent task should block the task
    const data = makeTasksFile(
      [{ id: "feat-1", title: "Phase 1", created: "2026-03-30" }],
      [
        makeTask({
          id: "feat-1.1",
          title: "Depends on ghost",
          status: "open",
          dependencies: ["feat-999.1"],
        }),
      ],
    );
    writePlansDir(tmpDir, { "my-feature": data });

    const result = getReadyTasks(tmpDir);
    // Unknown dep => can't verify it's closed/in_progress => blocked
    expect(result).toHaveLength(0);
  });
});

// ─── readProjectPrefix ──────────────────────────────────────────────
describe("readProjectPrefix", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    mkdirSync(join(tmpDir, ".git"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns valid prefix from forge.json", () => {
    writeFileSync(join(tmpDir, "forge.json"), JSON.stringify({ prefix: "FORGE" }, null, 2) + "\n");
    expect(readProjectPrefix(tmpDir)).toBe("FORGE");
  });

  it("returns numeric prefix", () => {
    writeFileSync(join(tmpDir, "forge.json"), JSON.stringify({ prefix: "AB123" }, null, 2) + "\n");
    expect(readProjectPrefix(tmpDir)).toBe("AB123");
  });

  it("returns 2-char prefix (minimum)", () => {
    writeFileSync(join(tmpDir, "forge.json"), JSON.stringify({ prefix: "AB" }, null, 2) + "\n");
    expect(readProjectPrefix(tmpDir)).toBe("AB");
  });

  it("returns 10-char prefix (maximum)", () => {
    writeFileSync(join(tmpDir, "forge.json"), JSON.stringify({ prefix: "ABCDEFGHIJ" }, null, 2) + "\n");
    expect(readProjectPrefix(tmpDir)).toBe("ABCDEFGHIJ");
  });

  it("throws when forge.json is missing", () => {
    expect(() => readProjectPrefix(tmpDir)).toThrow(
      "No project key configured. Run forge init to set one."
    );
  });

  it("throws when prefix is lowercase", () => {
    writeFileSync(join(tmpDir, "forge.json"), JSON.stringify({ prefix: "forge" }, null, 2) + "\n");
    expect(() => readProjectPrefix(tmpDir)).toThrow();
  });

  it("throws when prefix contains hyphens", () => {
    writeFileSync(join(tmpDir, "forge.json"), JSON.stringify({ prefix: "MY-PRJ" }, null, 2) + "\n");
    expect(() => readProjectPrefix(tmpDir)).toThrow();
  });

  it("throws when prefix is empty string", () => {
    writeFileSync(join(tmpDir, "forge.json"), JSON.stringify({ prefix: "" }, null, 2) + "\n");
    expect(() => readProjectPrefix(tmpDir)).toThrow();
  });

  it("throws when prefix is too short (1 char)", () => {
    writeFileSync(join(tmpDir, "forge.json"), JSON.stringify({ prefix: "A" }, null, 2) + "\n");
    expect(() => readProjectPrefix(tmpDir)).toThrow();
  });

  it("throws when prefix is too long (11 chars)", () => {
    writeFileSync(join(tmpDir, "forge.json"), JSON.stringify({ prefix: "ABCDEFGHIJK" }, null, 2) + "\n");
    expect(() => readProjectPrefix(tmpDir)).toThrow();
  });

  it("throws when prefix field is missing from forge.json", () => {
    writeFileSync(join(tmpDir, "forge.json"), JSON.stringify({}, null, 2) + "\n");
    expect(() => readProjectPrefix(tmpDir)).toThrow();
  });

  it("throws when prefix contains spaces", () => {
    writeFileSync(join(tmpDir, "forge.json"), JSON.stringify({ prefix: "MY PRJ" }, null, 2) + "\n");
    expect(() => readProjectPrefix(tmpDir)).toThrow();
  });

  it("throws when prefix contains underscores", () => {
    writeFileSync(join(tmpDir, "forge.json"), JSON.stringify({ prefix: "MY_PRJ" }, null, 2) + "\n");
    expect(() => readProjectPrefix(tmpDir)).toThrow();
  });
});

// ─── Write Functions ────────────────────────────────────────────────

function setupProject(dir: string, prefix: string): void {
  mkdirSync(join(dir, ".git"), { recursive: true }); // resolveRepoRoot needs .git
  writeFileSync(join(dir, "forge.json"), JSON.stringify({ prefix }));
  mkdirSync(join(dir, "plans"), { recursive: true });
}

function setupFeature(dir: string, feature: string, data?: TasksFile): void {
  const featureDir = join(dir, "plans", feature);
  mkdirSync(featureDir, { recursive: true });
  if (data) {
    writeFileSync(join(featureDir, TASKS_FILENAME), JSON.stringify(data, null, 2) + "\n");
  }
}

function readJson(filePath: string): any {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

describe("writeTasksFile", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("produces 2-space-indented JSON with trailing newline", async () => {
    const filePath = join(tmpDir, "tasks.json");
    await writeTasksFile(filePath, { version: 1, epics: [], tasks: [] });
    const raw = readFileSync(filePath, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw.split("\n")[1]).toMatch(/^ {2}"/);
  });

  it("preserves schema key order for root object", async () => {
    const filePath = join(tmpDir, "tasks.json");
    await writeTasksFile(filePath, { version: 1, epics: [], tasks: [] });
    const keys = Object.keys(readJson(filePath));
    expect(keys).toEqual(["version", "epics", "tasks"]);
  });

  it("preserves schema key order within task objects", async () => {
    const filePath = join(tmpDir, "tasks.json");
    const task: Task = {
      id: "T-1.1", title: "Test", status: "open", priority: 2,
      labels: [], description: "", design: "", acceptance: [],
      notes: "", dependencies: [], comments: [], closeReason: null,
    };
    await writeTasksFile(filePath, { version: 1, epics: [], tasks: [task] });
    const taskKeys = Object.keys(readJson(filePath).tasks[0]);
    expect(taskKeys).toEqual([
      "id", "title", "status", "priority", "labels", "description",
      "design", "acceptance", "notes", "dependencies", "comments", "closeReason",
    ]);
  });

  it("propagates I/O errors as thrown exceptions", async () => {
    expect(writeTasksFile(join(tmpDir, "no", "dir", "tasks.json"), { version: 1, epics: [], tasks: [] })).rejects.toThrow();
  });
});

describe("createEpic", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("assigns sequential ID starting from 1", async () => {
    setupFeature(tmpDir, "auth");
    expect(await createEpic("auth", "Auth feature", tmpDir)).toBe("FORGE-1");
  });

  it("creates tasks.json if it doesn't exist", async () => {
    mkdirSync(join(tmpDir, "plans", "auth"), { recursive: true });
    await createEpic("auth", "Auth feature", tmpDir);
    expect(existsSync(join(tmpDir, "plans", "auth", TASKS_FILENAME))).toBe(true);
  });

  it("increments globally across multiple feature files", async () => {
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: [] });
    setupFeature(tmpDir, "tasks", { version: 1, epics: [{ id: "FORGE-2", title: "Tasks", created: "2026-03-30" }], tasks: [] });
    setupFeature(tmpDir, "pipeline");
    expect(await createEpic("pipeline", "Pipeline", tmpDir)).toBe("FORGE-3");
  });

  it("appends epic to existing epics array", async () => {
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Phase 1", created: "2026-03-30" }], tasks: [] });
    const epicId = await createEpic("auth", "Phase 2", tmpDir);
    expect(epicId).toBe("FORGE-2");
    const data = readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME));
    expect(data.epics).toHaveLength(2);
  });
});

describe("createTask", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("creates task under an epic with correct ID", async () => {
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: [] });
    expect(await createTask("auth", "Login", "FORGE-1", {}, tmpDir)).toBe("FORGE-1.1");
  });

  it("increments child number sequentially", async () => {
    const task: Task = { id: "FORGE-1.1", title: "T1", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null };
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: [task] });
    expect(await createTask("auth", "T2", "FORGE-1", {}, tmpDir)).toBe("FORGE-1.2");
  });

  it("creates subtask under a task (depth 3)", async () => {
    const task: Task = { id: "FORGE-1.1", title: "T1", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null };
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: [task] });
    expect(await createTask("auth", "Sub", "FORGE-1.1", {}, tmpDir)).toBe("FORGE-1.1.1");
  });

  it("rejects nesting beyond MAX_NESTING_DEPTH", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "T", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      { id: "FORGE-1.1.1", title: "S", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    expect(createTask("auth", "Deep", "FORGE-1.1.1", {}, tmpDir)).rejects.toThrow(/nesting/i);
  });

  it("errors when parent ID doesn't exist", async () => {
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: [] });
    expect(createTask("auth", "Orphan", "FORGE-999", {}, tmpDir)).rejects.toThrow(/parent/i);
  });

  it("sets correct defaults", async () => {
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: [] });
    await createTask("auth", "Default", "FORGE-1", {}, tmpDir);
    const task = readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME)).tasks[0];
    expect(task.status).toBe("open");
    expect(task.priority).toBe(2);
    expect(task.labels).toEqual([]);
    expect(task.dependencies).toEqual([]);
    expect(task.comments).toEqual([]);
    expect(task.closeReason).toBeNull();
  });

  it("accepts optional fields", async () => {
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: [] });
    await createTask("auth", "Rich", "FORGE-1", { priority: 1, labels: ["c:5"], description: "what", design: "how", acceptance: ["a", "b"], notes: "n" }, tmpDir);
    const task = readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME)).tasks[0];
    expect(task.priority).toBe(1);
    expect(task.labels).toEqual(["c:5"]);
    expect(task.acceptance).toEqual(["a", "b"]);
  });

  it("accepts blockedBy and populates dependencies", async () => {
    const existing: Task = { id: "FORGE-1.1", title: "Existing", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null };
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: [existing] });
    await createTask("auth", "New", "FORGE-1", { blockedBy: ["FORGE-1.1"] }, tmpDir);
    const newTask = readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME)).tasks[1];
    expect(newTask.dependencies).toEqual(["FORGE-1.1"]);
  });

  it("accepts multiple blockedBy ids", async () => {
    const t1: Task = { id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null };
    const t2: Task = { id: "FORGE-1.2", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null };
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: [t1, t2] });
    await createTask("auth", "New", "FORGE-1", { blockedBy: ["FORGE-1.1", "FORGE-1.2"] }, tmpDir);
    const newTask = readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME)).tasks[2];
    expect(newTask.dependencies).toEqual(["FORGE-1.1", "FORGE-1.2"]);
  });

  it("empty blockedBy leaves dependencies empty", async () => {
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: [] });
    await createTask("auth", "T", "FORGE-1", { blockedBy: [] }, tmpDir);
    const newTask = readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME)).tasks[0];
    expect(newTask.dependencies).toEqual([]);
  });

  it("rejects unknown blockedBy id and does not modify tasks.json", async () => {
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: [] });
    const filePath = join(tmpDir, "plans", "auth", TASKS_FILENAME);
    const before = readFileSync(filePath, "utf-8");
    await expect(createTask("auth", "T", "FORGE-1", { blockedBy: ["FORGE-999"] }, tmpDir)).rejects.toThrow(/FORGE-999/);
    expect(readFileSync(filePath, "utf-8")).toBe(before);
  });

  it("batch error names every unknown blockedBy id", async () => {
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: [] });
    let err: Error | null = null;
    try {
      await createTask("auth", "T", "FORGE-1", { blockedBy: ["FORGE-98", "FORGE-99"] }, tmpDir);
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toContain("FORGE-98");
    expect(err!.message).toContain("FORGE-99");
  });

  it("resolves blockedBy ids across feature files", async () => {
    const otherTask: Task = { id: "FORGE-2.1", title: "Other", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null };
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: [] });
    setupFeature(tmpDir, "pipeline", { version: 1, epics: [{ id: "FORGE-2", title: "Pipe", created: "2026-03-30" }], tasks: [otherTask] });
    await createTask("auth", "New", "FORGE-1", { blockedBy: ["FORGE-2.1"] }, tmpDir);
    const newTask = readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME)).tasks[0];
    expect(newTask.dependencies).toEqual(["FORGE-2.1"]);
  });
});

describe("addDep / removeDep", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("addDep appends blockerId to dependencies", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      { id: "FORGE-1.2", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    await addDep("FORGE-1.2", "FORGE-1.1", tmpDir);
    expect(readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME)).tasks[1].dependencies).toEqual(["FORGE-1.1"]);
  });

  it("addDep skips duplicates", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      { id: "FORGE-1.2", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["FORGE-1.1"], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    await addDep("FORGE-1.2", "FORGE-1.1", tmpDir);
    expect(readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME)).tasks[1].dependencies).toEqual(["FORGE-1.1"]);
  });

  it("removeDep removes blockerId", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      { id: "FORGE-1.2", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["FORGE-1.1"], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    await removeDep("FORGE-1.2", "FORGE-1.1", tmpDir);
    expect(readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME)).tasks[1].dependencies).toEqual([]);
  });

  it("addDep works across feature files", async () => {
    const authTasks: Task[] = [{ id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null }];
    const pipeTasks: Task[] = [{ id: "FORGE-2.1", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null }];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: authTasks });
    setupFeature(tmpDir, "pipeline", { version: 1, epics: [{ id: "FORGE-2", title: "Pipe", created: "2026-03-30" }], tasks: pipeTasks });
    await addDep("FORGE-2.1", "FORGE-1.1", tmpDir);
    expect(readJson(join(tmpDir, "plans", "pipeline", TASKS_FILENAME)).tasks[0].dependencies).toEqual(["FORGE-1.1"]);
  });
});

// ─── closeTask ──────────────────────────────────────────────────────

function makeCloseTasks(statuses: Record<string, TaskStatus>): Task[] {
  return Object.entries(statuses).map(([id, status]) => ({
    id, title: id, status, priority: 2, labels: [], description: "", design: "",
    acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null,
  }));
}

describe("closeTask", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("closes task with all deps closed", async () => {
    const tasks = makeCloseTasks({ "FORGE-1.1": "closed", "FORGE-1.2": "open" });
    tasks[1].dependencies = ["FORGE-1.1"];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    await closeTask("FORGE-1.2", {}, tmpDir);
    expect(readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME)).tasks[1].status).toBe("closed");
  });

  it("errors when dep is in_progress without --force", async () => {
    const tasks = makeCloseTasks({ "FORGE-1.1": "in_progress", "FORGE-1.2": "open" });
    tasks[1].dependencies = ["FORGE-1.1"];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    expect(closeTask("FORGE-1.2", {}, tmpDir)).rejects.toThrow(/in_progress/);
  });

  it("closes with in_progress dep when --force used", async () => {
    const tasks = makeCloseTasks({ "FORGE-1.1": "in_progress", "FORGE-1.2": "open" });
    tasks[1].dependencies = ["FORGE-1.1"];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    await closeTask("FORGE-1.2", { force: true }, tmpDir);
    expect(readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME)).tasks[1].status).toBe("closed");
  });

  it("errors when dep is open even with --force", async () => {
    const tasks = makeCloseTasks({ "FORGE-1.1": "open", "FORGE-1.2": "open" });
    tasks[1].dependencies = ["FORGE-1.1"];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    expect(closeTask("FORGE-1.2", { force: true }, tmpDir)).rejects.toThrow(/open/);
  });

  it("stores closeReason when provided", async () => {
    const tasks = makeCloseTasks({ "FORGE-1.1": "open" });
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    await closeTask("FORGE-1.1", { reason: "done via workaround" }, tmpDir);
    expect(readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME)).tasks[0].closeReason).toBe("done via workaround");
  });

  it("defaults closeReason to 'completed'", async () => {
    const tasks = makeCloseTasks({ "FORGE-1.1": "open" });
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    await closeTask("FORGE-1.1", {}, tmpDir);
    expect(readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME)).tasks[0].closeReason).toBe("completed");
  });

  it("auto-closes parent when last child closes", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "Container", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      { id: "FORGE-1.1.1", title: "Child A", status: "closed", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: "done" },
      { id: "FORGE-1.1.2", title: "Child B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    await closeTask("FORGE-1.1.2", {}, tmpDir);
    const data = readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[0].status).toBe("closed");
    expect(data.tasks[0].closeReason).toBe("all children closed");
  });

  it("errors when closing container with open children", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "Container", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      { id: "FORGE-1.1.1", title: "Open child", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    expect(closeTask("FORGE-1.1", {}, tmpDir)).rejects.toThrow(/children/);
  });
});

// ─── updateTask ─────────────────────────────────────────────────────

describe("updateTask", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("update --status open clears closeReason", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "T", status: "closed", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: "done" },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    await updateTask("FORGE-1.1", { status: "open" }, tmpDir);
    const data = readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[0].status).toBe("open");
    expect(data.tasks[0].closeReason).toBeNull();
  });

  it("update --status closed is rejected (must use forge tasks close)", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "T", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    expect(updateTask("FORGE-1.1", { status: "closed" }, tmpDir)).rejects.toThrow(/forge tasks close/);
  });

  it("updates title, priority, description, design, notes", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "Old", status: "open", priority: 3, labels: [], description: "old", design: "old", acceptance: [], notes: "old", dependencies: [], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    await updateTask("FORGE-1.1", { title: "New", priority: 1, description: "new", design: "new", notes: "new" }, tmpDir);
    const task = readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME)).tasks[0];
    expect(task.title).toBe("New");
    expect(task.priority).toBe(1);
    expect(task.description).toBe("new");
  });
});

// ─── addComment ─────────────────────────────────────────────────────

describe("addComment", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("appends comment with ISO 8601 timestamp", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "T", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    await addComment("FORGE-1.1", "Review feedback", tmpDir);
    const data = readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[0].comments).toHaveLength(1);
    expect(data.tasks[0].comments[0].message).toBe("Review feedback");
    expect(data.tasks[0].comments[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── addLabel ───────────────────────────────────────────────────────

describe("addLabel", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("adds label idempotently", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "T", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    await addLabel("FORGE-1.1", "needs-human", tmpDir);
    await addLabel("FORGE-1.1", "needs-human", tmpDir); // duplicate
    const data = readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[0].labels).toEqual(["needs-human"]);
  });
});

// ─── validateDag ────────────────────────────────────────────────────

describe("validateDag", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("passes valid DAG", () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      { id: "FORGE-1.2", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["FORGE-1.1"], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    const result = validateDag({ kind: "feature", name: "auth" }, tmpDir);
    expect(result.valid).toBe(true);
  });

  it("detects direct cycle", () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["FORGE-1.2"], comments: [], closeReason: null },
      { id: "FORGE-1.2", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["FORGE-1.1"], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    const result = validateDag({ kind: "feature", name: "auth" }, tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === "cycle")).toBe(true);
  });

  it("detects orphan dependency reference", () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["FORGE-999.1"], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    const result = validateDag({ kind: "feature", name: "auth" }, tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === "orphan-dep")).toBe(true);
  });

  it("detects orphan epic reference", () => {
    const tasks: Task[] = [
      { id: "FORGE-2.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    const result = validateDag({ kind: "feature", name: "auth" }, tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === "orphan-epic")).toBe(true);
  });

  it("detects duplicate IDs", () => {
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: [
      { id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ] });
    setupFeature(tmpDir, "other", { version: 1, epics: [{ id: "FORGE-2", title: "Other", created: "2026-03-30" }], tasks: [
      { id: "FORGE-1.1", title: "Duplicate", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ] });
    const result = validateDag({ kind: "all" }, tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === "duplicate-id")).toBe(true);
  });

  it("reports error when target file does not exist", () => {
    const result = validateDag({ kind: "feature", name: "nonexistent" }, tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/No tasks\.json found/);
  });

  it("validates project-level tasks", () => {
    // Write project-level tasks.json
    writeFileSync(join(tmpDir, "plans", TASKS_FILENAME), JSON.stringify({
      version: 1,
      epics: [{ id: "FORGE-1", title: "Project", created: "2026-03-30" }],
      tasks: [{ id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null }],
    }, null, 2) + "\n");
    const result = validateDag({ kind: "project" }, tmpDir);
    expect(result.valid).toBe(true);
  });

  it("detects cross-file cycles", () => {
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: [
      { id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["FORGE-2.1"], comments: [], closeReason: null },
    ] });
    setupFeature(tmpDir, "other", { version: 1, epics: [{ id: "FORGE-2", title: "Other", created: "2026-03-30" }], tasks: [
      { id: "FORGE-2.1", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["FORGE-1.1"], comments: [], closeReason: null },
    ] });
    const result = validateDag({ kind: "all" }, tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === "cycle")).toBe(true);
  });
});

// ─── Auto-close cascade (grandparent) ───────────────────────────────

describe("auto-close cascade", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("cascades parent when last child closes", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "Parent", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      { id: "FORGE-1.1.1", title: "Child A", status: "closed", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: "done" },
      { id: "FORGE-1.1.2", title: "Child B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });

    await closeTask("FORGE-1.1.2", {}, tmpDir);

    const data = readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[2].status).toBe("closed");
    expect(data.tasks[0].status).toBe("closed");
    expect(data.tasks[0].closeReason).toBe("all children closed");
  });

  it("cascades two levels: grandchild → parent → grandparent", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "Grandparent", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      { id: "FORGE-1.1.1", title: "Parent", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      { id: "FORGE-1.1.1.1", title: "Child A", status: "closed", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: "done" },
      { id: "FORGE-1.1.1.2", title: "Child B (last)", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });

    await closeTask("FORGE-1.1.1.2", {}, tmpDir);

    const data = readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME));
    // Child B closed directly
    expect(data.tasks[3].status).toBe("closed");
    // Parent auto-closed (both children done)
    expect(data.tasks[1].status).toBe("closed");
    expect(data.tasks[1].closeReason).toBe("all children closed");
    // Grandparent auto-closed (its only child, Parent, is now closed)
    expect(data.tasks[0].status).toBe("closed");
    expect(data.tasks[0].closeReason).toBe("all children closed");
  });
});

// ─── addDep blocker validation ──────────────────────────────────────

describe("addDep blocker validation", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("rejects dependency on nonexistent blocker ID", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    expect(addDep("FORGE-1.1", "FORGE-999.1", tmpDir)).rejects.toThrow(/not found/);
  });

  it("accepts cross-file blocker that exists", async () => {
    const authTasks: Task[] = [{ id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null }];
    const pipeTasks: Task[] = [{ id: "FORGE-2.1", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null }];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: authTasks });
    setupFeature(tmpDir, "pipeline", { version: 1, epics: [{ id: "FORGE-2", title: "Pipe", created: "2026-03-30" }], tasks: pipeTasks });
    // Should NOT throw — FORGE-1.1 exists in auth feature
    await addDep("FORGE-2.1", "FORGE-1.1", tmpDir);
    const data = readJson(join(tmpDir, "plans", "pipeline", TASKS_FILENAME));
    expect(data.tasks[0].dependencies).toEqual(["FORGE-1.1"]);
  });
});

// ─── createEpic project-level ───────────────────────────────────────

describe("createEpic project-level", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("creates epic in plans/tasks.json when feature is null", async () => {
    const id = await createEpic(null, "Project-wide epic", tmpDir);
    expect(id).toBe("FORGE-1");
    const data = readJson(join(tmpDir, "plans", TASKS_FILENAME));
    expect(data.epics).toHaveLength(1);
    expect(data.epics[0].title).toBe("Project-wide epic");
  });
});

// ─── resolveTasksPath (#8) ──────────────────────────────────────────

describe("resolveTasksPath", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); mkdirSync(join(tmpDir, ".git"), { recursive: true }); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("resolves to plans/<feature>/tasks.json when feature is provided", () => {
    expect(resolveTasksPath("auth", tmpDir)).toBe(join(tmpDir, "plans", "auth", "tasks.json"));
  });

  it("resolves to plans/tasks.json when feature is null", () => {
    expect(resolveTasksPath(null, tmpDir)).toBe(join(tmpDir, "plans", "tasks.json"));
  });
});

// ─── isValidPrefix (#8) ─────────────────────────────────────────────

describe("isValidPrefix", () => {
  it("accepts uppercase alphanumeric 2-10 chars", () => {
    expect(isValidPrefix("AB")).toBe(true);
    expect(isValidPrefix("FORGE")).toBe(true);
    expect(isValidPrefix("A1B2C3D4E5")).toBe(true);
  });

  it("rejects lowercase", () => {
    expect(isValidPrefix("forge")).toBe(false);
    expect(isValidPrefix("Forge")).toBe(false);
  });

  it("rejects too short (1 char)", () => {
    expect(isValidPrefix("A")).toBe(false);
  });

  it("rejects too long (11+ chars)", () => {
    expect(isValidPrefix("ABCDEFGHIJK")).toBe(false);
  });

  it("rejects hyphens and underscores", () => {
    expect(isValidPrefix("MY-APP")).toBe(false);
    expect(isValidPrefix("MY_APP")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidPrefix("")).toBe(false);
  });
});

// ─── readProjectPrefix malformed JSON (#4) ──────────────────────────

describe("readProjectPrefix malformed JSON", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); mkdirSync(join(tmpDir, ".git"), { recursive: true }); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("throws descriptive error on corrupt JSON in forge.json", () => {
    writeFileSync(join(tmpDir, "forge.json"), "{ not valid json }}}");
    expect(() => readProjectPrefix(tmpDir)).toThrow("forge.json contains invalid JSON");
  });
});

// ─── createTask when no tasks.json exists (#4) ──────────────────────

describe("createTask missing tasks.json", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("throws when no tasks.json exists for feature", async () => {
    mkdirSync(join(tmpDir, "plans", "auth"), { recursive: true });
    expect(createTask("auth", "A task", "FORGE-1", {}, tmpDir)).rejects.toThrow(/No tasks\.json found/);
  });
});

// ─── closeTask with missing dependency (#4) ──────────────────────────

describe("closeTask missing dependency", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("throws when dependency ID does not exist in any file", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["FORGE-99.1"], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    expect(closeTask("FORGE-1.1", {}, tmpDir)).rejects.toThrow(/dependency FORGE-99\.1 not found/);
  });
});

// ─── removeDep with nonexistent dep (#9) ────────────────────────────

describe("removeDep nonexistent", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("is a silent no-op when removing a dep that does not exist", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["FORGE-1.2"], comments: [], closeReason: null },
      { id: "FORGE-1.2", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });

    // Remove a dep that isn't in the list — should not throw
    await removeDep("FORGE-1.1", "FORGE-1.99", tmpDir);

    // Original dep should still be there
    const data = readJson(join(tmpDir, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[0].dependencies).toEqual(["FORGE-1.2"]);
  });
});

// ─── closeTask --force with in_progress cross-file dep (#7) ─────────

describe("closeTask cross-file force", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("rejects without --force when cross-file dep is in_progress", async () => {
    const authTasks: Task[] = [
      { id: "FORGE-1.1", title: "A", status: "in_progress", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ];
    const pipeTasks: Task[] = [
      { id: "FORGE-2.1", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["FORGE-1.1"], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: authTasks });
    setupFeature(tmpDir, "pipeline", { version: 1, epics: [{ id: "FORGE-2", title: "Pipe", created: "2026-03-30" }], tasks: pipeTasks });

    expect(closeTask("FORGE-2.1", {}, tmpDir)).rejects.toThrow(/in_progress.*--force/);
  });

  it("succeeds with --force when cross-file dep is in_progress", async () => {
    const authTasks: Task[] = [
      { id: "FORGE-1.1", title: "A", status: "in_progress", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ];
    const pipeTasks: Task[] = [
      { id: "FORGE-2.1", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["FORGE-1.1"], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: authTasks });
    setupFeature(tmpDir, "pipeline", { version: 1, epics: [{ id: "FORGE-2", title: "Pipe", created: "2026-03-30" }], tasks: pipeTasks });

    await closeTask("FORGE-2.1", { force: true }, tmpDir);

    const data = readJson(join(tmpDir, "plans", "pipeline", TASKS_FILENAME));
    expect(data.tasks[0].status).toBe("closed");
  });

  it("rejects even with --force when cross-file dep is open", async () => {
    const authTasks: Task[] = [
      { id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ];
    const pipeTasks: Task[] = [
      { id: "FORGE-2.1", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["FORGE-1.1"], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks: authTasks });
    setupFeature(tmpDir, "pipeline", { version: 1, epics: [{ id: "FORGE-2", title: "Pipe", created: "2026-03-30" }], tasks: pipeTasks });

    expect(closeTask("FORGE-2.1", { force: true }, tmpDir)).rejects.toThrow(/still open/);
  });
});

// ─── readTasksFile schema validation ──────────────────────────────────

describe("readTasksFile schema validation", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("throws on valid JSON that lacks epics/tasks arrays", () => {
    const filePath = join(tmpDir, "tasks.json");
    writeFileSync(filePath, JSON.stringify({ foo: "bar" }));
    expect(() => readTasksFile(filePath)).toThrow(/Invalid tasks\.json schema/);
  });

  it("throws when epics is not an array", () => {
    const filePath = join(tmpDir, "tasks.json");
    writeFileSync(filePath, JSON.stringify({ epics: "not-array", tasks: [] }));
    expect(() => readTasksFile(filePath)).toThrow(/Invalid tasks\.json schema/);
  });

  it("throws when tasks is not an array", () => {
    const filePath = join(tmpDir, "tasks.json");
    writeFileSync(filePath, JSON.stringify({ epics: [], tasks: "not-array" }));
    expect(() => readTasksFile(filePath)).toThrow(/Invalid tasks\.json schema/);
  });

  it("accepts valid minimal schema", () => {
    const filePath = join(tmpDir, "tasks.json");
    writeFileSync(filePath, JSON.stringify({ version: 1, epics: [], tasks: [] }));
    const result = readTasksFile(filePath);
    expect(result).not.toBeNull();
    expect(result!.epics).toEqual([]);
    expect(result!.tasks).toEqual([]);
  });
});

// ─── Feature name path traversal protection ───────────────────────────

describe("path traversal protection", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); mkdirSync(join(tmpDir, ".git"), { recursive: true }); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("rejects feature names with ..", () => {
    expect(() => resolveTasksPath("../../etc", tmpDir)).toThrow(/path separators or traversal/);
  });

  it("rejects feature names starting with /", () => {
    expect(() => resolveTasksPath("/etc/passwd", tmpDir)).toThrow(/path separators or traversal/);
  });

  it("rejects feature names starting with \\", () => {
    expect(() => resolveTasksPath("\\windows", tmpDir)).toThrow(/path separators or traversal/);
  });

  it("rejects feature names with embedded slashes", () => {
    expect(() => resolveTasksPath("foo/bar", tmpDir)).toThrow(/path separators or traversal/);
  });

  it("accepts normal feature names with hyphens", () => {
    expect(resolveTasksPath("my-feature", tmpDir)).toContain("plans/my-feature/tasks.json");
  });

  it("queryFeatureTasks rejects traversal", () => {
    setupProject(tmpDir, "FORGE");
    expect(() => queryFeatureTasks("../../../etc", tmpDir)).toThrow(/path separators or traversal/);
  });
});

// ─── removeDep with nonexistent blocked task ──────────────────────────

describe("removeDep nonexistent blocked task", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("throws when blocked task ID does not exist", async () => {
    const tasks: Task[] = [
      { id: "FORGE-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
    ];
    setupFeature(tmpDir, "auth", { version: 1, epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }], tasks });
    expect(removeDep("FORGE-999.1", "FORGE-1.1", tmpDir)).rejects.toThrow(/not found/);
  });
});

// ─── createTask project-level (feature = null) ────────────────────────

describe("createTask project-level", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("creates task under project-level epic", async () => {
    // Scaffold project-level tasks.json
    mkdirSync(join(tmpDir, "plans"), { recursive: true });
    writeFileSync(join(tmpDir, "plans", TASKS_FILENAME), JSON.stringify({
      version: 1,
      epics: [{ id: "FORGE-1", title: "Project Epic", created: "2026-03-30" }],
      tasks: [],
    }, null, 2) + "\n");

    const id = await createTask(null, "Project task", "FORGE-1", {}, tmpDir);
    expect(id).toBe("FORGE-1.1");
    const data = readJson(join(tmpDir, "plans", TASKS_FILENAME));
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].title).toBe("Project task");
  });
});

// ─── readProjectPrefix error specificity ─────────────────────────────

describe("readProjectPrefix error handling", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); mkdirSync(join(tmpDir, ".git"), { recursive: true }); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("throws 'no project key' for missing forge.json", () => {
    expect(() => readProjectPrefix(tmpDir)).toThrow(/No project key configured/);
  });

  it("re-throws non-ENOENT errors (e.g., directory instead of file)", () => {
    // Create forge.json as a directory to trigger EISDIR
    mkdirSync(join(tmpDir, "forge.json"), { recursive: true });
    expect(() => readProjectPrefix(tmpDir)).toThrow();
    try {
      readProjectPrefix(tmpDir);
    } catch (err) {
      // Should NOT say "No project key configured" — should be the actual I/O error
      expect((err as Error).message).not.toContain("No project key configured");
    }
  });
});

// ─── readTasksFile record validation ─────────────────────────────────

describe("readTasksFile record validation", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("rejects epic without string id", () => {
    const filePath = join(tmpDir, "tasks.json");
    writeFileSync(filePath, JSON.stringify({ version: 1, epics: [42], tasks: [] }));
    expect(() => readTasksFile(filePath)).toThrow(/Invalid epic at index 0/);
  });

  it("rejects task without string id", () => {
    const filePath = join(tmpDir, "tasks.json");
    writeFileSync(filePath, JSON.stringify({ version: 1, epics: [], tasks: [{ status: "open" }] }));
    expect(() => readTasksFile(filePath)).toThrow(/missing or non-string "id"/);
  });

  it("rejects task with invalid status", () => {
    const filePath = join(tmpDir, "tasks.json");
    writeFileSync(filePath, JSON.stringify({
      version: 1,
      epics: [],
      tasks: [{ id: "X-1.1", status: "invalid" }],
    }));
    expect(() => readTasksFile(filePath)).toThrow(/status must be "open", "in_progress", or "closed"/);
  });

  it("rejects null task", () => {
    const filePath = join(tmpDir, "tasks.json");
    writeFileSync(filePath, JSON.stringify({ version: 1, epics: [], tasks: [null] }));
    expect(() => readTasksFile(filePath)).toThrow(/Invalid task at index 0/);
  });

  it("accepts valid records", () => {
    const filePath = join(tmpDir, "tasks.json");
    writeFileSync(filePath, JSON.stringify({
      version: 1,
      epics: [{ id: "X-1", title: "E", created: "2026-01-01" }],
      tasks: [{ id: "X-1.1", title: "T", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null }],
    }));
    const result = readTasksFile(filePath);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
  });
});

// ─── getReadyTasks with project-level tasks ──────────────────────────

describe("getReadyTasks includes project-level tasks", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("returns ready tasks from project-level tasks.json", () => {
    writeFileSync(join(tmpDir, "plans", TASKS_FILENAME), JSON.stringify({
      version: 1,
      epics: [{ id: "FORGE-1", title: "Project Work", created: "2026-03-30" }],
      tasks: [
        { id: "FORGE-1.1", title: "Project task", status: "open", priority: 1, labels: ["infra"], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    }));

    const ready = getReadyTasks(tmpDir);
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe("FORGE-1.1");
  });

  it("returns ready tasks from both project-level and feature files", () => {
    // Project-level
    writeFileSync(join(tmpDir, "plans", TASKS_FILENAME), JSON.stringify({
      version: 1,
      epics: [{ id: "FORGE-1", title: "Project Work", created: "2026-03-30" }],
      tasks: [
        { id: "FORGE-1.1", title: "Project task", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    }));
    // Feature-level
    const featureDir = join(tmpDir, "plans", "auth");
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, TASKS_FILENAME), JSON.stringify({
      version: 1,
      epics: [{ id: "FORGE-2", title: "Auth", created: "2026-03-30" }],
      tasks: [
        { id: "FORGE-2.1", title: "Auth task", status: "open", priority: 1, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    }));

    const ready = getReadyTasks(tmpDir);
    expect(ready.length).toBe(2);
    // Should be sorted by priority
    expect(ready[0].id).toBe("FORGE-2.1"); // priority 1
    expect(ready[1].id).toBe("FORGE-1.1"); // priority 2
  });
});

// ─── getReadyTasks sorts by priority ─────────────────────────────────

describe("getReadyTasks priority sorting", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); setupProject(tmpDir, "FORGE"); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("returns tasks sorted by priority ascending (0 = highest)", () => {
    const featureDir = join(tmpDir, "plans", "auth");
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, TASKS_FILENAME), JSON.stringify({
      version: 1,
      epics: [{ id: "FORGE-1", title: "Auth", created: "2026-03-30" }],
      tasks: [
        { id: "FORGE-1.1", title: "Low priority", status: "open", priority: 4, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
        { id: "FORGE-1.2", title: "High priority", status: "open", priority: 0, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
        { id: "FORGE-1.3", title: "Medium priority", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    }));

    const ready = getReadyTasks(tmpDir);
    expect(ready.length).toBe(3);
    expect(ready[0].priority).toBe(0);
    expect(ready[1].priority).toBe(2);
    expect(ready[2].priority).toBe(4);
  });
});
