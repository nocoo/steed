import { describe, expect, it } from "vitest";
import { emptyTopology, topologySchema, TOPOLOGY_CONNECT_OPERATIONS, type TopologyConnectOperation } from "@steed/api/shared";
import { planTopologyConnectMutation } from "./topology-connect-mutation";

const before = topologySchema.parse({ ...emptyTopology("Fixture"), revision: 3,
  layers: [{ id: "cloud", label: "Cloud", provider: "Fixture", order: 0 }],
  types: [{ id: "host", label: "Host", shape: "rect" }],
  nodes: [{ id: "root", label: "Root", type: "host", layerId: "cloud" }],
});
const operation = (id: string) => TOPOLOGY_CONNECT_OPERATIONS.find((item) => item.id === id) as TopologyConnectOperation;
const call = (id: string, input: unknown, entityId = "root") => planTopologyConnectMutation(before, operation(id), { entityId }, input);

describe("topology Connect mutation planning", () => {
  it("plans a replacement, a batch and both dry-run forms", () => {
    expect(call("topology.put", { ...before, title: "Replacement", revision: 55 }).after).toMatchObject({ title: "Replacement", revision: 3 });
    const batch = { operations: [{ op: "set_metadata", title: "Batch" }] };
    expect(call("topology.operations", batch).after.title).toBe("Batch");
    expect(call("topology.validate", batch).after.title).toBe("Batch");
    expect(call("topology.validate", before).changed.metadata).toBe(0);
  });

  it("plans entity upserts and dangerous deletes for every collection", () => {
    const additions = {
      layers: { id: "new", label: "New", provider: "Fixture", order: 1 },
      types: { id: "new", label: "New", shape: "rect" },
      boundaries: { id: "new", label: "New", kind: "site" },
      nodes: { id: "new", label: "New", type: "host", layerId: "cloud" },
      edges: { id: "new", source: "root", target: "peer", kind: "uses", label: "Link", direction: "uni", evidence: "documented" },
      views: { id: "new", label: "New", filter: {} },
    };
    const graph = topologySchema.parse({ ...before, nodes: [...before.nodes, { id: "peer", label: "Peer", type: "host", layerId: "cloud" }] });
    for (const [collection, value] of Object.entries(additions)) {
      const add = planTopologyConnectMutation(graph, operation(`${collection}.put`), { entityId: "new" }, value);
      expect(add.changed[collection]).toBe(1);
      const remove = planTopologyConnectMutation(add.after, operation(`${collection}.delete`), { entityId: "new" }, null);
      expect(remove.dangerous).toBe(true);
      expect(remove.changed[collection]).toBe(1);
    }
  });

  it("rejects malformed, mismatched and missing entities without echoing input", () => {
    expect(() => call("nodes.put", { id: "different", label: "X", type: "host", layerId: "cloud" })).toThrow(expect.objectContaining({ status: 422, code: "id_mismatch" }));
    expect(() => call("nodes.delete", null, "missing")).toThrow(expect.objectContaining({ status: 404, code: "not_found" }));
    expect(() => call("nodes.delete", null, "BAD")).toThrow(expect.objectContaining({ status: 400, code: "invalid_id" }));
    for (const [id, input, path] of [
      ["topology.operations", { operations: [{ op: "not-valid", value: "private-value" }] }, ["operations", 0, "op"]],
      ["nodes.put", { id: "root", label: "private-value", type: "host", layerId: "cloud", invalid: "private-value" }, []],
    ] as const) {
      try { call(id, input); expect.fail("accepted malformed input"); }
      catch (error) {
        expect(error).toMatchObject({ code: "invalid_topology", issues: [{ path, code: "invalid_topology", message: "Invalid topology structure." }] });
        expect(JSON.stringify(error)).not.toContain("private-value");
      }
    }
    expect(() => call("layers.list", null)).toThrow("Not a topology mutation operation.");
  });

  it("preserves redacted secret-rule issues for entity and batch writes", () => {
    const secret = `steedc_${"A".repeat(43)}`;
    for (const [id, input] of [
      ["nodes.put", { id: "root", label: secret, type: "host", layerId: "cloud" }],
      ["topology.operations", { operations: [{ op: "set_metadata", description: secret }] }],
    ] as const) {
      try { call(id, input); expect.fail("accepted secret-like value"); }
      catch (error) {
        expect(error).toMatchObject({ code: "invalid_topology", issues: expect.arrayContaining([expect.objectContaining({ code: "secret_like_value", rule: expect.any(String) })]) });
        expect(JSON.stringify(error)).not.toContain(secret);
      }
    }
  });
});
