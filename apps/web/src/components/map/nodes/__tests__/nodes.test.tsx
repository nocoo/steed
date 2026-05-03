import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import { HostNode } from "../host-node";
import { AgentNode } from "../agent-node";
import { DataSourceNode } from "../data-source-node";
import type {
  AgentNodeData,
  DataSourceNodeData,
  HostNodeData,
} from "@/lib/map-data";

function wrap(ui: React.ReactNode) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

const baseHost: HostNodeData = {
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
};

const baseAgent: AgentNodeData = {
  kind: "agent",
  label: "Agent A",
  laneKeys: ["work"],
  orphan: false,
  raw: {
    id: "a1",
    host_id: "h1",
    match_key: "agent-a",
    nickname: "Agent A",
    role: null,
    lane_id: "lane_work",
    runtime_app: "node",
    runtime_version: "20",
    status: "running",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: null,
    metadata: {},
  },
};

const baseSource: DataSourceNodeData = {
  kind: "data_source",
  label: "Source A",
  laneKeys: ["work", "life"],
  orphan: false,
  raw: {
    id: "ds1",
    host_id: "h1",
    type: "personal_cli",
    name: "Source A",
    version: "1.0",
    auth_status: "authenticated",
    status: "active",
    metadata: {},
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: null,
    lane_ids: ["lane_work", "lane_life"],
  },
};

describe("HostNode", () => {
  it("renders online host", () => {
    wrap(<HostNode data={baseHost} />);
    expect(screen.getByText("Host A")).toBeInTheDocument();
    expect(screen.getByText(/online/)).toBeInTheDocument();
  });

  it("renders offline orphan host", () => {
    wrap(
      <HostNode
        data={{
          ...baseHost,
          orphan: true,
          raw: { ...baseHost.raw, status: "offline" },
        }}
      />
    );
    expect(screen.getByText(/offline · no agents/)).toBeInTheDocument();
  });
});

describe("AgentNode", () => {
  it("renders running agent", () => {
    wrap(<AgentNode data={baseAgent} />);
    expect(screen.getByText("Agent A")).toBeInTheDocument();
    expect(screen.getByText(/node/)).toBeInTheDocument();
  });

  it("renders orphan agent with no runtime", () => {
    wrap(
      <AgentNode
        data={{
          ...baseAgent,
          orphan: true,
          laneKeys: [],
          raw: { ...baseAgent.raw, runtime_app: null, status: "stopped" },
        }}
      />
    );
    expect(screen.getByText(/—/)).toBeInTheDocument();
    expect(screen.getByText(/unbound/)).toBeInTheDocument();
  });

  it("falls back to slate dot for unknown status", () => {
    wrap(
      <AgentNode
        data={{
          ...baseAgent,
          raw: { ...baseAgent.raw, status: "unknown" as never },
        }}
      />
    );
    expect(screen.getByText("Agent A")).toBeInTheDocument();
  });
});

describe("DataSourceNode", () => {
  it("renders multi-lane data source", () => {
    wrap(<DataSourceNode data={baseSource} />);
    expect(screen.getByText("Source A")).toBeInTheDocument();
    expect(
      screen.getByText(/personal_cli · authenticated/)
    ).toBeInTheDocument();
  });

  it("renders orphan data source", () => {
    wrap(<DataSourceNode data={{ ...baseSource, orphan: true }} />);
    expect(screen.getByText(/unbound/)).toBeInTheDocument();
  });
});
