import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { getNodesBounds, getViewportForBounds, type Edge, type Node, type ReactFlowProps } from "@xyflow/react";
import { topologySchema, type Topology } from "@steed/api/shared";
import { inheritedBoundaryIds, TopologyCanvas, VisibleRouteDetours, topologyEdgeHandleSides, topologyEdgeSides, topologyNodeBadgeValues, topologyNodeBoundaryLabels, topologyPort, topologyRouteOutsideEndpointViewport, topologyTint, topologyZoomTier } from "../topology-canvas";
import { TopologyRouteEdge } from "../topology-route-edge";
import { TopologyFallbackRectIndex, splitTopologyFallbackPolylinePreview, topologyFallbackMarkerVisibility } from "@/lib/topology-route-edge-safety";
import type { TopologyCanvasEdge, TopologyCanvasNode } from "../topology-canvas";
import { layoutTopology } from "@/lib/topology-layout";

const state = vi.hoisted(() => ({ zoom: 1, width: 1000, height: 700, setViewport: vi.fn(), setCenter: vi.fn(), nodeChanges: [] as unknown[], renders: [] as { nodes: unknown[]; edges: unknown[]; selectionHandler: boolean; nodesHandler: boolean }[] }));
vi.mock("@xyflow/react", async (original) => {
  const actual = await original<typeof import("@xyflow/react")>();
  return {
    ...actual,
    BaseEdge: ({ path, style, markerStart, markerEnd }: { path: string; style?: CSSProperties; markerStart?: string; markerEnd?: string }) => <svg data-testid="mock-base-edge" data-path={path} data-marker-start={markerStart} data-marker-end={markerEnd} style={style} />,
    useStore: (selector: (value: { transform: number[]; width: number; height: number }) => unknown) => selector({ transform: [0, 0, state.zoom], width: state.width, height: state.height }),
    useReactFlow: () => ({ setViewport: state.setViewport, setCenter: state.setCenter, getZoom: () => state.zoom }),
    useUpdateNodeInternals: () => vi.fn(),
    ViewportPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
    EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <>{children}</>,
    ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    Background: () => <div>Grid</div>,
    Controls: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    ControlButton: ({ children, onClick, "aria-label": ariaLabel }: { children: ReactNode; onClick?: () => void; "aria-label": string }) => <button type="button" onClick={onClick} aria-label={ariaLabel}>{children}</button>,
    Handle: ({ type, id, isConnectable }: { type: string; id?: string; isConnectable?: boolean }) => (
      <span data-testid={`handle-${type}-${id}`} data-connectable={String(isConnectable)} />
    ),
    ReactFlow: (props: ReactFlowProps<Node<TopologyCanvasNode>, Edge<TopologyCanvasEdge>>) => { state.renders.push({ nodes: props.nodes ?? [], edges: props.edges ?? [], selectionHandler: props.onSelectionChange !== undefined, nodesHandler: props.onNodesChange !== undefined }); return (
      <div
        data-testid="topology-flow"
        data-draggable={props.nodesDraggable}
        data-connectable={props.nodesConnectable}
        data-selectable={props.elementsSelectable}
        data-only-visible={props.onlyRenderVisibleElements}
        data-delete-key={props.deleteKeyCode === null ? "none" : "key"}
      >
        {props.children}
        <button type="button" onClick={(event) => props.onPaneClick?.(event)}>pane</button>
        {props.nodes?.map((node: Node<TopologyCanvasNode>) => {
          const View = props.nodeTypes?.[node.type ?? ""] as ComponentType<{ id: string; data: TopologyCanvasNode; selected: boolean }> | undefined;
          return <div key={node.id}>
            <button
              data-testid={`rf__node-${node.id}`}
              onClick={() => props.onNodeClick?.({} as never, node)}
              onKeyDown={(event) => {
                if (node.data.node && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  const change = { id: node.id, type: "select", selected: true };
                  state.nodeChanges.push(change);
                  props.onNodesChange?.([change] as never);
                  props.onSelectionChange?.({ nodes: [{ ...node, selected: true }], edges: [] });
                }
              }}
            >{node.id}</button>
            {View && <View id={node.id} data={node.data} selected={node.selected === true} />}
          </div>;
        })}
        {props.edges?.map((edge: Edge<TopologyCanvasEdge>) => (
          <button
            key={edge.id}
            onMouseEnter={(event) => props.onEdgeMouseEnter?.(event, edge)}
            onMouseLeave={(event) => props.onEdgeMouseLeave?.(event, edge)}
            onClick={(event) => props.onEdgeClick?.(event, edge)}
            data-source-handle={edge.sourceHandle ?? ""}
            data-target-handle={edge.targetHandle ?? ""}
            data-marker-start={edge.markerStart ? "yes" : "no"}
            data-marker-end={edge.markerEnd ? "yes" : "no"}
          >{edge.label}</button>
        ))}
      </div>
    ); },
  };
});

function previewIndex(rects: Array<{ x: number; y: number; width: number; height: number }>) {
  const index = new TopologyFallbackRectIndex();
  for (const rect of rects) index.add({ kind: "frame-title", ...rect });
  if (!rects.length) index.add({ kind: "frame-title", x: 100000, y: 100000, width: 1, height: 1 });
  return index;
}
function topologyPreviewVisibleSegments(points: Array<{ x: number; y: number }>, rects: Array<{ x: number; y: number; width: number; height: number }>) {
  return splitTopologyFallbackPolylinePreview(previewIndex(rects), points, "a", "b", { strokeMargin: 0 }).segments;
}
function topologyPreviewMarkerVisible(points: Array<{ x: number; y: number }>, segments: Array<{ a: { x: number; y: number }; b: { x: number; y: number } }>, rects: Array<{ x: number; y: number; width: number; height: number }> = []) {
  const first = points[0], last = points.at(-1);
  return first && last ? topologyFallbackMarkerVisibility(segments, first, last, { index: previewIndex(rects), strokeWidth: 2, sourceId: "a", targetId: "b" }) : { markerStart: false, markerEnd: false };
}

function sample(): Topology {
  return {
    schemaVersion: 2,
    title: "Canvas topology",
    description: "Synthetic",
    revision: 6,
    layers: [{ id: "cloud", label: "Cloud", provider: "Fixture", order: 0, description: "" }],
    types: [{
      id: "host",
      label: "Host",
      shape: "rect",
      description: "",
      attrs: [
        { key: "zero", label: "Zero", valueType: "number", badge: true, order: 1, required: false },
        { key: "disabled", label: "Disabled", valueType: "boolean", badge: true, order: 0, required: false },
        { key: "region", label: "Region", valueType: "string", badge: true, order: 2, required: false, unit: "zone" },
        { key: "tags_extra", label: "Extra", valueType: "string", badge: true, order: 3, required: false },
        { key: "four", label: "Four", valueType: "number", badge: true, order: 4, required: false },
        { key: "five", label: "Five", valueType: "number", badge: true, order: 5, required: false },
        { key: "six", label: "Six", valueType: "number", badge: true, order: 6, required: false },
        { key: "hidden", label: "Hidden", valueType: "string", badge: false, order: 7, required: false },
      ],
    }],
    boundaries: [{ id: "home", label: "Home", kind: "site", description: "" }],
    nodes: [
      { id: "root", type: "host", label: "Root", layerId: "cloud", boundaryIds: ["home"], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "service", type: "host", label: "Service", layerId: "cloud", parentId: "root", role: "service", lifecycle: "active", description: "", tags: [], attrs: { zero: 0, disabled: false, region: "west", tags_extra: ["a", "b"], four: 4, five: 5, six: 6, hidden: "no" } },
      { id: "peer", type: "host", label: "Peer", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
    ],
    edges: [{ id: "root-service", source: "root", target: "service", kind: "uses", label: "Runs", direction: "uni", evidence: "documented", description: "", tags: [] }],
    views: [{ id: "overview", label: "Overview", description: "", filter: { layerIds: [], typeIds: [], boundaryIds: [], tags: [] }, pins: { root: { x: 700, y: 180 }, service: { x: 980, y: 210 } }, focusLayerId: "cloud" }],
  };
}

beforeEach(() => { state.zoom = 1; state.width = 1000; state.height = 700; state.nodeChanges = []; state.renders = []; vi.clearAllMocks(); });

it("keeps viewport detours outside endpoint bounds without duplicating ordinary edges", () => {
  const source = { x: 72, y: 4048, width: 240, height: 112 };
  const target = { x: 2264, y: 4332, width: 240, height: 112 };
  const route = [{ x: 1802, y: 3878 }, { x: 1908, y: 3878 }];
  expect(topologyRouteOutsideEndpointViewport(route, source, target, { x: 1655, y: 3728, width: 400, height: 300 })).toBe(true);
  expect(topologyRouteOutsideEndpointViewport(route, source, target, { x: 200, y: 4020, width: 400, height: 300 })).toBe(false);
  expect(topologyRouteOutsideEndpointViewport(route, source, target, { x: 5000, y: 0, width: 400, height: 300 })).toBe(false);
  expect(topologyRouteOutsideEndpointViewport([], source, target, { x: 1655, y: 3728, width: 400, height: 300 })).toBe(false);
});

it("places unrouted ports at the four card border midpoints", () => {
  const rect = { x: 10, y: 20, width: 41, height: 31 };
  expect(topologyPort(rect, "left")).toEqual({ x: 10, y: 36 });
  expect(topologyPort(rect, "right")).toEqual({ x: 51, y: 36 });
  expect(topologyPort(rect, "top")).toEqual({ x: 31, y: 20 });
  expect(topologyPort(rect, "bottom")).toEqual({ x: 31, y: 51 });
});

it("paints only route detours outside endpoint bounds and clips unsafe fallback segments", () => {
  const positions = { source: { x: 100, y: 1200, width: 100, height: 100 }, target: { x: 500, y: 1200, width: 100, height: 100 } };
  const points = [{ x: 150, y: 1200 }, { x: 150, y: 300 }, { x: 550, y: 300 }, { x: 550, y: 1200 }];
  const edge = { id: "detour", source: "source", target: "target", className: "topology-edge-satellite", animated: true, markerStart: { type: "arrowclosed" }, markerEnd: { type: "arrowclosed" }, style: { stroke: "red", strokeWidth: 3 }, data: { edge: { ...sample().edges[0]!, direction: "bi" }, route: { status: "fallback", points }, points, status: "fallback", showLabel: false, fallbackIndex: previewIndex([{ x: 300, y: 280, width: 100, height: 40 }]) } } as Edge<TopologyCanvasEdge>;
  const onHover = vi.fn(), onSelect = vi.fn();
  const { rerender } = render(<VisibleRouteDetours edges={[edge]} positions={positions} onHover={onHover} onSelect={onSelect} />);
  expect(screen.getByTestId("topology-route-detours")).toBeInTheDocument();
  expect(document.querySelector('[data-route-detour="detour"]')).toHaveClass("react-flow__edge", "topology-edge-satellite", "animated");
  const detour = document.querySelector('[data-route-detour="detour"]')!;
  fireEvent.mouseEnter(detour);
  fireEvent.click(detour);
  fireEvent.mouseLeave(detour);
  expect(onHover.mock.calls).toEqual([["detour"], [""]]);
  expect(onSelect).toHaveBeenCalledWith("detour");
  expect(screen.getAllByTestId("mock-base-edge").length).toBeGreaterThan(1);
  expect(screen.getAllByTestId("mock-base-edge").every((path) => path.style.strokeDasharray === "6 5")).toBe(true);
  expect(document.querySelectorAll("marker")).toHaveLength(1);
  rerender(<VisibleRouteDetours edges={[{ ...edge, className: undefined, animated: false, markerStart: undefined, markerEnd: undefined, style: undefined, data: { edge: sample().edges[0]!, route: { status: "routed", points }, points, status: "routed", showLabel: false, fallbackIndex: previewIndex([]) } } as Edge<TopologyCanvasEdge>]} positions={positions} />);
  expect(screen.getByTestId("mock-base-edge")).toHaveAttribute("data-path", "M 150 1200 L 150 308 Q 150 300 158 300 L 542 300 Q 550 300 550 308 L 550 1200");
  expect(screen.getByTestId("mock-base-edge")).not.toHaveAttribute("data-marker-start");
  expect(document.querySelector('[data-route-detour="detour"]')).not.toHaveClass("animated");
  fireEvent.mouseEnter(document.querySelector('[data-route-detour="detour"]')!);
  fireEvent.click(document.querySelector('[data-route-detour="detour"]')!);
  fireEvent.mouseLeave(document.querySelector('[data-route-detour="detour"]')!);
  rerender(<VisibleRouteDetours edges={[{ ...edge, data: undefined }]} positions={positions} />);
  expect(screen.queryByTestId("topology-route-detours")).not.toBeInTheDocument();
  rerender(<VisibleRouteDetours edges={[edge]} positions={{ ...positions, target: { ...positions.target, y: 500 } }} />);
  expect(screen.queryByTestId("topology-route-detours")).not.toBeInTheDocument();
  rerender(<VisibleRouteDetours edges={[edge]} positions={{ source: positions.source }} />);
  expect(screen.queryByTestId("topology-route-detours")).not.toBeInTheDocument();
  state.width = 0;
  rerender(<VisibleRouteDetours edges={[edge]} positions={positions} />);
  expect(screen.queryByTestId("topology-route-detours")).not.toBeInTheDocument();
  state.width = 1000;
  state.height = 0;
  rerender(<VisibleRouteDetours edges={[edge]} positions={positions} />);
  expect(screen.queryByTestId("topology-route-detours")).not.toBeInTheDocument();
  state.height = 700;
  state.zoom = 0;
  rerender(<VisibleRouteDetours edges={[edge]} positions={positions} />);
  expect(screen.queryByTestId("topology-route-detours")).not.toBeInTheDocument();
});

it("clips reversed and diagonal preview segments and keeps marker endpoints only for terminal visible segments", () => {
  const reversed = topologyPreviewVisibleSegments(
    [{ x: 100, y: 50 }, { x: 0, y: 50 }],
    [{ x: 40, y: 40, width: 20, height: 20 }],
  );
  expect(reversed).toEqual([
    { a: { x: 100, y: 50 }, b: { x: 60, y: 50 } },
    { a: { x: 40, y: 50 }, b: { x: 0, y: 50 } },
  ]);

  const diagonal = topologyPreviewVisibleSegments(
    [{ x: 100, y: 100 }, { x: 0, y: 0 }],
    [{ x: 40, y: 40, width: 20, height: 20 }],
  );
  expect(diagonal).toEqual([
    { a: { x: 100, y: 100 }, b: { x: 60, y: 60 } },
    { a: { x: 40, y: 40 }, b: { x: 0, y: 0 } },
  ]);

  const disjoint = topologyPreviewVisibleSegments([{ x: 0, y: 50 }, { x: 100, y: 50 }], [{ x: 200, y: 40, width: 20, height: 20 }]);
  expect(disjoint).toEqual([{ a: { x: 0, y: 50 }, b: { x: 100, y: 50 } }]);

  expect(topologyPreviewMarkerVisible([{ x: 0, y: 0 }, { x: 100, y: 100 }], [{ a: { x: 0, y: 0 }, b: { x: 40, y: 40 } }])).toEqual({ markerStart: true, markerEnd: false });
  expect(topologyPreviewMarkerVisible([{ x: 0, y: 0 }, { x: 100, y: 100 }], [{ a: { x: 60, y: 60 }, b: { x: 100, y: 100 } }])).toEqual({ markerStart: false, markerEnd: true });
});

it("clips multiple overlapping preview obstacles without losing clear intervals", () => {
  const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const rects = [
    { x: -10, y: -2, width: 30, height: 4 },
    { x: 80, y: -2, width: 30, height: 4 },
    { x: 30, y: -2, width: 10, height: 4 },
    { x: 60, y: -2, width: 10, height: 4 },
  ];
  const expected = [[20, 30], [40, 60], [70, 80]].map(([start, end]) => ({ a: { x: start, y: 0 }, b: { x: end, y: 0 } }));
  expect(topologyPreviewVisibleSegments(points, rects)).toEqual(expected);
  expect(topologyPreviewVisibleSegments(points, [...rects].reverse())).toEqual(expected);
  const full = [{ a: { x: 0, y: 0 }, b: { x: 200, y: 0 } }];
  const long = [full[0]!.a, full[0]!.b];
  expect(topologyPreviewMarkerVisible(long, full, [{ x: -5, y: 5, width: 10, height: 10 }])).toEqual({ markerStart: false, markerEnd: true });
  expect(topologyPreviewMarkerVisible(long, full, [{ x: 195, y: -15, width: 10, height: 10 }])).toEqual({ markerStart: true, markerEnd: false });
  expect(topologyPreviewMarkerVisible(long, full, [{ x: 95, y: 100, width: 10, height: 10 }])).toEqual({ markerStart: true, markerEnd: true });
});

it("covers zoom tint badge boundary and edge-side matrices", () => {
  expect([0.39, 0.4, 0.74, 0.75, 1].map(topologyZoomTier)).toEqual(["far", "mid", "mid", "near", "near"]);
  expect(topologyTint(undefined, 0.07)).toContain("transparent");
  expect(topologyTint("#2563eb", 0.07)).toMatch(/^#2563eb/);

  const topology = sample();
  expect(inheritedBoundaryIds(topology, topology.nodes[0]!)).toEqual(["home"]);
  expect(inheritedBoundaryIds(topology, topology.nodes[1]!)).toEqual(["home"]);
  expect(inheritedBoundaryIds(topology, topology.nodes[2]!)).toEqual([]);
  expect(topologyNodeBoundaryLabels(topology, topology.nodes[0]!)).toEqual(["Home"]);
  expect(topologyNodeBoundaryLabels(topology, topology.nodes[1]!)).toEqual(["Home"]);

  expect(topologyEdgeSides({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 10, height: 10 })).toEqual(["right", "left"]);
  expect(topologyEdgeSides({ x: 20, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 10, height: 10 })).toEqual(["left", "right"]);
  expect(topologyEdgeSides({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 20, width: 10, height: 10 })).toEqual(["bottom", "top"]);
  expect(topologyEdgeSides({ x: 0, y: 20, width: 10, height: 10 }, { x: 0, y: 0, width: 10, height: 10 })).toEqual(["top", "bottom"]);

  expect(topologyNodeBadgeValues(topology, topology.nodes[0]!)).toEqual([]);
  expect(topologyNodeBadgeValues(topology, topology.nodes[1]!)).toHaveLength(6);
});

it("clips reversed, diagonal and disjoint preview segments and endpoint markers", () => {
  const reversed = topologyPreviewVisibleSegments([{ x: 100, y: 50 }, { x: 0, y: 50 }], [{ x: 40, y: 40, width: 20, height: 20 }]);
  expect(reversed).toEqual([{ a: { x: 100, y: 50 }, b: { x: 60, y: 50 } }, { a: { x: 40, y: 50 }, b: { x: 0, y: 50 } }]);

  const diagonal = topologyPreviewVisibleSegments([{ x: 100, y: 100 }, { x: 0, y: 0 }], [{ x: 40, y: 40, width: 20, height: 20 }]);
  expect(diagonal).toEqual([{ a: { x: 100, y: 100 }, b: { x: 60, y: 60 } }, { a: { x: 40, y: 40 }, b: { x: 0, y: 0 } }]);

  expect(topologyPreviewVisibleSegments([{ x: 0, y: 50 }, { x: 100, y: 50 }], [{ x: 200, y: 40, width: 20, height: 20 }])).toEqual([{ a: { x: 0, y: 50 }, b: { x: 100, y: 50 } }]);
  expect(topologyPreviewVisibleSegments([{ x: 50, y: 50 }, { x: 50, y: 50 }], [{ x: 40, y: 40, width: 20, height: 20 }])).toEqual([]);

  expect(topologyPreviewMarkerVisible([{ x: 0, y: 0 }, { x: 100, y: 100 }], [{ a: { x: 0, y: 0 }, b: { x: 40, y: 40 } }])).toEqual({ markerStart: true, markerEnd: false });
  expect(topologyPreviewMarkerVisible([{ x: 0, y: 0 }, { x: 100, y: 100 }], [{ a: { x: 60, y: 60 }, b: { x: 100, y: 100 } }])).toEqual({ markerStart: false, markerEnd: true });
  expect(topologyPreviewMarkerVisible([], [])).toEqual({ markerStart: false, markerEnd: false });

  const points = [{ x: 10, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 80 }];
  const terminalVisible = [{ a: { x: 10, y: 20 }, b: { x: 100, y: 20 } }, { a: { x: 100, y: 20 }, b: { x: 100, y: 80 } }];
  expect(topologyPreviewMarkerVisible(points, terminalVisible)).toEqual({ markerStart: true, markerEnd: true });

  const clippedMiddle = [{ a: { x: 20, y: 20 }, b: { x: 80, y: 20 } }];
  expect(topologyPreviewMarkerVisible(points, clippedMiddle)).toEqual({ markerStart: false, markerEnd: false });

  const straight = [{ x: 0, y: 50 }, { x: 100, y: 50 }];
  const protectedRects = [{ x: 45, y: 40, width: 10, height: 20 }, { x: 87, y: 51, width: 26, height: 26 }];
  expect(topologyPreviewMarkerVisible(straight, topologyPreviewVisibleSegments(straight, protectedRects), protectedRects)).toEqual({ markerStart: true, markerEnd: false });

  const nonEndpointProtectedRects = [
    { x: 40, y: 40, width: 20, height: 20 },
  ];
  expect(topologyPreviewVisibleSegments(points, nonEndpointProtectedRects)).toEqual([{ a: { x: 10, y: 20 }, b: { x: 100, y: 20 } }, { a: { x: 100, y: 20 }, b: { x: 100, y: 80 } }]);
});

it("renders clipped fallback fragments, protects markers and preserves route style", () => {
  const model = { ...sample().edges[0]!, direction: "bi" as const };
  const points = [{ x: 0, y: 50 }, { x: 100, y: 50 }];
  const data = (rects: Array<{ x: number; y: number; width: number; height: number }>) => ({ edge: model, points, status: "fallback" as const, showLabel: false, fallbackIndex: previewIndex(rects) });
  const edge = { id: "e", selected: false, markerStart: "url(#start)", markerEnd: "url(#end)" };
  const { rerender } = render(<TopologyRouteEdge {...edge} data={data([{ x: 40, y: 40, width: 20, height: 20 }])} />);
  expect(screen.getAllByTestId("mock-base-edge")).toHaveLength(2);
  rerender(<TopologyRouteEdge {...edge} data={data([{ x: 45, y: 40, width: 10, height: 20 }, { x: 87, y: 51, width: 26, height: 26 }])} />);
  const fragments = screen.getAllByTestId("mock-base-edge");
  expect(fragments[0]?.getAttribute("data-marker-start")).toBe("url(#start)");
  expect(fragments.at(-1)?.getAttribute("data-marker-end")).toBeNull();
  rerender(<TopologyRouteEdge {...edge} style={{ stroke: "red", strokeWidth: 3 }} data={data([])} />);
  expect(screen.getByTestId("mock-base-edge").style.stroke).toBe("red");
  expect(screen.getByTestId("mock-base-edge").style.strokeDasharray).toBe("6 5");
  expect(screen.getByTestId("mock-base-edge").style.opacity).toBe("0.65");
  rerender(<TopologyRouteEdge {...edge} data={data([{ x: 0, y: 0, width: 100, height: 100 }])} />);
  expect(screen.queryByTestId("mock-base-edge")).toBeNull();
  rerender(<TopologyRouteEdge {...edge} style={{ stroke: "red", strokeWidth: 3, strokeDasharray: "2 5" }} data={{ ...data([]), status: "routed" }} />);
  expect(screen.getByTestId("mock-base-edge").style.stroke).toBe("red");
  expect(screen.getByTestId("mock-base-edge").style.strokeWidth).toBe("3");
  expect(screen.getByTestId("mock-base-edge").style.strokeDasharray).toBe("2 5");
  rerender(<TopologyRouteEdge {...edge} data={{ ...data([]), points: [] }} />);
  expect(document.querySelector('[data-diagnostic="geometry-unavailable"]')).not.toBeNull();
});

describe("topology canvas", () => {
  it("highlights an edge and its endpoints on hover or selection and clears on the pane", () => {
    const topology = sample();
    render(<TopologyCanvas topology={topology} visibleNodes={topology.nodes} visibleEdges={topology.edges} view={topology.views[0]} selectedNodeId="" onSelect={vi.fn()} />);
    const edge = screen.getByRole("button", { name: "Runs" });
    const endpointClasses = () => (state.renders.at(-1)!.nodes as Node<TopologyCanvasNode>[]).filter((node) => ["root", "service"].includes(node.id)).map((node) => node.className);
    fireEvent.mouseEnter(edge);
    expect(endpointClasses().every((name) => name?.includes("topology-edge-highlighted"))).toBe(true);
    expect((state.renders.at(-1)!.edges as Edge[])[0]?.className).toContain("topology-edge-highlighted");
    fireEvent.mouseLeave(edge);
    expect(endpointClasses().some((name) => name?.includes("topology-edge-highlighted"))).toBe(false);
    fireEvent.click(edge);
    expect(endpointClasses().every((name) => name?.includes("topology-edge-highlighted"))).toBe(true);
    expect((state.renders.at(-1)!.edges as Edge[])[0]?.selected).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "pane" }));
    expect(endpointClasses().some((name) => name?.includes("topology-edge-highlighted"))).toBe(false);
    fireEvent.click(edge);
    fireEvent.click(screen.getByTestId("rf__node-root"));
    expect(endpointClasses().some((name) => name?.includes("topology-edge-highlighted"))).toBe(false);
  });

  it("layouts the full topology and then projects only visible nodes and edges read-only", () => {
    const topology = sample();
    const onSelect = vi.fn();
    render(<TopologyCanvas topology={topology} visibleNodes={[topology.nodes[1]!]} visibleEdges={[]} view={topology.views[0]} selectedNodeId="service" onSelect={onSelect} />);

    const flow = screen.getByTestId("topology-flow");
    expect(flow).toHaveAttribute("data-draggable", "false");
    expect(flow).toHaveAttribute("data-connectable", "false");
    expect(flow).toHaveAttribute("data-selectable", "true");
    expect(flow).toHaveAttribute("data-only-visible", "true");
    expect(flow).toHaveAttribute("data-delete-key", "none");
    fireEvent.click(screen.getByRole("button", { name: "service" }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "root" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lane:cloud" })).toBeInTheDocument();
  });

  it("wires preview route data and fallback status into the canvas edge without smuggling a renderer", () => {
  const topology = sample();
  render(<TopologyCanvas topology={topology} visibleNodes={topology.nodes} visibleEdges={topology.edges} view={topology.views[0]} selectedNodeId="" onSelect={vi.fn()} />);
  const region = screen.getByRole("region", { name: "Topology graph" });
  expect(region).toHaveAttribute("data-visible-edges", "1");
  expect(region).toHaveAttribute("data-route-geometry-edges", "1");
  expect(region).toHaveAttribute("data-route-status", "timeout");
  expect(region).toHaveAttribute("data-route-phase", "fallback");
  expect(region).toHaveAttribute("data-route-failures", "1");
  expect(region).toHaveAttribute("data-route-fallback-count", "1");
  expect(screen.getByRole("status")).toHaveAttribute("data-route-warning", "timeout");
  const routed = state.renders.at(-1)?.edges[0] as Edge<TopologyCanvasEdge> | undefined;
  expect(routed?.data).toMatchObject({ status: "fallback", fallback: "timeout" });
  expect((routed?.data?.route as { points?: unknown[] } | undefined)?.points?.length).toBeGreaterThanOrEqual(2);
  expect(routed?.source).toBe("root");
  expect(routed?.target).toBe("service");
  const nodes = state.renders.at(-1)?.nodes as Node<TopologyCanvasNode>[];
  const source = nodes.find((node) => node.id === routed?.source);
  const target = nodes.find((node) => node.id === routed?.target);
  const sourceHandle = source?.handles?.find((handle) => handle.id === routed?.sourceHandle);
  const targetHandle = target?.handles?.find((handle) => handle.id === routed?.targetHandle);
  expect(sourceHandle && { x: source!.position.x + sourceHandle.x + 3, y: source!.position.y + sourceHandle.y + 3 }).toEqual(routed?.data?.route?.points[0]);
  expect(targetHandle && { x: target!.position.x + targetHandle.x + 3, y: target!.position.y + targetHandle.y + 3 }).toEqual(routed?.data?.route?.points.at(-1));
});

it("summarizes multiple terminal route fallbacks on the canvas", () => {
  const topology = sample();
  topology.edges = [
    topology.edges[0]!,
    { ...topology.edges[0]!, id: "peer-root", source: "peer", target: "root", label: "Fallback peer" },
  ];
  render(<TopologyCanvas topology={topology} visibleNodes={topology.nodes} visibleEdges={topology.edges} view={topology.views[0]} selectedNodeId="" onSelect={vi.fn()} />);

  const region = screen.getByRole("region", { name: "Topology graph" });
  expect(region).toHaveAttribute("data-visible-edges", "2");
  expect(region).toHaveAttribute("data-route-failures", "2");
  expect(region).toHaveAttribute("data-route-fallback-count", "2");
  expect(region).toHaveAttribute("data-route-failure-ids", "peer-root,root-service");
  expect(screen.getByRole("status")).toHaveTextContent("2 route failures, 2 fallbacks");
});

it("keeps selection controlled so clicks cannot loop through React Flow", () => {
    const topology = sample();
    const onSelect = vi.fn();
    const visible = [topology.nodes[0]!, topology.nodes[1]!];
    const { rerender } = render(<TopologyCanvas topology={topology} visibleNodes={visible} visibleEdges={topology.edges} view={undefined} selectedNodeId="" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "root" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("root");
    fireEvent.click(screen.getByRole("button", { name: "lane:cloud" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const before = state.renders.at(-1)!;
    rerender(<TopologyCanvas topology={topology} visibleNodes={visible} visibleEdges={topology.edges} view={undefined} selectedNodeId="root" onSelect={onSelect} />);
    const after = state.renders.at(-1)!;
    expect(after.selectionHandler).toBe(false);
    expect(after.nodesHandler).toBe(false);
    expect(after.edges).toBe(before.edges);
    const changed = after.nodes.filter((node, index) => node !== before.nodes[index]) as Node[];
    expect(changed.map((node) => node.id)).toEqual(["root"]);
    expect(changed[0]!.selected).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "root" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("gives hosts four badges plus boundary chips and satellites two badges", () => {
    const topology = sample();
    topology.boundaries.push({ id: "office", label: "Office", kind: "site", description: "" });
    topology.boundaries.push({ id: "network", label: "Network", kind: "network", description: "" });
    topology.nodes[0]!.boundaryIds = ["home", "office", "network"];
    topology.nodes[0]!.attrs = { ...topology.nodes[1]!.attrs };
    topology.nodes[0]!.lifecycle = "planned";
    topology.types[0]!.label = "Server";
    render(<TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!, topology.nodes[1]!]} visibleEdges={[]} view={undefined} selectedNodeId="service" onSelect={vi.fn()} />);
    expect(screen.getByTestId("topology-node-card-root")).toHaveStyle({ height: "112px", width: "240px" });
    expect(screen.getByTestId("topology-node-card-service")).toHaveStyle({ height: "64px", width: "216px" });
    expect(screen.getAllByText("Disabled: false")).toHaveLength(2);
    expect(screen.getAllByText("Zero: 0")).toHaveLength(2);
    expect(screen.getAllByText("Region: west zone")).toHaveLength(1);
    expect(screen.getAllByText("Extra: a, b")).toHaveLength(1);
    expect(screen.queryByText("Four: 4")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Boundary: Home")).toBeInTheDocument();
    const overflow = screen.getByLabelText("Boundaries: Home, Network, Office");
    expect(overflow).toHaveAttribute("title", "Home, Network, Office");
    expect(screen.getByText("+2 boundaries")).toBeInTheDocument();
    expect(screen.getByText("planned")).toBeInTheDocument();
    expect(screen.getByText("Server · 1 satellites")).toBeInTheDocument();
    expect(screen.getByText("+1 satellites")).toBeInTheDocument();
  });

  it("renders and selects a nested satellite without treating it as a host", () => {
    const topology = sample();
    topology.nodes.push({ ...topology.nodes[1]!, id: "nested", label: "Nested", parentId: "service" });
    const onSelect = vi.fn();
    render(<TopologyCanvas topology={topology} visibleNodes={topology.nodes} visibleEdges={[]} selectedNodeId="" onSelect={onSelect} />);

    const nested = (state.renders.at(-1)?.nodes as Node<TopologyCanvasNode>[]).find((node) => node.id === "nested");
    expect(nested?.data.kind).toBe("sub-satellite");
    expect(screen.getByTestId("topology-node-card-nested")).toHaveClass("topology-card-sub-satellite");
    fireEvent.keyDown(screen.getByTestId("topology-node-card-nested"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("nested");
  });

  it("updates selection from card Enter and Space paths without position writes", () => {
    const topology = sample();
    const onSelect = vi.fn();
    render(<TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!, topology.nodes[2]!]} visibleEdges={[]} view={undefined} selectedNodeId="" onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByTestId("topology-node-card-root"), { key: "Enter" });
    fireEvent.keyDown(screen.getByTestId("topology-node-card-peer"), { key: " " });
    expect(onSelect).toHaveBeenNthCalledWith(1, "root");
    expect(onSelect).toHaveBeenNthCalledWith(2, "peer");
    expect(state.nodeChanges.some((change) => (change as { type: string }).type === "position")).toBe(false);
    expect(screen.getByTestId("topology-flow")).toHaveAttribute("data-draggable", "false");
    expect(screen.getByTestId("topology-flow")).toHaveAttribute("data-connectable", "false");
  });

  it("does not fit empty projections or a zero-size canvas", () => {
    const topology = sample();
    const { rerender } = render(<TopologyCanvas topology={topology} visibleNodes={[]} visibleEdges={[]} view={undefined} selectedNodeId="" onSelect={vi.fn()} />);
    expect(state.setViewport).not.toHaveBeenCalled();

    state.width = 0;
    state.height = 0;
    rerender(<TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!]} visibleEdges={[]} view={undefined} selectedNodeId="root" onSelect={vi.fn()} />);
    expect(state.setViewport).not.toHaveBeenCalled();
  });

  it("fits the visible layer sections, keeps the viewport on selection and refits on demand", () => {
    const topology = sample();
    const layout = layoutTopology(topology, { view: topology.views[0] });
    const lane = layout.lanes[0]!;
    const laneBounds = { x: lane.x, y: lane.y, width: lane.width, height: lane.height };
    const { rerender } = render(<TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!, topology.nodes[1]!]} visibleEdges={topology.edges} view={topology.views[0]} selectedNodeId="root" onSelect={vi.fn()} />);
    expect(state.setViewport.mock.calls.at(-1)).toEqual([getViewportForBounds(laneBounds, 1000, 700, 0.05, 1, 0.06), { duration: 0 }]);

    state.setViewport.mockClear();
    rerender(<TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!, topology.nodes[1]!]} visibleEdges={topology.edges} view={topology.views[0]} selectedNodeId="peer" onSelect={vi.fn()} />);
    expect(state.setViewport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Fit topology" }));
    expect(state.setViewport.mock.calls.at(-1)?.[0]).toEqual(getViewportForBounds(getNodesBounds([{ id: "lane", position: { x: lane.x, y: lane.y }, width: lane.width, height: lane.height }]), 1000, 700, 0.05, 1, 0.06));

    state.setViewport.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Focus layer Cloud" }));
    expect(state.setViewport.mock.calls.at(-1)?.[0]).toEqual(getViewportForBounds(laneBounds, 1000, 700, 0.05, 1, 0.04));
  });

  it("moves the viewport only for new focus requests", () => {
    const topology = sample();
    const layout = layoutTopology(topology);
    const props = { topology, visibleNodes: topology.nodes, visibleEdges: [], view: undefined, selectedNodeId: "", onSelect: vi.fn() };
    const { rerender } = render(<TopologyCanvas {...props} focus={{ kind: "node", id: "service", seq: 1 }} />);
    const service = layout.positions.service!;
    expect(state.setCenter).toHaveBeenLastCalledWith(service.x + service.width / 2, service.y + service.height / 2, { zoom: 1, duration: 0 });
    state.zoom = 0.2;
    rerender(<TopologyCanvas {...props} focus={{ kind: "node", id: "root", seq: 2 }} />);
    expect(state.setCenter).toHaveBeenLastCalledWith(expect.any(Number), expect.any(Number), { zoom: 0.9, duration: 0 });
    state.setCenter.mockClear();
    rerender(<TopologyCanvas {...props} selectedNodeId="root" focus={{ kind: "node", id: "root", seq: 2 }} />);
    rerender(<TopologyCanvas {...props} focus={{ kind: "node", id: "missing", seq: 3 }} />);
    expect(state.setCenter).not.toHaveBeenCalled();
    state.setViewport.mockClear();
    rerender(<TopologyCanvas {...props} focus={{ kind: "layer", id: "cloud", seq: 4 }} />);
    const lane = layout.lanes[0]!;
    expect(state.setViewport).toHaveBeenLastCalledWith(getViewportForBounds(lane, 1000, 700, 0.05, 1, 0.04), { duration: 0 });
    state.setViewport.mockClear();
    rerender(<TopologyCanvas {...props} focus={{ kind: "layer", id: "missing", seq: 5 }} />);
    expect(state.setViewport).not.toHaveBeenCalled();
  });

  it("clears the selection on pane click only when something is selected", () => {
    const topology = sample();
    const onSelect = vi.fn();
    const { rerender } = render(<TopologyCanvas topology={topology} visibleNodes={topology.nodes} visibleEdges={[]} view={undefined} selectedNodeId="" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "pane" }));
    expect(onSelect).not.toHaveBeenCalled();
    rerender(<TopologyCanvas topology={topology} visibleNodes={topology.nodes} visibleEdges={[]} view={undefined} selectedNodeId="root" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "pane" }));
    expect(onSelect).toHaveBeenCalledWith("");
  });

  it("shows at most six ordered badges including zero and false, and no hidden badges", () => {
    const topology = sample();
    const node = topology.nodes[1]!;
    const badges = topologyNodeBadgeValues(topology, node);
    expect(badges).toHaveLength(6);
    expect(badges[0]).toEqual({ label: "Disabled", value: "false" });
    expect(badges[1]).toEqual({ label: "Zero", value: "0" });
    expect(badges.find((badge) => badge.label === "Region")?.value).toBe("west zone");
    expect(badges.find((badge) => badge.label === "Extra")?.value).toBe("a, b");
    expect(badges.some((badge) => badge.label === "Hidden")).toBe(false);
  });

  it("inherits root host boundaries and boundary ancestors for satellites", () => {
    const topology = sample();
    topology.boundaries.push({ id: "site", label: "Office", kind: "site", parentId: undefined, description: "" });
    topology.boundaries[0]!.parentId = "site";
    expect(inheritedBoundaryIds(topology, topology.nodes[1]!)).toEqual(["home"]);
    expect(inheritedBoundaryIds(topology, topology.nodes[0]!)).toEqual(["home"]);
    expect(inheritedBoundaryIds(topology, topology.nodes[2]!)).toEqual([]);
    expect(topologyNodeBoundaryLabels(topology, topology.nodes[1]!)).toEqual(["Home", "Office"]);
  });

  it("caps deep frame rendering at depth five and exposes the full ancestor chain on the host chip", () => {
    const deep = {
      ...sample(),
      title: "Deep frame canvas",
      boundaries: Array.from({ length: 8 }, (_, index) => ({
        id: `deep-${index + 1}`,
        label: `Deep ${index + 1}`,
        kind: "trust" as const,
        parentId: index === 0 ? undefined : `deep-${index}`,
        description: "",
      })),
      nodes: [{ id: "deep-host", type: "host", label: "Deep host", layerId: "cloud", boundaryIds: ["deep-8"], lifecycle: "active" as const, description: "", tags: [], attrs: {} }],
      edges: [],
      views: [],
    };
    const topology = topologySchema.parse(deep);

    render(<TopologyCanvas topology={topology} visibleNodes={topology.nodes} visibleEdges={[]} view={undefined} selectedNodeId="" onSelect={vi.fn()} />);

    const renderedFrames = (state.renders.at(-1)?.nodes as Node<TopologyCanvasNode>[]).filter((node) => node.type === "topologyFrame");
    expect(renderedFrames).toHaveLength(6);
    expect(renderedFrames.map((node) => node.data.visualDepth)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(screen.queryByTestId("topology-frame-deep-7")).not.toBeInTheDocument();
    expect(screen.queryByTestId("topology-frame-deep-8")).not.toBeInTheDocument();

    const host = screen.getByTestId("topology-node-card-deep-host");
    expect(host).toHaveAttribute("data-boundary-labels", "Deep 1, Deep 2, Deep 3, Deep 4, Deep 5, Deep 6, Deep 7, Deep 8");
    expect(screen.getByLabelText("Boundaries: Deep 1, Deep 2, Deep 3, Deep 4, Deep 5, Deep 6, Deep 7, Deep 8")).toHaveAttribute("title", "Deep 1, Deep 2, Deep 3, Deep 4, Deep 5, Deep 6, Deep 7, Deep 8");
  });

  it("hover-highlights every frame fragment with the same boundaryId and clears it", () => {
    const topology = topologySchema.parse({
      ...sample(),
      title: "Fragment canvas",
      layers: [
        { id: "cloud", label: "Cloud", provider: "Fixture", order: 0, description: "" },
        { id: "edge", label: "Edge", provider: "Fixture", order: 1, description: "" },
      ],
      boundaries: [
        { id: "home", label: "Home", kind: "site", description: "" },
        { id: "lan", label: "LAN", kind: "network", parentId: "home", description: "" },
      ],
      nodes: [
        { id: "root", type: "host", label: "Root", layerId: "cloud", boundaryIds: ["lan"], lifecycle: "active", description: "", tags: [], attrs: {} },
        { id: "peer", type: "host", label: "Peer", layerId: "edge", boundaryIds: ["lan"], lifecycle: "active", description: "", tags: [], attrs: {} },
      ],
      edges: [],
      views: [],
    });

    render(<TopologyCanvas topology={topology} visibleNodes={topology.nodes} visibleEdges={[]} view={undefined} selectedNodeId="" onSelect={vi.fn()} />);

    const fragments = screen.getAllByTestId("topology-frame-lan");
    expect(fragments).toHaveLength(2);
    expect(fragments.map((frame) => frame.getAttribute("data-highlighted"))).toEqual(["false", "false"]);

    fireEvent.mouseEnter(screen.getAllByRole("button", { name: /Highlight frame LAN/ })[0]!);
    expect(screen.getAllByTestId("topology-frame-lan").map((frame) => frame.getAttribute("data-highlighted"))).toEqual(["true", "true"]);
    expect((state.renders.at(-1)?.nodes as Node<TopologyCanvasNode>[]).filter((node) => node.type === "topologyFrame" && node.data.boundaryId === "lan").every((node) => node.className === "topology-frame-highlighted")).toBe(true);

    fireEvent.mouseLeave(screen.getAllByRole("button", { name: /Highlight frame LAN/ })[0]!);
    expect(screen.getAllByTestId("topology-frame-lan").map((frame) => frame.getAttribute("data-highlighted"))).toEqual(["false", "false"]);

    fireEvent.mouseEnter(screen.getAllByRole("button", { name: /Highlight frame LAN/ })[1]!);
    expect(screen.getAllByTestId("topology-frame-lan").map((frame) => frame.getAttribute("data-highlighted"))).toEqual(["true", "true"]);

    const header = screen.getAllByRole("button", { name: /Highlight frame LAN/ })[0]!;
    fireEvent.focus(header);
    fireEvent.mouseLeave(screen.getAllByRole("button", { name: /Highlight frame LAN/ })[1]!);
    expect(screen.getAllByTestId("topology-frame-lan").map((frame) => frame.getAttribute("data-highlighted"))).toEqual(["true", "true"]);
    fireEvent.mouseEnter(header);
    fireEvent.blur(header);
    expect(screen.getAllByTestId("topology-frame-lan").map((frame) => frame.getAttribute("data-highlighted"))).toEqual(["true", "true"]);
    fireEvent.mouseLeave(header);
    expect(screen.getAllByTestId("topology-frame-lan").map((frame) => frame.getAttribute("data-highlighted"))).toEqual(["false", "false"]);
  });

  it("exposes the zoom tier, renders sections and frames, and adds non-connectable handles", () => {
    state.zoom = 0.3;
    const topology = sample();
    topology.layers[0]!.color = "#0ea5e9";
    topology.boundaries[0]!.style = { color: "#22c55e" };
    const { rerender } = render(<TopologyCanvas topology={topology} visibleNodes={topology.nodes} visibleEdges={[]} view={undefined} selectedNodeId="service" onSelect={vi.fn()} />);
    const region = screen.getByRole("region", { name: "Topology graph" });
    expect(region).toHaveAttribute("data-zoom-tier", "far");
    expect(region).toHaveClass("topology-zoom-far");
    expect(region).toHaveAttribute("data-selected-node", "service");
    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.queryByText("active")).not.toBeInTheDocument();
    expect(screen.getByText("Cloud")).toBeInTheDocument();
    expect(screen.getByText("Fixture")).toBeInTheDocument();
    expect(screen.getByText("2 hosts · 3 nodes")).toBeInTheDocument();
    expect(screen.getByTestId("topology-section-cloud").style.background).toMatch(/14, 165, 233/);
    expect(screen.getAllByText("Home").length).toBeGreaterThan(0);
    expect(screen.getByText("site")).toBeInTheDocument();
    expect(screen.getByTestId("topology-frame-home").style.borderColor).not.toBe("");
    expect(screen.getAllByTestId("handle-target-t-left")[0]).toHaveAttribute("data-connectable", "false");
    expect(screen.getAllByTestId("handle-source-s-right")[0]).toHaveAttribute("data-connectable", "false");
    state.zoom = 1;
    rerender(<TopologyCanvas topology={topology} visibleNodes={[topology.nodes[2]!]} visibleEdges={[]} view={undefined} selectedNodeId="" onSelect={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Topology graph" })).toHaveAttribute("data-zoom-tier", "near");
    expect(screen.queryByTestId("topology-frame-home")).not.toBeInTheDocument();
  });

  it("uses routed source/target sides instead of relative card sides", () => {
  const source = { x: 0, y: 0, width: 100, height: 100 };
  const target = { x: 300, y: 300, width: 100, height: 100 };
  expect(topologyEdgeHandleSides(undefined, source, target)).toEqual(["right", "left"]);
  expect(topologyEdgeHandleSides({ points: [], sourceSide: "top", targetSide: "bottom" }, source, target)).toEqual(["top", "bottom"]);
  expect(topologyEdgeHandleSides({ points: [], sourceSide: "left", targetSide: "right" }, source, target)).toEqual(["left", "right"]);
});

it("covers zoom, tint, badge, inheritance and edge-side branch matrix", () => {
  expect([0.39, 0.4, 0.74, 0.75, 1].map(topologyZoomTier)).toEqual(["far", "mid", "mid", "near", "near"]);
  expect(topologyTint(undefined, 0.07)).toContain("transparent");
  expect(topologyTint("#2563eb", 0.07)).toMatch(/^#2563eb/);

  const topology = sample();
  const host = topology.nodes[0]!;
  const satellite = topology.nodes[1]!;
  const peer = topology.nodes[2]!;
  expect(inheritedBoundaryIds(topology, host)).toEqual(["home"]);
  expect(inheritedBoundaryIds(topology, satellite)).toEqual(["home"]);
  expect(inheritedBoundaryIds(topology, peer)).toEqual([]);
  expect(topologyNodeBoundaryLabels(topology, host)).toEqual(["Home"]);
  expect(topologyNodeBoundaryLabels(topology, satellite)).toEqual(["Home"]);
  expect(topologyNodeBadgeValues(topology, host)).toEqual([]);

  expect(topologyEdgeSides({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 10, height: 10 })).toEqual(["right", "left"]);
  expect(topologyEdgeSides({ x: 20, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 10, height: 10 })).toEqual(["left", "right"]);
  expect(topologyEdgeSides({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 20, width: 10, height: 10 })).toEqual(["bottom", "top"]);
  expect(topologyEdgeSides({ x: 0, y: 20, width: 10, height: 10 }, { x: 0, y: 0, width: 10, height: 10 })).toEqual(["top", "bottom"]);
});

it("maps zoom levels, colours and edge sides", () => {
    expect([0.1, 0.39, 0.4, 0.74, 0.75, 2].map(topologyZoomTier)).toEqual(["far", "far", "mid", "mid", "near", "near"]);
    expect(topologyTint("#AABBCC", 0.5)).toBe("#AABBCC80");
    expect(topologyTint("teal", 0.25)).toBe("color-mix(in oklab, teal 25%, transparent)");
    expect(topologyTint(undefined, 0.1)).toContain("var(--color-basalt-primary");
    const box = (x: number, y: number) => ({ x, y, width: 10, height: 10 });
    expect(topologyEdgeSides(box(0, 0), box(100, 10))).toEqual(["right", "left"]);
    expect(topologyEdgeSides(box(100, 0), box(0, 10))).toEqual(["left", "right"]);
    expect(topologyEdgeSides(box(0, 0), box(10, 100))).toEqual(["bottom", "top"]);
    expect(topologyEdgeSides(box(0, 100), box(10, 0))).toEqual(["top", "bottom"]);
  });

  it("renders bidirectional edges with both-end markers and topology handles", () => {
    const topology = sample();
    topology.edges[0]!.direction = "bi";
    topology.layers.push({ id: "edge", label: "Edge", provider: "Fixture", order: 1, description: "" });
    topology.nodes.push({ id: "far", type: "host", label: "Far", layerId: "edge", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} });
    topology.edges.push({ id: "root-far", source: "root", target: "far", kind: "uses", label: "", direction: "uni", evidence: "inferred", description: "", tags: [] });
    topology.edges.push({ id: "root-peer", source: "root", target: "peer", kind: "links", label: "Peers", direction: "uni", evidence: "documented", description: "", tags: [], style: { dash: "dotted", width: 3, animated: true } });
    topology.edges.push({ id: "peer-service", source: "peer", target: "service", kind: "links", label: "Dashed", direction: "uni", evidence: "documented", description: "", tags: [], style: { dash: "dashed" } });
    topology.edges.push({ id: "peer-root", source: "peer", target: "root", kind: "links", label: "Solid", direction: "uni", evidence: "inferred", description: "", tags: [], style: { dash: "solid" } });
    topology.edges.push({ id: "ghost", source: "root", target: "missing", kind: "links", label: "Ghost", direction: "uni", evidence: "documented", description: "", tags: [] });
    render(<TopologyCanvas topology={topology} visibleNodes={topology.nodes} visibleEdges={topology.edges} view={undefined} selectedNodeId="" onSelect={vi.fn()} />);
    const edge = screen.getByRole("button", { name: "Runs" });
    expect(edge).toHaveAttribute("data-source-handle", "s-root-service-bottom");
    expect(edge).toHaveAttribute("data-target-handle", "t-root-service-top");
    expect(edge).toHaveAttribute("data-marker-start", "yes");
    expect(edge).toHaveAttribute("data-marker-end", "yes");
    expect(screen.getByRole("button", { name: "uses" })).toHaveAttribute("data-marker-start", "no");
    expect(screen.queryByRole("button", { name: "Ghost" })).not.toBeInTheDocument();
    const rendered = state.renders.at(-1)!.edges as Edge[];
    const byId = new Map(rendered.map((item) => [item.id, item]));
    expect(byId.get("topology-edge:root-far")).toMatchObject({ type: "topologyRoute", className: "topology-edge-host topology-edge-cross", style: { strokeDasharray: "6 5", strokeWidth: 1.5 } });
    expect(byId.get("topology-edge:root-service")).toMatchObject({ type: "topologyRoute", className: "topology-edge-satellite" });
    expect(byId.get("topology-edge:root-service")?.style?.stroke).toBe("var(--topology-edge-uses, #64748b)");
    expect(byId.get("topology-edge:root-peer")).toMatchObject({ animated: true, style: { strokeDasharray: "2 5", strokeWidth: 3 } });
    expect(byId.get("topology-edge:peer-service")?.style?.strokeDasharray).toBe("6 5");
    expect(byId.get("topology-edge:peer-root")?.style?.strokeDasharray).toBeUndefined();
  });

  it("renders visible edges and lane nodes while omitting peers outside the projection", () => {
    const topology = sample();
    render(<TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!]} visibleEdges={topology.edges} view={undefined} selectedNodeId="" onSelect={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "peer" })).not.toBeInTheDocument();
  });
  it("never lets mouse focus or pane scrolling move the map", () => {
    const topology = sample();
    render(<TopologyCanvas topology={topology} visibleNodes={topology.nodes} visibleEdges={[]} view={undefined} selectedNodeId="" onSelect={vi.fn()} />);
    expect(fireEvent.mouseDown(screen.getByTestId("topology-node-card-root"))).toBe(false);
    expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Focus layer Cloud" }))).toBe(false);
    const flow = screen.getByTestId("topology-flow");
    flow.scrollTo = vi.fn();
    fireEvent.scroll(flow);
    expect(flow.scrollTo).not.toHaveBeenCalled();
    flow.scrollLeft = 40;
    fireEvent.scroll(flow);
    expect(flow.scrollTo).toHaveBeenCalledWith(0, 0);
    const region = screen.getByRole("region", { name: "Topology graph" });
    region.scrollTop = 10;
    region.scrollTo = vi.fn();
    fireEvent.scroll(region);
    expect(region.scrollTo).not.toHaveBeenCalled();
  });
});
