import { describe, expect, it, vi } from "vitest";

const bundleOnlyAdvance = vi.hoisted(() => ({ callback: undefined as (() => void) | undefined }));

vi.mock("./topology-route-extras", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./topology-route-extras")>();
  return {
    ...actual,
    buildTopologyLayerPairBundles: (...args: Parameters<typeof actual.buildTopologyLayerPairBundles>) => {
      bundleOnlyAdvance.callback?.();
      return actual.buildTopologyLayerPairBundles(...args);
    },
  };
});
import { topologySchema, type Topology } from "@steed/api/shared";
import { generateTopologyFixture } from "../../../../scripts/topology-fixture";
import {
  TOPOLOGY_FRAME_HEADER,
  TOPOLOGY_FRAME_PADDING,
  TOPOLOGY_SECTION_HEADER,
  TOPOLOGY_ROUTE_CURVE_RADIUS,
  TOPOLOGY_ROUTE_MARKER_CLEARANCE,
  TOPOLOGY_ROUTE_PAINT_MARGIN,
  TOPOLOGY_ROUTE_STROKE_MARGIN,
  TOPOLOGY_ROUTE_HEADER_CLEARANCE,
  topologyHeaderObstacle,
  topologyRouteObstacle,
  layoutTopology,
  type TopologyLayoutResult,
  type TopologyLayoutLane,
  type TopologyLayoutPosition,
} from "./topology-layout";
import { ROUTE_MARGIN, routeTopology, type TopologyRoute } from "./topology-router";
import { RoutingGrid, type RoutingPoint, type RoutingRect } from "./topology-routing-grid";

function simpleTopology(edges: Array<{ id: string; source: string; target: string }> = [{ id: "a-b", source: "a", target: "b" }]): Topology {
  return topologySchema.parse({
    schemaVersion: 2,
    title: "Synthetic router fixture",
    description: "Synthetic local topology for router tests.",
    revision: 1,
    layers: [
      { id: "cloud", label: "TEST cloud", provider: "Synthetic", order: 0, description: "" },
      { id: "edge", label: "TEST edge", provider: "Synthetic", order: 1, description: "" },
    ],
    types: [{ id: "host", label: "TEST host", shape: "rect", description: "", attrs: [] }],
    boundaries: [],
    nodes: [
      { id: "a", type: "host", label: "TEST A", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: ["synthetic"], attrs: {} },
      { id: "b", type: "host", label: "TEST B", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: ["synthetic"], attrs: {} },
      { id: "c", type: "host", label: "TEST C", layerId: "edge", boundaryIds: [], lifecycle: "active", description: "", tags: ["synthetic"], attrs: {} },
    ],
    edges: edges.map((edge) => ({
      ...edge,
      kind: "uses",
      label: `TEST ${edge.id}`,
      direction: "uni" as const,
      evidence: "documented" as const,
      description: "Synthetic edge.",
      tags: ["synthetic"],
    })),
    views: [],
  });
}

function manualLayout(options: {
  ids?: string[];
  positions?: Record<string, TopologyLayoutPosition>;
  laneIds?: string[];
  laneWidth?: number;
  laneHeight?: number;
} = {}): TopologyLayoutResult {
  const ids = options.ids ?? ["a", "b"];
  const positions = options.positions ?? {
    a: { x: 100, y: 160, width: 100, height: 100 },
    b: { x: 300, y: 160, width: 100, height: 100 },
  };
  const laneIds = options.laneIds ?? ["lane-cloud"];
  const laneWidth = options.laneWidth ?? 500;
  const laneHeight = options.laneHeight ?? 400;
  const lanes: TopologyLayoutLane[] = laneIds.map((id, index) => ({
    id,
    layerId: index === 0 ? "cloud" : "edge",
    order: index,
    x: index * (laneWidth + 160),
    y: 0,
    width: laneWidth,
    height: laneHeight,
    blockIds: [],
    nodeIds: laneIds.length === 1 ? [...ids] : index === 0 ? ids.filter((id) => id !== "c") : ids.filter((id) => id === "c"),
  }));
  if (!lanes[0]?.nodeIds.length && ids.length) lanes[0]!.nodeIds = ids;
  return {
    positions,
    nodePositions: positions,
    blocks: [],
    lanes,
    frames: [],
    width: laneIds.length * laneWidth + (laneIds.length - 1) * 160,
    height: laneHeight,
  };
}

function inflate(rect: RoutingRect, margin = ROUTE_MARGIN): RoutingRect {
  return { x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 };
}

function strictSegmentHitsRect(a: RoutingPoint, b: RoutingPoint, rect: RoutingRect): boolean {
  if (a.x === b.x) {
    const yMin = Math.min(a.y, b.y);
    const yMax = Math.max(a.y, b.y);
    return a.x > rect.x && a.x < rect.x + rect.width
      && yMax > rect.y && yMin < rect.y + rect.height;
  }
  if (a.y === b.y) {
    const xMin = Math.min(a.x, b.x);
    const xMax = Math.max(a.x, b.x);
    return a.y > rect.y && a.y < rect.y + rect.height
      && xMax > rect.x && xMin < rect.x + rect.width;
  }
  return true;
}

function attached(point: RoutingPoint, rect: RoutingRect, side: "top" | "right" | "bottom" | "left"): boolean {
  if (side === "top" || side === "bottom") {
    return point.x >= rect.x && point.x <= rect.x + rect.width
      && point.y === (side === "top" ? rect.y : rect.y + rect.height);
  }
  return point.y >= rect.y && point.y <= rect.y + rect.height
    && point.x === (side === "left" ? rect.x : rect.x + rect.width);
}

function outward(point: RoutingPoint, next: RoutingPoint, side: "top" | "right" | "bottom" | "left"): boolean {
  if (side === "top") return point.x === next.x && next.y < point.y;
  if (side === "bottom") return point.x === next.x && next.y > point.y;
  if (side === "left") return point.y === next.y && next.x < point.x;
  return point.y === next.y && next.x > point.x;
}

function strictInside(point: RoutingPoint, rect: RoutingRect): boolean {
  return point.x > rect.x && point.x < rect.x + rect.width
    && point.y > rect.y && point.y < rect.y + rect.height;
}

function frameCrossingCount(points: RoutingPoint[], rect: RoutingRect): number {
  let inside: boolean | undefined;
  let crossings = 0;

  for (let index = 0; index + 1 < points.length; index++) {
    const a = points[index]!;
    const b = points[index + 1]!;
    const horizontal = a.y === b.y;
    const start = horizontal ? a.x : a.y;
    const end = horizontal ? b.x : b.y;
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    const boundaries = horizontal ? [rect.x, rect.x + rect.width] : [rect.y, rect.y + rect.height];
    const cuts = [low, ...boundaries.filter((value) => value > low && value < high), high]
      .sort((x, y) => x - y);

    if (start > end) cuts.reverse();

    for (let cutIndex = 0; cutIndex + 1 < cuts.length; cutIndex++) {
      const middle = (cuts[cutIndex]! + cuts[cutIndex + 1]!) / 2;
      const point = horizontal ? { x: middle, y: a.y } : { x: a.x, y: middle };
      const onBorder = (point.x === rect.x || point.x === rect.x + rect.width)
        || (point.y === rect.y || point.y === rect.y + rect.height);
      if (onBorder) continue;
      const next = strictInside(point, rect);
      if (inside !== undefined && inside !== next) crossings++;
      inside = next;
    }
  }

  return crossings;
}

function shuffled<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  let value = seed >>> 0;
  for (let index = copy.length - 1; index > 0; index--) {
    value = (Math.imul(value ^ 0x9e3779b9, 1) + 0x6d2b79b) >>> 0;
    const swap = value % (index + 1);
    [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
  }
  return copy;
}

function trimmedInterval(start: number, end: number, first: boolean, last: boolean) {
  const trimStart = first ? ROUTE_MARGIN : 0;
  const trimEnd = last ? ROUTE_MARGIN : 0;
  if (Math.abs(end - start) <= trimStart + trimEnd) return null;
  const direction = Math.sign(end - start);
  const a = start + direction * trimStart;
  const b = end - direction * trimEnd;
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

function postStubVerticalIntervals(route: TopologyRoute) {
  const intervals: Array<{ x: number; low: number; high: number }> = [];
  for (let index = 1; index < route.points.length; index++) {
    const a = route.points[index - 1]!;
    const b = route.points[index]!;
    if (a.x !== b.x) continue;
    const interval = trimmedInterval(a.y, b.y, index === 1, index === route.points.length - 1);
    if (interval) intervals.push({ x: a.x, ...interval });
  }
  return intervals;
}

function postStubVerticalSharedLength(routes: TopologyRoute[]): number {
  let shared = 0;
  for (let left = 0; left < routes.length; left++) {
    for (let right = left + 1; right < routes.length; right++) {
      for (const a of postStubVerticalIntervals(routes[left]!)) {
        for (const b of postStubVerticalIntervals(routes[right]!)) {
          if (a.x === b.x) shared += Math.max(0, Math.min(a.high, b.high) - Math.max(a.low, b.low));
        }
      }
    }
  }
  return shared;
}

function postStubHorizontalIntervals(route: TopologyRoute) {
  const intervals: Array<{ y: number; low: number; high: number }> = [];
  for (let index = 1; index < route.points.length; index++) {
    const a = route.points[index - 1]!;
    const b = route.points[index]!;
    if (a.y !== b.y) continue;
    const interval = trimmedInterval(a.x, b.x, index === 1, index === route.points.length - 1);
    if (interval) intervals.push({ y: a.y, ...interval });
  }
  return intervals;
}

function postStubHorizontalSharedLength(routes: TopologyRoute[]): number {
  let shared = 0;
  for (let left = 0; left < routes.length; left++) {
    for (let right = left + 1; right < routes.length; right++) {
      for (const a of postStubHorizontalIntervals(routes[left]!)) {
        for (const b of postStubHorizontalIntervals(routes[right]!)) {
          if (a.y === b.y) shared += Math.max(0, Math.min(a.high, b.high) - Math.max(a.low, b.low));
        }
      }
    }
  }
  return shared;
}

function routeSnapshot(result: ReturnType<typeof routeTopology>) {
  return Object.fromEntries(Object.keys(result.routes).sort().map((edgeId) => {
    const route = result.routes[edgeId]!;
    return [edgeId, { ...route, points: route.points.map((point) => ({ ...point })) }];
  }));
}

describe("topology router", () => {
  it("measures post-stub intervals in both directions", () => {
    const route = (points: RoutingPoint[]): TopologyRoute => ({
      status: "routed", edgeId: "edge", source: "a", target: "b",
      sourceSide: "right", targetSide: "left", points,
    });
    for (const [start, end] of [[0, 64], [64, 0]]) {
      expect(postStubHorizontalIntervals(route([{ x: start!, y: 1 }, { x: end!, y: 1 }]))).toEqual([{ y: 1, low: 12, high: 52 }]);
      expect(postStubVerticalIntervals(route([{ x: 1, y: start! }, { x: 1, y: end! }]))).toEqual([{ x: 1, low: 12, high: 52 }]);
    }
    expect(postStubHorizontalIntervals(route([{ x: 0, y: 1 }, { x: 24, y: 1 }]))).toEqual([]);
  });

  it("retries another attachment when the preferred stub is enclosed", () => {
    const topology = simpleTopology();
    const template = topology.nodes[0]!;
    topology.nodes = ["a", "b", "c", "d", "e"].map((id) => ({ ...template, id, label: id, style: { shape: "diamond" as const } }));
    const positions = Object.fromEntries([
      { x: 100, y: 300, width: 40, height: 40 },
      { x: 600, y: 300, width: 40, height: 40 },
      { x: 160, y: 277, width: 28, height: 12 },
      { x: 160, y: 352, width: 28, height: 12 },
      { x: 192, y: 311, width: 12, height: 18 },
    ].map((rect, index) => [topology.nodes[index]!.id, rect]));
    const layout = manualLayout({ ids: topology.nodes.map((node) => node.id), positions, laneWidth: 800, laneHeight: 600 });
    const result = routeTopology(topology, layout, { clock: () => 0 });
    expect(result.diagnostics.routeFailures).toEqual([]);
    expect(result.routes["a-b"]?.sourceSide).not.toBe("right");
  });

  it("fans out short parallel midpoint routes beyond their attachment stubs", () => {
    const topology = simpleTopology(Array.from({ length: 8 }, (_, index) => ({ id: `edge-${index}`, source: "a", target: "b" })));
    topology.nodes = topology.nodes.slice(0, 2).map((node) => ({ ...node, style: { shape: "diamond" as const } }));
    const layout = layoutTopology(topology);
    const result = routeTopology(topology, layout, { clock: () => 0 });
    expect(result.diagnostics.routeFailures).toEqual([]);
    expect(new Set(Object.values(result.routes).map((route) => JSON.stringify(route.points))).size).toBe(8);
  });

  it("resolves sixteen coincident diamond routes through bounded offsets and the exact +42 dogleg", () => {
    const topology = simpleTopology(Array.from({ length: 16 }, (_, index) => ({ id: `e-${String(index).padStart(2, "0")}`, source: "a", target: "b" })));
    topology.nodes = topology.nodes.slice(0, 2).map((node) => ({ ...node, style: { shape: "diamond" as const } }));
    const layout = layoutTopology(topology);
    const result = routeTopology(topology, layout, { clock: () => 0 });
    const routes = Object.values(result.routes);

    expect(result.diagnostics.routeFailures).toEqual([]);
    expect(new Set(routes.map((route) => JSON.stringify(route.points))).size).toBe(16);
    expect(postStubVerticalSharedLength(routes)).toBe(0);
    expect(result.diagnostics.unresolvedTwoPointSharedChannels).toEqual([]);
    expect(routes.some((route) => JSON.stringify(route.points) === JSON.stringify([
      { x: 160, y: 248 }, { x: 160, y: 260 }, { x: 202, y: 260 },
      { x: 202, y: 300 }, { x: 160, y: 300 }, { x: 160, y: 312 },
    ]))).toBe(true);
  });

  it("uses the exact +6 candidate for the seventeenth coincident diamond route", () => {
    const topology = simpleTopology(Array.from({ length: 17 }, (_, index) => ({ id: `e-${String(index).padStart(2, "0")}`, source: "a", target: "b" })));
    topology.nodes = topology.nodes.slice(0, 2).map((node) => ({ ...node, style: { shape: "diamond" as const } }));
    const layout = layoutTopology(topology);
    const result = routeTopology(topology, layout, { clock: () => 0 });
    const routes = Object.values(result.routes);

    expect(result.diagnostics.routeFailures).toEqual([]);
    expect(new Set(routes.map((route) => JSON.stringify(route.points))).size).toBe(17);
    expect(postStubVerticalSharedLength(routes)).toBe(0);
    expect(result.diagnostics.unresolvedTwoPointSharedChannels).toEqual([]);
    expect(routes.some((route) => JSON.stringify(route.points) === JSON.stringify([
      { x: 160, y: 248 }, { x: 160, y: 260 }, { x: 166, y: 260 },
      { x: 166, y: 300 }, { x: 160, y: 300 }, { x: 160, y: 312 },
    ]))).toBe(true);
  });

  it("reports exhaustion only after every bounded diamond candidate is occupied", () => {
    const topology = simpleTopology(Array.from({ length: 18 }, (_, index) => ({ id: `e-${String(index).padStart(2, "0")}`, source: "a", target: "b" })));
    topology.nodes = topology.nodes.slice(0, 2).map((node) => ({ ...node, style: { shape: "diamond" as const } }));
    const layout = layoutTopology(topology);
    const result = routeTopology(topology, layout, { clock: () => 0 });

    expect(result.diagnostics.routeFailures).toEqual([]);
    expect(result.diagnostics.unresolvedTwoPointSharedChannels).toEqual([
      { channel: "v:160:260:300", length: 40, edgeIds: ["e-17"] },
    ]);
  });

  it("enumerates bounded candidates for 500 parallel rect routes with differing ports", () => {
    const topology = simpleTopology(Array.from({ length: 500 }, (_, index) => ({ id: `e-${String(index).padStart(3, "0")}`, source: "a", target: "b" })));
    const layout = manualLayout({
      ids: ["a", "b"],
      positions: {
        a: { x: 188, y: 160, width: 50, height: 88 },
        b: { x: 238, y: 224, width: 50, height: 88 },
      },
      laneWidth: 800,
      laneHeight: 600,
    });
    const result = routeTopology(topology, layout, { clock: () => 0, layoutTimeoutMs: 1000, edgeTimeoutMs: 100 });

    expect(Object.keys(result.routes)).toHaveLength(500);
    expect(result.diagnostics.routeFailures).toEqual([]);
    expect(new Set(Object.values(result.routes).map((route) => JSON.stringify(route.points))).size).toBeGreaterThan(1);
  });

  it("handles <=24 px horizontal and vertical endpoint gaps without false unresolved channels", () => {
    for (const gap of [12, 16, 23, 24, 25]) {
      const topology = simpleTopology([
        { id: "edge-a", source: "a", target: "b" },
        { id: "edge-b", source: "a", target: "b" },
      ]);

      const horizontal = manualLayout({
        ids: ["a", "b"],
        positions: {
          a: { x: 100, y: 160, width: 100, height: 100 },
          b: { x: 200 + gap, y: 160, width: 100, height: 100 },
        },
        laneWidth: 800,
        laneHeight: 600,
      });
      const horizontalResult = routeTopology(topology, horizontal, { clock: () => 0 });
      expect(horizontalResult.diagnostics.routeFailures, `horizontal:${gap}`).toEqual([]);
      expect(horizontalResult.diagnostics.unresolvedTwoPointSharedChannels, `horizontal:${gap}`).toEqual([]);
      expect(postStubHorizontalSharedLength(Object.values(horizontalResult.routes)), `horizontal-post-stub:${gap}`).toBe(0);

      const vertical = manualLayout({
        ids: ["a", "b"],
        positions: {
          a: { x: 100, y: 160, width: 100, height: 100 },
          b: { x: 100, y: 260 + gap, width: 100, height: 100 },
        },
        laneWidth: 800,
        laneHeight: 800,
      });
      const verticalResult = routeTopology(topology, vertical, { clock: () => 0 });
      expect(verticalResult.diagnostics.routeFailures, `vertical:${gap}`).toEqual([]);
      expect(verticalResult.diagnostics.unresolvedTwoPointSharedChannels, `vertical:${gap}`).toEqual([]);
      expect(postStubVerticalSharedLength(Object.values(verticalResult.routes)), `vertical-post-stub:${gap}`).toBe(0);
    }
  });

  it("falls back when search finishes after the edge budget", () => {
    const topology = simpleTopology();
    let time = 0;
    const search = RoutingGrid.prototype.search;
    const spy = vi.spyOn(RoutingGrid.prototype, "search").mockImplementation(function (this: RoutingGrid, ...args) {
      const result = search.apply(this, args);
      time += 30;
      return result;
    });
    try {
      const result = routeTopology(topology, layoutTopology(topology), { clock: () => time, edgeTimeoutMs: 20 });
      expect(result.routes["a-b"]?.fallback).toBe("timeout");
      expect(result.routes["a-b"]?.points).toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  });
  it("uses four stable, orthogonal endpoint ports and fans multiple edges across a rect side", () => {
    const topology = simpleTopology([
      { id: "a-b", source: "a", target: "b" },
      { id: "a-c", source: "a", target: "c" },
    ]);
    topology.nodes[2]!.layerId = "cloud";

    const layout = manualLayout({
      ids: ["a", "b", "c"],
      positions: {
        a: { x: 100, y: 100, width: 100, height: 100 },
        b: { x: 300, y: 100, width: 100, height: 100 },
        c: { x: 300, y: 220, width: 100, height: 100 },
      },
    });

    const result = routeTopology(topology, layout, { layoutTimeoutMs: 1000, edgeTimeoutMs: 100 });
    expect(result.diagnostics.routeFailures).toEqual([]);

    const routeAB = result.routes["a-b"]!;
    const routeAC = result.routes["a-c"]!;
    expect(routeAB.sourceSide).toBe("right");
    expect(routeAB.targetSide).toBe("left");
    expect(attached(routeAB.points[0]!, layout.positions.a!, routeAB.sourceSide)).toBe(true);
    expect(attached(routeAB.points.at(-1)!, layout.positions.b!, routeAB.targetSide)).toBe(true);
    expect(outward(routeAB.points[0]!, routeAB.points[1]!, routeAB.sourceSide)).toBe(true);

    expect(routeAC.points[0]!.x).toBe(routeAB.points[0]!.x);
    expect(routeAC.points[0]!.y).not.toBe(routeAB.points[0]!.y);

    for (const route of [routeAB, routeAC]) {
      for (let index = 1; index < route.points.length; index++) {
        expect(route.points[index - 1]!.x === route.points[index]!.x
          || route.points[index - 1]!.y === route.points[index]!.y).toBe(true);
      }
    }
  });

  it("falls back straight and records no_path for an enclosed endpoint", () => {
    const topology = simpleTopology();
    const layout = manualLayout({
      ids: ["a", "b", "left", "right", "top", "bottom"],
      positions: {
        a: { x: 100, y: 100, width: 100, height: 100 },
        b: { x: 300, y: 100, width: 100, height: 100 },
        left: { x: 0, y: 100, width: 100, height: 100 },
        right: { x: 200, y: 100, width: 100, height: 100 },
        top: { x: 100, y: 0, width: 100, height: 100 },
        bottom: { x: 100, y: 200, width: 100, height: 100 },
      },
      laneWidth: 500,
      laneHeight: 400,
    });

    const result = routeTopology(topology, layout, { layoutTimeoutMs: 1000, edgeTimeoutMs: 100 });
    expect(result.diagnostics.routeFailures).toEqual([{ edgeId: "a-b", reason: "no_path" }]);
    expect(result.routes["a-b"]?.fallback).toBe("no_path");
    expect(result.routes["a-b"]?.points).toHaveLength(2);
  });

  it("integrates labels and counted bundles into the route result", () => {
    const topology = simpleTopology([
      { id: "a-b", source: "a", target: "b" },
      { id: "a-c", source: "a", target: "c" },
    ]);
    topology.edges = topology.edges.map((item, index) => ({ ...item, protocol: index === 1 ? "HTTPS" : undefined, port: index === 1 ? 443 : undefined }));
    const layout = manualLayout({
      ids: ["a", "b", "c"],
      positions: {
        a: { x: 100, y: 160, width: 100, height: 100 },
        b: { x: 300, y: 160, width: 100, height: 100 },
        c: { x: 660, y: 160, width: 100, height: 100 },
      },
      laneIds: ["lane-cloud", "lane-edge"],
    });

    const result = routeTopology(topology, layout, { layoutTimeoutMs: 1500, edgeTimeoutMs: 100 });

    expect(Object.keys(result.labels.labels).sort()).toEqual(["a-b", "a-c"]);
    expect(result.bundles.bundles).toHaveLength(1);
    expect(result.bundles.bundles[0]).toMatchObject({ count: 1, edgeIds: ["a-c"], layerIds: ["cloud", "edge"] });
  });

  it("keeps complete timeout labels and bundles on the shared absolute deadline", () => {
    const topology = simpleTopology([
      { id: "a-b", source: "a", target: "b" },
      { id: "a-c", source: "a", target: "c" },
    ]);
    const layout = manualLayout({
      ids: ["a", "b", "c"],
      positions: {
        a: { x: 100, y: 160, width: 100, height: 100 },
        b: { x: 300, y: 160, width: 100, height: 100 },
        c: { x: 660, y: 160, width: 100, height: 100 },
      },
      laneIds: ["lane-cloud", "lane-edge"],
    });

    const result = routeTopology(topology, layout, { clock: () => 100, layoutTimeoutMs: 0, edgeTimeoutMs: 20 });

    expect(Object.keys(result.routes).sort()).toEqual(["a-b", "a-c"]);
    expect(Object.keys(result.labels.labels).sort()).toEqual(["a-b", "a-c"]);
    expect(result.labels.hiddenEdgeIds.sort()).toEqual(["a-b", "a-c"]);
    expect(result.bundles.bundles).toHaveLength(1);
    expect(result.bundles.bundles[0]).toMatchObject({ count: 1, edgeIds: ["a-c"], fallback: "timeout" });
    expect(result.bundles.bundles[0]!.route).toHaveLength(2);
  });

  it("reports bundle-only timeout after successful individual routing", () => {
    const topology = simpleTopology([{ id: "a-c", source: "a", target: "c" }]);
    const layout = layoutTopology(topology);

    let now = 0;
    bundleOnlyAdvance.callback = () => { now = 1500; };
    try {
      const result = routeTopology(topology, layout, {
        clock: () => now,
        layoutTimeoutMs: 1500,
        edgeTimeoutMs: 20,
      });
      expect(result.diagnostics.routeFailures).toEqual([]);
      expect(result.diagnostics.unroutedEdgeIds).toEqual([]);
      expect(result.routes["a-c"]?.status).toBe("routed");
      expect(result.bundles.diagnostics.routeFailures).toEqual([{ bundleId: "bundle:cloud:edge", reason: "timeout" }]);
      expect(result.diagnostics.status).toBe("timeout");
    } finally {
      bundleOnlyAdvance.callback = undefined;
    }
  });

  it("returns complete counted resource-limit fallbacks", () => {
    const topology = simpleTopology([{ id: "a-c", source: "a", target: "c" }]);
    const layout = manualLayout({
      ids: ["a", "c"],
      positions: {
        a: { x: 100, y: 160, width: 100, height: 100 },
        c: { x: 660, y: 160, width: 100, height: 100 },
      },
      laneIds: ["lane-cloud", "lane-edge"],
    });

    const result = routeTopology(topology, layout, { maxBytes: 1, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });

    expect(result.diagnostics.resourceLimit).toBe(true);
    expect(result.routes["a-c"]?.fallback).toBe("timeout");
    expect(Object.keys(result.labels.labels)).toEqual(["a-c"]);
    expect(result.bundles.bundles).toHaveLength(1);
    expect(result.bundles.bundles[0]).toMatchObject({ count: 1, edgeIds: ["a-c"] });
  });

  it("falls back straight and records timeout when the layout deadline is exhausted", () => {
    const topology = simpleTopology();
    const layout = manualLayout();
    let now = 100;

    const result = routeTopology(topology, layout, {
      clock: () => now,
      layoutTimeoutMs: 0,
      edgeTimeoutMs: 20,
    });

    expect(result.diagnostics.routeFailures).toEqual([{ edgeId: "a-b", reason: "timeout" }]);
    expect(result.routes["a-b"]?.fallback).toBe("timeout");
    expect(result.routes["a-b"]?.points).toHaveLength(2);
    expect(result.diagnostics.elapsedMs).toBe(0);
  });

  it("records timeout after injected RoutingGrid search work", () => {
    const topology = simpleTopology();
    const layout = manualLayout();
    let now = 100;
    const search = vi.spyOn(RoutingGrid.prototype, "search").mockImplementation((_start, _goal, options) => {
      now = options.deadline;
      options.clock();
      return { points: null, timeout: true };
    });

    try {
      const result = routeTopology(topology, layout, {
        clock: () => now,
        layoutTimeoutMs: 1500,
        edgeTimeoutMs: 20,
      });
      expect(result.diagnostics.routeFailures).toEqual([{ edgeId: "a-b", reason: "timeout" }]);
      expect(result.routes["a-b"]?.fallback).toBe("timeout");
    } finally {
      search.mockRestore();
    }
  });

  it("returns timeout diagnostics when a cross-lane source search expires", () => {
    const topology = simpleTopology([{ id: "a-c", source: "a", target: "c" }]);
    const layout = manualLayout({
      ids: ["a", "c"],
      positions: {
        a: { x: 100, y: 160, width: 100, height: 100 },
        c: { x: 660, y: 160, width: 100, height: 100 },
      },
      laneIds: ["lane-cloud", "lane-edge"],
    });
    let now = 0;
    const search = vi.spyOn(RoutingGrid.prototype, "search").mockImplementation((_start, _goal, options) => {
      now = options.deadline;
      return { points: null, timeout: true };
    });

    try {
      const result = routeTopology(topology, layout, {
        clock: () => now,
        layoutTimeoutMs: 1500,
        edgeTimeoutMs: 20,
      });

      expect(search).toHaveBeenCalled();
      expect(result.diagnostics.status).toBe("timeout");
      expect(result.diagnostics.routeFailures).toEqual([{ edgeId: "a-c", reason: "timeout" }]);
      expect(result.diagnostics.unroutedEdgeIds).toEqual(["a-c"]);
      expect(result.diagnostics.bundleFailures).toEqual([{ bundleId: "bundle:cloud:edge", reason: "timeout" }]);
      expect(result.routes["a-c"]?.fallback).toBe("timeout");
      expect(result.routes["a-c"]?.points).toHaveLength(2);
    } finally {
      search.mockRestore();
    }
  });

  it("converts a successful search that advances past the edge deadline into timeout fallback", () => {
    const topology = simpleTopology();
    const layout = manualLayout();
    let now = 100;
    const search = vi.spyOn(RoutingGrid.prototype, "search").mockImplementation((_start, goal, options) => {
      now = options.deadline;
      return { points: [{ x: goal.x, y: goal.y }], timeout: false };
    });

    try {
      const result = routeTopology(topology, layout, {
        clock: () => now,
        layoutTimeoutMs: 1500,
        edgeTimeoutMs: 20,
      });

      expect(result.diagnostics.status).toBe("timeout");
      expect(result.diagnostics.routeFailures).toEqual([{ edgeId: "a-b", reason: "timeout" }]);
      expect(result.diagnostics.unroutedEdgeIds).toEqual(["a-b"]);
      expect(result.routes["a-b"]?.fallback).toBe("timeout");
      expect(result.routes["a-b"]?.renderMode).toBe("straight");
      expect(result.routes["a-b"]?.points).toHaveLength(2);
    } finally {
      search.mockRestore();
    }
  });

  it("treats constructor-like edge and node IDs as exact keys", () => {
    const ids = ["constructor", "toString", "__proto__", "prototype", "hasOwnProperty"];
    const topology = {
      schemaVersion: 2 as const,
      title: "Synthetic constructor fixture",
      description: "Synthetic",
      revision: 1,
      layers: [{ id: "cloud", label: "TEST cloud", provider: "Synthetic", order: 0, description: "" }],
      types: [{ id: "host", label: "TEST host", shape: "rect" as const, description: "", attrs: [] }],
      boundaries: [] as Topology["boundaries"],
      nodes: [
        ...ids.map((id) => ({
          id,
          type: "host",
          label: `TEST ${id}`,
          layerId: "cloud",
          boundaryIds: [],
          lifecycle: "active" as const,
          description: "",
          tags: ["synthetic"],
          attrs: {},
        })),
        { id: "b", type: "host", label: "TEST B", layerId: "cloud", boundaryIds: [], lifecycle: "active" as const, description: "", tags: ["synthetic"], attrs: {} },
      ],
      edges: ids.map((id, index) => ({
        id: `edge-${index}-${id}`,
        source: id,
        target: "b",
        kind: "uses" as const,
        label: `TEST edge ${index}`,
        direction: "uni" as const,
        evidence: "documented" as const,
        description: "Synthetic edge.",
        tags: ["synthetic"],
      })),
      views: [] as Topology["views"],
    } as Topology;

    const positions = Object.fromEntries(ids.map((id, index) => [id, { x: 40 + index * 70, y: 160, width: 50, height: 80 }])) as Record<string, TopologyLayoutPosition>;
    const layout = manualLayout({ ids: [...ids, "b"], positions: { ...positions, b: { x: 400, y: 160, width: 100, height: 100 } } });

    const result = routeTopology(topology, layout, { layoutTimeoutMs: 1000, edgeTimeoutMs: 100 });

    for (const edge of topology.edges) {
      expect(Object.prototype.hasOwnProperty.call(result.routes, edge.id)).toBe(true);
      expect(result.routes[edge.id]?.edgeId).toBe(edge.id);
    }
  });

  it("does not mutate prototype behavior for constructor-like node/edge IDs", () => {
    const topology = {
      schemaVersion: 2 as const,
      title: "Synthetic proto fixture",
      description: "Synthetic",
      revision: 1,
      layers: [{ id: "cloud", label: "TEST cloud", provider: "Synthetic", order: 0, description: "" }],
      types: [{ id: "host", label: "TEST host", shape: "rect" as const, description: "", attrs: [] }],
      boundaries: [] as Topology["boundaries"],
      edges: [{ id: "__proto__", source: "__proto__", target: "constructor", kind: "uses" as const, label: "TEST proto edge", direction: "uni" as const, evidence: "documented" as const, description: "Synthetic edge.", tags: ["synthetic"] }],
      views: [] as Topology["views"],
      nodes: [
        { id: "__proto__", type: "host", label: "TEST proto", layerId: "cloud", boundaryIds: [], lifecycle: "active" as const, description: "", tags: ["synthetic"], attrs: {} },
        { id: "constructor", type: "host", label: "TEST constructor", layerId: "cloud", boundaryIds: [], lifecycle: "active" as const, description: "", tags: ["synthetic"], attrs: {} },
      ],
    } as Topology;
    const layout = manualLayout({
      ids: ["__proto__", "constructor"],
      positions: {
        "__proto__": { x: 100, y: 160, width: 100, height: 100 },
        constructor: { x: 300, y: 160, width: 100, height: 100 },
      },
    });

    const result = routeTopology(topology, layout);
    expect(Object.keys(result.routes)).toEqual(["__proto__"]);
    expect(Object.prototype.hasOwnProperty.call(result.routes, "__proto__")).toBe(true);
    expect(result.routes["__proto__"]?.edgeId).toBe("__proto__");
  });

  it("covers edge 0042 rounded-bend, foreign-section boundary, stroke and marker envelopes", () => {
    expect(TOPOLOGY_ROUTE_CURVE_RADIUS).toBe(0);
    expect(TOPOLOGY_ROUTE_HEADER_CLEARANCE).toBe(3);
    expect(TOPOLOGY_ROUTE_MARKER_CLEARANCE).toBe(14);
    expect(TOPOLOGY_ROUTE_MARKER_CLEARANCE).toBeLessThan(TOPOLOGY_FRAME_PADDING);

    const rawFrame = { x: 3576, y: 136, width: 1056, height: 1788 };
    const rawHeader = topologyHeaderObstacle(rawFrame, TOPOLOGY_FRAME_HEADER);
    expect(rawHeader).toEqual({ x: 3573, y: 133, width: 1062, height: 42 });

    const edge0042 = [
      { x: 3542, y: 136 },
      { x: 4624, y: 136 },
      { x: 4632, y: 144 },
      { x: 4632, y: 716 },
    ];
    let headerSegmentHit = false;
    for (let index = 1; index < edge0042.length; index++) {
      if (strictSegmentHitsRect(edge0042[index - 1]!, edge0042[index]!, rawHeader)) headerSegmentHit = true;
    }
    expect(headerSegmentHit).toBe(true);

    const start = edge0042[1]!;
    const control = { x: 4632, y: 136 };
    const end = edge0042[2]!;
    let quadraticHeaderHit = false;
    for (let step = 0; step <= 100; step++) {
      const t = step / 100;
      const point = {
        x: (1 - t) * (1 - t) * start.x + 2 * (1 - t) * t * control.x + t * t * end.x,
        y: (1 - t) * (1 - t) * start.y + 2 * (1 - t) * t * control.y + t * t * end.y,
      };
      if (strictInside(point, rawHeader)) quadraticHeaderHit = true;
    }
    expect(quadraticHeaderHit).toBe(true);

    const foreignLane = { x: 0, y: 0, width: 1760, height: 2556 };
    const foreignObstacle = topologyRouteObstacle(foreignLane, TOPOLOGY_ROUTE_STROKE_MARGIN);
    expect(foreignObstacle).toEqual({ x: -2, y: -2, width: 1764, height: 2560 });
    expect(strictSegmentHitsRect({ x: 1760, y: 2526 }, { x: 1760, y: 4012 }, foreignObstacle)).toBe(true);
  });

  for (const fixtureName of ["topology-200", "topology-500"] as const) {
    it(`routes every synthetic ${fixtureName} edge successfully with orthogonal geometry and obstacle-free segments`, () => {
      const topology = generateTopologyFixture(fixtureName);
      const layout = layoutTopology(topology);
      const result = routeTopology(topology, layout, { clock: () => 0, layoutTimeoutMs: 1000, edgeTimeoutMs: 100 });

      expect(Object.keys(result.routes)).toHaveLength(topology.edges.length);
      expect(result.diagnostics.routeFailures).toEqual([]);
      expect(result.diagnostics.elapsedMs).toBeGreaterThanOrEqual(0);

      const laneByNode = new Map<string, string>();
      for (const lane of layout.lanes) for (const nodeId of lane.nodeIds) laneByNode.set(nodeId, lane.id);

      for (const edge of topology.edges) {
        const route = result.routes[edge.id];
        expect(route, edge.id).toBeDefined();
        expect(route?.fallback).toBeUndefined();
        expect(route?.points.length, edge.id).toBeGreaterThanOrEqual(2);

        const sourceRect = layout.positions[edge.source]!;
        const targetRect = layout.positions[edge.target]!;
        const sourceLane = laneByNode.get(edge.source)!;
        const targetLane = laneByNode.get(edge.target)!;

        expect(attached(route!.points[0]!, sourceRect, route!.sourceSide)).toBe(true);
        expect(attached(route!.points.at(-1)!, targetRect, route!.targetSide)).toBe(true);
        expect(outward(route!.points[0]!, route!.points[1]!, route!.sourceSide)).toBe(true);

        for (let index = 1; index < route!.points.length; index++) {
          const a = route!.points[index - 1]!;
          const b = route!.points[index]!;
          expect(a.x === b.x || a.y === b.y, `${fixtureName}:${edge.id}:${index}`).toBe(true);

          for (const [nodeId, rect] of Object.entries(layout.positions)) {
            if (nodeId === edge.source || nodeId === edge.target) continue;
            expect(strictSegmentHitsRect(a, b, inflate(rect)), `${fixtureName}:${edge.id}:${nodeId}`).toBe(false);
          }

          for (const lane of layout.lanes) {
            const actualTitleButton = { x: lane.x, y: lane.y + 2, width: lane.width, height: TOPOLOGY_SECTION_HEADER };
            const protectedTitleButton = {
              x: actualTitleButton.x - TOPOLOGY_ROUTE_HEADER_CLEARANCE,
              y: actualTitleButton.y - TOPOLOGY_ROUTE_HEADER_CLEARANCE,
              width: actualTitleButton.width + TOPOLOGY_ROUTE_HEADER_CLEARANCE * 2,
              height: actualTitleButton.height + TOPOLOGY_ROUTE_HEADER_CLEARANCE * 2,
            };
            expect(strictSegmentHitsRect(a, b, protectedTitleButton), `${fixtureName}:${edge.id}:section-title-${lane.id}`).toBe(false);
            if (lane.id !== sourceLane && lane.id !== targetLane) {
              expect(strictSegmentHitsRect(a, b, topologyRouteObstacle(lane, TOPOLOGY_ROUTE_STROKE_MARGIN)), `${fixtureName}:${edge.id}:section-${lane.id}`).toBe(false);
            }
          }

          for (const frame of layout.frames) {
            expect(strictSegmentHitsRect(a, b, topologyHeaderObstacle(frame, TOPOLOGY_FRAME_HEADER)), `${fixtureName}:${edge.id}:frame-title-${frame.id}`).toBe(false);
            if (!frame.nodeIds.includes(edge.source) && !frame.nodeIds.includes(edge.target)) {
              expect(strictSegmentHitsRect(a, b, topologyRouteObstacle(frame, TOPOLOGY_ROUTE_STROKE_MARGIN)), `${fixtureName}:${edge.id}:frame-${frame.id}`).toBe(false);
            }
          }
        }

        for (const frame of layout.frames) {
          const sourceInside = frame.nodeIds.includes(edge.source);
          const targetInside = frame.nodeIds.includes(edge.target);
          const expected = Number(sourceInside !== targetInside);
          expect(frameCrossingCount(route!.points, frame), `${fixtureName}:${edge.id}:frame-crossings-${frame.id}`).toBe(expected);
        }

        for (const lane of layout.lanes) {
          const sourceInside = lane.nodeIds.includes(edge.source);
          const targetInside = lane.nodeIds.includes(edge.target);
          const expected = Number(sourceInside !== targetInside);
          expect(frameCrossingCount(route!.points, lane), `${fixtureName}:${edge.id}:section-crossings-${lane.id}`).toBe(expected);
        }
      }
    }, 60_000);
  }

  it("produces deterministic routes and placement under reversed and shuffled synthetic inputs", () => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);
    const result = routeTopology(topology, layout, { clock: () => 0, layoutTimeoutMs: 1000, edgeTimeoutMs: 100 });

    const reversed = {
      ...topology,
      layers: [...topology.layers].reverse(),
      types: [...topology.types].reverse(),
      boundaries: [...topology.boundaries].reverse(),
      nodes: [...topology.nodes].reverse(),
      edges: [...topology.edges].reverse(),
    };
    const shuffledTopology = {
      ...reversed,
      layers: shuffled(reversed.layers, 200001),
      types: shuffled(reversed.types, 200002),
      boundaries: shuffled(reversed.boundaries, 200003),
      nodes: shuffled(reversed.nodes, 200004),
      edges: shuffled(reversed.edges, 200005),
    };

    const shuffledLayout = layoutTopology(shuffledTopology);
    const shuffledResult = routeTopology(shuffledTopology, shuffledLayout, { clock: () => 0, layoutTimeoutMs: 1000, edgeTimeoutMs: 100 });

    expect(shuffledResult.diagnostics.routeFailures).toEqual(result.diagnostics.routeFailures);
    expect(routeSnapshot(shuffledResult)).toEqual(routeSnapshot(result));

    const placementKey = (placed: TopologyLayoutResult) => ({
      positions: Object.fromEntries(Object.keys(placed.positions).sort().map((id) => [id, placed.positions[id]])),
      lanes: placed.lanes.map((lane) => ({ id: lane.id, x: lane.x, y: lane.y, width: lane.width, height: lane.height, nodeIds: [...lane.nodeIds].sort() })),
      frames: placed.frames.map((frame) => ({ id: frame.id, x: frame.x, y: frame.y, width: frame.width, height: frame.height, nodeIds: [...frame.nodeIds].sort() })),
    });
    expect(placementKey(shuffledLayout)).toEqual(placementKey(layout));
  }, 60_000);
});
