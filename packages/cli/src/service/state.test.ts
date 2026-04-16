import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { StateManager } from "./state.js";
import type { HostState, LocalSnapshotResponse } from "../config/schema.js";

describe("StateManager", () => {
  let tempDir: string;
  let statePath: string;
  let manager: StateManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "steed-state-test-"));
    statePath = join(tempDir, "state.json");
    manager = new StateManager(statePath);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const emptyState: HostState = {
    last_scan_at: null,
    last_report_at: null,
    last_scan: null,
    last_report_response: null,
    service_pid: null,
    last_error: null,
  };

  describe("load", () => {
    it("returns empty state when file does not exist", async () => {
      const state = await manager.load();
      expect(state).toEqual(emptyState);
    });

    it("loads valid state file", async () => {
      const savedState: HostState = {
        ...emptyState,
        last_scan_at: "2024-01-01T00:00:00.000Z",
        service_pid: 12345,
      };
      await writeFile(statePath, JSON.stringify(savedState));

      const state = await manager.load();

      expect(state.last_scan_at).toBe("2024-01-01T00:00:00.000Z");
      expect(state.service_pid).toBe(12345);
    });

    it("returns empty state for invalid JSON", async () => {
      await writeFile(statePath, "not valid json {{{");

      const state = await manager.load();

      expect(state).toEqual(emptyState);
    });

    it("returns empty state for invalid schema", async () => {
      await writeFile(statePath, JSON.stringify({ invalid: "data" }));

      const state = await manager.load();

      expect(state).toEqual(emptyState);
    });
  });

  describe("save", () => {
    it("writes state to file", async () => {
      const state: HostState = {
        ...emptyState,
        service_pid: 54321,
      };

      await manager.save(state);

      const content = await readFile(statePath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.service_pid).toBe(54321);
    });

    it("creates directory if not exists", async () => {
      const nestedPath = join(tempDir, "nested", "dir", "state.json");
      const nestedManager = new StateManager(nestedPath);

      await nestedManager.save(emptyState);

      const content = await readFile(nestedPath, "utf-8");
      expect(JSON.parse(content)).toEqual(emptyState);
    });
  });

  describe("updateScanResults", () => {
    it("updates scan results and timestamp", async () => {
      const agents = [
        {
          match_key: "openclaw:/home/agent",
          runtime_app: "openclaw",
          runtime_version: "1.0.0",
          status: "running" as const,
        },
      ];
      const dataSources = [
        {
          type: "personal_cli" as const,
          name: "nmem",
          version: "2.0.0",
          auth_status: "authenticated" as const,
        },
      ];

      await manager.updateScanResults(agents, dataSources);

      const state = await manager.load();
      expect(state.last_scan_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(state.last_scan?.agents).toEqual(agents);
      expect(state.last_scan?.data_sources).toEqual(dataSources);
    });
  });

  describe("updateReportResults", () => {
    it("updates report results and timestamp", async () => {
      const response: LocalSnapshotResponse = {
        host_id: "host_abc123",
        agents_updated: 2,
        agents_missing: 0,
        data_sources_updated: 3,
        data_sources_created: 1,
        data_sources_missing: 0,
      };

      await manager.updateReportResults(response);

      const state = await manager.load();
      expect(state.last_report_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(state.last_report_response).toEqual(response);
    });
  });

  describe("updateServicePid", () => {
    it("updates service PID", async () => {
      await manager.updateServicePid(12345);

      const state = await manager.load();
      expect(state.service_pid).toBe(12345);
    });

    it("clears service PID when null", async () => {
      await manager.updateServicePid(12345);
      await manager.updateServicePid(null);

      const state = await manager.load();
      expect(state.service_pid).toBeNull();
    });
  });

  describe("error management", () => {
    it("records error", async () => {
      await manager.recordError("Test error message", "scan");

      const state = await manager.load();
      expect(state.last_error).not.toBeNull();
      expect(state.last_error?.message).toBe("Test error message");
      expect(state.last_error?.type).toBe("scan");
      expect(state.last_error?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("clears error", async () => {
      await manager.recordError("Test error", "config");
      await manager.clearError();

      const state = await manager.load();
      expect(state.last_error).toBeNull();
    });
  });

  describe("getPath and exists", () => {
    it("returns configured path", () => {
      expect(manager.getPath()).toBe(statePath);
    });

    it("exists returns false for missing file", async () => {
      expect(await manager.exists()).toBe(false);
    });

    it("exists returns true after save", async () => {
      await manager.save(emptyState);
      expect(await manager.exists()).toBe(true);
    });
  });
});
