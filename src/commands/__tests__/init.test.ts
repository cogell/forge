import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { makeTmpDir } from "../../__tests__/helpers";

describe("forge init --prefix", () => {
  let tmp: string;
  let originalCwd: string;
  let consoleLogSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmp = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmp);
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    consoleLogSpy.mockRestore();
    if (existsSync(tmp)) {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("creates forge.json with valid prefix", async () => {
    const { init } = await import("../init");
    await init(["--prefix", "FORGE"]);
    const forgeJson = JSON.parse(readFileSync(join(tmp, "forge.json"), "utf-8"));
    expect(forgeJson.prefix).toBe("FORGE");
  });

  it("writes forge.json with proper formatting (2-space indent + trailing newline)", async () => {
    const { init } = await import("../init");
    await init(["--prefix", "MYAPP"]);
    const raw = readFileSync(join(tmp, "forge.json"), "utf-8");
    expect(raw).toBe(JSON.stringify({ prefix: "MYAPP" }, null, 2) + "\n");
  });

  it("still creates all dirs and templates alongside forge.json", async () => {
    const { init } = await import("../init");
    await init(["--prefix", "PROJ"]);

    // forge.json exists
    expect(existsSync(join(tmp, "forge.json"))).toBe(true);

    // Standard dirs exist
    expect(existsSync(join(tmp, "plans/_template"))).toBe(true);
    expect(existsSync(join(tmp, "plans/_archive"))).toBe(true);
    expect(existsSync(join(tmp, "docs/decisions"))).toBe(true);
    expect(existsSync(join(tmp, "docs/guides"))).toBe(true);
    expect(existsSync(join(tmp, "docs/reference"))).toBe(true);

    // Templates exist
    expect(existsSync(join(tmp, "plans/_template/prd.md"))).toBe(true);
    expect(existsSync(join(tmp, "plans/_template/plan.md"))).toBe(true);
    expect(existsSync(join(tmp, "docs/decisions/template.md"))).toBe(true);
  });

  it("rejects invalid prefix (lowercase)", async () => {
    const { init } = await import("../init");
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      await init(["--prefix", "forge"]);
    } catch {}

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("rejects invalid prefix (too short)", async () => {
    const { init } = await import("../init");
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      await init(["--prefix", "A"]);
    } catch {}

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("rejects invalid prefix (too long)", async () => {
    const { init } = await import("../init");
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      await init(["--prefix", "ABCDEFGHIJK"]);
    } catch {}

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("skips prefix step when forge.json already exists", async () => {
    // Pre-create forge.json with a different prefix
    writeFileSync(join(tmp, "forge.json"), JSON.stringify({ prefix: "OLD" }, null, 2) + "\n");

    const { init } = await import("../init");
    await init(["--prefix", "NEW"]);

    // Should still have the old prefix (not overwritten)
    const forgeJson = JSON.parse(readFileSync(join(tmp, "forge.json"), "utf-8"));
    expect(forgeJson.prefix).toBe("OLD");
  });

  it("skips forge.json creation in non-interactive mode without --prefix", async () => {
    // Simulate non-interactive (process.stdin.isTTY is undefined in tests)
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    const { init } = await import("../init");
    await init([]);

    // forge.json should NOT be created
    expect(existsSync(join(tmp, "forge.json"))).toBe(false);

    // But dirs/templates should still be created
    expect(existsSync(join(tmp, "plans/_template"))).toBe(true);

    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("preserves existing directory creation behavior (idempotent)", async () => {
    const { init } = await import("../init");

    // Run init twice
    await init(["--prefix", "TEST"]);
    await init(["--prefix", "TEST"]);

    // Everything should still be fine
    expect(existsSync(join(tmp, "forge.json"))).toBe(true);
    expect(existsSync(join(tmp, "plans/_template"))).toBe(true);
    expect(existsSync(join(tmp, "docs/decisions/template.md"))).toBe(true);
  });
});
