import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { matchTopologyConnectOperation, topologySchema } from "@steed/api/shared";
import { testDatabase } from "./__tests__/db";
import { HttpError } from "./http";
import { topologyConnectRead } from "./topology-connect-read";
import { loadTopology } from "./topology-store";
import { topologyWriteStatements } from "./topology-write";

let database: ReturnType<typeof testDatabase>;
beforeEach(async () => {
  database = testDatabase();
  let before = (await loadTopology(database.db)).topology;
  const graph = topologySchema.parse({ schemaVersion: 2, title: "Fixture",
    layers: [{ id: "cloud", label: "Cloud", provider: "Fixture", order: 0 }],
    types: [{ id: "host", label: "Host", shape: "rect", attrs: [] }],
    nodes: [{ id: "a", label: "A", type: "host", layerId: "cloud" }, { id: "b", label: "B", type: "host", layerId: "cloud" }],
  });
  for (let revision = 0; revision < 2; revision++) {
    const write = topologyWriteStatements(database.db, { before, after: graph, revision, requestId: `request-${revision}`, actor: "fixture", tokenId: null,
      provenance: null, kind: "replace", revertsChangeId: null, updatedAt: "2026-01-01T00:00:00.000Z", createdAt: revision, guard: { clause: "1", values: [] } });
    await database.db.batch(write.statements);
    before = (await loadTopology(database.db)).topology;
  }
});
afterEach(() => database.close());

async function read(path: string, init?: RequestInit) {
  const request = new Request(`https://fixture.example/api/v1${path}`, init);
  const route = matchTopologyConnectOperation(new URL(request.url).pathname, request.method);
  if (!route) throw new Error("Missing fixture route");
  return topologyConnectRead(request, database.db, route.operation, route.params, "fixture-request");
}

describe("topology Connect reads", () => {
  it("returns snapshots, deltas and conditional HEAD reads", async () => {
    const snapshot = await read("/topology");
    expect(await snapshot?.json()).toMatchObject({ data: { revision: 2, nodes: [{ id: "a" }, { id: "b" }] }, requestId: "fixture-request" });
    expect(snapshot?.headers.get("ETag")).toBe('"topology:2"');
    expect((await read("/topology", { method: "HEAD" }))?.status).toBe(200);
    expect((await read("/topology", { headers: { "If-None-Match": '"topology:2"' } }))?.status).toBe(304);
    expect(await (await read("/topology?since=2"))?.json()).toMatchObject({ data: { since: 2, revision: 2 } });
  });

  it("returns 410 for stale and future since and 400 for malformed since before conditional handling", async () => {
    for (const since of ["0", "3"]) {
      const result = await read(`/topology?since=${since}`, { headers: { "If-None-Match": '"topology:2"' } });
      expect(result?.status).toBe(410);
      expect(await result?.json()).toMatchObject({ error: { code: "resync_required" }, current_revision: 2, oldest_retained_revision: 1 });
    }
    const invalid = await read("/topology?since=bad", { headers: { "If-None-Match": '"topology:2"' } });
    expect(invalid?.status).toBe(400);
    expect(await invalid?.json()).toMatchObject({ error: { code: "invalid_since" } });
  });

  it("paginates collections, filters and returns entities or 404 before ETag checks", async () => {
    const first = await read("/topology/nodes?limit=1&layer=cloud");
    expect(await first?.json()).toMatchObject({ data: [{ id: "a" }], nextCursor: "a" });
    expect(await (await read("/topology/nodes?limit=1&cursor=a"))?.json()).toMatchObject({ data: [{ id: "b" }], nextCursor: null });
    expect(await (await read("/topology/nodes/a"))?.json()).toMatchObject({ data: { id: "a" } });
    expect((await read("/topology/nodes/a", { headers: { "If-None-Match": '"topology:2"' } }))?.status).toBe(304);
    await expect(read("/topology/nodes/missing", { headers: { "If-None-Match": '"topology:2"' } })).rejects.toMatchObject({ status: 404 });
    await expect(read("/topology/nodes/INVALID")).rejects.toMatchObject({ status: 400 });
  });

  it("serves history summaries and images with distinct paging ETags", async () => {
    const page = await read("/topology/changes?limit=1");
    expect(page?.headers.get("ETag")).toBe('"topology-changes:2:1"');
    expect(await page?.json()).toMatchObject({ data: [{ id: 2 }], nextCursor: 2 });
    expect((await read("/topology/changes", { headers: { "If-None-Match": '"topology-changes:2:1"' } }))?.status).toBe(304);
    const detail = await read("/topology/changes/1");
    expect(detail?.headers.get("ETag")).toBe('"topology:2"');
    expect(await detail?.json()).toMatchObject({ data: { id: 1, items: expect.any(Array) } });
    await expect(read("/topology/changes/99")).rejects.toMatchObject({ status: 404 });
    await expect(read("/topology/changes/nope")).rejects.toBeInstanceOf(HttpError);
    const stale = await read("/topology/changes?since=0");
    expect(stale?.status).toBe(410);
  });

  it("leaves non-read operations for the caller", async () => {
    expect(await read("/topology", { method: "PUT" })).toBeNull();
  });
});
