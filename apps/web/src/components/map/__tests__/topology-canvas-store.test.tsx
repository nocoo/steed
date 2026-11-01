import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNodesBounds, getViewportForBounds, type ReactFlowInstance } from "reactflow";
import type { Topology } from "@steed/api/shared";
import { layoutTopology } from "@/lib/topology-layout";
import { TopologyCanvas, type TopologyCanvasEdge, type TopologyCanvasNode } from "../topology-canvas";

function sample(): Topology {
  return {
    schemaVersion: 2,
    title: "Store topology",
    description: "",
    revision: 9,
    layers: [
      { id: "cloud", label: "Cloud", provider: "Fixture", order: 0, description: "" },
      { id: "edge", label: "Edge", provider: "Fixture", order: 1, description: "" },
    ],
    types: [{ id: "host", label: "Host", shape: "rect", description: "", attrs: [] }],
    boundaries: [],
    nodes: [
      { id: "a", type: "host", label: "A", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "b", type: "host", label: "B", layerId: "edge", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
    ],
    edges: [],
    views: [{ id: "store", label: "Store", description: "", filter: { layerIds: [], typeIds: [], boundaryIds: [], tags: [] }, pins: { a: { x: 900, y: 360 }, b: { x: 4000, y: 180 } }, focusLayerId: "cloud" }],
  };
}

function projectedViewport(topology: Topology, viewId: string, layerId: string) {
  const view = topology.views.find((candidate) => candidate.id === viewId);
  const layout = layoutTopology(topology, view ? { view } : {});
  const lane = layout.lanes.find((candidate) => candidate.layerId === layerId);
  if (!lane) throw new Error(`missing lane ${layerId}`);
  return getViewportForBounds(getNodesBounds([{ id: lane.id, position: { x: lane.x, y: lane.y }, width: lane.width, height: lane.height }]), 500, 500, 0.05, 1, 0.06);
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
  it("auto fits the sections of the visible nodes", async () => {
    const topology = sample();
    let instance: ReactFlowInstance<TopologyCanvasNode, TopologyCanvasEdge> | null = null;
    const onInit = (value: ReactFlowInstance<TopologyCanvasNode, TopologyCanvasEdge>) => { instance = value; };
    const { rerender } = render(<div style={{ width: 1000, height: 700 }}><TopologyCanvas topology={topology} visibleNodes={[topology.nodes[1]!]} visibleEdges={[]} view={topology.views[0]} selectedNodeId="" onSelect={vi.fn()} onInit={onInit} /></div>);

    await waitFor(() => expect(instance?.getViewport()).toEqual(projectedViewport(topology, "store", "edge")));
    const oldViewport = instance?.getViewport();

    rerender(<div style={{ width: 1000, height: 700 }}><TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!]} visibleEdges={[]} view={topology.views[0]} selectedNodeId="" onSelect={vi.fn()} onInit={onInit} /></div>);

    await waitFor(() => expect(instance?.getViewport()).toEqual(projectedViewport(topology, "store", "cloud")));
    expect(instance?.getViewport()).not.toEqual(oldViewport);
  });

  it("refits on a new revision and preserves a manual viewport through keyboard selection", async () => {
    const topology = sample();
    let instance: ReactFlowInstance<TopologyCanvasNode, TopologyCanvasEdge> | null = null;
    const onInit = (value: ReactFlowInstance<TopologyCanvasNode, TopologyCanvasEdge>) => { instance = value; };
    const { rerender } = render(<div style={{ width: 1000, height: 700 }}><TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!]} visibleEdges={[]} view={undefined} selectedNodeId="" onSelect={vi.fn()} onInit={onInit} /></div>);
    await waitFor(() => expect(instance?.getViewport()).toEqual(projectedViewport(topology, "none", "cloud")));

    const manualViewport = { x: 10, y: 10, zoom: 0.65 };
    act(() => instance?.setViewport(manualViewport, { duration: 0 }));
    await waitFor(() => expect(instance?.getViewport()).toEqual(manualViewport));

    const onSelect = vi.fn();
    rerender(<div style={{ width: 1000, height: 700 }}><TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!]} visibleEdges={[]} view={undefined} selectedNodeId="" onSelect={onSelect} onInit={onInit} /></div>);
    const positionBefore = instance?.getNodes().find((node) => node.id === "a")?.position;
    await screen.findByRole("button", { name: "Select A" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Select A" }), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("a");
    rerender(<div style={{ width: 1000, height: 700 }}><TopologyCanvas topology={topology} visibleNodes={[topology.nodes[0]!]} visibleEdges={[]} view={undefined} selectedNodeId="a" onSelect={onSelect} onInit={onInit} /></div>);
    await waitFor(() => expect(instance?.getViewport()).toEqual(manualViewport));
    fireEvent.keyDown(screen.getByRole("button", { name: "Select A" }), { key: " " });
    await waitFor(() => expect(instance?.getViewport()).toEqual(manualViewport));
    expect(instance?.getNodes().find((node) => node.id === "a")?.position).toEqual(positionBefore);

    const next = { ...topology, revision: topology.revision + 1 };
    rerender(<div style={{ width: 1000, height: 700 }}><TopologyCanvas topology={next} visibleNodes={[next.nodes[0]!]} visibleEdges={[]} view={undefined} selectedNodeId="a" onSelect={onSelect} onInit={onInit} /></div>);
    await waitFor(() => expect(instance?.getViewport()).toEqual(projectedViewport(next, "none", "cloud")));
  });
});
