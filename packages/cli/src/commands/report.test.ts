import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runReport } from "./report.js";
import * as configModule from "../config/index.js";
import * as reporterModule from "../service/reporter.js";
import * as stateModule from "../service/state.js";
import type { HostConfig, LocalSnapshotResponse } from "../config/schema.js";

describe("report command", () => {
  let tempDir: string;
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalWarn: typeof console.warn;
  let logs: string[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "steed-report-test-"));
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
    agents: [
      {
        match_key: "bun:test",
        detection: {
          method: "process",
          pattern: "bun",
        },
      },
    ],
    data_sources: {
      cli_scanners: [
        {
          name: "echo",
          type: "personal_cli",
          binary: "echo",
          version_command: "echo v1.0.0",
        },
      ],
      mcp_scanners: [],
    },
  });

  const mockSuccessResponse: LocalSnapshotResponse = {
    host_id: "host_abc123",
    agents_updated: 1,
    agents_missing: 0,
    data_sources_updated: 1,
    data_sources_created: 0,
    data_sources_missing: 0,
  };

  describe("runReport", () => {
    it("returns 1 when no config exists", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(null);

      const exitCode = await runReport({});

      expect(exitCode).toBe(1);
      expect(logs.some((l) => l.includes("No config found"))).toBe(true);
    });

    it("performs dry run without sending report", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(getValidConfig());

      const exitCode = await runReport({ dryRun: true });

      expect(exitCode).toBe(0);
      // Should have JSON output of payload
      const jsonOutput = logs.find((l) => l.includes('"agents"'));
      expect(jsonOutput).toBeDefined();
    });

    it("sends report and shows success", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(getValidConfig());
      vi.spyOn(reporterModule.Reporter.prototype, "report").mockResolvedValue({
        success: true,
        response: mockSuccessResponse,
      });
      vi.spyOn(stateModule.StateManager.prototype, "updateScanResults").mockResolvedValue(
        undefined
      );
      vi.spyOn(
        stateModule.StateManager.prototype,
        "updateReportResults"
      ).mockResolvedValue(undefined);
      vi.spyOn(stateModule.StateManager.prototype, "clearError").mockResolvedValue(
        undefined
      );

      const exitCode = await runReport({});

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("Report sent successfully"))).toBe(true);
      expect(logs.some((l) => l.includes("Agents updated: 1"))).toBe(true);
    });

    it("handles auth error", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(getValidConfig());
      vi.spyOn(reporterModule.Reporter.prototype, "report").mockResolvedValue({
        success: false,
        error: { type: "auth", message: "Invalid API key" },
      });
      vi.spyOn(stateModule.StateManager.prototype, "updateScanResults").mockResolvedValue(
        undefined
      );
      vi.spyOn(stateModule.StateManager.prototype, "recordError").mockResolvedValue(
        undefined
      );

      const exitCode = await runReport({});

      expect(exitCode).toBe(1);
      expect(logs.some((l) => l.includes("Authentication failed"))).toBe(true);
    });

    it("handles network error", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(getValidConfig());
      vi.spyOn(reporterModule.Reporter.prototype, "report").mockResolvedValue({
        success: false,
        error: { type: "network", message: "Connection refused" },
      });
      vi.spyOn(stateModule.StateManager.prototype, "updateScanResults").mockResolvedValue(
        undefined
      );
      vi.spyOn(stateModule.StateManager.prototype, "recordError").mockResolvedValue(
        undefined
      );

      const exitCode = await runReport({});

      expect(exitCode).toBe(1);
      expect(logs.some((l) => l.includes("Network error"))).toBe(true);
    });

    it("handles API error", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(getValidConfig());
      vi.spyOn(reporterModule.Reporter.prototype, "report").mockResolvedValue({
        success: false,
        error: { type: "api", message: "Server error" },
      });
      vi.spyOn(stateModule.StateManager.prototype, "updateScanResults").mockResolvedValue(
        undefined
      );
      vi.spyOn(stateModule.StateManager.prototype, "recordError").mockResolvedValue(
        undefined
      );

      const exitCode = await runReport({});

      expect(exitCode).toBe(1);
      expect(logs.some((l) => l.includes("API error"))).toBe(true);
    });
  });
});
