import { describe, expect, it } from "vitest";
import { topologySchema, type Topology } from "./topology";
import { applyTopologyOperations, diffTopology, revertTopologyChange, topologyOperationBatchSchema, TopologyOperationError } from "./topology-operations";

function fixture(): Topology {
  return topologySchema.parse({
    schemaVersion: 2,
    title: "Fixture",
    provenance: "manual",
    layers: [{ id: "layer", label: "Layer", provider: "Fixture", order: 0 }],
    types: [{ id: "host", label: "Host", shape: "rect", defaultLayerId: "layer" }],
    boundaries: [{ id: "site", label: "Site", kind: "site" }, { id: "child", label: "Child", kind: "trust", parentId: "site" }],
    nodes: [
      { id: "root", type: "host", label: "Root", layerId: "layer", boundaryIds: ["site"] },
      { id: "service", type: "host", label: "Service", layerId: "layer", parentId: "root", role: "service" },
      { id: "port", type: "host", label: "Port", layerId: "layer", parentId: "service", role: "subresource" },
      { id: "peer", type: "host", label: "Peer", layerId: "layer" },
    ],
    edges: [{ id: "edge", source: "port", target: "peer", kind: "traffic", direction: "uni", evidence: "documented" }],
    views: [{ id: "view", label: "View", filter: { layerIds: ["layer"], typeIds: ["host"], boundaryIds: ["site"] }, focusLayerId: "layer", pins: { root: { x: 1, y: 1 }, port: { x: 2, y: 2 } } }],
  });
}

function apply(topology: Topology, operations: unknown[]): Topology {
  return applyTopologyOperations(topology, topologyOperationBatchSchema.parse({ operations }).operations);
}

describe("topology operations", () => {
  it("parses strict bounded operations and applies each put with final validation", () => {
    const graph = fixture();
    const next = apply(graph, [
      { op: "set_metadata", title: "Changed", description: "Updated", provenance: null },
      { op: "put_layer", value: { ...graph.layers[0], label: "Updated" } },
      { op: "put_type", value: { ...graph.types[0], label: "Updated" } },
      { op: "put_boundary", value: { id: "office", label: "Office", kind: "site" } },
      { op: "put_node", value: { id: "new", type: "host", label: "New", layerId: "layer" } },
      { op: "put_edge", value: { id: "new-edge", source: "new", target: "peer", kind: "uses", direction: "uni", evidence: "inferred" } },
      { op: "put_view", value: { id: "new-view", label: "New view", filter: {} } },
    ]);
    expect(next.title).toBe("Changed");
    expect(next.description).toBe("Updated");
    expect(next.provenance).toBeUndefined();
    expect(next.layers[0].label).toBe("Updated");
    expect(next.types[0].label).toBe("Updated");
    expect(next.boundaries.some((item) => item.id === "office")).toBe(true);
    expect(next.nodes.some((item) => item.id === "new")).toBe(true);
    expect(next.edges.some((item) => item.id === "new-edge")).toBe(true);
    expect(next.views.some((item) => item.id === "new-view")).toBe(true);
    expect(graph.title).toBe("Fixture");
    expect(topologyOperationBatchSchema.safeParse({ operations: [] }).success).toBe(false);
    expect(topologyOperationBatchSchema.safeParse({ operations: [{ op: "remove_node", id: "root", extra: true }] }).success).toBe(false);
    expect(topologyOperationBatchSchema.safeParse({ operations: Array.from({ length: 1001 }, () => ({ op: "remove_edge", id: "none" })) }).success).toBe(false);
  });

  it("cascades the full satellite subtree, edges and pins without mutating input", () => {
    const graph = fixture();
    expect(() => apply(graph, [{ op: "remove_node", id: "root" }])).toThrowError(expect.objectContaining({ code: "node_has_satellites" }));
    const next = apply(graph, [{ op: "remove_node", id: "root", cascade: true }]);
    expect(next.nodes.map((node) => node.id)).toEqual(["peer"]);
    expect(next.edges).toEqual([]);
    expect(next.views[0].pins).toEqual({});
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(1);
  });

  it("reparents boundaries and clears memberships and view filters", () => {
    const next = apply(fixture(), [{ op: "remove_boundary", id: "site" }]);
    expect(next.boundaries).toHaveLength(1);
    expect(next.boundaries[0].parentId).toBeUndefined();
    expect(next.nodes[0].boundaryIds).toEqual([]);
    expect(next.views[0].filter.boundaryIds).toEqual([]);
    const nested = fixture();
    nested.boundaries.push({ id: "inner", label: "Inner", kind: "network", parentId: "child", description: "" });
    expect(apply(nested, [{ op: "remove_boundary", id: "child" }]).boundaries.find((item) => item.id === "inner")?.parentId).toBe("site");
  });

  it("blocks referenced layers and types and removes unused entities", () => {
    const graph = fixture();
    expect(() => apply(graph, [{ op: "remove_layer", id: "layer" }])).toThrowError(expect.objectContaining({ code: "layer_in_use" }));
    expect(() => apply(graph, [{ op: "remove_type", id: "host" }])).toThrowError(expect.objectContaining({ code: "type_in_use" }));
    const next = apply(graph, [
      { op: "remove_edge", id: "edge" }, { op: "remove_view", id: "view" },
      { op: "remove_node", id: "root", cascade: true }, { op: "remove_node", id: "peer" },
      { op: "remove_type", id: "host" }, { op: "remove_layer", id: "layer" },
      { op: "remove_boundary", id: "missing" }, { op: "remove_edge", id: "missing" },
    ]);
    expect(next.nodes).toEqual([]);
    expect(next.layers).toEqual([]);
    expect(next.types).toEqual([]);
    expect(next.edges).toEqual([]);
    expect(next.views).toEqual([]);
  });

  it("validates only the complete result and rejects invalid batches atomically", () => {
    const graph = fixture();
    const updated = apply(graph, [
      { op: "put_node", value: { id: "added", type: "new-type", label: "Added", layerId: "layer" } },
      { op: "put_type", value: { id: "new-type", label: "New", shape: "rect" } },
    ]);
    expect(updated.nodes.some((node) => node.id === "added")).toBe(true);
    expect(() => apply(graph, [{ op: "set_metadata", title: "" }])).toThrowError(expect.objectContaining({ code: "invalid_topology" }));
    try {
      apply(graph, [{ op: "set_metadata", title: "" }]);
    } catch (error) {
      expect(error).toBeInstanceOf(TopologyOperationError);
      expect((error as TopologyOperationError).issues.length).toBeGreaterThan(0);
    }
    expect(graph.title).toBe("Fixture");
  });

  it("keeps forward references when an absent target is removed", () => {
    const graph = fixture();
    const next = apply(graph, [
      { op: "put_edge", value: { id: "forward", source: "future", target: "peer", kind: "uses", direction: "uni", evidence: "documented" } },
      { op: "put_node", value: { id: "child-node", type: "future-type", label: "Child", layerId: "future-layer", parentId: "future", role: "service" } },
      { op: "remove_node", id: "future", cascade: true },
      { op: "remove_layer", id: "future-layer" }, { op: "remove_type", id: "future-type" },
      { op: "put_layer", value: { id: "future-layer", label: "Future", provider: "Fixture", order: 2 } },
      { op: "put_type", value: { id: "future-type", label: "Future", shape: "rect" } },
      { op: "put_node", value: { id: "future", type: "future-type", label: "Future", layerId: "future-layer" } },
    ]);
    expect(next.edges.some((edge) => edge.id === "forward")).toBe(true);
    expect(next.nodes.some((node) => node.id === "child-node")).toBe(true);
  });

  it("diffs canonical entity images and reverses a cascade and metadata change", () => {
    const before = fixture();
    const after = apply(before, [
      { op: "set_metadata", title: "Changed", provenance: null },
      { op: "remove_node", id: "root", cascade: true },
    ]);
    const changes = diffTopology(before, after);
    expect(changes.some((item) => item.collection === "metadata")).toBe(true);
    expect(changes.filter((item) => item.collection === "nodes")).toHaveLength(3);
    expect(changes.some((item) => item.collection === "edges")).toBe(true);
    expect(changes.some((item) => item.collection === "views")).toBe(true);
    const restored = revertTopologyChange(after, changes, [{ collection: "nodes", id: "unrelated" }]);
    expect(diffTopology(before, restored)).toEqual([]);
    expect(restored.provenance).toBe("manual");
    expect(after.title).toBe("Changed");

    const reordered = structuredClone(before);
    reordered.nodes[0].attrs = { b: 2, a: 1 };
    const reorderedAgain = structuredClone(reordered);
    reorderedAgain.nodes[0].attrs = { a: 1, b: 2 };
    expect(diffTopology(reordered, reorderedAgain)).toEqual([]);
    reorderedAgain.nodes[0].attrs.c = 3;
    expect(diffTopology(reordered, reorderedAgain)).toHaveLength(1);
  });

  it("rejects revert conflicts and validates the restored graph", () => {
    const before = fixture();
    const after = apply(before, [{ op: "put_node", value: { id: "added", type: "host", label: "Added", layerId: "layer" } }]);
    const changes = diffTopology(before, after);
    expect(changes[0]).toMatchObject({ collection: "nodes", id: "added", before: null });
    expect(() => revertTopologyChange(after, changes, [{ collection: "nodes", id: "added" }])).toThrowError(expect.objectContaining({ code: "revert_conflict" }));
    const withLaterEdge = apply(after, [{ op: "put_edge", value: { id: "later", source: "added", target: "peer", kind: "uses", direction: "uni", evidence: "documented" } }]);
    expect(() => revertTopologyChange(withLaterEdge, changes, [{ collection: "edges", id: "later" }])).toThrowError(expect.objectContaining({ code: "invalid_topology" }));
    expect(diffTopology(before, revertTopologyChange(after, changes, []))).toEqual([]);
    expect(after.nodes.some((node) => node.id === "added")).toBe(true);
  });

  it("reports semantic issues at the request position of the operation that wrote them", () => {
    const issuesOf = (operations: unknown[]) => {
      try { apply(fixture(), operations); } catch (error) { return (error as TopologyOperationError).issues; }
      throw new Error("operations were accepted");
    };
    const secret = btoa(String.fromCharCode(...Array.from({ length: 36 }, (_, index) => (index * 97 + 13) % 256)));
    const late = { id: "late", type: "host", label: "Late", layerId: "layer" };
    expect(issuesOf([{ op: "set_metadata", title: "Renamed" }, { op: "put_node", value: { ...late, layerId: "missing" } }]))
      .toEqual([expect.objectContaining({ path: ["operations", 1, "value", "layerId"] })]);
    // The last write of an entity owns its issues.
    expect(issuesOf([{ op: "put_node", value: late }, { op: "put_node", value: { ...late, layerId: "missing" } }]))
      .toEqual([expect.objectContaining({ path: ["operations", 1, "value", "layerId"] })]);
    expect(issuesOf([{ op: "put_node", value: { ...late, attrs: { note: secret } } }]))
      .toEqual([expect.objectContaining({ path: ["operations", 0, "value", "attrs", "note"], code: "secret_like_value" })]);
    expect(issuesOf([{ op: "set_metadata", description: secret }]))
      .toEqual([expect.objectContaining({ path: ["operations", 0, "description"], code: "secret_like_value" })]);
    // A type change that invalidates nodes the batch did not write keeps their graph paths.
    const required = { key: "region", label: "Region", valueType: "string", badge: false, order: 0, required: true };
    const issues = issuesOf([{ op: "put_type", value: { ...fixture().types[0], attrs: [required] } }]);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.path[0] === "nodes" && issue.code === "required_attr_missing")).toBe(true);
  });
});
