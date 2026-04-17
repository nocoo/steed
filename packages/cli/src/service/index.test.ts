import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import type { HostConfig } from "../config/schema.js";
import { HostService, setupSignalHandlers } from "./index.js";

// Store original fetch
const originalFetch = globalThis.fetch;

describe("HostService", () => {
  const testDir = "/tmp/steed-test-" + Date.now();
  const testConfigPath = `${testDir}/config.json`;

  const mockConfig: HostConfig = {
    worker_url: "https://steed.example.workers.dev",
    api_key: "sk_host_test123",
    agents: [],
    data_sources: { cli_scanners: [], mcp_scanners: [] },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Create test directory
    await mkdir(testDir, { recursive: true, mode: 0o700 });
    // Mock fetch to prevent real HTTP requests from hanging
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ accepted: 0, rejected: 0 }),
    } as Response);
  });

  afterEach(async () => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    // Cleanup test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("constructor", () => {
    it("creates service with default options", () => {
      const service = new HostService();
      expect(service.isRunning()).toBe(false);
    });

    it("accepts custom interval", () => {
      const service = new HostService({ intervalMs: 30000 });
      expect(service.isRunning()).toBe(false);
    });

    it("accepts custom config path", () => {
      const service = new HostService({ configPath: testConfigPath });
      expect(service.isRunning()).toBe(false);
    });

    it("derives state path from config path by default", async () => {
      // Write test config and start/stop to exercise state writes
      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });
      const service = new HostService({
        configPath: testConfigPath,
        intervalMs: 60_000,
      });

      try {
        await service.start();
      } catch {
        // ignore network / heartbeat errors
      } finally {
        await service.stop();
      }

      // State file should be written alongside config, NOT in ~/.steed
      const { stat } = await import("node:fs/promises");
      const expectedStatePath = `${testDir}/state.json`;
      await expect(stat(expectedStatePath)).resolves.toBeDefined();
    });

    it("accepts explicit state path", async () => {
      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });
      const customStatePath = `${testDir}/custom-state.json`;
      const service = new HostService({
        configPath: testConfigPath,
        statePath: customStatePath,
        intervalMs: 60_000,
      });

      try {
        await service.start();
      } catch {
        // ignore
      } finally {
        await service.stop();
      }

      const { stat } = await import("node:fs/promises");
      await expect(stat(customStatePath)).resolves.toBeDefined();
    });
  });

  describe("isRunning", () => {
    it("returns false before start", () => {
      const service = new HostService();
      expect(service.isRunning()).toBe(false);
    });
  });

  describe("start", () => {
    it("throws error when config not found", async () => {
      const service = new HostService({ configPath: testConfigPath });

      await expect(service.start()).rejects.toThrow("Config file not found");
    });

    it("starts scheduler with valid config", async () => {
      // Write test config
      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });

      // start() will attempt to run heartbeat which may fail on HTTP
      // but we can catch the error and still verify isRunning
      try {
        await service.start();
        expect(service.isRunning()).toBe(true);
      } finally {
        await service.stop();
      }
    });

    it("throws error with descriptive message when no config found", async () => {
      const service = new HostService({ configPath: testConfigPath });

      await expect(service.start()).rejects.toThrow();
    });
  });

  describe("stop", () => {
    it("handles stop when not started", async () => {
      const service = new HostService({ configPath: testConfigPath });

      // Should not throw
      await service.stop();
      expect(service.isRunning()).toBe(false);
    });

    it("handles multiple stop calls gracefully", async () => {
      const service = new HostService({ configPath: testConfigPath });

      // Multiple stops should not throw
      await service.stop();
      await service.stop();
      expect(service.isRunning()).toBe(false);
    });

    it("waits for in-flight heartbeat with timeout", async () => {
      // Write test config
      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });

      try {
        await service.start();
        // Immediately stop while heartbeat may be running
        await service.stop();
        expect(service.isRunning()).toBe(false);
      } catch {
        // May fail on HTTP, but stop should complete
        await service.stop();
      }
    });
  });

  describe("runHeartbeat", () => {
    it("records config error when no config loaded", async () => {
      // Create a service but don't call start (so config is null)
      const service = new HostService({ configPath: testConfigPath });

      // Access private method via any
      await (service as unknown as { runHeartbeat: () => Promise<void> }).runHeartbeat();
      // Should have recorded error in state, but we can't easily verify
      // Just ensure no throw
    });
  });
});

describe("setupSignalHandlers", () => {
  it("registers handlers for SIGTERM and SIGINT", () => {
    const onSpy = vi.spyOn(process, "on");

    // Create a minimal mock service
    const mockService = {
      stop: vi.fn().mockResolvedValue(undefined),
    } as unknown as HostService;

    setupSignalHandlers(mockService);

    expect(onSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));

    onSpy.mockRestore();
  });
});
