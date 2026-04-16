import { describe, it, expect } from "vitest";
import {
  isProcessRunning,
  getProcessPid,
  runCommand,
  binaryExistsInPath,
  killProcess,
} from "./process.js";

// Generate pattern at runtime with timestamp to ensure it never matches any process
// This avoids pgrep matching the test file content or process args
function getNonexistentPattern(): string {
  return `__nonexistent_proc_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
}

describe("process utilities", () => {
  describe("isProcessRunning", () => {
    it("returns true for current process (node/bun)", async () => {
      // Our test runner is running, so this should match
      const result = await isProcessRunning("bun");
      expect(result).toBe(true);
    });

    it("returns false for non-existent pattern", async () => {
      const result = await isProcessRunning(getNonexistentPattern());
      expect(result).toBe(false);
    });
  });

  describe("getProcessPid", () => {
    it("returns number for running process", async () => {
      const pid = await getProcessPid("bun");
      expect(pid).not.toBeNull();
      expect(typeof pid).toBe("number");
      expect(pid).toBeGreaterThan(0);
    });

    it("returns null for non-existent pattern", async () => {
      const pid = await getProcessPid(getNonexistentPattern());
      expect(pid).toBeNull();
    });
  });

  describe("runCommand", () => {
    it("runs command and returns exit code", async () => {
      const result = await runCommand("echo hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello");
    });

    it("returns non-zero for failing command", async () => {
      const result = await runCommand("false");
      expect(result.exitCode).not.toBe(0);
    });

    it("handles empty command", async () => {
      const result = await runCommand("");
      expect(result.exitCode).toBe(127);
    });

    it("handles command with only spaces", async () => {
      const result = await runCommand("   ");
      expect(result.exitCode).toBe(127);
    });
  });

  describe("binaryExistsInPath", () => {
    it("returns true for existing binary", async () => {
      const result = await binaryExistsInPath("ls");
      expect(result).toBe(true);
    });

    it("returns false for non-existent binary", async () => {
      const result = await binaryExistsInPath("nonexistent_binary_xyz_12345");
      expect(result).toBe(false);
    });
  });

  describe("killProcess", () => {
    it("returns false for non-existent PID", async () => {
      // Use a very high PID that's unlikely to exist
      const result = await killProcess(99999999);
      expect(result).toBe(false);
    });

    it("accepts custom signal", async () => {
      // Use a non-existent PID with custom signal
      const result = await killProcess(99999999, "SIGKILL");
      expect(result).toBe(false);
    });
  });
});
