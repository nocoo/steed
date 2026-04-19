import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgentListItem, DataSourceWithLanes } from "@steed/shared";
import { NodeDrawer } from "@/components/map/node-drawer";

const agent: AgentListItem = {
  id: "a1",
  host_id: "h1",
  match_key: "agent_main",
  nickname: "hermes:main",
  role: null,
  lane_id: "lane_work",
  runtime_app: "node",
  runtime_version: "20",
  status: "running",
  created_at: "",
  last_seen_at: null,
};

const ds: DataSourceWithLanes = {
  id: "ds1",
  host_id: "h1",
  type: "personal_cli",
  name: "claude",
  version: null,
  auth_status: "authenticated",
  status: "active",
  metadata: {},
  created_at: "",
  last_seen_at: null,
  lane_ids: ["lane_work"],
};

describe("NodeDrawer", () => {
  afterEach(() => cleanup());

  it("renders agent details with link to agent detail page", () => {
    render(
      <NodeDrawer
        node={{
          id: "a1",
          kind: "agent",
          data: {
            kind: "agent",
            label: "hermes:main",
            laneKeys: ["work"],
            orphan: false,
            raw: agent,
          },
        }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("hermes:main")).toBeDefined();
    const link = screen.getByRole("link", { name: /Open detail/i });
    expect(link.getAttribute("href")).toBe("/agents/a1");
  });

  it("renders data source details with link to ds detail page", () => {
    render(
      <NodeDrawer
        node={{
          id: "ds1",
          kind: "data_source",
          data: {
            kind: "data_source",
            label: "claude",
            laneKeys: ["work"],
            orphan: false,
            raw: ds,
          },
        }}
        onClose={vi.fn()}
      />
    );
    const link = screen.getByRole("link", { name: /Open detail/i });
    expect(link.getAttribute("href")).toBe("/data-sources/ds1");
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <NodeDrawer
        node={{
          id: "a1",
          kind: "agent",
          data: {
            kind: "agent",
            label: "x",
            laneKeys: ["work"],
            orphan: false,
            raw: agent,
          },
        }}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByLabelText("Close drawer"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
