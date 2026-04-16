/**
 * Task editor: pure Task ⇄ markdown-with-YAML-frontmatter transforms.
 *
 * No I/O. Used by `forge tasks edit` to materialize a task as a buffer,
 * round-trip user edits, and detect changes via a stable hash.
 *
 * Buffer shape:
 *
 *   # id: FORGE-42
 *   # status: open
 *   # created: <iso-or-unknown>
 *   # closeReason: <null | string>
 *   # comments-count: <n>
 *   # (reference-only; these lines are not parsed back into the task)
 *   ---
 *   title: ...
 *   priority: 3
 *   labels: []
 *   dependencies: []
 *   ---
 *   ## Description
 *   ...
 *   ## Design
 *   ...
 *   ## Acceptance
 *   - [ ] ...
 *   ## Notes
 *   ...
 */

import { createHash } from "crypto";
import matter from "gray-matter";
import type { Task } from "./types";

// ─── Public types ─────────────────────────────────────────────────────

export interface ParsedTask {
  title: string;
  priority: number;
  labels: string[];
  dependencies: string[];
  description: string;
  design: string;
  acceptance: string[];
  notes: string;
}

export interface ParseResult {
  task: ParsedTask;
  warnings: string[];
}

// ─── Constants ────────────────────────────────────────────────────────

const EDITABLE_KEYS = new Set(["title", "priority", "labels", "dependencies"]);
const RESERVED_KEYS = new Set(["id", "status", "created", "closeReason", "comments"]);
const SECTION_HEADERS = ["## Description", "## Design", "## Acceptance", "## Notes"] as const;
type SectionName = "description" | "design" | "acceptance" | "notes";
const HEADER_TO_NAME: Record<string, SectionName> = {
  "## Description": "description",
  "## Design": "design",
  "## Acceptance": "acceptance",
  "## Notes": "notes",
};

const REFERENCE_INSTRUCTION = "# (reference-only; these lines are not parsed back into the task)";

// ─── renderBuffer ─────────────────────────────────────────────────────

/**
 * Render a Task as the editable markdown buffer.
 *
 * The output is intentionally byte-deterministic: given the same editable
 * field values, the render is identical. This guarantee underpins the
 * round-trip test and the change-detection flow.
 */
export function renderBuffer(task: Task): string {
  const lines: string[] = [];

  // Reference-only header block (non-editable fields).
  lines.push(`# id: ${task.id}`);
  lines.push(`# status: ${task.status}`);
  // `created` is not on the Task type today; render as unknown so the shape
  // stays stable. Future fields can be added here without affecting parse.
  const created = (task as unknown as { created?: string }).created ?? "";
  lines.push(`# created: ${created}`);
  lines.push(`# closeReason: ${task.closeReason === null ? "null" : task.closeReason}`);
  lines.push(`# comments-count: ${task.comments.length}`);
  lines.push(REFERENCE_INSTRUCTION);
  lines.push("");

  // YAML frontmatter — hand-serialized for stable output.
  lines.push("---");
  lines.push(`title: ${yamlScalar(task.title)}`);
  lines.push(`priority: ${task.priority}`);
  lines.push(`labels: ${yamlStringArray(task.labels)}`);
  lines.push(`dependencies: ${yamlStringArray(task.dependencies)}`);
  lines.push("---");

  // Body sections — exact order, empty sections still render their header.
  lines.push("## Description");
  if (task.description) lines.push(task.description);
  lines.push("");

  lines.push("## Design");
  if (task.design) lines.push(task.design);
  lines.push("");

  lines.push("## Acceptance");
  for (const item of task.acceptance) {
    lines.push(`- [ ] ${item}`);
  }
  lines.push("");

  lines.push("## Notes");
  if (task.notes) lines.push(task.notes);
  lines.push("");

  return lines.join("\n");
}

/**
 * Serialize a string as a YAML scalar. We always quote for safety — user
 * titles may contain `:`, `#`, leading dashes, etc. Escape `"` and `\`.
 */
function yamlScalar(s: string): string {
  const escaped = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Serialize a string array as a YAML flow sequence, e.g. `["a", "b"]`.
 * Empty arrays render as `[]`. Hand-rolled so that byte output is stable
 * regardless of YAML library version.
 */
function yamlStringArray(arr: string[]): string {
  if (arr.length === 0) return "[]";
  return "[" + arr.map(yamlScalar).join(", ") + "]";
}

// ─── parseBuffer ──────────────────────────────────────────────────────

/**
 * Parse an edited markdown buffer back into editable-field values plus
 * any warnings. Throws on structural problems (missing frontmatter,
 * unknown keys, reserved keys in frontmatter).
 */
export function parseBuffer(text: string): ParseResult {
  const warnings: string[] = [];

  // gray-matter tolerates content without frontmatter (returns empty data),
  // so we separately insist on the `---` delimiters being present at the
  // top of the content (after any leading `#` comment header lines).
  const stripped = stripLeadingCommentHeader(text);
  if (!/^---\s*\r?\n/.test(stripped)) {
    throw new Error(
      "malformed buffer: expected YAML frontmatter delimited by '---' lines at the top (after the reference header)"
    );
  }

  const parsed = matter(stripped);
  const data = parsed.data as Record<string, unknown>;
  const body = parsed.content;

  // Validate frontmatter keys.
  for (const key of Object.keys(data)) {
    if (RESERVED_KEYS.has(key)) {
      throw new Error(
        `field ${key} is non-editable; it appears in the reference header for display only. Remove it from frontmatter.`
      );
    }
    if (!EDITABLE_KEYS.has(key)) {
      throw new Error(`unknown frontmatter key: ${key}`);
    }
  }

  // Extract editable fields with shape coercion.
  const title = requireString(data.title, "title");
  const priority = requireNumber(data.priority, "priority");
  const labels = requireStringArray(data.labels, "labels");
  const dependencies = requireStringArray(data.dependencies, "dependencies");

  const sections = splitSections(body);

  // Acceptance: parse `- [ ]` / `- [x]` lines.
  const { items: acceptance, hadChecked } = parseAcceptance(sections.acceptance);
  if (hadChecked) {
    warnings.push(
      "checked acceptance items were accepted but check state is not stored; all items will render as - [ ] on next open"
    );
  }

  return {
    task: {
      title: title.trimEnd(),
      priority,
      labels,
      dependencies,
      description: sections.description.trimEnd(),
      design: sections.design.trimEnd(),
      acceptance,
      notes: sections.notes.trimEnd(),
    },
    warnings,
  };
}

/**
 * Remove a leading block of `#`-prefixed lines (the reference header we
 * emit in renderBuffer). We stop at the first non-`#` non-blank line so
 * the body's `#` markdown headings (if any) are untouched.
 */
function stripLeadingCommentHeader(text: string): string {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("#") || line.trim() === "") {
      i++;
      continue;
    }
    break;
  }
  return lines.slice(i).join("\n");
}

function requireString(v: unknown, field: string): string {
  if (typeof v !== "string") {
    throw new Error(`malformed buffer: field '${field}' must be a string`);
  }
  return v;
}

function requireNumber(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`malformed buffer: field '${field}' must be a number`);
  }
  return v;
}

function requireStringArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) {
    throw new Error(`malformed buffer: field '${field}' must be an array`);
  }
  for (const entry of v) {
    if (typeof entry !== "string") {
      throw new Error(`malformed buffer: field '${field}' must contain only strings`);
    }
  }
  return v as string[];
}

// ─── Body section splitting ───────────────────────────────────────────

/**
 * Split the body into our four recognized sections.
 *
 * CRITICAL: we only split on the four literal section-start lines
 * (`## Description`, `## Design`, `## Acceptance`, `## Notes`). Any
 * other `## <whatever>` line is treated as content within the current
 * section — user prose may legitimately contain `## Edge cases`, etc.
 *
 * Missing sections return empty string / empty acceptance array at
 * parseBuffer time.
 */
function splitSections(body: string): Record<SectionName, string> {
  const result: Record<SectionName, string> = {
    description: "",
    design: "",
    acceptance: "",
    notes: "",
  };

  const lines = body.split(/\r?\n/);
  let current: SectionName | null = null;
  const buffers: Record<SectionName, string[]> = {
    description: [],
    design: [],
    acceptance: [],
    notes: [],
  };

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (HEADER_TO_NAME[trimmed] !== undefined) {
      current = HEADER_TO_NAME[trimmed];
      continue;
    }
    if (current !== null) {
      buffers[current].push(line);
    }
    // Content before the first recognized header is discarded; this is
    // the blank space between frontmatter and `## Description`.
  }

  for (const name of ["description", "design", "acceptance", "notes"] as const) {
    // Trim leading/trailing blank lines but preserve internal structure.
    const arr = buffers[name];
    let start = 0;
    let end = arr.length;
    while (start < end && arr[start].trim() === "") start++;
    while (end > start && arr[end - 1].trim() === "") end--;
    result[name] = arr.slice(start, end).join("\n");
  }

  return result;
}

/**
 * Parse an Acceptance-section body into items. Accepts both `- [ ]` and
 * `- [x]`; reports whether any checked items appeared so the caller can
 * emit a warning.
 */
function parseAcceptance(body: string): { items: string[]; hadChecked: boolean } {
  const items: string[] = [];
  let hadChecked = false;
  const re = /^\s*-\s*\[([ xX])\]\s*(.*)$/;
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    const state = m[1];
    if (state === "x" || state === "X") hadChecked = true;
    items.push(m[2].trimEnd());
  }
  return { items, hadChecked };
}

// ─── hashTask ─────────────────────────────────────────────────────────

/**
 * sha256 over a stable JSON serialization of the editable + status set
 * of fields. Not cryptographic — only used for change detection.
 *
 * Key order is fixed; array order is preserved.
 */
export function hashTask(task: Task): string {
  const normalized = {
    acceptance: task.acceptance,
    dependencies: task.dependencies,
    description: task.description,
    design: task.design,
    labels: task.labels,
    notes: task.notes,
    priority: task.priority,
    status: task.status,
    title: task.title,
  };
  const json = stableStringify(normalized);
  return createHash("sha256").update(json).digest("hex");
}

/**
 * JSON.stringify with sorted object keys. Arrays are emitted in original
 * order. Primitive values go through JSON.stringify as usual.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return (
    "{" +
    entries.map(([k, v]) => JSON.stringify(k) + ":" + stableStringify(v)).join(",") +
    "}"
  );
}
