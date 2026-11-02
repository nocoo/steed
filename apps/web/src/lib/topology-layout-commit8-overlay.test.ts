import { describe, expect, it, vi } from "vitest";
import type { Topology } from "@steed/api/shared";
import { layoutTopology, type TopologyLayoutResult } from "./topology-layout";
import { computeStraightTopologyLayout } from "./topology-layout-preview";
import { computeTopologyLayout, computeTopologyLayoutCooperative } from "./topology-layout-compute";
import { routeTopology, routeTopologyCooperative } from "./topology-router";
import type { TopologyRoute } from "./topology-router";
import {
  buildTopologyLayerPairBundles,
  placeTopologyRouteLabels,
  reserveRouteLabelDimensions,
  routeTopologyLayerPairBundle,
  createTopologyBundleRouteContext,
} from "./topology-route-extras";
import {
  LAYOUT_VERSION,
  TopologyLayoutLruCache,
  TopologyLayoutRuntime,
  defaultTopologyLayoutWorker,
  topologyLayoutCacheKey,
  topologyLayoutCanonicalHash,
  topologyLayoutPinsHash,
  type LayoutWorkerLike,
} from "./topology-layout-runtime";
import type { LayoutWorkerRequest, LayoutWorkerResponse } from "./layout.worker";
import {
  inheritedBoundaryIds,
  topologyEdgeHandleSides,
  topologyEdgeSides,
  topologyNodeBadgeValues,
  topologyNodeBoundaryLabels,
  topologyTint,
  topologyZoomTier,
} from "../components/map/topology-canvas";

import { TopologyFallbackRectIndex, splitTopologyFallbackPolylinePreview, topologyFallbackMarkerVisibility } from "./topology-route-edge-safety";

function previewIndex(rects: Array<{ x: number; y: number; width: number; height: number }>) {
  const index = new TopologyFallbackRectIndex();
  for (const rect of rects) index.add({ kind: "frame-title", ...rect });
  if (!rects.length) index.add({ kind: "frame-title", x: 100000, y: 100000, width: 1, height: 1 });
  return index;
}
function topologyPreviewVisibleSegments(points: Array<{ x: number; y: number }>, rects: Array<{ x: number; y: number; width: number; height: number }>) {
  return splitTopologyFallbackPolylinePreview(previewIndex(rects), points, "a", "b", { strokeMargin: 0 }).segments;
}
function topologyPreviewMarkerVisible(points: Array<{ x: number; y: number }>, segments: Array<{ a: { x: number; y: number }; b: { x: number; y: number } }>) {
  const first = points[0], last = points.at(-1);
  return first && last ? topologyFallbackMarkerVisibility(segments, first, last) : { markerStart: false, markerEnd: false };
}

function sample(revision = 1): Topology {
  return {
    schemaVersion: 2,
    title: "Commit8 overlay fixture",
    description: "Synthetic",
    revision,
    layers: [{ id: "cloud", label: "Cloud", provider: "Fixture", order: 0, description: "" }],
    types: [{ id: "host", label: "Host", shape: "rect", description: "", attrs: [] }],
    boundaries: [],
    nodes: [
      { id: "a", type: "host", label: "A", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "b", type: "host", label: "B", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
    ],
    edges: [{ id: "a-b", source: "a", target: "b", kind: "uses", label: "Runs", direction: "uni", evidence: "documented", description: "", tags: [] }],
    views: [],
  };
}

function mockWorker(post: (message: LayoutWorkerRequest, worker: LayoutWorkerLike) => void): LayoutWorkerLike {
  const worker: LayoutWorkerLike = {
    postMessage: vi.fn((message: LayoutWorkerRequest) => post(message, worker)),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  };
  return worker;
}

describe("commit8 behavior overlay", () => {
  it("emits a complete straight preview with ports attached to both cards", () => {
    const topology = sample();
    const preview = computeStraightTopologyLayout(topology);

    expect(preview.routeDiagnostics?.status).toBe("timeout");
    expect(preview.routeDiagnostics?.fallbackCount).toBe(1);
    expect(preview.routeDiagnostics?.routeFailures).toEqual([{ edgeId: "a-b", reason: "timeout" }]);

    const route = preview.routes?.["a-b"];
    expect(route).toMatchObject({
      edgeId: "a-b",
      status: "fallback",
      renderMode: "straight",
      fallbackStyle: "dashed",
      fallback: "timeout",
    });
    expect(route?.points).toHaveLength(2);

    const source = preview.positions.a!;
    const target = preview.positions.b!;
    const start = route?.points[0]!;
    const end = route?.points[1]!;
    const onBoundary = (point: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }) =>
      point.x === rect.x
      || point.x === rect.x + rect.width
      || point.y === rect.y
      || point.y === rect.y + rect.height;
    expect(onBoundary(start, source)).toBe(true);
    expect(onBoundary(end, target)).toBe(true);
  });

  it("clips fallback preview segments around protected card/title rectangles and preserves endpoint markers", () => {
    const points = [{ x: 0, y: 50 }, { x: 200, y: 50 }];
    const protectedRects = [{ x: 80, y: 40, width: 40, height: 20 }];

    const visible = topologyPreviewVisibleSegments(points, protectedRects);
    expect(visible).toEqual([
      { a: { x: 0, y: 50 }, b: { x: 80, y: 50 } },
      { a: { x: 120, y: 50 }, b: { x: 200, y: 50 } },
    ]);
    expect(topologyPreviewMarkerVisible(points, visible)).toEqual({ markerStart: true, markerEnd: true });

    const fullyProtected = topologyPreviewVisibleSegments(points, [{ x: 0, y: 0, width: 200, height: 100 }]);
    expect(fullyProtected).toEqual([]);

    expect(topologyEdgeHandleSides({ points, sourceSide: "bottom", targetSide: "top" },
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 200, y: 0, width: 100, height: 100 },
    )).toEqual(["bottom", "top"]);
  });

  it("drops stale preview timers and stale worker replies after superseding a request", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sent: LayoutWorkerRequest[] = [];
    const worker = mockWorker((message) => sent.push(message));
    const straight = vi.fn(computeStraightTopologyLayout);
    const runtime = new TopologyLayoutRuntime(() => worker, computeTopologyLayout, straight);
    const oldCallback = vi.fn();
    const latestCallback = vi.fn();

    runtime.request({ topology, viewId: "old" }, oldCallback);
    runtime.request({ topology: { ...topology, revision: 2 }, viewId: "latest" }, latestCallback);

    vi.advanceTimersByTime(120);
    expect(straight).toHaveBeenCalledTimes(1);
    expect(straight.mock.calls[0]?.[0]?.revision).toBe(2);
    expect(straight.mock.calls[0]?.[1]).toEqual({ viewId: "latest" });
    expect(oldCallback).not.toHaveBeenCalled();

    const latestMessage = sent.at(-1)!;
    const latestResult = computeTopologyLayout({ ...topology, revision: 2 });
    worker.onmessage?.({
      data: { requestId: latestMessage.requestId, layoutVersion: LAYOUT_VERSION, ok: true, result: latestResult },
    } as MessageEvent<LayoutWorkerResponse>);

    worker.onmessage?.({
      data: { requestId: "layout-stale", layoutVersion: LAYOUT_VERSION, ok: true, result: computeTopologyLayout(topology) },
    } as MessageEvent<LayoutWorkerResponse>);
    vi.runOnlyPendingTimers();

    expect(latestCallback.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(latestCallback).toHaveBeenLastCalledWith(latestResult);
    expect(oldCallback).not.toHaveBeenCalled();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("cancel suppresses an in-flight cooperative routed reply", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    let resolveCooperative: ((value: TopologyLayoutResult | undefined) => void) | undefined;
    const cooperative = vi.fn(() => new Promise<TopologyLayoutResult | undefined>((resolve) => {
      resolveCooperative = resolve;
    }));
    const straight = vi.fn(computeStraightTopologyLayout);
    const runtime = new TopologyLayoutRuntime(() => undefined, undefined, straight, cooperative);
    const previewCallback = vi.fn();

    const requestId = runtime.request({ topology }, previewCallback);
    await vi.runOnlyPendingTimersAsync();
    expect(straight).toHaveBeenCalledTimes(1);
    expect(previewCallback).toHaveBeenCalledTimes(1);

    runtime.cancelRequest(requestId);
    resolveCooperative?.(computeTopologyLayout(topology));
    await Promise.resolve();

    expect(previewCallback).toHaveBeenCalledTimes(1);
    expect(previewCallback.mock.calls[0]?.[0]?.routeDiagnostics?.status).toBe("timeout");

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("covers cache identity, LRU promotion, canonical hash and pins branches", () => {
    const topology = sample(7);
    const baseLayout = layoutTopology(topology);
    const basePins = { b: { x: 20, y: 10 }, a: { x: 0, y: 0 } };

    expect(topologyLayoutPinsHash(undefined)).toBe("[]");
    expect(topologyLayoutPinsHash(basePins)).toBe(JSON.stringify([["a", 0, 0], ["b", 20, 10]]));

    const baseKey = topologyLayoutCacheKey(topology, "view-a", basePins, { origin: { x: 0, y: 0 }, aspect: 1.6 });
    expect(topologyLayoutCacheKey(topology, "view-a", basePins, { origin: { x: 10, y: 20 }, aspect: 1.6 })).not.toBe(baseKey);
    expect(topologyLayoutCacheKey(topology, "view-b", basePins, { aspect: 2 })).not.toBe(baseKey);
    expect(topologyLayoutCacheKey(topology, "view-a", { b: { x: 99, y: 99 } })).not.toBe(baseKey);

    const cache = new TopologyLayoutLruCache(2);
    const second = layoutTopology({ ...topology, revision: 8 });
    cache.set("a", baseLayout);
    cache.set("b", second);
    expect(cache.get("a")).toBe(baseLayout);
    cache.set("c", baseLayout);
    expect(cache.has("b")).toBe(false);
    expect(cache.sizeValue).toBe(2);

    const zero = new TopologyLayoutLruCache(0);
    zero.set("zero", baseLayout);
    expect(zero.sizeValue).toBe(0);
    expect(zero.get("zero")).toBeUndefined();

    baseLayout.routes = {
      "a-b": {
        edgeId: "a-b",
        source: "a",
        target: "b",
        sourceSide: "right",
        targetSide: "left",
        points: [{ x: 280, y: 192 }, { x: 40, y: 192 }],
        status: "fallback",
        renderMode: "straight",
        fallbackStyle: "dashed",
        fallback: "timeout",
      },
    };
    baseLayout.bundles = [{
      id: "bundle:a-b",
      layerIds: ["cloud", "edge"],
      count: 1,
      edgeIds: ["a-b"],
      kindCounts: { uses: 1 },
      route: null,
      fallback: "timeout",
    }];
    baseLayout.routeDiagnostics = {
      status: "timeout",
      routeFailures: [{ edgeId: "a-b", reason: "timeout" }],
      fallbackCount: 0,
      unroutedEdgeIds: [],
      elapsedMs: 0,
      bundleFailures: [],
      unresolvedTwoPointSharedChannels: [],
    };
    expect(topologyLayoutCanonicalHash(baseLayout)).toContain("timeout");
  });

  it("covers zoom tiers, tint fallback, four endpoint directions and marker no-geometry branches", () => {
    expect(topologyZoomTier(0)).toBe("far");
    expect(topologyZoomTier(0.39)).toBe("far");
    expect(topologyZoomTier(0.4)).toBe("mid");
    expect(topologyZoomTier(0.74)).toBe("mid");
    expect(topologyZoomTier(0.75)).toBe("near");

    expect(topologyTint("#123456", 0.5)).toBe("#12345680");
    expect(topologyTint(undefined, 0.5)).toContain("color-mix");
    expect(topologyTint("named", 0.25)).toContain("named");

    const rect = { x: 100, y: 100, width: 100, height: 100 };
    expect(topologyEdgeSides(rect, { x: 300, y: 100, width: 100, height: 100 })).toEqual(["right", "left"]);
    expect(topologyEdgeSides(rect, { x: 0, y: 100, width: 100, height: 100 })).toEqual(["left", "right"]);
    expect(topologyEdgeSides(rect, { x: 100, y: 300, width: 100, height: 100 })).toEqual(["bottom", "top"]);
    expect(topologyEdgeSides(rect, { x: 100, y: 0, width: 100, height: 100 })).toEqual(["top", "bottom"]);

    expect(topologyEdgeHandleSides(undefined, rect, rect)).toEqual(["right", "left"]);
    expect(topologyEdgeHandleSides({ edge: sample().edges[0]!, points: [], sourceSide: "top", targetSide: "bottom" } as never, rect, rect)).toEqual(["top", "bottom"]);

    expect(topologyPreviewVisibleSegments([], [])).toEqual([]);
    expect(topologyPreviewVisibleSegments([{ x: 1, y: 1 }], [])).toEqual([]);
    expect(topologyPreviewMarkerVisible([], [])).toEqual({ markerStart: false, markerEnd: false });
    expect(topologyPreviewMarkerVisible([{ x: 0, y: 0 }], [])).toEqual({ markerStart: false, markerEnd: false });
    const missingStart = new Array<{ x: number; y: number }>(2);
    missingStart[1] = { x: 1, y: 1 };
    const missingEnd = new Array<{ x: number; y: number }>(2);
    missingEnd[0] = { x: 0, y: 0 };
    const markerSegment = [{ a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }];
    expect(topologyPreviewMarkerVisible(missingStart, markerSegment)).toEqual({ markerStart: false, markerEnd: false });
    expect(topologyPreviewMarkerVisible(missingEnd, markerSegment)).toEqual({ markerStart: false, markerEnd: false });
    expect(topologyPreviewMarkerVisible(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      [{ a: { x: 10, y: 0 }, b: { x: 90, y: 0 } }],
    )).toEqual({ markerStart: false, markerEnd: false });
  });

  it("clips vertical, diagonal, endpoint-contained and sequential fallback geometry", () => {
    const vertical = topologyPreviewVisibleSegments(
      [{ x: 10, y: 0 }, { x: 10, y: 100 }],
      [{ x: 0, y: 20, width: 20, height: 20 }],
    );
    expect(vertical).toEqual([
      { a: { x: 10, y: 0 }, b: { x: 10, y: 20 } },
      { a: { x: 10, y: 40 }, b: { x: 10, y: 100 } },
    ]);

    const diagonal = topologyPreviewVisibleSegments(
      [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      [{ x: 40, y: 40, width: 20, height: 20 }],
    );
    expect(diagonal).toEqual([
      { a: { x: 0, y: 0 }, b: { x: 40, y: 40 } },
      { a: { x: 60, y: 60 }, b: { x: 100, y: 100 } },
    ]);

    expect(topologyPreviewVisibleSegments(
      [{ x: 50, y: 10 }, { x: 100, y: 10 }],
      [{ x: 40, y: 0, width: 20, height: 20 }],
    )).toEqual([{ a: { x: 60, y: 10 }, b: { x: 100, y: 10 } }]);
    expect(topologyPreviewVisibleSegments(
      [{ x: 0, y: 10 }, { x: 50, y: 10 }],
      [{ x: 40, y: 0, width: 20, height: 20 }],
    )).toEqual([{ a: { x: 0, y: 10 }, b: { x: 40, y: 10 } }]);

    expect(topologyPreviewVisibleSegments(
      [{ x: 0, y: 30 }, { x: 100, y: 30 }],
      [{ x: 20, y: 0, width: 20, height: 20 }],
    )).toEqual([{ a: { x: 0, y: 30 }, b: { x: 100, y: 30 } }]);
    expect(topologyPreviewVisibleSegments(
      [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      [{ x: 10, y: 0, width: 1, height: 1 }],
    )).toEqual([{ a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }]);
    expect(topologyPreviewVisibleSegments(
      [{ x: 0, y: 10 }, { x: 100, y: 10 }],
      [
        { x: 20, y: 0, width: 20, height: 20 },
        { x: 60, y: 0, width: 20, height: 20 },
      ],
    )).toEqual([
      { a: { x: 0, y: 10 }, b: { x: 20, y: 10 } },
      { a: { x: 40, y: 10 }, b: { x: 60, y: 10 } },
      { a: { x: 80, y: 10 }, b: { x: 100, y: 10 } },
    ]);
    expect(topologyPreviewVisibleSegments(
      [{ x: 10, y: 10 }, { x: 10, y: 10 }],
      [{ x: 0, y: 0, width: 20, height: 20 }],
    )).toEqual([]);

    const sparse = new Array<{ x: number; y: number }>(2);
    sparse[1] = { x: 100, y: 100 };
    expect(topologyPreviewVisibleSegments(sparse, [])).toEqual([]);
    expect(topologyPreviewMarkerVisible([{ x: 0, y: 0 }, { x: 1, y: 1 }], new Array(1))).toEqual({ markerStart: false, markerEnd: false });
  });

  it("resolves badge and boundary helper fallbacks for incomplete but readable topology data", () => {
    const topology = sample();
    const node = topology.nodes[0]!;
    expect(topologyNodeBadgeValues({ ...topology, types: [] }, node)).toEqual([]);

    topology.types[0]!.attrs = [
      { key: "zeta", label: "Zeta", valueType: "number", badge: true, order: 1, required: false, unit: "units" },
      { key: "alpha", label: "Alpha", valueType: "string", badge: true, order: 1, required: false },
      { key: "omitted", label: "Omitted", valueType: "string", badge: true, order: 2, required: false },
      { key: "hidden", label: "Hidden", valueType: "string", badge: false, order: 3, required: false },
    ];
    node.attrs = { zeta: 0, alpha: ["red", "blue"], hidden: "not a badge" };
    expect(topologyNodeBadgeValues(topology, node)).toEqual([
      { label: "Alpha", value: "red, blue" },
      { label: "Zeta", value: "0 units" },
    ]);

    const missingParent = { ...node, parentId: "missing-parent", boundaryIds: ["orphan-boundary"] };
    expect(inheritedBoundaryIds(topology, missingParent)).toEqual(["orphan-boundary"]);
    expect(topologyNodeBoundaryLabels({ ...topology, boundaries: [] }, missingParent)).toEqual(["orphan-boundary"]);

    const hierarchy = sample();
    hierarchy.boundaries = [
      { id: "parent", label: "Parent", kind: "site", description: "" },
      { id: "child", label: "Child", kind: "network", parentId: "parent", description: "" },
    ];
    hierarchy.nodes[0]!.boundaryIds = ["child", "parent"];
    hierarchy.nodes[1]!.parentId = hierarchy.nodes[0]!.id;
    expect(inheritedBoundaryIds(hierarchy, hierarchy.nodes[1]!)).toEqual(["child", "parent"]);
    expect(topologyNodeBoundaryLabels(hierarchy, hierarchy.nodes[1]!)).toEqual(["Child", "Parent"]);

    hierarchy.nodes[0]!.parentId = hierarchy.nodes[1]!.id;
    expect(inheritedBoundaryIds(hierarchy, hierarchy.nodes[0]!)).toEqual(["child", "parent"]);
  });

  it("preserves stable fallback results when duplicate route IDs compare equal", () => {
    const topology = sample();
    topology.edges = [
      { ...topology.edges[0]!, id: "same" },
      { ...topology.edges[0]!, id: "same", label: "duplicate fixture edge" },
    ];
    const result = computeStraightTopologyLayout(topology);

    expect(Object.keys(result.routes ?? {})).toEqual(["same"]);
    expect(result.routes?.same?.fallback).toBe("timeout");
    expect(result.routeDiagnostics?.routeFailures).toEqual([
      { edgeId: "same", reason: "timeout" },
      { edgeId: "same", reason: "timeout" },
    ]);
    expect(result.routeDiagnostics?.unroutedEdgeIds).toEqual(["same", "same"]);
  });

  it("places protocol/port labels, hides invalid routes and stops at shared deadlines", () => {
    const topology = sample();
    topology.edges = [{
      id: "labeled",
      source: "a",
      target: "b",
      kind: "traffic",
      label: "API",
      protocol: "HTTPS",
      port: 443,
      direction: "uni",
      evidence: "documented",
      description: "",
      tags: [],
    }];
    const layout = layoutTopology(topology);
    const edge = topology.edges[0]!;
    expect(reserveRouteLabelDimensions(edge)).toMatchObject({ text: "API · HTTPS :443", height: 22 });

    const routeMap: Record<string, TopologyRoute> = {
      labeled: {
        edgeId: "labeled",
        source: "a",
        target: "b",
        sourceSide: "right",
        targetSide: "left",
        points: [{ x: 280, y: 192 }, { x: 120, y: 192 }],
        status: "routed",
      },
    };
    const placed = placeTopologyRouteLabels([edge], routeMap, layout, { positionStep: 8 });
    expect(placed.labels.labeled).toBeDefined();

    const fallback = placeTopologyRouteLabels([edge], {
      labeled: { ...routeMap.labeled!, status: "fallback", renderMode: "straight", fallback: "timeout" },
    }, layout);
    expect(fallback.labels.labeled?.hidden).toBe(true);

    const missing = placeTopologyRouteLabels([edge], {}, layout);
    expect(missing.labels.labeled).toMatchObject({ hidden: true, reason: "no_horizontal_segment" });

    const timed = placeTopologyRouteLabels([edge], routeMap, layout, { deadline: 0, clock: () => 0 });
    expect(timed.labels.labeled).toMatchObject({ hidden: true, reason: "timeout" });

    const invalid = reserveRouteLabelDimensions(edge, { measureText: () => Number.POSITIVE_INFINITY });
    expect([invalid.width, invalid.height].every(Number.isFinite)).toBe(false);
  });

  it("builds counted cross-layer bundles and covers missing, timeout and resource-limit fallbacks", () => {
    const topology: Topology = {
      ...sample(),
      title: "Bundle overlay fixture",
      layers: [
        { id: "cloud", label: "Cloud", provider: "Fixture", order: 0, description: "" },
        { id: "edge", label: "Edge", provider: "Fixture", order: 1, description: "" },
      ],
      nodes: [
        { id: "a", type: "host", label: "A", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
        { id: "b", type: "host", label: "B", layerId: "edge", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      ],
      edges: [{ id: "cross", source: "a", target: "b", kind: "traffic", label: "HTTPS", protocol: "HTTPS", port: 443, direction: "bi", evidence: "documented", description: "", tags: [] }],
    };
    const layout = layoutTopology(topology);

    const bundles = buildTopologyLayerPairBundles(topology, layout, topology.edges);
    expect(bundles.bundles).toHaveLength(1);
    expect(bundles.bundles[0]).toMatchObject({ count: 1, edgeIds: ["cross"], layerIds: ["cloud", "edge"] });

    const filtered = buildTopologyLayerPairBundles(topology, layout, []);
    expect(filtered.bundles).toEqual([]);

    const missing = routeTopologyLayerPairBundle("missing", "edge", layout);
    expect(missing).toEqual({ points: null, fallback: "no_path" });

    const timed = routeTopologyLayerPairBundle("cloud", "edge", layout, { deadline: 0, clock: () => 0 });
    expect(timed.fallback).toBe("timeout");
    expect(timed.points).toHaveLength(2);

    const expiredContext = createTopologyBundleRouteContext(layout, { deadline: 0, clock: () => 0 });
    expect(expiredContext).toMatchObject({ grid: null, failure: "timeout" });

    const limitedContext = createTopologyBundleRouteContext(layout, { maxBytes: 1 });
    expect(limitedContext.resourceLimit === true || limitedContext.grid !== null).toBe(true);
  });

  it("returns no_path for enclosed endpoints and resource-limit fallbacks for a bounded grid", () => {
    const topology: Topology = {
      ...sample(),
      nodes: [
        { id: "a", type: "host", label: "A", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
        { id: "b", type: "host", label: "B", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
        { id: "left", type: "host", label: "Left", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
        { id: "right", type: "host", label: "Right", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
        { id: "top", type: "host", label: "Top", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
        { id: "bottom", type: "host", label: "Bottom", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      ],
    };
    const layout = layoutTopology(topology);
    layout.positions = {
      a: { x: 100, y: 100, width: 100, height: 100 },
      b: { x: 300, y: 100, width: 100, height: 100 },
      left: { x: 0, y: 100, width: 100, height: 100 },
      right: { x: 200, y: 100, width: 100, height: 100 },
      top: { x: 100, y: 0, width: 100, height: 100 },
      bottom: { x: 100, y: 200, width: 100, height: 100 },
    };

    const enclosed = routeTopology(topology, layout, { layoutTimeoutMs: 1000, edgeTimeoutMs: 100, maxBytes: 20_000_000 });
    expect(enclosed.routes["a-b"]?.fallback).toBe("no_path");
    expect(enclosed.diagnostics.routeFailures).toContainEqual({ edgeId: "a-b", reason: "no_path" });

    const limited = routeTopology(sample(), layoutTopology(sample()), { maxBytes: 1, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    expect(["resource-limit", "timeout"]).toContain(limited.diagnostics.status);
    expect(limited.routes["a-b"]?.fallback).toBeDefined();
  });

  it("routes complete, missing-position and deadline-timeout results deterministically", () => {
    const topology = sample();
    const layout = layoutTopology(topology);

    const complete = routeTopology(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    expect(complete.diagnostics.status).toBe("complete");
    expect(Object.keys(complete.routes)).toEqual(["a-b"]);

    const missingLayout = layoutTopology(topology);
    missingLayout.positions = {};
    const missing = routeTopology(topology, missingLayout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    expect(missing.routes["a-b"]).toBeUndefined();

    const missingTimed = routeTopology(topology, missingLayout, { clock: () => 100, layoutTimeoutMs: 0, edgeTimeoutMs: 20 });
    expect(missingTimed.diagnostics.status).toBe("timeout");
    expect(missingTimed.routes["a-b"]?.fallback).toBe("no_path");

    const timed = routeTopology(topology, layout, { clock: () => 100, layoutTimeoutMs: 0, edgeTimeoutMs: 20 });
    expect(timed.diagnostics.status).toBe("timeout");
    expect(timed.routes["a-b"]?.fallback).toBe("timeout");
  });

  it("cancels cooperative routing before preparation and yields a complete cooperative result", async () => {
    const topology = sample();
    const layout = layoutTopology(topology);

    const cancelled = await routeTopologyCooperative(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 }, () => true, 20, async () => undefined);
    expect(cancelled).toBeUndefined();

    const progress: Array<{ phase: string; routedEdges: number }> = [];
    const complete = await routeTopologyCooperative(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 }, () => false, 20, async () => undefined, (entry) => progress.push(entry));
    expect(complete?.diagnostics.status).toBe("complete");
    expect(progress.at(-1)?.phase).toBe("complete");
  });

  it("caches a complete worker result and dispose terminates the retained worker", () => {
    vi.useFakeTimers();
    const topology = sample();
    let sent: LayoutWorkerRequest | undefined;
    const worker = mockWorker((message) => { sent = message; });
    const runtime = new TopologyLayoutRuntime(() => worker);
    const first = vi.fn();

    runtime.request({ topology, viewId: "cache" }, first);
    const result = computeTopologyLayout(topology);
    worker.onmessage?.({
      data: { requestId: sent?.requestId ?? "layout-1", layoutVersion: LAYOUT_VERSION, ok: true, result },
    } as MessageEvent<LayoutWorkerResponse>);

    const cached = vi.fn();
    runtime.request({ topology, viewId: "cache" }, cached);
    expect(cached).toHaveBeenCalledOnce();
    expect(cached).toHaveBeenCalledWith(result);
    expect(worker.postMessage).toHaveBeenCalledOnce();

    runtime.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("cancel clears pending timers and onerror/dispose without a pending reply are harmless", () => {
    vi.useFakeTimers();
    const topology = sample();
    const worker = mockWorker(() => undefined);
    const runtime = new TopologyLayoutRuntime(() => worker);

    const requestId = runtime.request({ topology }, vi.fn());
    runtime.cancelRequest(requestId);
    worker.onerror?.({} as ErrorEvent);
    runtime.dispose();
    vi.runOnlyPendingTimers();

    expect(worker.terminate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("worker ok-false response keeps straight preview and bounded synchronous route", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const worker = mockWorker((message, current) => {
      current.onmessage?.({
        data: { requestId: message.requestId, layoutVersion: LAYOUT_VERSION, ok: false, message: "worker failure" },
      } as never);
    });
    const sync = vi.fn(computeTopologyLayout);
    const callback = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => worker, sync);

    runtime.request({ topology }, callback);
    vi.runOnlyPendingTimers();

    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(sync).toHaveBeenCalledOnce();
    expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(callback.mock.calls[0]?.[0]?.routeDiagnostics?.status).toBe("timeout");

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("straight preview throw reports an error and leaves a healthy worker route able to finish", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    let sent: LayoutWorkerRequest | undefined;
    const worker = mockWorker((message) => { sent = message; });
    const straight = vi.fn(() => { throw new Error("preview crash"); });
    const callback = vi.fn();
    const onError = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => worker, undefined, straight);

    runtime.request({ topology }, callback, onError);
    vi.advanceTimersByTime(120);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "preview crash" }));

    const result = computeTopologyLayout(topology);
    worker.onmessage?.({
      data: { requestId: sent?.requestId ?? "layout-1", layoutVersion: LAYOUT_VERSION, ok: true, result },
    } as MessageEvent<LayoutWorkerResponse>);
    expect(callback).toHaveBeenCalledWith(result);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("worker factory throw falls back to straight preview and synchronous routing", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);
    const callback = vi.fn();
    const onError = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => { throw new Error("worker factory crash"); }, sync);

    runtime.request({ topology }, callback, onError);
    vi.runOnlyPendingTimers();

    expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(sync).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("cooperative rejection and cancellation keep stale results out of callbacks", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();

    let reject: ((error: unknown) => void) | undefined;
    const rejected = vi.fn(() => new Promise<TopologyLayoutResult | undefined>((_resolve, rejectFirst) => { reject = rejectFirst; }));
    const rejectedError = vi.fn();
    const rejectedRuntime = new TopologyLayoutRuntime(() => undefined, undefined, computeStraightTopologyLayout, rejected);
    rejectedRuntime.request({ topology, viewId: "reject" }, vi.fn(), rejectedError);
    await vi.runOnlyPendingTimersAsync();
    reject?.(new Error("cooperative rejection"));
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(rejectedError).toHaveBeenCalledWith(expect.objectContaining({ message: "cooperative rejection" }));

    let resolveCancelled: ((value: TopologyLayoutResult | undefined) => void) | undefined;
    const cancelled = vi.fn(() => new Promise<TopologyLayoutResult | undefined>((resolve) => { resolveCancelled = resolve; }));
    const cancelledCallback = vi.fn();
    const cancelledRuntime = new TopologyLayoutRuntime(() => undefined, undefined, computeStraightTopologyLayout, cancelled);
    const requestId = cancelledRuntime.request({ topology: { ...topology, revision: 2 }, viewId: "cancel" }, cancelledCallback);
    await vi.runOnlyPendingTimersAsync();
    cancelledRuntime.cancelRequest(requestId);
    resolveCancelled?.(computeTopologyLayout({ ...topology, revision: 2 }));
    await Promise.resolve();
    expect(cancelledCallback).toHaveBeenCalledOnce();
    expect(cancelledCallback.mock.calls[0]?.[0]?.routeDiagnostics?.status).toBe("timeout");

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("default Worker reports undefined for unavailable/constructor-failing environments", () => {
    vi.stubGlobal("Worker", undefined);
    expect(defaultTopologyLayoutWorker()).toBeUndefined();

    vi.stubGlobal("Worker", class {
      constructor() { throw new Error("constructor crash"); }
    });
    expect(defaultTopologyLayoutWorker()).toBeUndefined();

    vi.stubGlobal("Worker", class {
      onmessage = null;
      onerror = null;
      postMessage() {}
      terminate() {}
    });
    expect(defaultTopologyLayoutWorker()).toBeDefined();

    vi.unstubAllGlobals();
  });

  it("worker failure, version mismatch and postMessage throw publish bounded fallback only", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();

    const mismatch = mockWorker((message, worker) => {
      worker.onmessage?.({
        data: { requestId: message.requestId, layoutVersion: LAYOUT_VERSION + 1, ok: true, result: computeTopologyLayout(topology) },
      } as never);
    });
    const mismatchCallback = vi.fn();
    const mismatchRuntime = new TopologyLayoutRuntime(() => mismatch);
    mismatchRuntime.request({ topology }, mismatchCallback);
    vi.runOnlyPendingTimers();
    expect(mismatchCallback.mock.calls.length).toBeGreaterThanOrEqual(1);

    const postWorker: LayoutWorkerLike = {
      postMessage: vi.fn(() => { throw new Error("post crash"); }),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };
    const postError = vi.fn();
    const straight = vi.fn(computeStraightTopologyLayout);
    const sync = vi.fn(computeTopologyLayout);
    const postRuntime = new TopologyLayoutRuntime(() => postWorker, sync, straight);
    postRuntime.request({ topology: { ...topology, revision: 2 } }, vi.fn(), postError);
    vi.runOnlyPendingTimers();

    expect(postWorker.terminate).toHaveBeenCalled();
    expect(straight).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("routes cooperatively with the injected router clock and reports complete progress", async () => {
    const progress: Array<{ phase: string; routedEdges: number }> = [];
    const result = await computeTopologyLayoutCooperative(sample(), {}, {
      routerOptions: { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 },
      yieldControl: async () => undefined,
      onProgress: (entry) => progress.push(entry),
    });

    expect(result?.routeDiagnostics?.status).toBe("complete");
    expect(Object.keys(result?.routes ?? {})).toEqual(["a-b"]);
    expect(progress.at(-1)?.phase).toBe("complete");
    expect(progress.at(-1)?.routedEdges).toBe(1);
  });

  it("recovers an active worker error with one straight preview and bounded sync route", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const worker = mockWorker(() => undefined);
    const sync = vi.fn(computeTopologyLayout);
    const callback = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => worker, sync);

    runtime.request({ topology }, callback);
    worker.onerror?.({} as ErrorEvent);
    vi.runOnlyPendingTimers();

    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(sync).toHaveBeenCalledOnce();
    expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(callback.mock.calls[0]?.[0]?.routeDiagnostics?.status).toBe("timeout");
    expect(callback.mock.calls.at(-1)?.[0]?.routeDiagnostics?.status).toBe("complete");

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("worker failure timeout preview and clipped canvas geometry remain complete-shaped", () => {
    const topology = sample();
    topology.edges = [
      ...topology.edges,
      { id: "ghost", source: "a", target: "missing", kind: "uses", label: "Ghost", direction: "uni", evidence: "documented", description: "", tags: [] },
    ];
    const preview = computeStraightTopologyLayout(topology);

    expect(Object.keys(preview.routes ?? {}).sort()).toEqual(["a-b", "ghost"]);
    expect(preview.routes?.ghost).toMatchObject({ points: [], status: "fallback", fallback: "timeout" });
    expect(preview.routeDiagnostics?.unroutedEdgeIds).toEqual(["a-b", "ghost"]);

    const layout = layoutTopology(topology);
    const protectedRects = [
      ...Object.values(layout.positions).map((rect) => ({ x: rect.x - 3, y: rect.y - 3, width: rect.width + 6, height: rect.height + 6 })),
      ...layout.lanes.map((lane) => ({ x: lane.x - 3, y: lane.y - 3, width: lane.width + 6, height: lane.height + 6 })),
    ];
    for (const route of Object.values(preview.routes ?? {})) {
      for (const segment of topologyPreviewVisibleSegments(route.points, protectedRects)) {
        expect([segment.a.x, segment.a.y, segment.b.x, segment.b.y].every(Number.isFinite)).toBe(true);
      }
    }
  });
});
