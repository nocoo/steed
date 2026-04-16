import { describe, it, expect, vi } from "vitest";
import { createProgram, main } from "./index.js";

describe("CLI", () => {
  it("--version shows version", () => {
    const program = createProgram();
    program.exitOverride();

    let output = "";
    program.configureOutput({
      writeOut: (str) => {
        output = str;
      },
    });

    expect(() => program.parse(["node", "steed", "--version"])).toThrow();
    expect(output).toContain("0.1.0");
  });

  it("--help shows help", () => {
    const program = createProgram();
    program.exitOverride();

    let output = "";
    program.configureOutput({
      writeOut: (str) => {
        output = str;
      },
    });

    expect(() => program.parse(["node", "steed", "--help"])).toThrow();
    expect(output).toContain("Steed CLI");
    expect(output).toContain("init");
    expect(output).toContain("scan");
    expect(output).toContain("report");
    expect(output).toContain("register");
    expect(output).toContain("status");
    expect(output).toContain("config");
    expect(output).toContain("service");
  });

  it("unknown command shows error", () => {
    const program = createProgram();
    program.exitOverride();

    let errorOutput = "";
    program.configureOutput({
      writeErr: (str) => {
        errorOutput = str;
      },
    });

    expect(() => program.parse(["node", "steed", "unknown"])).toThrow();
    expect(errorOutput).toContain("unknown");
  });

  it("main function executes without error", () => {
    // Mock process.argv
    const originalArgv = process.argv;
    process.argv = ["node", "steed", "--help"];

    // Suppress output
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`process.exit called with ${code}`);
    });

    try {
      main();
    } catch {
      // Expected to throw due to --help triggering exit
    }

    // Restore
    process.argv = originalArgv;
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });
});
