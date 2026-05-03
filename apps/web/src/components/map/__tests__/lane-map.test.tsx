import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LaneMap } from "../lane-map";
import type { MapGraph, MapNode } from "@/lib/map-data";

vi.mock("reactflow", async () => {
  const ReactFlow = ({
    nodes,
    onNodeClick,
    children,
  }: {
    nodes: { id: string }[];
    onNodeClick?: (e: unknown, n: { id: string }) => void;
    children?: React.ReactNode;
  }) => (
    <div data-testid="react-flow">
      {nodes.map((n) => (
        <button key={n.id} data-testid={`node-${n.id}`} onClick={(e) => onNodeClick?.(e, n)}>
          {n.id}
        </button>
      ))}
      {children}
    </div>
  );
  return {
    default: ReactFlow,
    Background: () => <div data-testid="background" />,
    Controls: () => <div data-testid="controls" />,
    MiniMap: () => <div data-testid="minimap" />,
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
    Handle: () => null,
  };
});

const hostNode: MapNode = {
  id: "h1",
  kind: "host",
  data: {
    kind: "host",
    label: "Host A",
    laneKeys: ["work"],
    orphan: false,
    raw: {
      id: "h1",
      fingerprint: "fp",
      hostname: "Host A",
      platform: "darwin",
      arch: "arm64",
      status: "online",
      last_seen_at: null,
      metadata: {},
    },
  },
};

const graph: MapGraph = {
  nodes: [hostNode],
  edges: [
    {
      id: "e1",
      source: "h1",
      target: "a1",
      laneKey: "work",
    },
  ],
};

describe("LaneMap", () => {
  it("renders nodes inside ReactFlow", () => {
    render(<LaneMap graph={graph} />);
    expect(screen.getByTestId("node-h1")).toBeInTheDocument();
    expect(screen.getByTestId("background")).toBeInTheDocument();
  });

  it("invokes onNodeClick with the original MapNode", () => {
    const onClick = vi.fn();
    render(<LaneMap graph={graph} onNodeClick={onClick} />);
    fireEvent.click(screen.getByTestId("node-h1"));
    expect(onClick).toHaveBeenCalledWith(hostNode);
  });

  it("does nothing when onNodeClick is not provided", () => {
    render(<LaneMap graph={graph} />);
    fireEvent.click(screen.getByTestId("node-h1"));
    // no throw
  });

  it("ignores clicks for nodes missing in the graph", () => {
    const onClick = vi.fn();
    render(<LaneMap graph={{ nodes: [], edges: [] }} onNodeClick={onClick} />);
    expect(onClick).not.toHaveBeenCalled();
  });
});
