import { createElement, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Topology, TopologyEdge } from "@steed/api/shared";
import { TopologyFallbackRectIndex, createTopologyFallbackRectIndex, splitTopologyFallbackPolylineIndexed, topologyFallbackMarkerVisibility } from "./lib/topology-route-edge-safety";
import { topologyRouteSafeLabelPosition } from "./lib/topology-route-edge";
import { computeTopologyLayout } from "./lib/topology-layout-compute";
import { TopologyCanvas } from "./components/map/topology-canvas";
import { TopologyRouteEdge } from "./components/map/topology-route-edge";

const flow = vi.hoisted(() => ({ zoom: 1, projected: [] as any[], setViewport: vi.fn(), setCenter: vi.fn() }));
vi.mock("@xyflow/react", async (original) => {
  const actual = await original<typeof import("@xyflow/react")>();
  const React = await import("react");
  return {
    ...actual,
    BaseEdge: (props: any) => React.createElement("svg", null, React.createElement(actual.BaseEdge, props)),
    ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
    EdgeLabelRenderer: ({ children }: { children: ReactNode }) => React.createElement("div", null, children),
    ViewportPortal: ({ children }: { children: ReactNode }) => children,
    useStore: (selector: any) => selector({ transform: [0, 0, flow.zoom], width: 1000, height: 700 }),
    useReactFlow: () => ({ setViewport: flow.setViewport, setCenter: flow.setCenter, getZoom: () => flow.zoom }),
    Background: () => null,
    Controls: ({ children }: { children: ReactNode }) => children,
    ControlButton: ({ children }: { children: ReactNode }) => React.createElement("button", null, children),
    ReactFlow: (props: any) => {
      flow.projected = props.edges;
      return React.createElement("div", null, props.children, props.edges.map((edge: any) => React.createElement(props.edgeTypes[edge.type], { key: edge.id, id: edge.id, data: edge.data, style: edge.style })));
    },
  };
});

function model(id: string, label = "OK"): TopologyEdge {
  return { id, label, source: "a", target: "b", kind: "uses", direction: "uni", evidence: "documented", description: "", tags: [] };
}
function safeIndex() {
  const index = new TopologyFallbackRectIndex();
  index.add({ kind: "frame-title", x: 10000, y: 10000, width: 1, height: 1 });
  return index;
}
function topology(): Topology {
  return {
    schemaVersion: 2, revision: 1, title: "R2 synthetic", description: "",
    layers: [{ id: "test", label: "Test", order: 0, provider: "Synthetic", description: "" }],
    types: [{ id: "host", label: "Host", shape: "rounded", attrs: [], description: "" }],
    boundaries: [],
    nodes: ["a", "b", "c", "d"].map(id => ({ id, label: id, type: "host", layerId: "test", boundaryIds: [], lifecycle: "active", attrs: {}, tags: [], description: "" })),
    edges: [model("a-b", "iiiiii")], views: [],
  };
}
class WorkerStub {
  static current: WorkerStub;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  message: any;
  constructor() { WorkerStub.current = this; }
  postMessage(message: any) { this.message = message; }
  terminate() {}
  finish(result: any) { this.onmessage?.({ data: { requestId: this.message.requestId, layoutVersion: this.message.layoutVersion, ok: true, result } }); }
}
function labels() {
  return [...document.querySelectorAll<HTMLButtonElement>(".topology-route-edge-label")].filter(node => node.style.visibility === "visible").map(node => {
    const match = node.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)!;
    const width = node.textContent?.includes("WIDE") ? 220 : 100;
    return { x: Number(match[1]), y: Number(match[2]), width: width / flow.zoom, height: 22 / flow.zoom, text: node.textContent };
  });
}
function disjoint() {
  const boxes = labels();
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    expect(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2).toBe(true);
  }
}
function renderedEdge(index: TopologyFallbackRectIndex, id: string, text = "OK", y = 200, worker?: any, fallback = false) {
  return createElement(TopologyRouteEdge, { key: id, id, selected: false, data: { edge: model(id, text), points: [{ x: 0, y }, { x: 500, y }], status: fallback ? "fallback" : "routed", showLabel: true, fallbackIndex: index, workerLabel: worker } });
}

beforeEach(() => {
  flow.zoom = 1;
  vi.stubGlobal("Worker", WorkerStub);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (): DOMRect {
    const width = this.textContent?.includes("WIDE") ? 220 : 100;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 22, width, height: 22, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("R3 independent probes", () => {
  it("ignores only the own label with reversed-order negative controls", () => {
    const rect = { x: 100, y: 189, width: 100, height: 22 };
    const index = safeIndex();
    index.addLabelRect("own", rect);
    index.addLabelRect("other", rect);
    expect(index.overlapsLabelEnvelope(rect, "a", "b", 0, "own")).toBe(true);
    index.releaseLabelRect("own");
    expect(index.overlapsLabelEnvelope(rect, "a", "b", 0, "own")).toBe(true);
    const reversed = safeIndex();
    reversed.addLabelRect("other", rect);
    reversed.addLabelRect("own", rect);
    expect(reversed.overlapsLabelEnvelope(rect, "a", "b", 0, "own")).toBe(true);
  });

  it("keeps two measured worker allocations disjoint through text/route/zoom updates and unmount", () => {
    const index = safeIndex();
    const a = { rect: { x: 100, y: 189, width: 100, height: 22 }, hidden: false, text: "OK", segmentIndex: 0 };
    const b = { rect: { x: 250, y: 189, width: 100, height: 22 }, hidden: false, text: "OK", segmentIndex: 0 };
    index.addLabelRect("a", a.rect); index.addLabelRect("b", b.rect);
    const { rerender } = render(<>{renderedEdge(index, "a", "OK", 200, a)}{renderedEdge(index, "b", "OK", 200, b)}</>);
    expect(labels()).toHaveLength(2); disjoint();
    rerender(<>{renderedEdge(index, "a", "WIDE", 200, a)}{renderedEdge(index, "b", "OK", 200, b)}</>);
    disjoint();
    rerender(<>{renderedEdge(index, "a", "WIDE", 206, a)}{renderedEdge(index, "b", "OK", 200, b)}</>);
    disjoint();
    flow.zoom = 0.8;
    rerender(<>{renderedEdge(index, "a", "OK", 206, a)}{renderedEdge(index, "b", "OK", 200, b)}</>);
    disjoint();
    rerender(<>{renderedEdge(index, "a", "OK", 206, a)}</>);
    expect(index.labelRectCount()).toBe(1);
    rerender(<></>);
    expect(index.labelRectCount()).toBe(0);
    expect(index.rectCount()).toBe(1);
  });

  it("keeps absent/failed worker label allocations disjoint and releases unmounted reservations", () => {
    const index = safeIndex();
    const { rerender } = render(<>{renderedEdge(index, "a", "OK", 200, undefined, true)}{renderedEdge(index, "b", "OK", 200, { rect: null, hidden: true, text: "OK", segmentIndex: null }, true)}</>);
    expect(labels()).toHaveLength(2); disjoint();
    rerender(<>{renderedEdge(index, "b", "WIDE", 200, undefined, true)}</>);
    expect(labels()).toHaveLength(1); expect(index.labelRectCount()).toBe(1);
    rerender(<></>); expect(index.labelRectCount()).toBe(0); expect(index.rectCount()).toBe(1);
  });

  it("recovers worker-hidden conservative labels through actual canvas projection and measurement", () => {
    const input = topology();
    const result = computeTopologyLayout(input, {}, { clock: () => 0 });
    expect(result.routeDiagnostics?.fallbackCount).toBe(0);
    expect(result.hiddenEdgeIds).toContain("a-b");
    expect(result.labels!.labels["a-b"]!.reason).toBe("no_available_position");
    const points = result.routes!["a-b"]!.points;
    const segments = points.slice(0, -1).map((a, i) => ({ a, b: points[i + 1]! }));
    const index = createTopologyFallbackRectIndex(result, new Map(result.lanes.flatMap(lane => lane.nodeIds.map(id => [id, lane] as const))), 8);
    expect(topologyRouteSafeLabelPosition(segments, index, "a", "b", "iiiiii", 22, 48, "a-b")).not.toBeNull();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (): DOMRect {
      return { x: 0, y: 0, left: 0, top: 0, right: 48, bottom: 22, width: 48, height: 22, toJSON: () => ({}) } as DOMRect;
    });
    render(<TopologyCanvas topology={input} visibleNodes={input.nodes} visibleEdges={input.edges} selectedNodeId="" onSelect={() => {}} />);
    act(() => WorkerStub.current.finish(result));
    expect(flow.projected[0].data.showLabel).toBe(true);
    expect(screen.getByRole("button", { name: "iiiiii" })).toBeVisible();
  });

  it("keeps healthy pending preview separate from final worker routing", () => {
    const input = topology();
    render(<TopologyCanvas topology={input} visibleNodes={input.nodes} visibleEdges={input.edges} selectedNodeId="" onSelect={() => {}} />);
    const region = screen.getByRole("region", { name: "Topology graph" });
    expect(region.getAttribute("data-route-status")).toBe("preview");
    expect(region.getAttribute("data-route-phase")).toBe("preview");
    expect(region.getAttribute("data-route-failures")).toBe("0");
    expect(region.getAttribute("data-route-fallback-count")).toBe("0");
    expect(screen.queryByRole("status")).toBeNull();
    const result = computeTopologyLayout(input, {}, { clock: () => 0 });
    act(() => WorkerStub.current.finish(result));
    expect(region.getAttribute("data-route-status")).toBe("complete");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("surfaces final worker degradation and actual BaseEdge forwards route attributes", () => {
    const input = topology();
    render(<TopologyCanvas topology={input} visibleNodes={input.nodes} visibleEdges={input.edges} selectedNodeId="" onSelect={() => {}} />);
    const result = computeTopologyLayout(input, {}, { clock: () => 0 });
    result.routes!["a-b"]!.status = "fallback"; result.routes!["a-b"]!.renderMode = "straight"; result.routes!["a-b"]!.fallback = "no_path";
    result.routeDiagnostics!.status = "fallback"; result.routeDiagnostics!.fallbackCount = 1; result.routeDiagnostics!.routeFailures = [{ edgeId: "a-b", reason: "no_path" }];
    act(() => WorkerStub.current.finish(result));
    expect(screen.getByRole("status")).toHaveTextContent("Routing degraded (fallback)");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Worker routing degraded (fallback)"), result.routeDiagnostics);
    expect(document.querySelector("path[data-route='fallback']")).not.toBeNull();
  });

  it("keeps label-only rectangles outside fallback clipping and terminal markers", () => {
    const index = safeIndex();
    const points = [{ x: 0, y: 200 }, { x: 500, y: 200 }];
    const before = splitTopologyFallbackPolylineIndexed(index, points, "a", "b");
    expect(before.segments).toHaveLength(1);
    expect(topologyFallbackMarkerVisibility(before.segments, points[0]!, points[1]!, { index, sourceId: "a", targetId: "b" }).markerEnd).toBe(true);
    index.addLabelRect("own", { x: 390, y: 189, width: 104, height: 22 });
    const after = splitTopologyFallbackPolylineIndexed(index, points, "a", "b");
    expect(after.segments).toEqual(before.segments);
    expect(topologyFallbackMarkerVisibility(after.segments, points[0]!, points[1]!, { index, sourceId: "a", targetId: "b" }).markerEnd).toBe(true);
  });

  it("keeps an already measured fallback route stable on React rerender", () => {
    const index = safeIndex();
    const data = { edge: model("self"), points: [{ x: 0, y: 200 }, { x: 500, y: 200 }], status: "fallback" as const, showLabel: true, fallbackIndex: index };
    const { rerender } = render(<TopologyRouteEdge id="self" selected={false} data={data} />);
    expect(document.querySelector("path[data-route='fallback']")!.getAttribute("d")).toBe("M 0 200 L 500 200");
    expect(labels()).toHaveLength(1);
    rerender(<TopologyRouteEdge id="self" selected={true} data={data} />);
    expect(document.querySelector("path[data-route='fallback']")!.getAttribute("d")).toBe("M 0 200 L 500 200");
  });

  it("marks fully clipped fallbacks without pretending a path was painted", () => {
    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "section-title", x: -100, y: 0, width: 1000, height: 1000 });
    render(renderedEdge(index, "blocked", "OK", 200, undefined, true));
    expect(document.querySelector("[data-diagnostic='fallback-detailed-no-visible-segments']")).not.toBeNull();
    expect(document.querySelector("[data-route='fallback']")).not.toBeNull();
    expect(document.querySelector("path")).toBeNull();
  });

  it("marks known fallback geometry even when its points are absent or invalid", () => {
    const index = safeIndex();
    const { rerender } = render(<TopologyRouteEdge id="invalid" selected={false} data={{ edge: model("invalid"), points: [], status: "fallback", fallbackIndex: index }} />);
    for (const points of [[], undefined, [{ x: 0, y: 200 }, { x: Number.NaN, y: 200 }]]) {
      rerender(<TopologyRouteEdge id="invalid" selected={false} data={{ edge: model("invalid"), points, status: "fallback", fallbackIndex: index }} />);
      expect(document.querySelector("[data-diagnostic='geometry-unavailable']")).not.toBeNull();
      expect(document.querySelector("[data-route='fallback']")).not.toBeNull();
      expect(document.querySelector("path")).toBeNull();
    }
  });
});
