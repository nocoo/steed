import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  assetsFetch: vi.fn(),
  connectFetch: vi.fn(),
  verifyAccessJwt: vi.fn(),
  getUserProfile: vi.fn(),
}));

vi.mock("./connect-api", () => ({
  connectMachineApi: (...args: unknown[]) => mocks.connectFetch(...args),
}));

vi.mock("./access-jwt", () => ({
  verifyAccessJwt: (...args: unknown[]) => mocks.verifyAccessJwt(...args),
}));

vi.mock("./author-profile", () => ({ getUserProfile: mocks.getUserProfile }));

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
    expect(await res.json()).toEqual({ status: "ok", version: "0.3.6" });
    expect(mocks.verifyAccessJwt).not.toHaveBeenCalled();
  });

  it.each(["/api/v1", "/api/v1/diagrams", "/api/v1/hosts", "/api/v1/health"])("routes %s only to the Connect handler without CF Access check", async (path) => {
    mocks.connectFetch.mockResolvedValueOnce(new Response(null, { status: 401 }));

    const req = new Request(`https://example.com${path}`);
    const res = await worker.fetch(req, baseEnv, {} as ExecutionContext);

    expect(res.status).toBe(401);
    expect(mocks.connectFetch).toHaveBeenCalledWith(req, baseEnv);
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
    expect(mocks.getUserProfile).toHaveBeenCalledWith("verified@example.com");
    if (method === "GET") expect(await response.json()).toEqual(profile);
    else expect(await response.text()).toBe("");
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
