import { describe, expect, it } from "vitest";
import { diagramSchema } from "./diagram";
import { CONNECT_OPERATIONS, applyDiagramOperations, matchConnectOperation, operationBatchSchema, tokenInputSchema } from "./connect";
import example from "../../../../examples/service-platform.json";

const sample = () => diagramSchema.parse(example);
describe("Connect graph operations and contract", () => {
  it("reparents nested contents when removing a boundary and preserves coordinates", () => {
    const graph = sample();
    const next = applyDiagramOperations(graph, [{ op: "remove_group", id: "cloud" }]);
    expect(next.groups.find((group) => group.id === "compute")?.parentId).toBeUndefined();
    const removedChild = applyDiagramOperations(graph, [{ op: "remove_group", id: "compute" }]);
    expect(removedChild.nodes.find((node) => node.id === "api")?.groupId).toBe("cloud");
    expect(removedChild.nodes[1]?.position).toEqual(graph.nodes[1]?.position);
    expect(graph.groups).toHaveLength(4);
    expect(applyDiagramOperations(graph, [{ op: "remove_group", id: "absent" }])).toEqual(graph);
  });

  it("supports replacements and removals of every entity type with final reference validation", () => {
    const graph = sample();
    const operations = operationBatchSchema.parse({ operations: [
      { op: "put_node", value: { ...graph.nodes[1], label: "Edited" } },
      { op: "put_edge", value: { ...graph.edges[0], label: "TLS" } },
      { op: "put_group", value: { ...graph.groups[0], label: "Renamed" } },
      { op: "put_view", value: { ...graph.views[0], label: "Renamed view" } },
      { op: "set_metadata", title: "Updated" },
      { op: "remove_edge", id: "query" },
      { op: "remove_view", id: "storage" },
    ] }).operations;
    const next = applyDiagramOperations(graph, operations);
    expect(next.nodes[1]?.label).toBe("Edited"); expect(next.edges[0]?.label).toBe("TLS");
    expect(next.groups[0]?.label).toBe("Renamed"); expect(next.views).toHaveLength(1); expect(next.title).toBe("Updated");
    expect(next.description).toBe(graph.description);
    expect(applyDiagramOperations(graph, [{ op: "set_metadata", description: "Updated notes" }]).title).toBe(graph.title);
    expect(() => applyDiagramOperations(graph, operationBatchSchema.parse({ operations: [{ op: "put_edge", value: { id: "bad", source: "unknown", target: "api" } }] }).operations)).toThrow();
    expect(graph.edges).toHaveLength(6);
  });

  it("rejects arbitrary dispatch, empty and oversized operation batches", () => {
    for (const body of [{ operations: [] }, { operations: [{ op: "execute", command: "unsafe" }] }, { operations: Array.from({ length: 101 }, () => ({ op: "remove_node", id: "api" })) }]) {
      expect(operationBatchSchema.safeParse(body).success).toBe(false);
    }
    expect(tokenInputSchema.parse({ name: " agent ", scope: "read" })).toEqual({ name: "agent", scope: "read", diagramId: null, expiresAt: null });
    expect(tokenInputSchema.safeParse({ name: "bad\nname", scope: "read" }).success).toBe(false);
  });

  it("matches exactly the published routes, including HEAD, with no arbitrary path expansion", () => {
    expect(new Set(CONNECT_OPERATIONS.map((operation) => operation.id)).size).toBe(CONNECT_OPERATIONS.length);
    for (const operation of CONNECT_OPERATIONS) {
      const path = `/api/v1${operation.path.replaceAll("{diagramId}", "example").replaceAll("{entityId}", "node").replaceAll("{key}", "intent-0001")}`;
      expect(matchConnectOperation(path, operation.method)?.operation.id).toBe(operation.id);
      if (operation.method === "GET") expect(matchConnectOperation(path, "HEAD")?.operation.id).toBe(operation.id);
      expect(matchConnectOperation(`${path}/extra`, operation.method)?.operation.id).not.toBe(operation.id);
    }
    expect(matchConnectOperation("/api/v1/openapiXjson", "GET")).toBeNull();
    expect(matchConnectOperation("/api/v1/hosts", "GET")).toBeNull();
    expect(matchConnectOperation("/api/v1/diagrams/x", "PATCH")).toBeNull();
  });
});
