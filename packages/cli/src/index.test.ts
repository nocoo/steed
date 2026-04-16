import { describe, it, expect } from "vitest";
import { createProgram } from "./index.js";

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
});
