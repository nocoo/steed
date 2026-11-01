import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyTopology } from "@steed/api/shared";
import { testDatabase } from "./__tests__/db";
import { fingerprint } from "./connect-crypto";
import { topologyConnectMachineApi } from "./topology-connect-machine";
import type { ConnectEnv } from "./topology-connect-core";

// Production latency is dominated by serial D1 round trips (each one crosses to the D1 primary),
// so every Connect endpoint has a fixed budget on the request's critical path. Deferred work
// (audit row, last-used stamp) goes to waitUntil and is counted separately.
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
      capabilities: [200, 1, 2],
      replace: [200, 3, 1],
      read: [200, 2, 2],
      delta: [200, 2, 2],
      validate: [200, 2, 2],
      operations: [200, 3, 1],
      replay: [200, 2, 2],
      entity: [200, 2, 2],
      changes: [200, 2, 2],
      receipt: [200, 2, 2],
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
