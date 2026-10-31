import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { topologySchema } from "@steed/api/shared";
import { testDatabase } from "./__tests__/db";
import { topologyBrowserApi } from "./topology-api";
import { pruneTopologyHistoryStatement } from "./topology-history";
import { loadTopology } from "./topology-store";
import { topologyWriteStatements } from "./topology-write";

let database: ReturnType<typeof testDatabase>;
beforeEach(async () => {
  database = testDatabase();
  let before = (await loadTopology(database.db)).topology;
  const graph = topologySchema.parse({ schemaVersion: 2, title: "Fixture", layers: [{ id: "cloud", label: "Cloud", provider: "Fixture", order: 0 }] });
  for (let revision = 0; revision < 2; revision++) {
    const batch = topologyWriteStatements(database.db, {
      before, after: graph, revision, requestId: `request-${revision}`, actor: "fixture", tokenId: null, provenance: null,
      kind: "replace", revertsChangeId: null, updatedAt: "2026-01-01T00:00:00.000Z", createdAt: revision,
      guard: { clause: "1", values: [] },
    });
    await database.db.batch(batch.statements);
    before = (await loadTopology(database.db)).topology;
  }
});
afterEach(() => database.close());

function request(path = "/api/topology", init?: RequestInit) {
  return topologyBrowserApi(new Request(`https://fixture.example${path}`, init), database.db);
}

describe("read-only topology browser API", () => {
  it("returns the snapshot and supports HEAD and conditional reads", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('"topology:2"');
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ data: { schemaVersion: 2, title: "Fixture", revision: 2, layers: [{ id: "cloud" }] }, updatedAt: "2026-01-01T00:00:00.000Z" });
    const head = await request("/api/topology", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("ETag")).toBe('"topology:2"');
    expect(await head.text()).toBe("");
    for (const condition of ['"topology:2"', 'W/"topology:2"', '"other", "topology:2"', "*"]) {
      expect((await request("/api/topology", { headers: { "If-None-Match": condition } })).status).toBe(304);
    }
    expect((await request("/api/topology", { headers: { "If-None-Match": '"topology:1"' } })).status).toBe(200);
  });

  it("rejects writes and cross-origin reads", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await request("/api/topology", { method });
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET, HEAD");
    }
    expect((await request("/api/topology", { headers: { Origin: "https://other.example" } })).status).toBe(403);
    expect((await request("/api/topology/unknown")).status).toBe(404);
  });

  it("returns deltas and never masks invalid, stale or future since with a matching ETag", async () => {
    const delta = await request("/api/topology?since=1");
    expect(delta.status).toBe(200);
    expect(await delta.json()).toMatchObject({ data: { since: 1, revision: 2, metadata: { title: "Fixture" } } });
    const current = await request("/api/topology?since=2");
    const currentBody = await current.json() as { data: { metadata?: unknown; changed: Record<string, unknown[]>; deleted: Record<string, unknown[]> } };
    expect(currentBody.data.metadata).toBeUndefined();
    expect(Object.values(currentBody.data.changed).every((items) => items.length === 0)).toBe(true);
    expect(Object.values(currentBody.data.deleted).every((items) => items.length === 0)).toBe(true);
    for (const value of ["0", "3"]) {
      const response = await request(`/api/topology?since=${value}`, { headers: { "If-None-Match": '"topology:2"' } });
      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ error: { code: "resync_required" }, current_revision: 2, oldest_retained_revision: 1 });
    }
    for (const value of ["", "-1", "1.5", "1e2"]) {
      const response = await request(`/api/topology?since=${value}`, { headers: { "If-None-Match": '"topology:2"' } });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_since" } });
    }
    const badHead = await request("/api/topology?since=bad", { method: "HEAD" });
    expect(badHead.status).toBe(400);
    expect(await badHead.text()).toBe("");
  });

  it("lists summaries with bounded cursors and applies since validation", async () => {
    const first = await request("/api/topology/changes?limit=1");
    const body = await first.json() as { data: { changes: { id: number; items?: unknown }[]; nextCursor: number } };
    expect(body.data.changes.map((change) => change.id)).toEqual([2]);
    expect(body.data.changes[0]).not.toHaveProperty("items");
    expect(body.data.nextCursor).toBe(2);
    const second = await request(`/api/topology/changes?limit=1&cursor=${body.data.nextCursor}`);
    expect(await second.json()).toMatchObject({ data: { changes: [{ id: 1 }], nextCursor: null } });
    for (const [value, status, code] of [["0", 410, "resync_required"], ["3", 410, "resync_required"], ["bad", 400, "invalid_since"]] as const) {
      const response = await request(`/api/topology/changes?since=${value}`, { headers: { "If-None-Match": '"topology-changes:2:1"' } });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    for (const suffix of ["?limit=0", "?limit=501", "?cursor=-1", "?unknown=1", "?since=1&since=2"]) {
      expect((await request(`/api/topology/changes${suffix}`)).status).toBe(400);
    }
    expect((await request("/api/topology/changes", { method: "HEAD" })).status).toBe(200);
    expect(first.headers.get("ETag")).toBe('"topology-changes:2:1"');
    expect((await request("/api/topology/changes", { headers: { "If-None-Match": '"topology-changes:2:1"' } })).status).toBe(304);
    expect((await request("/api/topology/changes", { headers: { "If-None-Match": '"topology:2"' } })).status).toBe(200);
  });

  it("invalidates history pages when pruning changes the retained range without a write", async () => {
    database.sqlite.exec(`
      UPDATE topology_meta SET revision = 510;
      WITH RECURSIVE numbers(n) AS (SELECT 3 UNION ALL SELECT n + 1 FROM numbers WHERE n < 510)
      INSERT INTO topo_changes (id, revision, request_id, actor, kind, summary, created_at)
      SELECT n, n, 'request-' || n, 'fixture', 'operations', '{}', 1 FROM numbers;
    `);
    const before = await request("/api/topology/changes?limit=500");
    expect(before.headers.get("ETag")).toBe('"topology-changes:510:1"');
    expect((await before.json() as { data: { nextCursor: number | null } }).data.nextCursor).not.toBeNull();
    await pruneTopologyHistoryStatement(database.db, 10_000_000).run();
    const after = await request("/api/topology/changes?limit=500", { headers: { "If-None-Match": '"topology-changes:510:1"' } });
    expect(after.status).toBe(200);
    expect(after.headers.get("ETag")).toBe('"topology-changes:510:11"');
    expect((await after.json() as { data: { nextCursor: number | null } }).data.nextCursor).toBeNull();
    expect((await request("/api/topology/changes", { headers: { "If-None-Match": '"topology-changes:510:11"' } })).status).toBe(304);
  });
});
