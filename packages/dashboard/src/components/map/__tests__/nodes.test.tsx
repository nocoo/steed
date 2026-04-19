import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import type {
  AgentListItem,
  DataSourceWithLanes,
  HostWithStatus,
} from "@steed/shared";
import { HostNode } from "@/components/map/nodes/host-node";
import { AgentNode } from "@/components/map/nodes/agent-node";
import { DataSourceNode } from "@/components/map/nodes/data-source-node";

const wrap = (ui: React.ReactNode) =>
  render(<ReactFlowProvider>{ui}</ReactFlowProvider>);

const host: HostWithStatus = {
  id: "h1",
  name: "host_alpha",
  api_key_hash: "x",
  created_at: "",
  last_seen_at: null,
  status: "online",
};

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
  lane_ids: ["lane_work", "lane_life"],
};

describe("HostNode", () => {
  it("renders host name and online status", () => {
    wrap(
      <HostNode
        data={{ kind: "host", label: host.name, laneKeys: [], orphan: false, raw: host }}
      />
    );
    expect(screen.getByLabelText(`Host ${host.name}`)).toBeDefined();
    expect(screen.getByText(host.name)).toBeDefined();
    expect(screen.getByText("online")).toBeDefined();
  });

  it("shows orphan hint when host has no agents", () => {
    wrap(
      <HostNode
        data={{ kind: "host", label: host.name, laneKeys: [], orphan: true, raw: host }}
      />
    );
    expect(screen.getByText(/no agents/)).toBeDefined();
  });

  it("renders offline status for offline host", () => {
    wrap(
      <HostNode
        data={{
          kind: "host",
          label: host.name,
          laneKeys: [],
          orphan: false,
          raw: { ...host, status: "offline" },
        }}
      />
    );
    expect(screen.getByText("offline")).toBeDefined();
  });
});

describe("AgentNode", () => {
  it("renders nickname + runtime + accessible name", () => {
    wrap(
      <AgentNode
        data={{
          kind: "agent",
          label: "hermes:main",
          laneKeys: ["work"],
          orphan: false,
          raw: agent,
        }}
      />
    );
    expect(screen.getByLabelText("Agent hermes:main")).toBeDefined();
    expect(screen.getByText("node")).toBeDefined();
  });

  it("appends 'unbound' suffix for orphan agent", () => {
    wrap(
      <AgentNode
        data={{
          kind: "agent",
          label: "x",
          laneKeys: ["unassigned"],
          orphan: true,
          raw: { ...agent, lane_id: null },
        }}
      />
    );
    expect(screen.getByText(/unbound/)).toBeDefined();
  });
});

describe("DataSourceNode", () => {
  it("renders data source label and type/auth", () => {
    wrap(
      <DataSourceNode
        data={{
          kind: "data_source",
          label: ds.name,
          laneKeys: ["work", "life"],
          orphan: false,
          raw: ds,
        }}
      />
    );
    expect(screen.getByLabelText(`Data Source ${ds.name}`)).toBeDefined();
    expect(screen.getByText(/personal_cli/)).toBeDefined();
    expect(screen.getByText(/authenticated/)).toBeDefined();
  });
});
