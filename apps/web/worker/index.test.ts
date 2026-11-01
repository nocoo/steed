import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  assetsFetch: vi.fn(),
  connectFetch: vi.fn(),
  verifyAccessJwt: vi.fn(),
  getUserProfile: vi.fn(),
  topologyFetch: vi.fn(),
}));

vi.mock("./topology-connect-machine", () => ({
  topologyConnectMachineApi: (...args: unknown[]) => mocks.connectFetch(...args),
}));

vi.mock("./access-jwt", () => ({
  verifyAccessJwt: (...args: unknown[]) => mocks.verifyAccessJwt(...args),
}));

vi.mock("./author-profile", () => ({ getUserProfile: mocks.getUserProfile }));
vi.mock("./topology-api", () => ({ topologyBrowserApi: (...args: unknown[]) => mocks.topologyFetch(...args) }));

import worker from "./index";

describe("worker", () => {
  const baseEnv = {
    ASSETS: { fetch: mocks.assetsFetch },
    DB: {} as D1Database,
    CF_ACCESS_TEAM: "test-team",
    CF_ACCESS_AUD: "test-aud",
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns ok for /api/live without auth", async () => {
    const req = new Request("https://example.com/api/live");
    const res = await worker.fetch(req, baseEnv, {} as ExecutionContext);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok", version: "0.5.3" });
    expect(mocks.verifyAccessJwt).not.toHaveBeenCalled();
  });

  it("reports where the Worker ran on API responses only, from validated values", async () => {
    const located = (path: string, placement?: string, colo?: unknown) => {
      const req = new Request(`https://example.com${path}`, placement ? { headers: { "cf-placement": placement } } : {});
      if (colo !== undefined) Object.defineProperty(req, "cf", { value: { colo } });
      return worker.fetch(req, baseEnv, { waitUntil: vi.fn() } as unknown as ExecutionContext);
    };
    const live = await located("/api/live", "remote-NRT", "IAD");
    expect([live.headers.get("X-Steed-Colo"), live.headers.get("X-Steed-Placement")]).toEqual(["NRT", "remote-NRT"]);
    mocks.connectFetch.mockResolvedValueOnce(new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } }));
    const connect = await located("/api/v1/capabilities", "local-NRT");
    expect([connect.status, connect.headers.get("Cache-Control"), connect.headers.get("X-Steed-Colo"), connect.headers.get("X-Steed-Placement")])
      .toEqual([401, "no-store", "NRT", "local-NRT"]);
    // Without a valid placement header the colo falls back to request.cf; malformed values are never echoed.
    const fallback = await located("/api/live", "remote-NRT, injected", "IAD");
    expect([fallback.headers.get("X-Steed-Colo"), fallback.headers.get("X-Steed-Placement")]).toEqual(["IAD", null]);
    for (const colo of [undefined, "iad", 42]) expect((await located("/api/live", undefined, colo)).headers.get("X-Steed-Colo")).toBeNull();
    mocks.assetsFetch.mockResolvedValueOnce(new Response("page"));
    expect((await located("/topology", "remote-NRT")).headers.get("X-Steed-Colo")).toBeNull();
  });

  it.each(["/api/v1", "/api/v1/diagrams", "/api/v1/hosts", "/api/v1/health"])("routes %s only to the Connect handler without CF Access check", async (path) => {
    mocks.connectFetch.mockResolvedValueOnce(new Response(null, { status: 401 }));

    const req = new Request(`https://example.com${path}`);
    const execution = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const res = await worker.fetch(req, baseEnv, execution);

    expect(res.status).toBe(401);
    expect(mocks.connectFetch).toHaveBeenCalledWith(req, baseEnv, execution);
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

  it("routes topology reads only after Access authentication", async () => {
    mocks.verifyAccessJwt.mockResolvedValueOnce({ ok: false, reason: "Missing JWT" });
    const denied = new Request("https://example.com/api/topology");
    expect((await worker.fetch(denied, baseEnv, {} as ExecutionContext)).status).toBe(401);
    expect(mocks.topologyFetch).not.toHaveBeenCalled();
    mocks.verifyAccessJwt.mockResolvedValueOnce({ ok: true, user: { email: "verified@example.com", sub: "123" } });
    mocks.topologyFetch.mockResolvedValueOnce(new Response("ok"));
    const allowed = new Request("https://example.com/api/topology/changes");
    expect((await worker.fetch(allowed, baseEnv, {} as ExecutionContext)).status).toBe(200);
    expect(mocks.topologyFetch).toHaveBeenCalledWith(allowed, baseEnv.DB);
  });

  it.each(["GET", "HEAD"])("serves %s /api/me using only the verified identity", async (method) => {
    mocks.verifyAccessJwt.mockResolvedValue({ ok: true, user: { email: "verified@example.com", sub: "123" } });
    const profile = { name: "Verified", email: "verified@example.com", avatar: null };
    mocks.getUserProfile.mockResolvedValue(profile);
    const response = await worker.fetch(
      new Request("https://example.com/api/me?email=attacker@example.com", { method }),
      baseEnv, {} as ExecutionContext
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.getUserProfile).toHaveBeenCalledWith("verified@example.com", { host: "example.com", origin: undefined });
    if (method === "GET") expect(await response.json()).toEqual(profile);
    else expect(await response.text()).toBe("");
  });

  it.each([
    [{ CF_ACCESS_DEV_BYPASS: "true", CONNECT_DEPLOYMENT_ID: "steed-development" }, "http://127.0.0.1:9"],
    [{ CF_ACCESS_DEV_BYPASS: "true", CONNECT_DEPLOYMENT_ID: "steed-production" }, undefined],
    [{ CONNECT_DEPLOYMENT_ID: "steed-development" }, undefined],
  ])("only lets the local dev deployment override the profile upstream (%o)", async (vars, origin) => {
    mocks.verifyAccessJwt.mockResolvedValue({ ok: true, user: { email: "dev@local", sub: "dev" } });
    mocks.getUserProfile.mockResolvedValue({ name: "dev", email: "dev@local", avatar: null });
    await worker.fetch(new Request("http://127.0.0.1:8787/api/me"), { ...baseEnv, ...vars, AUTHOR_PROFILE_ORIGIN: "http://127.0.0.1:9" }, {} as ExecutionContext);
    expect(mocks.getUserProfile).toHaveBeenCalledWith("dev@local", { host: "127.0.0.1:8787", origin });
  });

  it("rejects mutations to /api/me", async () => {
    mocks.verifyAccessJwt.mockResolvedValue({ ok: true, user: { email: "user@example.com", sub: "123" } });
    const response = await worker.fetch(new Request("https://example.com/api/me", { method: "POST" }), baseEnv, {} as ExecutionContext);
    expect(response.status).toBe(405);
    expect(mocks.getUserProfile).not.toHaveBeenCalled();
  });

  it("does not query profiles without Access authentication", async () => {
    mocks.verifyAccessJwt.mockResolvedValue({ ok: false, reason: "Missing JWT" });
    const response = await worker.fetch(new Request("https://example.com/api/me"), baseEnv, {} as ExecutionContext);
    expect(response.status).toBe(401);
    expect(mocks.getUserProfile).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown Access-verified API routes", async () => {
    mocks.verifyAccessJwt.mockResolvedValueOnce({ ok: true, user: { email: "user@example.com", sub: "123" } });

    const res = await worker.fetch(new Request("https://example.com/api/overview"), baseEnv, {} as ExecutionContext);

    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "API route not found." } });
  });

  it("serves static assets for non-api routes without auth", async () => {
    mocks.assetsFetch.mockResolvedValueOnce(
      new Response("<html>App</html>", { status: 200 })
    );

    const req = new Request("https://example.com/topology");
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
