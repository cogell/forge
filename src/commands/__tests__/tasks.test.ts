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
});
