import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Scanner } from "./index.js";
import { AgentScanner } from "./agent.js";
import { DataSourceScanner } from "./data-source.js";
import * as processModule from "../../lib/process.js";
import type { HostConfig } from "../../config/schema.js";

// Stub pgrep-backed detection so these tests don't depend on real
// process-table visibility (unreliable under CI / sandboxed envs).
const RUNNING_MARKER = "__steed_scanner_test_running__";

describe("Scanner", () => {
  let scanner: Scanner;
  let tempDir: string;

  beforeEach(async () => {
    scanner = new Scanner();
    tempDir = await mkdtemp(join(tmpdir(), "steed-scanner-test-"));
    vi.spyOn(processModule, "isProcessRunning").mockImplementation(
      async (pattern: string) => pattern === RUNNING_MARKER
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("scan", () => {
    it("returns full scan result with agents and data sources", async () => {
      const configPath = join(tempDir, "agent-config.json");
      await writeFile(configPath, "{}");

      const config: HostConfig = {
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
          {
            match_key: "testapp:config",
            detection: {
              method: "config_file",
              pattern: configPath,
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
      };

      const result = await scanner.scan(config);

      // Should have scanned at timestamp
      expect(result.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // Should have agent results
      expect(result.agents.length).toBeGreaterThanOrEqual(1);
      const found = result.agents.find((a) => a.match_key === "markedproc:test");
      expect(found).toBeDefined();
      expect(found?.status).toBe("running");

      // Should have data source results
      expect(result.dataSources.length).toBe(1);
      expect(result.dataSources[0]?.name).toBe("echo");
    });

    it("handles empty config", async () => {
      const config: HostConfig = {
        worker_url: "https://example.com",
        api_key: "sk_host_test",
        agents: [],
        data_sources: {
          cli_scanners: [],
          mcp_scanners: [],
        },
      };

      const result = await scanner.scan(config);

      expect(result.agents).toHaveLength(0);
      expect(result.dataSources).toHaveLength(0);
      expect(result.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("filters out agents that return null", async () => {
      const config: HostConfig = {
        worker_url: "https://example.com",
        api_key: "sk_host_test",
        agents: [
          {
            match_key: "bun:test",
            detection: {
              method: "process",
              pattern: RUNNING_MARKER,
            },
          },
          {
            // This should return null (invalid match_key format)
            match_key: "invalid-no-colon",
            detection: {
              method: "process",
              pattern: RUNNING_MARKER,
            },
          },
        ],
        data_sources: {
          cli_scanners: [],
          mcp_scanners: [],
        },
      };

      const result = await scanner.scan(config);

      // Should only have the valid agent
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0]?.match_key).toBe("bun:test");
    });

    it("filters out data sources not in PATH", async () => {
      const config: HostConfig = {
        worker_url: "https://example.com",
        api_key: "sk_host_test",
        agents: [],
        data_sources: {
          cli_scanners: [
            {
              name: "echo",
              type: "personal_cli",
              binary: "echo",
            },
            {
              name: "nonexistent",
              type: "third_party_cli",
              binary: "nonexistent_tool_xyz_12345",
            },
          ],
          mcp_scanners: [],
        },
      };

      const result = await scanner.scan(config);

      // Should only have echo
      expect(result.dataSources).toHaveLength(1);
      expect(result.dataSources[0]?.name).toBe("echo");
    });

    it("continues when agent scanner fails but data source scanner succeeds", async () => {
      vi.spyOn(AgentScanner.prototype, "scan").mockRejectedValue(
        new Error("agent scan boom")
      );

      const config: HostConfig = {
        worker_url: "https://example.com",
        api_key: "sk_host_test",
        agents: [],
        data_sources: {
          cli_scanners: [{ name: "echo", type: "personal_cli", binary: "echo" }],
          mcp_scanners: [],
        },
      };

      const result = await scanner.scan(config);

      expect(result.agents).toHaveLength(0);
      expect(result.dataSources).toHaveLength(1);
    });

    it("continues when data source scanner fails but agent scanner succeeds", async () => {
      vi.spyOn(DataSourceScanner.prototype, "scan").mockRejectedValue(
        new Error("data source scan boom")
      );

      const config: HostConfig = {
        worker_url: "https://example.com",
        api_key: "sk_host_test",
        agents: [
          { match_key: "bun:test", detection: { method: "process", pattern: RUNNING_MARKER } },
        ],
        data_sources: { cli_scanners: [], mcp_scanners: [] },
      };

      const result = await scanner.scan(config);

      expect(result.agents.length).toBeGreaterThanOrEqual(1);
      expect(result.dataSources).toHaveLength(0);
    });

    it("throws when both scanners fail", async () => {
      vi.spyOn(AgentScanner.prototype, "scan").mockRejectedValue(
        new Error("agent boom")
      );
      vi.spyOn(DataSourceScanner.prototype, "scan").mockRejectedValue(
        new Error("ds boom")
      );

      const config: HostConfig = {
        worker_url: "https://example.com",
        api_key: "sk_host_test",
        agents: [],
        data_sources: { cli_scanners: [], mcp_scanners: [] },
      };

      await expect(scanner.scan(config)).rejects.toThrow("agent boom");
    });

    it("wraps non-Error rejection when both fail", async () => {
      vi.spyOn(AgentScanner.prototype, "scan").mockRejectedValue("string error");
      vi.spyOn(DataSourceScanner.prototype, "scan").mockRejectedValue("ds err");

      const config: HostConfig = {
        worker_url: "https://example.com",
        api_key: "sk_host_test",
        agents: [],
        data_sources: { cli_scanners: [], mcp_scanners: [] },
      };

      await expect(scanner.scan(config)).rejects.toThrow("string error");
    });
  });
});
