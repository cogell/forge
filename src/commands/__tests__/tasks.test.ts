/**
 * Integration tests for src/commands/tasks.ts CLI dispatch.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { makeTmpDir, setupTestProject } from "../../__tests__/helpers";
import { SCHEMA_VERSION, TASKS_FILENAME } from "../../lib/tasks";
import type { TasksFile } from "../../lib/tasks";
import { tasks } from "../tasks";

function setupFeature(dir: string, feature: string, data?: TasksFile): void {
  const featureDir = join(dir, "plans", feature);
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, "plan.md"), "---\nstatus: active\n---\n# Plan\n");
  if (data) {
    writeFileSync(join(featureDir, TASKS_FILENAME), JSON.stringify(data, null, 2) + "\n");
  }
}

function readJson(filePath: string): any {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

describe("forge tasks CLI", () => {
  let tmp: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmp = makeTmpDir("forge-tasks-cmd");
    originalCwd = process.cwd();
    process.chdir(tmp);
    setupTestProject(tmp, "TEST");
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it("scaffold creates empty tasks.json for feature", async () => {
    setupFeature(tmp, "auth");
    await tasks(["auth"]);

    const filePath = join(tmp, "plans", "auth", TASKS_FILENAME);
    expect(existsSync(filePath)).toBe(true);
    const data = readJson(filePath);
    expect(data.version).toBe(SCHEMA_VERSION);
    expect(data.epics).toEqual([]);
    expect(data.tasks).toEqual([]);
  });

  it("scaffold shows summary when tasks.json exists", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "Auth", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "Login", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["auth"]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Feature: auth"));
  });

  it("errors without forge.json", async () => {
    rmSync(join(tmp, "forge.json"));
    try { await tasks(["auth"]); } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("ready returns ready tasks as JSON", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "Phase 1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "Ready task", status: "open", priority: 1, labels: ["backend"], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
        { id: "TEST-1.2", title: "Blocked", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["TEST-1.1"], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["ready", "--json"]);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("TEST-1.1");
  });

  it("list outputs tasks as JSON", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "Phase 1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "Task A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["list", "auth", "--json"]);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.epics).toHaveLength(1);
    expect(parsed.tasks).toHaveLength(1);
  });

  it("show displays task details as JSON", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "Phase 1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "Show me", status: "open", priority: 1, labels: ["ui"], description: "What", design: "How", acceptance: ["Works"], notes: "N", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["show", "TEST-1.1", "--json"]);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.id).toBe("TEST-1.1");
    expect(parsed.title).toBe("Show me");
  });

  it("dep add/remove round-trip works", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
        { id: "TEST-1.2", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);

    await tasks(["dep", "add", "TEST-1.2", "TEST-1.1"]);
    let data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[1].dependencies).toEqual(["TEST-1.1"]);

    await tasks(["dep", "remove", "TEST-1.2", "TEST-1.1"]);
    data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[1].dependencies).toEqual([]);
  });

  it("close stores reason", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["close", "TEST-1.1", "--reason", "done via workaround"]);

    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[0].status).toBe("closed");
    expect(data.tasks[0].closeReason).toBe("done via workaround");
  });

  it("update changes status", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["update", "TEST-1.1", "--status", "in_progress"]);

    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[0].status).toBe("in_progress");
  });

  it("validate passes on clean DAG", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["validate", "auth", "--json"]);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.valid).toBe(true);
  });

  it("--project scaffolds plans/tasks.json", async () => {
    await tasks(["--project"]);

    const filePath = join(tmp, "plans", TASKS_FILENAME);
    expect(existsSync(filePath)).toBe(true);
    const data = readJson(filePath);
    expect(data.version).toBe(SCHEMA_VERSION);
  });

  it("update --status closed is rejected via CLI", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    try { await tasks(["update", "TEST-1.1", "--status", "closed"]); } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("reserved words are dispatched as subcommands, not feature names", async () => {
    // "list" is a reserved subcommand — should not scaffold a feature called "list"
    await tasks(["list", "--json"]);
    // Should output JSON, not create plans/list/tasks.json
    expect(existsSync(join(tmp, "plans", "list", TASKS_FILENAME))).toBe(false);
  });

  // ── extractPositional / flag parsing (#2) ───────────────────────

  it("extractPositional skips value flags and their arguments", async () => {
    // "create auth 'My task' --parent TEST-1 --priority 1 --label foo"
    // positional should be: ["create", "auth", "My task"]
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [],
    };
    setupFeature(tmp, "auth", tasksData);

    await tasks(["create", "auth", "My task", "--parent", "TEST-1", "--priority", "1", "--label", "backend"]);
    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].title).toBe("My task");
    expect(data.tasks[0].priority).toBe(1);
    expect(data.tasks[0].labels).toEqual(["backend"]);
  });

  it("extractPositional handles boolean flags (--json, --force, --project)", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["close", "TEST-1.1", "--json", "--force"]);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.status).toBe("closed");
  });

  // ── handleCreate --parent defaulting (#2) ──────────────────────

  it("create defaults --parent to sole epic", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [],
    };
    setupFeature(tmp, "auth", tasksData);

    // No --parent flag — should default to TEST-1
    await tasks(["create", "auth", "Auto-parented task"]);
    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].id).toBe("TEST-1.1");
  });

  it("create errors when no epics exist and no --parent", async () => {
    const tasksData: TasksFile = { version: 1, epics: [], tasks: [] };
    setupFeature(tmp, "auth", tasksData);

    try { await tasks(["create", "auth", "Orphan task"]); } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("No epics found"));
  });

  it("create errors when multiple epics and no --parent", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [
        { id: "TEST-1", title: "P1", created: "2026-03-30" },
        { id: "TEST-2", title: "P2", created: "2026-03-30" },
      ],
      tasks: [],
    };
    setupFeature(tmp, "auth", tasksData);

    try { await tasks(["create", "auth", "Ambiguous task"]); } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Multiple epics"));
  });

  // ── handleEpic CLI wiring (#3) ────────────────────────────────

  it("epic create with feature creates epic and returns ID", async () => {
    setupFeature(tmp, "auth");
    // Scaffold first
    await tasks(["auth"]);

    await tasks(["epic", "create", "auth", "Phase 1: Core"]);
    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.epics).toHaveLength(1);
    expect(data.epics[0].id).toBe("TEST-1");
    expect(data.epics[0].title).toBe("Phase 1: Core");
  });

  it("epic create with --project creates epic in plans/tasks.json", async () => {
    await tasks(["--project"]);

    await tasks(["epic", "create", "--project", "Global Epic"]);
    const data = readJson(join(tmp, "plans", TASKS_FILENAME));
    expect(data.epics).toHaveLength(1);
    expect(data.epics[0].title).toBe("Global Epic");
  });

  it("epic create errors on missing title", async () => {
    setupFeature(tmp, "auth");
    await tasks(["auth"]);

    try { await tasks(["epic", "create", "auth"]); } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Missing epic title"));
  });

  it("epic create errors on unknown subcommand", async () => {
    try { await tasks(["epic", "delete"]); } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown epic subcommand"));
  });

  // ── epic create --id (FORGE-3.6) ──────────────────────────────

  it("epic create --id uses the explicit id verbatim", async () => {
    setupFeature(tmp, "auth");
    await tasks(["auth"]);

    await tasks(["epic", "create", "auth", "--id", "TEST-9", "Pinned epic"]);
    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.epics).toHaveLength(1);
    expect(data.epics[0].id).toBe("TEST-9");
    expect(data.epics[0].title).toBe("Pinned epic");
  });

  it("epic create --id rejects malformed id before writing", async () => {
    setupFeature(tmp, "auth");
    await tasks(["auth"]);

    try { await tasks(["epic", "create", "auth", "--id", "BADFORMAT", "X"]); } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("invalid epic id BADFORMAT"));
    // tasks.json remains an empty scaffold (no epics added)
    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.epics).toEqual([]);
  });

  it("epic create --id rejects a duplicate and names the conflicting feature/title", async () => {
    setupFeature(tmp, "auth", {
      version: 1,
      epics: [{ id: "TEST-9", title: "Original", created: "2026-03-30" }],
      tasks: [],
    });
    setupFeature(tmp, "pipeline");
    await tasks(["pipeline"]);

    try { await tasks(["epic", "create", "pipeline", "--id", "TEST-9", "Duplicate"]); } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/TEST-9.*auth.*Original/));
    // pipeline tasks.json unmodified
    const pipelineData = readJson(join(tmp, "plans", "pipeline", TASKS_FILENAME));
    expect(pipelineData.epics).toEqual([]);
  });

  // ── handleList all features (#5) ──────────────────────────────

  it("list with no feature aggregates all task files", async () => {
    const authData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "Auth", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "Login", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    const pipeData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-2", title: "Pipe", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-2.1", title: "Ingest", status: "closed", priority: 1, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: "done" },
      ],
    };
    setupFeature(tmp, "auth", authData);
    setupFeature(tmp, "pipeline", pipeData);

    await tasks(["list", "--json"]);
    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.epics).toHaveLength(2);
    expect(parsed.tasks).toHaveLength(2);
  });

  it("list with no features returns empty", async () => {
    await tasks(["list", "--json"]);
    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.tasks).toEqual([]);
  });

  // ── handleValidate failing case (#6) ──────────────────────────

  it("validate exits 1 and reports errors on invalid DAG", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["TEST-1.2"], comments: [], closeReason: null },
        { id: "TEST-1.2", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["TEST-1.1"], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    try { await tasks(["validate", "auth"]); } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("error"));
  });

  it("validate --json returns errors in structured format on invalid DAG", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["TEST-1.2"], comments: [], closeReason: null },
        { id: "TEST-1.2", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["TEST-1.1"], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    try { await tasks(["validate", "auth", "--json"]); } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  // ── handleComment CLI wiring (#3-adjacent) ────────────────────

  it("comment adds message to task", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["comment", "TEST-1.1", "Needs review"]);
    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[0].comments).toHaveLength(1);
    expect(data.tasks[0].comments[0].message).toBe("Needs review");
  });

  // ── handleLabel CLI wiring (#3-adjacent) ──────────────────────

  it("label adds label to task", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["label", "TEST-1.1", "needs-human"]);
    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[0].labels).toEqual(["needs-human"]);
  });

  // ── handleShow for epic IDs (#3-adjacent) ─────────────────────

  it("show displays epic details as JSON", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "Phase 1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
        { id: "TEST-1.2", title: "B", status: "closed", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: "done" },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["show", "TEST-1", "--json"]);
    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe("epic");
    expect(parsed.id).toBe("TEST-1");
    expect(parsed.tasks).toBe(2);
    expect(parsed.statusCounts.open).toBe(1);
    expect(parsed.statusCounts.closed).toBe(1);
  });

  // ── handleUpdate with various flags (#2-adjacent) ─────────────

  it("update changes title, description, design, and notes", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "Old", status: "open", priority: 2, labels: [], description: "old desc", design: "old design", acceptance: [], notes: "old notes", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["update", "TEST-1.1", "--title", "New Title", "-d", "new desc", "--design", "new design", "--notes", "new notes"]);

    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[0].title).toBe("New Title");
    expect(data.tasks[0].description).toBe("new desc");
    expect(data.tasks[0].design).toBe("new design");
    expect(data.tasks[0].notes).toBe("new notes");
  });

  // ── Priority validation ─────────────────────────────────────

  it("create rejects non-numeric --priority", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [],
    };
    setupFeature(tmp, "auth", tasksData);

    try {
      await tasks(["create", "auth", "My task", "--parent", "TEST-1", "--priority", "abc"]);
    } catch {}

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some((c: string[]) => c[0]?.includes("Invalid priority"))).toBe(true);
  });

  it("create rejects out-of-range --priority", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [],
    };
    setupFeature(tmp, "auth", tasksData);

    try {
      await tasks(["create", "auth", "My task", "--parent", "TEST-1", "--priority", "9"]);
    } catch {}

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some((c: string[]) => c[0]?.includes("Invalid priority"))).toBe(true);
  });

  // ── --blocked-by flag (FORGE-3.3) ───────────────────────────────

  it("create --blocked-by adds a single dependency", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "Blocker", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);

    await tasks(["create", "auth", "Blocked task", "--parent", "TEST-1", "--blocked-by", "TEST-1.1"]);
    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    const created = data.tasks.find((t: any) => t.title === "Blocked task");
    expect(created).toBeDefined();
    expect(created.dependencies).toEqual(["TEST-1.1"]);
  });

  it("create --blocked-by is repeatable", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
        { id: "TEST-1.2", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);

    await tasks(["create", "auth", "Blocked", "--parent", "TEST-1", "--blocked-by", "TEST-1.1", "--blocked-by", "TEST-1.2"]);
    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    const created = data.tasks.find((t: any) => t.title === "Blocked");
    expect(created.dependencies).toEqual(["TEST-1.1", "TEST-1.2"]);
  });

  it("create --blocked-by UNKNOWN exits non-zero and does not write", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [],
    };
    setupFeature(tmp, "auth", tasksData);
    const filePath = join(tmp, "plans", "auth", TASKS_FILENAME);
    const before = readFileSync(filePath, "utf-8");

    try {
      await tasks(["create", "auth", "Blocked", "--parent", "TEST-1", "--blocked-by", "UNKNOWN-ID"]);
    } catch {}

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some((c: string[]) => c[0]?.includes("UNKNOWN-ID"))).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe(before);
  });

  it("create --blocked-by batch error names all unknown ids", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [],
    };
    setupFeature(tmp, "auth", tasksData);

    try {
      await tasks(["create", "auth", "Blocked", "--parent", "TEST-1", "--blocked-by", "UNK-1", "--blocked-by", "UNK-2"]);
    } catch {}

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errMsgs = errorSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
    expect(errMsgs).toContain("UNK-1");
    expect(errMsgs).toContain("UNK-2");
  });

  it("create --blocked-by resolves cross-feature blocker ids", async () => {
    const authData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [],
    };
    const pipeData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-2", title: "P2", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-2.1", title: "Cross-blocker", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", authData);
    setupFeature(tmp, "pipeline", pipeData);

    await tasks(["create", "auth", "Cross blocked", "--parent", "TEST-1", "--blocked-by", "TEST-2.1"]);
    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    const created = data.tasks.find((t: any) => t.title === "Cross blocked");
    expect(created.dependencies).toEqual(["TEST-2.1"]);
  });

  it("update rejects --status closed with helpful message", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "T", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);

    try {
      await tasks(["update", "TEST-1.1", "--status", "closed"]);
    } catch {}

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some((c: string[]) => c[0]?.includes("forge tasks close"))).toBe(true);
  });

  it("update rejects when no fields provided", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "T", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);

    try {
      await tasks(["update", "TEST-1.1"]);
    } catch {}

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some((c: string[]) => c[0]?.includes("No fields to update"))).toBe(true);
  });

  it("update rejects non-numeric --priority", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "T", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);

    try {
      await tasks(["update", "TEST-1.1", "--priority", "xyz"]);
    } catch {}

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some((c: string[]) => c[0]?.includes("Invalid priority"))).toBe(true);
  });

  // ── Epic subcommand error ───────────────────────────────────

  it("epic without subcommand shows helpful error", async () => {
    try {
      await tasks(["epic"]);
    } catch {}

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some((c: string[]) => c[0]?.includes("Available: create"))).toBe(true);
  });

  // ── Help system (#1, #2, #5) ─────────────────────────────────

  it("--help prints tasks overview", async () => {
    await tasks(["--help"]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("forge tasks — task management"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Subcommands:"));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("-h prints tasks overview", async () => {
    await tasks(["-h"]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("forge tasks — task management"));
  });

  it("bare 'forge tasks' (no args) prints tasks overview", async () => {
    await tasks([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("forge tasks — task management"));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("create --help prints create usage", async () => {
    await tasks(["create", "--help"]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("forge tasks create"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("--acceptance"));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("update --help prints update usage", async () => {
    await tasks(["update", "--help"]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("forge tasks update"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("--acceptance"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("--label"));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("show --help prints show usage", async () => {
    await tasks(["show", "--help"]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("forge tasks show"));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("close --help prints close usage", async () => {
    await tasks(["close", "-h"]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("forge tasks close"));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("dep --help prints dep usage", async () => {
    await tasks(["dep", "--help"]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("forge tasks dep"));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("list --help prints list usage", async () => {
    await tasks(["list", "--help"]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("forge tasks list"));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("epic --help prints epic usage", async () => {
    await tasks(["epic", "--help"]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("forge tasks epic"));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  // ── Update with --acceptance and --label (#3) ────────────────

  it("update appends acceptance criteria", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "T", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: ["Existing"], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["update", "TEST-1.1", "--acceptance", "New criterion", "-a", "Another one"]);

    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[0].acceptance).toEqual(["Existing", "New criterion", "Another one"]);
  });

  it("update appends labels (idempotent)", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "T", status: "open", priority: 2, labels: ["existing"], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["update", "TEST-1.1", "--label", "new-label", "-l", "existing"]);

    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[0].labels).toEqual(["existing", "new-label"]);
  });

  it("update with only --acceptance counts as having fields", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "T", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["update", "TEST-1.1", "-a", "Works correctly"]);

    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[0].acceptance).toEqual(["Works correctly"]);
  });

  it("update --replace with --acceptance replaces existing acceptance array", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "T", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: ["old-1", "old-2", "old-3"], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["update", "TEST-1.1", "--acceptance", "first", "--acceptance", "second", "--replace"]);

    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[0].acceptance).toEqual(["first", "second"]);
  });

  it("update without --replace preserves append behavior (backward-compatible)", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "T", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: ["existing"], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["update", "TEST-1.1", "--acceptance", "added"]);

    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[0].acceptance).toEqual(["existing", "added"]);
  });

  it("update --replace without --acceptance is a no-op (exit 0, no write, no error)", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "T", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: ["keep-1", "keep-2"], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    const filePath = join(tmp, "plans", "auth", TASKS_FILENAME);
    const before = readFileSync(filePath, "utf-8");

    await tasks(["update", "TEST-1.1", "--replace"]);

    // No error, no exit(1)
    expect(exitSpy).not.toHaveBeenCalled();
    // File unchanged byte-for-byte
    expect(readFileSync(filePath, "utf-8")).toBe(before);
  });

  it("update --help mentions --replace flag", async () => {
    await tasks(["update", "--help"]);
    expect(logSpy.mock.calls.some((c: string[]) => c[0]?.includes("--replace"))).toBe(true);
  });

  // ── Improved error messages (#4) ─────────────────────────────

  it("show not-found error includes usage hint", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);

    try { await tasks(["show", "auth"]); } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some((c: string[]) => c[0]?.includes("Usage: forge tasks show <task-id>"))).toBe(true);
  });

  it("update no-fields error lists all available flags", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "T", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);

    try { await tasks(["update", "TEST-1.1"]); } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorMsg = errorSpy.mock.calls.map((c: string[]) => c[0]).join(" ");
    expect(errorMsg).toContain("--acceptance");
    expect(errorMsg).toContain("--label");
    expect(errorMsg).toContain("forge tasks close");
  });

  it("update -p short flag works for priority", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "T", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    await tasks(["update", "TEST-1.1", "-p", "0"]);

    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks[0].priority).toBe(0);
  });

  // ── forge tasks delete ──────────────────────────────────────

  it("delete without --confirm prints preview and exits 0 without writing", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "To delete", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);

    await tasks(["delete", "TEST-1.1"]);
    // Dry-run is a successful no-op: process.exit must NOT have been called.
    expect(exitSpy).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.map((c: string[]) => c.join(" ")).join("\n");
    expect(logged).toContain("TEST-1.1");
    expect(logged).toContain("To delete");
    expect(logged).toContain("Re-run with --confirm");

    // File must be unchanged
    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks).toHaveLength(1);
  });

  it("delete --confirm with no descendants removes task atomically", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
        { id: "TEST-1.2", title: "B", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);

    await tasks(["delete", "TEST-1.1", "--confirm"]);

    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].id).toBe("TEST-1.2");
  });

  it("delete --confirm strips the deleted id from other tasks' dependencies", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "Target", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
        { id: "TEST-1.2", title: "Dependent", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: ["TEST-1.1"], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);

    await tasks(["delete", "TEST-1.1", "--confirm"]);

    const data = readJson(join(tmp, "plans", "auth", TASKS_FILENAME));
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].id).toBe("TEST-1.2");
    expect(data.tasks[0].dependencies).toEqual([]);
  });

  it("delete --confirm on a task with descendants exits non-zero and leaves file unmodified", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "Parent", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
        { id: "TEST-1.1.1", title: "Child", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    const before = readFileSync(join(tmp, "plans", "auth", TASKS_FILENAME), "utf-8");

    try { await tasks(["delete", "TEST-1.1", "--confirm"]); } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorMsg = errorSpy.mock.calls.map((c: string[]) => c[0]).join(" ");
    expect(errorMsg).toContain("TEST-1.1.1");

    const after = readFileSync(join(tmp, "plans", "auth", TASKS_FILENAME), "utf-8");
    expect(after).toBe(before);
  });

  it("delete --confirm on unknown id exits non-zero with a clear message", async () => {
    const tasksData: TasksFile = {
      version: 1,
      epics: [{ id: "TEST-1", title: "P1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "A", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
    setupFeature(tmp, "auth", tasksData);
    const before = readFileSync(join(tmp, "plans", "auth", TASKS_FILENAME), "utf-8");

    try { await tasks(["delete", "UNKNOWN-9.9", "--confirm"]); } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorMsg = errorSpy.mock.calls.map((c: string[]) => c[0]).join(" ");
    expect(errorMsg).toMatch(/not found|UNKNOWN-9\.9/);

    const after = readFileSync(join(tmp, "plans", "auth", TASKS_FILENAME), "utf-8");
    expect(after).toBe(before);
  });

  // ── ready with --label and --phase filters (FORGE-3.4) ────────

  function readyFixture(): TasksFile {
    return {
      version: 1,
      epics: [{ id: "TEST-1", title: "Phase", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "Gate + phase5", status: "open", priority: 1, labels: ["gate:human", "phase:5"], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
        { id: "TEST-1.2", title: "Frontend + needs-design", status: "open", priority: 2, labels: ["frontend", "needs-design"], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
        { id: "TEST-1.3", title: "Frontend only", status: "open", priority: 2, labels: ["frontend"], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
        { id: "TEST-1.4", title: "Phase5 + needs-design", status: "open", priority: 3, labels: ["phase:5", "needs-design"], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
        { id: "TEST-1.5", title: "Unlabeled", status: "open", priority: 4, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
  }

  it("ready with no filter flags returns all ready tasks (backward compat)", async () => {
    setupFeature(tmp, "auth", readyFixture());
    await tasks(["ready", "--json"]);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(5);
  });

  it("ready --label gate:human returns only tasks with that label", async () => {
    setupFeature(tmp, "auth", readyFixture());
    await tasks(["ready", "--label", "gate:human", "--json"]);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("TEST-1.1");
  });

  it("ready with two --label flags intersects (AND)", async () => {
    setupFeature(tmp, "auth", readyFixture());
    await tasks(["ready", "--label", "frontend", "--label", "needs-design", "--json"]);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("TEST-1.2");
  });

  it("ready --phase 5 is equivalent to --label phase:5", async () => {
    setupFeature(tmp, "auth", readyFixture());
    await tasks(["ready", "--phase", "5", "--json"]);
    const phaseOut = JSON.parse(logSpy.mock.calls[0][0]);

    logSpy.mockClear();
    await tasks(["ready", "--label", "phase:5", "--json"]);
    const labelOut = JSON.parse(logSpy.mock.calls[0][0]);

    expect(phaseOut).toEqual(labelOut);
    const ids = phaseOut.map((t: any) => t.id).sort();
    expect(ids).toEqual(["TEST-1.1", "TEST-1.4"]);
  });

  it("ready --phase 5 --label needs-design intersects phase with label", async () => {
    setupFeature(tmp, "auth", readyFixture());
    await tasks(["ready", "--phase", "5", "--label", "needs-design", "--json"]);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("TEST-1.4");
  });

  it("ready --label no-matches returns empty JSON array", async () => {
    setupFeature(tmp, "auth", readyFixture());
    await tasks(["ready", "--label", "no-matches", "--json"]);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toEqual([]);
  });

  it("ready --label no-matches in non-JSON mode shows empty list", async () => {
    setupFeature(tmp, "auth", readyFixture());
    await tasks(["ready", "--label", "no-matches"]);

    const logs = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
    expect(logs).toContain("No ready tasks");
  });

  // ── show --children / --full recursion (FORGE-3.5) ─────────────

  function childrenFixture(): TasksFile {
    return {
      version: 1,
      epics: [{ id: "TEST-1", title: "Phase 1", created: "2026-03-30" }],
      tasks: [
        { id: "TEST-1.1", title: "Parent container", status: "open", priority: 2, labels: [], description: "parent desc", design: "parent design", acceptance: ["parent ac"], notes: "parent notes", dependencies: [], comments: [], closeReason: null },
        { id: "TEST-1.1.1", title: "Child A", status: "open", priority: 2, labels: [], description: "childA desc", design: "childA design", acceptance: ["childA ac"], notes: "childA notes", dependencies: [], comments: [], closeReason: null },
        { id: "TEST-1.1.2", title: "Child B", status: "closed", priority: 2, labels: [], description: "childB desc", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: "done" },
        { id: "TEST-1.1.1.1", title: "Grandchild", status: "open", priority: 2, labels: [], description: "gc desc", design: "gc design", acceptance: [], notes: "gc notes", dependencies: [], comments: [], closeReason: null },
        { id: "TEST-1.2", title: "Leaf sibling", status: "open", priority: 2, labels: [], description: "", design: "", acceptance: [], notes: "", dependencies: [], comments: [], closeReason: null },
      ],
    };
  }

  it("show --children renders direct children summary (id + title + status)", async () => {
    setupFeature(tmp, "auth", childrenFixture());
    await tasks(["show", "TEST-1.1", "--children"]);

    const logs = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
    // Parent still rendered
    expect(logs).toContain("TEST-1.1");
    expect(logs).toContain("Parent container");
    // Direct children shown
    expect(logs).toContain("TEST-1.1.1");
    expect(logs).toContain("Child A");
    expect(logs).toContain("TEST-1.1.2");
    expect(logs).toContain("Child B");
    expect(logs).toContain("closed");
    // Grandchild NOT included in direct children summary
    expect(logs).not.toContain("TEST-1.1.1.1");
  });

  it("show --children on a task with no children prints exact '  (no children)' literal", async () => {
    setupFeature(tmp, "auth", childrenFixture());
    await tasks(["show", "TEST-1.2", "--children"]);

    const logCalls = logSpy.mock.calls.map((c: string[]) => c[0]);
    expect(logCalls).toContain("  (no children)");
  });

  it("show --children --full recurses through all descendants and renders full fields", async () => {
    setupFeature(tmp, "auth", childrenFixture());
    await tasks(["show", "TEST-1.1", "--children", "--full"]);

    const logs = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
    // Parent + all descendants present
    expect(logs).toContain("TEST-1.1");
    expect(logs).toContain("TEST-1.1.1");
    expect(logs).toContain("TEST-1.1.2");
    expect(logs).toContain("TEST-1.1.1.1");
    // Full fields for descendants (descriptions, design, notes, acceptance)
    expect(logs).toContain("childA desc");
    expect(logs).toContain("childA design");
    expect(logs).toContain("childA notes");
    expect(logs).toContain("childA ac");
    expect(logs).toContain("gc desc");
    expect(logs).toContain("gc design");
    expect(logs).toContain("gc notes");
  });

  it("show --full (without --children) preserves existing single-task full behavior", async () => {
    setupFeature(tmp, "auth", childrenFixture());
    await tasks(["show", "TEST-1.1", "--full"]);

    const logs = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
    expect(logs).toContain("TEST-1.1");
    expect(logs).toContain("parent desc");
    // Children should NOT render without --children
    expect(logs).not.toContain("Child A");
    expect(logs).not.toContain("Child B");
  });

  it("show --json --children --full emits nested children arrays", async () => {
    setupFeature(tmp, "auth", childrenFixture());
    await tasks(["show", "TEST-1.1", "--json", "--children", "--full"]);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.task).toBeDefined();
    expect(parsed.task.id).toBe("TEST-1.1");
    expect(Array.isArray(parsed.children)).toBe(true);
    expect(parsed.children).toHaveLength(2);
    const childAEntry = parsed.children.find((c: any) => c.task.id === "TEST-1.1.1");
    expect(childAEntry).toBeDefined();
    expect(Array.isArray(childAEntry.children)).toBe(true);
    expect(childAEntry.children).toHaveLength(1);
    expect(childAEntry.children[0].task.id).toBe("TEST-1.1.1.1");
    // Child B has no children
    const childBEntry = parsed.children.find((c: any) => c.task.id === "TEST-1.1.2");
    expect(childBEntry.children).toEqual([]);
  });

  it("show --json --children (not --full) emits flat children list under parent", async () => {
    setupFeature(tmp, "auth", childrenFixture());
    await tasks(["show", "TEST-1.1", "--json", "--children"]);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.task.id).toBe("TEST-1.1");
    expect(Array.isArray(parsed.children)).toBe(true);
    expect(parsed.children).toHaveLength(2);
    // Direct children only — grandchild not nested (no --full)
    const ids = parsed.children.map((c: any) => c.task.id).sort();
    expect(ids).toEqual(["TEST-1.1.1", "TEST-1.1.2"]);
  });

  it("show --children with UNKNOWN-ID exits non-zero", async () => {
    setupFeature(tmp, "auth", childrenFixture());
    try {
      await tasks(["show", "TEST-999", "--children"]);
    } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some((c: string[]) => c[0]?.includes("not found"))).toBe(true);
  });

  // ── forge tasks edit (FORGE-4.3) ─────────────────────────

  describe("edit subcommand", () => {
    // An editor mock that's a no-op (writes the initial buffer back unchanged).
    const NOOP_EDITOR = `${process.execPath} -e "0"`;

    // An editor mock that replaces the buffer with an empty string.
    const EMPTY_EDITOR = `${process.execPath} -e "require('fs').writeFileSync(process.argv[1],'')"`;

    /**
     * Build an editor command that loads the seeded buffer, runs a transformer
     * function on it, and writes the result back.
     *
     * We write the transformer source to a temp .js file and invoke it via
     * `node <script> <buffer-path>`, which avoids any shell-quoting headaches
     * that arise from inlining the transformer in `node -e "..."`.
     */
    function transformEditor(transformerSrc: string): string {
      const scriptPath = join(tmp, `.edit-transform-${Math.random().toString(36).slice(2)}.js`);
      const script =
        `const f=require('fs');\n` +
        `const p=process.argv[2];\n` +
        `const input=f.readFileSync(p,'utf8');\n` +
        `const transform=${transformerSrc};\n` +
        `f.writeFileSync(p, transform(input));\n`;
      writeFileSync(scriptPath, script);
      return `${process.execPath} ${scriptPath}`;
    }

    // An editor that should NEVER run — if it does, it exits 99 so we can
    // catch the "guard was bypassed" failure mode.
    const FORBIDDEN_EDITOR = `${process.execPath} -e "process.exit(99)"`;

    let savedIsTTY: boolean | undefined;
    let savedCI: string | undefined;

    beforeEach(() => {
      savedIsTTY = process.stdout.isTTY;
      savedCI = process.env.CI;
      // Default all edit tests to "interactive"; individual guard tests override.
      process.stdout.isTTY = true;
      delete process.env.CI;
    });

    afterEach(() => {
      process.stdout.isTTY = savedIsTTY as boolean;
      if (savedCI === undefined) delete process.env.CI;
      else process.env.CI = savedCI;
    });

    function editFixture(): TasksFile {
      return {
        version: 1,
        epics: [{ id: "TEST-1", title: "Phase 1", created: "2026-03-30" }],
        tasks: [
          {
            id: "TEST-1.1",
            title: "Original title",
            status: "open",
            priority: 2,
            labels: ["foo"],
            description: "desc",
            design: "design",
            acceptance: ["ac-1", "ac-2"],
            notes: "notes",
            dependencies: [],
            comments: [],
            closeReason: null,
          },
        ],
      };
    }

    it("happy path: editing the title in the buffer updates tasks.json and preserves other fields", async () => {
      setupFeature(tmp, "auth", editFixture());
      const filePath = join(tmp, "plans", "auth", TASKS_FILENAME);

      // Replace the title in frontmatter with a new one.
      const editor = transformEditor(
        `(s) => s.replace('title: "Original title"', 'title: "New title"')`,
      );

      await tasks(["edit", "TEST-1.1", "--editor", editor]);

      const data = readJson(filePath);
      const task = data.tasks[0];
      expect(task.title).toBe("New title");
      expect(task.priority).toBe(2);
      expect(task.labels).toEqual(["foo"]);
      expect(task.description).toBe("desc");
      expect(task.design).toBe("design");
      expect(task.acceptance).toEqual(["ac-1", "ac-2"]);
      expect(task.notes).toBe("notes");
      expect(task.dependencies).toEqual([]);
    });

    it("unchanged buffer: save without changes leaves tasks.json byte-identical", async () => {
      setupFeature(tmp, "auth", editFixture());
      const filePath = join(tmp, "plans", "auth", TASKS_FILENAME);
      const before = readFileSync(filePath, "utf-8");

      await tasks(["edit", "TEST-1.1", "--editor", NOOP_EDITOR]);

      const after = readFileSync(filePath, "utf-8");
      expect(after).toBe(before);
      expect(
        errorSpy.mock.calls.some((c: string[]) => c[0]?.includes("no changes")),
      ).toBe(true);
    });

    it("empty buffer: editor empties the file → exit 0, no write, no delete", async () => {
      setupFeature(tmp, "auth", editFixture());
      const filePath = join(tmp, "plans", "auth", TASKS_FILENAME);
      const before = readFileSync(filePath, "utf-8");

      await tasks(["edit", "TEST-1.1", "--editor", EMPTY_EDITOR]);

      const after = readFileSync(filePath, "utf-8");
      expect(after).toBe(before);
      expect(
        errorSpy.mock.calls.some((c: string[]) => c[0]?.includes("empty buffer")),
      ).toBe(true);
      // Task must still be present — confirms no delete ran.
      const data = JSON.parse(after);
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].id).toBe("TEST-1.1");
    });

    it("clear acceptance: removing all '- [ ]' items sets acceptance to []", async () => {
      setupFeature(tmp, "auth", editFixture());
      const filePath = join(tmp, "plans", "auth", TASKS_FILENAME);

      // Remove every `- [ ]` line from the buffer.
      const editor = transformEditor(
        `(s) => s.split('\\n').filter(l => !/^- \\[ \\]/.test(l)).join('\\n')`,
      );

      await tasks(["edit", "TEST-1.1", "--editor", editor]);

      const task = readJson(filePath).tasks[0];
      expect(task.acceptance).toEqual([]);
    });

    it("unknown task id exits 1 with a clear message", async () => {
      setupFeature(tmp, "auth", editFixture());
      try {
        await tasks(["edit", "TEST-999", "--editor", FORBIDDEN_EDITOR]);
      } catch {
        /* exit spy throws */
      }
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(
        errorSpy.mock.calls.some((c: string[]) => c[0]?.toLowerCase().includes("not found")),
      ).toBe(true);
    });

    it("editing an epic id exits 1 with 'cannot edit epics' message", async () => {
      setupFeature(tmp, "auth", editFixture());
      try {
        await tasks(["edit", "TEST-1", "--editor", FORBIDDEN_EDITOR]);
      } catch {
        /* exit spy throws */
      }
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(
        errorSpy.mock.calls.some((c: string[]) => c[0]?.includes("cannot edit epics")),
      ).toBe(true);
    });

    it("unknown frontmatter key exits 1 with parse error naming the key", async () => {
      setupFeature(tmp, "auth", editFixture());
      // Inject `bogus: true` into the YAML frontmatter.
      const editor = transformEditor(
        `(s) => s.replace('labels:', 'bogus: true\\nlabels:')`,
      );

      try {
        await tasks(["edit", "TEST-1.1", "--editor", editor]);
      } catch {
        /* exit spy throws */
      }
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(
        errorSpy.mock.calls.some((c: string[]) => c[0]?.includes("bogus")),
      ).toBe(true);
    });

    it("--dry-run: modifies buffer but leaves tasks.json byte-identical; prints diff", async () => {
      setupFeature(tmp, "auth", editFixture());
      const filePath = join(tmp, "plans", "auth", TASKS_FILENAME);
      const before = readFileSync(filePath, "utf-8");

      const editor = transformEditor(
        `(s) => s.replace('title: "Original title"', 'title: "New title"')`,
      );

      await tasks(["edit", "TEST-1.1", "--editor", editor, "--dry-run"]);

      const after = readFileSync(filePath, "utf-8");
      expect(after).toBe(before);
      // Diff printed to stdout — we expect the FIELD line mentioning title and both values.
      const logs = logSpy.mock.calls.map((c: string[]) => c[0] ?? "").join("\n");
      expect(logs.toLowerCase()).toContain("title");
      expect(logs).toContain("Original title");
      expect(logs).toContain("New title");
    });

    it("no-TTY guard: isTTY=false fails before spawning the editor", async () => {
      setupFeature(tmp, "auth", editFixture());
      process.stdout.isTTY = false;

      try {
        await tasks(["edit", "TEST-1.1", "--editor", FORBIDDEN_EDITOR]);
      } catch {
        /* exit spy throws */
      }
      // Must have exited with 1 and NOT with 99 (99 = FORBIDDEN_EDITOR ran).
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(exitSpy).not.toHaveBeenCalledWith(99);
    });

    it("CI=true guard: fails before spawning the editor", async () => {
      setupFeature(tmp, "auth", editFixture());
      process.stdout.isTTY = true;
      process.env.CI = "true";

      try {
        await tasks(["edit", "TEST-1.1", "--editor", FORBIDDEN_EDITOR]);
      } catch {
        /* exit spy throws */
      }
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(exitSpy).not.toHaveBeenCalledWith(99);
    });

    it("--help mentions --editor, --dry-run, --force", async () => {
      await tasks(["edit", "--help"]);
      const helpText = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
      expect(helpText).toContain("--editor");
      expect(helpText).toContain("--dry-run");
      expect(helpText).toContain("--force");
    });
  });
});
