import { describe, expect, it } from "vitest";
import { TOPOLOGY_COLLECTIONS } from "./topology-operations";
import { matchTopologyConnectOperation, TOPOLOGY_CONNECT_OPERATIONS } from "./topology-connect-operations";

describe("topology Connect operation registry", () => {
  it("maps every registered path and method to exactly its operation", () => {
    expect(new Set(TOPOLOGY_CONNECT_OPERATIONS.map((operation) => operation.id)).size).toBe(TOPOLOGY_CONNECT_OPERATIONS.length);
    for (const operation of TOPOLOGY_CONNECT_OPERATIONS) {
      const path = `/api/v1${operation.path.replace(/\{\w+\}/g, "fixture")}`;
      expect(matchTopologyConnectOperation(path, operation.method)?.operation.id).toBe(operation.id);
      if (operation.method === "GET") expect(matchTopologyConnectOperation(path, "HEAD")?.operation.id).toBe(operation.id);
    }
  });

  it("registers each collection's four operations and correct authorization metadata", () => {
    for (const collection of TOPOLOGY_COLLECTIONS) {
      const operations = TOPOLOGY_CONNECT_OPERATIONS.filter((operation) => operation.collection === collection);
      expect(operations.map((operation) => operation.method)).toEqual(["GET", "GET", "PUT", "DELETE"]);
      expect(operations.map((operation) => operation.write)).toEqual([false, false, true, true]);
      expect(operations.find((operation) => operation.method === "DELETE")?.dangerous).toBe(true);
    }
    expect(TOPOLOGY_CONNECT_OPERATIONS.find((operation) => operation.id === "topology.validate")).toMatchObject({ write: true, mutates: false });
  });

  it("captures path parameters and rejects unknown paths and methods", () => {
    expect(matchTopologyConnectOperation("/api/v1/topology/nodes/example", "GET")?.params).toEqual({ entityId: "example" });
    expect(matchTopologyConnectOperation("/api/v1/topology/changes/17", "GET")?.params).toEqual({ changeId: "17" });
    expect(matchTopologyConnectOperation("/api/v1/requests/example", "GET")?.params).toEqual({ key: "example" });
    expect(matchTopologyConnectOperation("/api/v1/topology/nodes", "DELETE")).toBeNull();
    expect(matchTopologyConnectOperation("/api/v1/diagrams", "GET")).toBeNull();
    expect(matchTopologyConnectOperation("/api/v1/openapiXjson", "GET")).toBeNull();
  });
});
