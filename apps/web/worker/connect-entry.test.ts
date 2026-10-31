import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectToken } from "@steed/api/shared";
import { randomSecret } from "./connect-crypto";
import { connectManagementApi } from "./connect-management";
import { testDatabase } from "./__tests__/db";

const mocks = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock("./access-jwt", () => ({ verifyAccessJwt: mocks.access }));
import worker from "./index";

const origin = "https://steed.example.com";
const user = { email: "manager@example.com", sub: "manager" };
let database: ReturnType<typeof testDatabase>;
beforeEach(() => { vi.resetAllMocks(); database = testDatabase(); });
afterEach(() => database.close());
const environment = () => ({ DB: database.db, ASSETS: { fetch: vi.fn() }, CF_ACCESS_TEAM: "team", CF_ACCESS_AUD: "aud",
  CONNECT_MANAGERS: "email:manager@example.com", CONNECT_DEPLOYMENT_ID: "steed-test", CONNECT_TOKEN_KEYS: JSON.stringify({ active: "test", keys: { test: randomSecret() } }) });

describe("active Worker Connect authentication boundary", () => {
  it("requires verified Access and explicit management authority even with a Bearer header", async () => {
    const env = environment();
    mocks.access.mockResolvedValue({ ok: false, reason: "Missing JWT" });
    const request = new Request(`${origin}/api/connect`, { headers: { Authorization: "Bearer ignored", "Cf-Access-Authenticated-User-Email": user.email } });
    const response = await worker.fetch(request, env, {} as ExecutionContext);
    expect(response.status).toBe(401); expect(await response.json()).toHaveProperty("error.code", "access_required");
    mocks.access.mockResolvedValue({ ok: true, user: { email: "unlisted@example.com", sub: "other" } });
    expect((await worker.fetch(request, env, {} as ExecutionContext)).status).toBe(403);
    mocks.access.mockResolvedValue({ ok: true, user });
    expect((await worker.fetch(request, env, {} as ExecutionContext)).status).toBe(200);
  });

  it("dispatches every v1 route to Connect Bearer authentication, separate from the browser", async () => {
    const env = environment();
    const manage = (path: string, body: unknown, token?: ConnectToken) => connectManagementApi(new Request(`${origin}/api/connect${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "X-Steed-Request": "1", ...(token ? { "If-Match": `"${token.id}:${token.version}"` } : {}) }, body: JSON.stringify(body),
    }), env, user);
    const created = await manage("/tokens", { name: "Entry test", scope: "read" });
    const token = (await created.json() as { data: ConnectToken }).data;
    const proof = await manage(`/tokens/${token.id}/challenge`, { action: "reveal" }, token);
    const challenge = (await proof.json() as { data: { challenge: string } }).data.challenge;
    const revealed = await manage(`/tokens/${token.id}/reveal`, { challenge, confirmation: token.name }, token);
    const credential = (await revealed.json() as { data: { token: string } }).data.token;
    const headers = { Authorization: `Bearer ${credential}` };
    const call = (path: string, authenticated = true) => worker.fetch(new Request(`${origin}${path}`, { headers: authenticated ? headers : {} }), env, {} as ExecutionContext);
    for (const path of ["/api/v1/diagrams", "/api/v1/capabilities", "/api/v1/openapi.json"]) {
      expect((await call(path, false)).status).toBe(401);
      expect((await call(path)).status).toBe(200);
    }
    expect((await call("/api/v1/requests/missing-intent")).status).toBe(404);
    expect((await call("/api/v1/diagrams/example/unknown")).status).toBe(404);
    expect(mocks.access).not.toHaveBeenCalled();
    mocks.access.mockResolvedValue({ ok: false, reason: "Missing JWT" });
    expect((await call("/api/diagrams")).status).toBe(401);
    for (const path of ["/api/v1/hosts", "/api/v1/diagrams-extra", "/api/v1"]) {
      expect((await call(path, false)).status).toBe(401);
      expect((await call(path)).status).toBe(404);
    }
  });
});
