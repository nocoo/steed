import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  ConfigManager,
  ConfigNotFoundError,
  ConfigValidationError,
} from "./index.js";
import type { HostConfig } from "./schema.js";
import { FILE_MODE } from "./permissions.js";

describe("ConfigManager", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "steed-test-"));
    configPath = join(tempDir, "config.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const validConfig: HostConfig = {
    worker_url: "https://steed.example.workers.dev",
    api_key: "sk_host_abc123",
    agents: [],
    data_sources: { cli_scanners: [], mcp_scanners: [] },
  };

  describe("load", () => {
    it("loads valid config file", async () => {
      await writeFile(configPath, JSON.stringify(validConfig));
      const manager = new ConfigManager(configPath);

      const loaded = await manager.load();

      expect(loaded).toEqual(validConfig);
    });

    it("returns error for missing file", async () => {
      const manager = new ConfigManager(configPath);

      await expect(manager.load()).rejects.toThrow(ConfigNotFoundError);
    });

    it("returns error for invalid JSON", async () => {
      await writeFile(configPath, "not json {{{");
      const manager = new ConfigManager(configPath);

      await expect(manager.load()).rejects.toThrow(ConfigValidationError);
      await expect(manager.load()).rejects.toThrow("Invalid JSON");
    });

    it("returns error for schema validation failure", async () => {
      await writeFile(
        configPath,
        JSON.stringify({ worker_url: "invalid", api_key: "bad" })
      );
      const manager = new ConfigManager(configPath);

      await expect(manager.load()).rejects.toThrow(ConfigValidationError);
      await expect(manager.load()).rejects.toThrow("validation failed");
    });
  });

  describe("save", () => {
    it("creates file with correct permissions", async () => {
      const manager = new ConfigManager(configPath);

      await manager.save(validConfig);

      const stats = await stat(configPath);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(FILE_MODE);
    });

    it("creates directory if not exists", async () => {
      const nestedPath = join(tempDir, "nested", "dir", "config.json");
      const manager = new ConfigManager(nestedPath);

      await manager.save(validConfig);

      const stats = await stat(nestedPath);
      expect(stats.isFile()).toBe(true);
    });

    it("round-trip: save then load returns same data", async () => {
      const config: HostConfig = {
        worker_url: "https://steed.example.workers.dev",
        api_key: "sk_host_test123",
        agents: [
          {
            match_key: "openclaw:/home/agent",
            detection: {
              method: "process",
              pattern: "openclaw.*agent",
              version_command: "openclaw --version",
            },
          },
        ],
        data_sources: {
          cli_scanners: [
            {
              name: "wrangler",
              type: "third_party_cli",
              binary: "wrangler",
              auth_check: { method: "config_exists" },
            },
          ],
          mcp_scanners: [],
        },
      };

      const manager = new ConfigManager(configPath);

      await manager.save(config);
      const loaded = await manager.load();

      expect(loaded).toEqual(config);
    });

    it("rejects invalid config", async () => {
      const manager = new ConfigManager(configPath);
      const invalidConfig = {
        worker_url: "not-a-url",
        api_key: "invalid",
        agents: [],
        data_sources: { cli_scanners: [], mcp_scanners: [] },
      } as unknown as HostConfig;

      await expect(manager.save(invalidConfig)).rejects.toThrow(
        ConfigValidationError
      );
    });
  });

  describe("exists", () => {
    it("returns false for missing file", async () => {
      const manager = new ConfigManager(configPath);
      expect(await manager.exists()).toBe(false);
    });

    it("returns true for existing file", async () => {
      await writeFile(configPath, "{}");
      const manager = new ConfigManager(configPath);
      expect(await manager.exists()).toBe(true);
    });
  });

  describe("getPath", () => {
    it("returns configured path", () => {
      const manager = new ConfigManager(configPath);
      expect(manager.getPath()).toBe(configPath);
    });
  });
});
