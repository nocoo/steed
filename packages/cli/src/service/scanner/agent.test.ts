import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { AgentScanner } from "./agent.js";
import type { RegisteredAgent } from "../../config/schema.js";

// Generate pattern at runtime with timestamp to ensure it never matches any process
// This avoids pgrep matching the test file content or process args
function getNonexistentPattern(): string {
  return `__nonexistent_proc_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
}

describe("AgentScanner", () => {
  let scanner: AgentScanner;
  let tempDir: string;

  beforeEach(async () => {
    scanner = new AgentScanner();
    tempDir = await mkdtemp(join(tmpdir(), "steed-agent-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("process detection", () => {
    it("returns running when process found", async () => {
      // bun is running during tests
      const agent: RegisteredAgent = {
        match_key: "bun:test",
        detection: {
          method: "process",
          pattern: "bun",
        },
      };

      const result = await scanner.scanOne(agent);

      expect(result).not.toBeNull();
      expect(result?.status).toBe("running");
      expect(result?.runtime_app).toBe("bun");
    });

    it("returns stopped when process not found", async () => {
      const agent: RegisteredAgent = {
        match_key: "nonexistent:test",
        detection: {
          method: "process",
          pattern: getNonexistentPattern(),
        },
      };

      const result = await scanner.scanOne(agent);

      expect(result).not.toBeNull();
      expect(result?.status).toBe("stopped");
    });
  });

  describe("config_file detection", () => {
    it("returns stopped when file exists", async () => {
      const configPath = join(tempDir, "config.json");
      await writeFile(configPath, "{}");

      const agent: RegisteredAgent = {
        match_key: "testapp:test",
        detection: {
          method: "config_file",
          pattern: configPath,
        },
      };

      const result = await scanner.scanOne(agent);

      expect(result).not.toBeNull();
      expect(result?.status).toBe("stopped");
    });

    it("returns null when file does not exist", async () => {
      const agent: RegisteredAgent = {
        match_key: "testapp:test",
        detection: {
          method: "config_file",
          pattern: join(tempDir, "nonexistent.json"),
        },
      };

      const result = await scanner.scanOne(agent);

      expect(result).toBeNull();
    });
  });

  describe("custom detection", () => {
    it("returns running when exit code 0", async () => {
      const agent: RegisteredAgent = {
        match_key: "custom:test",
        detection: {
          method: "custom",
          pattern: "true", // exits 0
        },
      };

      const result = await scanner.scanOne(agent);

      expect(result).not.toBeNull();
      expect(result?.status).toBe("running");
    });

    it("returns stopped when exit code 1", async () => {
      const agent: RegisteredAgent = {
        match_key: "custom:test",
        detection: {
          method: "custom",
          pattern: "false", // exits 1
        },
      };

      const result = await scanner.scanOne(agent);

      expect(result).not.toBeNull();
      expect(result?.status).toBe("stopped");
    });

    it("returns null when exit code >= 2", async () => {
      const agent: RegisteredAgent = {
        match_key: "custom:test",
        detection: {
          method: "custom",
          pattern: "exit 2", // exits 2
        },
      };

      const result = await scanner.scanOne(agent);

      expect(result).toBeNull();
    });
  });

  describe("version collection", () => {
    it("collects version when command configured", async () => {
      const agent: RegisteredAgent = {
        match_key: "echo:test",
        detection: {
          method: "process",
          pattern: "bun",
          version_command: "echo 'v1.2.3'",
        },
      };

      const result = await scanner.scanOne(agent);

      expect(result).not.toBeNull();
      expect(result?.runtime_version).toBe("1.2.3");
    });

    it("returns null version when command fails", async () => {
      const agent: RegisteredAgent = {
        match_key: "test:test",
        detection: {
          method: "process",
          pattern: "bun",
          version_command: "false", // exits non-zero
        },
      };

      const result = await scanner.scanOne(agent);

      expect(result).not.toBeNull();
      expect(result?.runtime_version).toBeNull();
    });
  });

  describe("match key parsing", () => {
    it("extracts runtime_app from match_key", async () => {
      const agent: RegisteredAgent = {
        match_key: "openclaw:/home/user/agent",
        detection: {
          method: "process",
          pattern: "bun",
        },
      };

      const result = await scanner.scanOne(agent);

      expect(result?.runtime_app).toBe("openclaw");
    });

    it("returns null for invalid match_key format", async () => {
      const agent: RegisteredAgent = {
        match_key: "invalid-no-colon",
        detection: {
          method: "process",
          pattern: "bun",
        },
      };

      const result = await scanner.scanOne(agent);

      expect(result).toBeNull();
    });
  });

  describe("scan multiple agents", () => {
    it("returns results for all valid agents", async () => {
      const configPath = join(tempDir, "config.json");
      await writeFile(configPath, "{}");

      const agents: RegisteredAgent[] = [
        {
          match_key: "app1:test",
          detection: { method: "process", pattern: "bun" },
        },
        {
          match_key: "app2:test",
          detection: { method: "config_file", pattern: configPath },
        },
      ];

      const results = await scanner.scan(agents);

      expect(results).toHaveLength(2);
    });

    it("excludes agents that return null", async () => {
      const agents: RegisteredAgent[] = [
        {
          match_key: "app1:test",
          detection: { method: "process", pattern: "bun" },
        },
        {
          match_key: "app2:test",
          detection: {
            method: "config_file",
            pattern: "/nonexistent/path",
          },
        },
      ];

      const results = await scanner.scan(agents);

      expect(results).toHaveLength(1);
      expect(results[0]?.runtime_app).toBe("app1");
    });
  });
});
