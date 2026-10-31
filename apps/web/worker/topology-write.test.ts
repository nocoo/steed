import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { topologySchema, type Topology } from "@steed/api/shared";
import { testDatabase } from "./__tests__/db";
import { loadTopology } from "./topology-store";
import { chunkTopologyRows, splitTopologyJson, topologyWriteStatements, type TopologyWrite } from "./topology-write";

let database: ReturnType<typeof testDatabase>;
beforeEach(() => { database = testDatabase(); });
afterEach(() => database.close());

function fixture(): Topology {
  return topologySchema.parse({
    schemaVersion: 2, title: "Fixture", provenance: "manual",
    layers: [{ id: "alpha", label: "Alpha", provider: "Fixture", order: 0 }, { id: "beta", label: "Beta", provider: "Fixture", order: 1 }],
    types: [{ id: "host", label: "Host", shape: "rect", defaultLayerId: "alpha", provenance: "manual" }],
    boundaries: [{ id: "site", label: "Site", kind: "site", provenance: "manual" }, { id: "trust", label: "Trust", kind: "trust", parentId: "site" }],
    nodes: [
      { id: "root", type: "host", label: "Root", layerId: "alpha", boundaryIds: ["trust", "site"], attrs: { enabled: false }, style: { shape: "rect" }, provenance: "manual" },
      { id: "child", type: "host", label: "Child", layerId: "alpha", parentId: "root", role: "service" },
      { id: "peer", type: "host", label: "Peer", layerId: "beta" },
    ],
    edges: [{ id: "edge", source: "child", target: "peer", kind: "uses", direction: "uni", evidence: "documented", style: { animated: false }, provenance: "manual" }],
    views: [{ id: "view", label: "View", filter: {}, pins: { root: { x: 0, y: 1 } }, focusLayerId: "alpha", provenance: "manual" }],
  });
}

function write(before: Topology, after: Topology, revision: number, overrides: Partial<TopologyWrite> = {}) {
  return topologyWriteStatements(database.db, {
    before, after, revision, requestId: `request-${revision}`, actor: "fixture", tokenId: "fixture-token", provenance: "manual",
    kind: "operations", revertsChangeId: null, updatedAt: "2026-01-01T00:00:00.000Z", createdAt: 1,
    guard: { clause: "1", values: [] }, ...overrides,
  });
}

describe("topology write statements", () => {
  it("writes every collection and history in a single batch", async () => {
    const before = (await loadTopology(database.db)).topology;
    const after = fixture();
    const result = write(before, after, 0);
    expect((await database.db.batch(result.statements))[1]?.meta.changes).toBe(1);
    const snapshot = (await loadTopology(database.db)).topology;
    expect(snapshot.revision).toBe(1);
    expect(snapshot.provenance).toBe("manual");
    expect(snapshot.nodes.find((node) => node.id === "root")?.boundaryIds).toEqual(["site", "trust"]);
    expect(snapshot.nodes.find((node) => node.id === "root")?.attrs).toEqual({ enabled: false });
    expect(snapshot.edges[0]).toMatchObject({ source: "child", target: "peer", style: { animated: false }, provenance: "manual" });
    expect(database.sqlite.prepare("SELECT revision, actor, provenance, kind FROM topo_changes").get()).toMatchObject({ revision: 1, actor: "fixture", provenance: "manual", kind: "operations" });
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM topo_change_items").get()?.n).toBe(result.items.length);
    expect(JSON.parse(String(database.sqlite.prepare(`SELECT image_json FROM topo_change_images JOIN topo_change_items USING (change_id, seq)
      WHERE collection = 'nodes' AND entity_id = 'root' AND side = 'after'`).get()?.image_json))).toMatchObject({ id: "root", provenance: "manual" });
  });

  it("swaps layer orders and reparents references while removing their old parents", async () => {
    const empty = (await loadTopology(database.db)).topology;
    await database.db.batch(write(empty, fixture(), 0).statements);
    const before = (await loadTopology(database.db)).topology;
    const swapped = structuredClone(before);
    swapped.layers.find((layer) => layer.id === "alpha")!.order = 1;
    swapped.layers.find((layer) => layer.id === "beta")!.order = 0;
    await database.db.batch(write(before, swapped, 1).statements);
    const next = (await loadTopology(database.db)).topology;
    const reduced = structuredClone(next);
    reduced.layers = reduced.layers.filter((layer) => layer.id !== "alpha");
    reduced.types[0]!.defaultLayerId = "beta";
    reduced.nodes = reduced.nodes.filter((node) => node.id !== "root");
    const child = reduced.nodes.find((node) => node.id === "child")!;
    child.layerId = "beta";
    delete child.parentId;
    delete child.role;
    reduced.boundaries = reduced.boundaries.filter((boundary) => boundary.id !== "site");
    delete reduced.boundaries[0]!.parentId;
    reduced.views[0]!.focusLayerId = "beta";
    reduced.views[0]!.pins = {};
    await database.db.batch(write(next, reduced, 2).statements);
    const saved = (await loadTopology(database.db)).topology;
    expect(saved.layers.map((layer) => layer.id)).toEqual(["beta"]);
    expect(saved.nodes.find((node) => node.id === "child")).toMatchObject({ layerId: "beta" });
    expect(saved.boundaries[0]?.parentId).toBeUndefined();
    expect(saved.edges[0]?.source).toBe("child");
  });

  it("does nothing after a lost revision race or failed external guard", async () => {
    const before = (await loadTopology(database.db)).topology;
    const first = write(before, fixture(), 0);
    const stale = write(before, fixture(), 0, { requestId: "lost-race" });
    await database.db.batch(first.statements);
    const saved = await loadTopology(database.db);
    expect((await database.db.batch(stale.statements))[1]?.meta.changes).toBe(0);
    const blocked = write(saved.topology, saved.topology, 1, { requestId: "blocked", guard: { clause: "? = 1", values: [0] } });
    expect((await database.db.batch(blocked.statements))[1]?.meta.changes).toBe(0);
    const repeated = write(before, fixture(), 0, { requestId: "request-0" });
    expect((await database.db.batch(repeated.statements))[1]?.meta.changes).toBe(0);
    expect(await loadTopology(database.db)).toEqual(saved);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM topo_changes").get()?.n).toBe(1);
  });

  it("records an unchanged replacement and rolls the entire batch back on failure", async () => {
    const before = (await loadTopology(database.db)).topology;
    const unchanged = write(before, before, 0, { kind: "replace" });
    expect(unchanged.items).toEqual([]);
    await database.db.batch(unchanged.statements);
    expect((await loadTopology(database.db)).topology.revision).toBe(1);
    const current = (await loadTopology(database.db)).topology;
    const change = write(current, fixture(), 1);
    change.statements.push(database.db.prepare("INSERT INTO missing_table VALUES (1)"));
    await expect(database.db.batch(change.statements)).rejects.toThrow();
    expect((await loadTopology(database.db)).topology).toEqual(current);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM topo_changes").get()?.n).toBe(1);
  });

  it("chunks UTF-8 data below the bound-string limit without splitting rows", async () => {
    const text = String.fromCodePoint(0x6c34).repeat(1000);
    const chunks = chunkTopologyRows(Array.from({ length: 400 }, (_, id) => ({ id, text })));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((json) => new TextEncoder().encode(json).byteLength <= 900_000)).toBe(true);
    expect(chunks.flatMap((json) => JSON.parse(json) as unknown[])).toHaveLength(400);
    expect(chunkTopologyRows([])).toEqual([]);
    const longJson = chunkTopologyRows([String.fromCodePoint(0x1f30a).repeat(300_000)])[0]!;
    const parts = splitTopologyJson(longJson);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => new TextEncoder().encode(part).byteLength <= 900_000)).toBe(true);
    expect(parts.join("")).toBe(longJson);
    expect(parts.map((part) => new TextDecoder().decode(new TextEncoder().encode(part))).join("")).toBe(longJson);

    const before = (await loadTopology(database.db)).topology;
    const graph = fixture();
    graph.edges = Array.from({ length: 400 }, (_, index) => ({ ...graph.edges[0]!, id: `edge-${index}`, description: text }));
    const batch = write(before, graph, 0);
    await database.db.batch(batch.statements);
    expect((await loadTopology(database.db)).topology.edges).toHaveLength(400);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM topo_change_items WHERE collection = 'edges'").get()?.n).toBe(400);
  });

  it("normalizes unordered memberships before diffing and recording images", async () => {
    const empty = (await loadTopology(database.db)).topology;
    const graph = fixture();
    await database.db.batch(write(empty, graph, 0).statements);
    const before = (await loadTopology(database.db)).topology;
    const unchanged = write(before, graph, 1);
    expect(unchanged.items).toEqual([]);
    await database.db.batch(unchanged.statements);
    expect(database.sqlite.prepare("SELECT updated_rev FROM topo_nodes WHERE id = 'root'").get()?.updated_rev).toBe(1);
    const image = JSON.parse(String(database.sqlite.prepare(`SELECT image_json FROM topo_change_images JOIN topo_change_items USING (change_id, seq)
      WHERE collection = 'nodes' AND entity_id = 'root' AND side = 'after'`).get()?.image_json));
    expect(image.boundaryIds).toEqual(["site", "trust"]);
  });

  it("records large valid before and after images without exceeding a binding limit", async () => {
    const empty = (await loadTopology(database.db)).topology;
    const graph = fixture();
    graph.types[0]!.attrs = Array.from({ length: 32 }, (_, index) => ({
      key: `attr_${index}`, label: `Attribute ${index}`, valueType: "enum", badge: false, order: index,
      required: false, enumValues: Array.from({ length: 64 }, (_, value) => String.fromCodePoint(0x6c34).repeat(250) + String(value).padStart(6, "0")),
    }));
    await database.db.batch(write(empty, graph, 0).statements);
    const before = (await loadTopology(database.db)).topology;
    const changed = structuredClone(before);
    changed.types[0]!.label = "Changed host";
    await database.db.batch(write(before, changed, 1).statements);
    const rows = database.sqlite.prepare(`SELECT side, image_json FROM topo_change_images JOIN topo_change_items USING (change_id, seq)
      WHERE change_id = 2 AND collection = 'types' ORDER BY side`).all();
    expect(rows).toHaveLength(2);
    expect(JSON.parse(String(rows[0]?.image_json)).label).toBe("Changed host");
    expect(JSON.parse(String(rows[1]?.image_json)).label).toBe("Host");
    expect(rows.every((row) => new TextEncoder().encode(String(row.image_json)).byteLength < 2_000_000)).toBe(true);
    database.sqlite.exec("DELETE FROM topo_changes WHERE revision = 2");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM topo_change_images WHERE change_id = 2").get()?.n).toBe(0);
  });
});
