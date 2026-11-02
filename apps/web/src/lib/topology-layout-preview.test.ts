import { describe, expect, it } from "vitest";
import type { Topology } from "@steed/api/shared";
import { generateTopologyFixture } from "../../../../scripts/topology-fixture";
import { layoutTopology, TOPOLOGY_FRAME_HEADER, TOPOLOGY_SECTION_HEADER, TOPOLOGY_ROUTE_HEADER_CLEARANCE } from "./topology-layout";
import { topologyPreviewVisibleSegments } from "../components/map/topology-canvas";
import { createTopologyFallbackRectIndex, splitTopologyFallbackPolylinePreview } from "./topology-route-edge-safety";
import { computeStraightTopologyLayout } from "./topology-layout-preview";

function topology(size = 2): Topology {
  return {
    schemaVersion: 2,
    title: "Preview fixture",
    description: "Synthetic",
    revision: 1,
    layers: [{ id: "cloud", label: "Cloud", provider: "Fixture", order: 0, description: "" }],
    types: [{ id: "host", label: "Host", shape: "rect", description: "", attrs: [] }],
    boundaries: [],
    nodes: Array.from({ length: size }, (_, index) => ({
      id: `node-${index}`,
      type: "host",
      label: `Node ${index}`,
      layerId: "cloud",
      boundaryIds: [],
      lifecycle: "active" as const,
      description: "",
      tags: [],
      attrs: {},
    })),
    edges: size > 1
      ? [{ id: "a-b", source: "node-0", target: "node-1", kind: "uses", label: "Preview", direction: "uni", evidence: "documented", description: "", tags: [] }]
      : [],
    views: [],
  };
}

describe("straight topology preview", () => {
  it("returns a fallback-only result and never labels routes complete", () => {
    const result = computeStraightTopologyLayout(topology());

    expect(result.routeDiagnostics?.status).toBe("timeout");
    expect(result.routeDiagnostics?.fallbackCount).toBe(1);
    expect(result.labels).toEqual({ labels: {}, hiddenEdgeIds: [] });
    expect(result.hiddenEdgeIds).toEqual([]);
    expect(result.bundles).toEqual([]);

    const route = result.routes?.["a-b"];
    expect(route).toMatchObject({ status: "fallback", renderMode: "straight", fallbackStyle: "dashed", fallback: "timeout" });
    expect(route?.points.length).toBeGreaterThanOrEqual(2);
  });

  it("does not hide individual cross-layer fallback edges when preview bundles are empty", () => {
    const preview = computeStraightTopologyLayout(topology(500));

    expect(preview.bundles).toEqual([]);
    expect(preview.routes).toHaveProperty("a-b");
    expect(Object.keys(preview.routes ?? {}).length).toBeGreaterThan(0);
    expect(preview.hiddenEdgeIds).not.toContain("a-b");
    expect(preview.routeDiagnostics?.unroutedEdgeIds).toContain("a-b");
  });

  it("handles empty edge sets and 500-node preview bounds", () => {
    const empty = computeStraightTopologyLayout(topology(1));
    expect(empty.routes).toEqual({});
    expect(empty.routeDiagnostics?.fallbackCount).toBe(0);

    const large = computeStraightTopologyLayout(topology(500));
    expect(Object.keys(large.positions)).toHaveLength(500);
    expect(large.width).toBeGreaterThan(0);
    expect(large.height).toBeGreaterThan(0);
  });

  it("covers all four straight sides and missing endpoints", () => {
    const base = topology(4);
    base.edges = [
      { id: "right", source: "node-0", target: "node-1", kind: "uses", label: "", direction: "uni", evidence: "documented", description: "", tags: [] },
      { id: "left", source: "node-1", target: "node-0", kind: "uses", label: "", direction: "uni", evidence: "documented", description: "", tags: [] },
      { id: "bottom", source: "node-0", target: "node-2", kind: "uses", label: "", direction: "uni", evidence: "documented", description: "", tags: [] },
      { id: "top", source: "node-2", target: "node-0", kind: "uses", label: "", direction: "uni", evidence: "documented", description: "", tags: [] },
      { id: "ghost", source: "node-0", target: "missing", kind: "uses", label: "", direction: "uni", evidence: "documented", description: "", tags: [] },
    ];

    const result = computeStraightTopologyLayout(base);
    expect(result.routes?.right).toBeDefined();
    expect(result.routes?.left).toBeDefined();
    expect(result.routes?.bottom).toBeDefined();
    expect(result.routes?.top).toBeDefined();
    expect(result.routes?.ghost).toMatchObject({ status: "fallback", renderMode: "straight", fallback: "timeout", points: [] });
    expect(result.routeDiagnostics?.unroutedEdgeIds).toContain("ghost");
  });

  it("keeps 200 and 500 rendered preview segments outside card, section and frame title bands", () => {
    for (const name of ["topology-200", "topology-500"] as const) {
      const topology = generateTopologyFixture(name);
      const result = computeStraightTopologyLayout(topology);
      const layout = layoutTopology(topology);
      const protectedRects = [
        ...Object.values(layout.positions).map((rect) => ({ x: rect.x - 3, y: rect.y - 3, width: rect.width + 6, height: rect.height + 6 })),
        ...layout.lanes.map((lane) => ({ x: lane.x - 3, y: lane.y + 2 - 3, width: lane.width + 6, height: TOPOLOGY_SECTION_HEADER + 6 })),
        ...layout.lanes.map((lane) => ({ x: lane.x - 3, y: lane.y - 3, width: lane.width + 6, height: lane.height + 6 })),
        ...layout.frames.map((frame) => ({ x: frame.x - 3, y: frame.y - 3, width: frame.width + 6, height: TOPOLOGY_FRAME_HEADER + 6 })),
      ];
      for (const route of Object.values(result.routes ?? {})) {
        const visible = topologyPreviewVisibleSegments(route.points, protectedRects);
        for (const segment of visible) {
          for (const rect of protectedRects) {
            const hit = segment.a.x === segment.b.x
              ? segment.a.x > rect.x && segment.a.x < rect.x + rect.width && Math.max(segment.a.y, segment.b.y) > rect.y && Math.min(segment.a.y, segment.b.y) < rect.y + rect.height
              : segment.a.y === segment.b.y
                ? segment.a.y > rect.y && segment.a.y < rect.y + rect.height && Math.max(segment.a.x, segment.b.x) > rect.x && Math.min(segment.a.x, segment.b.x) < rect.x + rect.width
                : false;
            expect(hit, `${name}:${route.edgeId}`).toBe(false);
          }
        }
      }
    }
  });

  it("covers left/right/top/bottom preview ports and duplicate/missing points", () => {
    const base = topology(4);
    base.edges = [
      { id: "left", source: "node-1", target: "node-0", kind: "uses", label: "", direction: "uni", evidence: "documented", description: "", tags: [] },
      { id: "right", source: "node-0", target: "node-1", kind: "uses", label: "", direction: "uni", evidence: "documented", description: "", tags: [] },
      { id: "top", source: "node-2", target: "node-0", kind: "uses", label: "", direction: "uni", evidence: "documented", description: "", tags: [] },
      { id: "bottom", source: "node-0", target: "node-2", kind: "uses", label: "", direction: "uni", evidence: "documented", description: "", tags: [] },
      { id: "missing", source: "node-0", target: "missing-node", kind: "uses", label: "", direction: "uni", evidence: "documented", description: "", tags: [] },
    ];
    const result = computeStraightTopologyLayout(base);
    for (const id of ["left", "right", "top", "bottom"]) {
      expect(result.routes?.[id]?.points.length).toBeGreaterThanOrEqual(2);
    }
    expect(result.routes?.missing?.points).toEqual([]);
  });

  it("keeps preview routes finite and explicitly straight", () => {
    const result = computeStraightTopologyLayout(topology(500));
    for (const route of Object.values(result.routes ?? {})) {
      expect(route.renderMode).toBe("straight");
      expect(route.status).toBe("fallback");
      for (const point of route.points) {
        expect([point.x, point.y].every(Number.isFinite)).toBe(true);
      }
    }
  });
});
