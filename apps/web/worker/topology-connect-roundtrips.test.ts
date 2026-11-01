import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyTopology } from "@steed/api/shared";
import { testDatabase } from "./__tests__/db";
import { fingerprint } from "./connect-crypto";
import { topologyConnectMachineApi } from "./topology-connect-machine";
import type { ConnectEnv } from "./topology-connect-core";
import { ServerTiming } from "./server-timing";

// Production latency is dominated by serial D1 round trips (each one crosses to the D1 primary),
// so every Connect endpoint has a fixed budget on the request's critical path. Deferred work
// (audit row, last-used stamp, and for reads the rate-limit increment) goes to waitUntil and is
// counted separately. Writes fold the rate-limit increment into their critical write batch.
const origin = "https://fixture.example";
const writer = `steedc_${"A".repeat(43)}`;
let database: ReturnType<typeof testDatabase>;
let env: ConnectEnv;
beforeEach(async () => {
  database = testDatabase();
  env = { DB: database.db, CONNECT_DEPLOYMENT_ID: "fixture", CONNECT_MANAGERS: "email:manager@example.com" };
  database.sqlite.prepare("INSERT INTO connect_tokens (id, name, scope, prefix, token_hash, owner, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("writer", "writer", "topology:write", "fixture", await fingerprint(`fixture:${writer}`), "email:manager@example.com", 1);
});
afterEach(() => database.close());

async function measure(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}, token: string | null = writer) {
  const deferred: Promise<unknown>[] = [];
  const start = database.roundTrips();
  const response = await topologyConnectMachineApi(new Request(`${origin}/api/v1${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, { waitUntil: (promise: Promise<unknown>) => { deferred.push(promise); } });
  await Promise.all(deferred);
  return { status: response.status, critical: database.roundTrips() - start - deferred.length, deferred: deferred.length };
}
const intent = (key: string, revision: number) => ({ "Idempotency-Key": key, "If-Match": `"topology:${revision}"` });
const graph = { ...emptyTopology("Fixture"), layers: [{ id: "cloud", label: "Cloud", provider: "Cloud", order: 0 }],
  types: [{ id: "host", label: "Host", shape: "rect" }], nodes: [{ id: "web", label: "Web", type: "host", layerId: "cloud" }] };

describe("Connect D1 round-trip budget", () => {
  it("keeps each endpoint's critical path to a fixed number of D1 round trips", async () => {
    const results: Record<string, Awaited<ReturnType<typeof measure>>> = {};
    results.unauthenticated = await measure("/capabilities", "GET", undefined, {}, null);
    results.capabilities = await measure("/capabilities");
    results.replace = await measure("/topology", "PUT", graph, intent("budget-put-1", 0));
    results.read = await measure("/topology");
    results.delta = await measure("/topology?since=0");
    results.validate = await measure("/topology/validate", "POST", { operations: [{ op: "set_metadata", title: "Dry run" }] });
    results.operations = await measure("/topology/operations", "POST", { operations: [{ op: "set_metadata", title: "Next" }] }, intent("budget-ops-1", 1));
    results.replay = await measure("/topology/operations", "POST", { operations: [{ op: "set_metadata", title: "Next" }] }, intent("budget-ops-1", 1));
    results.entity = await measure("/topology/nodes/web");
    results.changes = await measure("/topology/changes");
    results.receipt = await measure("/requests/budget-ops-1");
    expect(Object.fromEntries(Object.entries(results).map(([name, value]) => [name, [value.status, value.critical, value.deferred]]))).toEqual({
      unauthenticated: [401, 0, 1],
      capabilities: [200, 1, 3],
      replace: [200, 3, 1],
      read: [200, 2, 3],
      delta: [200, 2, 3],
      validate: [200, 2, 3],
      operations: [200, 3, 1],
      replay: [200, 2, 3],
      entity: [200, 2, 3],
      changes: [200, 2, 3],
      receipt: [200, 2, 3],
    });
  });

  it("does not stamp last use or charge a bucket for a rejected token", async () => {
    database.sqlite.prepare("UPDATE connect_tokens SET revoked_at = 2").run();
    expect(await measure("/capabilities")).toEqual({ status: 401, critical: 1, deferred: 1 });
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM connect_rate_limits").get()).toEqual({ count: 0 });
    expect(database.sqlite.prepare("SELECT last_used_at FROM connect_tokens").get()).toEqual({ last_used_at: null });
  });

  it("logs a failed deferred write without leaking it into the response", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    database.sqlite.exec("DROP TABLE connect_audit");
    expect((await measure("/capabilities", "GET", undefined, {}, null)).status).toBe(401);
    expect(error).toHaveBeenCalledWith("connect deferred write failed", expect.stringContaining("connect_audit"));
    error.mockRestore();
  });
});

describe("Connect rate-limit charge placement", () => {
  const countOf = (kind: "read" | "write") =>
    Number(database.sqlite.prepare("SELECT count FROM connect_rate_limits WHERE key = ?").get(`token:writer:${kind}`)?.count ?? 0);

  it("rejects an over-limit write before any topology mutation and does not charge again", async () => {
    const window = Math.floor(Date.now() / 60_000) * 60;
    database.sqlite.prepare("INSERT INTO connect_rate_limits (key, window, count) VALUES (?, ?, ?)").run("token:writer:write", window, 30);
    const before = database.sqlite.prepare("SELECT revision FROM topology_meta WHERE id = 'main'").get() as { revision: number };
    expect(await measure("/topology", "PUT", graph, intent("rate-denied", before.revision))).toEqual({ status: 429, critical: 1, deferred: 1 });
    expect(countOf("write")).toBe(30);
    expect(database.sqlite.prepare("SELECT revision FROM topology_meta WHERE id = 'main'").get()).toEqual(before);
  });

  it("folds a successful write charge into the write batch and defers only last-used", async () => {
    expect(await measure("/topology", "PUT", graph, intent("rate-put", 0))).toEqual({ status: 200, critical: 3, deferred: 1 });
    expect(countOf("write")).toBe(1);
  });

  it("still charges exactly once when a write is rejected with 412 before the write batch", async () => {
    await measure("/topology", "PUT", graph, intent("rate-base", 0));
    expect(countOf("write")).toBe(1);
    expect(await measure("/topology/operations", "POST", { operations: [{ op: "set_metadata", title: "Stale" }] }, intent("rate-412", 0)))
      .toEqual({ status: 412, critical: 3, deferred: 3 });
    expect(countOf("write")).toBe(2);
  });

  it("defers the read charge via waitUntil", async () => {
    expect(await measure("/topology")).toEqual({ status: 200, critical: 2, deferred: 3 });
    expect(countOf("read")).toBe(1);
  });
});

describe("Connect Server-Timing segments", () => {
  async function timed(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}, execution = true) {
    const timing = new ServerTiming();
    const response = await topologyConnectMachineApi(new Request(`${origin}/api/v1${path}`, {
      method, headers: { Authorization: `Bearer ${writer}`, "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env, execution ? { waitUntil: () => undefined } : undefined, timing);
    return { status: response.status, metrics: timing.header().split(", ").map((part) => part.split(";")[0]) };
  }

  it("times auth, the snapshot read, validation and the write of a mutation, with D1 SQL time", async () => {
    expect(await timed("/topology", "PUT", graph, intent("timing-put-1", 0))).toEqual({ status: 200,
      metrics: ["auth", "auth-sql", "read", "read-sql", "validate", "write", "write-sql", "total"] });
    expect(await timed("/topology/validate", "POST", { operations: [{ op: "set_metadata", title: "Dry run" }] })).toEqual({ status: 200,
      metrics: ["auth", "auth-sql", "read", "validate", "total"] });
    expect(await timed("/topology")).toEqual({ status: 200, metrics: ["auth", "auth-sql", "read", "total"] });
    // Without waitUntil deferred rate/last-used/audit writes are awaited before the response and timed.
    expect(await timed("/topology/nodes/web", "GET", undefined, {}, false)).toEqual({ status: 200, metrics: ["auth", "auth-sql", "read", "audit", "total"] });
    // A version conflict still reports the segments that ran.
    expect(await timed("/topology/operations", "POST", { operations: [{ op: "set_metadata", title: "Late" }] }, intent("timing-ops-1", 0))).toEqual({ status: 412,
      metrics: ["auth", "auth-sql", "read", "read-sql", "validate", "total"] });
  });

  it("opts out of edge compression and accepts the weak ETag a compressing proxy hands out", async () => {
    const response = await topologyConnectMachineApi(new Request(`${origin}/api/v1/topology/operations`, {
      method: "POST", headers: { Authorization: `Bearer ${writer}`, "Content-Type": "application/json", "Accept-Encoding": "gzip", ...intent("weak-etag-1", 0), "If-Match": 'W/"topology:0"' },
      body: JSON.stringify({ operations: [{ op: "set_metadata", title: "Weak" }] }),
    }), env, { waitUntil: () => undefined });
    expect([response.status, response.headers.get("ETag"), response.headers.get("Cache-Control")]).toEqual([200, '"topology:1"', "no-store, no-transform"]);
  });
});
