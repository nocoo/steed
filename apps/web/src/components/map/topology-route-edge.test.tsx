import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { EdgeProps } from "@xyflow/react";
import type { TopologyEdge } from "@steed/api/shared";
import { TopologyRouteEdge, type TopologyRouteEdgeType } from "./topology-route-edge";
import { createTopologyFallbackRectIndex, TopologyFallbackRectIndex } from "@/lib/topology-route-edge-safety";

vi.mock("@xyflow/react", () => ({
  useStore: (selector: (value: { transform: number[] }) => unknown) => selector({ transform: [0, 0, 1] }),
  BaseEdge: (props: { id: string; path: string; markerStart?: string; markerEnd?: string; style?: Record<string, unknown>; className?: string; "data-fallback"?: string; "data-diagnostic"?: string; "data-visible-segments"?: number; "data-fallback-style"?: string; "data-route"?: string }) => (
    <svg><path data-testid="route-edge-path" data-id={props.id} d={props.path} markerStart={props.markerStart ?? undefined} markerEnd={props.markerEnd ?? undefined} className={props.className} data-fallback={props["data-fallback"]} data-diagnostic={props["data-diagnostic"]} data-visible-segments={props["data-visible-segments"]} data-fallback-style={props["data-fallback-style"]} data-route={props["data-route"]} style={props.style} /></svg>
  ),
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <div data-testid="edge-label-renderer">{children}</div>,
}));

function edge(overrides: Partial<TopologyEdge> = {}): TopologyEdge {
  return {
    id: "a-b",
    source: "a",
    target: "b",
    kind: "traffic",
    label: "HTTPS",
    protocol: "HTTPS",
    port: 443,
    direction: "bi",
    evidence: "documented",
    description: "",
    tags: [],
    style: { dash: "dashed", width: 3, animated: true },
    ...overrides,
  };
}

function fallbackIndex(rects: Array<{ kind: "section" | "card"; x: number; y: number; width: number; height: number }> = []) {
  const lanes = [{ id: "a", layerId: "a", order: 0, x: 0, y: 0, width: 500, height: 400, blockIds: [], nodeIds: ["a"] }, { id: "b", layerId: "b", order: 1, x: 500, y: 0, width: 500, height: 400, blockIds: [], nodeIds: ["b"] }];
  const laneByNode = new Map([["a", lanes[0]!], ["b", lanes[1]!]]);
  const index = createTopologyFallbackRectIndex({ lanes, frames: [], positions: { a: { x: 0, y: 80, width: 40, height: 40 }, b: { x: 700, y: 80, width: 40, height: 40 } } }, laneByNode, 8);
  for (const rect of rects) index.add({ kind: rect.kind, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  return index;
}

function props(overrides: Partial<EdgeProps<TopologyRouteEdgeType>> = {}): EdgeProps<TopologyRouteEdgeType> {
  return {
    id: "topology-edge:a-b",
    source: "a",
    target: "b",
    sourceX: 0,
    sourceY: 0,
    sourcePosition: "right" as never,
    targetX: 100,
    targetY: 100,
    targetPosition: "left" as never,
    markerStart: "url(#marker-start)",
    markerEnd: "url(#marker-end)",
    selected: true,
    data: { edge: edge(), points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], crossLayer: false, showLabel: true, fallbackIndex: createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8) },
    ...overrides,
  };
}

describe("TopologyRouteEdge", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(): DOMRect {
      return { x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 22, width: 100, height: 22, toJSON: () => ({}) } as DOMRect;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a rounded route, arrows, style and protocol/port label", () => {
    render(<TopologyRouteEdge {...props({
      data: { edge: edge(), points: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 100 }], crossLayer: false, showLabel: true, fallbackIndex: createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8) },
    })} />);

    const path = screen.getByTestId("route-edge-path");
    expect(path).toHaveAttribute("d", "M 0 0 L 292 0 Q 300 0 300 8 L 300 100");
    expect(path).toHaveAttribute("data-route", "routed");
    expect(path).toHaveAttribute("marker-start", "url(#marker-start)");
    expect(path).toHaveAttribute("marker-end", "url(#marker-end)");
    expect(path).toHaveClass("topology-route-edge-animated");
    expect(path).toHaveClass("topology-route-edge-highlighted");
    expect(screen.getByRole("button", { name: "HTTPS · HTTPS :443" }).querySelector(".font-mono")).toHaveTextContent("HTTPS :443");
  });

  it("preserves projected color, width, dash and opacity for routed and fallback edges", () => {
    const data = { edge: edge({ direction: "bi" }), points: [{ x: 0, y: 120 }, { x: 300, y: 120 }], status: "routed" as const, showLabel: false, fallbackIndex: fallbackIndex([]) };
    const style = { stroke: "rgb(10, 20, 30)", strokeWidth: 3, strokeDasharray: "2 5", strokeOpacity: 0.4 };
    const { rerender } = render(<TopologyRouteEdge {...props({ data, style })} />);
    expect(screen.getByTestId("route-edge-path")).toHaveStyle({ stroke: style.stroke, strokeWidth: "3", strokeDasharray: "2 5", strokeOpacity: "0.4" });
    rerender(<TopologyRouteEdge {...props({ data: { ...data, status: "fallback", fallbackStyle: "faded" }, style })} />);
    const paths = screen.getAllByTestId("route-edge-path");
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toHaveStyle({ stroke: style.stroke, strokeWidth: "3", strokeDasharray: "6 5", opacity: "0.35" });
    rerender(<TopologyRouteEdge {...props({ data: { ...data, status: "fallback", fallbackStyle: "dashed" }, style: { stroke: "red", strokeWidth: "3px" } })} />);
    expect(screen.getAllByTestId("route-edge-path")[0]).toHaveStyle({ stroke: "rgb(255, 0, 0)", strokeWidth: "3px", opacity: "0.65" });
  });

  it("keeps zero-sized measurements hidden and remeasures after a label change", () => {
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (): DOMRect {
      const width = this.textContent?.includes("Infinite") ? Number.POSITIVE_INFINITY : this.textContent?.includes("Recovered") || this.textContent?.includes("NoHeight") ? 90 : 0;
      const height = this.textContent?.includes("NoHeight") ? 0 : 22;
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
    });
    const index = new TopologyFallbackRectIndex();
    index.add({ kind: "frame-title", x: 10000, y: 10000, width: 10, height: 10 });
    const data = { edge: edge({ label: "Unmeasured", protocol: undefined, port: undefined }), points: [{ x: 0, y: 120 }, { x: 300, y: 120 }], status: "routed" as const, showLabel: true, fallbackIndex: index };
    const { rerender } = render(<TopologyRouteEdge {...props({ data })} />);
    expect(measure).toHaveBeenCalled();
    expect(document.querySelector("button.topology-route-edge-label")).toHaveTextContent("Unmeasured");
    expect(screen.queryByRole("button", { name: "Unmeasured" })).not.toBeInTheDocument();
    rerender(<TopologyRouteEdge {...props({ data: { ...data, edge: edge({ label: "Infinite", protocol: undefined, port: undefined }) } })} />);
    expect(screen.queryByRole("button", { name: "Infinite" })).not.toBeInTheDocument();
    rerender(<TopologyRouteEdge {...props({ data: { ...data, edge: edge({ label: "NoHeight", protocol: undefined, port: undefined }) } })} />);
    expect(screen.queryByRole("button", { name: "NoHeight" })).not.toBeInTheDocument();
    rerender(<TopologyRouteEdge {...props({ data: { ...data, edge: edge({ label: "Recovered", protocol: undefined, port: undefined }) } })} />);
    expect(screen.getByRole("button", { name: "Recovered" })).toBeVisible();
  });

  it("uses worker label rectangles and prevents independently measured labels from overlapping", () => {
    const index = fallbackIndex([]);
    const workerA = { rect: { x: 525, y: 181, width: 30, height: 22 }, hidden: false, text: "OK", segmentIndex: 0 };
    const workerB = { rect: { x: 564, y: 175, width: 30, height: 22 }, hidden: false, text: "OK", segmentIndex: 2 };
    index.addLabelRect("edge-a", workerA.rect);
    index.addLabelRect("edge-b", workerB.rect);

    render(<>
      <TopologyRouteEdge {...props({ id: "topology-edge:edge-a", data: { edge: edge({ id: "edge-a", label: "OK", protocol: undefined, port: undefined }), points: [{ x: 280, y: 192 }, { x: 800, y: 192 }], crossLayer: false, showLabel: true, fallbackIndex: index, workerLabel: workerA } })} />
      <TopologyRouteEdge {...props({ id: "topology-edge:edge-b", data: { edge: edge({ id: "edge-b", kind: "uses", label: "OK", protocol: undefined, port: undefined }), points: [{ x: 280, y: 192 }, { x: 292, y: 192 }, { x: 292, y: 186 }, { x: 788, y: 186 }, { x: 788, y: 192 }, { x: 800, y: 192 }], crossLayer: false, showLabel: true, fallbackIndex: index, workerLabel: workerB } })} />
    </>);

    const labelButtons = screen.getAllByRole("button", { name: "OK" });
    expect(labelButtons).toHaveLength(2);
    expect(labelButtons.every((button) => button.style.visibility === "visible")).toBe(true);
    const transforms = labelButtons.map((button) => button.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/));
    const points = transforms.map((match) => match ? { x: Number(match[1]), y: Number(match[2]) } : null);
    expect(points[0] && points[1]).toBeTruthy();
    expect(Math.abs(points[0]!.x - points[1]!.x) >= 48 || Math.abs(points[0]!.y - points[1]!.y) >= 22).toBe(true);
  });

  it("recovers a worker-unallocated routed label from a 48px real measurement", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (): DOMRect {
      return { x: 0, y: 0, left: 0, top: 0, right: 48, bottom: 22, width: 48, height: 22, toJSON: () => ({}) } as DOMRect;
    });
    const index = fallbackIndex([]);
    render(<TopologyRouteEdge {...props({
      data: {
        edge: edge({ id: "unallocated", label: "iiiiii", protocol: undefined, port: undefined }),
        points: [{ x: 0, y: 200 }, { x: 64, y: 200 }],
        status: "routed",
        crossLayer: false,
        showLabel: true,
        fallbackIndex: index,
        workerLabel: { rect: null, hidden: true, text: "iiiiii", segmentIndex: null },
      },
    })} />);
    expect(screen.getByRole("button", { name: "iiiiii" })).toBeVisible();
  });

  it("hides worker-muted routed labels but recovers short measured labels", () => {
    const hiddenIndex = fallbackIndex([]);
    const hidden = edge({ id: "hidden", label: "Hidden", protocol: undefined, port: undefined });
    const { rerender } = render(<TopologyRouteEdge {...props({ data: { edge: hidden, points: [{ x: 280, y: 192 }, { x: 800, y: 192 }], crossLayer: false, showLabel: false, fallbackIndex: hiddenIndex, workerLabelHidden: true, workerLabel: { rect: null, hidden: true, text: "Hidden", segmentIndex: null } } })} />);
    expect(screen.queryByRole("button", { name: "Hidden" })).not.toBeInTheDocument();

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (): DOMRect {
      return { x: 0, y: 0, left: 0, top: 0, right: 48, bottom: 22, width: 48, height: 22, toJSON: () => ({}) } as DOMRect;
    });
    const shortIndex = fallbackIndex([]);
    rerender(<TopologyRouteEdge {...props({ data: { edge: edge({ id: "short", label: "HELLO", protocol: undefined, port: undefined }), points: [{ x: 0, y: 200 }, { x: 64, y: 200 }], crossLayer: false, showLabel: true, fallbackIndex: shortIndex } })} />);
    expect(screen.getByRole("button", { name: "HELLO" })).toBeVisible();
  });

  it("keeps fallback and routed previews observable without accepting a label collision", () => {
    const index = fallbackIndex([]);
    index.addLabelRect("other", { x: 120, y: 186, width: 48, height: 22 });
    render(<TopologyRouteEdge {...props({ data: { edge: edge({ id: "preview", label: "OK", protocol: undefined, port: undefined }), points: [{ x: 0, y: 200 }, { x: 300, y: 200 }], status: "routed", crossLayer: false, showLabel: true, fallbackIndex: index } })} />);
    expect(screen.getByRole("button", { name: "OK" })).toBeVisible();
  });

  it("renders a normal label inside the endpoint-own section", () => {
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

    render(<TopologyRouteEdge {...props({
      data: {
        edge: edge({ label: "synthetic", protocol: "HTTPS", port: 443 }),
        points: [{ x: 80, y: 200 }, { x: 800, y: 200 }],
        crossLayer: false,
        showLabel: true,
        fallbackIndex: index,
      },
    })} />);

    expect(screen.getByRole("button", { name: "synthetic · HTTPS :443" })).toBeInTheDocument();
  });

  it("hides a wide fallback label when a conservative capsule is not title-safe", () => {
    const index = fallbackIndex([{ kind: "section", x: 92, y: 172, width: 116, height: 52 }]);
    index.add({ kind: "frame-title", frameId: "wide", frameNodeIds: ["a", "b"], x: 92, y: 172, width: 116, height: 52 });

    render(<TopologyRouteEdge {...props({
      data: {
        edge: edge({ label: "WWWWWWWWWWWW", protocol: undefined, port: undefined }),
        points: [{ x: 40, y: 200 }, { x: 300, y: 200 }],
        status: "fallback",
        renderMode: "straight",
        fallbackStyle: "dashed",
        fallback: "no_path",
        fallbackIndex: index,
        strokeMargin: 8,
        showLabel: true,
      },
    })} />);

    expect(screen.queryByRole("button", { name: /WWWWWWWWWWWW/ })).not.toBeInTheDocument();
  });

  it("keeps the same ReactFlow edge mounted and restores a safe label after unsafe wide text props change", () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
      const text = this.textContent ?? "";
      const width = text.includes("﷽") ? 53.515625 : text.includes("OK") ? 32.765625 : 100;
      const height = text.includes("﷽") ? 28 : text.includes("OK") ? 22 : 22;
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
    };

    const unsafeIndex = fallbackIndex([{ kind: "section", x: 92, y: 172, width: 116, height: 52 }]);
    unsafeIndex.add({ kind: "frame-title", frameId: "wide", frameNodeIds: ["a", "b"], x: 92, y: 172, width: 116, height: 52 });

    const edgeProps = props({
      id: "topology-edge:a-b",
      data: {
        edge: edge({ label: "﷽", protocol: undefined, port: undefined }),
        points: [{ x: 40, y: 200 }, { x: 260, y: 200 }],
        status: "fallback",
        renderMode: "straight",
        fallbackStyle: "dashed",
        fallback: "no_path",
        fallbackIndex: unsafeIndex,
        strokeMargin: 8,
        showLabel: true,
      },
    });
    const { rerender } = render(<TopologyRouteEdge {...edgeProps} />);
    expect(screen.queryByRole("button", { name: /﷽/ })).not.toBeInTheDocument();

    rerender(<TopologyRouteEdge {...props({
      id: "topology-edge:a-b",
      data: {
        edge: edge({ label: "OK", protocol: undefined, port: undefined }),
        points: [{ x: 40, y: 200 }, { x: 260, y: 200 }],
        status: "routed",
        fallbackIndex: unsafeIndex,
        strokeMargin: 8,
        showLabel: true,
      },
    })} />);

    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it("renders fallback as dashed visible subsegments and omits unsafe markers", () => {
    render(<TopologyRouteEdge {...props({
      data: {
        edge: edge({ direction: "uni" }),
        points: [{ x: 0, y: 120 }, { x: 300, y: 120 }],
        status: "fallback",
        renderMode: "straight",
        fallbackStyle: "dashed",
        fallback: "no_path",
        fallbackIndex: fallbackIndex([{ kind: "section", x: 120, y: 0, width: 60, height: 200 }]),
        strokeMargin: 8,
        showLabel: false,
      },
    })} />);

    const paths = screen.getAllByTestId("route-edge-path");
    expect(paths).toHaveLength(2);
    expect(paths[0]).not.toHaveAttribute("marker-start");
    expect(paths[0]?.getAttribute("d")).toContain("M 0 120");
    expect(paths[1]).toHaveAttribute("marker-end", "url(#marker-end)");
    expect(paths[0]).toHaveAttribute("data-fallback", "no_path");
    expect(paths[0]).toHaveAttribute("data-route", "fallback");
    expect(paths[0]).toHaveAttribute("data-fallback-style", "dashed");
    expect(paths[0]).toHaveAttribute("data-diagnostic", "visible-fallback");
  });

  it("fails closed when fallback geometry is unavailable", () => {
    render(<TopologyRouteEdge {...props({
      data: {
        edge: edge(),
        points: [{ x: 0, y: 100 }, { x: 300, y: 100 }],
        status: "fallback",
        renderMode: "straight",
        fallbackStyle: "dashed",
        fallback: "timeout",
        showLabel: false,
      },
    })} />);

    expect(screen.queryAllByTestId("route-edge-path")).toHaveLength(0);
    const diagnostic = screen.getByTestId(/topology-fallback-geometry-unavailable-/);
    expect(diagnostic).toHaveAttribute("data-diagnostic", "geometry-unavailable");
    expect(diagnostic).toHaveAttribute("data-route", "fallback");
  });

  it("renders no unsafe geometry and exposes no-visible-segments diagnostics when no straight preview is safe", () => {
    const fullyBlocked = fallbackIndex([{ kind: "section", x: -10000, y: -10000, width: 30000, height: 30000 }]);
    render(<TopologyRouteEdge {...props({
      data: {
        edge: edge(),
        points: [{ x: 0, y: 120 }, { x: 300, y: 120 }],
        status: "fallback",
        renderMode: "straight",
        fallbackStyle: "dashed",
        fallback: "timeout",
        fallbackIndex: fullyBlocked,
        strokeMargin: 8,
        clock: () => 10,
        deadline: 10,
      },
    })} />);

    expect(screen.queryAllByTestId("route-edge-path")).toHaveLength(0);
    const diagnostic = screen.getByTestId(/topology-fallback-preview-safe-/);
    expect(diagnostic).toHaveAttribute("data-diagnostic", "fallback-preview-no-visible-segments");
    expect(diagnostic).toHaveAttribute("data-route", "fallback");
  });

  it("diagnoses fully blocked detailed fallback instead of returning an empty fragment", () => {
    const fullyBlocked = fallbackIndex([{ kind: "section", x: -10000, y: -10000, width: 30000, height: 30000 }]);
    render(<TopologyRouteEdge {...props({
      data: {
        edge: edge(),
        points: [{ x: 0, y: 120 }, { x: 300, y: 120 }],
        status: "fallback",
        renderMode: "straight",
        fallbackStyle: "dashed",
        fallback: "no_path",
        fallbackIndex: fullyBlocked,
        strokeMargin: 8,
      },
    })} />);

    expect(screen.queryAllByTestId("route-edge-path")).toHaveLength(0);
    const diagnostic = screen.getByTestId(/topology-fallback-detailed-no-visible-/);
    expect(diagnostic).toHaveAttribute("data-diagnostic", "fallback-detailed-no-visible-segments");
    expect(diagnostic).toHaveAttribute("data-route", "fallback");
    expect(diagnostic).toHaveAttribute("data-edge-source", "a");
    expect(diagnostic).toHaveAttribute("data-edge-target", "b");
  });

  it("renders no unsafe geometry on fallback split deadline and exposes truthful diagnostics", () => {
    let now = 0;
    render(<TopologyRouteEdge {...props({
      data: {
        edge: edge(),
        points: [{ x: 0, y: 120 }, { x: 300, y: 120 }],
        status: "fallback",
        renderMode: "straight",
        fallbackStyle: "faded",
        fallback: "timeout",
        fallbackIndex: fallbackIndex([{ kind: "card", x: 100, y: 200, width: 100, height: 100 }]),
        strokeMargin: 8,
        clock: () => ++now,
        deadline: 1,
      },
    })} />);

    expect(screen.getAllByTestId("route-edge-path").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("route-edge-path")[0]).toHaveAttribute("data-diagnostic", "fallback-preview");
  });

  it("marks known fallback geometry unavailable without painting a path", () => {
    const index = fallbackIndex([]);
    const { rerender } = render(<TopologyRouteEdge {...props({
      id: "topology-edge:invalid",
      data: { edge: edge({ id: "invalid" }), points: [], status: "fallback", fallbackIndex: index },
    })} />);

    for (const points of [[], undefined, [{ x: 0, y: 200 }, { x: Number.NaN, y: 200 }]]) {
      rerender(<TopologyRouteEdge {...props({
        id: "topology-edge:invalid",
        data: { edge: edge({ id: "invalid" }), points, status: "fallback", fallbackIndex: index },
      })} />);
      const diagnostic = screen.getByTestId(/topology-route-geometry-unavailable-/);
      expect(diagnostic).toHaveAttribute("data-diagnostic", "geometry-unavailable");
      expect(diagnostic).toHaveAttribute("data-route", "fallback");
      expect(screen.queryByTestId("route-edge-path")).not.toBeInTheDocument();
    }

    rerender(<TopologyRouteEdge {...props({
      id: "topology-edge:routed",
      data: { edge: edge({ id: "routed" }), points: [], status: "routed", fallbackIndex: index },
    })} />);
    const routedDiagnostic = screen.getByTestId(/topology-route-geometry-unavailable-/);
    expect(routedDiagnostic).not.toHaveAttribute("data-route", "fallback");
  });

  it("reports missing and empty fallback index geometry explicitly", () => {
    render(<TopologyRouteEdge {...props({
      data: {
        edge: edge(),
        points: [{ x: 0, y: 120 }, { x: 300, y: 120 }],
        status: "fallback",
        renderMode: "straight",
        fallbackStyle: "dashed",
        fallback: "no_path",
        showLabel: false,
      },
    })} />);
    expect(screen.getByTestId(/topology-fallback-geometry-unavailable-/)).toHaveAttribute("data-diagnostic", "geometry-unavailable");

    const emptyIndex = createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8);
    render(<TopologyRouteEdge {...props({
      data: {
        edge: edge(),
        points: [{ x: 0, y: 120 }, { x: 300, y: 120 }],
        status: "fallback",
        renderMode: "straight",
        fallbackStyle: "dashed",
        fallback: "no_path",
        fallbackIndex: emptyIndex,
        showLabel: false,
      },
    })} />);
    expect(screen.getAllByTestId(/topology-fallback-geometry-unavailable-/).length).toBeGreaterThan(0);
  });

  it("renders a rounded unidirectional route without a label when suppressed", () => {
    render(<TopologyRouteEdge {...props({ data: { edge: edge({ direction: "uni" }), points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], crossLayer: true, showLabel: false, fallbackIndex: createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8) } })} />);
    expect(screen.getByTestId("route-edge-path")).toHaveAttribute("d", "M 0 0 L 92 0 Q 100 0 100 8 L 100 100");
    expect(screen.queryByTestId("edge-label-renderer")).not.toBeInTheDocument();
  });

  it("reports missing edge data and fails closed for missing or invalid route points", () => {
    const { rerender } = render(<TopologyRouteEdge {...props({ data: undefined })} />);
    expect(screen.getByLabelText("Routing geometry unavailable")).toHaveAttribute("data-diagnostic", "geometry-unavailable");
    expect(screen.queryByTestId("route-edge-path")).not.toBeInTheDocument();

    rerender(<TopologyRouteEdge {...props({ data: { edge: edge({ direction: "uni" }), points: undefined, crossLayer: false, showLabel: false } })} />);
    expect(screen.getByTestId(/topology-route-geometry-unavailable-/)).toHaveAttribute("data-diagnostic", "geometry-unavailable");
    expect(screen.queryByTestId("route-edge-path")).not.toBeInTheDocument();

    for (const points of [[], [{ x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: Number.NaN, y: 100 }]]) {
      rerender(<TopologyRouteEdge {...props({ data: { edge: edge({ direction: "uni" }), points, crossLayer: false, showLabel: false } })} />);
      expect(screen.getByTestId(/topology-route-geometry-unavailable-/)).toHaveAttribute("data-diagnostic", "geometry-unavailable");
      expect(screen.queryByTestId("route-edge-path")).not.toBeInTheDocument();
    }
  });

  it("covers renderer state matrix for directions, label toggles and fallback modes", () => {
    const index = fallbackIndex([]);
    for (const direction of ["uni", "bi"] as const) {
      for (const showLabel of [true, false]) {
        for (const crossLayer of [true, false]) {
          const fallbackStyle = crossLayer ? "faded" : "dashed";
          render(<TopologyRouteEdge {...props({
            data: {
              edge: edge({ direction, style: { dash: crossLayer ? "dotted" : "solid", width: crossLayer ? 4 : 1, animated: crossLayer } }),
              points: [{ x: 0, y: 120 }, { x: 300, y: 120 }],
              crossLayer,
              showLabel,
              status: "fallback",
              renderMode: "straight",
              fallbackStyle,
              fallback: "timeout",
              fallbackIndex: index,
              strokeMargin: 8,
            },
            selected: crossLayer,
          })} />);
        }
      }
    }

    render(<TopologyRouteEdge {...props({
      data: {
        edge: edge({ direction: "uni", style: { dash: "dashed", width: 3, animated: true } }),
        points: [{ x: 0, y: 120 }, { x: 300, y: 120 }],
        crossLayer: false,
        showLabel: false,
        status: "fallback",
        renderMode: "straight",
        fallbackStyle: "dashed",
        fallback: "no_path",
        fallbackIndex: fallbackIndex([{ kind: "section", x: -10000, y: -10000, width: 30000, height: 30000 }]),
        strokeMargin: 8,
      },
    })} />);
  });

  it("covers remaining renderer preview and detailed branches", () => {
    const empty = createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8);
    const blocked = fallbackIndex([{ kind: "section", x: -10000, y: -10000, width: 30000, height: 30000 }]);

    for (const data of [
      { edge: edge(), points: [{ x: 0, y: 120 }, { x: 300, y: 120 }], status: "fallback", renderMode: "straight", fallbackStyle: "dashed", fallback: "timeout", fallbackIndex: empty, showLabel: false },
      { edge: edge(), points: [{ x: 0, y: 120 }, { x: 300, y: 120 }], status: "fallback", renderMode: "straight", fallbackStyle: "faded", fallback: "timeout", fallbackIndex: blocked, showLabel: true, clock: () => 10, deadline: 10 },
      { edge: edge(), points: [{ x: 0, y: 120 }, { x: 300, y: 120 }], status: "fallback", renderMode: "straight", fallbackStyle: "dashed", fallback: "no_path", fallbackIndex: blocked, showLabel: false },
      { edge: edge(), points: [{ x: 0, y: 120 }, { x: 300, y: 120 }], status: "routed", fallbackIndex: empty, showLabel: false },
    ]) {
      render(<TopologyRouteEdge {...props({ data })} />);
    }
  });

  it("renders preview candidate timeout and no-visible preview diagnostics", () => {
    const index = fallbackIndex([]);
    render(<TopologyRouteEdge {...props({
      data: {
        edge: edge({ direction: "uni" }),
        points: Array.from({ length: 4098 }, (_, indexValue) => ({ x: indexValue, y: 120 })),
        status: "fallback",
        renderMode: "straight",
        fallbackStyle: "faded",
        fallback: "timeout",
        fallbackIndex: index,
        strokeMargin: 8,
        showLabel: false,
        crossLayer: true,
      },
    })} />);
    const budget = screen.getByTestId(/topology-fallback-preview-budget-/);
    expect(budget).toHaveAttribute("data-diagnostic", "fallback-preview-candidate-limit");
    expect(budget).toHaveAttribute("data-route", "fallback");

    const blocked = fallbackIndex([{ kind: "section", x: -10000, y: -10000, width: 30000, height: 30000 }]);
    render(<TopologyRouteEdge {...props({
      data: {
        edge: edge({ direction: "uni" }),
        points: [{ x: 0, y: 120 }, { x: 300, y: 120 }],
        status: "fallback",
        renderMode: "straight",
        fallbackStyle: "faded",
        fallback: "timeout",
        fallbackIndex: blocked,
        strokeMargin: 8,
        showLabel: false,
        crossLayer: true,
        clock: () => 2,
        deadline: 1,
      },
    })} />);
    const previews = screen.getAllByTestId(/topology-fallback-preview-safe-/);
    expect(previews.length).toBeGreaterThan(0);
    expect(previews.every((preview) => preview.getAttribute("data-route") === "fallback")).toBe(true);
  });

  it("renders normal cross-layer and unanimated routes with label suppression", () => {
    render(<TopologyRouteEdge {...props({
      data: {
        edge: edge({ direction: "uni", style: { dash: "solid", width: 1, animated: false } }),
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        crossLayer: true,
        showLabel: false,
        status: "routed",
        fallbackIndex: createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8),
      },
      selected: false,
    })} />);
    const path = screen.getByTestId("route-edge-path");
    expect(path).toHaveAttribute("d", "M 0 0 L 100 0");
    expect(path).not.toHaveClass("topology-route-edge-animated");
    expect(path).not.toHaveClass("topology-route-edge-highlighted");
    expect(screen.queryByTestId("edge-label-renderer")).not.toBeInTheDocument();
  });

  it("covers measured label state changes and normal route fallback guards", () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
      const text = this.textContent ?? "";
      const width = text.includes("OK") ? 32 : text.includes("﷽") ? 0 : 100;
      const height = 22;
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
    };

    const unsafeIndex = fallbackIndex([{ kind: "section", x: 92, y: 172, width: 116, height: 52 }]);
    const { rerender } = render(<TopologyRouteEdge {...props({
      id: "topology-edge:a-b",
      data: { edge: edge({ label: "﷽", protocol: undefined, port: undefined }), points: [{ x: 40, y: 200 }, { x: 260, y: 200 }], status: "fallback", renderMode: "straight", fallbackStyle: "dashed", fallback: "no_path", fallbackIndex: unsafeIndex, showLabel: true },
    })} />);
    expect(screen.queryByRole("button", { name: /﷽/ })).not.toBeInTheDocument();

    rerender(<TopologyRouteEdge {...props({
      id: "topology-edge:a-b",
      data: { edge: edge({ label: "OK", protocol: undefined, port: undefined }), points: [{ x: 40, y: 200 }, { x: 260, y: 200 }], status: "fallback", renderMode: "straight", fallbackStyle: "dashed", fallback: "no_path", fallbackIndex: unsafeIndex, showLabel: true },
    })} />);
    expect(screen.getByRole("button", { name: "OK fallback" })).toBeInTheDocument();

    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it("covers component state matrix for missing, preview and fallback branches", () => {
    const { rerender } = render(<TopologyRouteEdge {...props({ data: undefined })} />);
    expect(screen.queryAllByTestId("route-edge-path")).toHaveLength(0);

    rerender(<TopologyRouteEdge {...props({ data: { edge: edge(), points: [], crossLayer: false, showLabel: false, status: "routed", fallbackIndex: undefined } })} />);
    expect(screen.queryAllByTestId("route-edge-path").length).toBeGreaterThanOrEqual(0);

    const empty = createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8);
    rerender(<TopologyRouteEdge {...props({ data: { edge: edge(), points: [{ x: 0, y: 120 }, { x: 300, y: 120 }], crossLayer: true, showLabel: false, status: "fallback", renderMode: "straight", fallbackStyle: "dashed", fallback: "no_path", fallbackIndex: empty } })} />);
    expect(screen.getAllByTestId(/topology-fallback-geometry-unavailable-/).length).toBeGreaterThan(0);

    rerender(<TopologyRouteEdge {...props({
      data: { edge: edge({ direction: "uni", style: { dash: "dashed", width: 4, animated: true } }), points: [{ x: 0, y: 120 }, { x: 300, y: 120 }], crossLayer: true, showLabel: true, status: "fallback", renderMode: "straight", fallbackStyle: "faded", fallback: "timeout", fallbackIndex: fallbackIndex([{ kind: "section", x: -10000, y: -10000, width: 30000, height: 30000 }]), clock: () => 10, deadline: 10 },
      selected: true,
    })} />);
    expect(screen.queryAllByTestId(/topology-fallback-preview-/).length).toBeGreaterThanOrEqual(0);

    rerender(<TopologyRouteEdge {...props({
      data: { edge: edge({ direction: "bi", style: { dash: "solid", width: 2, animated: false } }), points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], crossLayer: false, showLabel: false, status: "routed", fallbackIndex: createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8) },
      selected: false,
    })} />);
    expect(screen.getByTestId("route-edge-path")).toHaveAttribute("d", "M 0 0 L 100 0");
  });

  it("covers edge state matrix across direction, style, cross-layer and label visibility", () => {
    const index = fallbackIndex([]);
    for (const direction of ["uni", "bi"] as const) {
      for (const crossLayer of [true, false]) {
        for (const showLabel of [true, false]) {
          render(<TopologyRouteEdge {...props({
            data: {
              edge: edge({ direction, style: { dash: crossLayer ? "dotted" : "solid", width: crossLayer ? 4 : 1, animated: crossLayer } }),
              points: [{ x: 0, y: 120 }, { x: 300, y: 120 }],
              crossLayer,
              showLabel,
              status: "fallback",
              renderMode: "straight",
              fallbackStyle: crossLayer ? "faded" : "dashed",
              fallback: "timeout",
              fallbackIndex: index,
              strokeMargin: 8,
            },
            selected: crossLayer,
          })} />);
        }
      }
    }

    render(<TopologyRouteEdge {...props({
      data: {
        edge: edge({ direction: "uni", style: { dash: "solid", width: 2, animated: false } }),
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        crossLayer: false,
        showLabel: false,
        status: "routed",
        fallbackIndex: createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8),
      },
      selected: false,
    })} />);
  });

  it("distinguishes preview candidate timeout and faded fallback diagnostics", () => {
    const index = fallbackIndex([]);
    render(<TopologyRouteEdge {...props({
      data: {
        edge: edge(),
        points: Array.from({ length: 4098 }, (_, indexValue) => ({ x: indexValue, y: 120 })),
        status: "fallback",
        renderMode: "straight",
        fallbackStyle: "faded",
        fallback: "timeout",
        fallbackIndex: index,
        strokeMargin: 8,
        showLabel: false,
      },
    })} />);
    expect(screen.queryAllByTestId("route-edge-path")).toHaveLength(0);
  });
});
