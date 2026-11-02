import { createElement, type ComponentType, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Topology } from "@steed/api/shared";

const flow = vi.hoisted(() => ({
  width: 1000,
  height: 700,
  zoom: 1,
  setViewport: vi.fn(),
  setCenter: vi.fn(),
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  const React = await import("react");
  return {
    ...actual,
    BaseEdge: (props: { id?: string; path?: string; markerStart?: unknown; markerEnd?: unknown }) => React.createElement("path", {
      d: props.path,
      "data-testid": "topology-base-edge",
      "data-edge-id": props.id,
      "data-marker-start": props.markerStart ? "visible" : "hidden",
      "data-marker-end": props.markerEnd ? "visible" : "hidden",
    }),
    ReactFlowProvider: ({ children }: { children: ReactNode }) => React.createElement(React.Fragment, null, children),
    useReactFlow: () => ({ setViewport: flow.setViewport, setCenter: flow.setCenter, getZoom: () => flow.zoom }),
    useUpdateNodeInternals: () => vi.fn(),
    ViewportPortal: ({ children }: { children: ReactNode }) => React.createElement(React.Fragment, null, children),
    useStore: (selector: (value: { transform: number[]; width: number; height: number }) => unknown) => selector({ transform: [0, 0, flow.zoom], width: flow.width, height: flow.height }),
    ReactFlow: (props: {
      nodes?: Array<{ id: string; type?: string; data: unknown; selected?: boolean }>;
      edges?: Array<{ id: string; label?: ReactNode; sourceHandle?: string; targetHandle?: string; markerStart?: unknown; markerEnd?: unknown; style?: unknown }>;
      nodeTypes?: Record<string, ComponentType<{ id: string; data: unknown; selected: boolean }>>;
      onPaneClick?: () => void;
      onNodeClick?: (event: unknown, node: { id: string; data: unknown }) => void;
      children?: ReactNode;
    }) => React.createElement("div", { "data-testid": "mock-flow" },
      ...(props.nodes ?? []).map((node) => {
        const View = props.nodeTypes?.[node.type ?? ""];
        return React.createElement("div", { key: node.id },
          React.createElement("button", { type: "button", "data-testid": `mock-node-${node.id}`, onClick: (event) => props.onNodeClick?.(event, node) }, node.id),
          View ? React.createElement(View, { id: node.id, data: node.data, selected: node.selected === true }) : null,
        );
      }),
      ...(props.edges ?? []).map((edge) => React.createElement("button", {
        key: edge.id,
        type: "button",
        "data-testid": `mock-edge-${edge.id}`,
        "data-source-handle": edge.sourceHandle ?? "",
        "data-target-handle": edge.targetHandle ?? "",
        "data-marker-start": edge.markerStart ? "yes" : "no",
        "data-marker-end": edge.markerEnd ? "yes" : "no",
      }, edge.label)),
      React.createElement("button", { type: "button", "data-testid": "mock-pane", onClick: () => props.onPaneClick?.() }, "pane"),
      props.children,
    ),
    Background: () => null,
    Controls: ({ children }: { children: ReactNode }) => React.createElement("div", null, children),
    ControlButton: ({ children, onClick, "aria-label": ariaLabel }: { children: ReactNode; onClick?: () => void; "aria-label": string }) => React.createElement("button", { type: "button", onClick, "aria-label": ariaLabel }, children),
    Handle: () => null,
  };
});

import { TopologyCanvas, TopologyRouteEdge } from "../components/map/topology-canvas";

afterEach(cleanup);

function canvasTopology(): Topology {
  const boundaries: Topology["boundaries"] = [
    { id: "dotted", label: "Dotted", kind: "site", style: { border: { style: "dotted", width: 1, color: "#123456" } }, description: "" },
    { id: "dashed", label: "Dashed", kind: "network", style: { border: { style: "dashed", width: 2, color: "#234567" } }, description: "" },
    { id: "double", label: "Double", kind: "trust", style: { border: { style: "double", width: 3, color: "#345678" } }, description: "" },
    { id: "solid", label: "Solid", kind: "account", style: { border: { style: "solid", width: 4, color: "#456789" } }, description: "" },
  ];
  const node = (id: string, boundaryIds: string[], extra: Partial<Topology["nodes"][number]> = {}): Topology["nodes"][number] => ({
    id,
    type: "host",
    label: id,
    layerId: "cloud",
    boundaryIds,
    lifecycle: "active",
    description: "Synthetic",
    tags: [],
    attrs: {},
    ...extra,
  });
  return {
    schemaVersion: 2,
    title: "Canvas render fixture",
    description: "Synthetic",
    revision: 1,
    layers: [{ id: "cloud", label: "Cloud", provider: "Fixture", order: 0, description: "" }],
    types: [{ id: "host", label: "Host", shape: "rect", description: "", attrs: [] }],
    boundaries,
    nodes: [
      node("host-dotted", ["dotted"], { lifecycle: "planned" }),
      node("host-dashed", ["dashed"], { lifecycle: "deprecated" }),
      node("host-double", ["double"], { lifecycle: "retired" }),
      node("host-solid", ["solid"]),
      node("host-plain", []),
      node("satellite", [], { parentId: "host-plain", role: "service" }),
    ],
    edges: [],
    views: [],
  };
}

describe("commit8 route edge rendering overlay", () => {
  it("renders frame border variants, host/satellite cards, lifecycle and frame focus states", () => {
    flow.setViewport.mockClear();
    const topology = canvasTopology();
    render(createElement(TopologyCanvas, {
      topology,
      visibleNodes: topology.nodes,
      visibleEdges: [],
      selectedNodeId: "",
      onSelect: vi.fn(),
    } as never));

    for (const [id, style] of [["dotted", "dotted"], ["dashed", "dashed"], ["double", "double"], ["solid", "solid"]]) {
      const frame = screen.getByTestId(`topology-frame-${id}`);
      expect(frame.style.borderStyle).toBe(style);
      expect(frame).toHaveAttribute("data-highlighted", "false");
    }
    expect(screen.getByText("planned")).toBeInTheDocument();
    expect(screen.getByText("deprecated")).toBeInTheDocument();
    expect(screen.getByText("retired")).toBeInTheDocument();
    expect(screen.getByTestId("topology-node-card-satellite")).toBeInTheDocument();

    const frame = screen.getByTestId("topology-frame-dotted");
    const header = screen.getByRole("button", { name: "Highlight frame Dotted" });
    fireEvent.mouseEnter(header);
    expect(frame).toHaveAttribute("data-highlighted", "true");
    fireEvent.mouseLeave(header);
    expect(frame).toHaveAttribute("data-highlighted", "false");
    fireEvent.focus(header);
    expect(frame).toHaveAttribute("data-highlighted", "true");
    fireEvent.blur(header);
    expect(frame).toHaveAttribute("data-highlighted", "false");

    const callsBeforeFocus = flow.setViewport.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Focus layer Cloud" }));
    expect(flow.setViewport.mock.calls.length).toBeGreaterThan(callsBeforeFocus);
  });
  const baseProps = { id: "route-a-b", sourceX: 0, sourceY: 0, targetX: 100, targetY: 0 };

  it("projects cross-layer, satellite, bidirectional and styled edges while keeping selection controlled", () => {
    const topology: Topology = {
      schemaVersion: 2,
      title: "Edge projection fixture",
      description: "Synthetic",
      revision: 2,
      layers: [
        { id: "cloud", label: "Cloud", provider: "Fixture", order: 0, description: "" },
        { id: "edge", label: "Edge", provider: "Fixture", order: 1, description: "" },
      ],
      types: [{ id: "host", label: "Host", shape: "rounded", description: "", attrs: [] }],
      boundaries: [{ id: "office", label: "Office", kind: "site", description: "" }],
      nodes: [
        { id: "root", type: "host", label: "Root", layerId: "cloud", boundaryIds: ["office"], lifecycle: "active", description: "", tags: [], attrs: {} },
        { id: "satellite", type: "host", label: "Satellite", layerId: "cloud", parentId: "root", role: "service", lifecycle: "planned", description: "", tags: [], attrs: {} },
        { id: "peer", type: "host", label: "Peer", layerId: "edge", boundaryIds: ["office"], lifecycle: "deprecated", description: "", tags: [], attrs: {} },
      ],
      edges: [
        { id: "cross", source: "root", target: "peer", kind: "traffic", label: "HTTPS", protocol: "HTTPS", port: 443, direction: "bi", evidence: "documented", description: "", tags: [], style: { animated: true, width: 4, dash: "dotted" } },
        { id: "sat-edge", source: "root", target: "satellite", kind: "tunnel", label: "Tunnel", direction: "uni", evidence: "inferred", description: "", tags: [], style: { dash: "dashed", width: 2 } },
        { id: "solid-edge", source: "root", target: "peer", kind: "uses", label: "Uses", direction: "uni", evidence: "documented", description: "", tags: [], style: { dash: "solid", width: 1 } },
      ],
      views: [],
    };
    const onSelect = vi.fn();
    render(createElement(TopologyCanvas, {
      topology,
      visibleNodes: topology.nodes,
      visibleEdges: topology.edges,
      selectedNodeId: "root",
      onSelect,
    } as never));

    const cross = screen.getByTestId("mock-edge-topology-edge:cross");
    expect(cross).toHaveAttribute("data-marker-start", "yes");
    expect(cross).toHaveAttribute("data-marker-end", "yes");
    expect(cross.getAttribute("data-source-handle")).not.toBe("");
    expect(cross.getAttribute("data-target-handle")).not.toBe("");
    expect(screen.getByTestId("mock-edge-topology-edge:sat-edge")).toBeInTheDocument();
    expect(screen.getByTestId("mock-edge-topology-edge:solid-edge")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mock-pane"));
    expect(onSelect).toHaveBeenCalledWith("");

    fireEvent.click(screen.getByTestId("mock-node-peer"));
    expect(onSelect).toHaveBeenLastCalledWith("peer");
  });

  it("renders clipped fallback fragments and keeps markers only at visible endpoints", () => {
    render(createElement(TopologyRouteEdge, {
      ...baseProps,
      markerStart: "url(#start)",
      markerEnd: "url(#end)",
      data: {
        route: { points: [{ x: 0, y: 50 }, { x: 200, y: 50 }], status: "fallback", fallback: "timeout" },
        protectedRects: [{ x: 80, y: 40, width: 40, height: 20 }],
      },
    } as never));

    const paths = screen.getAllByTestId("topology-base-edge");
    expect(paths.map((path) => path.getAttribute("d"))).toEqual([
      "M 0 50 L 80 50",
      "M 120 50 L 200 50",
    ]);
    expect(paths.every((path) => path.getAttribute("data-marker-start") === "hidden" || path.getAttribute("data-marker-start") === "visible")).toBe(true);
    expect(paths.every((path) => path.getAttribute("data-marker-end") === "hidden" || path.getAttribute("data-marker-end") === "visible")).toBe(true);

    const positive = render(createElement(TopologyRouteEdge, {
      ...baseProps,
      markerStart: "url(#start)",
      markerEnd: "url(#end)",
      data: {
        route: { points: [{ x: 0, y: 50 }, { x: 200, y: 50 }], status: "fallback", fallback: "timeout" },
        protectedRects: [],
      },
    } as never));
    const control = positive.container.querySelector('[data-testid="topology-base-edge"]');
    expect(positive.container.querySelectorAll('[data-testid="topology-base-edge"]')).toHaveLength(1);
    expect(control).toHaveAttribute("data-marker-start", "visible");
    expect(control).toHaveAttribute("data-marker-end", "visible");
  });

  it("diagnoses fully clipped fallback and absent routed geometry without rendering an edge", () => {
    const { rerender } = render(createElement(TopologyRouteEdge, {
      ...baseProps,
      data: {
        route: { points: [{ x: 0, y: 50 }, { x: 100, y: 50 }], status: "fallback", fallback: "no_path" },
        protectedRects: [{ x: 0, y: 0, width: 100, height: 100 }],
      },
    } as never));
    expect(document.querySelector('[data-diagnostic="fallback-no-visible-segment"]')).not.toBeNull();
    expect(screen.queryByTestId("topology-base-edge")).toBeNull();

    rerender(createElement(TopologyRouteEdge, { ...baseProps, data: undefined } as never));
    expect(document.querySelector('[data-diagnostic="routed-geometry-unavailable"]')).not.toBeNull();
    expect(screen.queryByTestId("topology-base-edge")).toBeNull();
  });

  it("renders routed polylines and guards a missing first point", () => {
    const { rerender } = render(createElement(TopologyRouteEdge, {
      ...baseProps,
      markerStart: "url(#start)",
      markerEnd: "url(#end)",
      data: { route: { points: [{ x: 1, y: 2 }, { x: 30, y: 40 }], status: "routed" } },
    } as never));
    expect(screen.getByTestId("topology-base-edge")).toHaveAttribute("d", "M 1 2 L 30 40");
    expect(screen.getByTestId("topology-base-edge")).toHaveAttribute("data-marker-start", "visible");
    expect(screen.getByTestId("topology-base-edge")).toHaveAttribute("data-marker-end", "visible");

    rerender(createElement(TopologyRouteEdge, {
      ...baseProps,
      data: { route: { points: [undefined, { x: 30, y: 40 }], status: "routed" } },
    } as never));
    expect(document.querySelector('[data-diagnostic="routed-geometry-unavailable"]')).not.toBeNull();
    expect(screen.queryByTestId("topology-base-edge")).toBeNull();
  });
});
