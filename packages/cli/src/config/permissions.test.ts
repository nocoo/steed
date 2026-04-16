import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, stat, writeFile, chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  ensureDir,
  ensureFilePermissions,
  checkPermissions,
  fileExists,
  DIR_MODE,
  FILE_MODE,
} from "./permissions.js";

describe("permissions", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "steed-perm-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("ensureDir", () => {
    it("creates directory with correct permissions", async () => {
      const dirPath = join(tempDir, "newdir");

      await ensureDir(dirPath, DIR_MODE);

      const stats = await stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.mode & 0o777).toBe(DIR_MODE);
    });

    it("sets permissions on existing directory", async () => {
      const dirPath = join(tempDir, "existingdir");
      await mkdir(dirPath, { mode: 0o755 });

      await ensureDir(dirPath, DIR_MODE);

      const stats = await stat(dirPath);
      expect(stats.mode & 0o777).toBe(DIR_MODE);
    });
  });

  describe("ensureFilePermissions", () => {
    it("sets file permissions", async () => {
      const filePath = join(tempDir, "testfile");
      await writeFile(filePath, "content", { mode: 0o644 });

      await ensureFilePermissions(filePath, FILE_MODE);

      const stats = await stat(filePath);
      expect(stats.mode & 0o777).toBe(FILE_MODE);
    });
  });

  describe("checkPermissions", () => {
    it("returns ok for correct permissions", async () => {
      const filePath = join(tempDir, "goodfile");
      await writeFile(filePath, "content", { mode: FILE_MODE });

      const result = await checkPermissions(filePath);

      expect(result.ok).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it("returns warning for group readable", async () => {
      const filePath = join(tempDir, "groupreadable");
      await writeFile(filePath, "content");
      await chmod(filePath, 0o640);

      const result = await checkPermissions(filePath);

      expect(result.ok).toBe(false);
      expect(result.warning).toContain("group or others");
    });

    it("returns warning for world readable", async () => {
      const filePath = join(tempDir, "worldreadable");
      await writeFile(filePath, "content");
      await chmod(filePath, 0o604);

      const result = await checkPermissions(filePath);

      expect(result.ok).toBe(false);
      expect(result.warning).toContain("group or others");
    });

    it("returns ok for non-existent file", async () => {
      const filePath = join(tempDir, "nonexistent");

      const result = await checkPermissions(filePath);

      expect(result.ok).toBe(true);
    });
  });

  describe("fileExists", () => {
    it("returns true for existing file", async () => {
      const filePath = join(tempDir, "exists");
      await writeFile(filePath, "content");

      expect(await fileExists(filePath)).toBe(true);
    });

    it("returns false for non-existent file", async () => {
      const filePath = join(tempDir, "notexists");

      expect(await fileExists(filePath)).toBe(false);
    });
  });
});
