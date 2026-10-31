import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNodesBounds, getViewportForBounds, type ReactFlowInstance } from "reactflow";
import type { Topology } from "@steed/api/shared";
import { layoutTopology, TOPOLOGY_HOST_HEIGHT, TOPOLOGY_HOST_WIDTH } from "@/lib/topology-layout";
import { TopologyCanvas, type TopologyCanvasEdge, type TopologyCanvasNode } from "../topology-canvas";

function sample(): Topology {
  return {
    schemaVersion: 2,
    title: "Store topology",
    description: "",
    revision: 9,
    layers: [{ id: "cloud", label: "Cloud", provider: "Fixture", order: 0, description: "" }],
    types: [{ id: "host", label: "Host", shape: "rect", description: "", attrs: [] }],
    boundaries: [],
    nodes: [
      { id: "a", type: "host", label: "A", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "b", type: "host", label: "B", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
    ],
    edges: [],
    views: [{ id: "store", label: "Store", description: "", filter: { layerIds: [], typeIds: [], boundaryIds: [], tags: [] }, pins: { a: { x: 900, y: 360 }, b: { x: 4000, y: 180 } }, focusLayerId: "cloud" }],
  };
}

function projectedViewport(topology: Topology, viewId: string, nodeId: string) {
  const view = topology.views.find((candidate) => candidate.id === viewId)!;
  const layout = layoutTopology(topology, { view });
  const position = layout.positions[nodeId]!;
  const bounds = getNodesBounds([{ id: nodeId, position, width: TOPOLOGY_HOST_WIDTH, height: TOPOLOGY_HOST_HEIGHT }]);
  return getViewportForBounds(bounds, 500, 500, 0.05, 1, 0.15);
}

beforeEach(() => {
  class DOMMatrixReadOnlyStub {
    readonly m22 = 1;
    constructor(_transform?: string) {}
  }
  Object.defineProperty(window, "DOMMatrixReadOnly", { configurable: true, writable: true, value: DOMMatrixReadOnlyStub });
  Object.defineProperty(globalThis, "DOMMatrixReadOnly", { configurable: true, writable: true, value: DOMMatrixReadOnlyStub });
  vi.stubGlobal("ResizeObserver", class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, contentRect: { width: 1000, height: 700, x: 0, y: 0, top: 0, right: 1000, bottom: 700, left: 0, toJSON: () => ({}) } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1000,
    height: 700,
    x: 0,
    y: 0,
    top: 0,
    right: 1000,
    bottom: 700,
    left: 0,
    toJSON: () => ({}),
  });
});

describe("topology canvas real React Flow store", () => {
  it("auto fits the current visible ID instead of stale store coordinates", async () => {
    const topology = sample();
    let instance: ReactFlowInstance<TopologyCanvasNode, TopologyCanvasEdge> | null = null;
    const onInit = (value: ReactFlowInstance<TopologyCanvasNode, TopologyCanvasEdge>) => { instance = value; };
    const { rerender } = render(<div style={{ width: 1000, height: 700 }}><TopologyCanvas topology={topology} visibleNodes={[topology.nodes[1]!]} visibleEdges={[]} view={topology.views[0]} selectedNodeId="" onSelect={vi.fn()} onInit={onInit} /></div>);

    await waitFor(() => expect(instance?.getViewport()).toEqual(projectedViewport(topology, "store", "b")));
    const oldViewport = instance?.getViewport();

    rerender(<div style={{ width: 1000, height: 700 }}><TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!]} visibleEdges={[]} view={topology.views[0]} selectedNodeId="" onSelect={vi.fn()} onInit={onInit} /></div>);

    await waitFor(() => expect(instance?.getViewport()).toEqual(projectedViewport(topology, "store", "a")));
    expect(instance?.getViewport()).not.toEqual(oldViewport);
  });

  it("auto fits a new pin for the same ID and preserves manual viewport through keyboard selection", async () => {
    const topology = sample();
    let instance: ReactFlowInstance<TopologyCanvasNode, TopologyCanvasEdge> | null = null;
    const onInit = (value: ReactFlowInstance<TopologyCanvasNode, TopologyCanvasEdge>) => { instance = value; };
    const oldView = topology.views[0]!;
    const oldViewCopy = { ...oldView, pins: { a: { x: 4000, y: 180 }, b: oldView.pins.b } };
    const { rerender } = render(<div style={{ width: 1000, height: 700 }}><TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!]} visibleEdges={[]} view={oldViewCopy} selectedNodeId="" onSelect={vi.fn()} onInit={onInit} /></div>);

    const oldTopology = { ...topology, views: [{ ...oldViewCopy }] };
    await waitFor(() => expect(instance?.getViewport()).toEqual(projectedViewport(oldTopology, "store", "a")));

    const newView = { ...oldViewCopy, pins: { a: { x: 900, y: 360 }, b: oldView.pins.b } };
    rerender(<div style={{ width: 1000, height: 700 }}><TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!]} visibleEdges={[]} view={newView} selectedNodeId="" onSelect={vi.fn()} onInit={onInit} /></div>);

    const newTopology = { ...topology, views: [{ ...newView }] };
    await waitFor(() => expect(instance?.getViewport()).toEqual(projectedViewport(newTopology, "store", "a")));

    const manualViewport = { x: -500, y: -200, zoom: 0.65 };
    act(() => instance?.setViewport(manualViewport, { duration: 0 }));
    await waitFor(() => expect(instance?.getViewport()).toEqual(manualViewport));

    const onSelect = vi.fn();
    rerender(<div style={{ width: 1000, height: 700 }}><TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!]} visibleEdges={[]} view={newView} selectedNodeId="" onSelect={onSelect} onInit={onInit} /></div>);
    const positionBefore = instance?.getNodes().find((node) => node.id === "a")?.position;
    await screen.findByRole("button", { name: "Select A" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Select A" }), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("a");
    await waitFor(() => expect(instance?.getViewport()).toEqual(manualViewport));

    fireEvent.keyDown(screen.getByRole("button", { name: "Select A" }), { key: " " });
    expect(onSelect).toHaveBeenCalledWith("a");
    await waitFor(() => expect(instance?.getViewport()).toEqual(manualViewport));
    const positionAfter = instance?.getNodes().find((node) => node.id === "a")?.position;
    expect(positionAfter).toEqual(positionBefore);
  });
});
