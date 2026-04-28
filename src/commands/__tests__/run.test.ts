/**
 * Tests for src/commands/run.ts CLI dispatch.
 *
 * Covers FORGE-5.2: --epic / --phase flag parsing with relaxed feature guard.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { makeTmpDir, setupTestProject } from "../../__tests__/helpers";
import { run } from "../run";

function setupFeature(dir: string, feature: string): void {
  const featureDir = join(dir, "plans", feature);
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, "prd.md"), "# PRD\n");
  writeFileSync(join(featureDir, "plan.md"), "---\nstatus: active\n---\n# Plan\n");
}

describe("forge run CLI", () => {
  let tmp: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmp = makeTmpDir("forge-run-cmd");
    originalCwd = process.cwd();
    process.chdir(tmp);
    setupTestProject(tmp, "TEST");
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it("--epic and --phase together exit 2 with mutex error", async () => {
    setupFeature(tmp, "auth");
    try {
      await run(["auth", "--epic", "SK-5", "--phase", "1"]);
    } catch {}
    expect(exitSpy).toHaveBeenCalledWith(2);
    const errMsgs = errorSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(errMsgs).toMatch(/--epic/);
    expect(errMsgs).toMatch(/--phase/);
    expect(errMsgs).toMatch(/mutually exclusive/i);
  });

  it("--epic alone (no feature positional) emits JSON with epic+phase keys and exits 0", async () => {
    // Note: deliberately no setupFeature — --epic alone must skip feature-scoped checks.
    try {
      await run(["--epic", "SK-5", "--json"]);
    } catch {}
    // Should not have exited at all (or exited 0). It must NOT have exited 1.
    const exitCalls = exitSpy.mock.calls.map((c: any[]) => c[0]);
    expect(exitCalls).not.toContain(1);

    // No precondition error JSON should have been printed.
    const logged = logSpy.mock.calls.map((c: any[]) => String(c[0]));
    for (const line of logged) {
      expect(line).not.toMatch(/"error":\s*"no-prd"/);
      expect(line).not.toMatch(/"error":\s*"no-plan"/);
      expect(line).not.toMatch(/"error":\s*"no-epic"/);
    }

    // Find a JSON log entry with epic + phase keys.
    let parsed: any = null;
    for (const line of logged) {
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === "object" && "epic" in obj && "phase" in obj) {
          parsed = obj;
          break;
        }
      } catch {}
    }
    expect(parsed).not.toBeNull();
    expect(parsed.epic).toBe("SK-5");
    expect(parsed.phase).toBeNull();
  });

  it("--phase without feature positional exits 1 with specific message", async () => {
    try {
      await run(["--phase", "5"]);
    } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errMsgs = errorSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(errMsgs).toMatch(/--phase requires a feature positional/);
  });

  it("no args exits 1 with existing Usage: message (backward compat)", async () => {
    try {
      await run([]);
    } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errMsgs = errorSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(errMsgs).toMatch(/Usage:/);
  });

  it("JSON output contains literal epic and phase keys (string|null and number|null)", async () => {
    try {
      await run(["--epic", "EP-1", "--json"]);
    } catch {}
    const logged = logSpy.mock.calls.map((c: any[]) => String(c[0]));
    let parsed: any = null;
    for (const line of logged) {
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === "object" && "epic" in obj && "phase" in obj) {
          parsed = obj;
          break;
        }
      } catch {}
    }
    expect(parsed).not.toBeNull();
    // epic must be a string, phase must be null in this case.
    expect(typeof parsed.epic).toBe("string");
    expect(parsed.phase).toBeNull();
  });

  it("--phase rejects non-integer values with non-zero exit", async () => {
    setupFeature(tmp, "auth");
    try {
      await run(["auth", "--phase", "abc"]);
    } catch {}
    // Must exit non-zero.
    const exitCalls = exitSpy.mock.calls.map((c: any[]) => c[0]);
    const exited = exitCalls.find((code: any) => code !== 0);
    expect(exited).toBeDefined();
    expect(exited).not.toBe(0);
    const errMsgs = errorSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(errMsgs).toMatch(/--phase/);
  });

  it("value-flag-aware parsing: '--epic SK-5' does not set feature positional to 'SK-5'", async () => {
    // If the parser were broken, 'SK-5' would be picked up as a feature, leading to
    // a no-prd / no-forge.json / etc. failure. With proper parsing, --epic alone
    // (no feature positional) should succeed without precondition errors.
    try {
      await run(["--epic", "SK-5", "--json"]);
    } catch {}
    const logged = logSpy.mock.calls.map((c: any[]) => String(c[0]));
    for (const line of logged) {
      // If 'SK-5' had been treated as a feature positional, the precondition path
      // would have emitted error JSON or printed feature-scoped output. Make sure
      // we did NOT see a feature key in the output set to 'SK-5'.
      expect(line).not.toMatch(/"feature":\s*"SK-5"/);
      expect(line).not.toMatch(/"error":\s*"no-prd"/);
    }
  });

  it("empty-string positional with --epic is treated as no-feature", async () => {
    try {
      await run(["", "--epic", "SK-5", "--json"]);
    } catch {}
    // Should not exit 1 (i.e., not fall through into 'Usage:' branch nor feature checks).
    const exitCalls = exitSpy.mock.calls.map((c: any[]) => c[0]);
    expect(exitCalls).not.toContain(1);

    const logged = logSpy.mock.calls.map((c: any[]) => String(c[0]));
    let parsed: any = null;
    for (const line of logged) {
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === "object" && "epic" in obj && "phase" in obj) {
          parsed = obj;
          break;
        }
      } catch {}
    }
    expect(parsed).not.toBeNull();
    expect(parsed.epic).toBe("SK-5");
  });

  it("feature-scoped JSON output contains literal epic and phase keys (AC #5 'regardless of flags')", async () => {
    setupFeature(tmp, "auth");
    try {
      await run(["auth", "--json"]);
    } catch {}
    const logged = logSpy.mock.calls.map((c: any[]) => String(c[0]));
    let parsed: any = null;
    for (const line of logged) {
      try {
        const obj = JSON.parse(line);
        if (
          obj &&
          typeof obj === "object" &&
          "feature" in obj &&
          obj.feature === "auth"
        ) {
          parsed = obj;
          break;
        }
      } catch {}
    }
    expect(parsed).not.toBeNull();
    // AC #5: literal keys must be present even when neither flag was supplied.
    expect("epic" in parsed).toBe(true);
    expect("phase" in parsed).toBe(true);
    expect(parsed.epic).toBeNull();
    expect(parsed.phase).toBeNull();
  });
});
