import { describe, expect, it } from "vitest";
import type { Topology } from "@steed/api/shared";
import { generateTopologyFixture } from "../../../../scripts/topology-fixture";
import { layoutTopology, TOPOLOGY_FRAME_HEADER, TOPOLOGY_SECTION_HEADER, TOPOLOGY_ROUTE_HEADER_CLEARANCE } from "./topology-layout";
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

  it.each(["topology-200", "topology-500"] as const)("keeps %s rendered preview segments outside protected geometry", (name) => {
    const topology = generateTopologyFixture(name);
    const result = computeStraightTopologyLayout(topology);
    const layout = layoutTopology(topology);
    const laneByNode = new Map(layout.lanes.flatMap((lane) => lane.nodeIds.map((id) => [id, lane] as const)));
    const index = createTopologyFallbackRectIndex(layout, laneByNode, 8);
    let visibleCount = 0;
    const failures: string[] = [];
    for (const edge of topology.edges) {
      const route = result.routes?.[edge.id];
      if (!route) { failures.push(`${edge.id}:missing`); continue; }
      const split = splitTopologyFallbackPolylinePreview(index, route.points, edge.source, edge.target, { strokeMargin: 8 });
      if (split.timeout || split.geometryUnavailable) { failures.push(`${edge.id}:unavailable`); continue; }
      visibleCount += split.segments.length;
      const sourceLane = laneByNode.get(edge.source)?.id;
      const targetLane = laneByNode.get(edge.target)?.id;
      const rects = [
        ...Object.entries(layout.positions).filter(([id]) => id !== edge.source && id !== edge.target).map(([, rect]) => rect),
        ...layout.lanes.map((lane) => ({ ...lane, height: TOPOLOGY_SECTION_HEADER })),
        ...layout.lanes.filter((lane) => lane.id !== sourceLane && lane.id !== targetLane),
        ...layout.frames.map((frame) => ({ ...frame, height: TOPOLOGY_FRAME_HEADER })),
        ...layout.frames.filter((frame) => !frame.nodeIds.includes(edge.source) && !frame.nodeIds.includes(edge.target)),
      ];
      for (const segment of split.segments) for (const rect of rects) {
        let lo = 0, hi = 1;
        for (const [start, end, min, max] of [
          [segment.a.x, segment.b.x, rect.x - 8 + 1e-6, rect.x + rect.width + 8 - 1e-6],
          [segment.a.y, segment.b.y, rect.y - 8 + 1e-6, rect.y + rect.height + 8 - 1e-6],
        ]) {
          const delta = end! - start!;
          if (Math.abs(delta) < 1e-9) { if (start! <= min! || start! >= max!) { lo = 1; hi = 0; break; } continue; }
          lo = Math.max(lo, Math.min((min! - start!) / delta, (max! - start!) / delta));
          hi = Math.min(hi, Math.max((min! - start!) / delta, (max! - start!) / delta));
        }
        if (hi > lo + 1e-9) { failures.push(`${edge.id}:protected-intersection`); break; }
      }
    }
    expect(visibleCount).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  }, 30_000);

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
