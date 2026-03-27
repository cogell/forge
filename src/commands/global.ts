/**
 * forge global [root]
 *
 * Scan all projects under a root directory (default: ~/projects/)
 * and display aggregated forge status across the machine.
 */

import { existsSync, readdirSync } from "fs";
import { join, basename, relative } from "path";
import { homedir } from "os";
import { detectPipeline, type PipelineState } from "../lib/pipeline";
import { formatGlobalStatus } from "../lib/format";

const DEFAULT_ROOT = join(homedir(), "projects");

export interface ProjectState {
  name: string;        // display name (relative path from root)
  path: string;        // absolute path
  pipeline: PipelineState;
}

/**
 * Recursively discover directories that contain plans/ and docs/.
 * Searches up to maxDepth levels.
 */
function discoverProjects(root: string, maxDepth = 3): string[] {
  const projects: string[] = [];

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;

    const plansDir = join(dir, "plans");
    const docsDir = join(dir, "docs");

    if (existsSync(plansDir) && existsSync(docsDir)) {
      projects.push(dir);
      return; // don't recurse into a forge project's subdirs
    }

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        walk(join(dir, entry.name), depth + 1);
      }
    } catch {
      // permission errors, broken symlinks, etc.
    }
  }

  walk(root, 0);
  return projects;
}

export async function global(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const rootArg = args.find((a) => !a.startsWith("-"));
  const root = rootArg
    ? rootArg.replace(/^~/, homedir())
    : DEFAULT_ROOT;

  if (!existsSync(root)) {
    console.error(`Directory not found: ${root}`);
    process.exit(1);
  }

  const projectPaths = discoverProjects(root);

  if (projectPaths.length === 0) {
    console.log(`No forge projects found under ${root}`);
    return;
  }

  // Detect pipeline state for all projects in parallel
  const results = await Promise.all(
    projectPaths.map(async (path): Promise<ProjectState> => {
      const pipeline = await detectPipeline(path);
      return {
        name: relative(root, path),
        path,
        pipeline,
      };
    })
  );

  console.log(formatGlobalStatus(results, root, json));
}
