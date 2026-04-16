/**
 * Tests for src/lib/tasks/editor.ts — render/parse/hash round-trip.
 *
 * Pure-function module; no I/O beyond loading the round-trip fixture.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { renderBuffer, parseBuffer, hashTask } from "../tasks";
import type { Task } from "../tasks";

const FIXTURE_PATH = join(__dirname, "fixtures", "tasks-roundtrip.json");
const FIXTURE_TASKS: Task[] = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "FORGE-99",
    title: "A test task",
    status: "open",
    priority: 3,
    labels: [],
    description: "Some description.",
    design: "",
    acceptance: ["ac one", "ac two"],
    notes: "",
    dependencies: [],
    comments: [],
    closeReason: null,
    ...overrides,
  };
}

// ─── renderBuffer ─────────────────────────────────────────────────────

describe("renderBuffer", () => {
  it("includes a reference-only comment header with non-editable fields", () => {
    const task = makeTask({ id: "FORGE-42", status: "in_progress", closeReason: null });
    const out = renderBuffer(task);

    expect(out).toMatch(/^# /); // leading comment block
    expect(out).toContain("# id: FORGE-42");
    expect(out).toContain("# status: in_progress");
    expect(out).toContain("# created:");
    expect(out).toContain("# closeReason:");
    expect(out).toContain("# comments-count:");
    // Instruction line noting reference-only
    expect(out.toLowerCase()).toContain("reference");
  });

  it("emits YAML frontmatter with only editable keys", () => {
    const task = makeTask({
      title: "T",
      priority: 5,
      labels: ["phase:2"],
      dependencies: ["FORGE-1"],
    });
    const out = renderBuffer(task);

    // The frontmatter block starts after the comment header
    const fmMatch = out.match(/\n---\n([\s\S]*?)\n---\n/);
    expect(fmMatch).not.toBeNull();
    const fm = fmMatch![1];
    expect(fm).toContain("title:");
    expect(fm).toContain("priority:");
    expect(fm).toContain("labels:");
    expect(fm).toContain("dependencies:");

    // Non-editable keys must NOT appear in frontmatter
    expect(fm).not.toMatch(/^id:/m);
    expect(fm).not.toMatch(/^status:/m);
    expect(fm).not.toMatch(/^created:/m);
    expect(fm).not.toMatch(/^closeReason:/m);
    expect(fm).not.toMatch(/^comments:/m);
  });

  it("renders the four sections in exact order", () => {
    const task = makeTask({
      description: "D",
      design: "Des",
      acceptance: ["a"],
      notes: "N",
    });
    const out = renderBuffer(task);

    const iDesc = out.indexOf("## Description");
    const iDes = out.indexOf("## Design");
    const iAcc = out.indexOf("## Acceptance");
    const iNotes = out.indexOf("## Notes");

    expect(iDesc).toBeGreaterThan(-1);
    expect(iDes).toBeGreaterThan(iDesc);
    expect(iAcc).toBeGreaterThan(iDes);
    expect(iNotes).toBeGreaterThan(iAcc);
  });

  it("renders empty sections as just the header", () => {
    const task = makeTask({ description: "", design: "", acceptance: [], notes: "" });
    const out = renderBuffer(task);

    expect(out).toContain("## Description");
    expect(out).toContain("## Design");
    expect(out).toContain("## Acceptance");
    expect(out).toContain("## Notes");
  });

  it("renders acceptance items as unchecked checkboxes", () => {
    const task = makeTask({ acceptance: ["alpha", "beta", "gamma"] });
    const out = renderBuffer(task);
    expect(out).toContain("- [ ] alpha");
    expect(out).toContain("- [ ] beta");
    expect(out).toContain("- [ ] gamma");
    expect(out).not.toContain("- [x]");
  });

  it("always renders acceptance unchecked regardless of input state", () => {
    // Even if someone constructs a Task directly, render emits `- [ ]` uniformly.
    // (Check state is not persisted on Task; this test documents the intent.)
    const task = makeTask({ acceptance: ["already checked"] });
    const out = renderBuffer(task);
    expect(out).toContain("- [ ] already checked");
  });
});

// ─── parseBuffer ──────────────────────────────────────────────────────

describe("parseBuffer", () => {
  it("round-trips editable fields for a populated task", () => {
    const task = makeTask({
      title: "Round trip",
      priority: 7,
      labels: ["phase:2", "gate:human"],
      dependencies: ["FORGE-1", "FORGE-2"],
      description: "Some desc.",
      design: "Some design.",
      acceptance: ["one", "two"],
      notes: "Some notes.",
    });
    const text = renderBuffer(task);
    const { task: parsed, warnings } = parseBuffer(text);

    expect(parsed.title).toBe("Round trip");
    expect(parsed.priority).toBe(7);
    expect(parsed.labels).toEqual(["phase:2", "gate:human"]);
    expect(parsed.dependencies).toEqual(["FORGE-1", "FORGE-2"]);
    expect(parsed.description).toBe("Some desc.");
    expect(parsed.design).toBe("Some design.");
    expect(parsed.acceptance).toEqual(["one", "two"]);
    expect(parsed.notes).toBe("Some notes.");
    expect(warnings).toEqual([]);
  });

  it("throws on unknown frontmatter keys with the key name in the message", () => {
    const bad = [
      "# reference header",
      "---",
      "title: X",
      "priority: 3",
      "labels: []",
      "dependencies: []",
      "bogusKey: nope",
      "---",
      "## Description",
      "",
      "## Design",
      "",
      "## Acceptance",
      "",
      "## Notes",
      "",
    ].join("\n");

    expect(() => parseBuffer(bad)).toThrow(/bogusKey/);
  });

  it("throws tailored error for reserved non-editable keys in frontmatter", () => {
    const reserved = ["id", "status", "created", "closeReason", "comments"] as const;
    for (const key of reserved) {
      const bad = [
        "---",
        "title: X",
        "priority: 3",
        "labels: []",
        "dependencies: []",
        `${key}: something`,
        "---",
        "## Description",
        "",
        "## Design",
        "",
        "## Acceptance",
        "",
        "## Notes",
        "",
      ].join("\n");
      expect(() => parseBuffer(bad)).toThrow(new RegExp(`${key}.*non-editable`));
    }
  });

  it("throws on missing frontmatter with a shape message", () => {
    const bad = "## Description\n\nhello\n";
    expect(() => parseBuffer(bad)).toThrow();
  });

  it("keeps `## Edge cases` inside the Description section (splitter robustness)", () => {
    const desc = "Overview.\n\n## Edge cases\n\nNested content.\n\n## Example output\n\nMore.";
    const task = makeTask({ description: desc });
    const text = renderBuffer(task);
    const { task: parsed } = parseBuffer(text);
    expect(parsed.description).toContain("## Edge cases");
    expect(parsed.description).toContain("## Example output");
    expect(parsed.description).toContain("Nested content.");
  });

  it("captures [x] acceptance items and emits a warning", () => {
    const text = [
      "---",
      "title: T",
      "priority: 3",
      "labels: []",
      "dependencies: []",
      "---",
      "## Description",
      "",
      "## Design",
      "",
      "## Acceptance",
      "- [ ] unchecked item",
      "- [x] checked item",
      "",
      "## Notes",
      "",
    ].join("\n");
    const { task, warnings } = parseBuffer(text);
    expect(task.acceptance).toEqual(["unchecked item", "checked item"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/check state/i);
  });

  it("does not warn when acceptance has only unchecked items", () => {
    const text = [
      "---",
      "title: T",
      "priority: 3",
      "labels: []",
      "dependencies: []",
      "---",
      "## Description",
      "",
      "## Design",
      "",
      "## Acceptance",
      "- [ ] a",
      "- [ ] b",
      "",
      "## Notes",
      "",
    ].join("\n");
    const { warnings } = parseBuffer(text);
    expect(warnings).toEqual([]);
  });

  it("fills missing sections with empty string / empty array", () => {
    // Only Description section present; others missing
    const text = [
      "---",
      "title: T",
      "priority: 3",
      "labels: []",
      "dependencies: []",
      "---",
      "## Description",
      "only here",
      "",
    ].join("\n");
    const { task } = parseBuffer(text);
    expect(task.description).toBe("only here");
    expect(task.design).toBe("");
    expect(task.acceptance).toEqual([]);
    expect(task.notes).toBe("");
  });

  it("trims trailing whitespace from captured fields", () => {
    const text = [
      "---",
      "title: T   ",
      "priority: 3",
      "labels: []",
      "dependencies: []",
      "---",
      "## Description",
      "hello   ",
      "",
      "",
      "## Design",
      "",
      "## Acceptance",
      "",
      "## Notes",
      "",
    ].join("\n");
    const { task } = parseBuffer(text);
    expect(task.description).toBe("hello");
    expect(task.title).toBe("T");
  });
});

// ─── hashTask ─────────────────────────────────────────────────────────

describe("hashTask", () => {
  it("returns a deterministic sha256 hex string for the same input", () => {
    const task = makeTask();
    const h1 = hashTask(task);
    const h2 = hashTask(task);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when title changes", () => {
    const a = makeTask({ title: "old" });
    const b = makeTask({ title: "new" });
    expect(hashTask(a)).not.toBe(hashTask(b));
  });

  it("changes when status changes", () => {
    const a = makeTask({ status: "open" });
    const b = makeTask({ status: "closed" });
    expect(hashTask(a)).not.toBe(hashTask(b));
  });

  it("is stable under object-key insertion order", () => {
    // Build equivalent tasks with keys added in different order
    const base = makeTask({ labels: ["a", "b"], dependencies: ["X-1"] });
    const reordered: Task = {
      closeReason: base.closeReason,
      comments: base.comments,
      dependencies: base.dependencies,
      notes: base.notes,
      acceptance: base.acceptance,
      design: base.design,
      description: base.description,
      labels: base.labels,
      priority: base.priority,
      status: base.status,
      title: base.title,
      id: base.id,
    };
    expect(hashTask(base)).toBe(hashTask(reordered));
  });

  it("preserves array order for acceptance, labels, dependencies", () => {
    const a = makeTask({ acceptance: ["x", "y"] });
    const b = makeTask({ acceptance: ["y", "x"] });
    expect(hashTask(a)).not.toBe(hashTask(b));
  });
});

// ─── Round-trip across fixtures ───────────────────────────────────────

describe("round-trip fixtures", () => {
  it("loads at least 10 fixture tasks", () => {
    expect(FIXTURE_TASKS.length).toBeGreaterThanOrEqual(10);
  });

  it("every fixture task: parseBuffer(renderBuffer(task)) is value-equivalent", () => {
    for (const task of FIXTURE_TASKS) {
      const rendered = renderBuffer(task);
      const { task: parsed } = parseBuffer(rendered);

      expect(parsed.title).toBe(task.title);
      expect(parsed.priority).toBe(task.priority);
      expect(parsed.labels).toEqual(task.labels);
      expect(parsed.dependencies).toEqual(task.dependencies);
      expect(parsed.description).toBe(task.description);
      expect(parsed.design).toBe(task.design);
      expect(parsed.acceptance).toEqual(task.acceptance);
      expect(parsed.notes).toBe(task.notes);
    }
  });

  it("every fixture task: hashTask(original) === hashTask(parsed+merged)", () => {
    for (const task of FIXTURE_TASKS) {
      const rendered = renderBuffer(task);
      const { task: parsed } = parseBuffer(rendered);
      // Merge back: editor doesn't touch non-editable fields, so re-attach them
      const merged: Task = {
        ...task,
        title: parsed.title,
        priority: parsed.priority,
        labels: parsed.labels,
        dependencies: parsed.dependencies,
        description: parsed.description,
        design: parsed.design,
        acceptance: parsed.acceptance,
        notes: parsed.notes,
      };
      expect(hashTask(merged)).toBe(hashTask(task));
    }
  });

  it("every fixture: render(parse(render(task))) byte-equals render(task)", () => {
    for (const task of FIXTURE_TASKS) {
      const first = renderBuffer(task);
      const { task: parsed } = parseBuffer(first);
      const merged: Task = {
        ...task,
        title: parsed.title,
        priority: parsed.priority,
        labels: parsed.labels,
        dependencies: parsed.dependencies,
        description: parsed.description,
        design: parsed.design,
        acceptance: parsed.acceptance,
        notes: parsed.notes,
      };
      const second = renderBuffer(merged);
      expect(second).toBe(first);
    }
  });

  it("fixture containing `## Edge cases` keeps it inside description", () => {
    const edgeTask = FIXTURE_TASKS.find((t) =>
      t.description.includes("## Edge cases") && t.description.includes("## Example output")
    );
    expect(edgeTask).toBeDefined();
    const rendered = renderBuffer(edgeTask!);
    const { task: parsed } = parseBuffer(rendered);
    expect(parsed.description).toContain("## Edge cases");
    expect(parsed.description).toContain("## Example output");
  });
});

// ─── Re-exports from tasks/index.ts ───────────────────────────────────

describe("re-exports", () => {
  it("renderBuffer, parseBuffer, hashTask are exported from ../tasks", async () => {
    const mod = await import("../tasks");
    expect(typeof mod.renderBuffer).toBe("function");
    expect(typeof mod.parseBuffer).toBe("function");
    expect(typeof mod.hashTask).toBe("function");
  });
});
