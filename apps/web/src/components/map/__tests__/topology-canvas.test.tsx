import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentType, ReactNode } from "react";
import { getNodesBounds, getViewportForBounds, type Edge, type Node, type ReactFlowProps } from "reactflow";
import type { Topology } from "@steed/api/shared";
import { inheritedBoundaryIds, TopologyCanvas, topologyNodeBadgeValues, topologyNodeBoundaryLabels } from "../topology-canvas";
import type { TopologyCanvasEdge, TopologyCanvasNode } from "../topology-canvas";
import { layoutTopology, TOPOLOGY_HOST_HEIGHT, TOPOLOGY_HOST_WIDTH, TOPOLOGY_SATELLITE_HEIGHT, TOPOLOGY_SATELLITE_WIDTH } from "@/lib/topology-layout";

const state = vi.hoisted(() => ({ zoom: 1, width: 1000, height: 700, setViewport: vi.fn(), nodeChanges: [] as unknown[] }));
vi.mock("reactflow", async (original) => {
  const actual = await original<typeof import("reactflow")>();
  return {
    ...actual,
    useStore: (selector: (value: { transform: number[]; width: number; height: number }) => unknown) => selector({ transform: [0, 0, state.zoom], width: state.width, height: state.height }),
    useReactFlow: () => ({ setViewport: state.setViewport }),
    ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    Background: () => <div>Grid</div>,
    Controls: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    ControlButton: ({ children, onClick, "aria-label": ariaLabel }: { children: ReactNode; onClick?: () => void; "aria-label": string }) => <button type="button" onClick={onClick} aria-label={ariaLabel}>{children}</button>,
    Handle: ({ type, id, isConnectable }: { type: string; id?: string; isConnectable?: boolean }) => (
      <span data-testid={`handle-${type}-${id}`} data-connectable={String(isConnectable)} />
    ),
    default: (props: ReactFlowProps<TopologyCanvasNode, TopologyCanvasEdge>) => (
      <div
        data-testid="topology-flow"
        data-draggable={props.nodesDraggable}
        data-connectable={props.nodesConnectable}
        data-selectable={props.elementsSelectable}
        data-only-visible={props.onlyRenderVisibleElements}
        data-delete-key={props.deleteKeyCode === null ? "none" : "key"}
      >
        {props.children}
        {props.nodes?.map((node: Node<TopologyCanvasNode>) => {
          const View = props.nodeTypes?.[node.type ?? ""] as ComponentType<{ data: TopologyCanvasNode; selected: boolean }> | undefined;
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
            {View && <View data={node.data} selected={node.selected === true} />}
          </div>;
        })}
        {props.edges?.map((edge: Edge<TopologyCanvasEdge>) => (
          <button
            key={edge.id}
            data-source-handle={edge.sourceHandle ?? ""}
            data-target-handle={edge.targetHandle ?? ""}
            data-marker-start={edge.markerStart ? "yes" : "no"}
            data-marker-end={edge.markerEnd ? "yes" : "no"}
          >{edge.label}</button>
        ))}
      </div>
    ),
  };
});

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

beforeEach(() => { state.zoom = 1; state.width = 1000; state.height = 700; state.nodeChanges = []; vi.clearAllMocks(); });

describe("topology canvas", () => {
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
    expect(onSelect).toHaveBeenCalledWith("service");
    expect(screen.queryByRole("button", { name: "root" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lane:cloud" })).toBeInTheDocument();
  });

  it("uses a fixed card budget and exposes complete boundary overflow detail without clipping badges", () => {
    const topology = sample();
    topology.boundaries.push({ id: "office", label: "Office", kind: "site", description: "" });
    topology.boundaries.push({ id: "network", label: "Network", kind: "network", description: "" });
    topology.nodes[0]!.boundaryIds = ["home", "office", "network"];
    render(<TopologyCanvas topology={topology} visibleNodes={[topology.nodes[1]!]} visibleEdges={[]} view={undefined} selectedNodeId="service" onSelect={vi.fn()} />);
    const card = screen.getByTestId("topology-node-card-service");
    expect(card).toHaveStyle({ height: "152px" });
    for (const label of ["Disabled: false", "Zero: 0", "Region: west zone", "Extra: a, b", "Four: 4", "Five: 5"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    const overflow = screen.getByLabelText("Boundaries: Home, Network, Office");
    expect(overflow).toHaveAttribute("title", "Home, Network, Office");
    expect(screen.getByText("+2 boundaries")).toBeInTheDocument();
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

  it("fits exact visible business-node bounds and zoom, excludes lanes and hidden pins, and preserves selection pan/zoom", () => {
    const topology = sample();
    const layout = layoutTopology(topology, { view: topology.views[0] });
    const rootNode = { id: "root", position: layout.positions.root!, width: TOPOLOGY_HOST_WIDTH, height: TOPOLOGY_HOST_HEIGHT };
    const serviceNode = { id: "service", position: layout.positions.service!, width: TOPOLOGY_SATELLITE_WIDTH, height: TOPOLOGY_SATELLITE_HEIGHT };
    const { rerender } = render(<TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!, topology.nodes[1]!]} visibleEdges={topology.edges} view={topology.views[0]} selectedNodeId="root" onSelect={vi.fn()} />);

    const initialViewport = state.setViewport.mock.calls.at(-1)?.[0];
    const initialOptions = state.setViewport.mock.calls.at(-1)?.[1];
    const initialBounds = getNodesBounds([rootNode, serviceNode]);
    expect(initialViewport).toEqual(getViewportForBounds(initialBounds, 1000, 700, 0.05, 1, 0.15));
    expect(initialViewport.zoom).toBeLessThanOrEqual(1);
    expect(initialOptions).toEqual({ duration: 0 });

    state.setViewport.mockClear();
    rerender(<TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!]} visibleEdges={[]} view={topology.views[0]} selectedNodeId="root" onSelect={vi.fn()} />);
    const filteredViewport = state.setViewport.mock.calls.at(-1)?.[0];
    expect(filteredViewport).toEqual(getViewportForBounds(getNodesBounds([rootNode]), 1000, 700, 0.05, 1, 0.15));

    state.setViewport.mockClear();
    const pinnedView = { ...topology.views[0]!, pins: { root: { x: 900, y: 360 }, service: { x: 980, y: 210 } } };
    rerender(<TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!]} visibleEdges={[]} view={pinnedView} selectedNodeId="root" onSelect={vi.fn()} />);
    const pinnedViewport = state.setViewport.mock.calls.at(-1)?.[0];
    expect(pinnedViewport).toEqual(getViewportForBounds(getNodesBounds([{ id: "root", position: { x: 900, y: 360 }, width: TOPOLOGY_HOST_WIDTH, height: TOPOLOGY_HOST_HEIGHT }]), 1000, 700, 0.05, 1, 0.15));

    state.setViewport.mockClear();
    rerender(<TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!]} visibleEdges={[]} view={pinnedView} selectedNodeId="peer" onSelect={vi.fn()} />);
    expect(state.setViewport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Fit topology" }));
    const explicitViewport = state.setViewport.mock.calls.at(-1)?.[0];
    expect(explicitViewport).toEqual(getViewportForBounds(getNodesBounds([{ id: "root", position: { x: 900, y: 360 }, width: TOPOLOGY_HOST_WIDTH, height: TOPOLOGY_HOST_HEIGHT }]), 1000, 700, 0.05, 1, 0.15));
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

  it("keeps badges, boundaries and lifecycle visible at low zoom and adds non-connectable handles", () => {
    state.zoom = 0.4;
    const topology = sample();
    render(<TopologyCanvas topology={topology} visibleNodes={[topology.nodes[1]!]} visibleEdges={[]} view={undefined} selectedNodeId="service" onSelect={vi.fn()} />);
    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getByText("satellite")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("Disabled: false")).toBeInTheDocument();
    expect(screen.getByText("Zero: 0")).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByTestId("handle-target-t-left")).toHaveAttribute("data-connectable", "false");
    expect(screen.getByTestId("handle-source-s-right")).toHaveAttribute("data-connectable", "false");
  });

  it("renders bidirectional edges with both-end markers and topology handles", () => {
    const topology = sample();
    topology.edges[0]!.direction = "bi";
    render(<TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!, topology.nodes[1]!]} visibleEdges={topology.edges} view={undefined} selectedNodeId="" onSelect={vi.fn()} />);
    const edge = screen.getByRole("button", { name: "Runs" });
    expect(edge).toHaveAttribute("data-source-handle", "s-right");
    expect(edge).toHaveAttribute("data-target-handle", "t-left");
    expect(edge).toHaveAttribute("data-marker-start", "yes");
    expect(edge).toHaveAttribute("data-marker-end", "yes");
  });

  it("renders visible edges and lane nodes while omitting peers outside the projection", () => {
    const topology = sample();
    render(<TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!]} visibleEdges={topology.edges} view={undefined} selectedNodeId="" onSelect={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "peer" })).not.toBeInTheDocument();
  });
});
