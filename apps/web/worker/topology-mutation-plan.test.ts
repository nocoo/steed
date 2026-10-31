import { describe, expect, it } from "vitest";
import { emptyTopology, topologySchema, TopologyOperationError } from "@steed/api/shared";
import { planTopologyOperations, planTopologyReplacement } from "./topology-mutation-plan";

const before = topologySchema.parse({
  ...emptyTopology("Fixture"), revision: 3,
  layers: [{ id: "cloud", label: "Cloud", provider: "Fixture", order: 0 }],
  types: [{ id: "host", label: "Host", shape: "rect", attrs: [] }],
  nodes: [{ id: "root", label: "Root", type: "host", layerId: "cloud" }],
});

describe("topology mutation plans", () => {
  it("plans operations and counts changes without mutating the snapshot", () => {
    const original = JSON.stringify(before);
    const result = planTopologyOperations(before, [{ op: "set_metadata", title: "Changed" }]);
    expect(result.after.title).toBe("Changed");
    expect(result.after.revision).toBe(3);
    expect(result.changed).toMatchObject({ metadata: 1, nodes: 0 });
    expect(result.dangerous).toBe(false);
    expect(result.warnings.map((warning) => warning.code)).toContain("isolated_node");
    expect(JSON.stringify(before)).toBe(original);
  });

  it("marks removal operations dangerous and propagates operation errors", () => {
    const result = planTopologyOperations(before, [{ op: "remove_node", id: "root", cascade: false }]);
    expect(result.dangerous).toBe(true);
    expect(result.changed.nodes).toBe(1);
    expect(() => planTopologyOperations(before, [{ op: "remove_layer", id: "cloud" }])).toThrow(TopologyOperationError);
  });

  it("ignores input revision, flags only actual removals in a replace and detects no-op changes", () => {
    const unchanged = planTopologyReplacement(before, { ...before, revision: 999 });
    expect(unchanged.after.revision).toBe(3);
    expect(unchanged.items).toEqual([]);
    expect(unchanged.dangerous).toBe(false);
    const removed = planTopologyReplacement(before, { ...before, revision: 0, nodes: [] });
    expect(removed.after.revision).toBe(3);
    expect(removed.dangerous).toBe(true);
    expect(removed.changed.nodes).toBe(1);
  });

  it("rejects invalid replacements with redacted issues", () => {
    try {
      planTopologyReplacement(before, { ...before, nodes: [{ ...before.nodes[0], type: "missing" }] });
      expect.fail("invalid replacement accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(TopologyOperationError);
      expect((error as TopologyOperationError).code).toBe("invalid_topology");
      expect((error as TopologyOperationError).issues.length).toBeGreaterThan(0);
    }
  });
});
