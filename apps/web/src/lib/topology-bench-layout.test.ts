import { describe, expect, it } from "vitest";
import { topologySchema } from "@steed/api/shared";
import {
  benchmarkLayout,
  buildInformationalTopology,
  formatLayoutBenchmark,
  layoutBenchmarkCases,
} from "../../../../scripts/bench-layout";

function stableFingerprint(topology: ReturnType<typeof buildInformationalTopology>): string {
  return JSON.stringify({
    nodes: topology.nodes.map((node) => [node.id, node.layerId, node.parentId ?? "", [...node.boundaryIds].sort()]),
    edges: topology.edges.map((edge) => [edge.id, edge.source, edge.target, edge.kind]),
  });
}

describe("layout benchmark construction", () => {
  it("builds the exact informational 1000-node / 5000-edge topology", () => {
    const topology = buildInformationalTopology(1000, 5000);

    expect(topologySchema.safeParse(topology).success).toBe(true);
    expect(topology.nodes).toHaveLength(1000);
    expect(topology.edges).toHaveLength(5000);
    expect(topology.nodes.filter((node) => node.parentId)).toHaveLength(300);
    expect(topology.nodes.filter((node) => node.layerId.startsWith("bench-1000-layer-")).length).toBe(1000);
    expect(topology.edges.every((edge) => edge.id.startsWith("bench-1000-edge-"))).toBe(true);

    const layerByNode = new Map(topology.nodes.map((node) => [node.id, node.layerId]));
    const uniqueKeys = new Set(topology.edges.map((edge) => `${edge.source}\0${edge.target}\0${edge.kind}`));
    const crossLayerEdges = topology.edges.filter((edge) => layerByNode.get(edge.source) !== layerByNode.get(edge.target));

    expect(uniqueKeys.size).toBe(5000);
    expect(crossLayerEdges).toHaveLength(1750);
    expect(topology.edges).toHaveLength(crossLayerEdges.length + 3250);
  });

  it("is deterministic and rejects unsupported informational sizes", () => {
    const first = buildInformationalTopology(1000, 5000);
    const second = buildInformationalTopology(1000, 5000);

    expect(stableFingerprint(second)).toBe(stableFingerprint(first));
    expect(() => buildInformationalTopology(999, 5000)).toThrow(/1000 nodes \/ 5000 edges/);
    expect(() => buildInformationalTopology(1000, 4999)).toThrow(/1000 nodes \/ 5000 edges/);
  });

  it("keeps pinned 200/400 and 500/1000 cases unchanged and identifies 1000/5000 informational", () => {
    const cases = layoutBenchmarkCases();

    expect(cases.map((item) => [item.name, item.topology.nodes.length, item.topology.edges.length, item.informational])).toEqual([
      ["topology-200/400", 200, 400, false],
      ["topology-500/1000", 500, 1000, false],
      ["topology-1000/5000", 1000, 5000, true],
    ]);
  });

  it("summarizes placement, routing, reported routing, routes and failures", () => {
    const cases = layoutBenchmarkCases();
    const summary = benchmarkLayout(cases[0]!, 1);
    const text = formatLayoutBenchmark(summary);

    expect(summary.name).toBe("topology-200/400");
    expect(summary.nodes).toBe(200);
    expect(summary.edges).toBe(400);
    expect(summary.runs).toHaveLength(1);
    expect(summary.runs[0]!.routes).toBe(400);
    expect(summary.runs[0]!.placementMs).toBeGreaterThanOrEqual(0);
    expect(summary.runs[0]!.routingMs).toBeGreaterThanOrEqual(0);
    expect(summary.runs[0]!.reportedRoutingMs).toBeGreaterThanOrEqual(0);
    expect(text).toContain("topology-200/400");
    expect(text).toContain("nodes=200 edges=400");
    expect(text).toContain("routes=400");
  });

  it("keeps informational construction bounded across repeated runs", () => {
    for (let run = 0; run < 10; run++) {
      const topology = buildInformationalTopology(1000, 5000);
      const layerByNode = new Map(topology.nodes.map((node) => [node.id, node.layerId]));
      const uniqueKeys = new Set(topology.edges.map((edge) => `${edge.source}\0${edge.target}\0${edge.kind}`));
      const crossLayerEdges = topology.edges.filter((edge) => layerByNode.get(edge.source) !== layerByNode.get(edge.target));

      expect(topology.nodes).toHaveLength(1000);
      expect(topology.edges).toHaveLength(5000);
      expect(uniqueKeys.size).toBe(5000);
      expect(crossLayerEdges).toHaveLength(1750);
    }
  }, 30_000);

  it("rejects a non-positive benchmark repeat count", () => {
    const caseDefinition = layoutBenchmarkCases()[0]!;
    expect(() => benchmarkLayout(caseDefinition, 0)).toThrow(/at least 1/);
  });
});
