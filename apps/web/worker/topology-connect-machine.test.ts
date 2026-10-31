import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyTopology } from "@steed/api/shared";
import { topologyConnectTestDatabase } from "./__tests__/topology-connect-db";
import { fingerprint } from "./connect-crypto";
import { topologyConnectMachineApi } from "./topology-connect-machine";
import type { ConnectEnv } from "./topology-connect-core";

const origin = "https://fixture.example";
const writer = `steedc_${"A".repeat(43)}`;
const reader = `steedc_${"B".repeat(43)}`;
let database: ReturnType<typeof topologyConnectTestDatabase>;
let env: ConnectEnv;
beforeEach(async () => {
  database = topologyConnectTestDatabase();
  env = { DB: database.db, CONNECT_DEPLOYMENT_ID: "fixture", CONNECT_MANAGERS: "email:manager@example.com" };
  for (const [id, scope, credential] of [["writer", "topology:write", writer], ["reader", "topology:read", reader]]) {
    database.sqlite.prepare("INSERT INTO connect_tokens (id, name, scope, prefix, token_hash, owner, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id!, id!, scope!, "fixture", await fingerprint(`fixture:${credential}`), "email:manager@example.com", 1);
  }
});
afterEach(() => database.close());
const api = (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}, token = writer) => topologyConnectMachineApi(new Request(`${origin}/api/v1${path}`, {
  method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
  ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
}), env);
const intent = (key: string, revision: number) => ({ "Idempotency-Key": key, "If-Match": `"topology:${revision}"` });

describe("prepared topology Connect machine API", () => {
  it("writes, replays, reads and validates the canonical graph", async () => {
    const graph = { ...emptyTopology("Fixture"), layers: [{ id: "cloud", label: "Cloud", provider: "Cloud", order: 0 }] };
    const created = await api("/topology", "PUT", graph, intent("intent-01", 0));
    expect(created.status).toBe(200);
    expect(created.headers.get("ETag")).toBe('"topology:1"');
    expect(await created.clone().json()).toMatchObject({ data: { revision: 1, changed: { layers: 1 } } });
    const replay = await api("/topology", "PUT", graph, intent("intent-01", 0));
    expect(replay.status).toBe(200); expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(await created.json());
    expect((await api("/topology", "PUT", { ...graph, title: "Different" }, intent("intent-01", 0))).status).toBe(409);
    expect((await api("/topology/layers/cloud")).headers.get("ETag")).toBe('"topology:1"');
    expect(await (await api("/topology/layers?limit=1")).json()).toMatchObject({ data: [{ id: "cloud" }] });
    expect(await (await api("/topology/validate", "POST", { operations: [{ op: "set_metadata", title: "Dry run" }] })).json()).toMatchObject({ data: { valid: true, changed: { metadata: 1 } } });
    expect(await (await api("/requests/intent-01")).json()).toMatchObject({ data: { state: "completed", httpStatus: 200 } });
    expect(await (await api("/topology/changes")).json()).toMatchObject({ data: [{ revision: 1 }] });
  });

  it("enforces auth, scope, preconditions, confirmation, validation and size", async () => {
    expect((await api("/topology", "GET", undefined, {}, "bad")).status).toBe(401);
    expect((await api("/topology", "PUT", emptyTopology(), intent("denied-01", 0), reader)).status).toBe(403);
    expect((await api("/topology", "PUT", emptyTopology(), { "If-Match": '"topology:0"' })).status).toBe(428);
    expect((await api("/topology", "PUT", emptyTopology(), { "Idempotency-Key": "intent-02" })).status).toBe(428);
    expect((await api("/topology", "PUT", emptyTopology(), intent("intent-03", 3))).status).toBe(412);
    expect((await api("/topology/operations", "POST", { operations: [{ op: "remove_node", id: "none" }] }, intent("intent-04", 0))).status).toBe(428);
    const value = `steedc_${"X".repeat(43)}`;
    const invalid = await api("/topology", "PUT", { ...emptyTopology(), description: value }, intent("intent-05", 0));
    expect(invalid.status).toBe(422);
    const body = await invalid.text();
    expect(body).toContain("secret_like_value"); expect(body).toContain("rule"); expect(body).not.toContain(value);
    expect((await api("/topology", "PUT", "x".repeat(4 * 1024 * 1024 + 1), intent("intent-06", 0))).status).toBe(413);
    const audit = database.sqlite.prepare("SELECT status, code FROM connect_audit ORDER BY id DESC LIMIT 2").all();
    expect(audit.some((item) => item.code === "invalid_topology")).toBe(true);
  });

  it("handles current, stale, future and malformed revisions before conditional reads", async () => {
    await api("/topology", "PUT", emptyTopology(), intent("intent-07", 0));
    expect((await api("/topology?since=1")).status).toBe(200);
    for (const since of ["0", "2"]) {
      const response = await api(`/topology?since=${since}`, "GET", undefined, { "If-None-Match": '"topology:1"' });
      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ error: { code: "resync_required" }, current_revision: 1, oldest_retained_revision: 1 });
    }
    expect((await api("/topology?since=bad")).status).toBe(400);
    expect((await api("/topology/changes?since=bad")).status).toBe(400);
    expect((await api("/topology", "GET", undefined, { "If-None-Match": '"topology:1"' })).status).toBe(304);
  });

  it("rejects unsupported since queries on discovery and writes", async () => {
    for (const [path, method, body] of [
      ["/capabilities?since=1", "GET", undefined],
      ["/topology/validate?since=1", "POST", emptyTopology()],
      ["/topology?since=1", "PUT", emptyTopology()],
    ] as const) {
      const response = await api(path, method, body, intent("query-0001", 0));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_query" } });
    }
  });

  it("applies entity operations and handles subtree deletion conflicts", async () => {
    const operations = { operations: [
      { op: "put_layer", value: { id: "cloud", label: "Cloud", provider: "Cloud", order: 0 } },
      { op: "put_type", value: { id: "host", label: "Host", shape: "rect" } },
      { op: "put_node", value: { id: "root", label: "Root", type: "host", layerId: "cloud" } },
      { op: "put_node", value: { id: "service", label: "Service", type: "host", layerId: "cloud", parentId: "root", role: "service" } },
    ] };
    expect((await api("/topology/operations", "POST", operations, intent("setup-0001", 0))).status).toBe(200);
    const failed = await api("/topology/nodes/root", "DELETE", undefined, { ...intent("remove-001", 1), "X-Steed-Confirm": "topology" });
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ error: { code: "node_has_satellites" } });
    const removed = await api("/topology/operations", "POST", { operations: [{ op: "remove_node", id: "root", cascade: true }] }, { ...intent("remove-002", 1), "X-Steed-Confirm": "topology" });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ data: { revision: 2, changed: { nodes: 2 } } });
    expect(await (await api("/topology/nodes")).json()).toMatchObject({ data: [] });
    expect((await api("/topology/nodes/missing", "DELETE", undefined, { ...intent("remove-003", 2), "X-Steed-Confirm": "topology" })).status).toBe(404);
  });

  it("commits concurrent retries only once and returns the winning receipt", async () => {
    const body = { ...emptyTopology(), title: "Concurrent fixture" };
    const results = await Promise.all([api("/topology", "PUT", body, intent("retry-0001", 0)), api("/topology", "PUT", body, intent("retry-0001", 0))]);
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    expect(results.some((response) => response.headers.get("Idempotency-Replayed") === "true")).toBe(true);
    expect(await results[0]!.json()).toEqual(await results[1]!.json());
    expect(database.sqlite.prepare("SELECT revision FROM topology_meta").get()?.revision).toBe(1);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM topo_changes").get()?.n).toBe(1);
  });
});
