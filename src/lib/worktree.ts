/**
 * Git worktree detection and resolution.
 *
 * When running inside a worktree, .git is a file (not a directory)
 * containing a gitdir pointer. Follow it to find the main worktree's
 * repo root — the directory that holds the real .git/ directory.
 */

import { lstatSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";

/**
 * Resolve cwd to the main repo root.
 *
 * - If .git is a directory (normal repo), return cwd unchanged.
 * - If .git is a file (worktree), parse the gitdir pointer and
 *   follow it back to the main repo root.
 * - If .git is missing, throw an error.
 */
export function resolveRepoRoot(cwd?: string): string {
  const dir = resolve(cwd ?? process.cwd());
  const gitPath = join(dir, ".git");

  let stat;
  try {
    stat = lstatSync(gitPath);
  } catch {
    throw new Error(`.git not found in ${dir}`);
  }

  // Normal repo — .git is a directory
  if (stat.isDirectory()) {
    return dir;
  }

  // Worktree — .git is a file with content like:
  //   gitdir: /path/to/main-repo/.git/worktrees/branch-name
  if (stat.isFile()) {
    const content = readFileSync(gitPath, "utf-8").trim();
    const match = content.match(/^gitdir:\s*(.+)$/);
    if (!match) {
      throw new Error(`Unable to parse .git file in ${dir}: ${content}`);
    }

    const gitdirPath = resolve(dir, match[1]);

    // gitdirPath is e.g. /path/to/main-repo/.git/worktrees/branch-name
    // Go up 3 levels: worktrees/branch-name → .git → repo-root
    const mainRepoRoot = dirname(dirname(dirname(gitdirPath)));
    return mainRepoRoot;
  }

  throw new Error(`.git exists but is neither a file nor a directory in ${dir}`);
}
