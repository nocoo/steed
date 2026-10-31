import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TopologyConnectToken } from "@steed/api/shared";
import { topologyConnectTestDatabase } from "./__tests__/topology-connect-db";
import { randomSecret } from "./connect-crypto";
import { topologyConnectManagementApi } from "./topology-connect-management";
import type { ConnectEnv } from "./topology-connect-core";

const origin = "https://fixture.example";
const user = { email: "manager@example.com", sub: "manager" };
let database: ReturnType<typeof topologyConnectTestDatabase>;
let env: ConnectEnv;
beforeEach(() => {
  database = topologyConnectTestDatabase();
  env = { DB: database.db, CONNECT_DEPLOYMENT_ID: "fixture", CONNECT_MANAGERS: "email:manager@example.com", CONNECT_TOKEN_KEYS: JSON.stringify({ active: "fixture", keys: { fixture: randomSecret() } }) };
});
afterEach(() => database.close());
const call = (path: string, method = "GET", body?: unknown, token?: TopologyConnectToken) => topologyConnectManagementApi(new Request(`${origin}/api/connect${path}`, {
  method, headers: { Origin: origin, "X-Steed-Request": "1", "Content-Type": "application/json", ...(token ? { "If-Match": `"${token.id}:${token.version}"` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), env, user);
const json = async <T>(response: Response) => await response.json() as { data: T };
async function create(scope: "topology:read" | "topology:write" = "topology:write") {
  const response = await call("/tokens", "POST", { name: "Fixture", scope });
  expect(response.status).toBe(201);
  return (await json<TopologyConnectToken>(response)).data;
}
async function challenge(token: TopologyConnectToken, action: string) {
  return (await json<{ challenge: string }>(await call(`/tokens/${token.id}/challenge`, "POST", { action }, token))).data.challenge;
}

describe("prepared topology Connect management", () => {
  it("creates topology-scoped metadata, rejects diagram bindings, and pages all tokens", async () => {
    const first = await create("topology:read");
    const second = await create();
    expect(first).toMatchObject({ scope: "topology:read", name: "Fixture" });
    expect(first).not.toHaveProperty("diagramId");
    expect((await call("/tokens", "POST", { name: "Bad", scope: "topology:read", diagramId: null })).status).toBe(422);
    expect((await call("/tokens", "POST", { name: "Bad", scope: "read" })).status).toBe(422);
    expect((await call("/diagrams")).status).toBe(404);
    const page = await (await call("/tokens?limit=1")).json() as { data: TopologyConnectToken[]; nextCursor: string };
    const next = await json<TopologyConnectToken[]>(await call(`/tokens?limit=1&cursor=${page.nextCursor}`));
    expect([...page.data, ...next.data].map((item) => item.id).sort()).toEqual([first.id, second.id].sort());
    expect((await call("/tokens?diagramId=other")).status).toBe(422);
    expect((await call("/audit?diagramId=other")).status).toBe(422);
  });

  it("reveals, renames, rotates and revokes under versioned one-use challenges", async () => {
    let token = await create();
    const proof = await challenge(token, "reveal");
    const result = await call(`/tokens/${token.id}/reveal`, "POST", { challenge: proof, confirmation: token.name }, token);
    const secret = (await json<{ token: string }>(result)).data.token;
    expect(secret).toMatch(/^steedc_[A-Za-z0-9_-]{43}$/);
    expect((await call(`/tokens/${token.id}/reveal`, "POST", { challenge: proof, confirmation: token.name }, token)).status).toBe(403);
    expect(JSON.stringify(database.sqlite.prepare("SELECT * FROM connect_tokens").all())).not.toContain(secret);
    expect(JSON.stringify(database.sqlite.prepare("SELECT * FROM connect_audit").all())).not.toContain(secret);
    token = (await json<TopologyConnectToken>(await call(`/tokens/${token.id}`, "PATCH", { name: "Renamed" }, token))).data;
    const rotated = await call(`/tokens/${token.id}/rotate`, "POST", { challenge: await challenge(token, "rotate"), confirmation: token.name }, token);
    token = (await json<TopologyConnectToken>(rotated)).data;
    const fresh = await call(`/tokens/${token.id}/reveal`, "POST", { challenge: await challenge(token, "reveal"), confirmation: token.name }, token);
    expect((await json<{ token: string }>(fresh)).data.token).not.toBe(secret);
    const revoked = await call(`/tokens/${token.id}/revoke`, "POST", { challenge: await challenge(token, "revoke"), confirmation: token.name }, token);
    expect((await json<TopologyConnectToken>(revoked)).data.revokedAt).not.toBeNull();
    expect(database.sqlite.prepare("SELECT token_hash, ciphertext FROM connect_tokens WHERE id = ?").get(token.id)).toMatchObject({ token_hash: null, ciphertext: null });
  });

  it("serves topology discovery and unfiltered, redacted audit", async () => {
    await create();
    const info = await json<{ limits: { operations: number } }>(await call(""));
    expect(info.data.limits.operations).toBe(1000);
    const openapi = await call("/openapi.json");
    expect(openapi.headers.get("Content-Disposition")).toContain("attachment");
    expect(await openapi.json()).toMatchObject({ paths: { "/topology": { get: { operationId: "topology.get" } } } });
    const audit = await json<{ target: string }[]>(await call("/audit"));
    expect(audit.data.length).toBeGreaterThan(0);
    expect(audit.data.every((entry) => entry.target === "topology")).toBe(true);
  });
});
