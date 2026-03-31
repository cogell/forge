import { writeFileSync, readFileSync, unlinkSync, renameSync } from "fs";
import { join, dirname } from "path";

/** Default lock timeout in milliseconds */
export const LOCK_TIMEOUT_MS = 5000;

/** Default retry interval in milliseconds */
export const LOCK_RETRY_MS = 100;

/** File extension appended to create the lock file path */
export const LOCK_EXTENSION = ".lock";

interface LockOptions {
  timeoutMs?: number;
  retryMs?: number;
}

/**
 * Check whether a process with the given PID is still alive.
 * Returns true if alive (or if we lack permission to signal it),
 * false if the process does not exist.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      // No such process — it's dead
      return false;
    }
    // EPERM means the process exists but we can't signal it — treat as alive
    return true;
  }
}

/**
 * Acquire an advisory file lock by atomically creating a `.lock` file.
 *
 * If the lock file already exists:
 * - Reads the PID from it and checks whether that process is alive.
 * - If the process is dead (ESRCH), the stale lock is reclaimed.
 * - If the process is alive (or EPERM), retries until timeout.
 *
 * @param filePath - The file to lock (lock file will be `filePath + ".lock"`)
 * @param options  - Optional overrides for timeout and retry intervals
 */
export async function acquireLock(
  filePath: string,
  options?: LockOptions
): Promise<void> {
  const lockFile = filePath + LOCK_EXTENSION;
  const timeoutMs = options?.timeoutMs ?? LOCK_TIMEOUT_MS;
  const retryMs = options?.retryMs ?? LOCK_RETRY_MS;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      // Atomic create-if-not-exists
      writeFileSync(lockFile, String(process.pid), { flag: "wx" });
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }

      // Lock file exists — check if the holder is still alive
      let existingPid: number;
      try {
        const content = readFileSync(lockFile, "utf-8").trim();
        existingPid = parseInt(content, 10);
      } catch {
        // Lock file disappeared between our write attempt and read — retry immediately
        continue;
      }

      if (isNaN(existingPid) || !isPidAlive(existingPid)) {
        // Stale lock — atomically reclaim via rename instead of
        // unlink+create (which has a TOCTOU race window).
        const tmpLock = join(
          dirname(lockFile),
          `.lock-reclaim-${process.pid}-${Date.now()}`
        );
        try {
          writeFileSync(tmpLock, String(process.pid), { flag: "wx" });
          renameSync(tmpLock, lockFile);
          return;
        } catch {
          // Another process may have reclaimed first — clean up and retry
          try { unlinkSync(tmpLock); } catch {}
        }
        continue;
      }

      // Process is alive — wait and retry
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for lock on "${filePath}" (held by PID ${existingPid})`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
}

/**
 * Release an advisory file lock.
 * Only removes the lock if it is owned by the current process (PID matches).
 * Silently ignores ENOENT (lock already removed).
 *
 * @param filePath - The file whose lock should be released
 */
export function releaseLock(filePath: string): void {
  const lockFile = filePath + LOCK_EXTENSION;
  try {
    const content = readFileSync(lockFile, "utf-8").trim();
    const lockPid = parseInt(content, 10);
    if (!isNaN(lockPid) && lockPid !== process.pid) {
      // Lock is owned by another process — do not release it
      return;
    }
    unlinkSync(lockFile);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw err;
    }
  }
}

/**
 * Execute a function while holding an advisory file lock.
 * The lock is always released in the finally block, even if fn throws.
 *
 * @param filePath - The file to lock during execution
 * @param fn       - The function to execute while holding the lock
 * @returns The return value of fn
 */
export async function withLock<T>(
  filePath: string,
  fn: () => T | Promise<T>
): Promise<T> {
  await acquireLock(filePath);
  try {
    return await fn();
  } finally {
    releaseLock(filePath);
  }
}
