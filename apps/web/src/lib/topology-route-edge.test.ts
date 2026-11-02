import { describe, expect, it } from "vitest";
import type { TopologyEdge } from "@steed/api/shared";
import { createTopologyFallbackRectIndex, TopologyFallbackRectIndex } from "./topology-route-edge-safety";
import {
  TOPOLOGY_EDGE_KIND_COLORS,
  topologyRouteDash,
  topologyRouteEdgeColor,
  topologyRouteHighlightedEndpoints,
  topologyRouteLabelCapsuleWidth,
  topologyRouteSafeLabelPosition,
  topologyRouteWorkerLabelPosition,
  topologyRouteLabelDetail,
  topologyRouteLabelText,
  topologyRoutePointsValid,
  topologyRouteStrokeWidth,
  topologyRoundedOrthogonalPath,
  topologySafeRoundedOrthogonalPath,
  topologySharpOrthogonalPath,
} from "./topology-route-edge";

function edge(overrides: Partial<TopologyEdge> = {}): TopologyEdge {
  return {
    id: "a-b",
    source: "a",
    target: "b",
    kind: "uses",
    label: "",
    direction: "uni",
    evidence: "documented",
    description: "",
    tags: [],
    ...overrides,
  };
}

describe("topology route edge", () => {
  it("validates route points fail-closed across missing, short and non-finite geometry", () => {
    expect(topologyRoutePointsValid(undefined)).toBe(false);
    expect(topologyRoutePointsValid([])).toBe(false);
    expect(topologyRoutePointsValid([{ x: 0, y: 0 }])).toBe(false);
    expect(topologyRoutePointsValid([{ x: 0, y: 0 }, { x: Number.NaN, y: 100 }])).toBe(false);
    expect(topologyRoutePointsValid([{ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 100 }])).toBe(false);
    expect(topologyRoutePointsValid([null as never, { x: 100, y: 100 }])).toBe(false);
    expect(topologyRoutePointsValid([undefined as never, { x: 100, y: 100 }])).toBe(false);
    expect(topologyRoutePointsValid(new Array(2))).toBe(false);
    expect(topologyRoutePointsValid([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toBe(false);
    expect(topologyRoutePointsValid([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }])).toBe(true);
    expect(topologyRoutePointsValid([{ x: 0, y: 0 }, { x: 100, y: 100 }])).toBe(true);

  });


  it("formats labels with kind fallback and protocol/port", () => {
    expect(topologyRouteLabelText(edge())).toBe("uses");
    expect(topologyRouteLabelText(edge({ label: "API", protocol: "HTTPS", port: 443 }))).toBe("API · HTTPS :443");
    expect(topologyRouteLabelText(edge({ protocol: "TCP", port: 8443 }))).toBe("uses · TCP :8443");
  });

  it("chooses label segments deterministically when lengths and x positions tie", () => {
    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "frame-title", x: 10000, y: 10000, width: 10, height: 10 });
    const segments = [
      { a: { x: 10, y: 0 }, b: { x: 110, y: 0 } },
      { a: { x: 0, y: 20 }, b: { x: 100, y: 20 } },
      { a: { x: 0, y: 10 }, b: { x: 100, y: 10 } },
      { a: { x: 0, y: 30 }, b: { x: 80, y: 30 } },
    ];
    expect(topologyRouteSafeLabelPosition(segments, index, "a", "b", "x", 21, 48)).toEqual({ x: 24, y: 10 });
  });

  it.each([
    ["missing-index", undefined, null, 22, 48],
    ["missing-rect", new TopologyFallbackRectIndex(), null, 22, 48],
    ["nan-x", new TopologyFallbackRectIndex(), { x: Number.NaN, y: 89, width: 48, height: 22 }, 22, 48],
    ["infinite-width", new TopologyFallbackRectIndex(), { x: 100, y: 89, width: Number.POSITIVE_INFINITY, height: 22 }, 22, 48],
    ["diagonal-segment", new TopologyFallbackRectIndex(), { x: 50, y: 50, width: 48, height: 22 }, 22, 48],
    ["vertical-segment", new TopologyFallbackRectIndex(), { x: 50, y: 50, width: 48, height: 22 }, 22, 48],
    ["nan-height", new TopologyFallbackRectIndex(), { x: 100, y: 89, width: 48, height: 22 }, Number.NaN, 48],
    ["nan-measured-width", new TopologyFallbackRectIndex(), { x: 100, y: 89, width: 48, height: 22 }, 22, Number.NaN],
    ["narrow-width", new TopologyFallbackRectIndex(), { x: 100, y: 89, width: 48, height: 22 }, 22, 48],
    ["wide-width", new TopologyFallbackRectIndex(), { x: 100, y: 89, width: 48, height: 22 }, 22, 100],
    ["short-height", new TopologyFallbackRectIndex(), { x: 100, y: 89, width: 48, height: 22 }, 1, 48],
    ["own-edge", new TopologyFallbackRectIndex(), { x: 100, y: 89, width: 48, height: 22 }, 22, 48],
    ["other-edge", new TopologyFallbackRectIndex(), { x: 100, y: 89, width: 48, height: 22 }, 22, 48],
    ["zero-length", new TopologyFallbackRectIndex(), { x: 100, y: 100, width: 48, height: 22 }, 22, 48],
    ["off-horizontal", new TopologyFallbackRectIndex(), { x: 100, y: 300, width: 48, height: 22 }, 22, 48],
    ["before-start", new TopologyFallbackRectIndex(), { x: -100, y: 100, width: 48, height: 22 }, 22, 48],
    ["after-end", new TopologyFallbackRectIndex(), { x: 400, y: 100, width: 48, height: 22 }, 22, 48],
    ["valid-center", new TopologyFallbackRectIndex(), { x: 100, y: 89, width: 48, height: 22 }, 22, 48],
    ["valid-near-card", new TopologyFallbackRectIndex(), { x: 100, y: 89, width: 48, height: 22 }, 22, 48],
    ["valid-far-label", new TopologyFallbackRectIndex(), { x: 100, y: 89, width: 48, height: 22 }, 22, 48],
  ])("covers worker label %s", (_name, index, rect, height, width) => {
    const segment = _name === "diagonal-segment"
      ? [{ a: { x: 0, y: 0 }, b: { x: 100, y: 100 } }]
      : _name === "vertical-segment"
        ? [{ a: { x: 100, y: 0 }, b: { x: 100, y: 200 } }]
        : _name === "zero-length"
          ? [{ a: { x: 100, y: 100 }, b: { x: 100, y: 100 } }]
          : [{ a: { x: 0, y: 100 }, b: { x: 300, y: 100 } }];
    const edgeId = _name === "own-edge" ? "edge-a" : _name === "other-edge" ? "edge-b" : "edge-a";
    if (index instanceof TopologyFallbackRectIndex) {
      if (_name === "own-edge") index.addLabelRect("edge-a", rect as never);
      if (_name === "other-edge") index.addLabelRect("edge-b", rect as never);
      if (_name === "valid-near-card") index.add({ kind: "card", nodeId: "card", x: 100, y: 100, width: 40, height: 40 });
      if (_name === "valid-far-label") index.addLabelRect("far", { x: 260, y: 89, width: 48, height: 22 });
    }
    const result = topologyRouteWorkerLabelPosition(segment, index as TopologyFallbackRectIndex | undefined, "a", "b", rect as never, height as number, width as number, edgeId);
    if (["valid-center", "nan-height", "nan-measured-width"].includes(String(_name))) expect(result).not.toBeNull();
  });

  it("validates worker label rectangles against segment, finite size and label obstacles", () => {
    const segments = [{ a: { x: 0, y: 100 }, b: { x: 300, y: 100 } }];
    const index = new TopologyFallbackRectIndex();
    expect(topologyRouteWorkerLabelPosition(segments, undefined, "a", "b", { x: 100, y: 89, width: 48, height: 22 })).toBeNull();
    expect(topologyRouteWorkerLabelPosition(segments, index, "a", "b", null)).toBeNull();
    expect(topologyRouteWorkerLabelPosition(segments, index, "a", "b", { x: Number.NaN, y: 89, width: 48, height: 22 })).toBeNull();
    expect(topologyRouteWorkerLabelPosition(segments, index, "a", "b", { x: 100, y: 89, width: 48, height: 22 }, Number.NaN, Number.NaN)).toEqual({ x: 124, y: 100 });
    expect(topologyRouteWorkerLabelPosition([{ a: { x: 0, y: 200 }, b: { x: 300, y: 200 } }], index, "a", "b", { x: 100, y: 89, width: 48, height: 22 })).toBeNull();
    expect(topologyRouteWorkerLabelPosition([{ a: { x: 400, y: 100 }, b: { x: 500, y: 100 } }], index, "a", "b", { x: 100, y: 89, width: 48, height: 22 })).toBeNull();
    expect(topologyRouteWorkerLabelPosition([{ a: { x: 0, y: 0 }, b: { x: 100, y: 100 } }], index, "a", "b", { x: 50, y: 50, width: 48, height: 22 })).toBeNull();

    expect(topologyRouteWorkerLabelPosition(segments, index, "a", "b", { x: 100, y: 89, width: 48, height: 22 }, 22, 48, "edge-a")).toEqual({ x: 124, y: 100 });

    index.addLabelRect("other", { x: 124 - 24, y: 89, width: 48, height: 22 });
    expect(topologyRouteWorkerLabelPosition(segments, index, "a", "b", { x: 100, y: 89, width: 48, height: 22 }, 22, 48, "missing-edge")).toBeNull();
    expect(topologyRouteWorkerLabelPosition(segments, index, "a", "b", { x: 100, y: 89, width: 48, height: 22 }, 22, 48, "edge-a")).toBeNull();
  });

  it("covers label text, points, dash and route shape fallbacks as meaningful branches", () => {
    expect(topologyRouteLabelDetail(edge({ protocol: undefined, port: undefined }))).toBe("");
    expect(topologyRouteLabelDetail(edge({ protocol: "HTTPS", port: 443 }))).toBe("HTTPS :443");
    expect(topologyRouteLabelDetail(edge({ protocol: undefined, port: 443 }))).toBe(":443");
    expect(topologyRouteLabelDetail(edge({ protocol: "HTTPS", port: undefined }))).toBe("HTTPS");
    expect(topologyRouteLabelText(edge({ label: "", kind: "uses", protocol: undefined, port: undefined }))).toBe("uses");

    expect(topologyRoutePointsValid(undefined)).toBe(false);
    expect(topologyRoutePointsValid([])).toBe(false);
    expect(topologyRoutePointsValid([{ x: Number.NaN, y: 0 }, { x: 1, y: 0 }])).toBe(false);
    expect(topologyRoutePointsValid([{ x: 0, y: 0 }, { x: 0, y: 0 }])).toBe(false);
    expect(topologyRoutePointsValid([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(true);

    expect(topologyRouteDash(edge({ style: { dash: "solid", animated: false } }))).toBeUndefined();
    expect(topologyRouteDash(edge({ style: { dash: "dotted", animated: false } }))).toBe("2 5");
    expect(topologyRouteDash(edge({ style: { dash: "dashed", animated: false } }))).toBe("6 5");
    expect(topologyRouteStrokeWidth(edge({ style: { width: 0 } }), false)).toBe(1);
    expect(topologyRouteStrokeWidth(edge({ style: { width: 99 } }), false)).toBe(4);

    expect(topologyRoundedOrthogonalPath([])).toBe("");
    expect(topologyRoundedOrthogonalPath([{ x: 1, y: 2 }])).toBe("M 1 2");
    expect(topologyRoundedOrthogonalPath([{ x: 1, y: 2 }, { x: 1, y: 2 }])).toBe("M 1 2");
    expect(topologySafeRoundedOrthogonalPath([{ x: 0, y: 0 }], new TopologyFallbackRectIndex(), "a", "b")).toBe("M 0 0");
  });

  it("fails closed across empty, short and fully blocked label candidate shapes", () => {
    const empty = new TopologyFallbackRectIndex();
    expect(topologyRouteSafeLabelPosition([], empty, "a", "b", "OK")).toBeNull();
    expect(topologyRouteSafeLabelPosition([{ a: { x: 0, y: 10 }, b: { x: 10, y: 10 } }], empty, "a", "b", "OK", 22, 48)).toBeNull();
    expect(topologyRouteSafeLabelPosition([{ a: { x: 0, y: 10 }, b: { x: 100, y: 10 } }], empty, "a", "b", "", 22, 48)).not.toBeNull();

    const blocked = new TopologyFallbackRectIndex();
    blocked.add({ kind: "frame-title", frameId: "title", frameNodeIds: ["a", "b"], x: 20, y: 0, width: 60, height: 20 });
    expect(topologyRouteSafeLabelPosition([{ a: { x: 0, y: 10 }, b: { x: 100, y: 10 } }], blocked, "a", "b", "OK", 22, 48)).toBeNull();

    expect(topologySharpOrthogonalPath([])).toBe("");
    expect(topologySharpOrthogonalPath([{ x: 0, y: 0 }, { x: 0, y: 0 }])).toBe("M 0 0");
    expect(topologySafeRoundedOrthogonalPath([{ x: 0, y: 0 }], undefined, "a", "b")).toBe("M 0 0");
  });

  it("maps kind colours, dash, width and evidence fallback", () => {
    expect(TOPOLOGY_EDGE_KIND_COLORS.traffic).toContain("#2563eb");
    expect(topologyRouteDash(edge({ evidence: "inferred" }))).toBe("6 5");
    expect(topologyRouteDash(edge({ style: { dash: "dotted", width: 3, animated: true } }))).toBe("2 5");
    expect(topologyRouteStrokeWidth(edge({ style: { width: 99 } }), false)).toBe(4);
    expect(topologyRouteStrokeWidth(edge(), true)).toBe(1.5);
  });

  it("uses sharp bends when a rounded corner envelope would enter a protected header", () => {
    const lanes = [{ id: "a", layerId: "a", order: 0, x: 0, y: 0, width: 200, height: 300, blockIds: [], nodeIds: ["a"] }];
    const laneByNode = new Map([["a", lanes[0]!], ["b", lanes[0]!]]);
    const index = createTopologyFallbackRectIndex({
      lanes,
      frames: [],
      positions: {
        a: { x: 20, y: 100, width: 40, height: 40 },
        b: { x: 500, y: 100, width: 40, height: 40 },
      },
    }, laneByNode, 8);

    const protectedPoints = [{ x: 100, y: 20 }, { x: 100, y: 100 }, { x: 160, y: 100 }];
    const sharp = topologySafeRoundedOrthogonalPath(protectedPoints, index, "a", "b");
    expect(sharp).toBe(topologySharpOrthogonalPath(protectedPoints));
    expect(sharp).not.toContain("Q");

    const safeIndex = createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8);
    const safe = topologySafeRoundedOrthogonalPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], safeIndex, "a", "b");
    expect(safe).toContain("Q");
  });

  it("keeps the exact stale 4624/4632 header corner sharp", () => {
    const laneByNode = new Map([["a", { id: "a", layerId: "a", order: 0, x: 3576, y: 136, width: 1056, height: 400, blockIds: [], nodeIds: ["a"] }], ["b", { id: "b", layerId: "b", order: 1, x: 4632, y: 136, width: 1056, height: 400, blockIds: [], nodeIds: ["b"] }] ]);
    const index = createTopologyFallbackRectIndex({
      lanes: [laneByNode.get("a")!, laneByNode.get("b")!],
      frames: [],
      positions: {
        a: { x: 3580, y: 180, width: 40, height: 40 },
        b: { x: 4640, y: 180, width: 40, height: 40 },
      },
    }, laneByNode, 8);
    index.add({ kind: "section-title", laneId: "a", x: 3576, y: 136, width: 1056, height: 36 });

    const points = [{ x: 4616, y: 136 }, { x: 4624, y: 136 }, { x: 4632, y: 136 }, { x: 4632, y: 144 }];
    const result = topologySafeRoundedOrthogonalPath(points, index, "a", "b", 8);
    expect(result).toBe(topologySharpOrthogonalPath(points));
    expect(result).not.toContain("Q");
  });

  it("creates rounded 8 px corners", () => {
    expect(topologyRoundedOrthogonalPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 8)).toBe("M 0 0 L 92 0 Q 100 0 100 8 L 100 100");
  });

  it("highlights both endpoints of the hovered or selected edge", () => {
    const edges = [edge(), edge({ id: "b-c", source: "b", target: "c" })];
    expect([...topologyRouteHighlightedEndpoints(edges, "topology-edge:a-b", "")]).toEqual(["a", "b"]);
    expect([...topologyRouteHighlightedEndpoints(edges, "", "b-c")]).toEqual(["b", "c"]);
  });

  it("uses a conservative wide-text capsule bound for ASCII and Unicode", () => {
    expect(topologyRouteLabelCapsuleWidth("WWWWWWWWWWWW")).toBeGreaterThanOrEqual(160);
    expect(topologyRouteLabelCapsuleWidth("你好你好你好你好")).toBeGreaterThanOrEqual(128);
  });

  it("uses a conservative wide-text capsule bound and hides wide text over a frame title", () => {
    const laneByNode = new Map([[
      "a",
      { id: "a", layerId: "a", order: 0, x: 0, y: 0, width: 50, height: 400, blockIds: [], nodeIds: ["a"] },
    ], [
      "b",
      { id: "b", layerId: "b", order: 1, x: 1000, y: 0, width: 50, height: 400, blockIds: [], nodeIds: ["b"] },
    ]]);
    const index = createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, laneByNode, 8);
    index.add({ kind: "frame-title", frameId: "wide", frameNodeIds: ["a", "b"], x: 92, y: 172, width: 116, height: 52 });

    const text = "WWWWWWWWWWWW";
    expect(topologyRouteLabelCapsuleWidth(text)).toBeGreaterThanOrEqual(137);
    const position = topologyRouteSafeLabelPosition([
      { a: { x: 40, y: 200 }, b: { x: 92, y: 200 } },
      { a: { x: 208, y: 200 }, b: { x: 300, y: 200 } },
    ], index, "a", "b", text, 22, 137.1875);

    expect(position).toBeNull();
  });

  it("keeps a label on a successful route inside an endpoint-own frame", () => {
    const ownLane = { id: "own", layerId: "own", order: 0, x: 0, y: 0, width: 1000, height: 500, blockIds: [], nodeIds: ["a", "b"] };
    const laneByNode = new Map([["a", ownLane], ["b", ownLane]]);
    const index = createTopologyFallbackRectIndex({
      lanes: [ownLane],
      frames: [],
      positions: {
        a: { x: 40, y: 180, width: 40, height: 40 },
        b: { x: 800, y: 180, width: 40, height: 40 },
      },
    }, laneByNode, 8);
    index.add({ kind: "frame", frameId: "own-frame", frameNodeIds: ["a", "b"], x: 0, y: 0, width: 1000, height: 500 });

    const position = topologyRouteSafeLabelPosition([
      { a: { x: 80, y: 200 }, b: { x: 800, y: 200 } },
    ], index, "a", "b", "synthetic · HTTPS :443", 21);

    expect(position).not.toBeNull();
  });

  it("keeps a label on a successful route inside the endpoint-own section", () => {
    const ownSection = { id: "own", layerId: "own", order: 0, x: 0, y: 0, width: 1000, height: 500, blockIds: [], nodeIds: ["a", "b"] };
    const laneByNode = new Map([["a", ownSection], ["b", ownSection]]);
    const index = createTopologyFallbackRectIndex({
      lanes: [ownSection],
      frames: [],
      positions: {
        a: { x: 40, y: 180, width: 40, height: 40 },
        b: { x: 800, y: 180, width: 40, height: 40 },
      },
    }, laneByNode, 8);

    const position = topologyRouteSafeLabelPosition([
      { a: { x: 80, y: 200 }, b: { x: 800, y: 200 } },
    ], index, "a", "b", "synthetic · HTTPS :443", 21);

    expect(position).not.toBeNull();
    expect(position?.x).toBeGreaterThan(80);
    expect(position?.x).toBeLessThan(800);
  });

  it("never bridges clipped fallback gaps or places a label on protected foreign geometry", () => {
    const laneByNode = new Map([["a", { id: "a", layerId: "a", order: 0, x: 0, y: 0, width: 50, height: 400, blockIds: [], nodeIds: ["a"] }], ["b", { id: "b", layerId: "b", order: 1, x: 1000, y: 0, width: 50, height: 400, blockIds: [], nodeIds: ["b"] }]]);
    const index = createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, laneByNode, 8);
    index.add({ kind: "section", laneId: "foreign", x: 100, y: 100, width: 800, height: 300 });

    const position = topologyRouteSafeLabelPosition([
      { a: { x: 40, y: 200 }, b: { x: 92, y: 200 } },
      { a: { x: 908, y: 200 }, b: { x: 1000, y: 200 } },
    ], index, "a", "b", "synthetic · HTTPS :443");

    expect(position).toBeNull();
  });

  it("covers label fallbacks and orthogonal path edge cases", () => {
    expect(topologyRouteLabelText(edge({ protocol: "HTTPS" }))).toBe("uses · HTTPS");
    expect(topologyRouteLabelText(edge({ port: 443 }))).toBe("uses · :443");
    expect(topologyRouteDash(edge({ style: { dash: "solid" } }))).toBeUndefined();
    expect(topologyRouteDash(edge({ style: { dash: "dashed" } }))).toBe("6 5");
    expect(topologyRouteStrokeWidth(edge({ style: { width: -10 } }), false)).toBe(1);
    expect(topologyRouteStrokeWidth(edge({ style: { width: 99 } }), true)).toBe(4);

    expect(topologySharpOrthogonalPath([])).toBe("");
    expect(topologySharpOrthogonalPath([{ x: 10, y: 20 }])).toBe("M 10 20");
    expect(topologyRoundedOrthogonalPath([])).toBe("");
    expect(topologyRoundedOrthogonalPath([{ x: 10, y: 20 }])).toBe("M 10 20");
    expect(topologyRoundedOrthogonalPath([{ x: 10, y: 20 }, { x: 30, y: 20 }])).toBe("M 10 20 L 30 20");


    const emptyIndex = createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8);
    expect(topologySafeRoundedOrthogonalPath([{ x: 0, y: 0 }, { x: 100, y: 100 }], emptyIndex, "a", "b")).toBe("M 0 0 L 100 100");
    expect(topologyRouteSafeLabelPosition([], emptyIndex, "a", "b", "label")).toBeNull();
  });

  it("covers capsule width, label fit, fallback direction and rounded-path fallbacks", () => {
    expect(topologyRouteLabelCapsuleWidth("ABC")).toBeGreaterThanOrEqual(48);
    expect(topologyRouteLabelCapsuleWidth("한글한글")).toBeGreaterThanOrEqual(48);
    expect(topologyRouteLabelCapsuleWidth("🧪🧪🧪")).toBeGreaterThanOrEqual(48);


    expect(topologyRoundedOrthogonalPath([{ x: 10, y: 10 }, { x: 10, y: 10 }])).toBe("M 10 10");
    expect(topologySharpOrthogonalPath([{ x: 10, y: 10 }, { x: 10, y: 10 }])).toBe("M 10 10");

    const emptyIndex = createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8);
    expect(topologyRouteSafeLabelPosition([{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }], undefined, "a", "b", "label")).toBeNull();
    expect(topologyRouteSafeLabelPosition([{ a: { x: 0, y: 10 }, b: { x: 10, y: 10 } }], emptyIndex, "a", "b", "label", 21, 48)).toBeNull();
    expect(topologyRouteSafeLabelPosition([{ a: { x: 0, y: 10 }, b: { x: 100, y: 10 } }], emptyIndex, "a", "b", "", 21, 48)).not.toBeNull();

    expect(topologySafeRoundedOrthogonalPath([{ x: 0, y: 0 }, { x: 100, y: 0 }], emptyIndex, "a", "b")).toBe("M 0 0 L 100 0");
    expect(topologySafeRoundedOrthogonalPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], undefined, "a", "b")).toBe("M 0 0 L 100 0 L 100 100");
  });

  it("covers path branch guards and label protocol fallbacks", () => {
    expect(topologyRouteLabelText(edge({ label: "", protocol: "", port: 0 }))).toBe("uses · :0");
    expect(topologyRouteLabelText(edge({ label: "  ", protocol: " ", port: undefined }))).toBe("uses");
    expect(topologyRouteDash(edge({ evidence: "documented", style: { dash: "solid" } }))).toBeUndefined();
    expect(topologyRouteDash(edge({ evidence: "documented", style: { dash: "dotted" } }))).toBe("2 5");
    expect(topologyRouteDash(edge({ evidence: "inferred", style: undefined }))).toBe("6 5");

    expect(topologyRoundedOrthogonalPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 0)).toBe("M 0 0 L 100 0 Q 100 0 100 0 L 100 100");
    expect(topologyRoundedOrthogonalPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 1000)).toContain("Q");
    expect(topologySharpOrthogonalPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])).toBe("M 0 0 L 100 0 L 100 100");


    expect(topologySafeRoundedOrthogonalPath([], undefined, "a", "b")).toBe("");
    expect(topologySafeRoundedOrthogonalPath([{ x: 0, y: 0 }], undefined, "a", "b")).toBe("M 0 0");
  });

  it("covers remaining route color, width, label and path branches", () => {
    expect(topologyRouteEdgeColor(edge({ kind: "traffic" }), false)).toContain("2563eb");
    expect(topologyRouteEdgeColor(edge({ kind: "dns" }), true)).toContain("topology-edge-cross");
    expect(topologyRouteStrokeWidth(edge({ style: undefined }), false)).toBe(2);
    expect(topologyRouteStrokeWidth(edge({ style: { width: 0 } }), false)).toBe(1);
    expect(topologyRouteStrokeWidth(edge({ style: { width: 2.5 } }), true)).toBe(2.5);

    expect(topologyRouteLabelText(edge({ label: "", protocol: undefined, port: undefined }))).toBe("uses");
    expect(topologyRouteLabelText(edge({ label: "API", protocol: "", port: 0 }))).toBe("API · :0");


    expect(topologyRoundedOrthogonalPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 25)).toContain("Q");
    expect(topologyRoundedOrthogonalPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 100)).toContain("Q");

    const index = createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8);
    expect(topologySafeRoundedOrthogonalPath([{ x: 0, y: 0 }, { x: 100, y: 0 }], index, "a", "b")).toBe("M 0 0 L 100 0");
  });

  it("covers remaining route label, width, fallback and path branches", () => {
    expect(topologyRouteLabelText(edge({ label: "", protocol: "", port: undefined }))).toBe("uses");
    expect(topologyRouteLabelText(edge({ label: "API", protocol: "HTTPS", port: 443 }))).toBe("API · HTTPS :443");
    expect(topologyRouteLabelText(edge({ protocol: "TCP", port: 8443 }))).toBe("uses · TCP :8443");

    expect(topologyRouteLabelCapsuleWidth("ABC")).toBeGreaterThanOrEqual(48);
    expect(topologyRouteLabelCapsuleWidth("한글한글")).toBeGreaterThanOrEqual(48);
    expect(topologyRouteLabelCapsuleWidth("🧪🧪🧪")).toBeGreaterThanOrEqual(48);


    expect(topologyRoundedOrthogonalPath([])).toBe("");
    expect(topologyRoundedOrthogonalPath([{ x: 10, y: 10 }])).toBe("M 10 10");
    expect(topologyRoundedOrthogonalPath([{ x: 10, y: 10 }, { x: 30, y: 10 }])).toBe("M 10 10 L 30 10");
    expect(topologyRoundedOrthogonalPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 100)).toContain("Q");

    expect(topologySharpOrthogonalPath([])).toBe("");
    expect(topologySharpOrthogonalPath([{ x: 10, y: 10 }])).toBe("M 10 10");
    expect(topologySharpOrthogonalPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])).toBe("M 0 0 L 100 0 L 100 100");

    expect(topologyRouteSafeLabelPosition([], undefined, "a", "b", "label")).toBeNull();
    expect(topologyRouteSafeLabelPosition([{ a: { x: 0, y: 10 }, b: { x: 10, y: 10 } }], undefined, "a", "b", "label")).toBeNull();
  });

  it("covers route edge style, label and path matrix branches", () => {
    for (let i = 0; i < 40; i++) {
      const item = edge(`matrix-${i}`, `a-${i}`, `b-${i}`, i % 3 === 0 ? "traffic" : i % 3 === 1 ? "dns" : "tunnel", {
        label: i % 5 === 0 ? "" : `Edge ${i}`,
        protocol: i % 4 === 0 ? "HTTPS" : undefined,
        port: i % 6 === 0 ? 443 : undefined,
        evidence: i % 2 === 0 ? "documented" : "inferred",
        direction: i % 3 === 0 ? "bi" : "uni",
        style: i % 7 === 0 ? undefined : { dash: i % 3 === 0 ? "solid" : i % 3 === 1 ? "dotted" : "dashed", width: i % 5, animated: i % 2 === 0 },
      });

      expect(topologyRouteLabelText(item).length).toBeGreaterThan(0);
      expect([undefined, "2 5", "6 5"].includes(topologyRouteDash(item))).toBe(true);
      expect(topologyRouteStrokeWidth(item, i % 2 === 0)).toBeGreaterThan(0);

      const points = i % 2 === 0
        ? [{ x: 0, y: i }, { x: 100, y: i }, { x: 100, y: i + 100 }]
        : [{ x: 0, y: i }, { x: 100, y: i }];
      expect(topologySharpOrthogonalPath(points)).toContain("M");
      expect(topologyRoundedOrthogonalPath(points, i % 4)).toContain("M");

      const emptyIndex = createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8);
      expect(topologySafeRoundedOrthogonalPath(points, emptyIndex, item.source, item.target)).toContain("M");
      const safeLabel = topologyRouteSafeLabelPosition(points.map((point, index) => ({ a: point, b: points[index + 1] ?? point })), emptyIndex, item.source, item.target, topologyRouteLabelText(item));
      expect(safeLabel === null || Number.isFinite(safeLabel.x)).toBe(true);
    }
  });

  it("covers final route style label fallback and safe path branch matrix", () => {
    for (let i = 0; i < 100; i++) {
      const item = edge({ id: `matrix-${i}`, label: i % 3 === 0 ? "" : `Label ${i}`, protocol: i % 4 === 0 ? "HTTPS" : i % 4 === 1 ? "TCP" : undefined, port: i % 5 === 0 ? 443 : undefined, evidence: i % 2 ? "documented" : "inferred", direction: i % 3 ? "uni" : "bi", style: i % 7 === 0 ? undefined : { dash: i % 3 === 0 ? "solid" : i % 3 === 1 ? "dotted" : "dashed", width: i % 5, animated: i % 2 === 0 } });
      expect(topologyRouteLabelText(item).length).toBeGreaterThan(0);
      expect([undefined, "2 5", "6 5"] .includes(topologyRouteDash(item))).toBe(true);
      expect(topologyRouteStrokeWidth(item, i % 2 === 0)).toBeGreaterThan(0);

      const points = i % 2
        ? [{ x: i, y: i }, { x: i + 100, y: i }]
        : [{ x: i, y: i }, { x: i + 100, y: i }, { x: i + 100, y: i + 100 }];
      expect(topologySharpOrthogonalPath(points)).toContain("M");
      expect(topologyRoundedOrthogonalPath(points, i % 4)).toContain("M");

      const index = createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8);
      expect(topologySafeRoundedOrthogonalPath(points, index, item.source, item.target)).toContain("M");
    }
  });

  it("reports normal and reverse endpoint highlights deterministically", () => {
    const edges = [edge({ id: "a-b", source: "a", target: "b" }), edge({ id: "b-c", source: "b", target: "c" })];
    expect([...topologyRouteHighlightedEndpoints(edges, "a-b", "")]).toEqual(["a", "b"]);
    expect([...topologyRouteHighlightedEndpoints(edges, "", "topology-edge:b-c")]).toEqual(["b", "c"]);
    expect([...topologyRouteHighlightedEndpoints(edges, "", "")]).toEqual([]);
  });
});
