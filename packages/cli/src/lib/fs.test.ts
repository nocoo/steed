import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeServiceFile, removeFile } from "./fs.js";

describe("fs helpers", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "steed-fs-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("writeServiceFile", () => {
    it("writes content with default mode 0o644", async () => {
      const path = join(dir, "default.txt");
      await writeServiceFile(path, "hello");
      expect((await readFile(path, "utf8"))).toBe("hello");
      const st = await stat(path);
      expect(st.mode & 0o777).toBe(0o644);
    });

    it("respects custom mode", async () => {
      const path = join(dir, "exec.sh");
      await writeServiceFile(path, "#!/bin/sh\n", 0o755);
      const st = await stat(path);
      expect(st.mode & 0o777).toBe(0o755);
    });
  });

  describe("removeFile", () => {
    it("removes an existing file", async () => {
      const path = join(dir, "to-remove.txt");
      await writeFile(path, "x");
      await removeFile(path);
      await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("rejects when file does not exist", async () => {
      await expect(removeFile(join(dir, "missing.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });
});
