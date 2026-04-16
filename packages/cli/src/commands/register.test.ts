import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runRegister } from "./register.js";
import { ConfigManager } from "../config/index.js";
import * as configModule from "../config/index.js";
import type { HostConfig } from "../config/schema.js";

const mockPost = vi.fn();

vi.mock("../lib/http.js", () => ({
  HttpClient: class {
    post = (...args: unknown[]) => mockPost(...args);
  },
}));

describe("register command", () => {
  let tempDir: string;
  let configPath: string;
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalWarn: typeof console.warn;
  let logs: string[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "steed-register-test-"));
    configPath = join(tempDir, "config.json");
    logs = [];
    originalLog = console.log;
    originalError = console.error;
    originalWarn = console.warn;
    console.log = vi.fn((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    console.error = vi.fn((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    console.warn = vi.fn((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    mockPost.mockReset();
  });

  afterEach(async () => {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const getValidConfig = (): HostConfig => ({
    worker_url: "https://steed.example.workers.dev",
    api_key: "sk_host_abc123",
    agents: [],
    data_sources: { cli_scanners: [], mcp_scanners: [] },
  });

  describe("runRegister", () => {
    it("returns 1 for invalid match-key format", async () => {
      // Create config file
      const manager = new ConfigManager(configPath);
      await manager.save(getValidConfig());

      // Mock the default ConfigManager to use our test path
      vi.spyOn(ConfigManager.prototype, "load").mockImplementation(async function (
        this: ConfigManager
      ) {
        return getValidConfig();
      });

      const exitCode = await runRegister({
        matchKey: "invalid-no-colon",
      });

      expect(exitCode).toBe(1);
      expect(logs.some((l) => l.includes("Invalid match-key format"))).toBe(true);
    });

    it("returns 1 when config not found", async () => {
      vi.spyOn(ConfigManager.prototype, "load").mockRejectedValue(
        new Error("Config not found")
      );

      const exitCode = await runRegister({
        matchKey: "openclaw:/home/agent",
      });

      expect(exitCode).toBe(1);
      expect(logs.some((l) => l.includes("Config not found"))).toBe(true);
    });

    it("returns 1 when agent already registered", async () => {
      const existingConfig = {
        ...getValidConfig(),
        agents: [
          {
            match_key: "openclaw:/home/agent",
            detection: {
              method: "process" as const,
              pattern: "openclaw",
            },
          },
        ],
      };

      vi.spyOn(ConfigManager.prototype, "load").mockResolvedValue(existingConfig);

      const exitCode = await runRegister({
        matchKey: "openclaw:/home/agent",
      });

      expect(exitCode).toBe(1);
      expect(logs.some((l) => l.includes("already registered"))).toBe(true);
    });

    it("registers agent with inferred detection settings", async () => {
      let savedConfig: HostConfig | null = null;
      vi.spyOn(ConfigManager.prototype, "load").mockResolvedValue(getValidConfig());
      vi.spyOn(ConfigManager.prototype, "save").mockImplementation(async (config) => {
        savedConfig = config;
      });

      const exitCode = await runRegister({
        matchKey: "openclaw:/home/nocoo/agent",
        localOnly: true,
      });

      expect(exitCode).toBe(0);
      expect(savedConfig).not.toBeNull();
      expect(savedConfig?.agents).toHaveLength(1);
      expect(savedConfig?.agents[0]?.match_key).toBe("openclaw:/home/nocoo/agent");
      expect(savedConfig?.agents[0]?.detection.method).toBe("process");
      expect(savedConfig?.agents[0]?.detection.pattern).toContain("openclaw");
      expect(savedConfig?.agents[0]?.detection.version_command).toBe("openclaw --version");

      expect(logs.some((l) => l.includes("Agent registered locally"))).toBe(true);
    });

    it("uses custom pattern when provided", async () => {
      let savedConfig: HostConfig | null = null;
      vi.spyOn(ConfigManager.prototype, "load").mockResolvedValue(getValidConfig());
      vi.spyOn(ConfigManager.prototype, "save").mockImplementation(async (config) => {
        savedConfig = config;
      });

      const exitCode = await runRegister({
        matchKey: "openclaw:/home/agent",
        pattern: "custom-pattern",
        localOnly: true,
      });

      expect(exitCode).toBe(0);
      expect(savedConfig?.agents[0]?.detection.pattern).toBe("custom-pattern");
    });

    it("uses custom version command when provided", async () => {
      let savedConfig: HostConfig | null = null;
      vi.spyOn(ConfigManager.prototype, "load").mockResolvedValue(getValidConfig());
      vi.spyOn(ConfigManager.prototype, "save").mockImplementation(async (config) => {
        savedConfig = config;
      });

      const exitCode = await runRegister({
        matchKey: "openclaw:/home/agent",
        versionCmd: "my-version-check",
        localOnly: true,
      });

      expect(exitCode).toBe(0);
      expect(savedConfig?.agents[0]?.detection.version_command).toBe("my-version-check");
    });

    it("supports config_file detection method", async () => {
      let savedConfig: HostConfig | null = null;
      vi.spyOn(ConfigManager.prototype, "load").mockResolvedValue(getValidConfig());
      vi.spyOn(ConfigManager.prototype, "save").mockImplementation(async (config) => {
        savedConfig = config;
      });

      const exitCode = await runRegister({
        matchKey: "hermes:/home/nocoo/.hermes/config.json",
        method: "config_file",
        localOnly: true,
      });

      expect(exitCode).toBe(0);
      expect(savedConfig?.agents[0]?.detection.method).toBe("config_file");
      // For config_file, pattern is the path from identifier
      expect(savedConfig?.agents[0]?.detection.pattern).toBe(
        "/home/nocoo/.hermes/config.json"
      );
    });

    it("returns 1 when save fails", async () => {
      vi.spyOn(ConfigManager.prototype, "load").mockResolvedValue(getValidConfig());
      vi.spyOn(ConfigManager.prototype, "save").mockRejectedValue(
        new Error("Disk full")
      );

      const exitCode = await runRegister({
        matchKey: "openclaw:/home/agent",
        localOnly: true,
      });

      expect(exitCode).toBe(1);
      expect(logs.some((l) => l.includes("Failed to save config"))).toBe(true);
    });

    it("registers with Worker API when not --local-only", async () => {
      vi.spyOn(ConfigManager.prototype, "load").mockResolvedValue(getValidConfig());
      vi.spyOn(ConfigManager.prototype, "save").mockResolvedValue(undefined);
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(getValidConfig());

      mockPost.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: "agent-123" }),
      });

      const exitCode = await runRegister({
        matchKey: "openclaw:/home/agent",
        // localOnly not set
      });

      expect(exitCode).toBe(0);
      expect(mockPost).toHaveBeenCalledWith("/api/v1/agents", expect.objectContaining({
        match_key: "openclaw:/home/agent",
      }));
      expect(logs.some((l) => l.includes("Agent registered with Worker"))).toBe(true);
    });

    it("handles Worker API failure gracefully", async () => {
      vi.spyOn(ConfigManager.prototype, "load").mockResolvedValue(getValidConfig());
      vi.spyOn(ConfigManager.prototype, "save").mockResolvedValue(undefined);
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(getValidConfig());

      mockPost.mockResolvedValue({
        ok: false,
        statusText: "Internal Server Error",
        json: () => Promise.resolve({ error: "server error" }),
      });

      const exitCode = await runRegister({
        matchKey: "openclaw:/home/agent2",
      });

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("Worker registration failed"))).toBe(true);
      expect(logs.some((l) => l.includes("registered locally"))).toBe(true);
    });

    it("handles Worker API network error gracefully", async () => {
      vi.spyOn(ConfigManager.prototype, "load").mockResolvedValue(getValidConfig());
      vi.spyOn(ConfigManager.prototype, "save").mockResolvedValue(undefined);
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(getValidConfig());

      mockPost.mockRejectedValue(new Error("Connection refused"));

      const exitCode = await runRegister({
        matchKey: "openclaw:/home/agent3",
      });

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("Connection refused"))).toBe(true);
    });
  });

  describe("createRegisterCommand", () => {
    it("registers command with required options", async () => {
      const { createRegisterCommand } = await import("./register.js");
      const { Command } = await import("commander");
      const program = new Command();
      createRegisterCommand(program);

      const cmd = program.commands.find((c) => c.name() === "register");
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain("Register");
    });
  });
});
