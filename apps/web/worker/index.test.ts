import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  assetsFetch: vi.fn(),
  routerFetch: vi.fn(),
  honoFetch: vi.fn(),
  verifyAccessJwt: vi.fn(),
}));

vi.mock("@steed/api/server", () => ({
  createApiRouter: () => ({
    fetch: mocks.routerFetch,
  }),
}));

vi.mock("@steed/worker", () => ({
  default: { fetch: mocks.honoFetch },
}));

vi.mock("./access-jwt", () => ({
  verifyAccessJwt: (...args: unknown[]) => mocks.verifyAccessJwt(...args),
}));

import worker from "./index";

describe("worker", () => {
  const baseEnv = {
    ASSETS: { fetch: mocks.assetsFetch },
    DB: {} as D1Database,
    CF_ACCESS_TEAM: "test-team",
    CF_ACCESS_AUD: "test-aud",
    DASHBOARD_SERVICE_TOKEN: "token",
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns ok for /healthz without auth", async () => {
    const req = new Request("https://example.com/healthz");
    const res = await worker.fetch(req, baseEnv, {} as ExecutionContext);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(mocks.verifyAccessJwt).not.toHaveBeenCalled();
  });

  it("routes /api/v1/* directly to Hono app without CF Access check", async () => {
    mocks.honoFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok" }), { status: 200 })
    );

    const req = new Request("https://example.com/api/v1/health");
    const ctx = {} as ExecutionContext;
    const res = await worker.fetch(req, baseEnv, ctx);

    expect(res.status).toBe(200);
    expect(mocks.honoFetch).toHaveBeenCalledWith(req, baseEnv, ctx);
    expect(mocks.verifyAccessJwt).not.toHaveBeenCalled();
  });

  it("returns 401 when auth fails", async () => {
    mocks.verifyAccessJwt.mockResolvedValueOnce({
      ok: false,
      reason: "Invalid token",
    });

    const req = new Request("https://example.com/api/overview");
    const res = await worker.fetch(req, baseEnv, {} as ExecutionContext);

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("routes /api/* to dashboard router with same-origin WORKER_API_URL when auth succeeds", async () => {
    const mockUser = { email: "user@example.com", sub: "123" };
    mocks.verifyAccessJwt.mockResolvedValueOnce({
      ok: true,
      user: mockUser,
    });
    mocks.routerFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: "test" }), { status: 200 })
    );

    const req = new Request("https://example.com/api/overview");
    const res = await worker.fetch(req, baseEnv, {} as ExecutionContext);

    expect(res.status).toBe(200);
    expect(mocks.routerFetch).toHaveBeenCalledWith(
      req,
      {
        WORKER_API_URL: "https://example.com",
        DASHBOARD_SERVICE_TOKEN: "token",
      },
      mockUser
    );
  });

  it("serves static assets for non-api routes without auth", async () => {
    mocks.assetsFetch.mockResolvedValueOnce(
      new Response("<html>App</html>", { status: 200 })
    );

    const req = new Request("https://example.com/overview");
    const res = await worker.fetch(req, baseEnv, {} as ExecutionContext);

    expect(res.status).toBe(200);
    expect(mocks.assetsFetch).toHaveBeenCalledWith(req);
    expect(mocks.verifyAccessJwt).not.toHaveBeenCalled();
  });

  it("passes devBypass option when set in env", async () => {
    mocks.verifyAccessJwt.mockResolvedValueOnce({
      ok: true,
      user: { email: "dev@local", sub: "dev" },
    });
    mocks.routerFetch.mockResolvedValueOnce(
      new Response("{}", { status: 200 })
    );

    const req = new Request("https://example.com/api/overview");
    await worker.fetch(
      req,
      { ...baseEnv, CF_ACCESS_DEV_BYPASS: "true" },
      {} as ExecutionContext
    );

    expect(mocks.verifyAccessJwt).toHaveBeenCalledWith(req, {
      team: "test-team",
      aud: "test-aud",
      devBypass: true,
    });
  });
});
