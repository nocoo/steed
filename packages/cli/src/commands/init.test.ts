import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runInit } from "./init.js";
import { ConfigManager } from "../config/index.js";
import type { HostConfig } from "../config/schema.js";

// Store original fetch
const originalFetch = globalThis.fetch;

describe("init command", () => {
  let tempDir: string;
  let configPath: string;
  let configManager: ConfigManager;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "steed-init-test-"));
    configPath = join(tempDir, "config.json");
    configManager = new ConfigManager(configPath);
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    // Mock console
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejects invalid URL format", async () => {
    const exitCode = await runInit(configManager, "not-a-url", "sk_host_test123");
    expect(exitCode).toBe(1);
  });

  it("rejects invalid API key format", async () => {
    const exitCode = await runInit(configManager, "https://api.example.com", "invalid_key");
    expect(exitCode).toBe(1);
  });

  it("handles network error gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    const exitCode = await runInit(configManager, "https://api.example.com", "sk_host_test123");

    expect(exitCode).toBe(1);
  });

  it("handles 401 from auth/verify with clear error", async () => {
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

    const exitCode = await runInit(configManager, "https://api.example.com", "sk_host_test123");

    expect(exitCode).toBe(1);
  });

  it("creates config file on success", async () => {
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

    const exitCode = await runInit(configManager, "https://api.example.com", "sk_host_test123");

    expect(exitCode).toBe(0);

    // Verify config file created
    const content = await readFile(configPath, "utf-8");
    const config = JSON.parse(content) as HostConfig;
    expect(config.worker_url).toBe("https://api.example.com");
    expect(config.api_key).toBe("sk_host_test123");
    expect(config.agents).toEqual([]);
    expect(config.data_sources.cli_scanners.length).toBeGreaterThan(0);
  });

  it("adds default scanners to config", async () => {
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

    await runInit(configManager, "https://api.example.com", "sk_host_test123");

    const content = await readFile(configPath, "utf-8");
    const config = JSON.parse(content) as HostConfig;

    // Check that default scanners were added
    const scannerNames = config.data_sources.cli_scanners.map((s) => s.name);
    expect(scannerNames).toContain("wrangler");
    expect(scannerNames).toContain("railway");
    expect(scannerNames).toContain("gh");
    expect(scannerNames).toContain("vercel");
  });

  it("handles network error during verification", async () => {
    // Health check succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: "ok" }),
    } as Response);

    // Auth verify throws network error
    mockFetch.mockRejectedValueOnce(new Error("Connection reset"));

    const exitCode = await runInit(configManager, "https://api.example.com", "sk_host_test123");

    expect(exitCode).toBe(1);
  });

  it("handles health check non-network error", async () => {
    // Health check throws non-network error
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { code: "internal", message: "Server error" } }),
    } as Response);

    const exitCode = await runInit(configManager, "https://api.example.com", "sk_host_test123");

    expect(exitCode).toBe(1);
  });

  it("handles unknown error during verification", async () => {
    // Health check succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: "ok" }),
    } as Response);

    // Auth verify throws unexpected error
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { code: "internal", message: "Server error" } }),
    } as Response);

    const exitCode = await runInit(configManager, "https://api.example.com", "sk_host_test123");

    expect(exitCode).toBe(1);
  });

  it("rejects when config already exists", async () => {
    // Create existing config
    const existingConfig: HostConfig = {
      worker_url: "https://existing.com",
      api_key: "sk_host_existing",
      agents: [],
      data_sources: { cli_scanners: [], mcp_scanners: [] },
    };
    await configManager.save(existingConfig);

    const exitCode = await runInit(configManager, "https://api.example.com", "sk_host_test123");

    expect(exitCode).toBe(1);
  });

  it("handles save config failure", async () => {
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
    const exitCode = await runInit(badManager, "https://api.example.com", "sk_host_test123");

    expect(exitCode).toBe(1);
  });

  it("handles save config failure with non-Error", async () => {
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

    // Mock configManager.save to throw non-Error
    const mockManager = {
      exists: vi.fn().mockResolvedValue(false),
      getPath: vi.fn().mockReturnValue("/test/path"),
      save: vi.fn().mockRejectedValue("string error"),
    } as unknown as ConfigManager;

    const exitCode = await runInit(mockManager, "https://api.example.com", "sk_host_test123");

    expect(exitCode).toBe(1);
  });
});
