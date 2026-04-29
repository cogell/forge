/**
 * Task system types and constants.
 */

// ─── Constants ────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 1;
export const TASKS_FILENAME = "tasks.json";
export const MAX_NESTING_DEPTH = 3;

export const GATE_LABEL_HUMAN = "gate:human";
export const PHASE_LABEL_PREFIX = "phase:";
export const COMMIT_PLAN_TEMPLATE = "chore(<feature>): add Phase <N> plan + tasks";

/**
 * Standard recovery hint appended to every readTasksFile error message.
 * The literal substring "forge tasks update" is the load-bearing contract
 * (the durable mutation command, always available); "forge tasks edit" is
 * preferred when ergonomics matter and is included since Phase 2 shipped.
 */
export const RECOVERY_HINT =
  "Run `forge tasks edit <task-id>` (or `forge tasks update`) to fix the field, or hand-edit tasks.json carefully.";

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
  type:
    | "cycle"
    | "orphan-dep"
    | "orphan-epic"
    | "duplicate-id"
    | "type-conformance"
    | "empty-acceptance"
    | "orphan-label";
  severity: "error" | "warning" | "info";
  message: string;
  ids: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  info: ValidationError[];
}

export type ValidateScope =
  | { kind: "all" }
  | { kind: "project" }
  | { kind: "feature"; name: string };
