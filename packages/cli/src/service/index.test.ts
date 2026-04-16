import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { HostService, setupSignalHandlers } from "./index.js";
import type { HostConfig } from "../config/schema.js";

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
    // Create test directory
    await mkdir(testDir, { recursive: true, mode: 0o700 });
  });

  afterEach(async () => {
    vi.useRealTimers();
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

      // start() will attempt to run heartbeat which will fail on HTTP
      // but that's OK - we're testing that the service starts
      try {
        await service.start();
        expect(service.isRunning()).toBe(true);
      } finally {
        await service.stop();
      }
    });
  });

  describe("stop", () => {
    it("stops running service", async () => {
      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });

      try {
        await service.start();
      } catch {
        // Ignore heartbeat errors
      }

      await service.stop();
      expect(service.isRunning()).toBe(false);
    });

    it("handles stop when not started", async () => {
      const service = new HostService({ configPath: testConfigPath });

      // Should not throw
      await service.stop();
      expect(service.isRunning()).toBe(false);
    });

    it("handles multiple stop calls", async () => {
      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });

      try {
        await service.start();
      } catch {
        // Ignore heartbeat errors
      }

      await service.stop();
      await service.stop(); // Second stop should not throw
      expect(service.isRunning()).toBe(false);
    });
  });

  describe("runHeartbeat", () => {
    it("handles errors gracefully", async () => {
      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });

      // runHeartbeat without start should handle missing config
      await service.runHeartbeat();

      // Should not throw
      expect(true).toBe(true);
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
