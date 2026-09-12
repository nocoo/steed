import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentType, ReactNode } from "react";
import { diagramSchema, emptyDiagram } from "@steed/api/shared";
import example from "../../../../../../examples/service-platform.json";
import { DiagramCanvas } from "../diagram-canvas";
import { DiagramEdgeView, waypointPath } from "../diagram-edge";
import type { DiagramCanvasNode, DiagramCanvasEdge } from "@/lib/diagram-graph";
import { Position, type Node, type Edge, type EdgeProps, type ReactFlowProps } from "reactflow";

const state = vi.hoisted(() => ({ fit: vi.fn(), zoom: 1 }));
vi.mock("reactflow", async (original) => {
  const actual = await original<typeof import("reactflow")>();
  const { useState } = await import("react");
  return {
    ...actual,
    useStore: (selector: (value: { transform: number[]; width: number; height: number }) => unknown) => selector({ transform: [0, 0, state.zoom], width: 1000, height: 700 }),
    useReactFlow: () => ({ fitBounds: state.fit }),
    useNodesState: (nodes: Node<DiagramCanvasNode>[]) => { const [value, set] = useState(nodes); return [value, set, vi.fn()]; },
    ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    Handle: ({ id }: { id: string }) => <span data-testid={id} />,
    Background: () => <div>Grid</div>,
    Controls: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    ControlButton: ({ children, ...props }: React.ComponentProps<"button">) => <button {...props}>{children}</button>,
    MiniMap: ({ nodeColor }: { nodeColor: (node: { type: string }) => string }) => <div data-testid="minimap">{nodeColor({ type: "boundary" })}:{nodeColor({ type: "component" })}</div>,
    BaseEdge: ({ path }: { path: string }) => <path data-testid="path" d={path} />,
    EdgeText: ({ x, y, label }: { x: number; y: number; label: ReactNode }) => <text data-testid="edge-label" x={x} y={y}>{label}</text>,
    default: (props: ReactFlowProps<DiagramCanvasNode, DiagramCanvasEdge>) => <div data-testid="flow" data-draggable={props.nodesDraggable}>
      {props.nodes?.map((node) => {
        const View = props.nodeTypes?.[node.type ?? "component"] as ComponentType<{ data: DiagramCanvasNode; selected: boolean }>;
        return <div key={node.id}>
          <button onClick={(event) => props.onNodeClick?.(event, node)}>Click {node.id}</button>
          <button onClick={(event) => props.onNodeDragStop?.(event, { ...node, position: { x: 31, y: 42 } }, [])}>Drag {node.id}</button>
          <View data={node.data} selected={node.id === "n:api"} />
        </div>;
      })}
      {props.edges?.map((edge) => <button key={edge.id} onClick={(event) => props.onEdgeClick?.(event, edge)}>Edge {edge.id}</button>)}
      <button onClick={() => props.onConnect?.({ source: "n:client", target: "n:api", sourceHandle: null, targetHandle: null })}>Connect nodes</button>
      <button onClick={() => props.onConnect?.({ source: "g:cloud", target: "n:api", sourceHandle: null, targetHandle: null })}>Connect boundary</button>
      <button onClick={() => props.onConnect?.({ source: null, target: null, sourceHandle: null, targetHandle: null })}>Cancel connection</button>
      <button onClick={(event) => props.onEdgeClick?.(event, { id: "missing", source: "n:api", target: "n:db" } as Edge<DiagramCanvasEdge>)}>Empty edge</button>
      {props.children}
    </div>,
  };
});
beforeEach(() => { vi.clearAllMocks(); state.zoom = 1; });
const callbacks = () => ({ onSelect: vi.fn(), onEdgeSelect: vi.fn(), onExpand: vi.fn(), onMove: vi.fn(), onConnect: vi.fn() });
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name, exact: true }));

describe("diagram canvas interactions", () => {
  it("fits route geometry and forwards selection, movement and valid node connections", async () => {
    vi.useFakeTimers();
    const document = diagramSchema.parse(example);
    document.edges[0]!.route = { waypoints: [{ x: -800, y: -300 }], labelPosition: { x: -900, y: -400 } };
    const handlers = callbacks();
    render(<DiagramCanvas document={document} filter={{}} {...handlers} />);
    await act(() => vi.advanceTimersByTime(100));
    expect(state.fit).toHaveBeenCalledWith(expect.objectContaining({ x: -900, y: -400 }), { padding: 0.15 });
    vi.useRealTimers();
    click("Click n:api"); expect(handlers.onSelect).toHaveBeenCalledWith("api");
    click("Drag n:api"); expect(handlers.onMove).toHaveBeenCalledWith("api", { x: 31, y: 42 });
    click("Drag b:cloud"); expect(handlers.onMove).toHaveBeenCalledTimes(1);
    click("Edge e:request"); expect(handlers.onEdgeSelect).toHaveBeenCalledWith([document.edges[0]]);
    click("Empty edge"); expect(handlers.onEdgeSelect).toHaveBeenCalledTimes(1);
    click("Connect nodes"); click("Connect boundary"); click("Cancel connection");
    expect(handlers.onConnect).toHaveBeenCalledExactlyOnceWith("client", "api");
    click("Fit diagram"); click("Toggle minimap");
    expect(screen.getByTestId("minimap")).toHaveTextContent("transparent:#94a3b8");
    click("Toggle minimap"); expect(screen.queryByTestId("minimap")).not.toBeInTheDocument();
  });

  it("renders compact collapsed groups, expands them, and disables dragging while saving", () => {
    state.zoom = 0.5;
    const handlers = callbacks();
    const { rerender } = render(<DiagramCanvas document={diagramSchema.parse(example)} filter={{ collapsed: ["compute"] }} {...handlers} disabled />);
    expect(screen.getByTestId("flow")).toHaveAttribute("data-draggable", "false");
    click("Click g:compute"); expect(handlers.onExpand).toHaveBeenCalledWith("compute");
    expect(screen.getAllByTitle("Application services")[0]).toHaveStyle({ fontSize: "26px" });
    state.zoom = 1;
    rerender(<DiagramCanvas document={diagramSchema.parse(example)} filter={{ collapsed: ["compute"] }} {...handlers} />);
    expect(screen.getByText("2 components")).toBeInTheDocument();
    rerender(<DiagramCanvas document={emptyDiagram()} filter={{}} {...handlers} />);
    expect(screen.getByText("Add a component or import a diagram to begin.")).toBeInTheDocument();
  });
});

describe("authored diagram edge paths", () => {
  const props: EdgeProps<DiagramCanvasEdge> = { id: "edge", source: "a", target: "b", sourceX: 0, sourceY: 0, targetX: 100, targetY: 100, sourcePosition: Position.Right, targetPosition: Position.Left, selected: false, animated: false, label: "HTTP", style: {}, markerEnd: "arrow", data: { relationships: [] } };
  it("computes the label midpoint by path length, including degenerate segments", () => {
    expect(waypointPath([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 70 }])).toEqual(["M0,0 L30,0 L30,70", 30, 20]);
    expect(waypointPath([{ x: 0, y: 0 }, { x: 0, y: 0 }])).toEqual(["M0,0 L0,0", 0, 0]);
    expect(waypointPath([{ x: 5, y: 6 }])).toEqual(["M5,6", 5, 6]);
  });
  it("draws explicit waypoints and labels, smooth defaults and a visible self loop", () => {
    const { rerender } = render(<svg><DiagramEdgeView {...props} data={{ relationships: [], route: { waypoints: [{ x: 40, y: 20 }], labelPosition: { x: 70, y: 80 } } }} /></svg>);
    expect(screen.getByTestId("path")).toHaveAttribute("d", "M0,0 L40,20 L100,100");
    expect(screen.getByTestId("edge-label")).toHaveAttribute("x", "70");
    expect(screen.getByTestId("edge-label")).toHaveAttribute("y", "80");
    rerender(<svg><DiagramEdgeView {...props} data={undefined} /></svg>);
    expect(screen.getByTestId("path").getAttribute("d")).toContain("M");
    state.zoom = 0.5;
    rerender(<svg><DiagramEdgeView {...props} source="same" target="same" /></svg>);
    expect(screen.getByTestId("path")).toHaveAttribute("d", "M0,0 L48,0 L48,52 L100,52 L100,100");
  });
});
