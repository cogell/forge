/**
 * Project configuration: prefix reading and validation.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { resolveRepoRoot } from "../worktree";

const PREFIX_REGEX = /^[A-Z0-9]{2,10}$/;

/**
 * Read the project prefix from forge.json in the given directory.
 * Throws if forge.json is missing or prefix is invalid.
 */
export function readProjectPrefix(cwd?: string): string {
  const dir = resolveRepoRoot(cwd);
  const filePath = join(dir, "forge.json");

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("No project key configured. Run forge init to set one.");
    }
    throw err;
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("forge.json contains invalid JSON. Run forge init to fix it.");
  }

  const prefix = (data as Record<string, unknown>)?.prefix;

  if (typeof prefix !== "string" || !PREFIX_REGEX.test(prefix)) {
    throw new Error(
      `Invalid project prefix${prefix ? `: "${prefix}"` : ""}. ` +
        "Must be 2-10 uppercase alphanumeric characters (e.g., FORGE)."
    );
  }

  return prefix;
}

/**
 * Validate a prefix string. Returns true if valid, false otherwise.
 */
export function isValidPrefix(prefix: string): boolean {
  return PREFIX_REGEX.test(prefix);
}
