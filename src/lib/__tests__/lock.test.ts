import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { acquireLock, releaseLock, withLock, LOCK_EXTENSION } from "../lock";

describe("lock", () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lock-test-"));
    testFile = join(tempDir, "tasks.json");
    writeFileSync(testFile, "{}");
  });

  afterEach(() => {
    // Clean up lock files if they exist
    const lockFile = testFile + LOCK_EXTENSION;
    if (existsSync(lockFile)) {
      unlinkSync(lockFile);
    }
  });

  describe("acquireLock", () => {
    it("creates a .lock file with PID content", async () => {
      await acquireLock(testFile);

      const lockFile = testFile + LOCK_EXTENSION;
      expect(existsSync(lockFile)).toBe(true);

      const content = readFileSync(lockFile, "utf-8");
      expect(content).toBe(String(process.pid));

      releaseLock(testFile);
    });

    it("retries when lock is held by a live process", async () => {
      const lockFile = testFile + LOCK_EXTENSION;
      // Write our own PID so the lock appears held by a live process
      writeFileSync(lockFile, String(process.pid));

      // Release the lock after a short delay so acquireLock can succeed
      const timer = setTimeout(() => {
        unlinkSync(lockFile);
      }, 200);

      await acquireLock(testFile);
      clearTimeout(timer);

      expect(existsSync(lockFile)).toBe(true);
      releaseLock(testFile);
    });

    it("times out after LOCK_TIMEOUT_MS with clear error", async () => {
      const lockFile = testFile + LOCK_EXTENSION;
      // Write our own PID so the lock appears held by a live process
      writeFileSync(lockFile, String(process.pid));

      // Use a very short timeout to avoid slow tests.
      // We need to test the timeout behavior without waiting 5s.
      // acquireLock uses the module-level LOCK_TIMEOUT_MS, so we hold the lock the whole time.
      // We'll test that it throws within a reasonable window.
      await expect(
        acquireLock(testFile, { timeoutMs: 300, retryMs: 50 })
      ).rejects.toThrow(/timed out/i);

      // Clean up
      unlinkSync(lockFile);
    });

    it("reclaims stale lock from dead PID", async () => {
      const lockFile = testFile + LOCK_EXTENSION;
      // Use a PID that almost certainly doesn't exist
      const deadPid = 2147483647;
      writeFileSync(lockFile, String(deadPid));

      await acquireLock(testFile);

      expect(existsSync(lockFile)).toBe(true);
      const content = readFileSync(lockFile, "utf-8");
      expect(content).toBe(String(process.pid));

      releaseLock(testFile);
    });

    it("treats EPERM from process.kill as alive (not stale)", async () => {
      const lockFile = testFile + LOCK_EXTENSION;
      // PID 1 (init/launchd) is always alive but owned by root, so
      // process.kill(1, 0) throws EPERM on non-root.
      writeFileSync(lockFile, "1");

      await expect(
        acquireLock(testFile, { timeoutMs: 300, retryMs: 50 })
      ).rejects.toThrow(/timed out/i);

      // Lock file should still contain PID 1 (not reclaimed)
      const content = readFileSync(lockFile, "utf-8");
      expect(content).toBe("1");

      // Clean up
      unlinkSync(lockFile);
    });
  });

  describe("releaseLock", () => {
    it("removes the lock file", async () => {
      await acquireLock(testFile);
      const lockFile = testFile + LOCK_EXTENSION;
      expect(existsSync(lockFile)).toBe(true);

      releaseLock(testFile);
      expect(existsSync(lockFile)).toBe(false);
    });

    it("does not throw if lock file already removed", () => {
      // Should not throw even though no lock file exists
      expect(() => releaseLock(testFile)).not.toThrow();
    });
  });

  describe("withLock", () => {
    it("acquires lock, runs fn, and releases lock", async () => {
      const result = await withLock(testFile, () => {
        const lockFile = testFile + LOCK_EXTENSION;
        // Lock should be held during fn execution
        expect(existsSync(lockFile)).toBe(true);
        return 42;
      });

      expect(result).toBe(42);
      // Lock should be released after fn completes
      const lockFile = testFile + LOCK_EXTENSION;
      expect(existsSync(lockFile)).toBe(false);
    });

    it("releases lock even when fn throws", async () => {
      const lockFile = testFile + LOCK_EXTENSION;

      await expect(
        withLock(testFile, () => {
          throw new Error("boom");
        })
      ).rejects.toThrow("boom");

      // Lock must be released despite the error
      expect(existsSync(lockFile)).toBe(false);
    });

    it("works with async functions", async () => {
      const result = await withLock(testFile, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "async-result";
      });

      expect(result).toBe("async-result");
      const lockFile = testFile + LOCK_EXTENSION;
      expect(existsSync(lockFile)).toBe(false);
    });
  });
});
