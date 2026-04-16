import { describe, it, expect } from "vitest";
import {
  hostConfigSchema,
  hostStateSchema,
  agentDetectionSchema,
  authCheckSchema,
  type HostConfig,
  type HostState,
} from "./schema.js";

describe("Config Schema", () => {
  describe("hostConfigSchema", () => {
    it("validates a complete valid config", () => {
      const validConfig: HostConfig = {
        worker_url: "https://steed.example.workers.dev",
        api_key: "sk_host_abc123",
        agents: [
          {
            match_key: "openclaw:/home/agent",
            detection: {
              method: "process",
              pattern: "openclaw.*agent",
              version_command: "openclaw --version",
            },
          },
        ],
        data_sources: {
          cli_scanners: [
            {
              name: "wrangler",
              type: "third_party_cli",
              binary: "wrangler",
              config_path: "~/.wrangler",
              auth_check: {
                method: "config_exists",
              },
            },
          ],
          mcp_scanners: [],
        },
      };

      const result = hostConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validConfig);
      }
    });

    it("rejects missing required fields", () => {
      const invalidConfig = {
        worker_url: "https://steed.example.workers.dev",
        // missing api_key, agents, data_sources
      };

      const result = hostConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it("rejects invalid api_key format", () => {
      const invalidConfig = {
        worker_url: "https://steed.example.workers.dev",
        api_key: "invalid_key", // should start with sk_host_
        agents: [],
        data_sources: { cli_scanners: [], mcp_scanners: [] },
      };

      const result = hostConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("sk_host_");
      }
    });

    it("rejects invalid worker_url format", () => {
      const invalidConfig = {
        worker_url: "not-a-url",
        api_key: "sk_host_abc123",
        agents: [],
        data_sources: { cli_scanners: [], mcp_scanners: [] },
      };

      const result = hostConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });
  });

  describe("agentDetectionSchema", () => {
    it("validates process detection method", () => {
      const result = agentDetectionSchema.safeParse({
        method: "process",
        pattern: "openclaw.*agent",
      });
      expect(result.success).toBe(true);
    });

    it("validates config_file detection method", () => {
      const result = agentDetectionSchema.safeParse({
        method: "config_file",
        pattern: "/home/agent/.config/agent.json",
      });
      expect(result.success).toBe(true);
    });

    it("validates custom detection method", () => {
      const result = agentDetectionSchema.safeParse({
        method: "custom",
        pattern: "/usr/local/bin/check-agent.sh",
        version_command: "agent --version",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid detection method", () => {
      const result = agentDetectionSchema.safeParse({
        method: "invalid_method",
        pattern: "some-pattern",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty pattern", () => {
      const result = agentDetectionSchema.safeParse({
        method: "process",
        pattern: "",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("authCheckSchema", () => {
    it("validates config_exists method", () => {
      const result = authCheckSchema.safeParse({
        method: "config_exists",
      });
      expect(result.success).toBe(true);
    });

    it("validates config_field method", () => {
      const result = authCheckSchema.safeParse({
        method: "config_field",
        pattern: "auth.token",
      });
      expect(result.success).toBe(true);
    });

    it("validates command method", () => {
      const result = authCheckSchema.safeParse({
        method: "command",
        pattern: "tool auth status",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid auth_check method", () => {
      const result = authCheckSchema.safeParse({
        method: "invalid_method",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("hostStateSchema", () => {
    it("validates a complete valid state", () => {
      const validState: HostState = {
        last_scan_at: "2026-04-16T10:00:00Z",
        last_report_at: "2026-04-16T10:00:01Z",
        last_scan: {
          agents: [
            {
              match_key: "openclaw:/home/agent",
              runtime_app: "openclaw",
              runtime_version: "1.0.0",
              status: "running",
            },
          ],
          data_sources: [
            {
              type: "third_party_cli",
              name: "wrangler",
              version: "3.50.0",
              auth_status: "authenticated",
            },
          ],
        },
        last_report_response: {
          host_id: "host_abc123",
          agents_updated: 1,
          agents_missing: 0,
          data_sources_updated: 1,
          data_sources_created: 0,
          data_sources_missing: 0,
        },
        service_pid: 12345,
        last_error: null,
      };

      const result = hostStateSchema.safeParse(validState);
      expect(result.success).toBe(true);
    });

    it("validates state with nulls", () => {
      const emptyState: HostState = {
        last_scan_at: null,
        last_report_at: null,
        last_scan: null,
        last_report_response: null,
        service_pid: null,
        last_error: null,
      };

      const result = hostStateSchema.safeParse(emptyState);
      expect(result.success).toBe(true);
    });

    it("validates state with error", () => {
      const stateWithError: HostState = {
        last_scan_at: null,
        last_report_at: null,
        last_scan: null,
        last_report_response: null,
        service_pid: null,
        last_error: {
          timestamp: "2026-04-16T10:00:00Z",
          message: "Connection failed",
          type: "report",
        },
      };

      const result = hostStateSchema.safeParse(stateWithError);
      expect(result.success).toBe(true);
    });
  });
});
