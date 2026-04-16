import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import type { HostConfig } from "../config/schema.js";

// Mocks for internal dependencies
const mockScan = vi.fn();
const mockReport = vi.fn();
const mockUpdateScanResults = vi.fn();
const mockUpdateReportResults = vi.fn();
const mockRecordError = vi.fn();
const mockClearError = vi.fn();
const mockUpdateServicePid = vi.fn();

vi.mock("./scanner/index.js", () => ({
  Scanner: class {
    scan = mockScan;
  },
}));

vi.mock("./reporter.js", () => ({
  Reporter: class {
    report = mockReport;
  },
}));

vi.mock("./state.js", () => ({
  StateManager: class {
    updateScanResults = mockUpdateScanResults;
    updateReportResults = mockUpdateReportResults;
    recordError = mockRecordError;
    clearError = mockClearError;
    updateServicePid = mockUpdateServicePid;
  },
}));

// Import after mocks
import { HostService } from "./index.js";

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
    vi.clearAllMocks();
    await mkdir(testDir, { recursive: true, mode: 0o700 });

    // Setup default mocks
    mockScan.mockResolvedValue({ agents: [], dataSources: [] });
    mockReport.mockResolvedValue({ success: true, response: { host_id: "test" } });
    mockUpdateScanResults.mockResolvedValue(undefined);
    mockUpdateReportResults.mockResolvedValue(undefined);
    mockRecordError.mockResolvedValue(undefined);
    mockClearError.mockResolvedValue(undefined);
    mockUpdateServicePid.mockResolvedValue(undefined);
  });

  afterEach(async () => {
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

      expect(mockScan).toHaveBeenCalled();
      expect(mockReport).toHaveBeenCalled();
      expect(mockUpdateScanResults).toHaveBeenCalled();
      expect(mockUpdateReportResults).toHaveBeenCalled();
      expect(mockClearError).toHaveBeenCalled();
    });

    it("handles report failure", async () => {
      mockReport.mockResolvedValue({
        success: false,
        error: { message: "Network error" }
      });

      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });
      await service.start();
      await service.stop();

      expect(mockRecordError).toHaveBeenCalledWith("Network error", "report");
    });

    it("handles scan throw with config error", async () => {
      mockScan.mockRejectedValue(new Error("Configuration error"));

      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });
      await service.start();
      await service.stop();

      expect(mockRecordError).toHaveBeenCalledWith("Configuration error", "config");
    });

    it("handles scan throw with network error", async () => {
      mockScan.mockRejectedValue(new Error("Network fetch failed"));

      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });
      await service.start();
      await service.stop();

      expect(mockRecordError).toHaveBeenCalledWith("Network fetch failed", "report");
    });

    it("handles scan throw with HTTP error", async () => {
      mockScan.mockRejectedValue(new Error("HTTP 500 Internal Server Error"));

      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });
      await service.start();
      await service.stop();

      expect(mockRecordError).toHaveBeenCalledWith("HTTP 500 Internal Server Error", "report");
    });

    it("handles scan throw with API error", async () => {
      mockScan.mockRejectedValue(new Error("API rate limit exceeded"));

      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });
      await service.start();
      await service.stop();

      expect(mockRecordError).toHaveBeenCalledWith("API rate limit exceeded", "report");
    });

    it("handles scan throw with generic error", async () => {
      mockScan.mockRejectedValue(new Error("Unknown error"));

      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });
      await service.start();
      await service.stop();

      expect(mockRecordError).toHaveBeenCalledWith("Unknown error", "scan");
    });

    it("handles non-Error throw", async () => {
      mockScan.mockRejectedValue("string error");

      await writeFile(testConfigPath, JSON.stringify(mockConfig), { mode: 0o600 });

      const service = new HostService({ configPath: testConfigPath, intervalMs: 60000 });
      await service.start();
      await service.stop();

      expect(mockRecordError).toHaveBeenCalledWith("string error", "scan");
    });
  });
});
