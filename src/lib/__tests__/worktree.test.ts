import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveRepoRoot } from "../worktree";

describe("resolveRepoRoot", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `worktree-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns cwd unchanged when .git is a directory (normal repo)", () => {
    mkdirSync(join(tempDir, ".git"), { recursive: true });
    const result = resolveRepoRoot(tempDir);
    expect(result).toBe(tempDir);
  });

  it("follows gitdir path to main repo root when .git is a file (worktree)", () => {
    // Set up a fake main repo with .git directory
    const mainRepo = join(tempDir, "main-repo");
    mkdirSync(join(mainRepo, ".git", "worktrees", "my-branch"), { recursive: true });

    // Set up a worktree directory with .git file pointing to main repo
    const worktreeDir = join(tempDir, "worktree-checkout");
    mkdirSync(worktreeDir, { recursive: true });
    const gitdirPath = join(mainRepo, ".git", "worktrees", "my-branch");
    writeFileSync(join(worktreeDir, ".git"), `gitdir: ${gitdirPath}\n`);

    const result = resolveRepoRoot(worktreeDir);
    expect(result).toBe(mainRepo);
  });

  it("works with nested worktree paths (subdirectory of worktree)", () => {
    // Set up a fake main repo
    const mainRepo = join(tempDir, "main-repo");
    mkdirSync(join(mainRepo, ".git", "worktrees", "feature-x"), { recursive: true });

    // Set up a worktree directory with .git file
    const worktreeDir = join(tempDir, "worktree-checkout");
    const nestedDir = join(worktreeDir, "src", "lib");
    mkdirSync(nestedDir, { recursive: true });
    const gitdirPath = join(mainRepo, ".git", "worktrees", "feature-x");
    writeFileSync(join(worktreeDir, ".git"), `gitdir: ${gitdirPath}\n`);

    // Call from the worktree root (where .git file is), not from nested
    const result = resolveRepoRoot(worktreeDir);
    expect(result).toBe(mainRepo);
  });

  it("throws a clear error if .git is missing entirely", () => {
    // tempDir has no .git file or directory
    expect(() => resolveRepoRoot(tempDir)).toThrow(/\.git not found/i);
  });

  it("handles gitdir paths without trailing newline", () => {
    const mainRepo = join(tempDir, "main-repo");
    mkdirSync(join(mainRepo, ".git", "worktrees", "branch-a"), { recursive: true });

    const worktreeDir = join(tempDir, "worktree-no-newline");
    mkdirSync(worktreeDir, { recursive: true });
    const gitdirPath = join(mainRepo, ".git", "worktrees", "branch-a");
    // No trailing newline
    writeFileSync(join(worktreeDir, ".git"), `gitdir: ${gitdirPath}`);

    const result = resolveRepoRoot(worktreeDir);
    expect(result).toBe(mainRepo);
  });

  it("resolves relative cwd to absolute path", () => {
    // When given an absolute path with .git directory, should return it
    mkdirSync(join(tempDir, ".git"), { recursive: true });
    const result = resolveRepoRoot(tempDir);
    expect(result).toBe(tempDir);
  });
});
