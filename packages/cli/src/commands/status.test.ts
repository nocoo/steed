import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runStatus } from "./status.js";
import * as configModule from "../config/index.js";
import * as stateModule from "../service/state.js";
import * as processModule from "../lib/process.js";
import type { HostConfig, HostState } from "../config/schema.js";

describe("status command", () => {
  let tempDir: string;
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalWarn: typeof console.warn;
  let logs: string[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "steed-status-test-"));
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
    agents: [],
    data_sources: { cli_scanners: [], mcp_scanners: [] },
  });

  const getEmptyState = (): HostState => ({
    last_scan_at: null,
    last_report_at: null,
    last_scan: null,
    last_report_response: null,
    service_pid: null,
    last_error: null,
  });

  describe("runStatus", () => {
    it("shows not initialized when no config", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(null);
      vi.spyOn(stateModule.StateManager.prototype, "load").mockResolvedValue(
        getEmptyState()
      );

      const exitCode = await runStatus({});

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("Not initialized"))).toBe(true);
    });

    it("shows no state when state file is empty", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(getValidConfig());
      vi.spyOn(stateModule.StateManager.prototype, "load").mockResolvedValue(
        getEmptyState()
      );

      const exitCode = await runStatus({});

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("No state file found"))).toBe(true);
    });

    it("displays status with scan data", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(getValidConfig());
      vi.spyOn(stateModule.StateManager.prototype, "load").mockResolvedValue({
        ...getEmptyState(),
        last_scan_at: new Date().toISOString(),
        last_scan: {
          agents: [
            {
              match_key: "app:test",
              runtime_app: "app",
              runtime_version: "1.0.0",
              status: "running",
            },
            {
              match_key: "app2:test",
              runtime_app: "app2",
              runtime_version: null,
              status: "stopped",
            },
          ],
          data_sources: [
            {
              type: "personal_cli",
              name: "test",
              version: "1.0.0",
              auth_status: "authenticated",
            },
          ],
        },
      });

      const exitCode = await runStatus({});

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("Agents: 2 registered"))).toBe(true);
      expect(logs.some((l) => l.includes("1 running"))).toBe(true);
      expect(logs.some((l) => l.includes("1 stopped"))).toBe(true);
      expect(logs.some((l) => l.includes("Data Sources: 1 detected"))).toBe(true);
    });

    it("outputs JSON when --json flag is set", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(getValidConfig());
      vi.spyOn(stateModule.StateManager.prototype, "load").mockResolvedValue(
        getEmptyState()
      );

      const exitCode = await runStatus({ json: true });

      expect(exitCode).toBe(0);
      const jsonOutput = logs.find((l) => l.startsWith("{"));
      expect(jsonOutput).toBeDefined();
      if (!jsonOutput) throw new Error("No JSON output");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.initialized).toBe(true);
      expect(parsed.workerUrl).toBe("https://steed.example.workers.dev");
    });

    it("shows service status when PID is set", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(getValidConfig());
      vi.spyOn(stateModule.StateManager.prototype, "load").mockResolvedValue({
        ...getEmptyState(),
        last_scan_at: new Date().toISOString(),
        service_pid: 12345,
      });
      vi.spyOn(processModule, "isPidRunning").mockResolvedValue(true);

      const exitCode = await runStatus({});

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("Host Service: running"))).toBe(true);
      expect(logs.some((l) => l.includes("PID 12345"))).toBe(true);
    });

    it("shows stale PID when process is not running", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(getValidConfig());
      vi.spyOn(stateModule.StateManager.prototype, "load").mockResolvedValue({
        ...getEmptyState(),
        last_scan_at: new Date().toISOString(),
        service_pid: 12345,
      });
      vi.spyOn(processModule, "isPidRunning").mockResolvedValue(false);

      const exitCode = await runStatus({});

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("not running"))).toBe(true);
      expect(logs.some((l) => l.includes("stale PID"))).toBe(true);
    });

    it("shows last error if present", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(getValidConfig());
      vi.spyOn(stateModule.StateManager.prototype, "load").mockResolvedValue({
        ...getEmptyState(),
        last_scan_at: new Date().toISOString(),
        last_error: {
          timestamp: new Date().toISOString(),
          message: "Connection failed",
          type: "report",
        },
      });

      const exitCode = await runStatus({});

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("Last error (report)"))).toBe(true);
      expect(logs.some((l) => l.includes("Connection failed"))).toBe(true);
    });

    it("shows last report timestamp", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(getValidConfig());
      vi.spyOn(stateModule.StateManager.prototype, "load").mockResolvedValue({
        ...getEmptyState(),
        last_scan_at: new Date().toISOString(),
        last_report_at: new Date().toISOString(),
      });

      const exitCode = await runStatus({});

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("Last report:"))).toBe(true);
    });
  });
});
