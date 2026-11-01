import { describe, expect, it } from "vitest";
import { topologySchema, type Topology, type TopologyEdge } from "@steed/api/shared";
import { TOPOLOGY_FRAME_HEADER, TOPOLOGY_ROUTE_STROKE_MARGIN, TOPOLOGY_SECTION_HEADER, layoutTopology, topologyHeaderObstacle, topologyRouteObstacle, type TopologyLayoutResult } from "./topology-layout";
import { routeTopology, type TopologyRoute } from "./topology-router";
import { RoutingGrid, RoutingGridLimit, RoutingGridTimeout, type RoutingRect } from "./topology-routing-grid";
import { generateTopologyFixture } from "../../../../scripts/topology-fixture";
import {
  type TopologyRouteLabel,
  type TopologyRouteLabelResult,
  buildTopologyLayerPairBundles,
  createTopologyBundleRouteContext,
  formatRouteLabelText,
  placeTopologyRouteLabels,
  reserveRouteLabelDimensions,
  routeTopologyLayerPairBundleFromContext,
  routeTopologyLayerPairBundle,
} from "./topology-route-extras";

function edge(id: string, source: string, target: string, kind: TopologyEdge["kind"] = "traffic", extra: Partial<TopologyEdge> = {}): TopologyEdge {
  return { id, source, target, kind, label: "", direction: "uni", evidence: "documented", description: "", tags: [], ...extra };
}

function sample(): Topology {
  return {
    schemaVersion: 2,
    title: "Route extras fixture",
    description: "",
    revision: 1,
    layers: [
      { id: "first", label: "First", provider: "Fixture", order: 10, description: "" },
      { id: "second", label: "Second", provider: "Fixture", order: 20, description: "" },
      { id: "third", label: "Third", provider: "Fixture", order: 30, description: "" },
    ],
    types: [{ id: "host", label: "Host", shape: "rect", description: "", attrs: [] }],
    boundaries: [],
    nodes: [
      { id: "a", type: "host", label: "A", layerId: "first", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "b", type: "host", label: "B", layerId: "second", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "c", type: "host", label: "C", layerId: "third", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
    ],
    edges: [],
    views: [],
  };
}

function route(edgeId: string, points: Array<{ x: number; y: number }>, fallback?: TopologyRoute["fallback"]): TopologyRoute {
  return {
    edgeId,
    source: "a",
    target: "b",
    sourceSide: "right",
    targetSide: "left",
    points,
    ...(fallback ? { fallback } : {}),
  };
}

function brutePlaceTopologyRouteLabels(
  edges: readonly TopologyEdge[],
  routes: Record<string, TopologyRoute>,
  layout: TopologyLayoutResult,
  positionStep = 8,
): TopologyRouteLabelResult {
  const labelHeight = 22;
  const cardMargin = 6;
  const labelMargin = 6;
  const labels = Object.create(null) as TopologyRouteLabelResult["labels"];
  const hiddenEdgeIds: string[] = [];
  const earlierLabels: RoutingRect[] = [];
  const cards = Object.values(layout.positions).map((position) => ({
    x: position.x - cardMargin,
    y: position.y - cardMargin,
    width: position.width + cardMargin * 2,
    height: position.height + cardMargin * 2,
  }));
  const headers = [
    ...layout.lanes.map((lane) => ({ x: lane.x, y: lane.y, width: lane.width, height: 96 })),
    ...layout.frames.map((frame) => ({ x: frame.x, y: frame.y, width: frame.width, height: 36 })),
  ];
  for (const edge of [...edges].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const route = routes[edge.id];
    const text = formatRouteLabelText(edge);
    const width = text.length * 7 + 16;
    let result: TopologyRouteLabel = { edgeId: edge.id, text, rect: null, segmentIndex: null, hidden: true, reason: "no_horizontal_segment" };
    if (route && route.fallback === undefined) {
      const horizontal = route.points
        .map((point, index) => ({ point, index }))
        .slice(0, -1)
        .flatMap(({ point, index }) => {
          const next = route.points[index + 1];
          if (!next || point.y !== next.y) return [];
          const length = Math.abs(next.x - point.x);
          if (length < width) return [];
          const x0 = Math.min(point.x, next.x);
          const x1 = Math.max(point.x, next.x);
          if (point.x < 0 || next.x < 0 || x0 < 0 || x1 > layout.width || point.y < 0 || point.y > layout.height) return [];
          return [{ index, y: point.y, x0, x1, length }];
        })
        .sort((a, b) => b.length - a.length || a.y - b.y || a.x0 - b.x0 || a.index - b.index);
      let placed = false;
      for (const segment of horizontal) {
        const center = segment.x0 + (segment.x1 - segment.x0) / 2;
        const left = segment.x0;
        const right = segment.x1 - width;
        const candidates = new Set<number>([Math.round(center - width / 2), Math.round(left), Math.round(right)]);
        for (let x = left; x <= right; x += positionStep) candidates.add(Math.round(x));
        const sorted = [...candidates]
          .filter((x) => x >= left && x <= right)
          .sort((a, b) => Math.abs(a - (center - width / 2)) - Math.abs(b - (center - width / 2)) || a - b);
        for (const x of sorted) {
          const rect: RoutingRect = { x, y: segment.y - labelHeight / 2, width, height: labelHeight };
          if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > layout.width || rect.y + rect.height > layout.height) continue;
          if ([...cards, ...headers, ...earlierLabels].some((obstacle) =>
            rect.x < obstacle.x + obstacle.width
            && rect.x + rect.width > obstacle.x
            && rect.y < obstacle.y + obstacle.height
            && rect.y + rect.height > obstacle.y)) continue;
          result = { edgeId: edge.id, text, rect, segmentIndex: segment.index, hidden: false };
          earlierLabels.push({ x: rect.x - labelMargin, y: rect.y - labelMargin, width: rect.width + labelMargin * 2, height: rect.height + labelMargin * 2 });
          placed = true;
          break;
        }
        if (placed) break;
      }
      if (!placed) result.reason = "no_available_position";
    }
    labels[edge.id] = result;
    if (result.hidden) hiddenEdgeIds.push(edge.id);
  }
  return { labels, hiddenEdgeIds };
}

function simpleLayout(): TopologyLayoutResult {
  return {
    positions: { a: { x: 40, y: 140, width: 240, height: 112 } },
    nodePositions: { a: { x: 40, y: 140, width: 240, height: 112 } },
    blocks: [],
    lanes: [{ id: "lane:a", layerId: "first", order: 10, x: 0, y: 0, width: 500, height: 400, blockIds: ["a"], nodeIds: ["a"] }],
    frames: [],
    width: 500,
    height: 400,
  };
}

describe("topology route extras", () => {
  it("formats and reserves label dimensions including protocol and port", () => {
    const labeled = edge("api", "a", "b", "traffic", { label: "API", protocol: "HTTPS", port: 443 });
    expect(formatRouteLabelText(labeled)).toBe("API · HTTPS :443");
    expect(reserveRouteLabelDimensions(labeled)).toMatchObject({ text: "API · HTTPS :443" });

    const labelOnly = edge("plain", "a", "b", "traffic", { label: "API" });
    expect(reserveRouteLabelDimensions(labeled).width).toBeGreaterThan(reserveRouteLabelDimensions(labelOnly).width);
    expect(reserveRouteLabelDimensions(labeled, { measureText: (text) => text.length * 10 }).width).toBe(formatRouteLabelText(labeled).length * 10 + 16);
  });

  it("places on the longest horizontal segment and slides away from cards", () => {
    const layout = simpleLayout();
    layout.positions.obstacle = { x: 80, y: 290, width: 40, height: 40 };
    const routeMap = { api: route("api", [{ x: 0, y: 300 }, { x: 200, y: 300 }, { x: 200, y: 360 }]) };
    const result = placeTopologyRouteLabels([edge("api", "a", "b", "traffic", { label: "API" })], routeMap, layout, { paddingX: 8, height: 22, cardMargin: 6, positionStep: 10 });

    const label = result.labels.api;
    expect(label.hidden).toBe(false);
    expect(label.segmentIndex).toBe(0);
    expect(label.rect).not.toBeNull();
    expect(label.rect!.x).toBeGreaterThanOrEqual(0);
    expect(label.rect!.x + label.rect!.width).toBeLessThanOrEqual(200);
    expect(label.rect!.x >= 126 || label.rect!.x + label.rect!.width <= 74).toBe(true);
  });

  it("matches a brute-force reference under dense synthetic labels", () => {
    const layout = simpleLayout();
    for (let index = 0; index < 16; index++) {
      layout.positions[`card-${index}`] = {
        x: 40 + (index % 4) * 110,
        y: 80 + Math.floor(index / 4) * 72,
        width: 32,
        height: 28,
      };
    }
    const edges = Array.from({ length: 24 }, (_, index) =>
      edge(`label-${index.toString().padStart(2, "0")}`, "a", "b", "traffic", { label: `L${index}` }));
    const routes: Record<string, TopologyRoute> = Object.create(null);
    for (let index = 0; index < edges.length; index++) {
      const edgeItem = edges[index]!;
      routes[edgeItem.id] = route(edgeItem.id, [
        { x: 0, y: 300 },
        { x: 200, y: 300 },
        { x: 200, y: 300 + (index % 3) * 12 },
      ]);
    }
    const options = { paddingX: 8, height: 22, cardMargin: 6, positionStep: 10 };

    expect(placeTopologyRouteLabels(edges, routes, layout, options)).toEqual(brutePlaceTopologyRouteLabels(edges, routes, layout, 10));
  });

  it("covers protocol-only, port-only and custom label reserve branches", () => {
    const protocolOnly = edge("protocol", "a", "b", "traffic", { protocol: "HTTPS" });
    expect(formatRouteLabelText(protocolOnly)).toBe("traffic · HTTPS");
    expect(reserveRouteLabelDimensions(protocolOnly, { height: 30, paddingX: 12 }).height).toBe(30);

    const portOnly = edge("port", "a", "b", "traffic", { port: 443 });
    expect(formatRouteLabelText(portOnly)).toBe("traffic · :443");

    const custom = edge("custom", "a", "b", "traffic", { label: "Custom", protocol: "TCP", port: 9000 });
    expect(reserveRouteLabelDimensions(custom, {
      charWidth: 5,
      protocolCharWidth: 6,
      paddingX: 4,
      height: 18,
    })).toMatchObject({ width: expect.any(Number), height: 18, text: "Custom · TCP :9000" });
  });

  it("preserves strict exact-boundary non-overlap for cards and earlier labels", () => {
    const layout = simpleLayout();
    layout.positions.touch = { x: 74, y: 289, width: 40, height: 40 };
    const edges = [
      edge("boundary", "a", "b", "traffic", { label: "Touch" }),
      edge("same", "a", "b", "traffic", { label: "Same" }),
    ];
    const result = placeTopologyRouteLabels(edges, {
      boundary: route("boundary", [{ x: 0, y: 300 }, { x: 74, y: 300 }]),
      same: route("same", [{ x: 0, y: 300 }, { x: 74, y: 300 }]),
    }, layout, { paddingX: 8, height: 22, cardMargin: 6, positionStep: 10 });

    for (const label of Object.values(result.labels)) {
      if (!label.rect) continue;
      const card = layout.positions.touch!;
      const inflated = { x: card.x - 6, y: card.y - 6, width: card.width + 12, height: card.height + 12 };
      const rect = label.rect;
      expect(rect.x < inflated.x + inflated.width
        && rect.x + rect.width > inflated.x
        && rect.y < inflated.y + inflated.height
        && rect.y + rect.height > inflated.y).toBe(false);
    }
  });

  it("handles missing, fallback, short, nonfinite and out-of-bounds route segments deterministically", () => {
    const layout = simpleLayout();
    const edges = [
      edge("missing", "a", "b"),
      edge("fallback", "a", "b", "traffic", {},),
      edge("short", "a", "b"),
      edge("nonfinite", "a", "b"),
      edge("outside", "a", "b"),
    ];
    const routes: Record<string, TopologyRoute> = {
      fallback: route("fallback", [{ x: 0, y: 300 }, { x: 200, y: 300 }], "timeout"),
      short: route("short", [{ x: 0, y: 300 }, { x: 10, y: 300 }]),
      nonfinite: route("nonfinite", [{ x: 0, y: Number.NaN }, { x: 200, y: 300 }]),
      outside: route("outside", [{ x: -1000, y: 300 }, { x: 10000, y: 300 }]),
    };

    const result = placeTopologyRouteLabels(edges, routes, layout, { positionStep: 8 });
    expect(result.labels.missing?.reason).toBe("no_horizontal_segment");
    expect(result.labels.fallback?.reason).toBe("no_horizontal_segment");
    expect(result.labels.short?.reason).toBe("no_horizontal_segment");
    expect(result.labels.nonfinite?.reason).toBe("no_horizontal_segment");
    expect(result.labels.outside?.reason).toBe("no_horizontal_segment");
  });

  it("rejects invalid measured dimensions and normalizes invalid position steps", () => {
    const layout = simpleLayout();
    const invalid = placeTopologyRouteLabels(
      [edge("infinite", "a", "b")],
      { infinite: route("infinite", [{ x: 0, y: 300 }, { x: 200, y: 300 }]) },
      layout,
      { measureText: () => Number.POSITIVE_INFINITY },
    );
    expect(invalid.labels.infinite?.reason).toBe("no_available_position");

    for (const positionStep of [0, -1, Number.NaN]) {
      const normalized = placeTopologyRouteLabels(
        [edge("normalized", "a", "b")],
        { normalized: route("normalized", [{ x: 0, y: 300 }, { x: 200, y: 300 }]) },
        layout,
        { positionStep },
      );
      expect(normalized.labels.normalized?.hidden).toBe(false);
    }
  });

  it("bounds wide and negative geometry in the spatial index without bucket blowup", () => {
    const layout = simpleLayout();
    layout.width = 1_000_000;
    layout.height = 1_000_000;
    layout.positions.negative = { x: -100, y: -100, width: 40, height: 40 };
    layout.positions.zero = { x: 100, y: 300, width: 0, height: 0 };
    layout.lanes[0] = {
      id: "lane:a",
      layerId: "first",
      order: 10,
      x: -500_000,
      y: -500_000,
      width: 1_500_000,
      height: 1_000_000,
      blockIds: ["a"],
      nodeIds: ["a"],
    };

    const result = placeTopologyRouteLabels(
      [edge("wide", "a", "b", "traffic", { label: "Wide" })],
      { wide: route("wide", [{ x: 0, y: 300 }, { x: 200, y: 300 }]) },
      layout,
      { positionStep: 10, cardMargin: 6, labelMargin: 6 },
    );
    expect(result.labels.wide).toBeDefined();
    expect(result.labels.wide?.hidden).toBe(false);
    expect(result.labels.wide?.rect).not.toBeNull();
  });

  it("checks wide label candidates and overflow obstacles against the complete index", () => {
    const layout = simpleLayout();
    layout.width = 20_000;
    layout.positions = { obstacle: { x: 9_999, y: 289, width: 1, height: 22 } };
    const edges = [edge("wide", "a", "b")];
    const routes = { wide: route("wide", [{ x: 0, y: 300 }, { x: 20_000, y: 300 }]) };
    const options = { measureText: () => 19_984, clock: () => 0 };

    expect(placeTopologyRouteLabels(edges, routes, layout, options).labels.wide)
      .toMatchObject({ hidden: true, reason: "no_available_position", rect: null });
    layout.positions = {};
    expect(placeTopologyRouteLabels(edges, routes, layout, options).labels.wide)
      .toMatchObject({ hidden: false, rect: { x: 0, width: 20_000 } });

    layout.positions = { obstacle: { x: 0, y: 289, width: 15_000, height: 22 } };
    const shortRoutes = { wide: route("wide", [{ x: 1_000, y: 300 }, { x: 1_200, y: 300 }]) };
    expect(placeTopologyRouteLabels(edges, shortRoutes, layout, { clock: () => 0 }).labels.wide)
      .toMatchObject({ hidden: true, reason: "no_available_position" });
  });

  it("returns timeout before index construction and during a wide geometry budget", () => {
    const layout = simpleLayout();
    const edges = [edge("a", "a", "b"), edge("b", "a", "b")];
    const routes = {
      a: route("a", [{ x: 0, y: 300 }, { x: 200, y: 300 }]),
      b: route("b", [{ x: 0, y: 300 }, { x: 200, y: 300 }]),
    };

    const before = placeTopologyRouteLabels(edges, routes, layout, { deadline: 10, clock: () => 10 });
    expect(before.hiddenEdgeIds).toEqual(["a", "b"]);
    expect(before.labels.a?.reason).toBe("timeout");
    expect(before.labels.b?.reason).toBe("timeout");

    let now = 0;
    const during = placeTopologyRouteLabels(edges, routes, layout, {
      deadline: 10,
      clock: () => ++now,
    });
    expect(during.hiddenEdgeIds).toEqual(["a", "b"]);
    expect(during.labels.a?.reason).toBe("timeout");
  });

  it("bounds micro-step candidate enumeration and reports timeout instead of truncating", () => {
    const layout = simpleLayout();
    layout.width = 1_000_000;
    const result = placeTopologyRouteLabels(
      [edge("micro", "a", "b", "traffic", { label: "Micro" })],
      { micro: route("micro", [{ x: 0, y: 300 }, { x: 1_000_000, y: 300 }]) },
      layout,
      { positionStep: 1e-300, deadline: 1000, clock: () => 0 },
    );

    expect(result.labels.micro?.hidden).toBe(true);
    expect(result.labels.micro?.reason).toBe("timeout");
    expect(result.labels.micro?.rect).toBeNull();
  });

  it("stops candidate enumeration when its deadline expires", () => {
    const layout = simpleLayout();
    layout.width = 1_000_000;
    let now = 0;
    const result = placeTopologyRouteLabels(
      [edge("budget", "a", "b", "traffic", { label: "Budget" })],
      { budget: route("budget", [{ x: 0, y: 300 }, { x: 1_000_000, y: 300 }]) },
      layout,
      { positionStep: 0.0001, deadline: 20, clock: () => ++now },
    );

    expect(result.labels.budget?.hidden).toBe(true);
    expect(result.labels.budget?.reason).toBe("timeout");
  });

  it("avoids earlier labels and hides labels that cannot fit", () => {
    const layout = simpleLayout();
    const routeMap = {
      first: route("first", [{ x: 0, y: 300 }, { x: 200, y: 300 }]),
      second: route("second", [{ x: 0, y: 300 }, { x: 200, y: 300 }]),
      vertical: route("vertical", [{ x: 100, y: 40 }, { x: 100, y: 160 }]),
      blocked: route("blocked", [{ x: 0, y: 100 }, { x: 200, y: 100 }]),
    };

    const result = placeTopologyRouteLabels([
      edge("first", "a", "b", "traffic", { label: "First" }),
      edge("second", "a", "b", "traffic", { label: "Second" }),
      edge("vertical", "a", "b", "traffic", { label: "Vertical" }),
    ], routeMap, layout, { paddingX: 8, height: 22, cardMargin: 6, positionStep: 10 });

    expect(result.labels.first.hidden).toBe(false);
    expect(result.labels.second.hidden).toBe(false);
    expect(result.labels.first.rect).not.toEqual(result.labels.second.rect);
    expect(result.labels.vertical.hidden).toBe(true);
    expect(result.labels.vertical.reason).toBe("no_horizontal_segment");
    expect(result.hiddenEdgeIds).toContain("vertical");

    const blockedLayout = simpleLayout();
    blockedLayout.positions.blocked = { x: -100, y: 289, width: 400, height: 22 };
    const blockedRoute = placeTopologyRouteLabels(
      [edge("blocked", "a", "b", "traffic", { label: "Blocked" })],
      { blocked: route("blocked", [{ x: 0, y: 300 }, { x: 200, y: 300 }]) },
      blockedLayout,
      { paddingX: 8, height: 22, cardMargin: 6, positionStep: 10 },
    );
    expect(blockedRoute.labels.blocked.hidden).toBe(true);
    expect(blockedRoute.labels.blocked.reason).toBe("no_available_position");
  });

  it("groups filtered cross-layer edges into deterministic unordered pair bundles", () => {
    const topology = sample();
    topology.edges = [
      edge("z-edge", "b", "a", "dns", { protocol: "DNS", port: 53 }),
      edge("a-edge", "a", "b", "traffic", { protocol: "HTTPS", port: 443 }),
      edge("third-edge", "a", "c", "uses"),
      edge("same-edge", "a", "a", "tunnel"),
    ];
    const layout = layoutTopology(topology);

    const filtered = buildTopologyLayerPairBundles(topology, layout, [topology.edges[1]!, topology.edges[0]!]);
    expect(filtered.bundles).toHaveLength(1);
    expect(filtered.bundles[0]).toMatchObject({
      id: "bundle:first:second",
      layerIds: ["first", "second"],
      count: 2,
      edgeIds: ["a-edge", "z-edge"],
    });
    expect(filtered.bundles[0]!.kindCounts).toMatchObject({ traffic: 1, dns: 1 });

    const shuffled = buildTopologyLayerPairBundles(topology, layout, [...topology.edges].reverse().filter((item) => item.id !== "third-edge" && item.id !== "same-edge"));
    expect(shuffled.bundles.map((bundle) => bundle.edgeIds)).toEqual([["a-edge", "z-edge"]]);
  });

  it("filters orphan and same-lane bundle edges and preserves layer fallback resolution", () => {
    const topology = sample();
    topology.edges = [
      edge("missing-source", "missing", "b"),
      edge("missing-target", "a", "missing"),
      edge("same", "a", "a"),
    ];
    const layout = layoutTopology(topology);

    expect(buildTopologyLayerPairBundles(topology, layout, topology.edges).bundles).toEqual([]);

    const cross = buildTopologyLayerPairBundles(topology, layout, [edge("cross", "a", "b", "dns", { protocol: "DNS" })]);
    expect(cross.bundles).toHaveLength(1);
    expect(cross.bundles[0]?.layerIds).toEqual(["first", "second"]);
    expect(cross.bundles[0]?.kindCounts.dns).toBe(1);
  });

  it("returns context fallbacks for missing lanes, resources and timeout/no-grid states", () => {
    const layout = simpleLayout();

    const missingLane = routeTopologyLayerPairBundleFromContext(
      { layout, grid: null, obstacleMargin: 12, failure: "no_path" },
      "missing", "second",
    );
    expect(missingLane).toEqual({ points: null, fallback: "no_path" });

    const resourceLane = routeTopologyLayerPairBundleFromContext(
      { layout, grid: null, obstacleMargin: 12, failure: "no_path", resourceLimit: true },
      "lane:a", "missing",
    );
    expect(resourceLane).toEqual({ points: null, fallback: "no_path" });

    const timeoutLane = routeTopologyLayerPairBundleFromContext(
      { layout, grid: null, obstacleMargin: 12, failure: "timeout" },
      "lane:a", "lane:a",
    );
    expect(timeoutLane.fallback).toBe("timeout");
    expect(timeoutLane.points).not.toBeNull();

    const unspecifiedFailure = { layout, grid: null, obstacleMargin: 12 };
    expect(routeTopologyLayerPairBundleFromContext(unspecifiedFailure, "lane:a", "lane:a"))
      .toMatchObject({ fallback: "no_path", points: expect.any(Array) });
    expect(routeTopologyLayerPairBundleFromContext(unspecifiedFailure, "missing", "lane:a"))
      .toEqual({ fallback: "no_path", points: null });
  });

  it("covers bundle context custom margins, expired clocks and missing lane branches", () => {
    const layout = simpleLayout();

    const custom = createTopologyBundleRouteContext(layout, { obstacleMargin: 17, layoutTimeoutMs: 100 });
    expect(custom.obstacleMargin).toBe(17);
    expect(custom.grid).not.toBeNull();

    const expiredContext = createTopologyBundleRouteContext(layout, { deadline: 10, clock: () => 10 });
    expect(expiredContext).toMatchObject({ grid: null, obstacleMargin: 12, failure: "timeout" });

    const context = createTopologyBundleRouteContext(layout);
    const missingLane = routeTopologyLayerPairBundleFromContext(context, "missing", "lane:a");
    expect(missingLane).toEqual({ points: null, fallback: "no_path" });

    const expiredRoute = routeTopologyLayerPairBundleFromContext(context, "lane:a", "lane:a", {
      deadline: 1,
      clock: () => 1,
    });
    expect(expiredRoute.fallback).toBe("timeout");
    expect(expiredRoute.points).not.toBeNull();
  });

  it("covers grid search timeout, limit, no-point and unsafe-route failure branches", () => {
    const layout = simpleLayout();

    const timeoutGrid = {
      search: () => { throw new RoutingGridTimeout(); },
    } as unknown as RoutingGrid;
    expect(routeTopologyLayerPairBundleFromContext(
      { layout, grid: timeoutGrid, obstacleMargin: 12 },
      "lane:a", "lane:a",
    ).fallback).toBe("timeout");

    const limitGrid = {
      search: () => { throw new RoutingGridLimit(); },
    } as unknown as RoutingGrid;
    expect(routeTopologyLayerPairBundleFromContext(
      { layout, grid: limitGrid, obstacleMargin: 12 },
      "lane:a", "lane:a",
    ).fallback).toBe("no_path");

    const noPointGrid = {
      search: () => ({ points: null, timeout: false }),
    } as unknown as RoutingGrid;
    expect(routeTopologyLayerPairBundleFromContext(
      { layout, grid: noPointGrid, obstacleMargin: 12 },
      "lane:a", "lane:a",
    ).fallback).toBe("no_path");

    const timeoutResultGrid = {
      search: () => ({ points: null, timeout: true }),
    } as unknown as RoutingGrid;
    expect(routeTopologyLayerPairBundleFromContext(
      { layout, grid: timeoutResultGrid, obstacleMargin: 12 },
      "lane:a", "lane:a",
    ).fallback).toBe("timeout");

    const unsafeGrid = {
      search: () => ({ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], timeout: false }),
    } as unknown as RoutingGrid;
    expect(routeTopologyLayerPairBundleFromContext(
      { layout, grid: unsafeGrid, obstacleMargin: 12 },
      "lane:a", "lane:a",
    ).fallback).toBe("no_path");
  });

  it("does not build a grid after an expired deadline and preserves counted bundles", () => {
    const topology = sample();
    topology.edges = [edge("cross", "a", "b")];
    const layout = layoutTopology(topology);
    const result = buildTopologyLayerPairBundles(topology, layout, topology.edges, { deadline: 0 });

    expect(result.bundles).toHaveLength(1);
    expect(result.bundles[0]).toMatchObject({ count: 1, edgeIds: ["cross"], fallback: "timeout" });
    expect(result.bundles[0]!.route).toHaveLength(2);
    expect(result.diagnostics.routeFailures).toEqual([{ bundleId: "bundle:first:second", reason: "timeout" }]);
  });

  it("catches RoutingGridLimit and RoutingGridTimeout as complete fallbacks", () => {
    const topology = sample();
    topology.edges = [edge("cross", "a", "b")];
    const layout = layoutTopology(topology);

    const limited = buildTopologyLayerPairBundles(topology, layout, topology.edges, { layoutTimeoutMs: 100, maxBytes: 1 });
    expect(limited.bundles).toHaveLength(1);
    expect(limited.bundles[0]).toMatchObject({ count: 1, edgeIds: ["cross"], fallback: "no_path" });
    expect(limited.bundles[0]!.route).toHaveLength(2);

    let now = 0;
    const timedContext = createTopologyBundleRouteContext(layout, {
      clock: () => {
        const value = now;
        now += 100;
        return value;
      },
      deadline: 10,
    });
    expect(timedContext.grid).toBeNull();
    expect(timedContext.failure).toBe("timeout");
  });

  it("uses null-prototype route label and bundle kind-count dictionaries", () => {
    const topology = sample();
    topology.edges = [edge("cross", "a", "b")];
    const layout = layoutTopology(topology);
    const bundles = buildTopologyLayerPairBundles(topology, layout, topology.edges);
    expect(Object.getPrototypeOf(bundles.bundles[0]!.kindCounts)).toBeNull();

    const routeMap = Object.assign(Object.create(null) as Record<string, TopologyRoute>, {
      cross: route("cross", [{ x: 0, y: 300 }, { x: 200, y: 300 }]),
    });
    const labels = placeTopologyRouteLabels([topology.edges[0]!], routeMap, layout);
    expect(Object.getPrototypeOf(labels.labels)).toBeNull();
  });

  it("hides a label and hiddenEdgeIds entry when the final deadline check expires after placement", () => {
    const layout = simpleLayout();
    let calls = 0;
    const result = placeTopologyRouteLabels(
      [edge("label", "a", "b", "traffic", { label: "API" })],
      { label: route("label", [{ x: 0, y: 300 }, { x: 200, y: 300 }]) },
      layout,
      {
        paddingX: 8,
        height: 22,
        cardMargin: 6,
        positionStep: 10,
        deadline: 10,
        clock: () => {
          calls++;
          return calls >= 25 ? 10 : 9;
        },
      },
    );

    expect(result.labels.label).toMatchObject({ hidden: true, reason: "timeout", rect: null, segmentIndex: null });
    expect(result.hiddenEdgeIds).toEqual(["label"]);
  });

  it("stops label placement at a shared deadline and hides out-of-bounds labels", () => {
    const layout = simpleLayout();
    const edges = [
      edge("first", "a", "b", "traffic", { label: "First" }),
      edge("second", "a", "b", "traffic", { label: "Second" }),
      edge("third", "a", "b", "traffic", { label: "Third" }),
    ];
    let now = 0;
    const timed = placeTopologyRouteLabels(edges, {
      first: route("first", [{ x: 0, y: 300 }, { x: 200, y: 300 }]),
      second: route("second", [{ x: 0, y: 300 }, { x: 200, y: 300 }]),
      third: route("third", [{ x: 0, y: 300 }, { x: 200, y: 300 }]),
    }, layout, {
      clock: () => {
        const value = now;
        now += 20;
        return value;
      },
      deadline: 10,
    });
    expect(timed.hiddenEdgeIds).toHaveLength(3);
    expect(timed.labels.first?.reason).toBe("timeout");
    expect(timed.labels.second?.reason).toBe("timeout");
    expect(timed.labels.third?.reason).toBe("timeout");

    const outOfBounds = placeTopologyRouteLabels(
      [edge("outside", "a", "b", "traffic", { label: "Outside" })],
      { outside: route("outside", [{ x: -1000, y: 300 }, { x: 10000, y: 300 }]) },
      layout,
    );
    expect(outOfBounds.labels.outside?.hidden).toBe(true);
    expect(outOfBounds.labels.outside?.rect).toBeNull();
  });

  it("routes pair bundles through gutter geometry and flags timeout/no-route explicitly", () => {
    const topology = sample();
    topology.edges = [edge("cross", "a", "b")];
    const layout = layoutTopology(topology);
    const pair = buildTopologyLayerPairBundles(topology, layout, topology.edges);

    expect(pair.bundles).toHaveLength(1);
    expect(pair.bundles[0]!.fallback).toBeUndefined();
    expect(pair.bundles[0]!.route).not.toBeNull();
    expect(pair.bundles[0]!.route!.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);

    let now = 0;
    const timeout = routeTopologyLayerPairBundle("first", "second", layout, {
      clock: () => {
        const value = now;
        now += 100;
        return value;
      },
      bundleTimeoutMs: 20,
    });
    expect(timeout.fallback).toBe("timeout");
    expect(timeout.points).toHaveLength(2);

    const missing = routeTopologyLayerPairBundle("missing", "second", layout);
    expect(missing).toEqual({ points: null, fallback: "no_path" });
  });
});

function syntheticStressTopology(nodeCount: number, layerCount: number): Topology {
  const kinds: TopologyEdge["kind"][] = ["traffic", "dns", "binding", "deploy", "auth", "monitor", "uses", "tunnel"];
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `n-${index.toString().padStart(4, "0")}`,
    type: "host",
    label: `node-${index}`,
    layerId: `l-${(index % layerCount).toString().padStart(2, "0")}`,
    boundaryIds: [] as string[],
    lifecycle: "active" as const,
    description: "",
    tags: [] as string[],
    attrs: {},
  }));
  const edgeCount = nodeCount * 2;
  const crossCount = Math.floor(edgeCount * 0.35);
  const edges = Array.from({ length: edgeCount }, (_, index) => {
    const sourceIndex = index % nodeCount;
    let targetIndex = (sourceIndex * 73 + index * 17 + 1) % nodeCount;
    if (targetIndex === sourceIndex) targetIndex = (targetIndex + 1) % nodeCount;
    if (index >= crossCount) {
      const sourceLayer = sourceIndex % layerCount;
      targetIndex = (sourceIndex + 1) % nodeCount;
      while ((targetIndex % layerCount) !== sourceLayer || targetIndex === sourceIndex) targetIndex = (targetIndex + 1) % nodeCount;
    } else {
      const sourceLayer = sourceIndex % layerCount;
      if ((targetIndex % layerCount) === sourceLayer) {
        targetIndex = (targetIndex + 1) % nodeCount;
        if ((targetIndex % layerCount) === sourceLayer) targetIndex = (targetIndex + layerCount) % nodeCount;
      }
    }
    if (targetIndex === sourceIndex) targetIndex = (targetIndex + 1) % nodeCount;
    return edge(
      `e-${index.toString().padStart(5, "0")}`,
      nodes[sourceIndex]!.id,
      nodes[targetIndex]!.id,
      kinds[index % kinds.length],
      index % 4 === 0 ? { label: `link-${index}`, protocol: index % 2 === 0 ? "HTTPS" : "TCP", port: 1000 + (index % 500) } : {},
    );
  });

  return topologySchema.parse({
    schemaVersion: 2,
    title: "Synthetic stress",
    description: "",
    revision: 1,
    layers: Array.from({ length: layerCount }, (_, index) => ({
      id: `l-${index.toString().padStart(2, "0")}`,
      label: `layer-${index}`,
      provider: "Fixture",
      order: index,
      description: "",
    })),
    types: [{ id: "host", label: "Host", shape: "rect", description: "", attrs: [] }],
    boundaries: [],
    nodes,
    edges,
    views: [],
  });
}

function stressRouteMap(topology: Topology, layout: TopologyLayoutResult, edges: readonly TopologyEdge[]): Record<string, TopologyRoute> {
  const routes: Record<string, TopologyRoute> = {};
  for (let index = 0; index < edges.length; index++) {
    const edgeItem = edges[index]!;
    const source = layout.positions[edgeItem.source];
    const target = layout.positions[edgeItem.target];
    if (!source || !target) continue;
    const y = Math.max(120, Math.min(layout.height - 40, layout.height / 2 + (index % 24) * 8));
    routes[edgeItem.id] = {
      edgeId: edgeItem.id,
      source: edgeItem.source,
      target: edgeItem.target,
      sourceSide: "right",
      targetSide: "left",
      points: [
        { x: source.x + source.width / 2, y: source.y + source.height / 2 },
        { x: source.x + source.width / 2, y },
        { x: target.x + target.width / 2, y },
        { x: target.x + target.width / 2, y: target.y + target.height / 2 },
      ],
    };
  }
  return routes;
}

function segmentCrossesRect(a: { x: number; y: number }, b: { x: number; y: number }, rect: TopologyLayoutResult["lanes"][number]): boolean {
  if (a.x === b.x) {
    return a.x > rect.x && a.x < rect.x + rect.width
      && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.height;
  }
  if (a.y === b.y) {
    return a.y > rect.y && a.y < rect.y + rect.height
      && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.width;
  }
  return true;
}

function segmentCrossesCard(a: { x: number; y: number }, b: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }, margin = 12): boolean {
  const inflated = { x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 };
  if (a.x === b.x) {
    return a.x > inflated.x && a.x < inflated.x + inflated.width
      && Math.max(a.y, b.y) > inflated.y && Math.min(a.y, b.y) < inflated.y + inflated.height;
  }
  if (a.y === b.y) {
    return a.y > inflated.y && a.y < inflated.y + inflated.height
      && Math.max(a.x, b.x) > inflated.x && Math.min(a.x, b.x) < inflated.x + inflated.width;
  }
  return true;
}

function assertBundleGeometry(
  topology: Topology,
  layout: TopologyLayoutResult,
  bundles: ReturnType<typeof buildTopologyLayerPairBundles>["bundles"],
): number {
  let crossings = 0;
  for (const bundle of bundles) {
    if (!bundle.route) continue;
    const sourceLane = layout.lanes.find((lane) => lane.layerId === bundle.layerIds[0]);
    const targetLane = layout.lanes.find((lane) => lane.layerId === bundle.layerIds[1]);
    if (!sourceLane || !targetLane) continue;
    for (let index = 0; index + 1 < bundle.route.length; index++) {
      const a = bundle.route[index]!;
      const b = bundle.route[index + 1]!;
      if (a.x !== b.x && a.y !== b.y) crossings++;
      for (const lane of layout.lanes) {
        if (lane.id === sourceLane.id || lane.id === targetLane.id) continue;
        if (segmentCrossesRect(a, b, topologyRouteObstacle(lane, TOPOLOGY_ROUTE_STROKE_MARGIN))) crossings++;
        const header = topologyHeaderObstacle(lane, TOPOLOGY_SECTION_HEADER);
        if (segmentCrossesRect(a, b, header)) crossings++;
      }
      for (const frame of layout.frames) {
        const header = topologyHeaderObstacle(frame, TOPOLOGY_FRAME_HEADER);
        if (segmentCrossesRect(a, b, header)) crossings++;
        if (segmentCrossesRect(a, b, topologyRouteObstacle(frame, TOPOLOGY_ROUTE_STROKE_MARGIN))) crossings++;
      }
      for (const rect of Object.values(layout.positions)) {
        if (segmentCrossesCard(a, b, rect)) crossings++;
      }
    }
  }
  expect(topology.nodes.length).toBeGreaterThan(0);
  return crossings;
}

describe("topology route extras stress", () => {
  it.each(["topology-200", "topology-500"] as const)(
    "keeps %s full-width overview bundle strokes outside protected geometry",
    (name) => {
      const topology = generateTopologyFixture(name);
      const layout = layoutTopology(topology);
      const result = routeTopology(topology, layout, { clock: () => 0 });
      expect(result.bundles.diagnostics.routeFailures).toEqual([]);
      expect(result.bundles.bundles.length).toBeGreaterThan(0);
      for (const bundle of result.bundles.bundles) {
        expect(bundle.route).toBeDefined();
        expect(bundle.route).not.toBeNull();
        const points = bundle.route!;
        const crossings: string[] = [];
        for (let i = 0; i + 1 < points.length; i++) {
          const a = points[i]!; const b = points[i + 1]!;
          for (const lane of layout.lanes) {
            if (segmentCrossesCard(a, b, { ...lane, height: TOPOLOGY_SECTION_HEADER }, 5)) crossings.push(`segment ${i}: header ${lane.id}`);
            if (!bundle.layerIds.includes(lane.layerId) && segmentCrossesCard(a, b, lane, 5)) crossings.push(`segment ${i}: section ${lane.id}`);
          }
          for (const frame of layout.frames) {
            if (segmentCrossesCard(a, b, frame, 5)) crossings.push(`segment ${i}: frame ${frame.id}`);
          }
        }
        expect(crossings, `bundle ${bundle.id}`).toEqual([]);
      }
    },
    30_000,
  );

  it("keeps 200 and 500 node synthetic bundles and labels within budget geometry", () => {
    for (const nodeCount of [200, 500]) {
      const layerCount = nodeCount === 200 ? 8 : 10;
      const topology = syntheticStressTopology(nodeCount, layerCount);
      const layout = layoutTopology(topology);
      const visibleEdges = topology.edges.filter((_, index) => index % 3 !== 0);

      const startedBundles = performance.now();
      const bundleContext = createTopologyBundleRouteContext(layout);
      const bundleResult = buildTopologyLayerPairBundles(topology, layout, visibleEdges);
      const bundleElapsed = performance.now() - startedBundles;

      expect(bundleContext.grid).toBeDefined();
      for (const bundle of bundleResult.bundles) {
        const sourceLane = layout.lanes.find((lane) => lane.layerId === bundle.layerIds[0]);
        const targetLane = layout.lanes.find((lane) => lane.layerId === bundle.layerIds[1]);
        if (!sourceLane || !targetLane) continue;
        const routed = routeTopologyLayerPairBundleFromContext(bundleContext, sourceLane.id, targetLane.id);
        if (routed.points) expect(routed.fallback).toBeUndefined();
      }

      const expected = new Map<string, { edgeIds: string[]; kindCounts: Record<string, number> }>();
      const laneByNode = new Map<string, string>();
      for (const lane of layout.lanes) for (const nodeId of lane.nodeIds) laneByNode.set(nodeId, lane.layerId);
      for (const edgeItem of visibleEdges) {
        const sourceLayer = laneByNode.get(edgeItem.source);
        const targetLayer = laneByNode.get(edgeItem.target);
        if (!sourceLayer || !targetLayer || sourceLayer === targetLayer) continue;
        const pair = [sourceLayer, targetLayer].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
        const key = `${pair[0]}:${pair[1]}`;
        const group = expected.get(key) ?? { edgeIds: [], kindCounts: {} };
        group.edgeIds.push(edgeItem.id);
        group.kindCounts[edgeItem.kind] = (group.kindCounts[edgeItem.kind] ?? 0) + 1;
        expected.set(key, group);
      }
      expect(bundleResult.bundles.length).toBe(expected.size);
      for (const bundle of bundleResult.bundles) {
        const key = `${bundle.layerIds[0]}:${bundle.layerIds[1]}`;
        const group = expected.get(key);
        expect(group).toBeDefined();
        expect(bundle.count).toBe(group!.edgeIds.length);
        expect(bundle.edgeIds).toEqual([...new Set(group!.edgeIds)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0));
        for (const [kind, count] of Object.entries(group!.kindCounts)) expect(bundle.kindCounts[kind]).toBe(count);
      }

      expect(assertBundleGeometry(topology, layout, bundleResult.bundles)).toBe(0);
      expect(bundleResult.diagnostics.routeFailures.length).toBeLessThanOrEqual(Math.ceil(bundleResult.bundles.length * 0.05));

      const labelRoutes = stressRouteMap(topology, layout, visibleEdges);
      const labelRuns: number[] = [];
      let labelResult = placeTopologyRouteLabels(visibleEdges, labelRoutes, layout);
      for (let run = 0; run < 3; run++) {
        const routeStarted = performance.now();
        labelResult = placeTopologyRouteLabels(visibleEdges, labelRoutes, layout);
        labelRuns.push(performance.now() - routeStarted);
      }
      const sortedLabelRuns = [...labelRuns].sort((a, b) => a - b);
      const labelMedianMs = sortedLabelRuns[Math.floor(sortedLabelRuns.length / 2)] ?? 0;

      const pipelineStarted = performance.now();
      const pipeline = routeTopology(topology, layout, { layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
      const pipelineElapsed = performance.now() - pipelineStarted;
      expect(labelResult.labels).toBeDefined();
      expect(Object.keys(labelResult.labels).length).toBe(visibleEdges.length);

      let overlapWithCards = 0;
      for (const label of Object.values(labelResult.labels)) {
        if (!label.rect) continue;
        for (const rect of Object.values(layout.positions)) {
          if (label.rect.x < rect.x + rect.width + 6
            && label.rect.x + label.rect.width + 6 > rect.x
            && label.rect.y < rect.y + rect.height + 6
            && label.rect.y + label.rect.height + 6 > rect.y) overlapWithCards++;
        }
      }
      expect(overlapWithCards).toBe(0);

      let labelOverlaps = 0;
      const visibleLabels = Object.values(labelResult.labels).flatMap((label) => label.rect ? [label.rect] : []);
      for (let i = 0; i < visibleLabels.length; i++) {
        for (let j = i + 1; j < visibleLabels.length; j++) {
          const a = visibleLabels[i]!;
          const b = visibleLabels[j]!;
          if (a.x < b.x + b.width + 6 && a.x + a.width + 6 > b.x
            && a.y < b.y + b.height + 6 && a.y + a.height + 6 > b.y) labelOverlaps++;
        }
      }
      expect(labelOverlaps).toBe(0);

      console.log(JSON.stringify({
        scale: nodeCount,
        bundles: bundleResult.bundles.length,
        bundleFallbacks: bundleResult.diagnostics.routeFailures.length,
        bundleMs: Math.round(bundleElapsed * 100) / 100,
        labels: visibleLabels.length,
        labelHidden: labelResult.hiddenEdgeIds.length,
        labelMedianMs: Math.round(labelMedianMs * 100) / 100,
        labelRunsMs: labelRuns.map((elapsed) => Math.round(elapsed * 100) / 100),
        pipelineMs: Math.round(pipelineElapsed * 100) / 100,
        pipelineRoutes: Object.keys(pipeline.routes).length,
        pipelineRouteFallbacks: pipeline.diagnostics.routeFailures.length,
        geometryCrossings: 0,
        labelCardOverlaps: overlapWithCards,
        labelOverlaps,
      }));
    }
  });
});
