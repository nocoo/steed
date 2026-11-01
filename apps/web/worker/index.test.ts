import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  assetsFetch: vi.fn(),
  connectFetch: vi.fn(),
  verifyAccessJwt: vi.fn(),
  getUserProfile: vi.fn(),
  topologyFetch: vi.fn(),
  workerColo: vi.fn(),
}));

vi.mock("./topology-connect-machine", () => ({
  topologyConnectMachineApi: (...args: unknown[]) => mocks.connectFetch(...args),
}));

vi.mock("./access-jwt", () => ({
  verifyAccessJwt: (...args: unknown[]) => mocks.verifyAccessJwt(...args),
}));

vi.mock("./author-profile", () => ({ getUserProfile: mocks.getUserProfile }));
vi.mock("./worker-colo", () => ({
  TRACE_URL: "https://trace.test/cdn-cgi/trace",
  coloLookup: () => (url: string) => mocks.workerColo(url),
}));
vi.mock("./topology-api", () => ({ topologyBrowserApi: (...args: unknown[]) => mocks.topologyFetch(...args) }));

import worker from "./index";
import { ServerTiming } from "./server-timing";

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
    expect(await res.json()).toEqual({ status: "ok", version: "0.5.6" });
    expect(mocks.verifyAccessJwt).not.toHaveBeenCalled();
  });

  it("reports the traced execution colo and the validated ingress location on API responses only", async () => {
    const located = (path: string, placement?: string, colo?: unknown, env: object = baseEnv) => {
      const req = new Request(`https://example.com${path}`, placement ? { headers: { "cf-placement": placement } } : {});
      if (colo !== undefined) Object.defineProperty(req, "cf", { value: { colo } });
      return worker.fetch(req, env as typeof baseEnv, { waitUntil: vi.fn() } as unknown as ExecutionContext);
    };
    const headersOf = (res: Response) =>
      ["X-Steed-Colo", "X-Steed-Ingress-Colo", "X-Steed-Placement"].map((name) => res.headers.get(name));
    mocks.workerColo.mockResolvedValue("NRT");
    expect(headersOf(await located("/api/live", "remote-NRT", "IAD"))).toEqual(["NRT", "IAD", "remote-NRT"]);
    expect(mocks.workerColo).toHaveBeenCalledWith("https://trace.test/cdn-cgi/trace");
    mocks.connectFetch.mockResolvedValueOnce(new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } }));
    const connect = await located("/api/v1/capabilities", undefined, "IAD");
    expect([connect.status, connect.headers.get("Cache-Control"), ...headersOf(connect)]).toEqual([401, "no-store", "NRT", "IAD", null]);
    // Malformed request metadata is never echoed, and a failed trace omits X-Steed-Colo.
    mocks.workerColo.mockResolvedValue(null);
    expect(headersOf(await located("/api/live", "remote-NRT, injected", "iad"))).toEqual([null, null, null]);
    for (const colo of [undefined, 42]) expect(headersOf(await located("/api/live", undefined, colo))).toEqual([null, null, null]);
    mocks.assetsFetch.mockResolvedValueOnce(new Response("page"));
    expect(headersOf(await located("/topology", "remote-NRT", "IAD"))).toEqual([null, null, null]);
  });

  it("traces only through the local E2E override in the local dev deployment", async () => {
    const local = { ...baseEnv, CF_ACCESS_DEV_BYPASS: "true", CONNECT_DEPLOYMENT_ID: "steed-development" };
    mocks.workerColo.mockResolvedValue("NRT");
    const skipped = await worker.fetch(new Request("http://127.0.0.1:8787/api/live"), local, {} as ExecutionContext);
    expect([skipped.headers.get("X-Steed-Colo"), mocks.workerColo.mock.calls.length]).toEqual([null, 0]);
    const stubbed = await worker.fetch(new Request("http://127.0.0.1:8787/api/live"),
      { ...local, COLO_TRACE_URL: "http://127.0.0.1:9/cdn-cgi/trace" }, {} as ExecutionContext);
    expect([stubbed.headers.get("X-Steed-Colo"), mocks.workerColo.mock.calls]).toEqual(["NRT", [["http://127.0.0.1:9/cdn-cgi/trace"]]]);
    // Outside the local deployment the override is ignored.
    await worker.fetch(new Request("https://example.com/api/live"), { ...baseEnv, COLO_TRACE_URL: "http://127.0.0.1:9/x" }, {} as ExecutionContext);
    expect(mocks.workerColo.mock.calls.at(-1)).toEqual(["https://trace.test/cdn-cgi/trace"]);
  });

  it.each(["/api/v1", "/api/v1/diagrams", "/api/v1/hosts", "/api/v1/health"])("routes %s only to the Connect handler without CF Access check", async (path) => {
    mocks.connectFetch.mockResolvedValueOnce(new Response(null, { status: 401 }));

    const req = new Request(`https://example.com${path}`);
    const execution = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const res = await worker.fetch(req, baseEnv, execution);

    expect(res.status).toBe(401);
    expect(mocks.connectFetch).toHaveBeenCalledWith(req, baseEnv, execution, expect.any(ServerTiming));
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
  it("adds Server-Timing with only fixed metric names to API responses and marks the isolate's first request cold", async () => {
    mocks.workerColo.mockResolvedValue("NRT");
    const execution = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    mocks.connectFetch.mockImplementationOnce((_req: Request, _env: unknown, _exec: unknown, timing: ServerTiming) => {
      timing.add("auth", 12.34);
      timing.add("write", 100);
      return Promise.resolve(Response.json({ ok: true }));
    });
    const connect = await worker.fetch(new Request("https://example.com/api/v1/topology/operations", { method: "POST" }), baseEnv, execution);
    const value = connect.headers.get("Server-Timing") ?? "";
    expect(value).toMatch(/^auth;dur=12\.3, write;dur=100\.0, colo;dur=\d+\.\d, total;dur=\d+\.\d(, cold)?$/);
    const live = await worker.fetch(new Request("https://example.com/api/live"), baseEnv, execution);
    expect(live.headers.get("Server-Timing")).toMatch(/^colo;dur=\d+\.\d, total;dur=\d+\.\d$/);
    for (const part of (live.headers.get("Server-Timing") ?? "").split(", ")) expect(part).toMatch(/^[a-z-]+(;dur=\d+\.\d)?$/);
    mocks.assetsFetch.mockResolvedValueOnce(new Response("page"));
    expect((await worker.fetch(new Request("https://example.com/topology"), baseEnv, execution)).headers.get("Server-Timing")).toBeNull();
  });

  it("marks only the first API request of an isolate as cold", async () => {
    vi.resetModules();
    const fresh = (await import("./index")).default;
    const first = await fresh.fetch(new Request("https://example.com/api/live"), baseEnv, {} as ExecutionContext);
    const second = await fresh.fetch(new Request("https://example.com/api/live"), baseEnv, {} as ExecutionContext);
    expect(first.headers.get("Server-Timing")).toMatch(/, cold$/);
    expect(second.headers.get("Server-Timing")).not.toMatch(/cold/);
  });
});
