import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TOPOLOGY_COLLECTIONS, topologySchema, type Topology } from "@steed/api/shared";
import { testDatabase } from "./__tests__/db";
import { TopologyResyncRequired } from "./topology-history";
import { loadTopology, loadTopologyDelta } from "./topology-store";
import { topologyWriteStatements } from "./topology-write";

let database: ReturnType<typeof testDatabase>;
beforeEach(() => { database = testDatabase(); });
afterEach(() => database.close());

async function write(before: Topology, after: Topology, revision: number) {
  const { statements } = topologyWriteStatements(database.db, {
    before, after, revision, requestId: `request-${revision}`, actor: "fixture", tokenId: null, provenance: null,
    kind: "operations", revertsChangeId: null, updatedAt: "2026-01-01T00:00:00.000Z", createdAt: revision,
    guard: { clause: "1", values: [] },
  });
  await database.db.batch(statements);
  return (await loadTopology(database.db)).topology;
}

describe("topology deltas", () => {
  it("reports deletions in all collections", async () => {
    let before = (await loadTopology(database.db)).topology;
    const graph = topologySchema.parse({
      schemaVersion: 2, title: "Fixture",
      layers: [{ id: "cloud", label: "Cloud", provider: "Fixture", order: 0 }],
      types: [{ id: "host", label: "Host", shape: "rect" }],
      boundaries: [{ id: "site", label: "Site", kind: "site" }],
      nodes: [{ id: "alpha", label: "Alpha", type: "host", layerId: "cloud", boundaryIds: ["site"] }, { id: "beta", label: "Beta", type: "host", layerId: "cloud" }],
      edges: [{ id: "link", source: "alpha", target: "beta", kind: "uses", direction: "uni", evidence: "documented" }],
      views: [{ id: "view", label: "View", filter: {}, pins: {} }],
    });
    before = await write(before, graph, 0);
    const cleared = { ...before, layers: [], types: [], boundaries: [], nodes: [], edges: [], views: [] };
    await write(before, cleared, 1);
    const delta = await loadTopologyDelta(database.db, 1);
    expect(delta.deleted).toEqual({ layers: ["cloud"], types: ["host"], boundaries: ["site"], nodes: ["alpha", "beta"], edges: ["link"], views: ["view"] });
    expect(Object.values(delta.changed).every((items) => items.length === 0)).toBe(true);
  });

  it("returns changed entities and only the latest deletion for each ID", async () => {
    let before = (await loadTopology(database.db)).topology;
    const graph = topologySchema.parse({
      schemaVersion: 2, title: "Fixture", provenance: "manual",
      layers: [{ id: "cloud", label: "Cloud", provider: "Fixture", order: 0 }],
      types: [{ id: "host", label: "Host", shape: "rect" }],
      nodes: [{ id: "alpha", label: "Alpha", type: "host", layerId: "cloud" }, { id: "beta", label: "Beta", type: "host", layerId: "cloud" }],
    });
    before = await write(before, graph, 0);
    const second = structuredClone(before);
    second.nodes = second.nodes.filter((node) => node.id !== "alpha");
    second.nodes[0]!.label = "Updated beta";
    second.nodes.push({ ...second.nodes[0]!, id: "gamma", label: "Gamma" });
    before = await write(before, second, 1);
    const third = structuredClone(before);
    third.nodes = third.nodes.filter((node) => node.id !== "gamma");
    third.nodes.push({ ...third.nodes[0]!, id: "alpha", label: "Restored alpha" });
    third.title = "Updated fixture";
    delete third.provenance;
    before = await write(before, third, 2);

    const originalBatch = database.db.batch.bind(database.db);
    let count = 0;
    database.db.batch = async (statements) => { count = statements.length; return originalBatch(statements); };
    const sinceOne = await loadTopologyDelta(database.db, 1);
    expect(count).toBe(10);
    expect(sinceOne).toMatchObject({ since: 1, revision: 3, metadata: { schemaVersion: 2, title: "Updated fixture", description: "" } });
    expect(sinceOne.metadata).not.toHaveProperty("provenance");
    expect(sinceOne.changed.nodes.map((node) => node.id)).toEqual(["alpha", "beta"]);
    expect(sinceOne.deleted.nodes).toEqual(["gamma"]);
    expect(sinceOne.deleted.nodes).not.toContain("alpha");
    const sinceTwo = await loadTopologyDelta(database.db, 2);
    expect(sinceTwo.changed.nodes.map((node) => node.id)).toEqual(["alpha"]);
    expect(sinceTwo.deleted.nodes).toEqual(["gamma"]);
    const current = await loadTopologyDelta(database.db, 3);
    expect(current).not.toHaveProperty("metadata");
    expect(Object.values(current.changed).every((items) => items.length === 0)).toBe(true);
    expect(Object.values(current.deleted).every((items) => items.length === 0)).toBe(true);

    // Revision 1 is the oldest retained change, so the delta from 0 is complete: every live entity.
    const sinceZero = await loadTopologyDelta(database.db, 0);
    const snapshot = await loadTopology(database.db);
    expect(sinceZero.changed).toEqual(Object.fromEntries(TOPOLOGY_COLLECTIONS.map((collection) => [collection, snapshot.topology[collection]])));
    expect(sinceZero.metadata).toMatchObject({ title: "Updated fixture" });
    await expect(loadTopologyDelta(database.db, 4)).rejects.toMatchObject({ currentRevision: 3, oldestRetainedRevision: 1 });
    database.db.batch = originalBatch;
    before = await write(before, before, 3);
    const unchangedWrite = await loadTopologyDelta(database.db, 3);
    expect(unchangedWrite.metadata).toMatchObject({ title: "Updated fixture" });
    expect(Object.values(unchangedWrite.changed).every((items) => items.length === 0)).toBe(true);
    expect(Object.values(unchangedWrite.deleted).every((items) => items.length === 0)).toBe(true);
    expect(before.revision).toBe(4);
    database.sqlite.exec("DELETE FROM topo_changes WHERE revision = 1");
    expect((await loadTopologyDelta(database.db, 1)).revision).toBe(4);
    await expect(loadTopologyDelta(database.db, 0)).rejects.toBeInstanceOf(TopologyResyncRequired);
  });
});
