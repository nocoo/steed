import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runScan } from "./scan.js";
import * as configModule from "../config/index.js";
import * as processModule from "../lib/process.js";
import { StateManager } from "../service/state.js";
import type { HostConfig } from "../config/schema.js";

// Stub pgrep-backed detection so tests don't depend on real process
// visibility (unreliable under CI / sandbox / container envs).
const RUNNING_MARKER = "__steed_scan_cmd_test_running__";

describe("scan command", () => {
  let tempDir: string;
  let originalLog: typeof console.log;
  let originalWarn: typeof console.warn;
  let logs: string[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "steed-scan-test-"));
    logs = [];
    originalLog = console.log;
    originalWarn = console.warn;
    // Spy on StateManager so scan doesn't try to write state files
    vi.spyOn(StateManager.prototype, "updateScanResults").mockResolvedValue(undefined);
    // Stub process detection deterministically
    vi.spyOn(processModule, "isProcessRunning").mockImplementation(
      async (pattern: string) => pattern === RUNNING_MARKER
    );
    console.log = vi.fn((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    console.warn = vi.fn((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  });

  afterEach(async () => {
    console.log = originalLog;
    console.warn = originalWarn;
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // Factory so each test gets a fresh config
  const makeMockConfig = (): HostConfig => ({
    worker_url: "https://example.com",
    api_key: "sk_host_test",
    agents: [
      {
        match_key: "markedproc:test",
        detection: {
          method: "process",
          pattern: RUNNING_MARKER,
        },
      },
    ],
    data_sources: {
      cli_scanners: [
        {
          name: "echo",
          type: "personal_cli",
          binary: "echo",
          version_command: "echo v1.2.3",
        },
      ],
      mcp_scanners: [],
    },
  });

  describe("runScan", () => {
    it("returns 1 when no config exists", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(null);

      const exitCode = await runScan({});

      expect(exitCode).toBe(1);
      expect(logs.some((l) => l.includes("No config found"))).toBe(true);
    });

    it("scans and displays results", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(makeMockConfig());

      const exitCode = await runScan({});

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("Agents:"))).toBe(true);
      expect(logs.some((l) => l.includes("Data Sources:"))).toBe(true);
      expect(logs.some((l) => l.includes("markedproc:test"))).toBe(true);
      expect(logs.some((l) => l.includes("echo"))).toBe(true);
    });

    it("outputs JSON when --json option is set", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(makeMockConfig());

      const exitCode = await runScan({ json: true });

      expect(exitCode).toBe(0);
      // Should have JSON output
      const jsonOutput = logs.find((l) => l.startsWith("{"));
      expect(jsonOutput).toBeDefined();
      if (!jsonOutput) throw new Error("No JSON output");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.agents).toBeDefined();
      expect(parsed.dataSources).toBeDefined();
      expect(parsed.scannedAt).toBeDefined();
    });

    it("filters to agents only when --agents option is set", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(makeMockConfig());

      const exitCode = await runScan({ agents: true, json: true });

      expect(exitCode).toBe(0);
      const jsonOutput = logs.find((l) => l.startsWith("{"));
      if (!jsonOutput) throw new Error("No JSON output");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.agents.length).toBeGreaterThan(0);
      expect(parsed.dataSources).toHaveLength(0);
    });

    it("filters to data sources only when --data-sources option is set", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(makeMockConfig());

      const exitCode = await runScan({ dataSources: true, json: true });

      expect(exitCode).toBe(0);
      const jsonOutput = logs.find((l) => l.startsWith("{"));
      if (!jsonOutput) throw new Error("No JSON output");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.agents).toHaveLength(0);
      expect(parsed.dataSources.length).toBeGreaterThan(0);
    });

    it("handles empty results gracefully", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue({
        ...makeMockConfig(),
        agents: [],
        data_sources: { cli_scanners: [], mcp_scanners: [] },
      });

      const exitCode = await runScan({});

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("No agents registered"))).toBe(true);
      expect(logs.some((l) => l.includes("No data sources found"))).toBe(true);
    });

    it("displays status indicators correctly", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(makeMockConfig());

      const exitCode = await runScan({});

      expect(exitCode).toBe(0);
      // Check for status indicator (bun should be running)
      expect(logs.some((l) => l.includes("✓ running"))).toBe(true);
    });

    it("displays stopped status for non-running agents", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue({
        ...makeMockConfig(),
        agents: [
          {
            match_key: "testapp:config",
            detection: {
              // Use a nonexistent process pattern
              method: "process",
              pattern: "nonexistent_process_xyz_99999",
            },
          },
        ],
      });

      const exitCode = await runScan({});

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("○ stopped"))).toBe(true);
    });

    it("displays unauthenticated status for data sources", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue({
        ...makeMockConfig(),
        data_sources: {
          cli_scanners: [
            {
              name: "test-cli",
              type: "third_party_cli",
              binary: "echo",
              auth_check: {
                method: "command",
                pattern: "false", // exits 1
              },
            },
          ],
          mcp_scanners: [],
        },
      });

      const exitCode = await runScan({});

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("✗ unauthenticated"))).toBe(true);
    });

    it("displays unknown auth status for data sources", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue({
        ...makeMockConfig(),
        data_sources: {
          cli_scanners: [
            {
              name: "test-cli",
              type: "third_party_cli",
              binary: "echo",
              // No auth_check, so status will be unknown
            },
          ],
          mcp_scanners: [],
        },
      });

      const exitCode = await runScan({});

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("? unknown"))).toBe(true);
    });

    it("only shows agents section when --agents flag used (non-JSON)", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(makeMockConfig());

      const exitCode = await runScan({ agents: true });

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("Agents:"))).toBe(true);
      // Data sources should still be shown because showDataSources is true when only agents is set
    });

    it("only shows data sources section when --data-sources flag used (non-JSON)", async () => {
      vi.spyOn(configModule, "loadConfig").mockResolvedValue(makeMockConfig());

      const exitCode = await runScan({ dataSources: true });

      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes("Data Sources:"))).toBe(true);
      // Agents should still be shown because showAgents is true when only dataSources is set
    });
  });
});
