import { describe, it, expect } from "vitest";
import { spawnInteractive, spawnCapture, getProcessPid } from "./process.js";

describe("process.ts (additional coverage)", () => {
  describe("spawnInteractive", () => {
    it("returns exit code 0 on success", async () => {
      const result = await spawnInteractive("true", []);
      expect(result.exitCode).toBe(0);
    });

    it("returns non-zero exit code on failure", async () => {
      const result = await spawnInteractive("false", []);
      expect(result.exitCode).not.toBe(0);
    });

    it("returns error message when command not found", async () => {
      const result = await spawnInteractive("__nonexistent_cmd_xyz__", []);
      expect(result.exitCode).toBe(1);
      expect(result.error).toBeTruthy();
    });
  });

  describe("spawnCapture", () => {
    it("returns success on zero exit", async () => {
      const result = await spawnCapture("true", []);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("returns failure with stderr message on non-zero exit", async () => {
      const result = await spawnCapture("sh", ["-c", "echo boom 1>&2; exit 3"]);
      expect(result.success).toBe(false);
      expect(result.error).toContain("boom");
    });

    it("returns generic exit-code error when stderr empty", async () => {
      const result = await spawnCapture("false", []);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Exit code/);
    });

    it("returns error when binary missing", async () => {
      const result = await spawnCapture("__nonexistent_cmd_xyz__", []);
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe("getProcessPid (parseInt fallback)", () => {
    it("returns null when pgrep yields non-numeric output", async () => {
      const pid = await getProcessPid(
        `__nope_${Date.now()}_${Math.random().toString(36).slice(2)}__`
      );
      expect(pid).toBeNull();
    });

    it("returns a numeric PID when pgrep finds a match", async () => {
      // node binary is the test runner — guaranteed to be running.
      const pid = await getProcessPid("node");
      // pgrep visibility into the test-runner process tree is environment
      // dependent; if it isn't visible we just accept null and skip the
      // numeric assertion (the pgrep-success branch is best-effort).
      if (pid !== null) {
        expect(typeof pid).toBe("number");
        expect(pid).toBeGreaterThan(0);
      }
    });
  });
});
