import { describe, expect, it } from "vitest";
import type { Topology, TopologyEdge } from "@steed/api/shared";
import { layoutTopology } from "./topology-layout";
import {
  adjacentTopologyLayerId,
  buildTopologyLayerFocusProjection,
  clipRoutePointsToLane,
  compareTopologyId,
  nodeInFocusedLayer,
  orderedTopologyLayers,
  readTopologyLayerFocusParam,
  topologyFocusTranslateExtent,
  topologyLayerVisibleNodeCounts,
  writeTopologyLayerFocusSearch,
} from "./topology-layer-focus";

function edge(id: string, source: string, target: string): TopologyEdge {
  return { id, source, target, kind: "traffic", label: "", direction: "uni", evidence: "documented", description: "", tags: [] };
}

function sample(): Topology {
  return {
    schemaVersion: 2,
    title: "Focus fixture",
    description: "",
    revision: 1,
    layers: [
      { id: "alpha", label: "Alpha", provider: "Fixture", order: 10, description: "" },
      { id: "beta", label: "Beta", provider: "Fixture", order: 20, description: "" },
      { id: "gamma", label: "Gamma", provider: "Fixture", order: 30, description: "" },
    ],
    types: [{ id: "host", label: "Host", shape: "rect", description: "", attrs: [] }],
    boundaries: [],
    nodes: [
      { id: "a", type: "host", label: "A", layerId: "alpha", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "b", type: "host", label: "B", layerId: "beta", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "c", type: "host", label: "C", layerId: "gamma", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
    ],
    edges: [edge("ab", "a", "b"), edge("ac", "a", "c"), edge("bc", "b", "c")],
    views: [],
  };
}

describe("topology layer focus helpers", () => {
  it("compares ids and counts visible nodes per layer", () => {
    expect(compareTopologyId("a", "a")).toBe(0);
    expect(compareTopologyId("b", "a")).toBe(1);
    const topology = sample();
    const counts = topologyLayerVisibleNodeCounts(topology, new Set(["a", "b"]));
    expect(counts.get("alpha")).toBe(1);
    expect(counts.get("beta")).toBe(1);
    expect(counts.get("gamma")).toBeUndefined();
  });

  it("reads and writes the layer query parameter", () => {
    expect(readTopologyLayerFocusParam("layer=alpha")).toBe("alpha");
    expect(readTopologyLayerFocusParam("?layer=alpha&view=overview")).toBe("alpha");
    expect(readTopologyLayerFocusParam("")).toBe("");
    expect(writeTopologyLayerFocusSearch("beta", "?view=overview")).toBe("?view=overview&layer=beta");
    expect(writeTopologyLayerFocusSearch(undefined, "?layer=alpha")).toBe("");
    expect(writeTopologyLayerFocusSearch("", "layer=alpha")).toBe("");
  });

  it("orders layers and walks adjacent layers", () => {
    const topology = sample();
    expect(orderedTopologyLayers(topology).map((layer) => layer.id)).toEqual(["alpha", "beta", "gamma"]);
    expect(adjacentTopologyLayerId(topology.layers, "beta", -1)).toBe("alpha");
    expect(adjacentTopologyLayerId(topology.layers, "beta", 1)).toBe("gamma");
    expect(adjacentTopologyLayerId(topology.layers, "alpha", -1)).toBeUndefined();
    expect(adjacentTopologyLayerId(topology.layers, "missing", 1)).toBeUndefined();
  });

  it("returns null for empty or unknown focus ids", () => {
    const topology = sample();
    const layout = layoutTopology(topology);
    expect(buildTopologyLayerFocusProjection(topology, layout, topology.nodes, topology.edges, "")).toBeNull();
    expect(buildTopologyLayerFocusProjection(topology, layout, topology.nodes, topology.edges, "missing")).toBeNull();
  });

  it("projects a focused layer with aggregated cross-layer stubs on every side", () => {
    const topology = sample();
    const layout = layoutTopology(topology);
    const projection = buildTopologyLayerFocusProjection(topology, layout, topology.nodes, topology.edges, "alpha");
    expect(projection?.focusedLayerId).toBe("alpha");
    expect(projection?.suppressedEdgeIds).toEqual(new Set(["ab", "ac"]));
    expect(projection?.stubs.map((stub) => stub.remoteLayerId).sort()).toEqual(["beta", "gamma"]);
    expect(projection?.stubs.every((stub) => stub.count > 0)).toBe(true);
    expect(projection?.translateExtent).toEqual(topologyFocusTranslateExtent(projection!.lane, 80));
    expect(projection?.translateExtent[0][0]).toBeLessThan(projection!.lane.x);
  });

  it("ignores same-layer edges and edges whose endpoints are filtered out", () => {
    const topology = sample();
    const layout = layoutTopology(topology);
    topology.edges.push({ id: "same", source: "a", target: "a", kind: "traffic", label: "", direction: "uni", evidence: "documented", description: "", tags: [] });
    const visible = [topology.nodes[0]!, topology.nodes[1]!];
    const projection = buildTopologyLayerFocusProjection(topology, layout, visible, [edge("ab", "a", "b"), edge("same", "a", "a")], "alpha");
    expect(projection?.suppressedEdgeIds).toEqual(new Set(["ab"]));
    expect(projection?.stubs).toHaveLength(1);
    const hiddenTarget = buildTopologyLayerFocusProjection(topology, layout, [topology.nodes[0]!], [edge("ab", "a", "b")], "alpha");
    expect(hiddenTarget?.suppressedEdgeIds).toEqual(new Set());
  });

  it("keeps every same-layer edge visible and only suppresses cross-layer stubs", () => {
    const topology = sample();
    topology.nodes.push({ id: "sat", type: "host", label: "Sat", layerId: "alpha", parentId: "a", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} });
    topology.edges.push(edge("internal-host", "a", "sat"), edge("internal-loop", "sat", "a"));
    const layout = layoutTopology(topology);
    const projection = buildTopologyLayerFocusProjection(topology, layout, topology.nodes, topology.edges, "alpha");
    expect(projection?.inSectionEdgeIds).toEqual(new Set(["internal-host", "internal-loop"]));
    for (const id of projection?.inSectionEdgeIds ?? []) {
      expect(projection?.suppressedEdgeIds.has(id)).toBe(false);
    }
    expect(projection?.suppressedEdgeIds).toEqual(new Set(["ab", "ac"]));
  });

  it("places stubs on each border side from relative layer geometry", () => {
    const topology = sample();
    const layout = layoutTopology(topology);
    const alpha = buildTopologyLayerFocusProjection(topology, layout, topology.nodes, topology.edges, "alpha");
    const beta = buildTopologyLayerFocusProjection(topology, layout, topology.nodes, topology.edges, "beta");
    const gamma = buildTopologyLayerFocusProjection(topology, layout, topology.nodes, topology.edges, "gamma");
    expect(alpha?.stubs.map((stub) => stub.side)).toEqual(expect.arrayContaining(["right"]));
    expect(beta?.stubs.length).toBeGreaterThan(0);
    expect(gamma?.stubs.length).toBeGreaterThan(0);
    expect(new Set([...(alpha?.stubs ?? []), ...(beta?.stubs ?? []), ...(gamma?.stubs ?? [])].map((stub) => stub.side)).size).toBeGreaterThan(1);
  });

  it("clips polylines once the route leaves the focused section", () => {
    const topology = sample();
    const layout = layoutTopology(topology);
    const hostLayer = new Map(layout.lanes.flatMap((lane) => lane.nodeIds.map((id) => [id, lane.layerId] as const)));
    expect(nodeInFocusedLayer(topology.nodes[0]!, hostLayer, "alpha")).toBe(true);
    expect(nodeInFocusedLayer(topology.nodes[1]!, hostLayer, "alpha")).toBe(false);
    expect(nodeInFocusedLayer({ ...topology.nodes[2]!, id: "orphan", layerId: "gamma" }, hostLayer, "alpha")).toBe(false);
    const lane = layout.lanes.find((candidate) => candidate.layerId === "alpha")!;
    expect(clipRoutePointsToLane([{ x: lane.x + 10, y: lane.y + 10 }], lane)).toEqual([{ x: lane.x + 10, y: lane.y + 10 }]);
    expect(clipRoutePointsToLane([], lane)).toEqual([]);
    const clipped = clipRoutePointsToLane([
      { x: lane.x + 40, y: lane.y + 120 },
      { x: lane.x + lane.width + 200, y: lane.y + 120 },
    ], lane);
    expect(clipped.every((point) => point.x <= lane.x + lane.width)).toBe(true);
    expect(clipped.length).toBeGreaterThan(0);
    const broken = clipRoutePointsToLane([
      { x: lane.x - 50, y: lane.y + 10 },
      { x: lane.x + 10, y: lane.y + 10 },
      { x: lane.x + lane.width + 50, y: lane.y + 10 },
    ], lane);
    expect(broken).toEqual([{ x: lane.x + 10, y: lane.y + 10 }]);
  });
});
