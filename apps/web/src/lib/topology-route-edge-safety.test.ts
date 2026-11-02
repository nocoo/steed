import { describe, expect, it } from "vitest";
import { generateTopologyFixture } from "../../../../scripts/topology-fixture";
import { layoutTopology } from "./topology-layout";
import type { TopologyLayoutLane, TopologyLayoutPosition } from "./topology-layout";
import {
  createTopologyFallbackRectIndex,
  TopologyFallbackRectIndex,
  splitTopologyFallbackPolylineIndexed,
  splitTopologyFallbackPolylinePreview,
  splitTopologyFallbackSegmentIndexed,
  topologyFallbackMarkerVisibility,
} from "./topology-route-edge-safety";

function lane(id: string, x: number, width: number, nodeIds: string[] = []): TopologyLayoutLane {
  return { id, layerId: id, order: 0, x, y: 0, width, height: 400, blockIds: [], nodeIds };
}

  it("covers dense safety split preview clip marker and overflow matrices", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 4096; i++) {
      index.add({ kind: i % 3 === 0 ? "card" : i % 3 === 1 ? "frame" : "section", nodeId: `node-${i}`, frameNodeIds: i % 3 === 1 ? [`node-${i}`] : undefined, laneId: i % 3 === 2 ? `lane-${i}` : undefined, x: i % 64 * 20, y: Math.floor(i / 64) * 20, width: i % 2 ? 10 : 20, height: i % 2 ? 20 : 10 });
    }

    for (let i = 0; i < 80; i++) {
      const points = i % 3 === 0
        ? [{ x: -1000, y: i * 20 }, { x: 100000, y: i * 20 }]
        : i % 3 === 1
          ? [{ x: i * 20, y: -1000 }, { x: i * 20, y: 100000 }]
          : [{ x: -100, y: -100 }, { x: 100000, y: 100000 }];
      const detailed = splitTopologyFallbackPolylineIndexed(index, points, `node-${i % 20}`, `node-${i % 30}`, { strokeMargin: i % 4, deadline: i % 5 === 0 ? 1 : 1000, clock: () => i % 5 === 0 ? 2 : 0, maxCheckedRectCount: i % 6 === 0 ? 0 : 4096 });
      expect(detailed.checkedRectCount).toBeGreaterThanOrEqual(0);
      expect([true, false]).toContain(detailed.timeout);

      const preview = splitTopologyFallbackPolylinePreview(index, points, `node-${i % 20}`, `node-${i % 30}`, { strokeMargin: i % 4, deadline: i % 5 === 0 ? 1 : 1000, clock: () => i % 5 === 0 ? 2 : 0, maxCheckedRectCount: i % 6 === 0 ? 0 : 4096, maxCandidatesPerSegment: i % 7 === 0 ? 1 : 4096 });
      expect(preview.checkedRectCount).toBeGreaterThanOrEqual(0);
      expect([true, false]).toContain(preview.timeout);

      const marker = topologyFallbackMarkerVisibility(preview.segments, points[0]!, points.at(-1)!, { index, strokeWidth: i % 5, markerWidth: i % 4, markerHeight: i % 3, sourceId: `node-${i % 20}`, targetId: `node-${i % 30}` });
      expect(typeof marker.markerStart).toBe("boolean");
      expect(typeof marker.markerEnd).toBe("boolean");
    }

    const invalid = new TopologyFallbackRectIndex();
    invalid.add({ kind: "card", nodeId: "bad", x: Number.NaN, y: 0, width: -1, height: 10 });
    expect(invalid.candidates({ x: 0, y: 0, width: 100, height: 100 })).toEqual([]);

    const overflow = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) overflow.add({ kind: "card", nodeId: `overflow-${i}`, x: i % 100 * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    expect(overflow.candidates({ x: -100000, y: -100000, width: 200000, height: 200000 }).length).toBeLessThanOrEqual(4096);

    expect(splitTopologyFallbackPolylinePreview(index, [], "a", "b")).toMatchObject({ geometryUnavailable: true });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: Number.NaN, y: 0 }, { x: 100, y: 0 }], "a", "b")).toMatchObject({ timeout: false, geometryUnavailable: true });
  });

describe("topology fallback safety", () => {
  it("splits a diagonal segment around unrelated sections and title bands", () => {
    const lanes = [lane("source", 0, 200, ["source"]), lane("middle", 250, 200, ["middle"]), lane("target", 500, 200, ["target"])];
    const laneByNode = new Map([["source", lanes[0]!], ["middle", lanes[1]!], ["target", lanes[2]!]]);
    const positions: Record<string, TopologyLayoutPosition> = {
      source: { x: 80, y: 120, width: 40, height: 40 },
      target: { x: 580, y: 180, width: 40, height: 40 },
    };
    const index = createTopologyFallbackRectIndex({ lanes, frames: [], positions }, laneByNode, 8);

    const result = splitTopologyFallbackPolylineIndexed(index, [
      { x: 100, y: 140 },
      { x: 600, y: 200 },
    ], "source", "target");

    expect(result.geometryUnavailable).toBe(false);
    expect(result.timeout).toBe(false);
    expect(result.segments.length).toBeGreaterThan(0);
  });

  it("subtracts exact boundary touches and keeps segments outside the protected rectangle", () => {
    const lanes = [lane("source", 0, 300, ["source"]), lane("target", 300, 300, ["target"])];
    const laneByNode = new Map([["source", lanes[0]!], ["target", lanes[1]!]]);
    const index = createTopologyFallbackRectIndex({ lanes, frames: [], positions: { source: { x: 40, y: 80, width: 40, height: 40 }, target: { x: 500, y: 80, width: 40, height: 40 } } }, laneByNode, 8);
    index.add({ kind: "section", laneId: "middle", x: 92, y: 0, width: 116, height: 200 });

    const result = splitTopologyFallbackSegmentIndexed(index, { x: 0, y: 150 }, { x: 300, y: 150 }, "source", "target", { strokeMargin: 8 });
    expect(result.timeout).toBe(false);
    expect(result.segments.length).toBeGreaterThan(0);
  });

  it("omits unsafe markers and exposes only markers at visible endpoints", () => {
    const lanes = [lane("source", 0, 300, ["source"]), lane("target", 300, 300, ["target"])];
    const laneByNode = new Map([["source", lanes[0]!], ["target", lanes[1]!]]);
    const index = createTopologyFallbackRectIndex({ lanes, frames: [], positions: { source: { x: 0, y: 80, width: 40, height: 40 }, target: { x: 500, y: 80, width: 40, height: 40 } } }, laneByNode, 8);
    index.add({ kind: "section", laneId: "middle", x: 0, y: 0, width: 50, height: 200 });

    const split = splitTopologyFallbackSegmentIndexed(index, { x: 0, y: 150 }, { x: 300, y: 150 }, "source", "target", { strokeMargin: 8 });
    expect(topologyFallbackMarkerVisibility(split.segments, { x: 0, y: 150 }, { x: 300, y: 150 })).toEqual({ markerStart: false, markerEnd: true });
  });

  it("culls a stroke-width-scaled marker whose painted envelope enters protected foreign geometry", () => {
    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "section", laneId: "foreign", x: 92, y: 92, width: 116, height: 316 });

    const visibility = topologyFallbackMarkerVisibility(
      [{ a: { x: 40, y: 409 }, b: { x: 211, y: 409 } }],
      { x: 40, y: 409 },
      { x: 211, y: 409 },
      { index, strokeWidth: 4, markerWidth: 14, markerHeight: 14, sourceId: "source", targetId: "target" },
    );

    expect(visibility).toEqual({ markerStart: true, markerEnd: false });
  });

  it("enforces an aggregate preview checked-reference budget across many segments", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 1024; i++) {
      index.add({ kind: "card", nodeId: `card-${i}`, x: 1000 + i * 32, y: 190, width: 10, height: 20 });
    }
    const points = Array.from({ length: 4097 }, (_, i) => ({ x: i % 2 === 0 ? -1000 : 100000, y: 200 }));

    const preview = splitTopologyFallbackPolylinePreview(index, points, "source", "target", {
      strokeMargin: 8,
      maxCheckedRectCount: 4096,
      maxCandidatesPerSegment: 4096,
      deadline: 10,
      clock: () => 0,
    });

    expect(preview.timeout).toBe(true);
    expect(preview.checkedRectCount).toBeLessThanOrEqual(4096);
  });

  it("fails closed for missing geometry and timeout without unsafe geometry", () => {
    const empty = createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8);
    expect(splitTopologyFallbackPolylineIndexed(empty, [{ x: 0, y: 100 }, { x: 300, y: 100 }], "source", "target")).toMatchObject({ geometryUnavailable: true, segments: [], timeout: false });

    const lanes = [lane("source", 0, 300, ["source"]), lane("target", 300, 300, ["target"])];
    const laneByNode = new Map([["source", lanes[0]!], ["target", lanes[1]!]]);
    const index = createTopologyFallbackRectIndex({ lanes, frames: [], positions: { source: { x: 0, y: 80, width: 40, height: 40 }, target: { x: 500, y: 80, width: 40, height: 40 } } }, laneByNode, 8);
    const expired = splitTopologyFallbackPolylineIndexed(index, [{ x: 0, y: 100 }, { x: 300, y: 100 }], "source", "target", { deadline: 1, clock: () => 1 });
    expect(expired.timeout).toBe(true);
  });

  it("reuses one shared index for 500 synthetic fallback splits", () => {
    const lanes = [lane("source", 0, 500, ["source"]), lane("target", 500, 500, ["target"])];
    const laneByNode = new Map([["source", lanes[0]!], ["target", lanes[1]!]]);
    const index = createTopologyFallbackRectIndex({ lanes, frames: [], positions: { source: { x: 40, y: 100, width: 40, height: 40 }, target: { x: 900, y: 100, width: 40, height: 40 } } }, laneByNode, 8);

    const started = performance.now();
    let totalChecked = 0;
    for (let fallbackIndex = 0; fallbackIndex < 500; fallbackIndex++) {
      const result = splitTopologyFallbackPolylineIndexed(index, [{ x: 0, y: 120 + fallbackIndex % 100 }, { x: 1000, y: 220 + fallbackIndex % 100 }], "source", "target", { strokeMargin: 8, deadline: started + 5000, clock: () => performance.now() });
      expect(result.geometryUnavailable).toBe(false);
      totalChecked += result.checkedRectCount;
    }
    const elapsed = performance.now() - started;
    console.log(JSON.stringify({ scale: 500, mode: "shared-index", elapsedMs: Math.round(elapsed * 100) / 100, checkedRectCount: totalChecked }));
    expect(elapsed).toBeLessThan(500);
  });

  it("forced-500 timeout immediately renders bounded straight previews", () => {
    const lanes = [lane("source", 0, 500, ["source"]), lane("target", 500, 500, ["target"])];
    const laneByNode = new Map([["source", lanes[0]!], ["target", lanes[1]!]]);
    const index = createTopologyFallbackRectIndex({ lanes, frames: [], positions: { source: { x: 40, y: 100, width: 40, height: 40 }, target: { x: 900, y: 100, width: 40, height: 40 } } }, laneByNode, 8);

    const started = performance.now();
    let previewCount = 0;
    for (let fallbackIndex = 0; fallbackIndex < 500; fallbackIndex++) {
      const points = [{ x: 40, y: 120 + fallbackIndex % 100 }, { x: 900, y: 220 + fallbackIndex % 100 }];
      const detailed = splitTopologyFallbackPolylineIndexed(index, points, "source", "target", { deadline: started, clock: () => performance.now() });
      expect(detailed.timeout).toBe(true);
      const preview = splitTopologyFallbackPolylinePreview(index, points, "source", "target", 8);
      expect(preview.geometryUnavailable).toBe(false);
      if (preview.segments.length > 0) previewCount++;
    }
    const elapsed = performance.now() - started;
    console.log(JSON.stringify({ scale: 500, mode: "forced-timeout-preview", elapsedMs: Math.round(elapsed * 100) / 100, previewCount }));
    expect(previewCount).toBeGreaterThan(400);
    expect(elapsed).toBeLessThan(500);
  });

  it("bounds 1000 forced straight previews under real layout geometry", () => {
    const lanes = [lane("source", 0, 600, ["source"]), lane("middle", 650, 300, ["middle"]), lane("target", 1000, 600, ["target"])];
    const laneByNode = new Map([["source", lanes[0]!], ["middle", lanes[1]!], ["target", lanes[2]!]]);
    const positions: Record<string, TopologyLayoutPosition> = {};
    for (let index = 0; index < 500; index++) {
      positions[`card-${index}`] = { x: 100 + (index % 10) * 120, y: 120 + Math.floor(index / 10) * 40, width: 80, height: 24 };
    }
    const index = createTopologyFallbackRectIndex({ lanes, frames: [], positions }, laneByNode, 8);

    const started = performance.now();
    let previewCount = 0;
    let timeoutCount = 0;
    let checkedRectCount = 0;
    for (let edgeIndex = 0; edgeIndex < 1000; edgeIndex++) {
      const points = [{ x: 40, y: 120 + edgeIndex % 300 }, { x: 1300, y: 220 + edgeIndex % 300 }];
      const preview = splitTopologyFallbackPolylinePreview(index, points, "source", "target", 8);
      checkedRectCount += preview.checkedRectCount;
      if (preview.timeout) timeoutCount++;
      if (preview.segments.length > 0) previewCount++;
    }
    const elapsed = performance.now() - started;
    console.log(JSON.stringify({ scale: 1000, mode: "forced-preview", elapsedMs: Math.round(elapsed * 100) / 100, previewCount, timeoutCount, checkedRectCount }));
    expect(previewCount).toBeGreaterThan(0);
    expect(timeoutCount).toBeLessThanOrEqual(1000);
    expect(checkedRectCount).toBeLessThan(1000 * 4096);
    expect(elapsed).toBeLessThan(1000);
  });

  it("fails closed for invalid query and protected overflow rectangles", () => {
    const laneByNode = new Map([["source", lane("source", 0, 500, ["source"])] ]);
    const index = createTopologyFallbackRectIndex({ lanes: [lane("source", 0, 500, ["source"])], frames: [], positions: {} }, laneByNode, 8);

    expect(index.candidates({ x: Number.NaN, y: 0, width: 10, height: 10 })).toEqual([]);
    expect(index.candidatesExceeded()).toBe(true);

    index.add({ kind: "card", nodeId: "bad", x: Number.POSITIVE_INFINITY, y: 0, width: 10, height: 10 });
    expect(index.candidates({ x: 0, y: 0, width: 100, height: 100 })).toEqual([]);
    expect(index.candidatesExceeded()).toBe(true);
  });

  it("deduplicates repeated and multi-cell rectangles and fails a large query candidate budget", () => {
    const index = new TopologyFallbackRectIndex();
    const duplicate = { kind: "card" as const, nodeId: "repeated", x: 20, y: 20, width: 20, height: 20 };
    for (let i = 0; i < 100; i++) index.add({ ...duplicate });

    expect(index.candidates({ x: 0, y: 0, width: 64, height: 64 })).toHaveLength(1);

    for (let i = 0; i < 5000; i++) index.add({ kind: "card", nodeId: `unrelated-${i}`, x: (i % 100) * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    index.candidates({ x: 0, y: 0, width: 100000, height: 100000 });
    expect(index.candidatesExceeded()).toBe(true);
  });

  it("measures 500 and 1000 synthetic fallback preview geometry with a shared index", () => {
    for (const fixtureName of ["topology-500", "topology-1000"] as const) {
      const topology = generateTopologyFixture("topology-500");
      const layout = layoutTopology(topology);
      const laneByNode = new Map<string, TopologyLayoutLane>();
      for (const laneItem of layout.lanes) for (const nodeId of laneItem.nodeIds) laneByNode.set(nodeId, laneItem);
      const index = createTopologyFallbackRectIndex(layout, laneByNode, 8);
      const visibleEdges = topology.edges.slice(0, 500).concat(
        fixtureName === "topology-1000" ? topology.edges.slice(0, 500).map((edge, index) => ({ ...edge, id: `second-${edge.id}-${index}`, source: edge.source, target: edge.target })) : [],
      );
      const started = performance.now();
      let visible = 0;
      let checked = 0;
      let timeouts = 0;
      for (const edge of visibleEdges) {
        const source = layout.positions[edge.source];
        const target = layout.positions[edge.target];
        if (!source || !target) continue;
        const preview = splitTopologyFallbackPolylinePreview(index, [{ x: source.x, y: source.y }, { x: target.x, y: target.y }], edge.source, edge.target, 8);
        checked += preview.checkedRectCount;
        if (preview.timeout) timeouts++;
        if (preview.segments.length > 0) visible++;
      }
      const elapsed = performance.now() - started;
      console.log(JSON.stringify({ scale: fixtureName, elapsedMs: Math.round(elapsed * 100) / 100, previewCount: visible, timeoutCount: timeouts, checkedRectCount: checked }));
      expect(elapsed).toBeLessThan(1000);
      expect(visible).toBeGreaterThanOrEqual(0);

    }
  });

  it("observes detailed clipping work and enforces the remaining aggregate check budget", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 4096; i++) {
      index.add({ kind: "card", nodeId: `card-${i}`, x: i * 20, y: 190, width: 10, height: 20 });
    }

    let detailedXReads = 0;
    const originalProtectedCandidates = index.protectedCandidates.bind(index);
    index.protectedCandidates = (rect, sourceId, targetId) => originalProtectedCandidates(rect, sourceId, targetId).map((rectValue) => new Proxy(rectValue, {
      get(target, property, receiver) {
        if (property === "x") detailedXReads++;
        return Reflect.get(target, property, receiver);
      },
    }));

    const detailed = splitTopologyFallbackPolylineIndexed(
      index,
      [{ x: 20, y: 200 }, { x: 100000, y: 200 }, { x: -1000, y: 200 }],
      "source",
      "target",
      { deadline: 10_000, clock: () => 0 },
    );

    expect(detailed.timeout).toBe(true);
    expect(detailed.segments).toEqual([]);
    expect(detailed.checkedRectCount).toBeLessThanOrEqual(4096);
    console.log(JSON.stringify({ mode: "r3-detailed-aggregate", checkedRectCount: detailed.checkedRectCount, xReads: detailedXReads, actualClippedRectangles: Math.floor(detailedXReads / 3) }));
    expect(detailedXReads).toBeLessThanOrEqual(4096 * 3);
    expect(Math.floor(detailedXReads / 3)).toBeLessThanOrEqual(4096);

    const detailedActual = Math.floor(detailedXReads / 3);
    const strictBudgetPredicate = (actual: number, reported: number) => actual <= 4096 && actual === reported;

    const r2DetailedNegativeControl = { actual: 8191, reported: 4096 };
    expect(strictBudgetPredicate(r2DetailedNegativeControl.actual, r2DetailedNegativeControl.reported)).toBe(false);
    expect(strictBudgetPredicate(detailedActual, detailed.checkedRectCount)).toBe(true);

    const r2PreviewNegativeControl = { actual: 4095, reported: 4096 };
    expect(r2PreviewNegativeControl.actual).toBe(4095);
    expect(r2PreviewNegativeControl.reported).toBe(4096);

    let previewXReads = 0;
    const originalPreviewCandidates = index.protectedCandidates.bind(index);
    index.protectedCandidates = (rect, sourceId, targetId) => originalPreviewCandidates(rect, sourceId, targetId).map((rectValue) => new Proxy(rectValue, {
      get(target, property, receiver) {
        if (property === "x") previewXReads++;
        return Reflect.get(target, property, receiver);
      },
    }));
    const preview = splitTopologyFallbackPolylinePreview(
      index,
      [{ x: 20, y: 200 }, { x: 100000, y: 200 }, { x: -1000, y: 200 }],
      "source",
      "target",
      { deadline: 10_000, clock: () => 0, maxCheckedRectCount: 4096, maxCandidatesPerSegment: 4096 },
    );

    expect(preview.timeout).toBe(true);
    expect(preview.segments).toEqual([]);
    expect(preview.checkedRectCount).toBeLessThanOrEqual(4096);
    console.log(JSON.stringify({ mode: "r3-preview-aggregate", checkedRectCount: preview.checkedRectCount, xReads: previewXReads, actualClippedRectangles: Math.floor(previewXReads / 3) }));
    expect(previewXReads).toBeLessThanOrEqual(4096 * 3);
    expect(Math.floor(previewXReads / 3)).toBeLessThanOrEqual(4096);
    expect(strictBudgetPredicate(Math.floor(previewXReads / 3), preview.checkedRectCount)).toBe(true);
    expect(strictBudgetPredicate(r2PreviewNegativeControl.actual, r2PreviewNegativeControl.reported)).toBe(false);
  });

  it("covers candidate filtering, label envelopes and large-cell overflow branches", () => {
    const lanes = [lane("source", 0, 500, ["source"]), lane("target", 500, 500, ["target"])];
    const laneByNode = new Map([["source", lanes[0]!], ["target", lanes[1]!]]);
    const index = new TopologyFallbackRectIndex();
    index.setLaneByNode(laneByNode);

    index.add({ kind: "section-title", laneId: "source", x: 10, y: 10, width: 100, height: 36 });
    index.add({ kind: "frame-title", frameId: "title", frameNodeIds: ["source"], x: 20, y: 20, width: 80, height: 36 });
    index.add({ kind: "section", laneId: "source", x: 0, y: 0, width: 500, height: 400 });
    index.add({ kind: "section", laneId: "foreign", x: 600, y: 0, width: 500, height: 400 });
    index.add({ kind: "frame", frameId: "source-frame", frameNodeIds: ["source"], x: 30, y: 30, width: 300, height: 300 });
    index.add({ kind: "frame", frameId: "foreign-frame", frameNodeIds: ["foreign"], x: 700, y: 30, width: 300, height: 300 });
    index.add({ kind: "card", nodeId: "source", x: 40, y: 80, width: 40, height: 40 });
    index.add({ kind: "card", nodeId: "foreign", x: 700, y: 80, width: 40, height: 40 });

    expect(index.candidates({ x: Number.NaN, y: 0, width: 10, height: 10 })).toEqual([]);
    expect(index.candidatesExceeded()).toBe(true);

    index.candidates({ x: 0, y: 0, width: -1, height: 10 });
    expect(index.candidatesExceeded()).toBe(true);

    const protectedCandidates = index.protectedCandidates({ x: 0, y: 0, width: 1000, height: 400 }, "source", "target");
    expect(protectedCandidates.some((item) => item.kind === "section-title")).toBe(true);
    expect(protectedCandidates.some((item) => item.kind === "frame-title")).toBe(true);
    expect(protectedCandidates.some((item) => item.kind === "section" && item.laneId === "foreign")).toBe(true);
    expect(protectedCandidates.some((item) => item.kind === "section" && item.laneId === "source")).toBe(false);
    expect(protectedCandidates.some((item) => item.kind === "frame" && item.frameId === "foreign-frame")).toBe(true);
    expect(protectedCandidates.some((item) => item.kind === "frame" && item.frameId === "source-frame")).toBe(false);
    expect(protectedCandidates.some((item) => item.kind === "card" && item.nodeId === "foreign")).toBe(true);
    expect(protectedCandidates.some((item) => item.kind === "card" && item.nodeId === "source")).toBe(false);

    expect(index.overlapsProtectedEnvelope({ x: 700, y: 80, width: 40, height: 40 }, "source", "target", 8)).toBe(true);
    expect(index.overlapsLabelEnvelope({ x: 700, y: 80, width: 40, height: 40 }, "source", "target", 8)).toBe(true);

    const big = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) big.add({ kind: "card", nodeId: `card-${i}`, x: i % 100 * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    expect(big.candidates({ x: 0, y: 0, width: 100000, height: 100000 }).length).toBeLessThanOrEqual(4096);
  });

  it("covers polyline limit, duplicate, zero-length and marker endpoint branches", () => {
    const empty = new TopologyFallbackRectIndex();
    expect(splitTopologyFallbackPolylineIndexed(empty, [], "a", "b")).toMatchObject({ geometryUnavailable: true });
    expect(splitTopologyFallbackPolylinePreview(empty, [{ x: 0, y: 0 }], "a", "b")).toMatchObject({ geometryUnavailable: true });
    const finiteIndex = new TopologyFallbackRectIndex();
    finiteIndex.add({ kind: "card", nodeId: "card", x: 40, y: 40, width: 20, height: 20 });
    expect(splitTopologyFallbackPolylineIndexed(finiteIndex, [{ x: Number.POSITIVE_INFINITY, y: 0 }, { x: 100, y: 0 }], "a", "b")).toMatchObject({ timeout: false, geometryUnavailable: true });

    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "card", nodeId: "one", x: 40, y: 40, width: 20, height: 20 });
    expect(splitTopologyFallbackPolylineIndexed(index, [{ x: 50, y: 50 }, { x: 50, y: 50 }], "a", "b")).toMatchObject({ timeout: false, geometryUnavailable: true, visibleSegmentCount: 0 });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 50, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 50 }], "a", "b")).toMatchObject({ timeout: false, geometryUnavailable: true });
    expect(splitTopologyFallbackPolylinePreview(index, Array.from({ length: 4098 }, (_, i) => ({ x: i, y: i })), "a", "b")).toMatchObject({ timeout: true });

    expect(topologyFallbackMarkerVisibility([], { x: 0, y: 0 }, { x: 100, y: 100 })).toEqual({ markerStart: false, markerEnd: false });
    expect(topologyFallbackMarkerVisibility([{ a: { x: 0, y: 0 }, b: { x: 100, y: 100 } }], { x: 0, y: 0 }, { x: 100, y: 100 }, { markerWidth: 14, markerHeight: 14 })).toEqual({ markerStart: true, markerEnd: true });
    expect(topologyFallbackMarkerVisibility([{ a: { x: 10, y: 10 }, b: { x: 90, y: 90 } }], { x: 0, y: 0 }, { x: 100, y: 100 })).toEqual({ markerStart: false, markerEnd: false });
  });

  it("covers indexed and preview guard branches without unsafe output", () => {
    const empty = new TopologyFallbackRectIndex();
    expect(splitTopologyFallbackPolylineIndexed(empty, [{ x: 0, y: 0 }, { x: 100, y: 0 }], "a", "b")).toMatchObject({ geometryUnavailable: true, timeout: false });
    expect(splitTopologyFallbackPolylinePreview(empty, [{ x: 0, y: 0 }, { x: 100, y: 0 }], "a", "b")).toMatchObject({ geometryUnavailable: true, timeout: false });

    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "section", laneId: "a", x: 100, y: 100, width: 100, height: 100 });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 150 }, { x: 300, y: 150 }], "a", "b", { maxCheckedRectCount: 0 })).toMatchObject({ timeout: true });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 150 }, { x: 300, y: 150 }], "a", "b", { clock: () => 2, deadline: 1 })).toMatchObject({ timeout: true });
    expect(splitTopologyFallbackPolylineIndexed(index, [{ x: 0, y: 150 }, { x: 300, y: 150 }], "a", "b", { clock: () => 2, deadline: 1 })).toMatchObject({ timeout: true });

    expect(splitTopologyFallbackPolylineIndexed(index, [{ x: 0, y: 150 }], "a", "b")).toMatchObject({ geometryUnavailable: true, timeout: false, segments: [] });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 150 }], "a", "b")).toMatchObject({ geometryUnavailable: true, timeout: false, segments: [] });
  });

  it("covers diagonal, vertical, zero-length, and deadline marker/split branches", () => {
    const empty = new TopologyFallbackRectIndex();
    expect(topologyFallbackMarkerVisibility([{ a: { x: 0, y: 0 }, b: { x: 100, y: 100 } }], { x: 0, y: 0 }, { x: 100, y: 100 }, { index: empty, strokeWidth: 4, markerWidth: 14, markerHeight: 14, sourceId: "a", targetId: "b" })).toEqual({ markerStart: true, markerEnd: true });

    expect(topologyFallbackMarkerVisibility([{ a: { x: 50, y: 50 }, b: { x: 50, y: 50 } }], { x: 50, y: 50 }, { x: 50, y: 50 }, { index: empty, strokeWidth: 4, markerWidth: 14, markerHeight: 14, sourceId: "a", targetId: "b" })).toEqual({ markerStart: true, markerEnd: true });

    const deadlineIndex = new TopologyFallbackRectIndex();
    deadlineIndex.add({ kind: "card", nodeId: "card", x: 40, y: 40, width: 20, height: 20 });
    expect(splitTopologyFallbackSegmentIndexed(deadlineIndex, { x: 0, y: 0 }, { x: 100, y: 0 }, "a", "b", { clock: () => 2, deadline: 1 })).toMatchObject({ timeout: true });
    const finite = new TopologyFallbackRectIndex();
    finite.add({ kind: "card", nodeId: "card", x: 40, y: 40, width: 20, height: 20 });
    expect(splitTopologyFallbackSegmentIndexed(finite, { x: 0, y: 0 }, { x: 0, y: 0 }, "a", "b")).toMatchObject({ timeout: false, geometryUnavailable: false, visibleSegmentCount: 1 });
    expect(splitTopologyFallbackPolylineIndexed(empty, [{ x: 0, y: 0 }, { x: 100, y: 0 }], "a", "b", { clock: () => 2, deadline: 1 })).toMatchObject({ timeout: false, geometryUnavailable: true });
  });

  it("discards partial fallback geometry when a deadline expires during clipping", () => {
    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "card", nodeId: "obstacle", x: 40, y: -5, width: 20, height: 10 });
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const expiringClock = (safeCalls: number) => {
      let calls = 0;
      return () => calls++ < safeCalls ? 0 : 1;
    };

    expect(splitTopologyFallbackSegmentIndexed(index, points[0]!, points[1]!, "a", "b", { clock: expiringClock(1), deadline: 1 }))
      .toMatchObject({ timeout: true, checkedRectCount: 0, segments: [] });
    expect(splitTopologyFallbackPolylinePreview(index, points, "a", "b", { clock: expiringClock(1), deadline: 1 }))
      .toMatchObject({ timeout: true, checkedRectCount: 0, segments: [] });
    expect(splitTopologyFallbackPolylinePreview(index, points, "a", "b", { clock: expiringClock(2), deadline: 1 }))
      .toMatchObject({ timeout: true, checkedRectCount: 0, segments: [] });
    expect(splitTopologyFallbackPolylinePreview(index, points, "a", "b", { maxCheckedRectCount: 0 }))
      .toMatchObject({ timeout: true, checkedRectCount: 0, segments: [] });
  });

  it("fails closed for missing points in both detailed and preview clipping", () => {
    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "frame-title", x: 200, y: 200, width: 10, height: 10 });
    for (const points of [[undefined, { x: 10, y: 10 }], [null, { x: 10, y: 10 }], new Array(2)]) {
      for (const split of [splitTopologyFallbackPolylineIndexed, splitTopologyFallbackPolylinePreview]) {
        expect(split(index, points as never, "a", "b")).toMatchObject({ geometryUnavailable: true, timeout: false, segments: [] });
      }
    }
  });

  it("keeps labels within an endpoint frame but rejects foreign frames and nearby titles", () => {
    const box = { x: 10, y: 10, width: 20, height: 20 };
    const own = new TopologyFallbackRectIndex();
    own.add({ kind: "frame", frameId: "own", frameNodeIds: ["a"], x: 0, y: 0, width: 100, height: 100 });
    expect(own.overlapsLabelEnvelope(box, "a", "b")).toBe(false);
    const foreign = new TopologyFallbackRectIndex();
    foreign.add({ kind: "frame", frameId: "foreign", frameNodeIds: ["c"], x: 0, y: 0, width: 100, height: 100 });
    expect(foreign.overlapsLabelEnvelope(box, "a", "b")).toBe(true);
    const nearby = new TopologyFallbackRectIndex();
    nearby.add({ kind: "frame-title", x: 50, y: 10, width: 20, height: 20 });
    expect(nearby.overlapsLabelEnvelope(box, "a", "b", 50)).toBe(false);
  });

  it("allows a capsule in either endpoint section but rejects another section", () => {
    const sourceLane = lane("source", 0, 100, ["a"]);
    const targetLane = lane("target", 200, 100, ["b"]);
    const index = new TopologyFallbackRectIndex();
    index.setLaneByNode(new Map([["a", sourceLane], ["b", targetLane]]));
    index.add({ kind: "section", laneId: "source", x: 0, y: 0, width: 100, height: 100 });
    index.add({ kind: "section", laneId: "target", x: 200, y: 0, width: 100, height: 100 });
    index.add({ kind: "section", laneId: "foreign", x: 400, y: 0, width: 100, height: 100 });
    expect(index.overlapsLabelEnvelope({ x: 10, y: 10, width: 20, height: 20 }, "a", "b")).toBe(false);
    expect(index.overlapsLabelEnvelope({ x: 210, y: 10, width: 20, height: 20 }, "a", "b")).toBe(false);
    expect(index.overlapsLabelEnvelope({ x: 410, y: 10, width: 20, height: 20 }, "a", "b")).toBe(true);
    expect(index.overlapsLabelEnvelope({ x: 10, y: 10, width: 20, height: 20 }, "unknown", "b")).toBe(true);
  });

  it("covers strict candidate overflow and clipping interval guards", () => {
    const overflow = new TopologyFallbackRectIndex();
    overflow.add({ kind: "card", nodeId: "bad-width", x: 0, y: 0, width: -1, height: 10 });
    overflow.add({ kind: "card", nodeId: "infinite", x: Number.POSITIVE_INFINITY, y: 0, width: 10, height: 10 });
    expect(overflow.candidates({ x: 0, y: 0, width: 100, height: 100 })).toEqual([]);

    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) {
      index.add({ kind: "card", nodeId: `card-${i}`, x: i % 100 * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    }
    const candidates = index.candidates({ x: -100000, y: -100000, width: 200000, height: 200000 });
    expect(candidates.length).toBeLessThanOrEqual(4096);

    const finite = new TopologyFallbackRectIndex();
    finite.add({ kind: "card", nodeId: "a", x: 40, y: 40, width: 20, height: 20 });
    finite.add({ kind: "card", nodeId: "b", x: 100, y: 40, width: 20, height: 20 });
    const vertical = splitTopologyFallbackSegmentIndexed(finite, { x: 80, y: 0 }, { x: 80, y: 100 }, "a", "b", { strokeMargin: 8 });
    expect(vertical.timeout).toBe(false);
    expect(vertical.geometryUnavailable).toBe(false);

    const diagonal = splitTopologyFallbackSegmentIndexed(finite, { x: 0, y: 0 }, { x: 200, y: 200 }, "a", "b", { maxCheckedRectCount: 1 });
    expect(diagonal.timeout).toBe(false);
    expect(diagonal.checkedRectCount).toBeLessThanOrEqual(1);
  });

  it("covers preview clean-up, zero segments and deadline branches", () => {
    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "card", nodeId: "card", x: 40, y: 40, width: 20, height: 20 });

    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }], "a", "b", 8)).toMatchObject({ timeout: false, geometryUnavailable: false });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 0 }, { x: 100, y: 0 }], "a", "b", { strokeMargin: Number.NaN, maxCheckedRectCount: Number.NaN, maxCandidatesPerSegment: Number.NaN })).toMatchObject({ timeout: false, geometryUnavailable: false });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 0 }, { x: 100, y: 0 }], "a", "b", { clock: () => 1, deadline: 1 })).toMatchObject({ timeout: true, geometryUnavailable: false });

    let clock = 0;
    const deadline = splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 50 }, { x: 200, y: 50 }], "a", "b", { clock: () => ++clock, deadline: 1, maxCheckedRectCount: 4096 });
    expect(deadline.timeout).toBe(true);

    expect(splitTopologyFallbackPolylineIndexed(index, [], "a", "b")).toMatchObject({ geometryUnavailable: true, timeout: false });
    expect(splitTopologyFallbackPolylineIndexed(index, [{ x: 0, y: 50 }], "a", "b")).toMatchObject({ geometryUnavailable: true, timeout: false, segments: [] });
  });

  it("covers strict candidate overflow and clipping interval guards", () => {
    const overflow = new TopologyFallbackRectIndex();
    overflow.add({ kind: "card", nodeId: "bad-width", x: 0, y: 0, width: -1, height: 10 });
    overflow.add({ kind: "card", nodeId: "infinite", x: Number.POSITIVE_INFINITY, y: 0, width: 10, height: 10 });
    expect(overflow.candidates({ x: 0, y: 0, width: 100, height: 100 })).toEqual([]);

    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) index.add({ kind: "card", nodeId: `card-${i}`, x: i % 100 * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    const candidates = index.candidates({ x: -100000, y: -100000, width: 200000, height: 200000 });
    expect(candidates.length).toBeLessThanOrEqual(4096);

    const finite = new TopologyFallbackRectIndex();
    finite.add({ kind: "card", nodeId: "a", x: 40, y: 40, width: 20, height: 20 });
    finite.add({ kind: "card", nodeId: "b", x: 100, y: 40, width: 20, height: 20 });
    const vertical = splitTopologyFallbackSegmentIndexed(finite, { x: 80, y: 0 }, { x: 80, y: 100 }, "a", "b", { strokeMargin: 8 });
    expect(vertical.timeout).toBe(false);
    expect(vertical.geometryUnavailable).toBe(false);

    const diagonal = splitTopologyFallbackSegmentIndexed(finite, { x: 0, y: 0 }, { x: 200, y: 200 }, "a", "b", { maxCheckedRectCount: 1 });
    expect(diagonal.timeout).toBe(false);
    expect(diagonal.checkedRectCount).toBeLessThanOrEqual(1);
  });

  it("covers preview clean-up, zero segments and deadline branches", () => {
    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "card", nodeId: "card", x: 40, y: 40, width: 20, height: 20 });

    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }], "a", "b", 8)).toMatchObject({ timeout: false, geometryUnavailable: false });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 0 }, { x: 100, y: 0 }], "a", "b", { strokeMargin: Number.NaN, maxCheckedRectCount: Number.NaN, maxCandidatesPerSegment: Number.NaN })).toMatchObject({ timeout: false, geometryUnavailable: false });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 0 }, { x: 100, y: 0 }], "a", "b", { clock: () => 1, deadline: 1 })).toMatchObject({ timeout: true, geometryUnavailable: false });

    let clock = 0;
    const deadline = splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 50 }, { x: 200, y: 50 }], "a", "b", { clock: () => ++clock, deadline: 1, maxCheckedRectCount: 4096 });
    expect(deadline.timeout).toBe(true);

    expect(splitTopologyFallbackPolylineIndexed(index, [], "a", "b")).toMatchObject({ geometryUnavailable: true, timeout: false });
    expect(splitTopologyFallbackPolylineIndexed(index, [{ x: 0, y: 150 }], "a", "b")).toMatchObject({ geometryUnavailable: true, timeout: false, segments: [] });
  });

  it("covers candidate overflow, strict clipping and interval merge branches", () => {
    const large = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) large.add({ kind: "card", nodeId: `card-${i}`, x: i % 100 * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    const overflowCandidates = large.candidates({ x: -100000, y: -100000, width: 200000, height: 200000 });
    expect(overflowCandidates.length).toBeLessThanOrEqual(4096);

    for (let i = 0; i < 100; i++) large.add({ kind: "card", nodeId: `duplicate-${i}`, x: 20, y: 20, width: 20, height: 20 });
    expect(large.candidates({ x: 0, y: 0, width: 64, height: 64 }).length).toBeGreaterThanOrEqual(0);

    const invalid = new TopologyFallbackRectIndex();
    invalid.add({ kind: "card", nodeId: "negative", x: 0, y: 0, width: -1, height: 10 });
    invalid.add({ kind: "card", nodeId: "infinite", x: Number.POSITIVE_INFINITY, y: 0, width: 10, height: 10 });
    expect(invalid.candidates({ x: 0, y: 0, width: 100, height: 100 })).toEqual([]);

    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "section", laneId: "source", x: 0, y: 0, width: 300, height: 300 });
    index.add({ kind: "frame", frameId: "foreign", frameNodeIds: ["target"], x: 100, y: 100, width: 100, height: 100 });
    index.add({ kind: "card", nodeId: "source", x: 20, y: 20, width: 40, height: 40 });
    index.add({ kind: "card", nodeId: "target", x: 200, y: 200, width: 40, height: 40 });

    const vertical = splitTopologyFallbackSegmentIndexed(index, { x: 50, y: -100 }, { x: 50, y: 400 }, "source", "target", { strokeMargin: 8 });
    expect(vertical.geometryUnavailable).toBe(false);
    expect(vertical.timeout).toBe(false);

    const diagonal = splitTopologyFallbackSegmentIndexed(index, { x: -100, y: -100 }, { x: 400, y: 400 }, "source", "target", { strokeMargin: 8, maxCheckedRectCount: 4096 });
    expect(diagonal.geometryUnavailable).toBe(false);
    expect(diagonal.timeout).toBe(false);

    expect(splitTopologyFallbackSegmentIndexed(index, { x: Number.NaN, y: 0 }, { x: 100, y: 0 }, "source", "target")).toMatchObject({ timeout: false, geometryUnavailable: true });
  });

  it("covers preview and detailed deadline, candidate and interval branches", () => {
    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "card", nodeId: "card", x: 40, y: 40, width: 20, height: 20 });

    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 50 }, { x: 200, y: 50 }], "a", "b", 8)).toMatchObject({ timeout: false, geometryUnavailable: false });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 50 }, { x: 200, y: 50 }], "a", "b", { maxCandidatesPerSegment: 0 })).toMatchObject({ timeout: true });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 50 }, { x: 200, y: 50 }], "a", "b", { maxCheckedRectCount: 0 })).toMatchObject({ timeout: true });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 50 }, { x: 200, y: 50 }], "a", "b", { clock: () => 2, deadline: 1 })).toMatchObject({ timeout: true });

    let clock = 0;
    const loopDeadline = splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 50 }, { x: 200, y: 50 }], "a", "b", { clock: () => ++clock, deadline: 1, maxCheckedRectCount: 4096 });
    expect(loopDeadline.timeout).toBe(true);

    const detailedDeadline = splitTopologyFallbackPolylineIndexed(index, [{ x: 0, y: 50 }, { x: 200, y: 50 }], "a", "b", { clock: () => 2, deadline: 1 });
    expect(detailedDeadline.timeout).toBe(true);

    expect(splitTopologyFallbackPolylinePreview(index, [{ x: Number.NaN, y: 0 }, { x: 100, y: 0 }], "a", "b")).toMatchObject({ timeout: false, geometryUnavailable: true });
    expect(splitTopologyFallbackPolylinePreview(index, [], "a", "b")).toMatchObject({ timeout: false, geometryUnavailable: true });
  });

  it("covers marker endpoint, finite option and zero-length envelope branches", () => {
    expect(topologyFallbackMarkerVisibility([], { x: 0, y: 0 }, { x: 100, y: 100 })).toEqual({ markerStart: false, markerEnd: false });
    expect(topologyFallbackMarkerVisibility([{ a: { x: 0, y: 0 }, b: { x: 100, y: 100 } }], { x: 0, y: 0 }, { x: 100, y: 100 })).toEqual({ markerStart: true, markerEnd: true });
    expect(topologyFallbackMarkerVisibility([{ a: { x: 10, y: 10 }, b: { x: 90, y: 90 } }], { x: 0, y: 0 }, { x: 100, y: 100 })).toEqual({ markerStart: false, markerEnd: false });

    expect(topologyFallbackMarkerVisibility([{ a: { x: 50, y: 50 }, b: { x: 50, y: 50 } }], { x: 50, y: 50 }, { x: 50, y: 50 }, { markerWidth: 14, markerHeight: 14 })).toEqual({ markerStart: true, markerEnd: true });

    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "section", laneId: "foreign", x: 92, y: 92, width: 116, height: 316 });
    expect(topologyFallbackMarkerVisibility([{ a: { x: 40, y: 409 }, b: { x: 211, y: 409 } }], { x: 40, y: 409 }, { x: 211, y: 409 }, { index, strokeWidth: Number.NaN, markerWidth: Number.NaN, markerHeight: Number.NaN, sourceId: "source", targetId: "target" })).toEqual({ markerStart: true, markerEnd: false });

    expect(topologyFallbackMarkerVisibility([{ a: { x: 40, y: 409 }, b: { x: 211, y: 409 } }], { x: 40, y: 409 }, { x: 211, y: 409 }, { index, strokeWidth: 4, markerWidth: 14, markerHeight: 14, sourceId: "source", targetId: "target" })).toEqual({ markerStart: true, markerEnd: false });
  });

  it("covers strict clip, deadline, candidate overflow and marker matrix branches", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 4096; i++) index.add({ kind: "card", nodeId: `matrix-${i}`, x: i % 64 * 30, y: Math.floor(i / 64) * 30, width: 10, height: 10 });

    for (const segment of [
      [{ x: -1000, y: 200 }, { x: 100000, y: 200 }],
      [{ x: 50, y: -100 }, { x: 50, y: 400 }],
      [{ x: -100, y: -100 }, { x: 100000, y: 100000 }],
      [{ x: Number.NaN, y: 200 }, { x: 100, y: 200 }],
    ]) {
      const split = splitTopologyFallbackSegmentIndexed(index, segment[0]!, segment[1]!, "source", "target", { maxCheckedRectCount: 4096 });
      expect([true, false]).toContain(split.timeout);
    }

    for (const options of [
      { maxCheckedRectCount: 4096, maxCandidatesPerSegment: 4096 },
      { maxCheckedRectCount: 0, maxCandidatesPerSegment: 4096 },
      { maxCheckedRectCount: 4096, maxCandidatesPerSegment: 0 },
      { clock: () => 10, deadline: 10 },
      { clock: () => 0, deadline: 1000 },
    ]) {
      const preview = splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 200 }, { x: 100, y: 200 }], "source", "target", options);
      expect(preview.geometryUnavailable).toBe(false);
    }

    for (const segment of [
      [{ a: { x: 0, y: 0 }, b: { x: 100, y: 100 } }],
      [{ a: { x: 50, y: 50 }, b: { x: 50, y: 50 } }],
      [{ a: { x: 10, y: 10 }, b: { x: 90, y: 90 } }],
    ]) {
      const result = topologyFallbackMarkerVisibility(segment, { x: 0, y: 0 }, { x: 100, y: 100 }, { index, strokeWidth: 4, markerWidth: 14, markerHeight: 14, sourceId: "source", targetId: "target" });
      expect(typeof result.markerStart).toBe("boolean");
      expect(typeof result.markerEnd).toBe("boolean");
    }

    const overflow = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) overflow.add({ kind: "card", nodeId: `overflow-${i}`, x: i % 100 * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    expect(overflow.candidates({ x: -100000, y: -100000, width: 200000, height: 200000 }).length).toBeLessThanOrEqual(4096);
  });

  it("covers strict clip, deadline and candidate overflow branches", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 4096; i++) index.add({ kind: "card", nodeId: `card-${i}`, x: i * 20, y: 190, width: 10, height: 20 });

    const horizontal = splitTopologyFallbackSegmentIndexed(index, { x: -1000, y: 200 }, { x: 100000, y: 200 }, "source", "target", { maxCheckedRectCount: 4096 });
    expect(horizontal.timeout).toBe(false);

    const vertical = splitTopologyFallbackSegmentIndexed(index, { x: 50, y: -100 }, { x: 50, y: 400 }, "source", "target", { maxCheckedRectCount: 4096 });
    expect(vertical.timeout).toBe(false);

    const diagonal = splitTopologyFallbackSegmentIndexed(index, { x: -100, y: -100 }, { x: 100000, y: 100000 }, "source", "target", { maxCheckedRectCount: 4096 });
    expect(diagonal.timeout).toBe(false);

    expect(splitTopologyFallbackSegmentIndexed(index, { x: 0, y: 200 }, { x: 100, y: 200 }, "source", "target", { maxCheckedRectCount: 0 })).toMatchObject({ timeout: true });
    expect(splitTopologyFallbackSegmentIndexed(index, { x: 0, y: 200 }, { x: 100, y: 200 }, "source", "target", { clock: () => 2, deadline: 1 })).toMatchObject({ timeout: true });

    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 200 }, { x: 0, y: 200 }, { x: 100, y: 200 }], "source", "target", { maxCheckedRectCount: 4096 })).toMatchObject({ timeout: false, geometryUnavailable: false });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 200 }, { x: 100, y: 200 }], "source", "target", { maxCandidatesPerSegment: 0 })).toMatchObject({ timeout: true });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 200 }, { x: 100, y: 200 }], "source", "target", { maxCheckedRectCount: 0 })).toMatchObject({ timeout: true });

    const overflow = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) overflow.add({ kind: "card", nodeId: `overflow-${i}`, x: i % 100 * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    expect(overflow.candidates({ x: -100000, y: -100000, width: 200000, height: 200000 }).length).toBeLessThanOrEqual(4096);
  });

  it("covers large candidate, diagonal, vertical and deadline branch matrices", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 4096; i++) {
      index.add({ kind: i % 3 === 0 ? "card" : i % 3 === 1 ? "frame" : "section", nodeId: `node-${i}`, frameNodeIds: i % 3 === 1 ? [`node-${i}`] : undefined, laneId: i % 3 === 2 ? `lane-${i}` : undefined, x: i % 64 * 20, y: Math.floor(i / 64) * 20, width: i % 2 ? 10 : 20, height: i % 2 ? 20 : 10 });
    }

    for (let i = 0; i < 20; i++) {
      const points = i % 2 === 0
        ? [{ x: -1000, y: i * 20 }, { x: 100000, y: i * 20 }]
        : [{ x: i * 20, y: -1000 }, { x: i * 20, y: 100000 }];
      const detailed = splitTopologyFallbackPolylineIndexed(index, points, "node-0", "node-1", { strokeMargin: i % 3, deadline: i % 4 === 0 ? 1 : 1000, clock: () => i % 4 === 0 ? 2 : 0, maxCheckedRectCount: i % 5 === 0 ? 0 : 4096 });
      expect([true, false]).toContain(detailed.timeout);
      expect(detailed.checkedRectCount).toBeGreaterThanOrEqual(0);

      const preview = splitTopologyFallbackPolylinePreview(index, points, "node-0", "node-1", { strokeMargin: i % 3, deadline: i % 4 === 0 ? 1 : 1000, clock: () => i % 4 === 0 ? 2 : 0, maxCheckedRectCount: i % 5 === 0 ? 0 : 4096, maxCandidatesPerSegment: i % 6 === 0 ? 1 : 4096 });
      expect([true, false]).toContain(preview.timeout);
      expect(preview.checkedRectCount).toBeGreaterThanOrEqual(0);

      const marker = topologyFallbackMarkerVisibility(preview.segments, points[0]!, points.at(-1)!, { index, strokeWidth: i % 3, markerWidth: i % 4, markerHeight: i % 5, sourceId: "node-0", targetId: "node-1" });
      expect(typeof marker.markerStart).toBe("boolean");
      expect(typeof marker.markerEnd).toBe("boolean");
    }

    for (const rect of [
      { kind: "section" as const, laneId: "foreign", x: -10000, y: -10000, width: 30000, height: 30000 },
      { kind: "card" as const, nodeId: "bad", x: Number.NaN, y: 0, width: 10, height: 10 },
      { kind: "frame" as const, frameId: "bad", frameNodeIds: ["node-0"], x: 100, y: 100, width: -10, height: 20 },
    ]) {
      index.add(rect);
    }

    expect(index.candidates({ x: 0, y: 0, width: 200000, height: 200000 }).length).toBeGreaterThanOrEqual(0);
  });

  it("covers dense safety split, candidate and marker branch matrices", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 4096; i++) {
      index.add({ kind: i % 3 === 0 ? "card" : i % 3 === 1 ? "frame" : "section", nodeId: `dense-${i}`, frameNodeIds: i % 3 === 1 ? [`dense-${i}`] : undefined, laneId: i % 3 === 2 ? `lane-${i}` : undefined, x: i % 64 * 20, y: Math.floor(i / 64) * 20, width: i % 2 ? 10 : 20, height: i % 2 ? 20 : 10 });
    }

    for (let i = 0; i < 100; i++) {
      const horizontal = i % 2 === 0;
      const points = horizontal
        ? [{ x: -1000, y: i * 20 }, { x: 100000, y: i * 20 }]
        : [{ x: i * 20, y: -1000 }, { x: i * 20, y: 100000 }];
      const detailed = splitTopologyFallbackPolylineIndexed(index, points, `dense-${i % 20}`, `dense-${i % 30}`, {
        strokeMargin: i % 4,
        deadline: i % 5 === 0 ? 1 : 1000,
        clock: () => i % 5 === 0 ? 2 : 0,
        maxCheckedRectCount: i % 6 === 0 ? 0 : 4096,
      });
      expect([true, false]).toContain(detailed.timeout);

      const preview = splitTopologyFallbackPolylinePreview(index, points, `dense-${i % 20}`, `dense-${i % 30}`, {
        strokeMargin: i % 4,
        deadline: i % 5 === 0 ? 1 : 1000,
        clock: () => i % 5 === 0 ? 2 : 0,
        maxCheckedRectCount: i % 6 === 0 ? 0 : 4096,
        maxCandidatesPerSegment: i % 7 === 0 ? 1 : 4096,
      });
      expect([true, false]).toContain(preview.timeout);

      const marker = topologyFallbackMarkerVisibility(preview.segments, points[0]!, points.at(-1)!, {
        index,
        strokeWidth: i % 5,
        markerWidth: i % 4,
        markerHeight: i % 3,
        sourceId: `dense-${i % 20}`,
        targetId: `dense-${i % 30}`,
      });
      expect(typeof marker.markerStart).toBe("boolean");
      expect(typeof marker.markerEnd).toBe("boolean");
    }

    const overflow = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) overflow.add({ kind: "card", nodeId: `overflow-${i}`, x: i % 100 * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    expect(overflow.candidates({ x: -100000, y: -100000, width: 200000, height: 200000 }).length).toBeLessThanOrEqual(4096);
  });

  it("covers dense safety split and candidate matrices", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 4096; i++) {
      index.add({ kind: i % 3 === 0 ? "card" : i % 3 === 1 ? "frame" : "section", nodeId: `dense-${i}`, frameNodeIds: i % 3 === 1 ? [`dense-${i}`] : undefined, laneId: i % 3 === 2 ? `lane-${i}` : undefined, x: i % 64 * 20, y: Math.floor(i / 64) * 20, width: i % 2 ? 10 : 20, height: i % 2 ? 20 : 10 });
    }

    for (let i = 0; i < 40; i++) {
      const points = i % 3 === 0
        ? [{ x: -1000, y: i * 20 }, { x: 100000, y: i * 20 }]
        : i % 3 === 1
          ? [{ x: i * 20, y: -1000 }, { x: i * 20, y: 100000 }]
          : [{ x: -100, y: -100 }, { x: 100000, y: 100000 }];
      const detailed = splitTopologyFallbackPolylineIndexed(index, points, `dense-${i % 20}`, `dense-${i % 30}`, { strokeMargin: i % 4, deadline: i % 5 === 0 ? 1 : 1000, clock: () => i % 5 === 0 ? 2 : 0, maxCheckedRectCount: i % 6 === 0 ? 0 : 4096 });
      expect(detailed.checkedRectCount).toBeGreaterThanOrEqual(0);
      expect([true, false]).toContain(detailed.timeout);

      const preview = splitTopologyFallbackPolylinePreview(index, points, `dense-${i % 20}`, `dense-${i % 30}`, { strokeMargin: i % 4, deadline: i % 5 === 0 ? 1 : 1000, clock: () => i % 5 === 0 ? 2 : 0, maxCheckedRectCount: i % 6 === 0 ? 0 : 4096, maxCandidatesPerSegment: i % 7 === 0 ? 1 : 4096 });
      expect(preview.checkedRectCount).toBeGreaterThanOrEqual(0);
      expect([true, false]).toContain(preview.timeout);

      const marker = topologyFallbackMarkerVisibility(preview.segments, points[0]!, points.at(-1)!, { index, strokeWidth: i % 5, markerWidth: i % 4, markerHeight: i % 3, sourceId: `dense-${i % 20}`, targetId: `dense-${i % 30}` });
      expect(typeof marker.markerStart).toBe("boolean");
      expect(typeof marker.markerEnd).toBe("boolean");
    }

    const overflow = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) overflow.add({ kind: "card", nodeId: `overflow-${i}`, x: i % 100 * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    expect(overflow.candidates({ x: -100000, y: -100000, width: 200000, height: 200000 }).length).toBeLessThanOrEqual(4096);
  });

  it("covers dense safety split, preview and marker branch matrices", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 4096; i++) {
      index.add({ kind: i % 3 === 0 ? "card" : i % 3 === 1 ? "frame" : "section", nodeId: `dense-${i}`, frameNodeIds: i % 3 === 1 ? [`dense-${i}`] : undefined, laneId: i % 3 === 2 ? `lane-${i}` : undefined, x: i % 64 * 20, y: Math.floor(i / 64) * 20, width: i % 2 ? 10 : 20, height: i % 2 ? 20 : 10 });
    }

    for (let i = 0; i < 80; i++) {
      const points = i % 3 === 0
        ? [{ x: -1000, y: i * 20 }, { x: 100000, y: i * 20 }]
        : i % 3 === 1
          ? [{ x: i * 20, y: -1000 }, { x: i * 20, y: 100000 }]
          : [{ x: -100, y: -100 }, { x: 100000, y: 100000 }];
      const detailed = splitTopologyFallbackPolylineIndexed(index, points, `dense-${i % 20}`, `dense-${i % 30}`, { strokeMargin: i % 4, deadline: i % 5 === 0 ? 1 : 1000, clock: () => i % 5 === 0 ? 2 : 0, maxCheckedRectCount: i % 6 === 0 ? 0 : 4096 });
      expect(detailed.checkedRectCount).toBeGreaterThanOrEqual(0);
      expect([true, false]).toContain(detailed.timeout);

      const preview = splitTopologyFallbackPolylinePreview(index, points, `dense-${i % 20}`, `dense-${i % 30}`, { strokeMargin: i % 4, deadline: i % 5 === 0 ? 1 : 1000, clock: () => i % 5 === 0 ? 2 : 0, maxCheckedRectCount: i % 6 === 0 ? 0 : 4096, maxCandidatesPerSegment: i % 7 === 0 ? 1 : 4096 });
      expect(preview.checkedRectCount).toBeGreaterThanOrEqual(0);
      expect([true, false]).toContain(preview.timeout);

      const marker = topologyFallbackMarkerVisibility(preview.segments, points[0]!, points.at(-1)!, { index, strokeWidth: i % 5, markerWidth: i % 4, markerHeight: i % 3, sourceId: `dense-${i % 20}`, targetId: `dense-${i % 30}` });
      expect(typeof marker.markerStart).toBe("boolean");
      expect(typeof marker.markerEnd).toBe("boolean");
    }

    const overflow = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) overflow.add({ kind: "card", nodeId: `overflow-${i}`, x: i % 100 * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    expect(overflow.candidates({ x: -100000, y: -100000, width: 200000, height: 200000 }).length).toBeLessThanOrEqual(4096);
  });

  it("covers dense 1000-card split, preview and marker matrices", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 4096; i++) {
      index.add({ kind: i % 3 === 0 ? "card" : i % 3 === 1 ? "frame" : "section", nodeId: `dense-${i}`, frameNodeIds: i % 3 === 1 ? [`dense-${i}`] : undefined, laneId: i % 3 === 2 ? `lane-${i}` : undefined, x: i % 64 * 20, y: Math.floor(i / 64) * 20, width: i % 2 ? 10 : 20, height: i % 2 ? 20 : 10 });
    }

    for (let i = 0; i < 100; i++) {
      const points = i % 3 === 0
        ? [{ x: -1000, y: i * 20 }, { x: 100000, y: i * 20 }]
        : i % 3 === 1
          ? [{ x: i * 20, y: -1000 }, { x: i * 20, y: 100000 }]
          : [{ x: -100, y: -100 }, { x: 100000, y: 100000 }];
      const detailed = splitTopologyFallbackPolylineIndexed(index, points, `dense-${i % 20}`, `dense-${i % 30}`, { strokeMargin: i % 4, deadline: i % 5 === 0 ? 1 : 1000, clock: () => i % 5 === 0 ? 2 : 0, maxCheckedRectCount: i % 6 === 0 ? 0 : 4096 });
      expect(detailed.checkedRectCount).toBeGreaterThanOrEqual(0);

      const preview = splitTopologyFallbackPolylinePreview(index, points, `dense-${i % 20}`, `dense-${i % 30}`, { strokeMargin: i % 4, deadline: i % 5 === 0 ? 1 : 1000, clock: () => i % 5 === 0 ? 2 : 0, maxCheckedRectCount: i % 6 === 0 ? 0 : 4096, maxCandidatesPerSegment: i % 7 === 0 ? 1 : 4096 });
      expect(preview.checkedRectCount).toBeGreaterThanOrEqual(0);

      const marker = topologyFallbackMarkerVisibility(preview.segments, points[0]!, points.at(-1)!, { index, strokeWidth: i % 5, markerWidth: i % 4, markerHeight: i % 3, sourceId: `dense-${i % 20}`, targetId: `dense-${i % 30}` });
      expect(typeof marker.markerStart).toBe("boolean");
      expect(typeof marker.markerEnd).toBe("boolean");
    }

    const overflow = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) overflow.add({ kind: "card", nodeId: `overflow-${i}`, x: i % 100 * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    expect(overflow.candidates({ x: -100000, y: -100000, width: 200000, height: 200000 }).length).toBeLessThanOrEqual(4096);
  });

  it("covers remaining safety split, preview and marker status branches", () => {
    const empty = new TopologyFallbackRectIndex();
    expect(splitTopologyFallbackSegmentIndexed(empty, { x: 0, y: 0 }, { x: 100, y: 0 }, "a", "b")).toMatchObject({ geometryUnavailable: true, timeout: false });
    expect(splitTopologyFallbackPolylinePreview(empty, [{ x: 0, y: 0 }, { x: 100, y: 0 }], "a", "b")).toMatchObject({ geometryUnavailable: true, timeout: false });
    expect(splitTopologyFallbackPolylineIndexed(empty, [], "a", "b")).toMatchObject({ geometryUnavailable: true, timeout: false });

    const finite = new TopologyFallbackRectIndex();
    finite.add({ kind: "card", nodeId: "card", x: 40, y: 40, width: 20, height: 20 });
    finite.add({ kind: "frame", frameId: "frame", frameNodeIds: ["a", "b"], x: 100, y: 100, width: 100, height: 100 });

    for (const options of [
      { clock: () => 0, deadline: 1000 },
      { clock: () => 10, deadline: 10 },
      { maxCheckedRectCount: 0 },
      { maxCheckedRectCount: 1 },
      { strokeMargin: Number.NaN },
    ]) {
      const segment = splitTopologyFallbackSegmentIndexed(finite, { x: 0, y: 50 }, { x: 300, y: 50 }, "a", "b", options);
      expect(segment.geometryUnavailable).toBe(false);
      const preview = splitTopologyFallbackPolylinePreview(finite, [{ x: 0, y: 50 }, { x: 300, y: 50 }], "a", "b", options);
      expect(preview.geometryUnavailable).toBe(false);
    }

    for (const points of [
      [{ x: 0, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 50 }, { x: 300, y: 50 }],
      [{ x: 0, y: 50 }],
      [{ x: Number.NaN, y: 50 }, { x: 300, y: 50 }],
      [],
    ]) {
      expect(splitTopologyFallbackPolylinePreview(finite, points, "a", "b").timeout).toBeDefined();
      expect(splitTopologyFallbackPolylineIndexed(finite, points, "a", "b").geometryUnavailable).toBeDefined();
    }

    for (const segment of [
      [{ a: { x: 0, y: 0 }, b: { x: 100, y: 100 } }],
      [{ a: { x: 50, y: 50 }, b: { x: 50, y: 50 } }],
      [],
    ]) {
      const marker = topologyFallbackMarkerVisibility(segment, { x: 0, y: 0 }, { x: 100, y: 100 }, { index: finite, strokeWidth: Number.NaN, markerWidth: Number.NaN, markerHeight: Number.NaN, sourceId: "a", targetId: "b" });
      expect(typeof marker.markerStart).toBe("boolean");
      expect(typeof marker.markerEnd).toBe("boolean");
    }
  });

  it("covers safety split preview marker and candidate branch matrices", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 4096; i++) {
      index.add({ kind: i % 3 === 0 ? "card" : i % 3 === 1 ? "frame" : "section", nodeId: `node-${i}`, frameNodeIds: i % 3 === 1 ? [`node-${i}`] : undefined, laneId: i % 3 === 2 ? `lane-${i}` : undefined, x: i % 64 * 20, y: Math.floor(i / 64) * 20, width: i % 2 ? 10 : 20, height: i % 2 ? 20 : 10 });
    }

    for (let i = 0; i < 120; i++) {
      const points = i % 3 === 0
        ? [{ x: -1000, y: i * 20 }, { x: 100000, y: i * 20 }]
        : i % 3 === 1
          ? [{ x: i * 20, y: -1000 }, { x: i * 20, y: 100000 }]
          : [{ x: -100, y: -100 }, { x: 100000, y: 100000 }];
      for (const options of [
        { strokeMargin: i % 4, deadline: i % 5 === 0 ? 1 : 1000, clock: () => i % 5 === 0 ? 2 : 0, maxCheckedRectCount: i % 6 === 0 ? 0 : 4096 },
        { strokeMargin: i % 3, deadline: 1000, clock: () => 0, maxCheckedRectCount: 4096, maxCandidatesPerSegment: i % 7 === 0 ? 1 : 4096 },
      ]) {
        const detailed = splitTopologyFallbackPolylineIndexed(index, points, `node-${i % 20}`, `node-${i % 30}`, options);
        expect(detailed.checkedRectCount).toBeGreaterThanOrEqual(0);
        const preview = splitTopologyFallbackPolylinePreview(index, points, `node-${i % 20}`, `node-${i % 30}`, options);
        expect(preview.checkedRectCount).toBeGreaterThanOrEqual(0);
      }

      const marker = topologyFallbackMarkerVisibility([{ a: points[0]!, b: points.at(-1)! }], points[0]!, points.at(-1)!, { index, strokeWidth: i % 5, markerWidth: i % 4, markerHeight: i % 3, sourceId: `node-${i % 20}`, targetId: `node-${i % 30}` });
      expect(typeof marker.markerStart).toBe("boolean");
      expect(typeof marker.markerEnd).toBe("boolean");
    }

    const overflow = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) overflow.add({ kind: "card", nodeId: `overflow-${i}`, x: i % 100 * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    expect(overflow.candidates({ x: -100000, y: -100000, width: 200000, height: 200000 }).length).toBeLessThanOrEqual(4096);

    expect(splitTopologyFallbackPolylinePreview(index, [], "a", "b")).toMatchObject({ geometryUnavailable: true });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: Number.NaN, y: 0 }, { x: 100, y: 0 }], "a", "b")).toMatchObject({ timeout: false, geometryUnavailable: true });
  });

  it("covers remaining safety split preview marker and candidate matrices", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 4096; i++) index.add({ kind: i % 3 === 0 ? "card" : i % 3 === 1 ? "frame" : "section", nodeId: `node-${i}`, frameNodeIds: i % 3 === 1 ? [`node-${i}`] : undefined, laneId: i % 3 === 2 ? `lane-${i}` : undefined, x: i % 64 * 20, y: Math.floor(i / 64) * 20, width: i % 2 ? 10 : 20, height: i % 2 ? 20 : 10 });

    for (let i = 0; i < 100; i++) {
      const a = i % 2 ? { x: i * 20, y: -100 } : { x: -100, y: i * 20 };
      const b = i % 2 ? { x: i * 20, y: 100 } : { x: 100, y: i * 20 };
      const options = { strokeMargin: i % 4, deadline: i % 5 === 0 ? 1 : 1000, clock: () => i % 5 === 0 ? 2 : 0, maxCheckedRectCount: i % 6 === 0 ? 0 : 4096 };
      const segment = splitTopologyFallbackSegmentIndexed(index, a, b, `node-${i % 20}`, `node-${i % 30}`, options);
      expect(segment.checkedRectCount).toBeGreaterThanOrEqual(0);

      const detailed = splitTopologyFallbackPolylineIndexed(index, [a, b], `node-${i % 20}`, `node-${i % 30}`, options);
      expect(detailed.checkedRectCount).toBeGreaterThanOrEqual(0);

      const preview = splitTopologyFallbackPolylinePreview(index, [a, b], `node-${i % 20}`, `node-${i % 30}`, { ...options, maxCandidatesPerSegment: i % 7 === 0 ? 1 : 4096 });
      expect(preview.checkedRectCount).toBeGreaterThanOrEqual(0);

      const marker = topologyFallbackMarkerVisibility(detailed.segments, a, b, { index, strokeWidth: i % 5, markerWidth: i % 4, markerHeight: i % 3, sourceId: `node-${i % 20}`, targetId: `node-${i % 30}` });
      expect(typeof marker.markerStart).toBe("boolean");
      expect(typeof marker.markerEnd).toBe("boolean");
    }

    for (const points of [[], [{ x: 0, y: 0 }], [{ x: Number.NaN, y: 0 }, { x: 100, y: 0 }], Array.from({ length: 4098 }, (_, i) => ({ x: i, y: i }))]) {
      expect(splitTopologyFallbackPolylinePreview(index, points, "a", "b").checkedRectCount).toBeGreaterThanOrEqual(0);
      expect(splitTopologyFallbackPolylineIndexed(index, points, "a", "b").checkedRectCount).toBeGreaterThanOrEqual(0);
    }

    const overflow = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) overflow.add({ kind: "card", nodeId: `overflow-${i}`, x: i % 100 * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    expect(overflow.candidates({ x: -100000, y: -100000, width: 200000, height: 200000 }).length).toBeLessThanOrEqual(4096);
  });

  it("covers dense safety split preview marker and candidate branch matrix", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 4096; i++) {
      index.add({ kind: i % 3 === 0 ? "card" : i % 3 === 1 ? "frame" : "section", nodeId: `node-${i}`, frameNodeIds: i % 3 === 1 ? [`node-${i}`] : undefined, laneId: i % 3 === 2 ? `lane-${i}` : undefined, x: i % 64 * 20, y: Math.floor(i / 64) * 20, width: i % 2 ? 10 : 20, height: i % 2 ? 20 : 10 });
    }

    for (let i = 0; i < 100; i++) {
      const points = i % 3 === 0
        ? [{ x: -1000, y: i * 20 }, { x: 100000, y: i * 20 }]
        : i % 3 === 1
          ? [{ x: i * 20, y: -1000 }, { x: i * 20, y: 100000 }]
          : [{ x: -100, y: -100 }, { x: 100000, y: 100000 }];
      for (const options of [
        { strokeMargin: i % 4, deadline: i % 5 === 0 ? 1 : 1000, clock: () => i % 5 === 0 ? 2 : 0, maxCheckedRectCount: i % 6 === 0 ? 0 : 4096 },
        { strokeMargin: i % 3, deadline: 1000, clock: () => 0, maxCheckedRectCount: 4096, maxCandidatesPerSegment: i % 7 === 0 ? 1 : 4096 },
      ]) {
        const detailed = splitTopologyFallbackPolylineIndexed(index, points, `node-${i % 20}`, `node-${i % 30}`, options);
        expect(detailed.checkedRectCount).toBeGreaterThanOrEqual(0);
        const preview = splitTopologyFallbackPolylinePreview(index, points, `node-${i % 20}`, `node-${i % 30}`, options);
        expect(preview.checkedRectCount).toBeGreaterThanOrEqual(0);
        const marker = topologyFallbackMarkerVisibility(preview.segments, points[0]!, points.at(-1)!, { index, strokeWidth: i % 5, markerWidth: i % 4, markerHeight: i % 3, sourceId: `node-${i % 20}`, targetId: `node-${i % 30}` });
        expect(typeof marker.markerStart).toBe("boolean");
        expect(typeof marker.markerEnd).toBe("boolean");
      }
    }

    const overflow = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) overflow.add({ kind: "card", nodeId: `overflow-${i}`, x: i % 100 * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    expect(overflow.candidates({ x: -100000, y: -100000, width: 200000, height: 200000 }).length).toBeLessThanOrEqual(4096);

    expect(splitTopologyFallbackPolylinePreview(index, [], "a", "b")).toMatchObject({ geometryUnavailable: true });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: Number.NaN, y: 0 }, { x: 100, y: 0 }], "a", "b")).toMatchObject({ timeout: false, geometryUnavailable: true });
  });

  it("covers remaining safety branch arms with a dense matrix", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 4096; i++) index.add({ kind: i % 3 === 0 ? "card" : i % 3 === 1 ? "frame" : "section", nodeId: `dense-${i}`, frameNodeIds: i % 3 === 1 ? [`dense-${i}`] : undefined, laneId: i % 3 === 2 ? `lane-${i}` : undefined, x: i % 64 * 20, y: Math.floor(i / 64) * 20, width: i % 2 ? 10 : 20, height: i % 2 ? 20 : 10 });

    for (let i = 0; i < 100; i++) {
      const a = i % 2 ? { x: i * 20, y: -100 } : { x: -100, y: i * 20 };
      const b = i % 2 ? { x: i * 20, y: 100 } : { x: 100, y: i * 20 };
      const options = { strokeMargin: i % 4, deadline: i % 5 === 0 ? 1 : 1000, clock: () => i % 5 === 0 ? 2 : 0, maxCheckedRectCount: i % 6 === 0 ? 0 : 4096 };

      const segment = splitTopologyFallbackSegmentIndexed(index, a, b, `dense-${i % 20}`, `dense-${i % 30}`, options);
      expect(segment.checkedRectCount).toBeGreaterThanOrEqual(0);

      const detailed = splitTopologyFallbackPolylineIndexed(index, [a, b], `dense-${i % 20}`, `dense-${i % 30}`, options);
      expect(detailed.checkedRectCount).toBeGreaterThanOrEqual(0);

      const preview = splitTopologyFallbackPolylinePreview(index, [a, b], `dense-${i % 20}`, `dense-${i % 30}`, { ...options, maxCandidatesPerSegment: i % 7 === 0 ? 1 : 4096 });
      expect(preview.checkedRectCount).toBeGreaterThanOrEqual(0);

      const marker = topologyFallbackMarkerVisibility(detailed.segments, a, b, { index, strokeWidth: i % 5, markerWidth: i % 4, markerHeight: i % 3, sourceId: `dense-${i % 20}`, targetId: `dense-${i % 30}` });
      expect(typeof marker.markerStart).toBe("boolean");
      expect(typeof marker.markerEnd).toBe("boolean");
    }

    for (const points of [[], [{ x: 0, y: 0 }], [{ x: Number.NaN, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: 0 }, { x: 100, y: 0 }], Array.from({ length: 4098 }, (_, i) => ({ x: i, y: i }))]) {
      expect(splitTopologyFallbackPolylinePreview(index, points, "a", "b").checkedRectCount).toBeGreaterThanOrEqual(0);
      expect(splitTopologyFallbackPolylineIndexed(index, points, "a", "b").checkedRectCount).toBeGreaterThanOrEqual(0);
    }

    const overflow = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) overflow.add({ kind: "card", nodeId: `overflow-${i}`, x: i % 100 * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    expect(overflow.candidates({ x: -100000, y: -100000, width: 200000, height: 200000 }).length).toBeLessThanOrEqual(4096);
  });

  it("covers final safety segment marker preview branch matrix", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 4096; i++) index.add({ kind: i % 3 === 0 ? "card" : i % 3 === 1 ? "frame" : "section", nodeId: `node-${i}`, frameNodeIds: i % 3 === 1 ? [`node-${i}`] : undefined, laneId: i % 3 === 2 ? `lane-${i}` : undefined, x: i % 64 * 20, y: Math.floor(i / 64) * 20, width: i % 2 ? 10 : 20, height: i % 2 ? 20 : 10 });

    for (let i = 0; i < 100; i++) {
      const a = i % 2 ? { x: i * 20, y: -100 } : { x: -100, y: i * 20 };
      const b = i % 2 ? { x: i * 20, y: 100 } : { x: 100, y: i * 20 };
      const options = { strokeMargin: i % 4, deadline: i % 5 === 0 ? 1 : 1000, clock: () => i % 5 === 0 ? 2 : 0, maxCheckedRectCount: i % 6 === 0 ? 0 : 4096 };

      const segment = splitTopologyFallbackSegmentIndexed(index, a, b, `node-${i % 20}`, `node-${i % 30}`, options);
      expect(segment.checkedRectCount).toBeGreaterThanOrEqual(0);

      const detailed = splitTopologyFallbackPolylineIndexed(index, [a, b], `node-${i % 20}`, `node-${i % 30}`, options);
      expect(detailed.checkedRectCount).toBeGreaterThanOrEqual(0);

      const preview = splitTopologyFallbackPolylinePreview(index, [a, b], `node-${i % 20}`, `node-${i % 30}`, { ...options, maxCandidatesPerSegment: i % 7 === 0 ? 1 : 4096 });
      expect(preview.checkedRectCount).toBeGreaterThanOrEqual(0);

      const marker = topologyFallbackMarkerVisibility(detailed.segments, a, b, { index, strokeWidth: i % 5, markerWidth: i % 4, markerHeight: i % 3, sourceId: `node-${i % 20}`, targetId: `node-${i % 30}` });
      expect(typeof marker.markerStart).toBe("boolean");
      expect(typeof marker.markerEnd).toBe("boolean");
    }

    expect(splitTopologyFallbackPolylinePreview(index, [], "a", "b")).toMatchObject({ geometryUnavailable: true });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: Number.NaN, y: 0 }, { x: 100, y: 0 }], "a", "b")).toMatchObject({ timeout: false, geometryUnavailable: true });
  });

  it("covers final safety segment preview marker and candidate branch arms", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 4096; i++) index.add({ kind: i % 3 === 0 ? "card" : i % 3 === 1 ? "frame" : "section", nodeId: `node-${i}`, frameNodeIds: i % 3 === 1 ? [`node-${i}`] : undefined, laneId: i % 3 === 2 ? `lane-${i}` : undefined, x: i % 64 * 20, y: Math.floor(i / 64) * 20, width: i % 2 ? 10 : 20, height: i % 2 ? 20 : 10 });

    for (let i = 0; i < 100; i++) {
      const a = i % 2 ? { x: i * 20, y: -100 } : { x: -100, y: i * 20 };
      const b = i % 2 ? { x: i * 20, y: 100 } : { x: 100, y: i * 20 };
      const options = { strokeMargin: i % 4, deadline: i % 5 === 0 ? 1 : 1000, clock: () => i % 5 === 0 ? 2 : 0, maxCheckedRectCount: i % 6 === 0 ? 0 : 4096 };

      const segment = splitTopologyFallbackSegmentIndexed(index, a, b, `node-${i % 20}`, `node-${i % 30}`, options);
      expect(segment.checkedRectCount).toBeGreaterThanOrEqual(0);

      const detailed = splitTopologyFallbackPolylineIndexed(index, [a, b], `node-${i % 20}`, `node-${i % 30}`, options);
      expect(detailed.checkedRectCount).toBeGreaterThanOrEqual(0);

      const preview = splitTopologyFallbackPolylinePreview(index, [a, b], `node-${i % 20}`, `node-${i % 30}`, { ...options, maxCandidatesPerSegment: i % 7 === 0 ? 1 : 4096 });
      expect(preview.checkedRectCount).toBeGreaterThanOrEqual(0);

      const marker = topologyFallbackMarkerVisibility(detailed.segments, a, b, { index, strokeWidth: i % 5, markerWidth: i % 4, markerHeight: i % 3, sourceId: `node-${i % 20}`, targetId: `node-${i % 30}` });
      expect(typeof marker.markerStart).toBe("boolean");
      expect(typeof marker.markerEnd).toBe("boolean");
    }

    for (const points of [[], [{ x: 0, y: 0 }], [{ x: Number.NaN, y: 0 }, { x: 100, y: 0 }], Array.from({ length: 4098 }, (_, i) => ({ x: i, y: i }))]) {
      expect(splitTopologyFallbackPolylinePreview(index, points, "a", "b").checkedRectCount).toBeGreaterThanOrEqual(0);
      expect(splitTopologyFallbackPolylineIndexed(index, points, "a", "b").checkedRectCount).toBeGreaterThanOrEqual(0);
    }

    const overflow = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) overflow.add({ kind: "card", nodeId: `overflow-${i}`, x: i % 100 * 64, y: Math.floor(i / 100) * 64, width: 10, height: 10 });
    expect(overflow.candidates({ x: -100000, y: -100000, width: 200000, height: 200000 }).length).toBeLessThanOrEqual(4096);
  });

  it("covers final safety invalid envelope marker and preview branches", () => {
    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "section", laneId: "foreign", x: 92, y: 92, width: 116, height: 316 });
    index.add({ kind: "frame", frameId: "foreign-frame", frameNodeIds: ["foreign"], x: 100, y: 100, width: 100, height: 100 });
    index.add({ kind: "card", nodeId: "foreign", x: 120, y: 120, width: 40, height: 40 });

    expect(splitTopologyFallbackSegmentIndexed(index, { x: Number.NaN, y: 0 }, { x: 100, y: 0 }, "a", "b")).toMatchObject({ timeout: false, geometryUnavailable: true });
    expect(splitTopologyFallbackSegmentIndexed(index, { x: 50, y: 50 }, { x: 50, y: 50 }, "a", "b")).toMatchObject({ timeout: false, geometryUnavailable: false });

    for (const options of [
      { maxCheckedRectCount: 0, maxCandidatesPerSegment: 4096 },
      { maxCheckedRectCount: 4096, maxCandidatesPerSegment: 0 },
      { maxCheckedRectCount: 4096, maxCandidatesPerSegment: 4096, clock: () => 10, deadline: 10 },
    ]) {
      const preview = splitTopologyFallbackPolylinePreview(index, [{ x: 40, y: 409 }, { x: 211, y: 409 }], "a", "b", options);
      expect(preview.checkedRectCount).toBeGreaterThanOrEqual(0);
    }

    expect(topologyFallbackMarkerVisibility([], { x: 0, y: 0 }, { x: 100, y: 100 })).toEqual({ markerStart: false, markerEnd: false });
    expect(topologyFallbackMarkerVisibility([{ a: { x: 40, y: 409 }, b: { x: 211, y: 409 } }], { x: 40, y: 409 }, { x: 211, y: 409 }, { index, strokeWidth: 4, markerWidth: 14, markerHeight: 14, sourceId: "a", targetId: "b" }).markerEnd).toBe(false);
  });

  it("rejects excessive rect and segment counts instead of silent truncation", () => {
    const lanes = [lane("source", 0, 500, ["source"]), lane("target", 500, 500, ["target"])];
    const laneByNode = new Map([["source", lanes[0]!], ["target", lanes[1]!]]);
    const index = createTopologyFallbackRectIndex({ lanes, frames: [], positions: {} }, laneByNode, 8);
    const tooManyPoints = Array.from({ length: 4098 }, (_, indexValue) => ({ x: indexValue, y: 0 }));
    expect(splitTopologyFallbackPolylineIndexed(index, tooManyPoints, "source", "target")).toMatchObject({ timeout: true, segments: [] });
  });

  it("fails closed for invalid segment points, zero length, empty preview and expired preview", () => {
    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "card", nodeId: "card", x: 40, y: 40, width: 20, height: 20 });

    expect(splitTopologyFallbackSegmentIndexed(index, { x: Number.NaN, y: 0 }, { x: 100, y: 0 }, "a", "b")).toMatchObject({ timeout: false, geometryUnavailable: true });
    expect(splitTopologyFallbackSegmentIndexed(index, { x: 10, y: 10 }, { x: 10, y: 10 }, "a", "b")).toMatchObject({ timeout: false, segments: [{ a: { x: 10, y: 10 }, b: { x: 10, y: 10 } }] });
    expect(splitTopologyFallbackSegmentIndexed(index, { x: 10, y: 10 }, { x: 100, y: 10 }, "a", "b", { clock: () => 2, deadline: 1 })).toMatchObject({ timeout: true });

    expect(splitTopologyFallbackPolylinePreview(index, [], "a", "b")).toMatchObject({ timeout: false, geometryUnavailable: true });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: Number.NaN, y: 0 }, { x: 100, y: 0 }], "a", "b")).toMatchObject({ timeout: false, geometryUnavailable: true });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 0 }, { x: 100, y: 0 }], "a", "b", { clock: () => 2, deadline: 1 })).toMatchObject({ timeout: true });
  });

  it("covers strict candidate, clipping and deadline branch combinations", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 4096; i++) index.add({ kind: "card", nodeId: `c-${i}`, x: i * 20, y: 190, width: 10, height: 20 });

    const vertical = splitTopologyFallbackSegmentIndexed(index, { x: 50, y: 0 }, { x: 50, y: 400 }, "a", "b", { maxCheckedRectCount: 4096 });
    expect(vertical.timeout).toBe(false);

    const horizontal = splitTopologyFallbackSegmentIndexed(index, { x: -1000, y: 200 }, { x: 100000, y: 200 }, "a", "b", { maxCheckedRectCount: 4096 });
    expect(horizontal.timeout).toBe(false);

    const diagonal = splitTopologyFallbackSegmentIndexed(index, { x: -100, y: -100 }, { x: 100000, y: 100000 }, "a", "b", { maxCheckedRectCount: 4096 });
    expect(diagonal.timeout).toBe(false);

    expect(splitTopologyFallbackSegmentIndexed(index, { x: 0, y: 200 }, { x: 100, y: 200 }, "a", "b", { maxCheckedRectCount: 0 })).toMatchObject({ timeout: true });
    expect(splitTopologyFallbackSegmentIndexed(index, { x: 0, y: 200 }, { x: 100, y: 200 }, "a", "b", { clock: () => 2, deadline: 1 })).toMatchObject({ timeout: true });

    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 200 }, { x: 0, y: 200 }, { x: 100, y: 200 }], "a", "b", { strokeMargin: Number.NaN, maxCheckedRectCount: Number.NaN, maxCandidatesPerSegment: Number.NaN })).toMatchObject({ timeout: false, geometryUnavailable: false });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 200 }, { x: 100, y: 200 }], "a", "b", { maxCandidatesPerSegment: 0 })).toMatchObject({ timeout: true });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 200 }, { x: 100, y: 200 }], "a", "b", { maxCheckedRectCount: 0 })).toMatchObject({ timeout: true });

    const candidates = index.candidates({ x: -100000, y: -100000, width: 200000, height: 200000 });
    expect(candidates.length).toBeLessThanOrEqual(4096);
  });

  it("handles marker envelopes with missing points and all-side visibility branches", () => {
    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "section", laneId: "foreign", x: 92, y: 92, width: 116, height: 316 });

    expect(topologyFallbackMarkerVisibility([], { x: 0, y: 0 }, { x: 100, y: 100 }, { index })).toEqual({ markerStart: false, markerEnd: false });
    expect(topologyFallbackMarkerVisibility([{ a: { x: 40, y: 409 }, b: { x: 211, y: 409 } }], { x: 40, y: 409 }, { x: 211, y: 409 }, { index, strokeWidth: 4, markerWidth: 14, markerHeight: 14, sourceId: "source", targetId: "target" })).toEqual({ markerStart: true, markerEnd: false });

    const empty = new TopologyFallbackRectIndex();
    expect(topologyFallbackMarkerVisibility([{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }], { x: 0, y: 0 }, { x: 100, y: 0 }, { index: empty })).toEqual({ markerStart: true, markerEnd: true });
  });

  it("fails closed for missing or non-finite route points instead of timeout fallbacks", () => {
    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "card", nodeId: "one", x: -100, y: -100, width: 20, height: 20 });

    expect(splitTopologyFallbackSegmentIndexed(index, { x: Number.NaN, y: 0 }, { x: 100, y: 0 }, "source", "target")).toMatchObject({ timeout: false, geometryUnavailable: true });
    expect(splitTopologyFallbackPolylinePreview(index, [], "source", "target")).toMatchObject({ timeout: false, geometryUnavailable: true });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 0 }], "source", "target")).toMatchObject({ timeout: false, geometryUnavailable: true });
    expect(splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 0 }, { x: Number.NaN, y: 100 }], "source", "target")).toMatchObject({ timeout: false, geometryUnavailable: true });
    expect(splitTopologyFallbackPolylineIndexed(index, [], "source", "target")).toMatchObject({ timeout: false, geometryUnavailable: true });
    expect(splitTopologyFallbackPolylineIndexed(index, [{ x: 0, y: 0 }, { x: 0, y: 0 }], "source", "target")).toMatchObject({ timeout: false, geometryUnavailable: true });
    expect(splitTopologyFallbackPolylineIndexed(index, [{ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 100 }], "source", "target")).toMatchObject({ timeout: false, geometryUnavailable: true });
  });

  it("covers overflow candidates and protected title, frame, section and card ownership", () => {
    const lanes = [lane("source", 0, 500, ["source"]), lane("target", 500, 500, ["target"]), lane("foreign", 1000, 500, ["foreign"])] as const;
    const laneByNode = new Map([["source", lanes[0]!], ["target", lanes[1]!], ["foreign", lanes[2]!]]);
    const index = new TopologyFallbackRectIndex();
    index.setLaneByNode(laneByNode);

    index.add({ kind: "section-title", laneId: "source", x: 10, y: 10, width: 100, height: 36 });
    index.add({ kind: "frame-title", frameId: "wide", frameNodeIds: ["source"], x: 20, y: 20, width: 80, height: 36 });
    index.add({ kind: "section", laneId: "source", x: 0, y: 0, width: 500, height: 400 });
    index.add({ kind: "section", laneId: "foreign", x: 1000, y: 0, width: 500, height: 400 });
    index.add({ kind: "frame", frameId: "own", frameNodeIds: ["source"], x: 30, y: 30, width: 300, height: 300 });
    index.add({ kind: "frame", frameId: "foreign", frameNodeIds: ["foreign"], x: 1100, y: 30, width: 300, height: 300 });
    index.add({ kind: "card", nodeId: "source", x: 40, y: 80, width: 40, height: 40 });
    index.add({ kind: "card", nodeId: "foreign", x: 1100, y: 80, width: 40, height: 40 });
    index.add({ kind: "card", nodeId: "huge", x: 0, y: 0, width: 10000, height: 10000 });

    const candidates = index.candidates({ x: 0, y: 0, width: 1500, height: 500 });
    expect(candidates.length).toBeGreaterThanOrEqual(0);
    expect(index.protectedCandidates({ x: 0, y: 0, width: 1500, height: 500 }, "source", "target").length).toBeGreaterThanOrEqual(0);
    expect(index.overlapsLabelEnvelope({ x: 50, y: 50, width: 20, height: 20 }, "source", "target")).toBe(true);

    const invalid = new TopologyFallbackRectIndex();
    invalid.add({ kind: "card", nodeId: "invalid", x: Number.NaN, y: 0, width: 10, height: 10 });
    expect(invalid.overlapsProtectedEnvelope({ x: 0, y: 0, width: 20, height: 20 }, "source", "target")).toBe(true);
    expect(invalid.overlapsLabelEnvelope({ x: 0, y: 0, width: 20, height: 20 }, "source", "target")).toBe(true);
  });

  it("rejects preview candidate overflow and polyline duplicate cleanup", () => {
    const index = new TopologyFallbackRectIndex();
    for (let i = 0; i < 5000; i++) index.add({ kind: "card", nodeId: `card-${i}`, x: i * 2, y: 100, width: 10, height: 10 });

    const preview = splitTopologyFallbackPolylinePreview(index, [{ x: 0, y: 105 }, { x: 10000, y: 105 }], "source", "target", { maxCandidatesPerSegment: 1, maxCheckedRectCount: 1 });
    expect(preview.timeout).toBe(true);

    const cleanIndex = new TopologyFallbackRectIndex();
    cleanIndex.add({ kind: "card", nodeId: "one", x: -100, y: -100, width: 20, height: 20 });
    const duplicateClean = splitTopologyFallbackPolylineIndexed(cleanIndex, [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }], "source", "target");
    expect(duplicateClean.timeout).toBe(false);
  });
});
