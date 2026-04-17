import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runLogin } from "./login.js";
import { ConfigManager } from "../config/index.js";
import type { HostConfig } from "../config/schema.js";

// Store original fetch
const originalFetch = globalThis.fetch;

// Mock cli-base module
vi.mock("@nocoo/cli-base", () => ({
  performLogin: vi.fn(),
  openBrowser: vi.fn(),
}));

import { performLogin } from "@nocoo/cli-base";
const mockPerformLogin = performLogin as ReturnType<typeof vi.fn>;

describe("login command", () => {
  let tempDir: string;
  let configPath: string;
  let configManager: ConfigManager;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "steed-login-test-"));
    configPath = join(tempDir, "config.json");
    configManager = new ConfigManager(configPath);
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    // Mock console
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Reset mocks
    mockPerformLogin.mockReset();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejects invalid URL format", async () => {
    const exitCode = await runLogin(configManager, "not-a-url");
    expect(exitCode).toBe(1);
    expect(mockPerformLogin).not.toHaveBeenCalled();
  });

  it("returns error when login fails", async () => {
    mockPerformLogin.mockResolvedValue({
      success: false,
      error: "User cancelled",
    });

    const exitCode = await runLogin(configManager, "https://steed.hexly.ai");

    expect(exitCode).toBe(1);
    expect(mockPerformLogin).toHaveBeenCalledTimes(1);
  });

  it("returns error when no API key received", async () => {
    mockPerformLogin.mockResolvedValue({
      success: true,
      // No onSaveToken called, so apiKey is undefined
    });

    const exitCode = await runLogin(configManager, "https://steed.hexly.ai");

    expect(exitCode).toBe(1);
  });

  it("handles worker health check failure", async () => {
    mockPerformLogin.mockImplementation(async (deps) => {
      deps.onSaveToken("sk_host_test123");
      return { success: true, email: "test@example.com" };
    });

    // Health check fails
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    const exitCode = await runLogin(configManager, "https://steed.hexly.ai");

    expect(exitCode).toBe(1);
  });

  it("handles API key verification failure", async () => {
    mockPerformLogin.mockImplementation(async (deps) => {
      deps.onSaveToken("sk_host_test123");
      return { success: true, email: "test@example.com" };
    });

    // Health check succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: "ok" }),
    } as Response);

    // Auth verify returns 401
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({
          error: { code: "unauthorized", message: "Invalid token" },
        }),
    } as Response);

    const exitCode = await runLogin(configManager, "https://steed.hexly.ai");

    expect(exitCode).toBe(1);
  });

  it("creates config file on success", async () => {
    mockPerformLogin.mockImplementation(async (deps) => {
      deps.onSaveToken("sk_host_test123");
      return { success: true, email: "test@example.com" };
    });

    // Health check succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: "ok" }),
    } as Response);

    // Auth verify succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          valid: true,
          host_id: "host_abc123",
          host_name: "Test Host",
        }),
    } as Response);

    const exitCode = await runLogin(configManager, "https://steed.hexly.ai");

    expect(exitCode).toBe(0);

    // Verify config file created
    const content = await readFile(configPath, "utf-8");
    const config = JSON.parse(content) as HostConfig;
    expect(config.worker_url).toBe("https://steed-worker.hexly.ai");
    expect(config.api_key).toBe("sk_host_test123");
    expect(config.agents).toEqual([]);
    expect(config.data_sources.cli_scanners.length).toBeGreaterThan(0);
  });

  it("preserves existing agents when updating config", async () => {
    // Create existing config with agents
    const existingConfig: HostConfig = {
      worker_url: "https://old-worker.example.com",
      api_key: "sk_host_old",
      agents: [
        {
          match_key: "test:/path",
          detection: { method: "process", pattern: "test-agent" },
        },
      ],
      data_sources: { cli_scanners: [], mcp_scanners: [] },
    };
    await configManager.save(existingConfig);

    mockPerformLogin.mockImplementation(async (deps) => {
      deps.onSaveToken("sk_host_new123");
      return { success: true, email: "test@example.com" };
    });

    // Health check succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: "ok" }),
    } as Response);

    // Auth verify succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          valid: true,
          host_id: "host_abc123",
          host_name: "Test Host",
        }),
    } as Response);

    const exitCode = await runLogin(configManager, "https://steed.hexly.ai");

    expect(exitCode).toBe(0);

    // Verify existing agents preserved
    const content = await readFile(configPath, "utf-8");
    const config = JSON.parse(content) as HostConfig;
    expect(config.api_key).toBe("sk_host_new123");
    expect(config.agents).toHaveLength(1);
    expect(config.agents[0].match_key).toBe("test:/path");
  });

  it("derives correct worker URL for dev environment", async () => {
    mockPerformLogin.mockImplementation(async (deps) => {
      deps.onSaveToken("sk_host_test123");
      return { success: true };
    });

    // Health check succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: "ok" }),
    } as Response);

    // Auth verify succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          valid: true,
          host_id: "host_abc123",
          host_name: "Test Host",
        }),
    } as Response);

    await runLogin(configManager, "https://steed.dev.hexly.ai");

    const content = await readFile(configPath, "utf-8");
    const config = JSON.parse(content) as HostConfig;
    expect(config.worker_url).toBe("https://steed-worker.dev.hexly.ai");
  });

  it("derives correct worker URL for localhost", async () => {
    mockPerformLogin.mockImplementation(async (deps) => {
      deps.onSaveToken("sk_host_test123");
      return { success: true };
    });

    // Health check succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: "ok" }),
    } as Response);

    // Auth verify succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          valid: true,
          host_id: "host_abc123",
          host_name: "Test Host",
        }),
    } as Response);

    await runLogin(configManager, "http://localhost:3000");

    const content = await readFile(configPath, "utf-8");
    const config = JSON.parse(content) as HostConfig;
    expect(config.worker_url).toBe("http://localhost:8787");
  });

  it("handles save config failure", async () => {
    mockPerformLogin.mockImplementation(async (deps) => {
      deps.onSaveToken("sk_host_test123");
      return { success: true };
    });

    // Health check succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: "ok" }),
    } as Response);

    // Auth verify succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          valid: true,
          host_id: "host_abc123",
          host_name: "Test Host",
        }),
    } as Response);

    // Use an invalid path that will cause save to fail
    const badManager = new ConfigManager("/nonexistent/path/that/does/not/exist/config.json");
    const exitCode = await runLogin(badManager, "https://steed.hexly.ai");

    expect(exitCode).toBe(1);
  });

  it("passes correct options to performLogin", async () => {
    mockPerformLogin.mockResolvedValue({
      success: false,
      error: "Timeout",
    });

    await runLogin(configManager, "https://steed.hexly.ai");

    expect(mockPerformLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        apiUrl: "https://steed.hexly.ai",
        loginPath: "/api/auth/cli",
        tokenParam: "api_key",
        timeoutMs: 120_000,
        accentColor: "#16a34a",
      })
    );
  });
});
