import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { NodeDrawer } from "../node-drawer";
import type { MapNode } from "@/lib/map-data";

const mockAgentNode: MapNode = {
  id: "a1",
  kind: "agent",
  data: {
    kind: "agent",
    label: "Test Agent",
    laneKeys: ["work"],
    orphan: false,
    raw: {
      id: "a1",
      host_id: "h1",
      match_key: "test-agent",
      nickname: "Test Agent",
      role: null,
      lane_id: "lane_work",
      runtime_app: "node",
      runtime_version: "20.0.0",
      status: "running",
      created_at: "2024-01-01T00:00:00Z",
      last_seen_at: null,
      metadata: {},
    },
  },
};

const mockHostNode: MapNode = {
  id: "h1",
  kind: "host",
  data: {
    kind: "host",
    label: "Test Host",
    laneKeys: [],
    orphan: false,
    raw: {
      id: "h1",
      name: "Test Host",
      os: "darwin",
      arch: "arm64",
      hostname: "test-host",
      status: "online",
      created_at: "2024-01-01T00:00:00Z",
      last_seen_at: "2024-01-01T00:00:00Z",
    },
  },
};

const mockDataSourceNode: MapNode = {
  id: "ds1",
  kind: "data_source",
  data: {
    kind: "data_source",
    label: "Test DS",
    laneKeys: ["work", "life"],
    orphan: false,
    raw: {
      id: "ds1",
      host_id: "h1",
      type: "personal_cli",
      name: "Test DS",
      version: "1.0.0",
      auth_status: "authenticated",
      status: "active",
      metadata: {},
      created_at: "2024-01-01T00:00:00Z",
      last_seen_at: null,
      lane_ids: ["lane_work", "lane_life"],
    },
  },
};

describe("NodeDrawer", () => {
  it("renders agent details", () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <NodeDrawer node={mockAgentNode} onClose={onClose} />
      </MemoryRouter>
    );

    expect(screen.getByText("Test Agent")).toBeInTheDocument();
    expect(screen.getByText("agent")).toBeInTheDocument();
    expect(screen.getByText("test-agent")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("node")).toBeInTheDocument();
    expect(screen.getByText("lane_work")).toBeInTheDocument();
  });

  it("renders host details", () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <NodeDrawer node={mockHostNode} onClose={onClose} />
      </MemoryRouter>
    );

    expect(screen.getByText("Test Host")).toBeInTheDocument();
    expect(screen.getByText("host")).toBeInTheDocument();
    expect(screen.getByText("online")).toBeInTheDocument();
  });

  it("renders data source details", () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <NodeDrawer node={mockDataSourceNode} onClose={onClose} />
      </MemoryRouter>
    );

    expect(screen.getByText("Test DS")).toBeInTheDocument();
    expect(screen.getByText("data_source")).toBeInTheDocument();
    expect(screen.getByText("personal_cli")).toBeInTheDocument();
    expect(screen.getByText("authenticated")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("lane_work, lane_life")).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <NodeDrawer node={mockAgentNode} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Close drawer" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows detail link for agent", () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <NodeDrawer node={mockAgentNode} onClose={onClose} />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: "Open detail →" })).toHaveAttribute(
      "href",
      "/agents/a1"
    );
  });

  it("shows detail link for data source", () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <NodeDrawer node={mockDataSourceNode} onClose={onClose} />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: "Open detail →" })).toHaveAttribute(
      "href",
      "/data-sources/ds1"
    );
  });

  it("does not show detail link for host", () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <NodeDrawer node={mockHostNode} onClose={onClose} />
      </MemoryRouter>
    );

    expect(
      screen.queryByRole("link", { name: "Open detail →" })
    ).not.toBeInTheDocument();
  });

  it("handles agent with null runtime_app", () => {
    const onClose = vi.fn();
    const agentWithNullRuntime: MapNode = {
      ...mockAgentNode,
      data: {
        ...mockAgentNode.data,
        kind: "agent",
        raw: {
          ...mockAgentNode.data.raw,
          runtime_app: null,
        },
      },
    };
    render(
      <MemoryRouter>
        <NodeDrawer node={agentWithNullRuntime} onClose={onClose} />
      </MemoryRouter>
    );

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("handles agent with null lane_id", () => {
    const onClose = vi.fn();
    const agentWithNullLane: MapNode = {
      ...mockAgentNode,
      data: {
        ...mockAgentNode.data,
        kind: "agent",
        raw: {
          ...mockAgentNode.data.raw,
          lane_id: null,
        },
      },
    };
    render(
      <MemoryRouter>
        <NodeDrawer node={agentWithNullLane} onClose={onClose} />
      </MemoryRouter>
    );

    expect(screen.getByText("unassigned")).toBeInTheDocument();
  });

  it("handles host with null last_seen_at", () => {
    const onClose = vi.fn();
    const hostWithNullLastSeen: MapNode = {
      ...mockHostNode,
      data: {
        ...mockHostNode.data,
        kind: "host",
        raw: {
          ...mockHostNode.data.raw,
          last_seen_at: null,
        },
      },
    };
    render(
      <MemoryRouter>
        <NodeDrawer node={hostWithNullLastSeen} onClose={onClose} />
      </MemoryRouter>
    );

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("handles data source with empty lane_ids", () => {
    const onClose = vi.fn();
    const dsWithNoLanes: MapNode = {
      ...mockDataSourceNode,
      data: {
        ...mockDataSourceNode.data,
        kind: "data_source",
        raw: {
          ...mockDataSourceNode.data.raw,
          lane_ids: [],
        },
      },
    };
    render(
      <MemoryRouter>
        <NodeDrawer node={dsWithNoLanes} onClose={onClose} />
      </MemoryRouter>
    );

    const lanesRow = screen.getByText("lanes").closest("div");
    expect(lanesRow).toHaveTextContent("—");
  });
});
