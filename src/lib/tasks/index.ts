/**
 * Built-in task system — barrel re-exports.
 *
 * All consumers import from this module (e.g., `from "../lib/tasks"`).
 * Internal sub-modules (io, mutations, etc.) are implementation details.
 */

// Types and constants
export {
  SCHEMA_VERSION,
  TASKS_FILENAME,
  MAX_NESTING_DEPTH,
  type TaskStatus,
  type Comment,
  type Epic,
  type Task,
  type TasksFile,
  type EpicInfo,
  type ReadyTask,
  type ValidationError,
  type ValidationResult,
  type ValidateScope,
} from "./types";

// Config
export { readProjectPrefix, isValidPrefix } from "./config";

// File I/O
export { resolveTasksPath, discoverTaskFiles, readTasksFile } from "./io";

// Queries
export { queryFeatureTasks, getReadyTasks } from "./queries";

// Mutations
export {
  writeTasksFile,
  createEpic,
  createTask,
  addDep,
  removeDep,
  closeTask,
  updateTask,
  addComment,
  addLabel,
} from "./mutations";

// Validation
export { validateDag } from "./validate";
