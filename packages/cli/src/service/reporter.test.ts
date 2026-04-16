import { describe, it, expect, vi, afterEach } from "vitest";
import { Reporter } from "./reporter.js";
import type { LocalSnapshotResponse } from "../config/schema.js";

describe("Reporter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockAgents = [
    {
      match_key: "openclaw:/home/agent",
      runtime_app: "openclaw",
      runtime_version: "1.0.0",
      status: "running" as const,
    },
  ];

  const mockDataSources = [
    {
      type: "personal_cli" as const,
      name: "nmem",
      version: "2.0.0",
      auth_status: "authenticated" as const,
    },
  ];

  describe("report", () => {
    it("returns success with response on successful report", async () => {
      const mockResponse: LocalSnapshotResponse = {
        host_id: "host_abc123",
        agents_updated: 1,
        agents_missing: 0,
        data_sources_updated: 1,
        data_sources_created: 0,
        data_sources_missing: 0,
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });
      globalThis.fetch = mockFetch;

      const reporter = new Reporter("https://example.com", "sk_host_test");
      const result = await reporter.report(mockAgents, mockDataSources);

      expect(result.success).toBe(true);
      expect(result.response).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/api/v1/snapshot",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer sk_host_test",
          }),
        })
      );
    });

    it("returns auth error on 401 response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { code: "unauthorized", message: "Invalid API key" },
        }),
      });
      globalThis.fetch = mockFetch;

      const reporter = new Reporter("https://example.com", "sk_host_invalid");
      const result = await reporter.report(mockAgents, mockDataSources);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe("auth");
      expect(result.error?.message).toContain("Invalid API key");
    });

    it("returns api error on non-401 error response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: { code: "validation_error", message: "Invalid payload" },
        }),
      });
      globalThis.fetch = mockFetch;

      const reporter = new Reporter("https://example.com", "sk_host_test");
      const result = await reporter.report(mockAgents, mockDataSources);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe("api");
      expect(result.error?.message).toContain("validation_error");
    });

    it("returns network error on fetch failure", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
      globalThis.fetch = mockFetch;

      const reporter = new Reporter("https://example.com", "sk_host_test");
      const result = await reporter.report(mockAgents, mockDataSources);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe("network");
      expect(result.error?.message).toContain("Connection refused");
    });

    it("returns network error on timeout", async () => {
      // Use a very short timeout
      const reporter = new Reporter("https://example.com", "sk_host_test", 1);

      // Mock fetch to never resolve within timeout
      const mockFetch = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new DOMException("Aborted", "AbortError")), 10);
          })
      );
      globalThis.fetch = mockFetch;

      const result = await reporter.report(mockAgents, mockDataSources);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe("network");
    });

    it("handles unknown error type", async () => {
      const mockFetch = vi.fn().mockRejectedValue("string error");
      globalThis.fetch = mockFetch;

      const reporter = new Reporter("https://example.com", "sk_host_test");
      const result = await reporter.report(mockAgents, mockDataSources);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe("network");
      expect(result.error?.message).toBe("Unknown network error");
    });

    it("sends correct payload structure", async () => {
      let capturedBody: string | undefined;
      const mockFetch = vi.fn().mockImplementation((_url, options) => {
        capturedBody = options.body;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            host_id: "host_abc123",
            agents_updated: 0,
            agents_missing: 0,
            data_sources_updated: 0,
            data_sources_created: 0,
            data_sources_missing: 0,
          }),
        });
      });
      globalThis.fetch = mockFetch;

      const reporter = new Reporter("https://example.com", "sk_host_test");
      await reporter.report(mockAgents, mockDataSources);

      expect(capturedBody).toBeDefined();
      if (!capturedBody) throw new Error("No body captured");
      const parsed = JSON.parse(capturedBody);
      expect(parsed.agents).toEqual(mockAgents);
      expect(parsed.data_sources).toEqual(mockDataSources);
    });
  });
});
