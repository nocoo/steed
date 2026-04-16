import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { isInPath, getBinaryPath, expandPath } from "./path.js";

describe("path utilities", () => {
  describe("isInPath", () => {
    it("returns true for 'ls'", async () => {
      const result = await isInPath("ls");
      expect(result).toBe(true);
    });

    it("returns false for non-existent binary", async () => {
      const result = await isInPath("nonexistent_binary_xyz_12345");
      expect(result).toBe(false);
    });
  });

  describe("getBinaryPath", () => {
    it("returns path for 'ls'", async () => {
      const path = await getBinaryPath("ls");
      expect(path).not.toBeNull();
      expect(path).toContain("/");
      expect(path).toContain("ls");
    });

    it("returns null for non-existent binary", async () => {
      const path = await getBinaryPath("nonexistent_binary_xyz_12345");
      expect(path).toBeNull();
    });
  });

  describe("expandPath", () => {
    it("expands ~/path correctly", () => {
      const result = expandPath("~/.config/test");
      expect(result).toBe(`${homedir()}/.config/test`);
    });

    it("expands bare ~ correctly", () => {
      const result = expandPath("~");
      expect(result).toBe(homedir());
    });

    it("leaves absolute path unchanged", () => {
      const result = expandPath("/usr/local/bin");
      expect(result).toBe("/usr/local/bin");
    });

    it("leaves relative path unchanged", () => {
      const result = expandPath("relative/path");
      expect(result).toBe("relative/path");
    });
  });
});
