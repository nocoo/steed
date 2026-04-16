import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import type { HostConfig } from "../config/schema.js";
import { Scanner } from "./scanner/index.js";
import { Reporter } from "./reporter.js";
import { StateManager } from "./state.js";
import { HostService } from "./index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn<(...args: any[]) => any>>;

describe("HostService with mocks", () => {
  const testDir = "/tmp/steed-mock-test-" + Date.now();
  const testConfigPath = `${testDir}/config.json`;

  const mockConfig: HostConfig = {
    worker_url: "https://steed.example.workers.dev",
    api_key: "sk_host_test123",
    agents: [],
    data_sources: { cli_scanners: [], mcp_scanners: [] },
  };

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true, mode: 0o700 });

    // Spy on class prototypes
    vi.spyOn(Scanner.prototype, "scan").mockResolvedValue({ agents: [], dataSources: [] });
    vi.spyOn(Reporter.prototype, "report").mockResolvedValue({ success: true, response: { host_id: "test" } });
    vi.spyOn(StateManager.prototype, "updateScanResults").mockResolvedValue(undefined);
    vi.spyOn(StateManager.prototype, "updateReportResults").mockResolvedValue(undefined);
    vi.spyOn(StateManager.prototype, "recordError").mockResolvedValue(undefined);
    vi.spyOn(StateManager.prototype, "clearError").mockResolvedValue(undefined);
    vi.spyOn(StateManager.prototype, "updateServicePid").mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("runHeartbeat", () => {
    it("handles successful scan and report", async () => {
      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });
      await service.start();
      await service.stop();

      expect(Scanner.prototype.scan).toHaveBeenCalled();
      expect(Reporter.prototype.report).toHaveBeenCalled();
      expect(StateManager.prototype.updateScanResults).toHaveBeenCalled();
      expect(StateManager.prototype.updateReportResults).toHaveBeenCalled();
      expect(StateManager.prototype.clearError).toHaveBeenCalled();
    });

    it("handles report failure", async () => {
      asMock(Reporter.prototype.report).mockResolvedValue({
        success: false,
        error: { message: "Network error" }
      });

      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });
      await service.start();
      await service.stop();

      expect(StateManager.prototype.recordError).toHaveBeenCalledWith("Network error", "report");
    });

    it("handles scan throw with config error", async () => {
      asMock(Scanner.prototype.scan).mockRejectedValue(new Error("Configuration error"));

      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });
      await service.start();
      await service.stop();

      expect(StateManager.prototype.recordError).toHaveBeenCalledWith("Configuration error", "config");
    });

    it("handles scan throw with network error", async () => {
      asMock(Scanner.prototype.scan).mockRejectedValue(new Error("Network fetch failed"));

      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });
      await service.start();
      await service.stop();

      expect(StateManager.prototype.recordError).toHaveBeenCalledWith("Network fetch failed", "report");
    });

    it("handles scan throw with HTTP error", async () => {
      asMock(Scanner.prototype.scan).mockRejectedValue(new Error("HTTP 500 Internal Server Error"));

      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });
      await service.start();
      await service.stop();

      expect(StateManager.prototype.recordError).toHaveBeenCalledWith("HTTP 500 Internal Server Error", "report");
    });

    it("handles scan throw with API error", async () => {
      asMock(Scanner.prototype.scan).mockRejectedValue(new Error("API rate limit exceeded"));

      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });
      await service.start();
      await service.stop();

      expect(StateManager.prototype.recordError).toHaveBeenCalledWith("API rate limit exceeded", "report");
    });

    it("handles scan throw with generic error", async () => {
      asMock(Scanner.prototype.scan).mockRejectedValue(new Error("Unknown error"));

      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });
      await service.start();
      await service.stop();

      expect(StateManager.prototype.recordError).toHaveBeenCalledWith("Unknown error", "scan");
    });

    it("handles non-Error throw", async () => {
      asMock(Scanner.prototype.scan).mockRejectedValue("string error");

      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });
      await service.start();
      await service.stop();

      expect(StateManager.prototype.recordError).toHaveBeenCalledWith("string error", "scan");
    });
  });
});
