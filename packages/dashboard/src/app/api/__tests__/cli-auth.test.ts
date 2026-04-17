import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { hostname } from "node:os";

// Mock node:os hostname
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    hostname: vi.fn(() => "test-machine"),
  };
});

const mockHostname = hostname as Mock;

// Mock auth module
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

// Mock worker-api module
vi.mock("@/lib/worker-api", () => ({
  workerApi: {
    hosts: {
      register: vi.fn(),
    },
  },
  getWorkerApiUrl: vi.fn(() => "https://steed.worker.hexly.ai"),
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    // Mock redirect by throwing a special error that we can catch
    const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
    error.digest = `NEXT_REDIRECT;replace;${url}`;
    throw error;
  }),
}));

import { GET } from "../auth/cli/route";
import { auth } from "@/auth";
import { workerApi } from "@/lib/worker-api";

const mockAuth = auth as Mock;
const mockHostsRegister = workerApi.hosts.register as Mock;

function createRequest(params: Record<string, string>): Request {
  const url = new URL("http://localhost:3000/api/auth/cli");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString());
}

/**
 * Helper to extract redirect URL from Next.js redirect mock
 */
function getRedirectUrl(error: unknown): string | null {
  if (
    error instanceof Error &&
    error.message === "NEXT_REDIRECT" &&
    "digest" in error
  ) {
    const parts = (error as { digest: string }).digest.split(";");
    return parts[2] ?? null;
  }
  return null;
}

describe("GET /api/auth/cli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHostname.mockReturnValue("test-machine");
  });

  it("should return 400 when callback is missing", async () => {
    const request = createRequest({ state: "test-nonce" });

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Missing required parameters");
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("should return 400 when state is missing", async () => {
    const request = createRequest({ callback: "http://localhost:3456/callback" });

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Missing required parameters");
  });

  it("should return 400 when callback is not localhost", async () => {
    const request = createRequest({
      callback: "http://evil.com/callback",
      state: "test-nonce",
    });

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("must be localhost");
  });

  it("should accept 127.0.0.1 as valid callback", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockHostsRegister.mockResolvedValue({
      id: "host_1",
      name: "test-machine",
      api_key: "sk_host_test123",
    });

    const request = createRequest({
      callback: "http://127.0.0.1:3456/callback",
      state: "test-nonce",
    });

    try {
      await GET(request);
    } catch (e) {
      const url = getRedirectUrl(e);
      expect(url).toContain("127.0.0.1");
      expect(url).toContain("api_key=sk_host_test123");
      expect(url).toContain("worker_url=https%3A%2F%2Fsteed.worker.hexly.ai");
    }
  });

  it("should redirect to login when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest({
      callback: "http://localhost:3456/callback",
      state: "test-nonce",
    });

    try {
      await GET(request);
      expect.fail("Should have thrown redirect");
    } catch (e) {
      const url = getRedirectUrl(e);
      expect(url).toContain("/login");
    }
  });

  it("should redirect to login when user has no email", async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const request = createRequest({
      callback: "http://localhost:3456/callback",
      state: "test-nonce",
    });

    try {
      await GET(request);
      expect.fail("Should have thrown redirect");
    } catch (e) {
      const url = getRedirectUrl(e);
      expect(url).toContain("/login");
    }
  });

  it("should redirect to callback with api_key and worker_url on success", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockHostsRegister.mockResolvedValue({
      id: "host_1",
      name: "test-machine",
      api_key: "sk_host_test123",
    });

    const request = createRequest({
      callback: "http://localhost:3456/callback",
      state: "test-nonce",
    });

    try {
      await GET(request);
      expect.fail("Should have thrown redirect");
    } catch (e) {
      const url = getRedirectUrl(e);
      expect(url).toContain("api_key=sk_host_test123");
      expect(url).toContain("worker_url=https%3A%2F%2Fsteed.worker.hexly.ai");
      expect(url).toContain("state=test-nonce");
      expect(url).toContain("email=test%40example.com");
    }

    expect(mockHostsRegister).toHaveBeenCalledTimes(1);
  });

  it("should redirect to callback with error on worker API failure", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockHostsRegister.mockRejectedValue(new Error("Worker unavailable"));

    const request = createRequest({
      callback: "http://localhost:3456/callback",
      state: "test-nonce",
    });

    try {
      await GET(request);
      expect.fail("Should have thrown redirect");
    } catch (e) {
      const url = getRedirectUrl(e);
      expect(url).toContain("error=Worker");
      expect(url).toContain("state=test-nonce");
    }
  });

  it("should handle non-Error exceptions from worker API", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockHostsRegister.mockRejectedValue("string error");

    const request = createRequest({
      callback: "http://localhost:3456/callback",
      state: "test-nonce",
    });

    try {
      await GET(request);
      expect.fail("Should have thrown redirect");
    } catch (e) {
      const url = getRedirectUrl(e);
      expect(url).toContain("error=Failed");
      expect(url).toContain("state=test-nonce");
    }
  });
});
