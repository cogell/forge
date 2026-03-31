import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export function makeTmpDir(prefix = "forge-test"): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function setupTestProject(dir: string, prefix: string): void {
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, "forge.json"), JSON.stringify({ prefix }, null, 2) + "\n");
  mkdirSync(join(dir, "plans"), { recursive: true });
}
