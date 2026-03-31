/**
 * Task system types and constants.
 */

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
