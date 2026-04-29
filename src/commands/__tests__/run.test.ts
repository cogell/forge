/**
 * Tests for src/commands/run.ts CLI dispatch.
 *
 * Covers:
 *  - FORGE-5.2: --epic / --phase flag parsing with relaxed feature guard.
 *  - FORGE-5.3: precondition JSON additions (planningArtifactsDirty,
 *               suggestedPhase, suggestedPhaseDiagnostic) plus the helper
 *               detectDirtyPlanningArtifacts.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { makeTmpDir, setupTestProject } from "../../__tests__/helpers";
import { run, detectDirtyPlanningArtifacts, type GitRunner } from "../run";

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

  it.each([
    ["0", "zero"],
    ["-1", "negative"],
    ["1.5", "decimal"],
    ["5e2", "scientific"],
    ["0x10", "hex"],
    [" 5 ", "padded"],
    ["01", "leading-zero"],
  ])("--phase rejects '%s' (%s) with positive-integer error", async (value) => {
    setupFeature(tmp, "auth");
    try {
      await run(["auth", "--phase", value]);
    } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errMsgs = errorSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(errMsgs).toMatch(/--phase requires a positive integer/);
  });

  it("--epic rejects empty string with explicit error", async () => {
    try {
      await run(["--epic", "", "--json"]);
    } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errMsgs = errorSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(errMsgs).toMatch(/--epic requires a non-empty value/);
  });

  it("--phase rejects empty string with explicit error", async () => {
    setupFeature(tmp, "auth");
    try {
      await run(["auth", "--phase", ""]);
    } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errMsgs = errorSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(errMsgs).toMatch(/--phase requires a non-empty value/);
  });

  it("rejects feature names with path-traversal sequences", async () => {
    try {
      await run(["../etc"]);
    } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errMsgs = errorSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(errMsgs).toMatch(/Invalid feature name/);
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

  // ─── FORGE-5.3: precondition JSON additions ──────────────────────────────

  it("case (a) — --epic alone JSON shape is exactly the documented contract", async () => {
    try {
      await run(["--epic", "SK-5", "--json"]);
    } catch {}
    const logged = logSpy.mock.calls.map((c: any[]) => String(c[0]));
    let parsed: any = null;
    for (const line of logged) {
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === "object" && obj.feature === null && "epic" in obj) {
          parsed = obj;
          break;
        }
      } catch {}
    }
    expect(parsed).not.toBeNull();
    // Exact shape per AC #3.
    expect(parsed.status).toBe("ready");
    expect(parsed.feature).toBeNull();
    expect(parsed.epic).toBe("SK-5");
    expect(parsed.phase).toBeNull();
    expect(parsed.planningArtifactsDirty).toBe(false);
    expect(parsed.suggestedPhase).toBeNull();
    expect(parsed.suggestedPhaseDiagnostic).toBe(
      "--epic supplied explicitly; phase auto-detect skipped",
    );
    // 'checks' and 'steps' are omitted in the short-form output.
    expect("checks" in parsed).toBe(false);
    expect("steps" in parsed).toBe(false);
  });

  it("case (b) — --epic + feature short-circuits the auto-detect", async () => {
    setupFeature(tmp, "auth");
    try {
      await run(["auth", "--epic", "SK-5", "--json"]);
    } catch {}
    const logged = logSpy.mock.calls.map((c: any[]) => String(c[0]));
    const parsed = logged.map((l: string) => { try { return JSON.parse(l); } catch { return null; } })
      .find((o: any) => o && o.feature === "auth");
    expect(parsed).toBeDefined();
    expect(parsed.suggestedPhase).toBeNull();
    expect(parsed.suggestedPhaseDiagnostic).toBe(
      "--epic supplied explicitly; phase auto-detect skipped",
    );
    expect(parsed.epic).toBe("SK-5");
    expect("planningArtifactsDirty" in parsed).toBe(true);
  });

  it("case (d) — feature alone delegates suggestedPhase to nextOpenPhase", async () => {
    // Feature exists with prd.md/plan.md but no tasks.json — nextOpenPhase
    // returns the 'no tasks.json found for feature' diagnostic, which the CLI
    // passes through verbatim per AC #10.
    setupFeature(tmp, "auth");
    try {
      await run(["auth", "--json"]);
    } catch {}
    const logged = logSpy.mock.calls.map((c: any[]) => String(c[0]));
    const parsed = logged.map((l: string) => { try { return JSON.parse(l); } catch { return null; } })
      .find((o: any) => o && o.feature === "auth");
    expect(parsed).toBeDefined();
    expect(parsed.suggestedPhase).toBeNull();
    expect(parsed.suggestedPhaseDiagnostic).toBe("no tasks.json found for feature");
  });

  it("feature-scoped JSON contains all three FORGE-5.3 keys (AC #1)", async () => {
    setupFeature(tmp, "auth");
    try {
      await run(["auth", "--json"]);
    } catch {}
    const logged = logSpy.mock.calls.map((c: any[]) => String(c[0]));
    const parsed = logged.map((l: string) => { try { return JSON.parse(l); } catch { return null; } })
      .find((o: any) => o && o.feature === "auth");
    expect(parsed).toBeDefined();
    expect("planningArtifactsDirty" in parsed).toBe(true);
    expect("suggestedPhase" in parsed).toBe(true);
    expect("suggestedPhaseDiagnostic" in parsed).toBe(true);
    expect(typeof parsed.planningArtifactsDirty).toBe("boolean");
  });

  it("--json suppresses the human-readable Planning/Phase info lines (AC #9)", async () => {
    setupFeature(tmp, "auth");
    try {
      await run(["auth", "--json"]);
    } catch {}
    const logged = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    // The non-JSON path prints these prefixed lines; --json must not.
    expect(logged).not.toMatch(/^Planning:\s/m);
    expect(logged).not.toMatch(/^Phase:\s/m);
  });
});

// ─── detectDirtyPlanningArtifacts (helper-direct, stub runner) ──────────────

describe("detectDirtyPlanningArtifacts", () => {
  it("returns false on a clean tree (stub returns empty stdout)", async () => {
    const stub: GitRunner = async () => ({ stdout: "" });
    expect(await detectDirtyPlanningArtifacts("auth", "/tmp", stub)).toBe(false);
  });

  it("returns true when stub reports plan.md is dirty", async () => {
    const stub: GitRunner = async () => ({ stdout: " M plans/auth/plan.md\n" });
    expect(await detectDirtyPlanningArtifacts("auth", "/tmp", stub)).toBe(true);
  });

  it("returns true when stub reports tasks.json is dirty", async () => {
    const stub: GitRunner = async () => ({ stdout: " M plans/auth/tasks.json\n" });
    expect(await detectDirtyPlanningArtifacts("auth", "/tmp", stub)).toBe(true);
  });

  it("returns false when only out-of-scope files are dirty (path filter blocks them)", async () => {
    // git status --porcelain -- <paths> returns empty when only files outside
    // <paths> are modified, so the stub mirrors that.
    const stub: GitRunner = async () => ({ stdout: "" });
    expect(await detectDirtyPlanningArtifacts("auth", "/tmp", stub)).toBe(false);
  });

  it("returns false when feature directory is missing (path filter yields empty)", async () => {
    const stub: GitRunner = async () => ({ stdout: "" });
    expect(await detectDirtyPlanningArtifacts("missing-feature", "/tmp", stub)).toBe(false);
  });

  it("invokes the runner with status --porcelain scoped to plan.md and tasks.json", async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const stub: GitRunner = async (args, cwd) => {
      calls.push({ args, cwd });
      return { stdout: "" };
    };
    await detectDirtyPlanningArtifacts("auth", "/some/cwd", stub);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([
      "status",
      "--porcelain",
      "--",
      "plans/auth/plan.md",
      "plans/auth/tasks.json",
    ]);
    expect(calls[0].cwd).toBe("/some/cwd");
  });
});
