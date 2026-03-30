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
});
